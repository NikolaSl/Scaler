/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { loadDebugAgentRunRecords } from "../../../src/debug-agent.js";
import { runDebugConductorLoop, type DebugConductorRunners } from "../../../src/debug-conductor.js";
import { loadDebugReports } from "../../../src/debug.js";
import { readLogEvents } from "../../../src/logging.js";
import { loadProposedExecutionPlan, loadReplanRequests } from "../../../src/plans.js";
import { loadResearchAgentRunRecords } from "../../../src/research-agent.js";
import { loadResearchReports, loadResearchRequests } from "../../../src/research.js";
import { loadReplanAgentRunRecords } from "../../../src/replan-agent.js";
import { createDefaultState, loadState, saveState } from "../../../src/state.js";
import type { TaskAgentRequest, TaskAgentRunResult } from "../../../src/subagents.js";
import { applyValidationReport } from "../../../src/validation.js";
import { runValidationDebugLoopWorkflow } from "../../../src/validation-debug-loop.js";

const execFileAsync = promisify(execFile);

async function withTempRepo<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-debug-conductor-integration-test-"));
  try {
    await execFileAsync("git", ["init"], { cwd: dir });
    await execFileAsync("git", ["config", "user.email", "scaler-test@example.invalid"], { cwd: dir });
    await execFileAsync("git", ["config", "user.name", "Scaler Test"], { cwd: dir });
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "package.json"), JSON.stringify({
      type: "module",
      scripts: { test: "node test-runner.js", build: "node -e \"process.exit(0)\"" },
    }, null, 2));
    await writeFile(join(dir, "test-runner.js"), "process.exit(1);\n");
    await writeFile(join(dir, "src/app.js"), "export const value = 1;\n");
    await execFileAsync("git", ["add", "package.json", "test-runner.js", "src/app.js"], { cwd: dir });
    await execFileAsync("git", ["commit", "-m", "initial fixture"], { cwd: dir });
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function runResult(request: TaskAgentRequest, stdoutEvents: unknown[]): TaskAgentRunResult {
  return { taskId: request.taskId, exitCode: 0, stdoutEvents, stderr: "", timedOut: false, aborted: false };
}

async function validationFailedDebugState(dir: string) {
  const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
  state.stage = "execution";
  state.currentTaskId = "T-DEBUG-LOOP";
  state.tasks = [{
    id: "T-DEBUG-LOOP",
    status: "validating",
    title: "Debug conductor task",
    prdRefs: ["REQ-DEBUG-LOOP"],
    allowedPathPrefixes: ["src/app.js", "test-runner.js"],
    updatedAt: state.createdAt,
  }];
  await saveState(dir, state);
  const failed = await applyValidationReport(dir, state, {
    taskId: "T-DEBUG-LOOP",
    status: "failed",
    summary: "Validation failed before debug conductor loop.",
    details: { evidenceRefs: ["validation-run-debug-loop"] },
  });
  assert.equal(failed.accepted, true);
  assert.equal(failed.state.tasks[0]?.status, "debugging");
  return failed.state;
}

test("mock integration: debug conductor chains validation failure through research to next approach", async () => {
  await withTempRepo(async (dir) => {
    const state = await validationFailedDebugState(dir);
    let debugCalls = 0;
    const runners: DebugConductorRunners = {
      debug: async (request) => {
        debugCalls += 1;
        if (debugCalls === 1) {
          return runResult(request, [{
            type: "scaler_debug_report",
            id: "RPT-MOCK-LOOP-NEEDS-RESEARCH",
            taskId: "T-DEBUG-LOOP",
            status: "needs_research",
            summary: "Need local evidence before a new patch.",
            researchScope: "local",
            researchQuestions: ["Which local fixture explains the failing validation?"],
            evidenceRefs: ["validation-run-debug-loop"],
          }]);
        }
        return runResult(request, [{
          type: "scaler_debug_report",
          id: "RPT-MOCK-LOOP-NEXT",
          taskId: "T-DEBUG-LOOP",
          status: "next_approach",
          summary: "Research identifies the fixture mismatch.",
          nextApproach: "Patch src/app.js to match the failing fixture expectation and rerun validation.",
          evidenceRefs: ["RPT-MOCK-LOOP-RESEARCH"],
        }]);
      },
      research: async (request) => runResult(request, [{
        type: "scaler_research_report",
        id: "RPT-MOCK-LOOP-RESEARCH",
        requestId: request.taskId.replace(/^research-agent-/, ""),
        taskId: "T-DEBUG-LOOP",
        status: "complete",
        question: "Which local fixture explains the failing validation?",
        sources: [{ id: "fixture", title: "Local fixture", quality: "project", path: "test-runner.js" }],
        conclusions: [{ summary: "The local fixture exits non-zero until the app value is changed.", confidence: "high", sourceRefs: ["fixture"] }],
        contradictions: [],
        unresolvedUnknowns: [],
        recommendations: ["Patch the fixture-facing app value."],
      }]),
    };

    const result = await runDebugConductorLoop(dir, state, { execute: true, maxSteps: 4 }, runners);

    assert.equal(result.accepted, true);
    assert.equal(result.stopReason, "next_approach");
    assert.deepEqual(result.steps.map((step) => step.action), ["run_debug_agent", "run_research_agent", "run_debug_agent"]);
    assert.equal((await loadState(dir)).tasks[0]?.status, "debugging");
    assert.ok((await loadResearchRequests(dir)).every((request) => request.status === "resolved"));
    assert.equal((await loadResearchReports(dir))[0]?.id, "RPT-MOCK-LOOP-RESEARCH");
    assert.ok((await loadDebugReports(dir)).some((report) => report.id === "RPT-MOCK-LOOP-NEXT"));
    assert.equal((await loadDebugAgentRunRecords(dir)).length, 2);
    assert.equal((await loadResearchAgentRunRecords(dir)).length, 1);
    assert.ok((await readLogEvents(dir)).some((event) => event.eventType === "debug" && event.summary.includes("Debug conductor loop")));
  });
});

test("mock integration: validation debug loop runs validation failure through debug and research", async () => {
  await withTempRepo(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    state.stage = "execution";
    state.currentTaskId = "T-VALIDATE-LOOP";
    state.tasks = [{
      id: "T-VALIDATE-LOOP",
      status: "validating",
      title: "Validate-loop task",
      prdRefs: ["REQ-VALIDATE-LOOP"],
      allowedPathPrefixes: ["src/app.js", "test-runner.js"],
      updatedAt: state.createdAt,
    }];
    await saveState(dir, state);

    let debugCalls = 0;
    const runners: DebugConductorRunners = {
      debug: async (request) => {
        debugCalls += 1;
        if (debugCalls === 1) {
          return runResult(request, [{
            type: "scaler_debug_report",
            id: "RPT-MOCK-VALIDATE-LOOP-NEEDS-RESEARCH",
            taskId: "T-VALIDATE-LOOP",
            status: "needs_research",
            summary: "Validation failure needs local fixture evidence.",
            researchScope: "local",
            researchQuestions: ["Why does the validation fixture fail?"],
            evidenceRefs: ["validation-run"],
          }]);
        }
        return runResult(request, [{
          type: "scaler_debug_report",
          id: "RPT-MOCK-VALIDATE-LOOP-NEXT",
          taskId: "T-VALIDATE-LOOP",
          status: "next_approach",
          summary: "Research found the fixture mismatch.",
          nextApproach: "Patch src/app.js to satisfy test-runner.js, then rerun validation.",
          evidenceRefs: ["RPT-MOCK-VALIDATE-LOOP-RESEARCH"],
        }]);
      },
      research: async (request) => runResult(request, [{
        type: "scaler_research_report",
        id: "RPT-MOCK-VALIDATE-LOOP-RESEARCH",
        requestId: request.taskId.replace(/^research-agent-/, ""),
        taskId: "T-VALIDATE-LOOP",
        status: "complete",
        question: "Why does the validation fixture fail?",
        sources: [{ id: "fixture", title: "Failing fixture", quality: "project", path: "test-runner.js" }],
        conclusions: [{ summary: "The test runner exits non-zero until the fixture-facing code changes.", confidence: "high", sourceRefs: ["fixture"] }],
        contradictions: [],
        unresolvedUnknowns: [],
        recommendations: ["Patch the fixture-facing code."],
      }]),
    };

    const result = await runValidationDebugLoopWorkflow(dir, state, "T-VALIDATE-LOOP", { execute: true, maxSteps: 4 }, runners);

    assert.equal(result.accepted, true);
    assert.equal(result.validation.result?.status, "failed");
    assert.equal(result.debugLoop?.stopReason, "next_approach");
    assert.deepEqual(result.debugLoop?.steps.map((step) => step.action), ["run_debug_agent", "run_research_agent", "run_debug_agent"]);
    assert.equal((await loadState(dir)).tasks[0]?.status, "debugging");
    assert.equal((await loadResearchReports(dir))[0]?.id, "RPT-MOCK-VALIDATE-LOOP-RESEARCH");
    assert.ok((await loadDebugReports(dir)).some((report) => report.id === "RPT-MOCK-VALIDATE-LOOP-NEXT"));
    assert.ok((await readLogEvents(dir)).some((event) => event.eventType === "validation" && event.summary.includes("Validation debug loop")));
  });
});

test("mock integration: debug conductor turns needs_replan into a proposed plan without accepting it", async () => {
  await withTempRepo(async (dir) => {
    const state = await validationFailedDebugState(dir);
    const runners: DebugConductorRunners = {
      debug: async (request) => runResult(request, [{
        type: "scaler_debug_report",
        id: "RPT-MOCK-LOOP-REPLAN",
        taskId: "T-DEBUG-LOOP",
        status: "needs_replan",
        summary: "The current task is too broad for safe debugging.",
        replanReason: "Split the debug work into a fixture task and an app task.",
        evidenceRefs: ["validation-run-debug-loop"],
      }]),
      replan: async (request) => runResult(request, [{
        type: "scaler_replan_proposal",
        plan: {
          version: 1,
          planVersion: 1,
          status: "draft",
          title: "Mock debug conductor replan",
          source: "mock-debug-conductor",
          tasks: [{ id: "T-DEBUG-LOOP-SPLIT", title: "Split debug fixture work", prdRefs: ["REQ-DEBUG-LOOP"], allowedPathPrefixes: ["src/app.js", "test-runner.js"] }],
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      }]),
    };

    const result = await runDebugConductorLoop(dir, state, { execute: true, maxSteps: 3 }, runners);

    assert.equal(result.accepted, true);
    assert.equal(result.stopReason, "proposed_replan");
    assert.deepEqual(result.steps.map((step) => step.action), ["run_debug_agent", "run_replan_agent"]);
    assert.equal((await loadReplanRequests(dir))[0]?.trigger, "debug_blocked");
    assert.equal((await loadProposedExecutionPlan(dir))?.tasks[0]?.id, "T-DEBUG-LOOP-SPLIT");
    assert.equal((await loadState(dir)).tasks.some((task) => task.id === "T-DEBUG-LOOP-SPLIT"), false);
    assert.equal((await loadReplanAgentRunRecords(dir)).length, 1);
  });
});

/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { assessDebugRetryGate, loadDebugAttempts, loadDebugReports, recordDebugAttempt } from "../../../src/debug.js";
import { runDebugAgentStep } from "../../../src/debug-agent.js";
import { readLogEvents } from "../../../src/logging.js";
import { runValidationWithExecutionLock } from "../../../src/operations.js";
import { loadReplanRequests } from "../../../src/plans.js";
import { loadResearchReports, loadResearchRequests } from "../../../src/research.js";
import { runResearchAgentStep } from "../../../src/research-agent.js";
import { createDefaultState, loadState, saveState } from "../../../src/state.js";
import type { TaskAgentRequest, TaskAgentRunResult } from "../../../src/subagents.js";
import { createTask } from "../../../src/tasks.js";
import { loadValidationRuns } from "../../../src/validation.js";
import { runConductorStep } from "../../../src/conductor.js";

const execFileAsync = promisify(execFile);

async function withTempRepo<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-integration-test-"));
  try {
    await execFileAsync("git", ["init"], { cwd: dir });
    await writeFile(join(dir, "package.json"), JSON.stringify({
      type: "module",
      scripts: {
        test: "node test-runner.js",
        build: "node -e \"process.exit(0)\"",
      },
    }, null, 2));
    await writeFile(join(dir, "test-runner.js"), "process.exit(1);\n");
    await writeFile(join(dir, "index.js"), "export const value = 1;\n");
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function taskReport(request: TaskAgentRequest, summary = "Mock task completed."): Record<string, unknown> {
  return { type: "scaler_task_report", taskId: request.taskId, ...request.attempt, status: "completed", summary, changedFiles: [], memoryRefs: [], validations: [], validationRefs: [], evidenceRefs: [], blockers: [], missingData: [], recommendedNextAction: "validate" };
}

function successfulTaskRunner(request: TaskAgentRequest): Promise<TaskAgentRunResult> {
  return Promise.resolve({
    taskId: request.taskId,
    exitCode: 0,
    stdoutEvents: [taskReport(request)],
    stderr: "",
    timedOut: false,
    aborted: false,
  });
}

function createScriptedDebugRunner(): (request: TaskAgentRequest) => Promise<TaskAgentRunResult> {
  let callCount = 0;
  return async (request) => {
    callCount += 1;
    const event = callCount === 1
      ? {
          type: "scaler_debug_report",
          taskId: "T-001",
          status: "needs_research",
          summary: "Need version-specific evidence before another fix.",
          failureId: "F-001",
          failureFingerprint: "failure-a",
          cycleSummary: "failure-a -> failure-b -> failure-a",
          attemptedApproaches: ["Change A", "Change B"],
          investigationSummary: "Local failures form a cycle and need external version evidence.",
          researchScope: "mixed",
          researchQuestions: ["What version-specific behavior explains failure-a/failure-b cycling?"],
          evidenceRefs: ["debug-log-1"],
        }
      : {
          type: "scaler_debug_report",
          taskId: "T-001",
          status: "next_approach",
          summary: "Research identifies a shared adapter root cause.",
          failureId: "F-001",
          failureFingerprint: "failure-a",
          rootCause: "Shared adapter maps the API shape incorrectly.",
          nextApproach: "Patch the shared adapter once, then rerun the exact failing validation.",
          evidenceRefs: ["RPT-RESEARCH-INTEGRATION"],
        };
    return {
      taskId: request.taskId,
      exitCode: 0,
      stdoutEvents: [event],
      stderr: "",
      timedOut: false,
      aborted: false,
    };
  };
}

async function scriptedResearchRunner(request: TaskAgentRequest): Promise<TaskAgentRunResult> {
  const requestId = /"id":\s*"([^"]+)"/.exec(request.prompt)?.[1] ?? "RESEARCH-UNKNOWN";
  return {
    taskId: request.taskId,
    exitCode: 0,
    stdoutEvents: [{
      type: "scaler_research_report",
      id: "RPT-RESEARCH-INTEGRATION",
      requestId,
      taskId: "T-001",
      status: "complete",
      question: "What version-specific behavior explains failure-a/failure-b cycling?",
      sources: [{ id: "project-test", title: "Local failing validation", quality: "project", path: "test-runner.js", summary: "The local reproduction cycles through shared adapter failures." }],
      conclusions: [{ summary: "Patch the shared adapter instead of toggling individual call sites.", confidence: "high", sourceRefs: ["project-test"] }],
      contradictions: [],
      unresolvedUnknowns: [],
      recommendations: ["Retry only after recording this new evidence."],
    }],
    stderr: "",
    timedOut: false,
    aborted: false,
  };
}

test("integration: validation failure escalates through debug report, research request, and next approach", async () => {
  await withTempRepo(async (dir) => {
    const initial = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    initial.stage = "execution";
    await saveState(dir, initial);
    const created = await createTask(dir, initial, {
      id: "T-001",
      title: "Fix cyclic failure",
      status: "ready",
      allowedPathPrefixes: ["index.js", "test-runner.js", "package.json"],
      prdRefs: ["REQ-001"],
      definitionOfDone: ["The cyclic failure is reproduced and handed to validation."],
      outputPaths: [],
    });
    assert.equal(created.accepted, true);

    const conductor = await runConductorStep(dir, created.state, { execute: true }, successfulTaskRunner);
    assert.equal(conductor.accepted, true);
    assert.equal((await loadState(dir)).tasks[0]?.status, "validating");

    const validation = await runValidationWithExecutionLock(dir, await loadState(dir), "T-001");
    assert.equal(validation.accepted, true);
    assert.equal(validation.result?.status, "failed");
    assert.equal((await loadState(dir)).tasks[0]?.status, "debugging");
    assert.equal((await loadValidationRuns(dir)).length, 1);

    const debugState = await loadState(dir);
    await recordDebugAttempt(dir, debugState, {
      taskId: "T-001",
      failureId: "F-001",
      hypothesis: "Fix A",
      actionSummary: "Change A",
      result: "new_failure",
      failureFingerprint: "failure-a",
      resultingFailureFingerprint: "failure-b",
      evidence: ["validation-run-1"],
    }, new Date("2026-01-01T00:00:01.000Z"));
    await recordDebugAttempt(dir, debugState, {
      taskId: "T-001",
      failureId: "F-001",
      hypothesis: "Fix B",
      actionSummary: "Change B",
      result: "new_failure",
      failureFingerprint: "failure-b",
      resultingFailureFingerprint: "failure-a",
      evidence: ["debug-log-1"],
    }, new Date("2026-01-01T00:00:02.000Z"));

    const blockedGate = await assessDebugRetryGate(dir, "T-001");
    assert.equal(blockedGate.allowed, false);
    assert.equal((await loadReplanRequests(dir))[0]?.trigger, "debug_cycle");

    const debugRunner = createScriptedDebugRunner();
    const debugResearch = await runDebugAgentStep(dir, await loadState(dir), { taskId: "T-001", execute: true }, debugRunner);
    assert.equal(debugResearch.ingestion?.ingested, true);
    assert.equal(debugResearch.ingestion?.researchRequestIds?.length, 1);
    assert.equal((await loadResearchRequests(dir))[0]?.scope, "mixed");

    const research = await runResearchAgentStep(dir, await loadState(dir), { execute: true }, scriptedResearchRunner);
    assert.equal(research.ingestion?.ingested, true);
    assert.equal((await loadResearchReports(dir))[0]?.id, "RPT-RESEARCH-INTEGRATION");
    assert.equal((await loadResearchRequests(dir))[0]?.status, "resolved");

    const debugNext = await runDebugAgentStep(dir, await loadState(dir), { taskId: "T-001", execute: true }, debugRunner);
    assert.equal(debugNext.ingestion?.ingested, true);
    assert.equal(debugNext.ingestion?.report?.status, "next_approach");
    assert.match(debugNext.ingestion?.report?.nextApproach ?? "", /shared adapter/);

    await recordDebugAttempt(dir, await loadState(dir), {
      taskId: "T-001",
      failureId: "F-001",
      hypothesis: "Shared adapter root cause",
      actionSummary: "Plan adapter patch",
      result: "partial",
      failureFingerprint: "failure-a",
      resultingFailureFingerprint: "failure-a",
      evidence: ["RPT-RESEARCH-INTEGRATION"],
      newEvidence: "Research report RPT-RESEARCH-INTEGRATION identifies the shared adapter root cause.",
    }, new Date("2026-01-01T00:00:03.000Z"));
    const clearedGate = await assessDebugRetryGate(dir, "T-001");
    assert.equal(clearedGate.allowed, true);

    const attempts = await loadDebugAttempts(dir);
    const reports = await loadDebugReports(dir);
    const events = await readLogEvents(dir);
    assert.equal(attempts.length, 3);
    assert.equal(reports.length, 2);
    assert.ok(events.some((event) => event.eventType === "agent" && event.agentType === "debug"));
    assert.ok(events.some((event) => event.eventType === "report" && event.summary.includes("Debug report ingested")));
  });
});

test("integration: child free-form output is not ingested as debug state", async () => {
  await withTempRepo(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    state.stage = "debugging";
    state.currentTaskId = "T-001";
    state.tasks = [{ id: "T-001", status: "debugging", title: "Debug task", updatedAt: state.createdAt }];
    await saveState(dir, state);

    const freeFormRunner = async (request: TaskAgentRequest): Promise<TaskAgentRunResult> => ({
      taskId: request.taskId,
      exitCode: 0,
      stdoutEvents: [{ type: "unparsed", text: "I fixed it, trust me." }],
      stderr: "",
      timedOut: false,
      aborted: false,
    });

    const result = await runDebugAgentStep(dir, state, { taskId: "T-001", execute: true }, freeFormRunner);
    assert.equal(result.accepted, true);
    assert.equal(result.ingestion?.attempted, true);
    assert.equal(result.ingestion?.ingested, false);
    assert.match(result.ingestion?.reason ?? "", /No scaler_debug_report/);
    assert.deepEqual(await loadDebugReports(dir), []);
  });
});

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  runDebugConductorLoop,
  runDebugConductorStep,
  selectDebugConductorTask,
  type DebugConductorRunners,
} from "../src/debug-conductor.js";
import { loadDebugReports } from "../src/debug.js";
import { loadProposedExecutionPlan, loadReplanRequests } from "../src/plans.js";
import { loadResearchReports, loadResearchRequests } from "../src/research.js";
import { createDefaultState, saveState } from "../src/state.js";
import type { TaskAgentRequest, TaskAgentRunResult } from "../src/subagents.js";
import type { ScalerState } from "../src/types.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-debug-conductor-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function debuggingState(): ScalerState {
  const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
  state.stage = "debugging";
  state.currentTaskId = "T-DEBUG";
  state.tasks = [{
    id: "T-DEBUG",
    status: "debugging",
    title: "Debug failing validation",
    prdRefs: ["REQ-DEBUG"],
    allowedPathPrefixes: ["src/app.js"],
    updatedAt: state.createdAt,
  }];
  return state;
}

function runResult(request: TaskAgentRequest, stdoutEvents: unknown[]): TaskAgentRunResult {
  return {
    taskId: request.taskId,
    exitCode: 0,
    stdoutEvents,
    stderr: "",
    timedOut: false,
    aborted: false,
  };
}

test("selectDebugConductorTask prefers explicit and current debugging task", () => {
  const state = debuggingState();
  state.tasks.unshift({ id: "T-OTHER", status: "debugging", title: "Other", updatedAt: state.createdAt });

  assert.equal(selectDebugConductorTask(state, "T-OTHER")?.id, "T-OTHER");
  assert.equal(selectDebugConductorTask(state)?.id, "T-DEBUG");
  assert.equal(selectDebugConductorTask(state, "MISSING"), undefined);
});

test("runDebugConductorStep prepares a debug agent when execute is false", async () => {
  await withTempDir(async (dir) => {
    const state = debuggingState();
    await saveState(dir, state);

    const result = await runDebugConductorStep(dir, state, { taskId: "T-DEBUG" });

    assert.equal(result.accepted, true);
    assert.equal(result.action, "run_debug_agent");
    assert.equal(result.debugAgent?.runRecord?.status, "prepared");
  });
});

test("runDebugConductorLoop chains debug needs_research, research completion, and debug next_approach", async () => {
  await withTempDir(async (dir) => {
    const state = debuggingState();
    await saveState(dir, state);
    let debugCalls = 0;
    const runners: DebugConductorRunners = {
      debug: async (request) => {
        debugCalls += 1;
        if (debugCalls === 1) {
          return runResult(request, [{
            type: "scaler_debug_report",
            id: "RPT-DEBUG-NEEDS-RESEARCH",
            taskId: "T-DEBUG",
            status: "needs_research",
            summary: "Need targeted evidence before another patch.",
            researchScope: "local",
            researchQuestions: ["What local evidence explains the failing validation?"],
            evidenceRefs: ["validation-run-1"],
          }]);
        }
        return runResult(request, [{
          type: "scaler_debug_report",
          id: "RPT-DEBUG-NEXT",
          taskId: "T-DEBUG",
          status: "next_approach",
          summary: "Research identifies the shared adapter root cause.",
          nextApproach: "Patch the shared adapter and rerun validation.",
          evidenceRefs: ["RPT-RESEARCH-DEBUG"],
        }]);
      },
      research: async (request) => runResult(request, [{
        type: "scaler_research_report",
        id: "RPT-RESEARCH-DEBUG",
        requestId: request.taskId.replace(/^research-agent-/, ""),
        taskId: "T-DEBUG",
        status: "complete",
        question: "What local evidence explains the failing validation?",
        sources: [{ id: "local", title: "Local validation log", quality: "project", summary: "The adapter maps the API response incorrectly." }],
        conclusions: [{ summary: "Patch the shared adapter.", confidence: "high", sourceRefs: ["local"] }],
        contradictions: [],
        unresolvedUnknowns: [],
        recommendations: ["Retry with the shared adapter fix."],
      }]),
    };

    const result = await runDebugConductorLoop(dir, state, { execute: true, maxSteps: 4 }, runners);

    assert.equal(result.accepted, true);
    assert.equal(result.stopReason, "next_approach");
    assert.deepEqual(result.steps.map((step) => step.action), ["run_debug_agent", "run_research_agent", "run_debug_agent"]);
    assert.equal((await loadResearchRequests(dir))[0]?.status, "resolved");
    assert.equal((await loadResearchReports(dir))[0]?.id, "RPT-RESEARCH-DEBUG");
    assert.equal((await loadDebugReports(dir))[0]?.id, "RPT-DEBUG-NEXT");
  });
});

test("runDebugConductorLoop runs replanner after debug needs_replan and stops at proposed plan", async () => {
  await withTempDir(async (dir) => {
    const state = debuggingState();
    await saveState(dir, state);
    const runners: DebugConductorRunners = {
      debug: async (request) => runResult(request, [{
        type: "scaler_debug_report",
        id: "RPT-DEBUG-REPLAN",
        taskId: "T-DEBUG",
        status: "needs_replan",
        summary: "Task definition is wrong for the observed failure.",
        replanReason: "Split the task around the adapter contract first.",
        evidenceRefs: ["validation-run-1"],
      }]),
      replan: async (request) => runResult(request, [{
        type: "scaler_replan_proposal",
        plan: {
          version: 1,
          planVersion: 1,
          status: "draft",
          title: "Debug conductor proposed plan",
          tasks: [{ id: "T-DEBUG-SPLIT", title: "Split adapter contract task", prdRefs: ["REQ-DEBUG"], allowedPathPrefixes: ["src/app.js"] }],
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
    assert.equal((await loadProposedExecutionPlan(dir))?.tasks[0]?.id, "T-DEBUG-SPLIT");
  });
});

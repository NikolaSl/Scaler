import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runConductorStep } from "../../../src/conductor.js";
import { dispatchMissingContextRequest, loadMissingContextRequests } from "../../../src/missing-context.js";
import { createDefaultState, loadState, saveState } from "../../../src/state.js";
import type { TaskAgentRequest, TaskAgentRunResult } from "../../../src/subagents.js";
import type { ScalerState } from "../../../src/types.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-missing-context-flow-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function createState(): ScalerState {
  const state = createDefaultState(new Date("2026-03-01T00:00:00.000Z"));
  state.stage = "execution";
  state.tasks = [{
    id: "T-MISS-FLOW",
    title: "Implement with missing file context",
    status: "ready",
    allowedPathPrefixes: ["src"],
    updatedAt: state.createdAt,
  }];
  state.currentTaskId = "T-MISS-FLOW";
  return state;
}

async function needsDataRunner(request: TaskAgentRequest): Promise<TaskAgentRunResult> {
  return {
    taskId: request.taskId,
    exitCode: 0,
    stdoutEvents: [{
      type: "scaler_task_report",
      taskId: "T-MISS-FLOW",
      status: "needs_data",
      summary: "Need file context before implementation.",
      changedFiles: [],
      memoryRefs: [],
      validations: [],
      validationRefs: [],
      evidenceRefs: [],
      blockers: ["Need `docs/spec.md`"],
      missingData: ["Need `docs/spec.md`"],
      recommendedNextAction: "retrieve_context",
    }],
    stderr: "",
    timedOut: false,
    aborted: false,
  };
}

async function completionRunner(request: TaskAgentRequest): Promise<TaskAgentRunResult> {
  return {
    taskId: request.taskId,
    exitCode: 0,
    stdoutEvents: [{
      type: "scaler_task_report",
      taskId: "T-MISS-FLOW",
      status: "completed",
      summary: "Context retrieved; ready for validation.",
      changedFiles: ["src/result.ts"],
      memoryRefs: [],
      validations: [{ command: "npm test", status: "passed", summary: "mock" }],
      validationRefs: ["mock"],
      evidenceRefs: ["docs/spec.md"],
      blockers: [],
      missingData: [],
      recommendedNextAction: "validate",
    }],
    stderr: "",
    timedOut: false,
    aborted: false,
  };
}

test("mock integration: missing context request resolves and conductor retries blocked task", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, "docs"), { recursive: true });
    await writeFile(join(dir, "docs", "spec.md"), "# Spec\n\nNeeded details.\n");
    const state = createState();
    await saveState(dir, state);

    const first = await runConductorStep(dir, state, { execute: true }, needsDataRunner);
    assert.equal(first.accepted, true, first.message);
    assert.equal(first.validationHandoff?.status, "task_agent_report_blocked");
    assert.equal((await loadState(dir)).tasks[0]?.status, "blocked");
    const missing = await loadMissingContextRequests(dir);
    assert.equal(missing.length, 1);
    assert.equal(missing[0]?.kind, "file");

    const dispatched = await dispatchMissingContextRequest(dir, await loadState(dir), missing[0]?.id, { execute: true });
    assert.equal(dispatched.accepted, true, dispatched.message);

    const second = await runConductorStep(dir, await loadState(dir), { execute: true }, completionRunner);
    assert.equal(second.accepted, true, second.message);
    assert.equal(second.validationHandoff?.status, "validation_required");
    assert.equal((await loadState(dir)).tasks[0]?.status, "validating");
    assert.equal((await loadMissingContextRequests(dir))[0]?.status, "resolved");
  });
});

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readLogEvents } from "../../../src/logging.js";
import { loadExecutionPlan, saveExecutionPlan } from "../../../src/plans.js";
import { upsertPrdRequirement } from "../../../src/prd.js";
import { createDefaultState, loadState, saveState } from "../../../src/state.js";
import { loadStageWorkflowRunRecords, runAutonomousStageWorkflow } from "../../../src/stage-workflow.js";
import type { TaskAgentRequest, TaskAgentRunResult } from "../../../src/subagents.js";
import type { ScalerState } from "../../../src/types.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-stage-workflow-mock-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function createState(stage: ScalerState["stage"]): ScalerState {
  const state = createDefaultState(new Date("2026-02-01T00:00:00.000Z"));
  state.stage = stage;
  return state;
}

async function replanRunner(request: TaskAgentRequest): Promise<TaskAgentRunResult> {
  assert.equal(request.taskId, "replan-agent");
  assert.match(request.prompt, /REQ-DISCOVERED/);
  return {
    taskId: request.taskId,
    exitCode: 0,
    stdoutEvents: [{
      type: "scaler_replan_proposal",
      plan: {
        version: 1,
        planVersion: 2,
        status: "draft",
        title: "Discovery refresh plan",
        source: "mock-integration",
        tasks: [
          { id: "T-DONE", title: "Already validated", prdRefs: ["REQ-DONE"], allowedPathPrefixes: ["done.ts"], validationRefs: ["done"] },
          { id: "T-DISCOVERED", title: "Implement discovered requirement", prdRefs: ["REQ-DISCOVERED"], allowedPathPrefixes: ["discovered.ts"], dependsOn: ["T-DONE"], validationRefs: ["unit"] },
        ],
        createdAt: "2026-02-01T00:00:00.000Z",
        updatedAt: "2026-02-01T00:00:00.000Z",
      },
    }],
    stderr: "",
    timedOut: false,
    aborted: false,
  };
}

test("mock integration: autonomous stage workflow refreshes Stage III from execution discovery", async () => {
  await withTempDir(async (dir) => {
    await upsertPrdRequirement(dir, {
      id: "REQ-DONE",
      statement: "Validated work must remain preserved.",
      status: "validated",
      taskIds: ["T-DONE"],
      now: new Date("2026-02-01T00:00:00.000Z"),
    });
    await upsertPrdRequirement(dir, {
      id: "REQ-DISCOVERED",
      statement: "Execution discovered a new requirement that needs a task.",
      status: "pending",
      now: new Date("2026-02-01T00:00:01.000Z"),
    });

    const state = createState("execution");
    state.tasks = [{
      id: "T-DONE",
      title: "Already validated",
      status: "validated",
      prdRefs: ["REQ-DONE"],
      allowedPathPrefixes: ["done.ts"],
      updatedAt: state.createdAt,
    }];
    state.validatedTaskIds = ["T-DONE"];
    state.completedTaskIds = ["T-DONE"];
    await saveState(dir, state);
    await saveExecutionPlan(dir, {
      version: 1,
      planVersion: 1,
      status: "active",
      title: "Before discovery",
      tasks: [{ id: "T-DONE", title: "Already validated", prdRefs: ["REQ-DONE"], allowedPathPrefixes: ["done.ts"] }],
      createdAt: "2026-02-01T00:00:00.000Z",
      updatedAt: "2026-02-01T00:00:00.000Z",
    });

    const result = await runAutonomousStageWorkflow(dir, state, { execute: true, maxSteps: 6 }, { replan: replanRunner });

    assert.equal(result.accepted, true, result.message);
    assert.equal(result.stopReason, "execution_ready");
    assert.equal(result.finalState.stage, "execution");
    assert.deepEqual(result.steps.map((step) => step.action), ["execution_replan_request", "replan_accept", "execution_ready"]);
    assert.equal((await loadExecutionPlan(dir)).tasks.some((task) => task.id === "T-DISCOVERED"), true);
    assert.equal((await loadState(dir)).tasks.some((task) => task.id === "T-DISCOVERED" && task.status === "pending"), true);
    assert.equal((await loadStageWorkflowRunRecords(dir))[0]?.status, "passed");
    const events = await readLogEvents(dir);
    assert.ok(events.some((event) => event.eventType === "state" && event.summary.includes("Replan request created")));
    assert.ok(events.some((event) => event.eventType === "system" && event.summary.includes("Stage workflow passed")));
  });
});

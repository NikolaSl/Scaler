/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runScalerAutomation } from "../src/autopilot.js";
import { loadState, saveState, createDefaultState } from "../src/state.js";
import { upsertValidationManifestCommand } from "../src/validation.js";
import type { TaskAgentRequest, TaskAgentRunResult } from "../src/subagents.js";
import type { ScalerState } from "../src/types.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-autopilot-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function createState(stage: ScalerState["stage"]): ScalerState {
  const state = createDefaultState(new Date("2026-03-01T00:00:00.000Z"));
  state.stage = stage;
  return state;
}

function planTask() {
  return {
    id: "T-AUTO",
    title: "Run fully automated task",
    taskKind: "software",
    atomicityRationale: "T-AUTO is independently completable and testable for full automation.",
    allowedPathPrefixes: ["src/autopilot.ts"],
    prdRefs: ["REQ-AUTO"],
    definitionOfDone: ["The automation task reports completion and validation passes."],
    validationCommands: [
      { id: "test-first", command: "node -e \"process.exit(0)\"", gate: "test_first", required: true, environment: "host" },
      { id: "unit", command: "node -e \"process.exit(0)\"", gate: "unit_tests", required: true, environment: "host" },
    ],
  };
}

async function stageRunner(request: TaskAgentRequest): Promise<TaskAgentRunResult> {
  assert.equal(request.taskId, "stage-planning");
  assert.ok(request.tools?.includes("read"));
  assert.ok(request.tools?.includes("bash"));
  assert.ok(request.tools?.includes("scaler_planning_report"));
  return {
    taskId: request.taskId,
    exitCode: 0,
    stdoutEvents: [{
      type: "scaler_planning_report",
      id: "planning-autopilot",
      reason: "Plan used by the full automation test.",
      source: "autopilot-test",
      requirements: [{ id: "REQ-AUTO", title: "Automation", statement: "Run stage, task, validation, and completion automatically.", status: "in_progress" }],
      plan: {
        planVersion: 1,
        status: "active",
        title: "Automation test plan",
        source: "autopilot-test",
        tasks: [planTask()],
      },
    }],
    stderr: "",
    timedOut: false,
    aborted: false,
  };
}

async function taskRunner(request: TaskAgentRequest): Promise<TaskAgentRunResult> {
  assert.equal(request.taskId, "T-AUTO");
  assert.ok(request.tools?.includes("read"));
  assert.ok(request.tools?.includes("bash"));
  assert.ok(request.tools?.includes("edit"));
  assert.ok(request.tools?.includes("write"));
  assert.ok(request.tools?.includes("scaler_task_report"));
  return {
    taskId: request.taskId,
    exitCode: 0,
    stdoutEvents: [{
      type: "scaler_task_report",
      taskId: "T-AUTO",
      ...request.attempt,
      status: "completed",
      summary: "Task completed by full automation test.",
      changedFiles: [],
      validations: [{ id: "unit", command: "node -e \"process.exit(0)\"", status: "passed", summary: "Runner supplied completion." }],
    }],
    stderr: "",
    timedOut: false,
    aborted: false,
  };
}

test("runScalerAutomation debug-retries validation failures before completing", async () => {
  await withTempDir(async (dir) => {
    const state = createState("execution");
    state.currentTaskId = "T-DEBUG-AUTO";
    state.tasks = [{
      id: "T-DEBUG-AUTO",
      title: "Debug auto task",
      status: "validating",
      allowedPathPrefixes: ["fixed.txt"],
      updatedAt: state.createdAt,
    }];
    await saveState(dir, state);
    await upsertValidationManifestCommand(dir, {
      taskId: "T-DEBUG-AUTO",
      id: "marker",
      command: "node -e \"process.exit(require('fs').existsSync('fixed.txt') ? 0 : 1)\"",
      description: "Marker validation",
      required: true,
      gate: "unit",
      expectedResult: "fixed.txt exists",
    });

    const result = await runScalerAutomation(dir, state, { maxSteps: 12, maxDebugSteps: 4 }, {
      debug: async (request) => ({
        taskId: request.taskId,
        exitCode: 0,
        stdoutEvents: [{
          type: "scaler_debug_report",
          id: "RPT-DEBUG-AUTO",
          taskId: "T-DEBUG-AUTO",
          status: "next_approach",
          summary: "Create the missing marker file.",
          failureId: "F-DEBUG-AUTO",
          failureFingerprint: "missing marker",
          rootCause: "The task did not create fixed.txt.",
          nextApproach: "Create fixed.txt and rerun marker validation.",
          evidenceRefs: ["validation:marker"],
        }],
        stderr: "",
        timedOut: false,
        aborted: false,
      }),
      task: async (request) => {
        assert.equal(request.taskId, "T-DEBUG-AUTO");
        await writeFile(join(request.cwd ?? dir, "fixed.txt"), "ok\n", "utf8");
        return {
          taskId: request.taskId,
          exitCode: 0,
          stdoutEvents: [{ type: "scaler_task_report", taskId: request.taskId, ...request.attempt, status: "completed", summary: "Debug retry wrote fixed.txt.", changedFiles: ["fixed.txt"] }],
          stderr: "",
          timedOut: false,
          aborted: false,
        };
      },
    });

    assert.equal(result.completed, true, result.message);
    assert.ok(result.steps.some((step) => step.action === "debug"));
    assert.ok(result.steps.some((step) => step.action === "debug_retry"));
    assert.equal((await loadState(dir)).tasks.find((task) => task.id === "T-DEBUG-AUTO")?.status, "validated");
  });
});

test("runScalerAutomation drives planning, task execution, validation, and completion", async () => {
  await withTempDir(async (dir) => {
    const state = createState("planning");
    await saveState(dir, state);

    const result = await runScalerAutomation(dir, state, { maxSteps: 12, maxStageSteps: 5 }, {
      stage: stageRunner,
      task: taskRunner,
    });

    assert.equal(result.completed, true, result.message);
    assert.equal(result.stopReason, "completed");
    assert.ok(result.steps.some((step) => step.action === "stage_workflow"));
    assert.ok(result.steps.some((step) => step.action === "task_agent"));
    assert.ok(result.steps.some((step) => step.action === "validation"));
    const savedState = await loadState(dir);
    assert.equal(savedState.stage, "completed");
    assert.equal(savedState.tasks.find((task) => task.id === "T-AUTO")?.status, "validated");
  });
});

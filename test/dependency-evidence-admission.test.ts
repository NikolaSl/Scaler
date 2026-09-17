/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { getBudgetState } from "../src/budgets.js";
import { buildTaskAgentPrompt, runConductorStep, type ConductorStepOptions } from "../src/conductor.js";
import { admitTaskExecution, TaskDependencyAdmissionError } from "../src/attempt-execution.js";
import { acquireExecutionLock, releaseExecutionLock } from "../src/locks.js";
import { loadState, saveState } from "../src/state.js";
import { loadTaskAttempts, type TaskAttemptBinding } from "../src/task-attempts.js";
import { createDefaultState } from "../src/state.js";
import { runTaskValidation, saveValidationManifest } from "../src/validation.js";

async function withFixture(fn: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "scaler-dependency-evidence-"));
  try {
    await writeFile(join(dir, "dependency.txt"), "accepted");
    const state = createDefaultState();
    state.stage = "execution";
    state.tasks = [
      { id: "T-DEP", status: "validating", allowedPathPrefixes: ["dependency.txt"], updatedAt: state.updatedAt },
      { id: "T-NEXT", status: "ready", dependsOn: ["T-DEP"], allowedPathPrefixes: ["next.txt"], updatedAt: state.updatedAt },
    ];
    await saveState(dir, state);
    await saveValidationManifest(dir, {
      taskId: "T-DEP", outputPaths: ["dependency.txt"],
      commands: [{ id: "check", required: true, command: "node -e \"if(require('fs').readFileSync('dependency.txt','utf8')!=='accepted')process.exit(1)\"" }],
      createdAt: "", updatedAt: "",
    });
    await saveValidationManifest(dir, { taskId: "T-NEXT", outputPaths: [], commands: [], createdAt: "", updatedAt: "" });
    const validation = await runTaskValidation(dir, await loadState(dir), "T-DEP");
    assert.equal(validation.acceptance?.accepted, true, validation.acceptance?.message);
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function completedReport(request: { taskId: string; attempt?: TaskAttemptBinding }) {
  return {
    type: "scaler_task_report" as const,
    taskId: request.taskId,
    ...request.attempt,
    status: "completed" as const,
    summary: "Dependent task completed.",
    changedFiles: [], memoryRefs: [], validations: [], validationRefs: [],
    evidenceRefs: ["worker:completed"], blockers: [], missingData: [],
    recommendedNextAction: "validate",
  };
}

test("stale accepted dependency refuses downstream dispatch without admission side effects", async () => withFixture(async (dir) => {
  await writeFile(join(dir, "dependency.txt"), "stale");
  const beforeBudget = getBudgetState(await loadState(dir));
  let runnerCalls = 0;
  const result = await runConductorStep(dir, await loadState(dir), { execute: true }, async (request) => {
    runnerCalls++;
    return { taskId: request.taskId, exitCode: 0, stdoutEvents: [completedReport(request)], stderr: "", timedOut: false, aborted: false };
  });

  assert.equal(result.accepted, false);
  assert.match(result.message, /dependency.*evidence|declared output/i);
  assert.equal(runnerCalls, 0);
  assert.deepEqual(await loadTaskAttempts(dir), []);
  assert.equal((await loadState(dir)).tasks.find((task) => task.id === "T-NEXT")?.status, "ready");
  assert.equal(getBudgetState(await loadState(dir)).usage.spawnedAgents, beforeBudget.usage.spawnedAgents);
}));

test("current accepted dependency permits downstream dispatch", async () => withFixture(async (dir) => {
  let runnerCalls = 0;
  const result = await runConductorStep(dir, await loadState(dir), { execute: true }, async (request) => {
    runnerCalls++;
    return { taskId: request.taskId, exitCode: 0, stdoutEvents: [completedReport(request)], stderr: "", timedOut: false, aborted: false };
  });
  assert.equal(result.accepted, true, result.message);
  assert.equal(runnerCalls, 1);
  assert.equal((await loadTaskAttempts(dir)).length, 1);
}));

test("shared attempt admission rechecks dependency evidence", async () => withFixture(async (dir) => {
  await writeFile(join(dir, "dependency.txt"), "stale");
  const state = await loadState(dir);
  const task = state.tasks.find((candidate) => candidate.id === "T-NEXT")!;
  const context = buildTaskAgentPrompt({ state, task }).resolvedContext;
  const lock = await acquireExecutionLock(dir, { operation: "test", taskId: task.id });
  try {
    await assert.rejects(
      admitTaskExecution(dir, lock.lock.id, state, task, context, "test", []),
      (error) => error instanceof TaskDependencyAdmissionError
        && error.taskId === "T-NEXT"
        && error.diagnostics.some((diagnostic) => /Dependency T-DEP:.*declared output changed/i.test(diagnostic)),
    );
    assert.deepEqual(await loadTaskAttempts(dir), []);
  } finally {
    await releaseExecutionLock(dir, lock.lock.id);
  }
}));

test("late dependency rejection does not publish projected agent budget", async () => withFixture(async (dir) => {
  const before = await loadState(dir);
  const beforeBudget = getBudgetState(before);
  let toolsReads = 0;
  let runnerCalls = 0;
  const options = { execute: true } as ConductorStepOptions;
  Object.defineProperty(options, "tools", {
    get() {
      toolsReads++;
      writeFileSync(join(dir, "dependency.txt"), "changed-after-preflight");
      return [];
    },
  });

  const result = await runConductorStep(dir, before, options, async (request) => {
    runnerCalls++;
    return { taskId: request.taskId, exitCode: 0, stdoutEvents: [completedReport(request)], stderr: "", timedOut: false, aborted: false };
  });

  assert.equal(toolsReads, 1);
  assert.equal(result.accepted, false);
  assert.match(result.message, /dependency admission rejected/i);
  assert.equal(runnerCalls, 0);
  assert.deepEqual(await loadTaskAttempts(dir), []);
  assert.equal((await loadState(dir)).tasks.find((task) => task.id === "T-NEXT")?.status, "ready");
  assert.equal(getBudgetState(await loadState(dir)).usage.spawnedAgents, beforeBudget.usage.spawnedAgents);
}));

test("stale unrelated accepted task does not block independent dispatch", async () => withFixture(async (dir) => {
  const state = await loadState(dir);
  state.tasks[1]!.dependsOn = [];
  await saveState(dir, state);
  await writeFile(join(dir, "dependency.txt"), "stale");
  let runnerCalls = 0;
  const result = await runConductorStep(dir, await loadState(dir), { execute: true }, async (request) => {
    runnerCalls++;
    return { taskId: request.taskId, exitCode: 0, stdoutEvents: [completedReport(request)], stderr: "", timedOut: false, aborted: false };
  });
  assert.equal(result.accepted, true, result.message);
  assert.equal(runnerCalls, 1);
}));

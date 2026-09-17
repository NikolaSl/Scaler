/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { getBudgetState } from "../src/budgets.js";
import { buildTaskAgentPrompt, runConductorStep, type ConductorStepOptions } from "../src/conductor.js";
import { admitTaskExecution } from "../src/attempt-execution.js";
import { acquireExecutionLock, releaseExecutionLock } from "../src/locks.js";
import { createDefaultState, loadState, saveState } from "../src/state.js";
import { loadTaskAttempts, type TaskAttemptBinding } from "../src/task-attempts.js";
import { saveValidationManifest } from "../src/validation.js";

async function withFixture(fn: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "scaler-task-contract-admission-"));
  try {
    const state = createDefaultState();
    state.stage = "execution";
    state.tasks = [{
      id: "T-WORK", status: "ready", title: "Perform bounded work",
      allowedPathPrefixes: ["result.txt"], definitionOfDone: ["Requested result is produced."],
      updatedAt: state.updatedAt,
    }];
    await saveState(dir, state);
    await saveValidationManifest(dir, {
      taskId: "T-WORK", outputPaths: [], commands: [],
      createdAt: "", updatedAt: "",
    });
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function completedReport(request: { taskId: string; attempt?: TaskAttemptBinding }) {
  return {
    type: "scaler_task_report" as const, taskId: request.taskId, ...request.attempt,
    status: "completed" as const, summary: "Bounded work completed.",
    changedFiles: [], memoryRefs: [], validations: [], validationRefs: [],
    evidenceRefs: ["worker:completed"], blockers: [], missingData: [],
    recommendedNextAction: "validate",
  };
}

test("conductor refuses an incomplete task contract before dispatch side effects", async () => withFixture(async (dir) => {
  const state = await loadState(dir);
  state.tasks[0]!.allowedPathPrefixes = undefined;
  state.tasks[0]!.definitionOfDone = undefined;
  await saveState(dir, state);
  await saveValidationManifest(dir, { taskId: "T-WORK", commands: [], createdAt: "", updatedAt: "" });
  const before = await loadState(dir);
  const beforeBudget = getBudgetState(before);
  let runnerCalls = 0;
  const result = await runConductorStep(dir, before, { execute: true }, async (request) => {
    runnerCalls++;
    return { taskId: request.taskId, exitCode: 0, stdoutEvents: [completedReport(request)], stderr: "", timedOut: false, aborted: false };
  });

  assert.equal(result.accepted, false);
  assert.match(result.message, /task contract admission rejected/i);
  assert.match(result.message, /write scope/i);
  assert.match(result.message, /declared output/i);
  assert.match(result.message, /acceptance/i);
  assert.equal(runnerCalls, 0);
  assert.deepEqual(await loadTaskAttempts(dir), []);
  assert.equal((await loadState(dir)).tasks[0]?.status, "ready");
  assert.equal(getBudgetState(await loadState(dir)).usage.spawnedAgents, beforeBudget.usage.spawnedAgents);
}));

test("shared attempt admission refuses an incomplete task contract", async () => withFixture(async (dir) => {
  const state = await loadState(dir);
  const task = state.tasks[0]!;
  task.definitionOfDone = undefined;
  const context = buildTaskAgentPrompt({ state, task }).resolvedContext;
  const lock = await acquireExecutionLock(dir, { operation: "test", taskId: task.id });
  try {
    await assert.rejects(
      admitTaskExecution(dir, lock.lock.id, state, task, context, "test", []),
      /task contract admission rejected.*acceptance/i,
    );
    assert.deepEqual(await loadTaskAttempts(dir), []);
  } finally {
    await releaseExecutionLock(dir, lock.lock.id);
  }
}));

test("explicit compact contract permits shared attempt admission", async () => withFixture(async (dir) => {
  const state = await loadState(dir);
  const task = state.tasks[0]!;
  const context = buildTaskAgentPrompt({ state, task }).resolvedContext;
  const lock = await acquireExecutionLock(dir, { operation: "test", taskId: task.id });
  try {
    const attempt = await admitTaskExecution(dir, lock.lock.id, state, task, context, "test", []);
    assert.equal(attempt.taskId, task.id);
    assert.equal((await loadTaskAttempts(dir)).length, 1);
  } finally {
    await releaseExecutionLock(dir, lock.lock.id);
  }
}));

test("late contract rejection does not publish projected agent budget", async () => withFixture(async (dir) => {
  const state = await loadState(dir);
  const beforeBudget = getBudgetState(state);
  let runnerCalls = 0;
  const options = { execute: true } as ConductorStepOptions;
  Object.defineProperty(options, "tools", {
    get() {
      state.tasks[0]!.definitionOfDone = undefined;
      return [];
    },
  });

  const result = await runConductorStep(dir, state, options, async () => {
    runnerCalls++;
    throw new Error("must not dispatch");
  });
  assert.equal(result.accepted, false);
  assert.match(result.message, /task contract admission rejected.*acceptance/i);
  assert.equal(runnerCalls, 0);
  assert.deepEqual(await loadTaskAttempts(dir), []);
  assert.equal(getBudgetState(await loadState(dir)).usage.spawnedAgents, beforeBudget.usage.spawnedAgents);
}));

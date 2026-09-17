/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { getBudgetState, setBudgetLimits } from "../src/budgets.js";
import { acquireExecutionLock, loadExecutionLock } from "../src/locks.js";
import { commitWithExecutionLock, runValidationWithExecutionLock } from "../src/operations.js";
import { ingestReport } from "../src/reports.js";
import { createDefaultState, loadState, saveState } from "../src/state.js";
import { addTask } from "../src/supervisor.js";
import { saveValidationManifest } from "../src/validation.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-operations-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("runValidationWithExecutionLock refuses when lock is held", async () => {
  await withTempDir(async (dir) => {
    const state = addTask(createDefaultState(), { id: "T-001", status: "validating" });
    await acquireExecutionLock(dir, { operation: "other", taskId: "T-999" });

    const result = await runValidationWithExecutionLock(dir, state, "T-001");

    assert.equal(result.accepted, false);
    assert.match(result.message, /Execution lock held/);
  });
});

test("runValidationWithExecutionLock releases lock after validation", async () => {
  await withTempDir(async (dir) => {
    const state = addTask(createDefaultState(), { id: "T-001", status: "validating" });
    await saveValidationManifest(dir, {
      taskId: "T-001",
      commands: [{ id: "pass", command: "node -e \"process.exit(0)\"", required: true }],
      outputPaths: [],
      createdAt: "",
      updatedAt: "",
    });

    const result = await runValidationWithExecutionLock(dir, state, "T-001");

    assert.equal(result.accepted, true);
    assert.equal(result.result?.status, "passed");
    assert.equal(getBudgetState(await loadState(dir)).usage.validationLoops, 1);
    assert.equal(await loadExecutionLock(dir), undefined);
  });
});

test("runValidationWithExecutionLock refuses hard validation-loop budget before commands", async () => {
  await withTempDir(async (dir) => {
    const state = setBudgetLimits(addTask(createDefaultState(), { id: "T-001", status: "validating" }), {
      validationLoops: { hard: 1 },
    });
    await saveValidationManifest(dir, {
      taskId: "T-001",
      commands: [{ id: "fail-if-run", command: "node -e \"process.exit(9)\"", required: true }],
      createdAt: "",
      updatedAt: "",
    });

    const result = await runValidationWithExecutionLock(dir, state, "T-001");

    assert.equal(result.accepted, false);
    assert.match(result.message, /Validation refused by budget/);
    assert.equal(getBudgetState(await loadState(dir)).usage.validationLoops, 1);
    assert.equal(await loadExecutionLock(dir), undefined);
  });
});

test("validation refuses a downstream task before dependency evidence exists", async () => {
  await withTempDir(async (dir) => {
    let state = createDefaultState();
    state.stage = "execution";
    state = addTask(state, { id: "T-UPSTREAM", status: "pending" });
    state = addTask(state, { id: "T-DOWNSTREAM", status: "ready", dependsOn: ["T-UPSTREAM"] });
    await saveState(dir, state);
    await saveValidationManifest(dir, {
      taskId: "T-DOWNSTREAM",
      commands: [{ id: "must-not-run", command: "node -e \"require('fs').writeFileSync('ran.txt','yes')\"", required: true }],
      outputPaths: [],
      createdAt: "",
      updatedAt: "",
    });

    const running = await ingestReport(dir, await loadState(dir), {
      reportType: "task", summary: "generic start", taskId: "T-DOWNSTREAM", taskTransition: "running",
    });
    assert.equal(running.accepted, true);
    const validating = await ingestReport(dir, await loadState(dir), {
      reportType: "task", summary: "generic validation", taskId: "T-DOWNSTREAM", taskTransition: "validating",
    });
    assert.equal(validating.accepted, true);

    const beforeBudget = getBudgetState(await loadState(dir)).usage.validationLoops;
    const result = await runValidationWithExecutionLock(dir, await loadState(dir), "T-DOWNSTREAM");
    assert.equal(result.accepted, false);
    assert.match(result.message, /dependenc|T-UPSTREAM/i);
    await assert.rejects(access(join(dir, "ran.txt")));
    assert.notEqual((await loadState(dir)).tasks.find((task) => task.id === "T-DOWNSTREAM")?.status, "validated");
    assert.equal(getBudgetState(await loadState(dir)).usage.validationLoops, beforeBudget);
  });
});

test("commitWithExecutionLock refuses when lock is held", async () => {
  await withTempDir(async (dir) => {
    const state = addTask(createDefaultState(), { id: "T-001", status: "validated" });
    await acquireExecutionLock(dir, { operation: "other", taskId: "T-999" });

    const result = await commitWithExecutionLock(dir, state, "T-001", ["src"]);

    assert.equal(result.accepted, false);
    assert.match(result.message, /Execution lock held/);
  });
});

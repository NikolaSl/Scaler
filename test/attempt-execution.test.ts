/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { admitTaskExecution, checkTaskExecutionResult, interruptTaskExecution, reconcileInterruptedTaskAttempt, startTaskExecution } from "../src/attempt-execution.js";
import { acquireExecutionLock, releaseExecutionLock } from "../src/locks.js";
import { createDefaultState, loadState, saveState } from "../src/state.js";
import { loadTaskAttempts } from "../src/task-attempts.js";
import { saveValidationManifest, upsertValidationManifestCommand } from "../src/validation.js";
import { buildTaskAgentPrompt } from "../src/conductor.js";
import { resolveTaskContextManifest, saveTaskContextManifest } from "../src/context.js";

async function fixture(fn: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "scaler-attempt-execution-"));
  try { await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

async function admitted(dir: string) {
  const state = createDefaultState();
  state.stage = "execution";
  state.tasks = [{
    id: "T-1", status: "ready", title: "Contract",
    allowedPathPrefixes: ["result.txt"], definitionOfDone: ["The attempt result is recorded."],
    updatedAt: state.updatedAt,
  }];
  await saveState(dir, state);
  await saveValidationManifest(dir, { taskId: "T-1", outputPaths: [], commands: [], createdAt: "", updatedAt: "" });
  const lock = await acquireExecutionLock(dir, { operation: "test", taskId: "T-1" });
  const context = buildTaskAgentPrompt({ state, task: state.tasks[0]! }).resolvedContext;
  const attempt = await admitTaskExecution(dir, lock.lock.id, state, state.tasks[0]!, context, "test", []);
  return { state, lockId: lock.lock.id, context, attempt };
}

test("attempt recovery blocks an admission interrupted before the task snapshot is bound", async () => {
  await fixture(async (dir) => {
    const initial = await admitted(dir);
    await releaseExecutionLock(dir, initial.lockId);
    const recovery = await reconcileInterruptedTaskAttempt(dir, initial.state);
    assert.equal(recovery?.state.tasks[0]?.status, "blocked");
    assert.equal((await loadTaskAttempts(dir))[0]?.outcome, "not_started");
  });
});

test("attempt interruption checks ownership before mutating state", async () => {
  await fixture(async (dir) => {
    const initial = await admitted(dir);
    await assert.rejects(interruptTaskExecution(dir, "not-owner", initial.attempt.id, ["stop"]), /execution lock/);
    assert.equal((await loadState(dir)).tasks[0]?.status, "ready");
    assert.equal((await loadTaskAttempts(dir))[0]?.status, "admitted");
  });
});

test("dispatch refuses file context changed after attempt admission", async () => {
  await fixture(async (dir) => {
    const state = createDefaultState();
    state.stage = "execution";
    state.tasks = [{
      id: "T-1", status: "ready", title: "Context freshness",
      allowedPathPrefixes: ["result.txt"], definitionOfDone: ["The attempt result is recorded."],
      updatedAt: state.updatedAt,
    }];
    await saveState(dir, state);
    await saveValidationManifest(dir, { taskId: "T-1", outputPaths: [], commands: [], createdAt: "", updatedAt: "" });
    await writeFile(join(dir, "reference.md"), "ORIGINAL\n", "utf8");
    const manifest = await saveTaskContextManifest(dir, {
      version: 1,
      taskId: "T-1",
      items: [{
        id: "reference", type: "file", reason: "Immutable source", priority: "required",
        scope: "full", source: "file", path: "reference.md",
      }],
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
    });
    const contextItems = await resolveTaskContextManifest(dir, state, manifest);
    const context = buildTaskAgentPrompt({ state, task: state.tasks[0]!, contextItems }).resolvedContext;
    const lock = await acquireExecutionLock(dir, { operation: "test", taskId: "T-1" });
    const attempt = await admitTaskExecution(dir, lock.lock.id, state, state.tasks[0]!, context, "test", []);

    await writeFile(join(dir, "reference.md"), "CHANGED\n", "utf8");
    await assert.rejects(
      startTaskExecution(dir, lock.lock.id, state, attempt),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /context.*(changed|stale).*reference\.md/i);
        for (const identity of ["T-1", "reference", "reference.md"]) {
          assert.ok(error.message.includes(identity), error.message);
        }
        return true;
      },
    );
    assert.equal((await loadState(dir)).tasks[0]?.status, "ready");
    assert.equal((await loadTaskAttempts(dir))[0]?.status, "admitted");
    await interruptTaskExecution(dir, lock.lock.id, attempt.id, [
      "Context source reference.md changed for T-1/reference.",
    ]);
    const [closed] = await loadTaskAttempts(dir);
    assert.equal(closed?.status, "failed");
    assert.equal(closed?.outcome, "not_started");
    assert.equal(closed?.reportId, undefined);
    assert.equal((await loadState(dir)).tasks[0]?.status, "blocked");
  });
});

test("failed recovery state publication keeps the attempt discoverable for restart", async () => {
  await fixture(async (dir) => {
    const initial = await admitted(dir);
    await startTaskExecution(dir, initial.lockId, initial.state, initial.attempt);
    const publicationLock = join(dir, ".scaler", "state.json.lock");
    await mkdir(publicationLock);
    await assert.rejects(interruptTaskExecution(dir, initial.lockId, initial.attempt.id, ["transport lost"]), /publication lock/);
    assert.equal((await loadTaskAttempts(dir))[0]?.status, "dispatching");
    await rm(publicationLock, { recursive: true });
    await releaseExecutionLock(dir, initial.lockId);
    const recovery = await reconcileInterruptedTaskAttempt(dir, await loadState(dir));
    assert.equal(recovery?.state.tasks[0]?.status, "blocked");
    assert.equal((await loadTaskAttempts(dir))[0]?.outcome, "unknown");
  });
});

test("current task attempt and validation policy changes invalidate returning results", async () => {
  await fixture(async (dir) => {
    const initial = await admitted(dir);
    const started = await startTaskExecution(dir, initial.lockId, initial.state, initial.attempt);
    assert.deepEqual((await checkTaskExecutionResult(dir, started.attempt, "T-1")).diagnostics, []);
    const changed = await loadState(dir);
    changed.tasks[0]!.attemptId = "replacement";
    changed.tasks[0]!.title = "New contract";
    await saveState(dir, changed);
    await upsertValidationManifestCommand(dir, { taskId: "T-1", id: "changed-policy", command: "true" });
    const result = await checkTaskExecutionResult(dir, started.attempt, "T-1");
    assert.match(result.diagnostics.join(" "), /run, task or attempt changed/);
    assert.match(result.diagnostics.join(" "), /task contract changed/);
    assert.match(result.diagnostics.join(" "), /validation policy changed/);
    await interruptTaskExecution(dir, initial.lockId, initial.attempt.id, result.diagnostics);
    assert.equal((await loadState(dir)).tasks[0]?.attemptId, "replacement");
    assert.equal((await loadState(dir)).tasks[0]?.status, "running");
  });
});

test("retry admission creates a distinct identity and interrupted prelaunch retry stays blocked", async () => {
  await fixture(async (dir) => {
    const initial = await admitted(dir);
    await startTaskExecution(dir, initial.lockId, initial.state, initial.attempt);
    await interruptTaskExecution(dir, initial.lockId, initial.attempt.id, ["interrupted"]);
    const retryState = await loadState(dir);
    retryState.tasks[0]!.status = "ready";
    await saveState(dir, retryState);
    const retry = await admitTaskExecution(dir, initial.lockId, retryState, retryState.tasks[0]!, initial.context, "test", []);
    assert.notEqual(retry.id, initial.attempt.id);
    assert.equal(retry.taskFingerprint, initial.attempt.taskFingerprint);
    await interruptTaskExecution(dir, initial.lockId, retry.id, ["prelaunch failure"]);
    assert.equal((await loadState(dir)).tasks[0]?.status, "blocked");
    assert.equal((await loadTaskAttempts(dir))[0]?.outcome, "not_started");
  });
});

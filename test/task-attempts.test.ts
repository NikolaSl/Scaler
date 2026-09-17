/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fingerprintJson } from "../src/fingerprints.js";
import { acquireExecutionLock, releaseExecutionLock } from "../src/locks.js";
import { admitTaskAttempt, completeTaskAttempt, findOpenTaskAttempt, loadTaskAttempts, markTaskAttemptDispatching } from "../src/task-attempts.js";

async function withDirectory(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-task-attempt-"));
  try { await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

function admission(taskId = "T-001") {
  return {
    runId: "run-1",
    taskId,
    taskFingerprint: fingerprintJson({ taskId, version: 1 }),
    inputFingerprint: fingerprintJson({ context: "input" }),
    routeFingerprint: fingerprintJson({ model: "test", tools: ["read"] }),
    validationPolicyFingerprint: fingerprintJson({ commands: ["npm test"] }),
  };
}

test("task attempt lifecycle is owned by the task execution lock", async () => {
  await withDirectory(async (dir) => {
    const lock = await acquireExecutionLock(dir, { operation: "conductor", taskId: "T-001" });
    assert.equal(lock.acquired, true);
    const admitted = await admitTaskAttempt(dir, lock.lock.id, admission(), new Date("2026-01-01T00:00:00.000Z"));
    assert.equal(findOpenTaskAttempt(await loadTaskAttempts(dir), "run-1", "T-001")?.id, admitted.id);
    const dispatching = await markTaskAttemptDispatching(dir, lock.lock.id, admitted.id, new Date("2026-01-01T00:00:01.000Z"));
    assert.equal(dispatching.status, "dispatching");
    const completed = await completeTaskAttempt(dir, lock.lock.id, admitted.id, {
      status: "completed",
      outcome: "succeeded",
      outputFingerprint: fingerprintJson({ files: ["src/app.ts"] }),
      reportId: "report-1",
    }, new Date("2026-01-01T00:00:02.000Z"));
    assert.equal(completed.status, "completed");
    assert.equal(findOpenTaskAttempt(await loadTaskAttempts(dir), "run-1", "T-001"), undefined);
    await releaseExecutionLock(dir, lock.lock.id);
  });
});

test("task attempts reject missing ownership, duplicate active work and terminal rewrites", async () => {
  await withDirectory(async (dir) => {
    await assert.rejects(admitTaskAttempt(dir, "missing", admission()), /execution lock does not own/);
    const lock = await acquireExecutionLock(dir, { operation: "conductor", taskId: "T-001" });
    const admitted = await admitTaskAttempt(dir, lock.lock.id, admission());
    await assert.rejects(admitTaskAttempt(dir, lock.lock.id, admission()), /already has open attempt/);
    await completeTaskAttempt(dir, lock.lock.id, admitted.id, { status: "failed", outcome: "not_started" });
    await assert.rejects(markTaskAttemptDispatching(dir, lock.lock.id, admitted.id), /cannot dispatch from failed/);
    await assert.rejects(completeTaskAttempt(dir, lock.lock.id, admitted.id, { status: "interrupted", outcome: "unknown" }), /already terminal/);
    await releaseExecutionLock(dir, lock.lock.id);
  });
});

test("task attempt terminal invariants reject ambiguous labels", async () => {
  await withDirectory(async (dir) => {
    const lock = await acquireExecutionLock(dir, { operation: "conductor", taskId: "T-001" });
    const admitted = await admitTaskAttempt(dir, lock.lock.id, admission());
    await assert.rejects(completeTaskAttempt(dir, lock.lock.id, admitted.id, { status: "completed", outcome: "succeeded" }), /outputFingerprint/);
    await assert.rejects(completeTaskAttempt(dir, lock.lock.id, admitted.id, { status: "interrupted", outcome: "failed" }), /unknown outcome/);
    await assert.rejects(completeTaskAttempt(dir, lock.lock.id, admitted.id, { status: "failed", outcome: "unknown" }), /failed or not_started/);
    await assert.rejects(completeTaskAttempt(dir, lock.lock.id, admitted.id, {
      status: "completed", outcome: "succeeded", outputFingerprint: fingerprintJson({ result: true }),
    }), /only finish as failed\/not_started/);
    await releaseExecutionLock(dir, lock.lock.id);
  });
});

test("task attempt loading fails closed on malformed durable identity", async () => {
  await withDirectory(async (dir) => {
    const reports = join(dir, ".scaler", "reports");
    await mkdir(reports, { recursive: true });
    await writeFile(join(reports, "task-attempts.json"), JSON.stringify({ version: 1, attempts: [{ id: "bad", status: "completed" }] }));
    await assert.rejects(loadTaskAttempts(dir), /requires runId|Invalid stored/);
  });
});

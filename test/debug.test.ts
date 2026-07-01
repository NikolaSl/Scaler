import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadDebugAttempts, loadDebugFailures, recordDebugAttempt } from "../src/debug.js";
import { createDefaultState } from "../src/state.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-debug-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("recordDebugAttempt stores accepted attempt and failure", async () => {
  await withTempDir(async (dir) => {
    const result = await recordDebugAttempt(dir, createDefaultState(), {
      taskId: "T-001",
      failureId: "F-001",
      hypothesis: "Wrong import path",
      actionSummary: "Changed import",
      result: "same_failure",
      failureFingerprint: "ERR_MODULE_NOT_FOUND line 12",
      validationCommand: "npm test",
    });

    const attempts = await loadDebugAttempts(dir);
    const failures = await loadDebugFailures(dir);

    assert.equal(result.accepted, true);
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0]?.attemptSignature, "wrong import path changed import");
    assert.equal(attempts[0]?.failureFingerprint, "err_module_not_found line *");
    assert.equal(failures.length, 1);
    assert.equal(failures[0]?.attemptCount, 1);
  });
});

test("recordDebugAttempt rejects invalid result", async () => {
  await withTempDir(async (dir) => {
    const result = await recordDebugAttempt(dir, createDefaultState(), {
      taskId: "T-001",
      failureId: "F-001",
      hypothesis: "Try something",
      actionSummary: "Changed code",
      result: "unknown",
    });

    assert.equal(result.accepted, false);
    assert.match(result.message, /invalid result/);
    assert.deepEqual(await loadDebugAttempts(dir), []);
  });
});

test("recordDebugAttempt rejects duplicate failed attempt without new evidence", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState();
    const first = await recordDebugAttempt(dir, state, {
      taskId: "T-001",
      failureId: "F-001",
      hypothesis: "Config is wrong",
      actionSummary: "Edit tsconfig",
      result: "no_effect",
      failureFingerprint: "TS2307: cannot find module",
    });
    const second = await recordDebugAttempt(dir, state, {
      taskId: "T-001",
      failureId: "F-001",
      hypothesis: "Config is wrong",
      actionSummary: "Edit tsconfig",
      result: "no_effect",
      failureFingerprint: "TS2307: cannot find module",
    });

    assert.equal(first.accepted, true);
    assert.equal(second.accepted, false);
    assert.equal(second.duplicateAttemptId, first.attempt?.id);
    assert.equal((await loadDebugAttempts(dir)).length, 1);
  });
});

test("recordDebugAttempt accepts duplicate when new evidence is supplied", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState();
    await recordDebugAttempt(dir, state, {
      taskId: "T-001",
      failureId: "F-001",
      hypothesis: "Config is wrong",
      actionSummary: "Edit tsconfig",
      result: "no_effect",
      failureFingerprint: "TS2307: cannot find module",
    });
    const second = await recordDebugAttempt(dir, state, {
      taskId: "T-001",
      failureId: "F-001",
      hypothesis: "Config is wrong",
      actionSummary: "Edit tsconfig",
      result: "partial",
      failureFingerprint: "TS2307: cannot find module",
      newEvidence: "Trace resolution points at paths baseUrl.",
    });

    assert.equal(second.accepted, true);
    assert.equal((await loadDebugAttempts(dir)).length, 2);
  });
});

test("recordDebugAttempt reports fingerprint cycles", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState();
    await recordDebugAttempt(dir, state, {
      taskId: "T-001",
      failureId: "F-001",
      hypothesis: "Fix A",
      actionSummary: "Change A",
      result: "new_failure",
      failureFingerprint: "failure-a",
      resultingFailureFingerprint: "failure-b",
    });
    const second = await recordDebugAttempt(dir, state, {
      taskId: "T-001",
      failureId: "F-001",
      hypothesis: "Fix B",
      actionSummary: "Change B",
      result: "new_failure",
      failureFingerprint: "failure-b",
      resultingFailureFingerprint: "failure-a",
    });

    assert.equal(second.accepted, true);
    assert.match(second.cycleDetected ?? "", /cycled failure-a -> failure-b -> failure-a/);
  });
});

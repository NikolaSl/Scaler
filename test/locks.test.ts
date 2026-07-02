import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  acquireExecutionLock,
  clearExecutionLock,
  formatExecutionLock,
  loadExecutionLock,
  releaseExecutionLock,
  withExecutionLock,
} from "../src/locks.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-lock-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("acquireExecutionLock creates lock atomically and refuses second holder", async () => {
  await withTempDir(async (dir) => {
    const first = await acquireExecutionLock(dir, { operation: "step", taskId: "T-001" });
    const second = await acquireExecutionLock(dir, { operation: "validate", taskId: "T-002" });

    assert.equal(first.acquired, true);
    assert.equal(second.acquired, false);
    assert.equal(second.existingLock?.taskId, "T-001");
  });
});

test("releaseExecutionLock releases only matching lock id", async () => {
  await withTempDir(async (dir) => {
    const acquired = await acquireExecutionLock(dir, { operation: "step" });
    const wrong = await releaseExecutionLock(dir, "wrong");
    const right = await releaseExecutionLock(dir, acquired.lock.id);

    assert.equal(wrong.released, false);
    assert.equal(right.released, true);
    assert.equal(await loadExecutionLock(dir), undefined);
  });
});

test("withExecutionLock releases after callback", async () => {
  await withTempDir(async (dir) => {
    const result = await withExecutionLock(dir, { operation: "test" }, async (lock) => lock.operation);

    assert.equal(result, "test");
    assert.equal(await loadExecutionLock(dir), undefined);
  });
});

test("formatExecutionLock renders none and held state", () => {
  assert.equal(formatExecutionLock(undefined), "No execution lock.");
  assert.match(
    formatExecutionLock({ version: 1, id: "lock-1", operation: "step", taskId: "T-001", createdAt: "now" }),
    /operation=step task=T-001/,
  );
});

test("clearExecutionLock manually clears existing lock", async () => {
  await withTempDir(async (dir) => {
    await acquireExecutionLock(dir, { operation: "step", taskId: "T-001" });

    const result = await clearExecutionLock(dir, "manual cleanup");

    assert.equal(result.released, true);
    assert.equal(await loadExecutionLock(dir), undefined);
  });
});

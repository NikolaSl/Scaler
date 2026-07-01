import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createDefaultState, loadState } from "../src/state.js";
import { createTask } from "../src/tasks.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-task-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("createTask adds pending task by default", async () => {
  await withTempDir(async (dir) => {
    const result = await createTask(dir, createDefaultState(), { id: "T-001", title: "First task" });
    const persisted = await loadState(dir);

    assert.equal(result.accepted, true);
    assert.equal(persisted.tasks[0]?.id, "T-001");
    assert.equal(persisted.tasks[0]?.status, "pending");
  });
});

test("createTask supports explicit ready status", async () => {
  await withTempDir(async (dir) => {
    const result = await createTask(dir, createDefaultState(), { id: "T-001", status: "ready" });

    assert.equal(result.accepted, true);
    assert.equal(result.state.tasks[0]?.status, "ready");
  });
});

test("createTask rejects duplicate task id", async () => {
  await withTempDir(async (dir) => {
    const first = await createTask(dir, createDefaultState(), { id: "T-001" });
    const second = await createTask(dir, first.state, { id: "T-001" });

    assert.equal(second.accepted, false);
    assert.equal(second.state.tasks.length, 1);
    assert.equal(second.state.rejectedTransitions.length, 1);
  });
});

test("createTask rejects invalid status without changing state", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState();
    const result = await createTask(dir, state, { id: "T-001", status: "done" });

    assert.equal(result.accepted, false);
    assert.equal(result.state, state);
    assert.match(result.message, /invalid status/);
  });
});

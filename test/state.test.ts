import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createDefaultState, ensureState, formatStateStatus, loadState, saveState } from "../src/state.js";
import { getStatePath } from "../src/paths.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("createDefaultState creates idle state", () => {
  const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));

  assert.equal(state.version, 1);
  assert.equal(state.stage, "idle");
  assert.equal(state.complexityLevel, 0);
  assert.equal(state.currentTaskId, null);
  assert.equal(state.createdAt, "2026-01-01T00:00:00.000Z");
});

test("loadState returns default when state file is missing", async () => {
  await withTempDir(async (dir) => {
    const state = await loadState(dir);

    assert.equal(state.stage, "idle");
    assert.equal(state.tasks.length, 0);
  });
});

test("saveState and loadState persist state", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState();
    state.stage = "planning";
    state.complexityLevel = 3;

    await saveState(dir, state);
    const loaded = await loadState(dir);

    assert.equal(loaded.stage, "planning");
    assert.equal(loaded.complexityLevel, 3);
  });
});

test("ensureState creates .scaler/state.json", async () => {
  await withTempDir(async (dir) => {
    const state = await ensureState(dir);
    const raw = await readFile(getStatePath(dir), "utf8");

    assert.equal(state.stage, "idle");
    assert.match(raw, /\"stage\": \"idle\"/);
  });
});

test("formatStateStatus returns compact status", () => {
  const state = createDefaultState();
  state.tasks = [{ id: "T-001", status: "validated", updatedAt: state.createdAt }];
  state.validatedTaskIds = ["T-001"];

  assert.equal(formatStateStatus(state), "SCALER stage=idle level=0 validated=1/1");
});

/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pauseScalerRun, resumeScalerRun, writeCheckpoint } from "../src/checkpoints.js";
import { createDefaultState, saveState } from "../src/state.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-checkpoint-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("writeCheckpoint writes checkpoint file", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    const result = await writeCheckpoint(dir, state, "task:T-001", "before validation", new Date("2026-01-01T00:00:01.000Z"));
    const raw = await readFile(result.path, "utf8");
    const checkpoint = JSON.parse(raw) as { scope: string; state: { runId: string }; budgetCheckpoint: { wallClockMs: number } };

    assert.equal(checkpoint.scope, "task:T-001");
    assert.equal(checkpoint.state.runId, state.runId);
    assert.equal(checkpoint.budgetCheckpoint.wallClockMs, 1_000);
  });
});

test("pauseScalerRun pauses and writes checkpoint", async () => {
  await withTempDir(async (dir) => {
    const active = { ...createDefaultState(), stage: "execution" as const };
    await saveState(dir, active);
    const result = await pauseScalerRun(dir, "test pause");

    assert.equal(result.state.stage, "paused");
    assert.equal(result.state.previousStage, "execution");
    assert.match(await readFile(result.checkpointPath, "utf8"), /test pause/);
  });
});

test("resumeScalerRun resumes only to previous active stage", async () => {
  await withTempDir(async (dir) => {
    const paused = { ...createDefaultState(), stage: "paused" as const, previousStage: "planning" as const };
    await saveState(dir, paused);
    const result = await resumeScalerRun(dir, "test resume");

    assert.equal(result.state.stage, "planning");
    assert.equal(result.state.previousStage, null);
    assert.match(result.message, /planning/);
  });
});

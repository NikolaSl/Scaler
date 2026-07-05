/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  applyBudgetUsageUpdates,
  formatBudgetStatus,
  getBudgetState,
  incrementBudgetUsage,
  persistBudgetDecision,
  recordBudgetCheckpoint,
  recordStorageBudgetUsage,
  scanScalerStorageBytes,
  setBudgetLimits,
} from "../src/budgets.js";
import { readLogEvents } from "../src/logging.js";
import { createDefaultState, loadState } from "../src/state.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-budget-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("incrementBudgetUsage increments usage under limit", () => {
  const state = setBudgetLimits(createDefaultState(new Date("2026-01-01T00:00:00.000Z")), {
    toolCalls: { soft: 3, hard: 5 },
  });
  const result = incrementBudgetUsage(state, "toolCalls", 2, new Date("2026-01-01T00:00:01.000Z"));
  const budgets = getBudgetState(result.state);

  assert.equal(budgets.usage.toolCalls, 2);
  assert.equal(result.decision.status, "ok");
});

test("persistBudgetDecision logs soft-limit decisions", async () => {
  await withTempDir(async (dir) => {
    const limited = setBudgetLimits(createDefaultState(), { debugAttempts: { soft: 1, hard: 3 } });
    const { state, decision } = incrementBudgetUsage(limited, "debugAttempts");
    await persistBudgetDecision(dir, state, decision);
    const events = await readLogEvents(dir);

    assert.equal(decision.status, "soft_limit");
    assert.equal(events.at(-1)?.eventType, "budget");
    assert.match(events.at(-1)?.summary ?? "", /soft limit/);
  });
});

test("persistBudgetDecision pauses valid active stage on hard-limit decisions", async () => {
  await withTempDir(async (dir) => {
    const initial = { ...createDefaultState(), stage: "execution" as const };
    const limited = setBudgetLimits(initial, { spawnedAgents: { hard: 1 } });
    const { state, decision } = incrementBudgetUsage(limited, "spawnedAgents");
    const persisted = await persistBudgetDecision(dir, state, decision);
    const loaded = await loadState(dir);

    assert.equal(decision.status, "hard_limit");
    assert.equal(persisted.stage, "paused");
    assert.equal(loaded.stage, "paused");
    assert.equal(loaded.previousStage, "execution");
  });
});

test("recordBudgetCheckpoint records wall-clock usage", () => {
  const initial = setBudgetLimits(createDefaultState(new Date("2026-01-01T00:00:00.000Z")), {
    wallClockMs: { soft: 500, hard: 2_000 },
  }, new Date("2026-01-01T00:00:00.000Z"));
  const { state, decision, checkpoint } = recordBudgetCheckpoint(
    initial,
    "task:T-001",
    "before validation",
    new Date("2026-01-01T00:00:01.000Z"),
  );
  const budgets = getBudgetState(state);

  assert.equal(checkpoint.wallClockMs, 1_000);
  assert.equal(budgets.usage.wallClockMs, 1_000);
  assert.equal(budgets.usage.checkpoints, 1);
  assert.equal(decision.status, "soft_limit");
});

test("applyBudgetUsageUpdates supports set and increment with strongest decision", () => {
  const initial = setBudgetLimits(createDefaultState(new Date("2026-01-01T00:00:00.000Z")), {
    contextTokens: { soft: 100, hard: 200 },
    validationLoops: { hard: 2 },
  });
  const result = applyBudgetUsageUpdates(initial, [
    { key: "contextTokens", amount: 150, mode: "set" },
    { key: "validationLoops", amount: 2, mode: "increment" },
  ], new Date("2026-01-01T00:00:01.000Z"));
  const budgets = getBudgetState(result.state);

  assert.equal(budgets.usage.contextTokens, 150);
  assert.equal(budgets.usage.validationLoops, 2);
  assert.equal(result.decisions.length, 2);
  assert.equal(result.decision.key, "validationLoops");
  assert.equal(result.decision.status, "hard_limit");
});

test("formatBudgetStatus reports limits, usage, and strongest decision", () => {
  const limited = setBudgetLimits(createDefaultState(new Date("2026-01-01T00:00:00.000Z")), {
    validationLoops: { soft: 1, hard: 2 },
    estimatedCostMicros: { hard: 10_000 },
  }, new Date("2026-01-01T00:00:00.000Z"));
  const { state } = applyBudgetUsageUpdates(limited, [
    { key: "validationLoops", amount: 2, mode: "set" },
  ], new Date("2026-01-01T00:00:01.000Z"));

  const message = formatBudgetStatus(state, new Date("2026-01-01T00:00:02.000Z"));

  assert.match(message, /Budgets: strongest=hard_limit key=validationLoops action=pause/);
  assert.match(message, /- validationLoops: usage=2 soft=1 hard=2 status=hard_limit/);
  assert.match(message, /- estimatedCostMicros: usage=0 soft=- hard=10000 status=ok/);
});

test("recordStorageBudgetUsage scans .scaler bytes and evaluates limits", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, ".scaler", "memory"), { recursive: true });
    await writeFile(join(dir, ".scaler", "memory", "one.txt"), "12345", "utf8");
    await writeFile(join(dir, ".scaler", "two.txt"), "123", "utf8");
    const limited = setBudgetLimits(createDefaultState(new Date("2026-01-01T00:00:00.000Z")), {
      storageBytes: { soft: 5, hard: 8 },
    });

    const result = await recordStorageBudgetUsage(dir, limited, new Date("2026-01-01T00:00:01.000Z"));

    assert.equal(await scanScalerStorageBytes(dir), 8);
    assert.equal(result.storageBytes, 8);
    assert.equal(getBudgetState(result.state).usage.storageBytes, 8);
    assert.equal(result.decision.status, "hard_limit");
  });
});

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
import { readLogEvents } from "../src/logging.js";
import {
  extractProviderUsage,
  providerUsageToBudgetUpdates,
  recordProviderUsageBudget,
} from "../src/provider-usage.js";
import { createDefaultState } from "../src/state.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-provider-usage-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("extractProviderUsage reads Pi assistant message usage from turn events", () => {
  const usage = extractProviderUsage([
    {
      type: "turn_end",
      message: {
        role: "assistant",
        usage: {
          input: 100,
          output: 20,
          cacheRead: 5,
          cacheWrite: 3,
          reasoning: 7,
          totalTokens: 128,
          cost: { input: 0.0001, output: 0.0002, cacheRead: 0.00001, cacheWrite: 0.00003, total: 0.00034 },
        },
      },
    },
  ]);

  assert.equal(usage?.inputTokens, 100);
  assert.equal(usage?.outputTokens, 20);
  assert.equal(usage?.cacheReadTokens, 5);
  assert.equal(usage?.cacheWriteTokens, 3);
  assert.equal(usage?.reasoningTokens, 7);
  assert.equal(usage?.totalTokens, 128);
  assert.equal(usage?.costMicros, 340);
});

test("extractProviderUsage prefers final agent_end aggregate over duplicate turn events", () => {
  const usage = extractProviderUsage([
    { type: "turn_end", message: { role: "assistant", usage: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 12, cost: { total: 0.000012 } } } },
    {
      type: "agent_end",
      messages: [
        { role: "user", content: "ignored" },
        { role: "assistant", usage: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 12, cost: { total: 0.000012 } } },
        { role: "assistant", usage: { input: 20, output: 3, cacheRead: 4, cacheWrite: 0, totalTokens: 27, cost: { total: 0.000027 } } },
      ],
    },
  ]);

  assert.equal(usage?.totalTokens, 39);
  assert.equal(usage?.inputTokens, 30);
  assert.equal(usage?.outputTokens, 5);
  assert.equal(usage?.cacheReadTokens, 4);
  assert.equal(usage?.costMicros, 39);
});

test("providerUsageToBudgetUpdates maps native tokens and cost to budget counters", () => {
  const updates = providerUsageToBudgetUpdates({ inputTokens: 4, outputTokens: 6, costMicros: 12, sources: ["test"] });

  assert.deepEqual(updates, [
    { key: "contextTokens", amount: 10, mode: "increment" },
    { key: "estimatedCostMicros", amount: 12, mode: "increment" },
  ]);
});

test("recordProviderUsageBudget persists budget counters and audit log", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState();
    const result = await recordProviderUsageBudget(dir, state, {
      inputTokens: 30,
      outputTokens: 10,
      totalTokens: 40,
      costMicros: 25,
      sources: ["unit"],
    }, {
      source: "unit-test",
      taskId: "T-usage",
      agentId: "agent-usage",
      agentType: "task",
    });

    assert.equal(result.applied, true);
    const budgets = getBudgetState(result.state);
    assert.equal(budgets.usage.contextTokens, 40);
    assert.equal(budgets.usage.estimatedCostMicros, 25);

    const events = await readLogEvents(dir);
    const event = events.find((candidate) => candidate.eventType === "budget" && candidate.summary.includes("Provider usage recorded"));
    assert.ok(event, "expected provider usage budget event");
    assert.equal(event.taskId, "T-usage");
    assert.deepEqual(event.usage, { inputTokens: 30, outputTokens: 10, cost: 0.000025 });
  });
});

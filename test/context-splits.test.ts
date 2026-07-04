import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { assessCompression } from "../src/compression.js";
import { buildContextSplitRecord, formatContextSplitRecords, loadContextSplitRecords, recordContextSplitIfNeeded } from "../src/context-splits.js";
import type { ResolvedContext } from "../src/context.js";
import { createDefaultState } from "../src/state.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-context-splits-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function oversizedContext(): ResolvedContext {
  return {
    text: "x".repeat(320),
    estimatedTokens: 80,
    included: [
      { id: "exact-large", type: "file", reason: "Required", content: "x".repeat(240), priority: "required", scope: "full", exactness: "exact" },
      { id: "summary", type: "memory", reason: "Useful", content: "summary", priority: "useful", scope: "summary", exactness: "summary-ok" },
      { id: "ref", type: "prd", reason: "Ref", content: "REQ-1", priority: "useful", scope: "reference-only", exactness: "reference-only" },
    ],
    omitted: [],
  };
}

test("buildContextSplitRecord captures oversized context split recommendations", () => {
  const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
  const resolved = oversizedContext();
  const assessment = assessCompression({ items: resolved.included, estimatedTokens: resolved.estimatedTokens, contextWindowTokens: 100, largeItemThresholdTokens: 10 });

  const record = buildContextSplitRecord(state, "T-SPLIT", resolved, assessment, new Date("2026-01-01T00:00:01.000Z"));

  assert.equal(record.taskId, "T-SPLIT");
  assert.equal(record.overByTokens, 5);
  assert.deepEqual(record.externalizeRefs, ["exact-large"]);
  assert.ok(record.minimalContextItemIds.includes("exact-large"));
  assert.ok(record.minimalContextItemIds.includes("ref"));
});

test("recordContextSplitIfNeeded persists only when split is recommended", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState();
    const resolved = oversizedContext();
    const assessment = assessCompression({ items: resolved.included, estimatedTokens: resolved.estimatedTokens, contextWindowTokens: 100, largeItemThresholdTokens: 10 });
    const okAssessment = assessCompression({ items: [], estimatedTokens: 1, contextWindowTokens: 100 });

    assert.equal(await recordContextSplitIfNeeded(dir, state, "T-SPLIT", resolved, okAssessment), undefined);
    const record = await recordContextSplitIfNeeded(dir, state, "T-SPLIT", resolved, assessment, new Date("2026-01-01T00:00:02.000Z"));

    const records = await loadContextSplitRecords(dir);
    assert.equal(records[0]?.id, record?.id);
    assert.match(formatContextSplitRecords(records, "T-SPLIT"), /Context split records for T-SPLIT/);
  });
});

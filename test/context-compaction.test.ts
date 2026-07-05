import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { assessCompression } from "../src/compression.js";
import {
  buildScalerCompactionInstructions,
  buildScalerCompactionResult,
  formatFreshContextHandoffs,
  formatScalerCompactionRecords,
  loadFreshContextHandoffRecords,
  loadScalerCompactionRecords,
  prepareFreshContextHandoff,
  shouldTriggerScalerCompaction,
} from "../src/context-compaction.js";
import { loadContextSplitRecords, recordContextSplitIfNeeded } from "../src/context-splits.js";
import type { ResolvedContext } from "../src/context.js";
import { loadMemoryIndex } from "../src/memory.js";
import { createDefaultState } from "../src/state.js";
import type { ScalerState } from "../src/types.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-context-compaction-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function stateWithTask(): ScalerState {
  const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
  return {
    ...state,
    stage: "execution",
    currentTaskId: "T-COMPACT",
    tasks: [
      {
        id: "T-COMPACT",
        status: "ready",
        title: "Implement compact behavior",
        allowedPathPrefixes: ["src/", "test/"],
        prdRefs: ["PRD-P02"],
        definitionOfDone: ["externalized refs exist", "fresh handoff shrinks context"],
        updatedAt: state.updatedAt,
      },
    ],
  };
}

function oversizedResolvedContext(): ResolvedContext {
  return {
    text: "x".repeat(1_600),
    estimatedTokens: 900,
    included: [
      { id: "state-summary", type: "decision", reason: "Required state", content: "stage=execution task=T-COMPACT", priority: "required", scope: "summary", exactness: "exact" },
      { id: "exact-large", type: "file", reason: "Exact contract", content: "EXACT-CONTRACT\n".repeat(120), priority: "required", scope: "full", exactness: "exact", estimatedTokens: 420 },
      { id: "summary-large", type: "knowledge", reason: "Large research", content: "research finding ".repeat(140), priority: "useful", scope: "summary", exactness: "summary-ok", estimatedTokens: 260 },
      { id: "ref-only", type: "prd", reason: "Requirement ref", content: "PRD-P02", priority: "useful", scope: "reference-only", exactness: "reference-only" },
    ],
    omitted: [],
  };
}

test("context splits externalize oversized exact and summary-ok items into memory", async () => {
  await withTempDir(async (dir) => {
    const state = stateWithTask();
    const resolved = oversizedResolvedContext();
    const assessment = assessCompression({ items: resolved.included, estimatedTokens: resolved.estimatedTokens, contextWindowTokens: 300, largeItemThresholdTokens: 100 });

    const split = await recordContextSplitIfNeeded(dir, state, "T-COMPACT", resolved, assessment, new Date("2026-01-01T00:00:01.000Z"));

    assert.ok(split);
    assert.deepEqual(split.externalizeRefs.sort(), ["exact-large", "summary-large"]);
    assert.equal(split.externalizedMemoryRefs.length, 2);
    assert.ok(split.externalizedMemoryRefs.every((ref) => ref.sha256.length === 64));

    const memory = await loadMemoryIndex(dir);
    assert.equal(memory.entries.length, 2);
    assert.match(memory.entries[0]?.source ?? "", /^context-split:/);

    const persisted = await loadContextSplitRecords(dir);
    assert.equal(persisted[0]?.externalizedMemoryRefs.length, 2);
  });
});

test("SCALER compaction hook result preserves state and records shrink evidence", async () => {
  await withTempDir(async (dir) => {
    const state = stateWithTask();
    const result = await buildScalerCompactionResult(
      dir,
      state,
      {
        firstKeptEntryId: "entry-42",
        tokensBefore: 10_000,
        previousSummary: "old generic summary",
        messagesToSummarize: [{ role: "user", content: "Please continue implementing GAP-026 without losing validated progress." }],
        fileOps: { readFiles: ["src/context.ts"], modifiedFiles: ["src/context-compaction.ts"] },
      },
      { reason: "threshold", willRetry: false, now: new Date("2026-01-01T00:00:02.000Z") },
    );

    assert.equal(result.firstKeptEntryId, "entry-42");
    assert.match(result.summary, /SCALER-Aware Compaction Summary/);
    assert.match(result.summary, /currentTaskId: T-COMPACT/);
    assert.equal(result.details?.shrinkTargetPassed, true);
    assert.ok((result.estimatedTokensAfter ?? 0) <= (result.details?.activeContextLimitTokens ?? 0));

    const records = await loadScalerCompactionRecords(dir);
    assert.equal(records.length, 1);
    assert.match(formatScalerCompactionRecords(records), /COMPACT-/);
    assert.match(await readFile(join(dir, records[0]!.summaryPath), "utf8"), /Exact next action/);
  });
});

test("fresh context handoff builds minimal prompt below split target", async () => {
  await withTempDir(async (dir) => {
    const state = stateWithTask();
    const resolved = oversizedResolvedContext();
    const assessment = assessCompression({ items: resolved.included, estimatedTokens: resolved.estimatedTokens, contextWindowTokens: 1_000, largeItemThresholdTokens: 100 });
    const split = await recordContextSplitIfNeeded(dir, state, "T-COMPACT", resolved, assessment, new Date("2026-01-01T00:00:03.000Z"));

    const result = await prepareFreshContextHandoff(dir, state, { splitId: split!.id, now: new Date("2026-01-01T00:00:04.000Z") });

    assert.equal(result.accepted, true);
    assert.equal(result.record.status, "prepared");
    assert.equal(result.record.shrinkTargetPassed, true);
    assert.ok(result.record.estimatedTokens < result.record.previousEstimatedTokens);
    assert.match(result.prompt, /Fresh Minimal-Context Continuation/);
    assert.match(result.prompt, /Externalized exact\/summary refs/);
    assert.ok(result.record.invocation?.args.includes("--no-tools"));

    const records = await loadFreshContextHandoffRecords(dir);
    assert.equal(records[0]?.id, result.record.id);
    assert.match(formatFreshContextHandoffs(records), /Fresh context handoffs/);
  });
});

test("automatic compaction trigger uses SCALER target ratio", () => {
  const state = stateWithTask();
  const decision = shouldTriggerScalerCompaction({ tokens: 7_700, contextWindow: 10_000, percent: 77 });
  assert.equal(decision.trigger, true);
  assert.match(decision.reason, /exceeds SCALER target/);
  assert.match(buildScalerCompactionInstructions(state, decision), /SCALER-aware compaction/);

  const ok = shouldTriggerScalerCompaction({ tokens: 7_000, contextWindow: 10_000, percent: 70 });
  assert.equal(ok.trigger, false);
});

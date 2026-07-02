import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  createDefaultTaskContextManifest,
  ensureTaskContextManifest,
  estimateTokens,
  formatOmittedContextSummary,
  formatTaskContextManifest,
  loadTaskContextManifest,
  resolveContext,
  saveTaskContextManifest,
  validateTaskContextManifest,
} from "../src/context.js";
import { createDefaultState } from "../src/state.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-context-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("estimateTokens returns rough character based estimate", () => {
  assert.equal(estimateTokens("12345678"), 2);
});

test("resolveContext includes required items even over budget", () => {
  const state = createDefaultState();
  const result = resolveContext({
    state,
    tokenBudget: 1,
    items: [
      {
        id: "REQ-1",
        type: "prd",
        reason: "Needed for task",
        content: "Important requirement",
        priority: "required",
        scope: "summary",
        estimatedTokens: 100,
      },
    ],
  });

  assert.equal(result.included.length, 1);
  assert.equal(result.omitted.length, 0);
  assert.match(result.text, /Important requirement/);
});

test("resolveContext omits optional items over budget", () => {
  const state = createDefaultState();
  const result = resolveContext({
    state,
    tokenBudget: 20,
    items: [
      {
        id: "REQ-1",
        type: "prd",
        reason: "Required",
        content: "Required item",
        priority: "required",
        scope: "summary",
        estimatedTokens: 1,
      },
      {
        id: "OPT-1",
        type: "memory",
        reason: "Optional",
        content: "Optional item",
        priority: "optional",
        scope: "summary",
        estimatedTokens: 1_000,
      },
    ],
  });

  assert.deepEqual(result.included.map((item) => item.id), ["REQ-1"]);
  assert.deepEqual(result.omitted.map((item) => item.id), ["OPT-1"]);
  assert.match(result.text, /## Omitted Context/);
  assert.match(result.text, /OPT-1: Optional/);
});

test("resolveContext omits omitted section when nothing was omitted", () => {
  const state = createDefaultState();
  const result = resolveContext({
    state,
    items: [{ id: "REQ-1", type: "prd", reason: "Required", content: "Required item", priority: "required", scope: "summary" }],
  });

  assert.doesNotMatch(result.text, /## Omitted Context/);
});

test("formatOmittedContextSummary renders ids and reasons", () => {
  const summary = formatOmittedContextSummary([
    { id: "OPT-1", type: "memory", reason: "Too large", content: "x", priority: "optional", scope: "summary" },
  ]);

  assert.match(summary, /OPT-1: Too large \(memory, optional, summary\)/);
});

test("resolveContext orders by priority", () => {
  const state = createDefaultState();
  const result = resolveContext({
    state,
    items: [
      { id: "O", type: "memory", reason: "o", content: "optional", priority: "optional", scope: "summary" },
      { id: "R", type: "prd", reason: "r", content: "required", priority: "required", scope: "summary" },
      { id: "U", type: "knowledge", reason: "u", content: "useful", priority: "useful", scope: "summary" },
    ],
  });

  assert.deepEqual(result.included.map((item) => item.id), ["R", "U", "O"]);
});

test("createDefaultTaskContextManifest includes state, task, validation, prd refs, and memory refs", () => {
  const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
  state.memoryRefs = ["mem-1"];
  state.tasks = [{ id: "T-001", status: "ready", prdRefs: ["REQ-001"], updatedAt: state.createdAt }];

  const manifest = createDefaultTaskContextManifest(state, "T-001", new Date("2026-01-01T00:00:01.000Z"));

  assert.equal(manifest.taskId, "T-001");
  assert.deepEqual(manifest.items.map((item) => item.id), ["state-summary", "task-metadata", "validation-manifest", "runtime-prd-refs", "memory-mem-1"]);
  assert.match(formatTaskContextManifest(manifest), /Task context manifest: T-001 items=5/);
});

test("saveTaskContextManifest and loadTaskContextManifest round trip normalized manifest", async () => {
  await withTempDir(async (dir) => {
    const saved = await saveTaskContextManifest(dir, {
      version: 1,
      taskId: "T-001",
      items: [
        { id: " file ", type: "file", reason: " Need file ", priority: "required", scope: "full", source: "file", path: " README.md " },
      ],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }, new Date("2026-01-01T00:00:01.000Z"));

    const loaded = await loadTaskContextManifest(dir, "T-001");
    assert.equal(saved.items[0]?.id, "file");
    assert.equal(saved.items[0]?.reason, "Need file");
    assert.equal(saved.items[0]?.path, "README.md");
    assert.equal(loaded?.items[0]?.id, saved.items[0]?.id);
    assert.equal(loaded?.items[0]?.reason, saved.items[0]?.reason);
    assert.equal(loaded?.items[0]?.path, saved.items[0]?.path);
  });
});

test("ensureTaskContextManifest creates default manifest when missing", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState();
    state.tasks = [{ id: "T-001", status: "ready", updatedAt: state.createdAt }];

    const manifest = await ensureTaskContextManifest(dir, state, "T-001");
    assert.equal(manifest.taskId, "T-001");
    assert.equal((await loadTaskContextManifest(dir, "T-001"))?.taskId, "T-001");
  });
});

test("validateTaskContextManifest rejects invalid and incomplete items", () => {
  const base = {
    version: 1 as const,
    taskId: "T-001",
    items: [{ id: "file", type: "file" as const, reason: "Need file", priority: "required" as const, scope: "full" as const, source: "file" as const, path: "README.md" }],
    createdAt: "now",
    updatedAt: "now",
  };

  assert.throws(() => validateTaskContextManifest({ ...base, version: 2 as never }), /Unsupported task context manifest version/);
  assert.throws(() => validateTaskContextManifest({ ...base, items: [{ ...base.items[0]!, path: undefined }] }), /file path is required/);
  assert.throws(() => validateTaskContextManifest({ ...base, items: [base.items[0]!, base.items[0]!] }), /Duplicate task context item id/);
});

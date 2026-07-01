import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadMemoryIndex, retrieveMemory, writeMemory } from "../src/memory.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-memory-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("loadMemoryIndex returns empty index when missing", async () => {
  await withTempDir(async (dir) => {
    const index = await loadMemoryIndex(dir);
    assert.deepEqual(index, { version: 1, entries: [] });
  });
});

test("writeMemory stores file and index entry", async () => {
  await withTempDir(async (dir) => {
    const entry = await writeMemory(dir, {
      title: "Auth API notes",
      content: "Use token refresh endpoint.",
      taskId: "T-001",
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    const index = await loadMemoryIndex(dir);

    assert.equal(index.entries.length, 1);
    assert.equal(index.entries[0]?.id, entry.id);
    assert.equal(entry.taskId, "T-001");
    assert.equal(entry.validity, "active");
    assert.match(entry.path, /^\.scaler\/memory\/auth-api-notes-/);
  });
});

test("retrieveMemory reads memory by id", async () => {
  await withTempDir(async (dir) => {
    const entry = await writeMemory(dir, { title: "Build logs", content: "Important details" });
    const retrieved = await retrieveMemory(dir, entry.id);

    assert.equal(retrieved.entry.id, entry.id);
    assert.match(retrieved.content, /Important details/);
  });
});

test("retrieveMemory throws for missing memory", async () => {
  await withTempDir(async (dir) => {
    await assert.rejects(() => retrieveMemory(dir, "missing"), /Memory not found/);
  });
});

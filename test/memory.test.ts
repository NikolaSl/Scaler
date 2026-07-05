/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { formatMemorySearchResults, retrieveMemory, searchMemory, searchMemoryEntries, loadMemoryIndex, writeMemory } from "../src/memory.js";

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
    assert.deepEqual(entry.tags, []);
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

test("retrieveMemory supports summary and section scopes", async () => {
  await withTempDir(async (dir) => {
    const entry = await writeMemory(dir, {
      title: "API notes",
      content: "Intro\n\n## Auth\nUse bearer tokens.\n\n## Billing\nUse invoices.",
      summary: "API notes summary",
      tags: ["API", "auth"],
    });

    const summary = await retrieveMemory(dir, entry.id, { scope: "summary" });
    const section = await retrieveMemory(dir, entry.id, { scope: "section:Auth" });

    assert.match(summary.content, /summary=/);
    assert.doesNotMatch(summary.content, /Use bearer tokens/);
    assert.equal(section.content, "## Auth\nUse bearer tokens.");
  });
});

test("searchMemory filters by query tags task and validity", async () => {
  await withTempDir(async (dir) => {
    const auth = await writeMemory(dir, { title: "Auth API notes", content: "Refresh token details", taskId: "T-A", tags: ["api", "auth"] });
    await writeMemory(dir, { title: "Billing notes", content: "Invoice details", taskId: "T-B", tags: ["billing"], validity: "stale" });

    const results = await searchMemory(dir, { query: "refresh", tags: ["auth"], taskId: "T-A", validity: "active" });
    const direct = searchMemoryEntries((await loadMemoryIndex(dir)).entries, { tags: ["api"] });

    assert.equal(results[0]?.entry.id, auth.id);
    assert.ok(results[0]!.score > 0);
    assert.equal(direct.length, 1);
    assert.match(formatMemorySearchResults(results), /Auth API notes/);
  });
});

test("retrieveMemory throws for missing memory", async () => {
  await withTempDir(async (dir) => {
    await assert.rejects(() => retrieveMemory(dir, "missing"), /Memory not found/);
  });
});

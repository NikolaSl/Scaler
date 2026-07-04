import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  formatStorageInventory,
  loadStorageInventory,
  saveStorageInventory,
  scanScalerStorageInventory,
} from "../src/storage.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-storage-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("scanScalerStorageInventory returns empty inventory when .scaler is missing", async () => {
  await withTempDir(async (dir) => {
    const inventory = await scanScalerStorageInventory(dir, { now: new Date("2026-01-01T00:00:00.000Z") });

    assert.equal(inventory.totalBytes, 0);
    assert.equal(inventory.fileCount, 0);
    assert.deepEqual(inventory.topLevel, []);
    assert.equal(inventory.generatedAt, "2026-01-01T00:00:00.000Z");
  });
});

test("scanScalerStorageInventory summarizes top-level directories and largest files", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, ".scaler", "logs", "details"), { recursive: true });
    await mkdir(join(dir, ".scaler", "memory"), { recursive: true });
    await writeFile(join(dir, ".scaler", "state.json"), "1234", "utf8");
    await writeFile(join(dir, ".scaler", "logs", "events.jsonl"), "123456", "utf8");
    await writeFile(join(dir, ".scaler", "logs", "details", "one.json"), "1234567890", "utf8");
    await writeFile(join(dir, ".scaler", "memory", "one.md"), "12345678", "utf8");
    await writeFile(join(dir, "project.txt"), "must not count", "utf8");

    const inventory = await scanScalerStorageInventory(dir, {
      largestFileLimit: 2,
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    assert.equal(inventory.totalBytes, 28);
    assert.equal(inventory.fileCount, 4);
    assert.equal(inventory.directoryCount, 3);
    assert.deepEqual(inventory.largestFiles.map((entry) => [entry.path, entry.sizeBytes]), [
      [".scaler/logs/details/one.json", 10],
      [".scaler/memory/one.md", 8],
    ]);
    assert.deepEqual(inventory.topLevel.map((entry) => [entry.path, entry.sizeBytes, entry.fileCount]), [
      [".scaler/logs", 16, 2],
      [".scaler/memory", 8, 1],
      [".scaler/root", 4, 1],
    ]);
  });
});

test("saveStorageInventory and loadStorageInventory round trip", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, ".scaler", "logs"), { recursive: true });
    await writeFile(join(dir, ".scaler", "logs", "events.jsonl"), "123", "utf8");
    const inventory = await scanScalerStorageInventory(dir, { now: new Date("2026-01-01T00:00:00.000Z") });

    await saveStorageInventory(dir, inventory);
    const loaded = await loadStorageInventory(dir);

    assert.deepEqual(loaded, inventory);
    assert.match(formatStorageInventory(inventory), /Storage: totalBytes=3 files=1 dirs=1/);
    assert.match(formatStorageInventory(inventory), /\.scaler\/logs/);
  });
});

import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  formatStorageInventory,
  formatStorageMaintenanceReport,
  loadStorageInventory,
  loadStorageMaintenanceReport,
  planStorageMaintenance,
  runStorageMaintenance,
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

test("planStorageMaintenance proposes compression and explicit cache deletion only inside .scaler", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, ".scaler", "logs", "details"), { recursive: true });
    await mkdir(join(dir, ".scaler", "memory"), { recursive: true });
    await mkdir(join(dir, ".scaler", "cache"), { recursive: true });
    await writeFile(join(dir, ".scaler", "logs", "events.jsonl"), "active log", "utf8");
    await writeFile(join(dir, ".scaler", "logs", "details", "old.json"), "old detail".repeat(3), "utf8");
    await writeFile(join(dir, ".scaler", "memory", "old.md.gz"), "already compressed", "utf8");
    await writeFile(join(dir, ".scaler", "cache", "old.tmp"), "cache", "utf8");
    await writeFile(join(dir, "outside.tmp"), "outside", "utf8");
    const old = new Date("2025-12-01T00:00:00.000Z");
    await utimes(join(dir, ".scaler", "logs", "details", "old.json"), old, old);
    await utimes(join(dir, ".scaler", "cache", "old.tmp"), old, old);

    const report = await planStorageMaintenance(dir, {
      compress: true,
      deleteCache: true,
      minAgeDays: 7,
      minSizeBytes: 1000,
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    assert.deepEqual(report.actions.map((action) => [action.type, action.path]), [
      ["compress", ".scaler/logs/details/old.json"],
      ["delete_cache", ".scaler/cache/old.tmp"],
    ]);
    assert.equal(report.summary.bytesEligible, "old detail".repeat(3).length + "cache".length);
    assert.doesNotMatch(formatStorageMaintenanceReport(report), /outside/);
    assert.doesNotMatch(formatStorageMaintenanceReport(report), /events\.jsonl/);
  });
});

test("planStorageMaintenance proposes active ledger rotation and free disk diagnostics", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, ".scaler", "logs"), { recursive: true });
    await mkdir(join(dir, ".scaler", "reports"), { recursive: true });
    await writeFile(join(dir, ".scaler", "logs", "events.jsonl"), "e".repeat(64), "utf8");
    await writeFile(join(dir, ".scaler", "reports", "validation-runs.json"), "v".repeat(64), "utf8");
    await writeFile(join(dir, ".scaler", "reports", "validation-manifests.json"), "m".repeat(64), "utf8");

    const report = await planStorageMaintenance(dir, {
      rotateActive: true,
      maxActiveBytes: 32,
      minAgeDays: 999,
      minSizeBytes: 1000,
      minFreeBytes: Number.MAX_SAFE_INTEGER,
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    assert.deepEqual(report.actions.map((action) => [action.type, action.path, action.status]), [
      ["rotate_active", ".scaler/logs/events.jsonl", "planned"],
      ["rotate_active", ".scaler/reports/validation-runs.json", "planned"],
      ["check_free_disk", ".scaler", "failed"],
    ]);
    assert.match(report.actions[0]?.targetPath ?? "", /^\.scaler\/storage\/archive\/logs\/events-20260101000000000\.jsonl$/);
    assert.equal(report.actions.some((action) => action.path === ".scaler/reports/validation-manifests.json"), false);
    assert.equal(report.disk?.status, "below_minimum");
    assert.match(formatStorageMaintenanceReport(report), /Disk: status=below_minimum/);
  });
});

test("runStorageMaintenance rotates active ledgers into archives and resets active files", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, ".scaler", "logs"), { recursive: true });
    await mkdir(join(dir, ".scaler", "reports"), { recursive: true });
    await writeFile(join(dir, ".scaler", "logs", "events.jsonl"), "old event\n", "utf8");
    await writeFile(join(dir, ".scaler", "reports", "validation-runs.json"), "[{\"id\":\"run-1\"}]\n", "utf8");

    const executed = await runStorageMaintenance(dir, {
      execute: true,
      compress: false,
      rotateActive: true,
      maxActiveBytes: 1,
      minFreeBytes: 1,
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    assert.equal(executed.executed, true);
    assert.equal(executed.summary.failed, 0);
    assert.equal(executed.actions.filter((action) => action.type === "rotate_active" && action.status === "completed").length, 2);
    assert.ok(executed.actions.some((action) => action.type === "check_free_disk" && action.status === "completed"));

    const eventRotation = executed.actions.find((action) => action.path === ".scaler/logs/events.jsonl");
    const runRotation = executed.actions.find((action) => action.path === ".scaler/reports/validation-runs.json");
    assert.equal(await readFile(join(dir, eventRotation?.targetPath ?? "missing"), "utf8"), "old event\n");
    assert.equal(await readFile(join(dir, runRotation?.targetPath ?? "missing"), "utf8"), "[{\"id\":\"run-1\"}]\n");
    assert.equal(await readFile(join(dir, ".scaler", "logs", "events.jsonl"), "utf8"), "");
    assert.equal(await readFile(join(dir, ".scaler", "reports", "validation-runs.json"), "utf8"), "[]\n");
  });
});

test("runStorageMaintenance compresses eligible files and deletes cache only when executed", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, ".scaler", "logs", "details"), { recursive: true });
    await mkdir(join(dir, ".scaler", "cache"), { recursive: true });
    await writeFile(join(dir, ".scaler", "logs", "details", "large.json"), "x".repeat(128), "utf8");
    await writeFile(join(dir, ".scaler", "cache", "large.tmp"), "y".repeat(32), "utf8");

    const dryRun = await runStorageMaintenance(dir, { compress: true, deleteCache: true, minAgeDays: 999, minSizeBytes: 1, now: new Date("2026-01-01T00:00:00.000Z") });
    assert.equal(dryRun.executed, false);
    assert.equal((await readFile(join(dir, ".scaler", "logs", "details", "large.json"), "utf8")).length, 128);
    assert.ok(await loadStorageMaintenanceReport(dir));

    const executed = await runStorageMaintenance(dir, { execute: true, compress: true, deleteCache: true, minAgeDays: 999, minSizeBytes: 1, now: new Date("2026-01-01T00:00:01.000Z") });
    assert.equal(executed.executed, true);
    assert.equal(executed.summary.completed, 2);
    await assert.rejects(access(join(dir, ".scaler", "logs", "details", "large.json")));
    await assert.rejects(access(join(dir, ".scaler", "cache", "large.tmp")));
    assert.ok((await stat(join(dir, ".scaler", "logs", "details", "large.json.gz"))).size > 0);
    assert.ok(await loadStorageInventory(dir));
  });
});

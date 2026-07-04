import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";
import { getBudgetState } from "../../../src/budgets.js";
import scalerExtension from "../../../src/index.js";
import { readLogEvents } from "../../../src/logging.js";
import { createDefaultState, loadState, saveState } from "../../../src/state.js";
import { loadStorageMaintenanceReport, loadStorageMaintenanceSchedule } from "../../../src/storage.js";

const execFileAsync = promisify(execFile);
const gunzipAsync = promisify(gunzip);

type CommandHandler = (args: string | undefined, ctx: { cwd: string; hasUI: boolean }) => Promise<void>;

async function withTempRepo<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-storage-maintenance-integration-test-"));
  try {
    await execFileAsync("git", ["init"], { cwd: dir });
    await execFileAsync("git", ["config", "user.email", "scaler-test@example.invalid"], { cwd: dir });
    await execFileAsync("git", ["config", "user.name", "Scaler Test"], { cwd: dir });
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "package.json"), JSON.stringify({ type: "module" }, null, 2));
    await writeFile(join(dir, "src/app.js"), "export const value = 1;\n");
    await execFileAsync("git", ["add", "package.json", "src/app.js"], { cwd: dir });
    await execFileAsync("git", ["commit", "-m", "initial fixture"], { cwd: dir });
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function registeredCommands(): Map<string, { handler: CommandHandler }> {
  const commands = new Map<string, { handler: CommandHandler }>();
  const fakePi = {
    on() {},
    registerTool() {},
    registerCommand(name: string, command: { handler: CommandHandler }) {
      commands.set(name, command);
    },
  };
  scalerExtension(fakePi as never);
  return commands;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

test("mock integration: storage maintenance rotates active ledgers and checks free disk", async () => {
  await withTempRepo(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    state.stage = "execution";
    await saveState(dir, state);

    await mkdir(join(dir, ".scaler", "logs"), { recursive: true });
    await mkdir(join(dir, ".scaler", "reports"), { recursive: true });
    const eventsPath = join(dir, ".scaler", "logs", "events.jsonl");
    const runsPath = join(dir, ".scaler", "reports", "validation-runs.json");
    await writeFile(eventsPath, "old active event\n", "utf8");
    await writeFile(runsPath, "[{\"id\":\"run-old\"}]\n", "utf8");

    const commands = registeredCommands();
    await commands.get("scaler-storage-maintain")?.handler("execute rotate-active no-compress max-active-bytes=1 min-free-bytes=1", { cwd: dir, hasUI: false });

    const maintenance = await loadStorageMaintenanceReport(dir);
    assert.ok(maintenance, "expected persisted maintenance report");
    assert.equal(maintenance.executed, true);
    assert.equal(maintenance.summary.failed, 0);
    assert.equal(maintenance.disk?.status, "ok");
    const eventRotation = maintenance.actions.find((action) => action.type === "rotate_active" && action.path === ".scaler/logs/events.jsonl");
    const runRotation = maintenance.actions.find((action) => action.type === "rotate_active" && action.path === ".scaler/reports/validation-runs.json");
    assert.equal(eventRotation?.status, "completed");
    assert.equal(runRotation?.status, "completed");
    assert.match(await readFile(join(dir, eventRotation?.targetPath ?? "missing"), "utf8"), /old active event/);
    assert.equal(await readFile(join(dir, runRotation?.targetPath ?? "missing"), "utf8"), "[{\"id\":\"run-old\"}]\n");
    assert.doesNotMatch(await readFile(eventsPath, "utf8"), /old active event/);
    assert.equal(await readFile(runsPath, "utf8"), "[]\n");
    assert.ok(Number(getBudgetState(await loadState(dir)).usage.storageBytes) > 0);
  });
});

test("mock integration: storage schedule command runs due dry-run maintenance", async () => {
  await withTempRepo(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    state.stage = "execution";
    await saveState(dir, state);

    await mkdir(join(dir, ".scaler", "logs"), { recursive: true });
    await writeFile(join(dir, ".scaler", "logs", "events.jsonl"), `${JSON.stringify({ eventType: "test", summary: "scheduled active event" })}\n`, "utf8");

    const commands = registeredCommands();
    await commands.get("scaler-storage-schedule")?.handler("enable run force execute=off interval-hours=1 compress=off rotate-active=on max-active-bytes=1", { cwd: dir, hasUI: false });

    const schedule = await loadStorageMaintenanceSchedule(dir);
    const maintenance = await loadStorageMaintenanceReport(dir);
    assert.equal(schedule.enabled, true);
    assert.equal(schedule.intervalHours, 1);
    assert.equal(schedule.execute, false);
    assert.ok(schedule.lastRunAt, "expected schedule run metadata");
    assert.ok(schedule.nextRunAt, "expected next due metadata");
    assert.ok(maintenance, "expected persisted scheduled maintenance report");
    assert.equal(maintenance.executed, false);
    assert.ok(maintenance.actions.some((action) => action.type === "rotate_active" && action.status === "planned"));
    assert.match(await readFile(join(dir, ".scaler", "logs", "events.jsonl"), "utf8"), /scheduled active event/);
    assert.ok(Number(getBudgetState(await loadState(dir)).usage.storageBytes) > 0);

    const events = await readLogEvents(dir);
    assert.ok(events.some((event) => event.eventType === "state" && event.summary === "Scaler storage schedule requested"));
  });
});

test("mock integration: storage maintenance deletes approved archive quota targets", async () => {
  await withTempRepo(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    state.stage = "execution";
    await saveState(dir, state);

    await mkdir(join(dir, ".scaler", "storage", "archive", "logs"), { recursive: true });
    const oldArchive = join(dir, ".scaler", "storage", "archive", "logs", "events-old.jsonl");
    const newArchive = join(dir, ".scaler", "storage", "archive", "logs", "events-new.jsonl");
    await writeFile(oldArchive, "o".repeat(5), "utf8");
    await writeFile(newArchive, "n".repeat(5), "utf8");
    await utimes(oldArchive, new Date("2025-12-01T00:00:00.000Z"), new Date("2025-12-01T00:00:00.000Z"));
    await utimes(newArchive, new Date("2025-12-31T00:00:00.000Z"), new Date("2025-12-31T00:00:00.000Z"));

    const commands = registeredCommands();
    await commands.get("scaler-storage-maintain")?.handler("execute no-compress delete-archives max-archive-bytes=6", { cwd: dir, hasUI: false });

    const maintenance = await loadStorageMaintenanceReport(dir);
    assert.ok(maintenance, "expected persisted maintenance report");
    assert.equal(maintenance.executed, true);
    assert.equal(maintenance.summary.failed, 0);
    const deletion = maintenance.actions.find((action) => action.type === "delete_archive");
    assert.equal(deletion?.path, ".scaler/storage/archive/logs/events-old.jsonl");
    assert.equal(deletion?.status, "completed");
    assert.equal(await exists(oldArchive), false);
    assert.equal(await readFile(newArchive, "utf8"), "n".repeat(5));
  });
});

test("mock integration: storage maintenance executes compression, explicit cache deletion, and audit persistence", async () => {
  await withTempRepo(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    state.stage = "execution";
    await saveState(dir, state);

    await mkdir(join(dir, ".scaler", "reports"), { recursive: true });
    await mkdir(join(dir, ".scaler", "cache"), { recursive: true });
    const reportPath = join(dir, ".scaler", "reports", "old-report.json");
    const cachePath = join(dir, ".scaler", "cache", "old-cache.bin");
    const outsidePath = join(dir, "outside-cache.bin");
    const reportContents = "r".repeat(4096);
    await writeFile(reportPath, reportContents, "utf8");
    await writeFile(cachePath, "c".repeat(4096), "utf8");
    await writeFile(outsidePath, "o".repeat(4096), "utf8");

    const commands = registeredCommands();
    await commands.get("scaler-storage-maintain")?.handler("execute delete-cache min-age-days=999 min-size=2048", { cwd: dir, hasUI: false });

    const maintenance = await loadStorageMaintenanceReport(dir);
    assert.ok(maintenance, "expected persisted maintenance report");
    assert.equal(maintenance.executed, true);
    assert.equal(maintenance.summary.failed, 0);
    assert.ok(maintenance.actions.some((action) => action.type === "compress" && action.path === ".scaler/reports/old-report.json" && action.status === "completed"));
    assert.ok(maintenance.actions.some((action) => action.type === "delete_cache" && action.path === ".scaler/cache/old-cache.bin" && action.status === "completed"));

    assert.equal(await exists(reportPath), false);
    assert.equal(await exists(`${reportPath}.gz`), true);
    assert.equal((await gunzipAsync(await readFile(`${reportPath}.gz`))).toString("utf8"), reportContents);
    assert.equal(await exists(cachePath), false);
    assert.equal(await readFile(outsidePath, "utf8"), "o".repeat(4096));

    const after = await loadState(dir);
    assert.ok(Number(getBudgetState(after).usage.storageBytes) > 0);

    const events = await readLogEvents(dir);
    assert.ok(events.some((event) => event.eventType === "state" && event.summary === "Scaler storage maintenance requested"));
    assert.ok(events.some((event) => event.eventType === "command" && (event.details as { command?: string }).command === "scaler-storage-maintain"));
  });
});

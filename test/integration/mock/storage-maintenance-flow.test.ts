import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";
import { getBudgetState } from "../../../src/budgets.js";
import scalerExtension from "../../../src/index.js";
import { readLogEvents } from "../../../src/logging.js";
import { createDefaultState, loadState, saveState } from "../../../src/state.js";
import { loadStorageMaintenanceReport } from "../../../src/storage.js";

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
    assert.ok(getBudgetState(after).usage.storageBytes > 0);

    const events = await readLogEvents(dir);
    assert.ok(events.some((event) => event.eventType === "state" && event.summary === "Scaler storage maintenance requested"));
    assert.ok(events.some((event) => event.eventType === "command" && (event.details as { command?: string }).command === "scaler-storage-maintain"));
  });
});

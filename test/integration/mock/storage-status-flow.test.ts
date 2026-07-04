import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { getBudgetState } from "../../../src/budgets.js";
import scalerExtension from "../../../src/index.js";
import { readLogEvents } from "../../../src/logging.js";
import { createDefaultState, loadState, saveState } from "../../../src/state.js";
import { loadStorageInventory } from "../../../src/storage.js";

const execFileAsync = promisify(execFile);

type CommandHandler = (args: string | undefined, ctx: { cwd: string; hasUI: boolean }) => Promise<void>;

async function withTempRepo<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-storage-status-integration-test-"));
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

test("mock integration: storage status writes inventory and pauses on hard storage budget", async () => {
  await withTempRepo(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    state.stage = "execution";
    await saveState(dir, state);
    await mkdir(join(dir, ".scaler", "memory"), { recursive: true });
    await writeFile(join(dir, ".scaler", "memory", "large.md"), "x".repeat(64), "utf8");

    const commands = registeredCommands();
    await commands.get("scaler-budget-set")?.handler("storageBytes | - | 1", { cwd: dir, hasUI: false });
    await commands.get("scaler-storage-status")?.handler(undefined, { cwd: dir, hasUI: false });

    const inventory = await loadStorageInventory(dir);
    const after = await loadState(dir);
    assert.ok(inventory, "expected persisted storage inventory");
    assert.ok(inventory.totalBytes > 1);
    assert.equal(after.stage, "paused");
    assert.equal(after.previousStage, "execution");
    assert.equal(getBudgetState(after).usage.storageBytes, inventory.totalBytes);

    const events = await readLogEvents(dir);
    assert.ok(events.some((event) => event.eventType === "budget" && /storageBytes hard limit/.test(event.summary)));
    assert.ok(events.some((event) => event.eventType === "state" && event.summary === "Scaler storage status requested"));
    assert.ok(events.some((event) => event.eventType === "command" && (event.details as { command?: string }).command === "scaler-storage-status"));
  });
});

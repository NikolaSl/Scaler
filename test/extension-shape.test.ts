import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { getBudgetState } from "../src/budgets.js";
import scalerExtension from "../src/index.js";
import { readLogEvents } from "../src/logging.js";
import { loadState } from "../src/state.js";
import { loadStorageInventory } from "../src/storage.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-extension-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("extension factory exports a function", () => {
  assert.equal(typeof scalerExtension, "function");
});

test("extension registers scaler commands", () => {
  const commands: string[] = [];
  const fakePi = {
    on() {},
    registerTool() {},
    registerCommand(name: string) {
      commands.push(name);
    },
  };

  scalerExtension(fakePi as never);

  assert.deepEqual(commands, [
    "scaler",
    "scaler-lock",
    "scaler-lock-clear",
    "scaler-runs",
    "scaler-tasks",
    "scaler-context-init",
    "scaler-context-status",
    "scaler-stage-status",
    "scaler-stage-validate",
    "scaler-stage-advance",
    "scaler-stage-step",
    "scaler-stage-loop",
    "scaler-stage-run",
    "scaler-stage-runs",
    "scaler-stage-record",
    "scaler-task-create",
    "scaler-task-update",
    "scaler-prd-status",
    "scaler-plan-status",
    "scaler-plan-apply",
    "scaler-replans",
    "scaler-replan-run",
    "scaler-replan-runs",
    "scaler-debug-run",
    "scaler-debug-loop",
    "scaler-debug-runs",
    "scaler-debug-reports",
    "scaler-research-run",
    "scaler-research-runs",
    "scaler-research-status",
    "scaler-research-request",
    "scaler-research-report",
    "scaler-replan-proposal-status",
    "scaler-replan-accept",
    "scaler-replan-request",
    "scaler-prd-link",
    "scaler-task-retry",
    "scaler-step",
    "scaler-validation-add",
    "scaler-commit",
    "scaler-validate-loop",
    "scaler-validate",
    "scaler-pause",
    "scaler-resume",
    "scaler-storage-status",
    "scaler-storage-maintain",
    "scaler-budget-status",
    "scaler-budget-set",
    "scaler-status",
  ]);
});

test("storage-status command persists inventory and storage budget usage", async () => {
  await withTempDir(async (dir) => {
    const commands = new Map<string, { handler: (args: string | undefined, ctx: { cwd: string; hasUI: boolean }) => Promise<void> }>();
    const fakePi = {
      on() {},
      registerTool() {},
      registerCommand(name: string, command: { handler: (args: string | undefined, ctx: { cwd: string; hasUI: boolean }) => Promise<void> }) {
        commands.set(name, command);
      },
    };

    scalerExtension(fakePi as never);
    await commands.get("scaler-storage-status")?.handler(undefined, { cwd: dir, hasUI: false });

    const inventory = await loadStorageInventory(dir);
    const state = await loadState(dir);
    assert.ok(inventory, "expected storage inventory index");
    assert.equal(getBudgetState(state).usage.storageBytes, inventory.totalBytes);
    const events = await readLogEvents(dir);
    assert.ok(events.some((event) => event.eventType === "state" && event.summary === "Scaler storage status requested"));
  });
});

test("budget-set command persists configured limits", async () => {
  await withTempDir(async (dir) => {
    const commands = new Map<string, { handler: (args: string | undefined, ctx: { cwd: string; hasUI: boolean }) => Promise<void> }>();
    const fakePi = {
      on() {},
      registerTool() {},
      registerCommand(name: string, command: { handler: (args: string | undefined, ctx: { cwd: string; hasUI: boolean }) => Promise<void> }) {
        commands.set(name, command);
      },
    };

    scalerExtension(fakePi as never);
    await commands.get("scaler-budget-set")?.handler("validationLoops | 1 | 2", { cwd: dir, hasUI: false });
    await commands.get("scaler-budget-status")?.handler(undefined, { cwd: dir, hasUI: false });

    const state = await loadState(dir);
    const budgets = getBudgetState(state);
    assert.deepEqual(budgets.limits.validationLoops, { soft: 1, hard: 2 });
    const events = await readLogEvents(dir);
    assert.ok(events.some((event) => event.eventType === "state" && event.summary === "Budget limit updated: validationLoops"));
    assert.ok(events.some((event) => event.eventType === "state" && event.summary === "Scaler budget status requested"));
  });
});

test("extension command handlers write command audit events", async () => {
  await withTempDir(async (dir) => {
    const commands = new Map<string, { handler: (args: string | undefined, ctx: { cwd: string; hasUI: boolean }) => Promise<void> }>();
    const fakePi = {
      on() {},
      registerTool() {},
      registerCommand(name: string, command: { handler: (args: string | undefined, ctx: { cwd: string; hasUI: boolean }) => Promise<void> }) {
        commands.set(name, command);
      },
    };

    scalerExtension(fakePi as never);
    await commands.get("scaler-lock")?.handler(undefined, { cwd: dir, hasUI: false });
    const events = await readLogEvents(dir);

    assert.deepEqual(events.filter((event) => event.eventType === "command").map((event) => (event.details as { phase: string }).phase), ["start", "end"]);
    assert.equal(events.filter((event) => event.eventType === "command").every((event) => Boolean(event.detailsPath)), true);
  });
});

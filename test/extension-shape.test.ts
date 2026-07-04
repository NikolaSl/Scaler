import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { getBudgetState } from "../src/budgets.js";
import scalerExtension from "../src/index.js";
import { readLogEvents } from "../src/logging.js";
import { loadState } from "../src/state.js";
import { loadStorageInventory, loadStorageMaintenanceSchedule, updateStorageMaintenanceSchedule } from "../src/storage.js";

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
    "scaler-debug-retry",
    "scaler-debug-retry-policy",
    "scaler-debug-retry-approve",
    "scaler-debug-retry-approvals",
    "scaler-debug-loop",
    "scaler-debug-runs",
    "scaler-debug-reports",
    "scaler-debug-retries",
    "scaler-tool-catalog",
    "scaler-tool-discover",
    "scaler-tool-discovery-runs",
    "scaler-tool-replay",
    "scaler-tool-run",
    "scaler-tool-transactions",
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
    "scaler-validation-checklist",
    "scaler-validation-add",
    "scaler-commit",
    "scaler-validate-loop",
    "scaler-validate",
    "scaler-validation-envs",
    "scaler-pause",
    "scaler-resume",
    "scaler-storage-status",
    "scaler-storage-maintain",
    "scaler-storage-schedule",
    "scaler-safety-policy",
    "scaler-safety-approval",
    "scaler-safety-scan",
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

test("extension turn_end hook records provider usage budgets", async () => {
  await withTempDir(async (dir) => {
    const handlers = new Map<string, (event: unknown, ctx: { cwd: string; hasUI: boolean }) => Promise<void>>();
    const fakePi = {
      on(name: string, handler: (event: unknown, ctx: { cwd: string; hasUI: boolean }) => Promise<void>) {
        handlers.set(name, handler);
      },
      registerTool() {},
      registerCommand() {},
    };

    scalerExtension(fakePi as never);
    await handlers.get("turn_end")?.({
      type: "turn_end",
      message: {
        role: "assistant",
        usage: { input: 50, output: 12, cacheRead: 0, cacheWrite: 0, totalTokens: 62, cost: { total: 0.000062 } },
      },
    }, { cwd: dir, hasUI: false });

    const state = await loadState(dir);
    const budgets = getBudgetState(state);
    assert.equal(budgets.usage.contextTokens, 62);
    assert.equal(budgets.usage.estimatedCostMicros, 62);
    const events = await readLogEvents(dir);
    assert.ok(events.some((event) => event.eventType === "budget" && event.summary.includes("Provider usage recorded")));
  });
});

test("extension session_start hook runs due scheduled storage maintenance", async () => {
  await withTempDir(async (dir) => {
    const handlers = new Map<string, (event: unknown, ctx: { cwd: string; hasUI: boolean }) => Promise<void>>();
    const fakePi = {
      on(name: string, handler: (event: unknown, ctx: { cwd: string; hasUI: boolean }) => Promise<void>) {
        handlers.set(name, handler);
      },
      registerTool() {},
      registerCommand() {},
    };

    scalerExtension(fakePi as never);
    await updateStorageMaintenanceSchedule(dir, { enabled: true, intervalHours: 1, execute: false }, new Date("2026-01-01T00:00:00.000Z"));
    await handlers.get("session_start")?.({ type: "session_start" }, { cwd: dir, hasUI: false });

    const schedule = await loadStorageMaintenanceSchedule(dir);
    const state = await loadState(dir);
    assert.ok(schedule.lastRunAt, "expected scheduled maintenance to run");
    assert.ok(schedule.nextRunAt, "expected next scheduled run time");
    assert.ok(Number(getBudgetState(state).usage.storageBytes) > 0);
    const events = await readLogEvents(dir);
    assert.ok(events.some((event) => event.eventType === "state" && event.summary === "Scaler scheduled storage maintenance checked"));
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

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { getBudgetState } from "../src/budgets.js";
import { saveTaskContextManifest } from "../src/context.js";
import { loadScalerCompactionRecords } from "../src/context-compaction.js";
import scalerExtension from "../src/index.js";
import { loadWatchdogHeartbeats } from "../src/watchdogs.js";
import { readLogEvents } from "../src/logging.js";
import { getLogToolsDir } from "../src/paths.js";
import { createDefaultState, loadState, saveState } from "../src/state.js";
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
    "scaler-adapt",
    "scaler-lock",
    "scaler-lock-clear",
    "scaler-runs",
    "scaler-task-reports",
    "scaler-task-quality",
    "scaler-tasks",
    "scaler-context-init",
    "scaler-context-status",
    "scaler-context-candidates",
    "scaler-context-approve",
    "scaler-context-splits",
    "scaler-compact",
    "scaler-compactions",
    "scaler-context-handoff",
    "scaler-context-handoffs",
    "scaler-memory-search",
    "scaler-missing-context",
    "scaler-missing-context-run",
    "scaler-missing-context-resolve",
    "scaler-stage-status",
    "scaler-stage-validate",
    "scaler-stage-advance",
    "scaler-stage-step",
    "scaler-stage-loop",
    "scaler-stage-workflow",
    "scaler-stage-workflow-runs",
    "scaler-stage-run",
    "scaler-stage-runs",
    "scaler-stage-record",
    "scaler-task-create",
    "scaler-task-update",
    "scaler-prd-status",
    "scaler-plan-status",
    "scaler-plan-apply",
    "scaler-planning-reports",
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
    "scaler-mcp-enumerate",
    "scaler-mcp-servers",
    "scaler-tool-discover",
    "scaler-tool-discovery-runs",
    "scaler-tool-replay",
    "scaler-tool-replay-approval",
    "scaler-tool-iteration-policy",
    "scaler-tool-iterate",
    "scaler-tool-iteration-runs",
    "scaler-tool-schedule",
    "scaler-tool-schedules",
    "scaler-tool-run",
    "scaler-tool-transactions",
    "scaler-research-run",
    "scaler-research-web",
    "scaler-research-transactions",
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
    "scaler-commits",
    "scaler-commit-skip",
    "scaler-commit-skips",
    "scaler-git-bootstrap",
    "scaler-validate-loop",
    "scaler-validate",
    "scaler-validation-envs",
    "scaler-cicd-env",
    "scaler-cicd-envs",
    "scaler-pause",
    "scaler-resume",
    "scaler-storage-status",
    "scaler-storage-maintain",
    "scaler-storage-schedule",
    "scaler-safety-policy",
    "scaler-safety-approval",
    "scaler-safety-scan",
    "scaler-watchdogs",
    "scaler-heartbeat",
    "scaler-watchdog-cleanup",
    "scaler-resume-check",
    "scaler-budget-policy",
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

test("extension session_before_compact hook returns SCALER-aware compaction", async () => {
  await withTempDir(async (dir) => {
    const handlers = new Map<string, (event: unknown, ctx: { cwd: string; hasUI: boolean }) => Promise<unknown>>();
    const fakePi = {
      on(name: string, handler: (event: unknown, ctx: { cwd: string; hasUI: boolean }) => Promise<unknown>) {
        handlers.set(name, handler);
      },
      registerTool() {},
      registerCommand() {},
    };

    scalerExtension(fakePi as never);
    const result = await handlers.get("session_before_compact")?.({
      type: "session_before_compact",
      preparation: {
        firstKeptEntryId: "entry-1",
        tokensBefore: 9_000,
        messagesToSummarize: [{ role: "user", content: "Keep SCALER state." }],
        turnPrefixMessages: [],
        fileOps: { read: new Set(["src/index.ts"]), written: new Set<string>(), edited: new Set<string>() },
      },
      reason: "threshold",
      willRetry: false,
    }, { cwd: dir, hasUI: false }) as { compaction?: { summary?: string } } | undefined;

    assert.match(result?.compaction?.summary ?? "", /SCALER-Aware Compaction Summary/);
    const records = await loadScalerCompactionRecords(dir);
    assert.equal(records.length, 1);
    assert.equal(records[0]?.reason, "threshold");
  });
});

test("extension context hook injects approved compact task manifest context", async () => {
  await withTempDir(async (dir) => {
    const handlers = new Map<string, (event: unknown, ctx: { cwd: string; hasUI: boolean }) => Promise<unknown>>();
    const fakePi = {
      on(name: string, handler: (event: unknown, ctx: { cwd: string; hasUI: boolean }) => Promise<unknown>) {
        handlers.set(name, handler);
      },
      registerTool() {},
      registerCommand() {},
    };

    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    state.currentTaskId = "T-HOOK";
    state.tasks = [{ id: "T-HOOK", status: "running", title: "Hook task", updatedAt: state.createdAt }];
    await saveState(dir, state);
    await saveTaskContextManifest(dir, {
      version: 1,
      taskId: "T-HOOK",
      items: [{ id: "approved", type: "decision", reason: "Approved", priority: "required", scope: "summary", source: "inline", content: "APPROVED HOOK CONTEXT" }],
      createdAt: state.createdAt,
      updatedAt: state.createdAt,
    });

    scalerExtension(fakePi as never);
    const result = await handlers.get("context")?.({ type: "context", messages: [{ role: "user", content: "hello" }] }, { cwd: dir, hasUI: false }) as { messages?: unknown[] } | undefined;

    assert.equal(result?.messages?.length, 2);
    assert.match(JSON.stringify(result?.messages?.[1]), /APPROVED HOOK CONTEXT/);
    const events = await readLogEvents(dir);
    assert.ok(events.some((event) => event.summary === "SCALER context hook injected approved manifest context"));
  });
});

test("extension turn_end hook records provider usage budgets and triggers compaction", async () => {
  await withTempDir(async (dir) => {
    const handlers = new Map<string, (event: unknown, ctx: { cwd: string; hasUI: boolean; getContextUsage?: () => { tokens: number | null; contextWindow: number; percent: number | null }; compact?: (options?: { customInstructions?: string }) => void }) => Promise<void>>();
    const fakePi = {
      on(name: string, handler: (event: unknown, ctx: { cwd: string; hasUI: boolean; getContextUsage?: () => { tokens: number | null; contextWindow: number; percent: number | null }; compact?: (options?: { customInstructions?: string }) => void }) => Promise<void>) {
        handlers.set(name, handler);
      },
      registerTool() {},
      registerCommand() {},
    };

    let compactInstructions = "";
    scalerExtension(fakePi as never);
    await handlers.get("turn_end")?.({
      type: "turn_end",
      message: {
        role: "assistant",
        usage: { input: 50, output: 12, cacheRead: 0, cacheWrite: 0, totalTokens: 62, cost: { total: 0.000062 } },
      },
    }, {
      cwd: dir,
      hasUI: false,
      getContextUsage: () => ({ tokens: 800, contextWindow: 1_000, percent: 80 }),
      compact: (options) => {
        compactInstructions = options?.customInstructions ?? "";
      },
    });

    const state = await loadState(dir);
    const budgets = getBudgetState(state);
    assert.equal(budgets.usage.contextTokens, 62);
    assert.equal(budgets.usage.estimatedCostMicros, 62);
    assert.match(compactInstructions, /SCALER-aware compaction/);
    assert.equal((await loadWatchdogHeartbeats(dir))[0]?.action, "turn_end");
    const events = await readLogEvents(dir);
    assert.ok(events.some((event) => event.eventType === "budget" && event.summary.includes("Provider usage recorded")));
    assert.ok(events.some((event) => event.eventType === "state" && event.summary === "SCALER automatic compaction requested"));
  });
});

test("extension tool_result hook externalizes large outputs and redacts secrets", async () => {
  await withTempDir(async (dir) => {
    const handlers = new Map<string, (event: unknown, ctx: { cwd: string; hasUI: boolean }) => Promise<unknown>>();
    const fakePi = {
      on(name: string, handler: (event: unknown, ctx: { cwd: string; hasUI: boolean }) => Promise<unknown>) {
        handlers.set(name, handler);
      },
      registerTool() {},
      registerCommand() {},
    };

    scalerExtension(fakePi as never);
    const result = await handlers.get("tool_result")?.({
      type: "tool_result",
      toolCallId: "call-large",
      toolName: "bash",
      input: { command: "echo ok" },
      content: [{ type: "text", text: `AWS_SECRET_ACCESS_KEY=secret ${"x".repeat(9000)}` }],
      details: { stdout: "secret" },
      isError: false,
    }, { cwd: dir, hasUI: false }) as { content?: Array<{ text: string }>; details?: { scalerToolResultReference?: { path: string } } } | undefined;

    const refPath = result?.details?.scalerToolResultReference?.path ?? "";
    assert.match(result?.content?.[0]?.text ?? "", /stored large tool result by reference/);
    assert.equal(refPath.startsWith(getLogToolsDir(dir)), true);
    assert.equal((await stat(refPath)).isFile(), true);
    assert.doesNotMatch(await readFile(refPath, "utf8"), /AWS_SECRET_ACCESS_KEY=secret/);
    const events = await readLogEvents(dir);
    assert.ok(events.some((event) => event.eventType === "tool" && event.summary === "Tool result externalized: bash"));
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

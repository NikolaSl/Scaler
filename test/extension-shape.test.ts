/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { getBudgetState } from "../src/budgets.js";
import { saveTaskContextManifest } from "../src/context.js";
import { loadScalerCompactionRecords } from "../src/context-compaction.js";
import scalerExtension from "../src/index.js";
import packagedScalerExtension from "../extensions/scaler/index.js";
import { loadWatchdogHeartbeats } from "../src/watchdogs.js";
import { readLogEvents } from "../src/logging.js";
import { loadExecutionLock } from "../src/locks.js";
import { getLogToolsDir } from "../src/paths.js";
import { loadPrdRequirements, upsertPrdRequirement } from "../src/prd.js";
import { createDefaultState, loadState, saveState } from "../src/state.js";
import { loadStorageInventory, loadStorageMaintenanceSchedule, updateStorageMaintenanceSchedule } from "../src/storage.js";
import { getValidationManifestForTask, saveValidationManifest } from "../src/validation.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-extension-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function buildHostSystemPrompt(options: unknown): Promise<string> {
  const packageEntry = import.meta.resolve("@earendil-works/pi-coding-agent");
  const moduleUrl = new URL("./core/system-prompt.js", packageEntry);
  const hostModule = await import(moduleUrl.href) as { buildSystemPrompt?: (input: unknown) => string };
  const builder = hostModule.buildSystemPrompt;
  assert.equal(typeof builder, "function");
  return builder!(options);
}

test("extension factory exports a function", () => {
  assert.equal(typeof scalerExtension, "function");
});

test("package manifest loads extension through scaler-named wrapper", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8")) as { pi?: { extensions?: string[] } };
  assert.deepEqual(packageJson.pi?.extensions, ["./extensions/scaler/index.ts"]);
  assert.equal(packagedScalerExtension, scalerExtension);
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
    "scaler-active-tools",
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
    "scaler-prd-amend",
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

test("extension context hook focuses parent tools and injects compact runtime catalog", async () => {
  await withTempDir(async (dir) => {
    const handlers = new Map<string, (event: unknown, ctx: Record<string, unknown>) => Promise<unknown>>();
    const fakePi = {
      on(name: string, handler: (event: unknown, ctx: Record<string, unknown>) => Promise<unknown>) {
        handlers.set(name, handler);
      },
      registerTool() {},
      registerCommand() {},
    };

    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    state.stage = "execution";
    state.currentTaskId = "T-TOOLS";
    state.tasks = [{ id: "T-TOOLS", status: "running", title: "Tool focus task", updatedAt: state.createdAt }];
    await saveState(dir, state);

    let activeTools = ["bash", "read", "scaler_tool_request", "scaler_task_report"];
    // Pi owns these methods on ExtensionAPI, not on the per-event context.
    Object.assign(fakePi, {
      getAllTools: () => [
        { name: "bash", description: "Run shell commands", parameters: { hidden: "SECRET_SCHEMA" }, promptGuidelines: "SECRET_GUIDELINES" },
        { name: "read", description: "Read files" },
        { name: "scaler_tool_request", description: "Request isolated tool work" },
        { name: "scaler_task_report", description: "Report task completion" },
      ],
      getActiveTools: () => activeTools,
      setActiveTools: (names: string[]) => { activeTools = names; },
    });
    const runtimeCtx = { cwd: dir, hasUI: false };

    scalerExtension(fakePi as never);
    const systemPromptOptions = { cwd: dir, customPrompt: "system", selectedTools: [...activeTools] };
    const systemPrompt = await buildHostSystemPrompt(systemPromptOptions);
    await handlers.get("before_agent_start")?.({ type: "before_agent_start", prompt: "hello", systemPrompt, systemPromptOptions }, runtimeCtx);
    const result = await handlers.get("context")?.({ type: "context", messages: [{ role: "user", content: "hello" }] }, runtimeCtx) as { messages?: unknown[] } | undefined;

    assert.deepEqual(activeTools, ["scaler_task_report", "scaler_tool_request"]);
    const injected = JSON.stringify(result?.messages?.[1]);
    assert.match(injected, /Parent tool catalog/);
    assert.match(injected, /scaler_tool_request/);
    assert.doesNotMatch(injected, /SECRET_SCHEMA/);
    assert.doesNotMatch(injected, /SECRET_GUIDELINES/);

    const focusEvent = (await readLogEvents(dir)).find((event) => event.summary === "SCALER parent tool focus applied");
    const focusDetails = focusEvent?.details as { lifecycle?: string; envelopeProfile?: { footprint?: string; byteSize?: number | null; fingerprint?: string | null; toolNames?: string[] } } | undefined;
    assert.equal(focusDetails?.lifecycle, "before_agent_start");
    assert.equal(focusDetails?.envelopeProfile?.footprint, "selected");
    assert.ok((focusDetails?.envelopeProfile?.byteSize ?? 0) > 0);
    assert.match(focusDetails?.envelopeProfile?.fingerprint ?? "", /^[a-f0-9]{64}$/);
    assert.deepEqual(focusDetails?.envelopeProfile?.toolNames, ["scaler_task_report", "scaler_tool_request"]);

    await handlers.get("turn_end")?.({ type: "turn_end", message: {}, toolResults: [] }, runtimeCtx);
    assert.deepEqual(activeTools, ["bash", "read", "scaler_tool_request", "scaler_task_report"]);
  });
});

test("extension child context preserves explicitly selected tools instead of parent focus", async () => {
  await withTempDir(async (dir) => {
    const handlers = new Map<string, (event: unknown, ctx: Record<string, unknown>) => Promise<unknown>>();
    let activeTools = ["read", "bash", "scaler_task_report"];
    const fakePi = {
      on(name: string, handler: (event: unknown, ctx: Record<string, unknown>) => Promise<unknown>) { handlers.set(name, handler); },
      registerTool() {}, registerCommand() {},
      getAllTools: () => [...activeTools, "scaler_tool_request"].map((name) => ({ name, description: name })),
      getActiveTools: () => activeTools,
      setActiveTools: (names: string[]) => { activeTools = names; },
    };
    const state = createDefaultState();
    state.stage = "execution";
    state.currentTaskId = "T-child";
    state.tasks = [{ id: "T-child", status: "running", updatedAt: state.createdAt }];
    await saveState(dir, state);
    const previous = process.env.SCALER_CHILD_AGENT;
    try {
      process.env.SCALER_CHILD_AGENT = "1";
      scalerExtension(fakePi as never);
      const result = await handlers.get("context")?.({ type: "context", messages: [] }, { cwd: dir, hasUI: false });
      assert.deepEqual(activeTools, ["read", "bash", "scaler_task_report"]);
      assert.doesNotMatch(JSON.stringify(result) ?? "", /Parent tool catalog/);
    } finally {
      if (previous === undefined) delete process.env.SCALER_CHILD_AGENT;
      else process.env.SCALER_CHILD_AGENT = previous;
    }
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

test("explicit PRD amendment command applies an exact revision under the execution lock", async () => {
  await withTempDir(async (dir) => {
    await upsertPrdRequirement(dir, { id: "REQ-COMMAND", statement: "Original wording" });
    const commands = new Map<string, { handler: (args: string | undefined, ctx: { cwd: string; hasUI: boolean }) => Promise<void> }>();
    const fakePi = {
      on() {},
      registerTool() {},
      registerCommand(name: string, command: { handler: (args: string | undefined, ctx: { cwd: string; hasUI: boolean }) => Promise<void> }) {
        commands.set(name, command);
      },
    };
    scalerExtension(fakePi as never);

    await commands.get("scaler-prd-amend")?.handler(
      'REQ-COMMAND | 1 | User clarified the output | {"statement":"Authorized wording"}',
      { cwd: dir, hasUI: false },
    );

    const requirement = (await loadPrdRequirements(dir)).requirements[0];
    assert.equal(requirement?.statement, "Authorized wording");
    assert.equal(requirement?.revision, 2);
    assert.equal(requirement?.versionHistory?.[1]?.authority.kind, "user_command");
    assert.equal(requirement?.versionHistory?.[1]?.authority.reason, "User clarified the output");
  });
});

test("PRD amendment command reports rejected input and releases its lock", async () => {
  await withTempDir(async (dir) => {
    await upsertPrdRequirement(dir, { id: "REQ-REJECTED", statement: "Original wording" });
    const commands = new Map<string, { handler: (args: string | undefined, ctx: unknown) => Promise<void> }>();
    const fakePi = {
      on() {},
      registerTool() {},
      registerCommand(name: string, command: { handler: (args: string | undefined, ctx: unknown) => Promise<void> }) {
        commands.set(name, command);
      },
    };
    const notifications: Array<{ message: string; level: string }> = [];
    scalerExtension(fakePi as never);
    const amend = commands.get("scaler-prd-amend");
    assert.ok(amend);
    const ctx = {
      cwd: dir,
      hasUI: true,
      ui: { notify: (message: string, level: string) => notifications.push({ message, level }) },
    };

    await assert.doesNotReject(() => amend.handler(
      'REQ-REJECTED | 1 | Reject unknown fields | {"unexpected":"Changed"}',
      ctx,
    ));
    assert.match(notifications.at(-1)?.message ?? "", /unknown.*field/i);
    assert.equal(notifications.at(-1)?.level, "warning");

    await assert.doesNotReject(() => amend.handler(
      'REQ-REJECTED | 2 | Reject stale revision | {"statement":"Changed"}',
      ctx,
    ));
    assert.match(notifications.at(-1)?.message ?? "", /stale.*revision/i);
    assert.equal(notifications.at(-1)?.level, "warning");
    assert.equal((await loadPrdRequirements(dir)).requirements[0]?.statement, "Original wording");
    assert.equal(await loadExecutionLock(dir), undefined);
  });
});

test("validation-add reports a rejected policy amendment without escaping the command handler", async () => {
  await withTempDir(async (dir) => {
    await saveValidationManifest(dir, {
      taskId: "T-COMMAND-POLICY",
      commands: [{ id: "unit", command: "node -e \"process.exit(1)\"", required: true }],
      createdAt: "",
      updatedAt: "",
    });
    const commands = new Map<string, { handler: (args: string | undefined, ctx: unknown) => Promise<void> }>();
    const fakePi = {
      on() {},
      registerTool() {},
      registerCommand(name: string, command: { handler: (args: string | undefined, ctx: unknown) => Promise<void> }) {
        commands.set(name, command);
      },
    };
    const notifications: Array<{ message: string; level: string }> = [];
    scalerExtension(fakePi as never);

    const validationAdd = commands.get("scaler-validation-add");
    assert.ok(validationAdd);
    await assert.doesNotReject(() => validationAdd.handler(
      'T-COMMAND-POLICY | unit | node -e "process.exit(0)"',
      {
        cwd: dir,
        hasUI: true,
        ui: { notify: (message: string, level: string) => notifications.push({ message, level }) },
      },
    ));

    assert.match(notifications.at(-1)?.message ?? "", /reason is required/i);
    assert.equal(notifications.at(-1)?.level, "warning");
    assert.match((await getValidationManifestForTask(dir, "T-COMMAND-POLICY")).commands[0]?.command ?? "", /process\.exit\(1\)/);
  });
});

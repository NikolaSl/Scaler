/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Type } from "typebox";
import {
  AuthStorage, createAgentSession, DefaultResourceLoader, ModelRegistry,
  SessionManager, SettingsManager, type AgentSession, type ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import { getBudgetState } from "../src/budgets.js";
import { loadTaskAgentRunRecords, runConductorStep } from "../src/conductor.js";
import { loadContextSplitRecords } from "../src/context-splits.js";
import scalerExtension from "../src/index.js";
import { readLogEvents } from "../src/logging.js";
import { assessTaskPromptAdmission } from "../src/prompt-admission.js";
import {
  assessProviderRequestAdmission,
  createStrictProviderAdmissionPolicy,
  providerAdmissionEnvironmentKeys,
  type ProviderAdmissionRecord,
} from "../src/provider-admission.js";
import { extractProviderUsage } from "../src/provider-usage.js";
import { createDefaultState, loadState, saveState } from "../src/state.js";
import {
  buildTaskAgentEnvironment,
  resolveChildAgentExtensionPaths,
  type TaskAgentRequest,
  type TaskAgentRunResult,
} from "../src/subagents.js";
import { saveValidationManifest } from "../src/validation.js";

const policyEnv = {
  SCALER_PROVIDER_ADMISSION: "strict",
  SCALER_REQUEST_TOKEN_ALLOWANCE: "8000",
  SCALER_OUTPUT_RESERVE_TOKENS: "32",
  SCALER_REQUEST_MARGIN_TOKENS: "1024",
  SCALER_EXPECTED_PROVIDER_API: "openai-completions",
  SCALER_EXPECTED_PROVIDER: "openai",
  SCALER_EXPECTED_MODEL_ID: "synthetic-window",
  SCALER_EXPECTED_CONTEXT_WINDOW: "8000",
};

// All provider traffic is replaced before creating the SDK session. No live
// credentials, endpoints, command providers or global resource discovery are used.
async function runInstalledHost(systemCharacters: number, extensions: ExtensionFactory[] = [], options: { autoCompaction?: boolean; activeTask?: boolean; largeUnselectedTool?: boolean; largeSelectedToolResult?: boolean; selectedReadPath?: string; reemitBeforeStartPrompt?: boolean; rewriteBeforeScaler?: boolean; defaultSystemPrompt?: boolean; failScalerAuditBeforeStart?: boolean; failScalerAuditBeforeProvider?: boolean; queueFollowUpAfterAbort?: boolean; wrongExpectedModel?: boolean; modelContextWindow?: number; modelMaxTokens?: number; noTools?: boolean; prompt?: string; responseText?: string; memorySourceDir?: string; childEnvironment?: NodeJS.ProcessEnv; includeScalerExtension?: boolean } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "scaler-provider-host-test-"));
  const savedFetch = globalThis.fetch;
  const environmentKeys = Array.from(new Set([
    ...Object.keys(policyEnv), ...providerAdmissionEnvironmentKeys, "SCALER_CHILD_AGENT", "SCALER_TOOL_EXECUTION_ID",
  ]));
  const savedEnv = Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]]));
  let session: AgentSession | undefined;
  let fetchCalls = 0;
  let payload: Record<string, unknown> | undefined;
  const payloads: Record<string, unknown>[] = [];
  let compactionCancelled = false;
  try {
    Object.assign(process.env, options.childEnvironment ?? policyEnv);
    if (options.memorySourceDir) {
      await cp(join(options.memorySourceDir, ".scaler", "memory"), join(dir, ".scaler", "memory"), { recursive: true });
    }
    if (options.modelContextWindow) process.env.SCALER_EXPECTED_CONTEXT_WINDOW = String(options.modelContextWindow);
    if (options.wrongExpectedModel) process.env.SCALER_EXPECTED_MODEL_ID = "different-model";
    if (options.autoCompaction) process.env.SCALER_OUTPUT_RESERVE_TOKENS = "1024";
    if (options.activeTask) {
      const state = createDefaultState();
      state.stage = "execution";
      state.currentTaskId = "T-HOST-TOOLS";
      state.tasks = [{ id: "T-HOST-TOOLS", title: "Host tool envelope", status: "running", updatedAt: state.createdAt }];
      await saveState(dir, state);
    }
    globalThis.fetch = async (_input, init) => {
      fetchCalls += 1;
      assert.equal(typeof init?.body, "string", "expected SDK JSON request body");
      payload = JSON.parse(init?.body as string) as Record<string, unknown>;
      payloads.push(payload);
      if (options.largeSelectedToolResult || options.selectedReadPath) {
        const common = { id: "synthetic", object: "chat.completion.chunk", created: 0, model: "synthetic-window" };
        const chunks = fetchCalls === 1
          ? [
            { ...common, choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: "call-large", type: "function", function: options.selectedReadPath ? { name: "read", arguments: JSON.stringify({ path: options.selectedReadPath }) } : { name: "large_selected", arguments: "{}" } }] }, finish_reason: null }] },
            { ...common, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 100, completion_tokens: 5, total_tokens: 105 } },
          ]
          : [
            { ...common, choices: [{ index: 0, delta: { role: "assistant", content: "Inspected referenced result." }, finish_reason: null }] },
            { ...common, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 150, completion_tokens: 4, total_tokens: 154 } },
          ];
        return new Response(`${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`, {
          headers: { "content-type": "text/event-stream" },
        });
      }
      if (options.responseText !== undefined) {
        const common = { id: "synthetic", object: "chat.completion.chunk", created: 0, model: "synthetic-window" };
        const chunks = [
          { ...common, choices: [{ index: 0, delta: { role: "assistant", content: options.responseText }, finish_reason: null }] },
          { ...common, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 80, completion_tokens: 20, total_tokens: 100 } },
        ];
        return new Response(`${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`, {
          headers: { "content-type": "text/event-stream" },
        });
      }
      if (options.autoCompaction) {
        // A successful answer is needed to trigger Pi's threshold compaction.
        const common = { id: "synthetic", object: "chat.completion.chunk", created: 0, model: "synthetic-window" };
        const chunks = [
          { ...common, choices: [{ index: 0, delta: { role: "assistant", content: "Done." }, finish_reason: null }] },
          { ...common, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1100, completion_tokens: 3, total_tokens: 1103 } },
        ];
        return new Response(`${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`, {
          headers: { "content-type": "text/event-stream" },
        });
      }
      return new Response(JSON.stringify({ error: { message: "Synthetic transport: no network", type: "invalid_request_error" } }), {
        status: 400, headers: { "content-type": "application/json" },
      });
    };
    const authStorage = AuthStorage.inMemory();
    authStorage.setRuntimeApiKey("openai", "synthetic-not-a-credential");
    const settingsManager = SettingsManager.inMemory({
      compaction: options.autoCompaction
        ? { enabled: true, reserveTokens: 7900, keepRecentTokens: 0 }
        : { enabled: false },
      retry: { enabled: false },
    });
    const model = {
      id: "synthetic-window", name: "Synthetic window", api: "openai-completions" as const,
      provider: "openai", baseUrl: "https://example.invalid/v1", reasoning: false,
      input: ["text" as const], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: options.modelContextWindow ?? 8000, maxTokens: options.modelMaxTokens ?? 2000,
    };
    const loader = new DefaultResourceLoader({
      cwd: dir, agentDir: join(dir, "agent"), settingsManager,
      noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      ...(options.defaultSystemPrompt ? {} : { systemPrompt: `HOST_SYSTEM_START\n${"s".repeat(systemCharacters)}\nHOST_SYSTEM_END` }),
      // Tool-less children load admission alone, without SCALER's separate
      // deterministic compaction handler (see resolveChildAgentExtensionPaths).
      extensionFactories: [
        ...(options.rewriteBeforeScaler ? [((pi) => {
          pi.on("before_agent_start", (event) => ({ systemPrompt: `EARLIER_SAFETY_PROMPT\n${event.systemPrompt}` }));
        }) satisfies ExtensionFactory] : []),
        ...(options.failScalerAuditBeforeStart ? [((pi) => {
          pi.on("before_agent_start", async () => {
            const eventLog = join(dir, ".scaler", "logs", "events.jsonl");
            await rm(eventLog, { recursive: true, force: true });
            await mkdir(eventLog, { recursive: true });
          });
        }) satisfies ExtensionFactory] : []),
        ...(options.autoCompaction || options.includeScalerExtension === false ? [] : [scalerExtension]),
        ...(options.failScalerAuditBeforeProvider ? [((pi) => {
          pi.on("before_agent_start", async () => {
            const eventLog = join(dir, ".scaler", "logs", "events.jsonl");
            await rm(eventLog, { recursive: true, force: true });
            await mkdir(eventLog, { recursive: true });
          });
        }) satisfies ExtensionFactory] : []),
        ...(options.queueFollowUpAfterAbort ? [((pi) => {
          let queued = false;
          pi.on("agent_end", () => {
            if (queued) return;
            queued = true;
            pi.sendMessage({ customType: "test-follow-up", content: "Continue after refusal.", display: false }, { deliverAs: "followUp" });
          });
        }) satisfies ExtensionFactory] : []),
        ...(options.largeUnselectedTool ? [((pi) => {
          pi.registerTool({
            name: "large_unselected",
            label: "Large Unselected",
            description: "LARGE_UNSELECTED_DESCRIPTION",
            promptSnippet: "LARGE_UNSELECTED_SNIPPET",
            promptGuidelines: [`LARGE_UNSELECTED_GUIDELINE_${"g".repeat(20_000)}`],
            parameters: Type.Object({ payload: Type.String({ description: `LARGE_UNSELECTED_SCHEMA_${"s".repeat(30_000)}` }) }),
            async execute() { return { content: [{ type: "text", text: "unused" }], details: {} }; },
          });
        }) satisfies ExtensionFactory] : []),
        ...(options.largeSelectedToolResult ? [((pi) => {
          pi.registerTool({
            name: "large_selected",
            label: "Large Selected",
            description: "Return one large deterministic result.",
            parameters: Type.Object({}),
            async execute() {
              return { content: [{ type: "text", text: `LARGE_TOOL_RESULT_RAW_${"x".repeat(9_000)}` }], details: {} };
            },
          });
        }) satisfies ExtensionFactory] : []),
        ...(options.reemitBeforeStartPrompt ? [((pi) => {
          pi.on("before_agent_start", (event) => ({ systemPrompt: `${event.systemPrompt}\nCOMPANION_BEFORE_START_PROMPT` }));
        }) satisfies ExtensionFactory] : []),
        ...extensions,
      ],
    });
    await loader.reload();
    ({ session } = await createAgentSession({
      cwd: dir, agentDir: join(dir, "agent"), authStorage,
      modelRegistry: ModelRegistry.inMemory(authStorage), model, settingsManager,
      sessionManager: SessionManager.inMemory(dir), resourceLoader: loader,
      tools: options.noTools
        ? []
        : options.autoCompaction
        ? []
        : options.largeSelectedToolResult
          ? ["read", "large_selected"]
        : options.selectedReadPath
          ? ["read"]
        : options.activeTask
          ? ["read", ...(options.largeUnselectedTool ? ["large_unselected"] : []), "scaler_tool_request", "scaler_task_report"]
          : ["read"],
    }));
    session.subscribe((event) => {
      if (event.type === "compaction_end" && event.aborted) compactionCancelled = true;
    });
    await session.prompt(options.prompt ?? (options.autoCompaction ? `Inspect. ${"x".repeat(4000)}` : "Inspect the exact source."));
    const lastMessage = session.messages.at(-1);
    const events = await readLogEvents(dir).catch(() => []);
    const providerAdmissions: ProviderAdmissionRecord[] = [];
    const admissionDirectory = join(dir, ".scaler", "reports", "provider-admission");
    for (const filename of await readdir(admissionDirectory).catch(() => [])) {
      const parsed = JSON.parse(await readFile(join(admissionDirectory, filename), "utf8")) as ProviderAdmissionRecord;
      providerAdmissions.push(parsed);
    }
    return {
      fetchCalls, payload, payloads, model, compactionCancelled, events,
      usage: extractProviderUsage(session.messages), providerAdmissions,
      lastMessage,
      activeToolNames: session.getActiveToolNames(),
      stopReason: lastMessage?.role === "assistant" ? lastMessage.stopReason : undefined,
    };
  } finally {
    session?.dispose();
    globalThis.fetch = savedFetch;
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(dir, { recursive: true, force: true });
  }
}

async function admissionExtension(): Promise<ExtensionFactory> {
  return (await import("../src/provider-admission-extension.js")).default;
}

test("installed Scaler parent admission aborts an oversized final host envelope", async () => {
  assert.equal(assessTaskPromptAdmission("Inspect the exact source.", 8000).accepted, true);
  const result = await runInstalledHost(40_000);
  assert.equal(result.fetchCalls, 0, "the complete parent envelope must be refused before transport");
  assert.equal(result.stopReason, "aborted");
});

test("installed Scaler parent admission preserves its output reserve", async () => {
  const result = await runInstalledHost(40, [], { modelContextWindow: 128_000, modelMaxTokens: 512 });
  assert.equal(result.fetchCalls, 0, "a fitting input must not consume the required output reserve");
  assert.equal(result.stopReason, "aborted");
});

test("installed Scaler parent envelope refusal survives audit failure", async () => {
  const result = await runInstalledHost(40_000, [], { failScalerAuditBeforeProvider: true });
  assert.equal(result.fetchCalls, 0, "fallible telemetry must not bypass the provider refusal");
  assert.equal(result.stopReason, "aborted");
});

test("installed Scaler parent admission audit stores measurements without prompt bytes", async () => {
  const result = await runInstalledHost(40, [], { modelContextWindow: 128_000 });
  assert.equal(result.fetchCalls, 1);
  const event = result.events.find((candidate) => candidate.summary === "SCALER parent provider request admitted");
  assert.ok(event);
  const details = JSON.stringify(event.details);
  assert.match(details, /\"code\":\"accepted\"/);
  assert.match(details, /\"payloadBytes\":\d+/);
  assert.doesNotMatch(details, /Inspect the exact source/);
  assert.doesNotMatch(details, /HOST_SYSTEM_START/);
});

test("installed Scaler externalizes a large tool result before admitting the continuation", async () => {
  const result = await runInstalledHost(40, [], { largeSelectedToolResult: true, modelContextWindow: 128_000 });
  assert.equal(result.fetchCalls, 2);
  const continuation = JSON.stringify(result.payloads[1]);
  assert.doesNotMatch(continuation, /LARGE_TOOL_RESULT_RAW/);
  assert.match(continuation, /stored large tool result by reference/);
  assert.ok(result.events.some((event) => event.summary === "Tool result externalized: large_selected"));
});

test("installed Pi composes the complete AC-05 envelope process under one declared window", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scaler-ac05-envelope-test-"));
  try {
    const state = createDefaultState();
    state.stage = "execution";
    state.tasks = [{
      id: "T-AC05", title: "Exercise the complete context envelope", status: "ready",
      allowedPathPrefixes: ["src"], definitionOfDone: ["The admitted process reaches validation."],
      updatedAt: state.createdAt,
    }];
    await saveState(dir, state);
    await saveValidationManifest(dir, {
      taskId: "T-AC05", outputPaths: [], commands: [],
      createdAt: state.createdAt, updatedAt: state.createdAt,
    });

    const rawSourceMarker = "OVERSIZED_REQUIRED_SOURCE_MUST_NOT_REACH_PROVIDER";
    const requests: TaskAgentRequest[] = [];
    const observedTotals: number[] = [];
    const result = await runConductorStep(dir, state, {
      execute: true,
      tokenBudget: 8_000,
      providerAdmissionModel: {
        api: "openai-completions", provider: "openai", id: "synthetic-window", contextWindow: 32_768,
      },
      contextItems: [{
        id: "oversized-source", type: "file", reason: "Required exact implementation source.",
        content: `${rawSourceMarker}\n${"x".repeat(40_000)}`,
        priority: "required", scope: "full", exactness: "exact",
      }],
    }, async (request): Promise<TaskAgentRunResult> => {
      requests.push(request);
      const dispatchId = `plan164-${requests.length}`;
      const childEnvironment = buildTaskAgentEnvironment(request, process.env, dispatchId);
      const extensionPaths = resolveChildAgentExtensionPaths(request);
      if (requests.length === 1) {
        assert.ok((getBudgetState(await loadState(dir)).usage.contextTokens ?? 0) > 0);
        assert.match(request.prompt, /\.scaler\/memory\//);
        assert.doesNotMatch(request.prompt, new RegExp(rawSourceMarker));
        assert.equal(assessTaskPromptAdmission(request.prompt, 8_000).accepted, true);

        const [split] = await loadContextSplitRecords(dir);
        const selectedReadPath = split?.externalizedMemoryRefs[0]?.path;
        assert.ok(selectedReadPath);
        assert.equal(extensionPaths.length, 2, "strict tool child must load SCALER plus admission");
        const host = await runInstalledHost(40, [await admissionExtension()], {
          selectedReadPath,
          memorySourceDir: dir,
          modelContextWindow: 32_768,
          modelMaxTokens: 1_024,
          prompt: request.prompt,
          childEnvironment,
        });
        assert.equal(host.fetchCalls, 2, JSON.stringify(host.providerAdmissions));
        assert.deepEqual(host.activeToolNames, ["read"]);
        assert.ok(host.usage?.totalTokens);
        observedTotals.push(host.usage.totalTokens);
        const continuation = JSON.stringify(host.payloads[1]);
        assert.doesNotMatch(continuation, new RegExp(rawSourceMarker));
        assert.match(continuation, /stored large tool result by reference/);
        assert.ok(host.events.some((event) => event.summary === "Tool result externalized: read"));
        return {
          taskId: request.taskId, exitCode: 0, stdoutEvents: [{ type: "done" }], stderr: "",
          timedOut: false, aborted: false, usage: host.usage, providerAdmissions: host.providerAdmissions,
        };
      }

      assert.equal(request.noTools, true);
      assert.deepEqual(request.tools, []);
      assert.deepEqual(request.attempt, requests[0]?.attempt);
      assert.equal(assessTaskPromptAdmission(request.prompt, 8_000).accepted, true);
      const report = {
        type: "scaler_task_report", taskId: request.taskId, ...request.attempt,
        status: "completed", summary: "AC-05 envelope process completed.", changedFiles: [],
        memoryRefs: [], validations: [], validationRefs: [], evidenceRefs: [], blockers: [], missingData: [],
        recommendedNextAction: "validate",
      };
      assert.equal(extensionPaths.length, 1, "strict tool-less repair must load admission only");
      const host = await runInstalledHost(40, [await admissionExtension()], {
        modelContextWindow: 32_768,
        modelMaxTokens: 1_024,
        noTools: true,
        prompt: request.prompt,
        responseText: JSON.stringify(report),
        childEnvironment,
        includeScalerExtension: false,
      });
      assert.equal(host.fetchCalls, 1);
      assert.deepEqual(host.activeToolNames, []);
      assert.ok(host.usage?.totalTokens);
      assert.equal(host.lastMessage?.role, "assistant");
      observedTotals.push(host.usage.totalTokens);
      return {
        taskId: request.taskId, exitCode: 0,
        stdoutEvents: [{ type: "message_end", message: host.lastMessage }], stderr: "",
        timedOut: false, aborted: false, usage: host.usage, providerAdmissions: host.providerAdmissions,
      };
    });

    assert.equal(result.validationHandoff?.status, "validation_required", result.message);
    assert.equal((await loadState(dir)).tasks[0]?.status, "validating");
    assert.equal(requests.length, 2);
    const [split] = await loadContextSplitRecords(dir);
    assert.equal(split?.externalizedMemoryRefs.length, 1);
    assert.ok(split?.estimatedTokens && split.estimatedTokens > 8_000);
    const runs = await loadTaskAgentRunRecords(dir);
    assert.deepEqual(
      runs.map((run) => run.usage?.totalTokens).sort((left, right) => (left ?? 0) - (right ?? 0)),
      [...observedTotals].sort((left, right) => left - right),
    );
    assert.equal(runs.length, 2);
    for (const run of runs) {
      assert.ok(run.providerUsageReconciliation, "each strict dispatch must durably reconcile estimate and observation");
      assert.equal(run.providerUsageReconciliation.dispatchId.startsWith("plan164-"), true);
      assert.equal(run.providerUsageReconciliation.observedInputTokens, run.usage?.inputTokens);
      assert.equal(
        run.providerUsageReconciliation.inputDeltaTokens,
        run.providerUsageReconciliation.observedInputTokens - run.providerUsageReconciliation.estimatedInputTokensUpperBound,
      );
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("provider admission aborts oversized installed Pi requests before transport", async () => {
  const result = await runInstalledHost(40_000, [await admissionExtension()]);
  assert.equal(result.fetchCalls, 0);
  assert.equal(result.stopReason, "aborted");
});

test("provider admission permits an adequate installed Pi envelope", async () => {
  const result = await runInstalledHost(40, [await admissionExtension()]);
  assert.equal(result.fetchCalls, 1);
  assert.ok(result.payload);
});

test("provider admission aborts when the live model differs from the parent binding", async () => {
  const result = await runInstalledHost(40, [await admissionExtension()], { wrongExpectedModel: true });
  assert.equal(result.fetchCalls, 0);
  assert.equal(result.stopReason, "aborted");
});

test("installed Pi first provider request uses SCALER parent tool focus", async () => {
  const result = await runInstalledHost(40, [], { activeTask: true, largeUnselectedTool: true, reemitBeforeStartPrompt: true, defaultSystemPrompt: true, modelContextWindow: 128_000 });
  assert.equal(result.fetchCalls, 1);
  const toolNames = ((result.payload?.tools ?? []) as Array<{ function?: { name?: string } }>)
    .map((tool) => tool.function?.name)
    .filter((name): name is string => Boolean(name));
  assert.deepEqual(toolNames.sort(), ["scaler_task_report", "scaler_tool_request"]);
  assert.equal(toolNames.includes("read"), false, "the unselected tool must be absent from the transported first request");
  const transported = JSON.stringify(result.payload);
  assert.doesNotMatch(transported, /LARGE_UNSELECTED_SCHEMA/);
  assert.doesNotMatch(transported, /LARGE_UNSELECTED_GUIDELINE/);
  assert.doesNotMatch(transported, /LARGE_UNSELECTED_SNIPPET/);
  assert.match(transported, /COMPANION_BEFORE_START_PROMPT/);
  assert.deepEqual(result.activeToolNames, ["read", "large_unselected", "scaler_tool_request", "scaler_task_report"]);
});

test("installed Pi refuses an unreconcilable earlier system-prompt rewrite", async () => {
  const result = await runInstalledHost(40, [], { activeTask: true, largeUnselectedTool: true, rewriteBeforeScaler: true, defaultSystemPrompt: true });
  assert.equal(result.fetchCalls, 0, "unsupported prompt composition must stop before transport");
  assert.equal(result.stopReason, "aborted");
  assert.deepEqual(result.activeToolNames, ["read", "large_unselected", "scaler_tool_request", "scaler_task_report"]);
});

test("installed Pi preserves selected prompt composition when focus audit logging fails", async () => {
  const result = await runInstalledHost(40, [], {
    activeTask: true,
    largeUnselectedTool: true,
    defaultSystemPrompt: true,
    failScalerAuditBeforeStart: true,
  });
  assert.equal(result.fetchCalls, 1);
  const transported = JSON.stringify(result.payload);
  assert.doesNotMatch(transported, /LARGE_UNSELECTED_SCHEMA/);
  assert.doesNotMatch(transported, /LARGE_UNSELECTED_GUIDELINE/);
  assert.doesNotMatch(transported, /LARGE_UNSELECTED_SNIPPET/);
});

test("installed Pi refuses transport before fallible refusal audit logging", async () => {
  const result = await runInstalledHost(40, [], {
    activeTask: true,
    largeUnselectedTool: true,
    rewriteBeforeScaler: true,
    defaultSystemPrompt: true,
    failScalerAuditBeforeProvider: true,
  });
  assert.equal(result.fetchCalls, 0, "audit failure must not bypass an established refusal");
  assert.equal(result.stopReason, "aborted");
});

test("installed Pi keeps prompt-composition refusal latched across continuations", async () => {
  const result = await runInstalledHost(40, [], {
    activeTask: true,
    largeUnselectedTool: true,
    rewriteBeforeScaler: true,
    defaultSystemPrompt: true,
    queueFollowUpAfterAbort: true,
  });
  assert.equal(result.fetchCalls, 0, "a continuation without a fresh admission boundary must remain blocked");
});

test("installed Pi auto-compaction bypasses provider-request hooks without the strict profile", async () => {
  let hookCalls = 0;
  const result = await runInstalledHost(40, [(pi) => {
    pi.on("before_provider_request", () => { hookCalls += 1; });
  }], { autoCompaction: true });
  assert.equal(result.fetchCalls, 2, "ordinary answer and an unguarded compaction request reach transport");
  assert.equal(hookCalls, 1, "Pi does not emit before_provider_request for compaction");
  const policy = createStrictProviderAdmissionPolicy(8000);
  assert.equal(assessProviderRequestAdmission({ payload: result.payloads[0], model: result.model, policy }).accepted, true);
  assert.equal(assessProviderRequestAdmission({ payload: result.payloads[1], model: result.model, policy }).accepted, false);
});

test("strict provider admission cancels automatic compaction before unguarded transport", async () => {
  const result = await runInstalledHost(40, [await admissionExtension()], { autoCompaction: true });
  assert.equal(result.fetchCalls, 1, "only the admitted ordinary request may reach transport");
  assert.equal(result.stopReason, "stop", "cancelling compaction must preserve the successful ordinary answer");
  assert.equal(result.compactionCancelled, true);
});

test("installed Pi swallows throwing provider hooks but ctx.abort prevents transport", async () => {
  let throwCalls = 0;
  const throwing = await runInstalledHost(40, [(pi) => {
    pi.on("before_provider_request", () => { throwCalls += 1; throw new Error("Synthetic envelope refusal"); });
  }]);
  assert.equal(throwCalls, 1);
  assert.equal(throwing.fetchCalls, 1);
  let abortCalls = 0;
  let signalAborted = false;
  const aborted = await runInstalledHost(40, [(pi) => {
    pi.on("before_provider_request", (_event, ctx) => {
      abortCalls += 1;
      ctx.abort();
      signalAborted = ctx.signal?.aborted === true;
    });
  }]);
  assert.equal(abortCalls, 1);
  assert.equal(signalAborted, true);
  assert.equal(aborted.fetchCalls, 0);
  assert.equal(aborted.stopReason, "aborted");
});

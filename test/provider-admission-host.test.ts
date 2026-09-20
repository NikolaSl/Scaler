/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Type } from "typebox";
import {
  AuthStorage, createAgentSession, DefaultResourceLoader, ModelRegistry,
  SessionManager, SettingsManager, type AgentSession, type ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import scalerExtension from "../src/index.js";
import { assessTaskPromptAdmission } from "../src/prompt-admission.js";
import { assessProviderRequestAdmission, createStrictProviderAdmissionPolicy } from "../src/provider-admission.js";
import { createDefaultState, saveState } from "../src/state.js";

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
async function runInstalledHost(systemCharacters: number, extensions: ExtensionFactory[] = [], options: { autoCompaction?: boolean; activeTask?: boolean; largeUnselectedTool?: boolean; reemitBeforeStartPrompt?: boolean; rewriteBeforeScaler?: boolean; defaultSystemPrompt?: boolean; failScalerAuditBeforeStart?: boolean; failScalerAuditBeforeProvider?: boolean; queueFollowUpAfterAbort?: boolean; wrongExpectedModel?: boolean } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "scaler-provider-host-test-"));
  const savedFetch = globalThis.fetch;
  const savedEnv = Object.fromEntries(Object.keys(policyEnv).map((key) => [key, process.env[key]]));
  let session: AgentSession | undefined;
  let fetchCalls = 0;
  let payload: Record<string, unknown> | undefined;
  const payloads: Record<string, unknown>[] = [];
  let compactionCancelled = false;
  try {
    Object.assign(process.env, policyEnv);
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
      contextWindow: 8000, maxTokens: options.autoCompaction ? 2000 : 1000,
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
        ...(options.autoCompaction ? [] : [scalerExtension]),
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
      tools: options.autoCompaction
        ? []
        : options.activeTask
          ? ["read", ...(options.largeUnselectedTool ? ["large_unselected"] : []), "scaler_tool_request", "scaler_task_report"]
          : ["read"],
    }));
    session.subscribe((event) => {
      if (event.type === "compaction_end" && event.aborted) compactionCancelled = true;
    });
    await session.prompt(options.autoCompaction ? `Inspect. ${"x".repeat(4000)}` : "Inspect the exact source.");
    const lastMessage = session.messages.at(-1);
    return {
      fetchCalls, payload, payloads, model, compactionCancelled,
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

test("installed Pi baseline sends an oversized host envelope despite a small admitted SCALER prompt", async () => {
  assert.equal(assessTaskPromptAdmission("Inspect the exact source.", 8000).accepted, true);
  const result = await runInstalledHost(40_000);
  assert.equal(result.fetchCalls, 1);
  assert.ok(Buffer.byteLength(JSON.stringify(result.payload), "utf8") > 8000);
  assert.equal(result.payload?.max_completion_tokens, 1, "host floors output at one instead of refusing oversized input");
  assert.equal((result.payload?.tools as unknown[])?.length, 1);
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
  const result = await runInstalledHost(40, [], { activeTask: true, largeUnselectedTool: true, reemitBeforeStartPrompt: true, defaultSystemPrompt: true });
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
  const throwing = await runInstalledHost(40_000, [(pi) => {
    pi.on("before_provider_request", () => { throwCalls += 1; throw new Error("Synthetic envelope refusal"); });
  }]);
  assert.equal(throwCalls, 1);
  assert.equal(throwing.fetchCalls, 1);
  let abortCalls = 0;
  let signalAborted = false;
  const aborted = await runInstalledHost(40_000, [(pi) => {
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

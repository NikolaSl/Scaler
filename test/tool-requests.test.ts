/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createDefaultState, loadState, saveState } from "../src/state.js";
import { getToolRequestsIndexPath, getToolResultsPath, getToolTransactionsPath } from "../src/paths.js";
import * as toolRequestsModule from "../src/tool-requests.js";
import {
  buildRuntimeToolCatalog,
  buildToolAgentPrompt,
  buildToolSchemaDiscoveryPrompt,
  createToolReplayApproval,
  DEFAULT_TOOL_EXECUTION_LIMITS,
  formatDiscoveredToolCatalog,
  formatMcpEnumerationRuns,
  formatMcpServerRecords,
  formatRuntimeToolCatalog,
  formatToolCatalog,
  formatToolIterationPolicy,
  formatToolIterationRuns,
  formatToolReplayApprovals,
  formatToolSchedules,
  formatToolSchemaDiscoveryRuns,
  formatToolTransactions,
  getToolCatalogEntries,
  loadMcpEnumerationRuns,
  loadMcpServerRecords,
  loadToolIterationPolicy,
  loadToolIterationRuns,
  loadToolReplayApprovals,
  loadToolRequests,
  loadToolSchedules,
  loadToolResults,
  loadToolSchemaDiscoveryRuns,
  loadToolSchemaRecords,
  loadToolTransactions,
  normalizeToolRiskLevel,
  prepareToolRequest,
  recordToolResult,
  recordToolSchema,
  replayToolTransaction as replayToolTransactionRaw,
  revokeToolReplayApproval,
  runMcpServerEnumeration,
  runToolIterationWorkflow as runToolIterationWorkflowRaw,
  runToolRequestAgent as runToolRequestAgentRaw,
  runToolSchedule as runToolScheduleRaw,
  runToolSchemaDiscoveryAgent,
  saveToolIterationPolicy,
  selectParentRequesterActiveTools,
  shouldApplyParentToolFocus,
  type ToolDispatchRouteEvidenceSupplier,
} from "../src/tool-requests.js";

const admittedRouteEvidenceSupplier: ToolDispatchRouteEvidenceSupplier = (basis) => {
  const payload = { model: "synthetic", messages: [{ role: "user", content: "bounded" }], max_completion_tokens: 1_024 };
  const model = { api: "openai-completions", provider: "synthetic", id: "synthetic-4m", contextWindow: 4_000_000 };
  const policy = { requestTokenAllowance: 4_000_000, outputReserveTokens: 1_024, safetyMarginTokens: 1_024 };
  return {
    version: 1,
    requestId: basis.requestId,
    executionId: basis.executionId,
    evidence: {
      profile: { version: 1, footprint: "selected", toolNames: [...basis.toolNames], byteSize: 64, fingerprint: "a".repeat(64) },
      authority: "allowed",
      direct: { exactArgumentsAvailable: false, argumentsValidated: false },
      currentAgent: { available: false, legs: [] },
      isolated: {
        available: true,
        legs: [
          { id: "worker", role: "worker", payload, model, policy, additionalContextBytes: 0, repeatCount: 1 },
          { id: "caller-continuation", role: "caller-continuation", payload, model, policy, additionalContextBytes: basis.resultBytesReserve, repeatCount: 1 },
        ],
      },
      isolationRequirement: "capability",
    },
  };
};

const runToolRequestAgent: typeof runToolRequestAgentRaw = (cwd, state, options = {}, runner) => runToolRequestAgentRaw(
  cwd, state, options.execute ? { ...options, routeEvidenceSupplier: options.routeEvidenceSupplier ?? admittedRouteEvidenceSupplier } : options, runner,
);
const replayToolTransaction: typeof replayToolTransactionRaw = (cwd, state, options, runner) => replayToolTransactionRaw(
  cwd, state, options.execute ? { ...options, routeEvidenceSupplier: options.routeEvidenceSupplier ?? admittedRouteEvidenceSupplier } : options, runner,
);
const runToolIterationWorkflow: typeof runToolIterationWorkflowRaw = (cwd, state, options = {}, runner) => runToolIterationWorkflowRaw(
  cwd, state, options.execute ? { ...options, routeEvidenceSupplier: options.routeEvidenceSupplier ?? admittedRouteEvidenceSupplier } : options, runner,
);
const runToolSchedule: typeof runToolScheduleRaw = (cwd, state, options = {}, runner, now) => runToolScheduleRaw(
  cwd, state, options.execute ? { ...options, routeEvidenceSupplier: options.routeEvidenceSupplier ?? admittedRouteEvidenceSupplier } : options, runner, now,
);

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-tool-request-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("normalizeToolRiskLevel and formatToolCatalog provide compact catalog metadata", () => {
  assert.equal(normalizeToolRiskLevel("high"), "high");
  assert.equal(normalizeToolRiskLevel("not-a-risk"), "unknown");
  const catalog = getToolCatalogEntries(["bash", "custom_mcp"]);

  assert.deepEqual(catalog.map((entry) => [entry.name, entry.riskLevel]), [["bash", "high"], ["custom_mcp", "unknown"]]);
  assert.match(formatToolCatalog(catalog), /bash: Run a shell command/);
  assert.match(formatToolCatalog(catalog), /custom_mcp: Requested tool\/MCP/);
});

test("runMcpServerEnumeration records project-local MCP declarations without secret values", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, ".cursor"), { recursive: true });
    await writeFile(join(dir, ".mcp.json"), JSON.stringify({
      mcpServers: {
        docs: { command: "node", args: ["server.js"], env: { DOCS_TOKEN: "secret-token" } },
        remote: { url: "https://example.invalid/mcp?token=secret", transport: "http" },
        broken: { args: ["missing command"] },
      },
    }, null, 2));
    await writeFile(join(dir, ".cursor", "mcp.json"), JSON.stringify({ mcpServers: { cursorDocs: { url: "https://example.invalid/sse" } } }, null, 2));
    await writeFile(join(dir, "package.json"), JSON.stringify({ mcp: { servers: { pkgDocs: { command: "pkg-mcp" } } } }, null, 2));
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));

    const result = await runMcpServerEnumeration(dir, state, new Date("2026-01-01T00:00:00.000Z"));

    assert.equal(result.accepted, true);
    assert.equal(result.run.status, "completed");
    assert.equal(result.run.discoveredCount, 4);
    assert.equal(result.run.invalidCount, 1);
    const records = await loadMcpServerRecords(dir);
    assert.equal(records.length, 5);
    const docs = records.find((record) => record.name === "docs");
    assert.equal(docs?.transport, "stdio");
    assert.equal(docs?.riskLevel, "high");
    assert.deepEqual(docs?.envKeys, ["DOCS_TOKEN"]);
    assert.doesNotMatch(JSON.stringify(records), /secret-token/);
    assert.doesNotMatch(JSON.stringify(records), /token=secret/);
    assert.match(formatMcpServerRecords(records), /docs source=.mcp.json/);
    assert.match(formatMcpServerRecords(records), /token=<redacted>/);
    assert.match(formatMcpEnumerationRuns(await loadMcpEnumerationRuns(dir)), /discovered=4 invalid=1/);
  });
});

test("runtime tool catalog omits schemas and selects requester-safe active tools", () => {
  const entries = buildRuntimeToolCatalog([
    {
      name: "bash",
      description: "Run shell commands.\nFULL DETAILS SHOULD NOT APPEAR",
      parameters: { secretSchema: "DO_NOT_INCLUDE_SCHEMA" },
      promptGuidelines: "DO_NOT_INCLUDE_GUIDELINES",
      sourceInfo: { type: "builtin", name: "core" },
    },
    { name: "scaler_tool_request", description: "Request isolated tool work.", parameters: { safe: true }, promptGuidelines: "hidden" },
    { name: "scaler_task_report", description: "Report task completion." },
  ], ["bash", "scaler_tool_request"]);
  const formatted = formatRuntimeToolCatalog(entries);

  assert.match(formatted, /Parent tool catalog/);
  assert.match(formatted, /bash: Run shell commands/);
  assert.match(formatted, /schema=yes/);
  assert.doesNotMatch(formatted, /DO_NOT_INCLUDE_SCHEMA/);
  assert.doesNotMatch(formatted, /DO_NOT_INCLUDE_GUIDELINES/);
  assert.deepEqual(selectParentRequesterActiveTools(entries.map((entry) => entry.name), ["bash", "scaler_tool_request"]), ["scaler_task_report", "scaler_tool_request"]);

  const state = createDefaultState();
  assert.equal(shouldApplyParentToolFocus(state), false);
  state.currentTaskId = "T-TOOLS";
  assert.equal(shouldApplyParentToolFocus(state), true);
});

test("runtime tool envelope profile binds selected definitions and fails closed without selection proof", () => {
  type Profile = { footprint: string; toolNames: string[]; byteSize: number | null; fingerprint: string | null; reason?: string };
  type Builder = (
    tools: Array<{ name: string; description?: string; parameters?: unknown; promptGuidelines?: unknown; sourceInfo?: unknown }>,
    active: string[],
    selection?: { requestedToolNames?: string[]; selectionApisAvailable?: boolean },
  ) => Profile;
  const buildProfile = (toolRequestsModule as unknown as { buildRuntimeToolEnvelopeProfile?: Builder }).buildRuntimeToolEnvelopeProfile;
  assert.equal(typeof buildProfile, "function", "PLAN-123 requires a measured runtime tool envelope profile");
  if (!buildProfile) return;

  const small = [{
    name: "docs_search",
    description: "Search docs",
    parameters: { type: "object", properties: { query: { type: "string", description: "short" } } },
    promptGuidelines: ["Use an exact query."],
    sourceInfo: { type: "mcp", server: "docs" },
  }];
  const selected = { requestedToolNames: ["docs_search"], selectionApisAvailable: true };
  const smallProfile = buildProfile(small, ["docs_search"], selected);
  const largeProfile = buildProfile([{ ...small[0], parameters: { type: "object", description: "x".repeat(50_000) } }], ["docs_search"], selected);
  assert.equal(smallProfile.footprint, "selected");
  assert.deepEqual(smallProfile.toolNames, ["docs_search"]);
  assert.ok((smallProfile.byteSize ?? 0) > 0);
  assert.ok((largeProfile.byteSize ?? 0) > (smallProfile.byteSize ?? 0) + 49_000);
  assert.notEqual(largeProfile.fingerprint, smallProfile.fingerprint);

  const reordered = buildProfile([{
    name: "docs_search",
    description: "Search docs",
    parameters: { properties: { query: { description: "short", type: "string" } }, type: "object" },
    promptGuidelines: ["Use an exact query."],
    sourceInfo: { server: "docs", type: "mcp" },
  }], ["docs_search"], selected);
  assert.equal(reordered.fingerprint, smallProfile.fingerprint, "object key insertion order must not change identity");
  assert.equal(reordered.byteSize, smallProfile.byteSize);

  for (const changed of [
    [{ ...small[0], description: "Search private docs" }],
    [{ ...small[0], promptGuidelines: ["Use an exact query.", "Never guess."] }],
    [{ ...small[0], sourceInfo: { type: "mcp", server: "docs-v2" } }],
  ]) {
    assert.notEqual(buildProfile(changed, ["docs_search"], selected).fingerprint, smallProfile.fingerprint);
  }

  const wholeCatalog = buildProfile(small, ["docs_search"]);
  assert.equal(wholeCatalog.footprint, "whole-catalog");
  const unavailable = buildProfile(small, ["docs_search"], { requestedToolNames: ["docs_search"], selectionApisAvailable: false });
  assert.equal(unavailable.footprint, "unknown");
  assert.equal(unavailable.byteSize, null);
  assert.equal(unavailable.fingerprint, null);
  const mismatched = buildProfile(small, [], selected);
  assert.equal(mismatched.footprint, "unknown");
  assert.equal(mismatched.fingerprint, null);
});

test("runtime tool envelope profile rejects malformed definitions without ambiguous canonical sentinels", () => {
  const selected = { requestedToolNames: ["docs_search"], selectionApisAvailable: true };
  const omitted = toolRequestsModule.buildRuntimeToolEnvelopeProfile([{ name: "docs_search" }], ["docs_search"], selected);
  const sentinelShaped = toolRequestsModule.buildRuntimeToolEnvelopeProfile([{
    name: "docs_search",
    parameters: { $scalerType: "undefined" },
  }], ["docs_search"], selected);
  assert.notEqual(omitted.fingerprint, sentinelShaped.fingerprint, "an actual schema object must not collide with an omitted field marker");
  const denseArray = toolRequestsModule.buildRuntimeToolEnvelopeProfile([{
    name: "docs_search",
    parameters: { enum: [] },
  }], ["docs_search"], selected);
  const sparseArray = toolRequestsModule.buildRuntimeToolEnvelopeProfile([{
    name: "docs_search",
    parameters: { enum: Array(1) },
  }], ["docs_search"], selected);
  assert.notEqual(denseArray.fingerprint, sparseArray.fingerprint, "sparse array holes must not collide with a shorter transported array");

  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  for (const profile of [
    toolRequestsModule.buildRuntimeToolEnvelopeProfile([{ name: "docs_search", parameters: cyclic }], ["docs_search"], selected),
    toolRequestsModule.buildRuntimeToolEnvelopeProfile([{ name: "docs_search" }, { name: "docs_search" }], ["docs_search"], selected),
    toolRequestsModule.buildRuntimeToolEnvelopeProfile([{ name: "other" }], ["docs_search"], selected),
    toolRequestsModule.buildRuntimeToolEnvelopeProfile([{ name: "docs_search", parameters: { maximum: Number.POSITIVE_INFINITY } }], ["docs_search"], selected),
  ]) {
    assert.equal(profile.footprint, "unknown");
    assert.equal(profile.byteSize, null);
    assert.equal(profile.fingerprint, null);
    assert.ok(profile.reason);
  }
});

test("recordToolSchema persists discovered metadata and merges latest catalog entry", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    await recordToolSchema(dir, state, {
      toolName: "mcp_docs_search",
      source: "mcp://docs/help",
      description: "Old docs search description.",
      riskLevel: "medium",
      docsRef: "docs:old",
    }, new Date("2026-01-01T00:00:00.000Z"));
    await recordToolSchema(dir, state, {
      toolName: "mcp_docs_search",
      source: "mcp://docs/schema",
      description: "Search the docs MCP by query string.",
      riskLevel: "low",
      docsRef: "docs:mcp-search",
      schemaRef: "schema:mcp-search-v2",
      notes: "args: { query: string }",
      evidenceRefs: ["docs:mcp-search"],
      discoveredByAgentId: "tool-discovery-agent",
    }, new Date("2026-01-02T00:00:00.000Z"));

    const records = await loadToolSchemaRecords(dir);
    assert.equal(records.length, 2);
    const rendered = formatDiscoveredToolCatalog(["mcp_docs_search"], records);
    assert.match(rendered, /Search the docs MCP by query string/);
    assert.match(rendered, /docsRef=docs:mcp-search/);
    assert.match(rendered, /schemaRef=schema:mcp-search-v2/);
    assert.match(rendered, /notes=args: \{ query: string \}/);
  });
});

test("prepareToolRequest injects discovered tool schema metadata into prompts", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    await recordToolSchema(dir, state, {
      toolName: "mcp_docs_search",
      source: "mcp://docs/schema",
      description: "Search the docs MCP by query string.",
      riskLevel: "low",
      docsRef: "docs:mcp-search",
      schemaRef: "schema:mcp-search-v2",
      notes: "args: { query: string }",
    });

    const prepared = await prepareToolRequest(dir, state, {
      toolName: "mcp_docs_search",
      request: "Find widget lifecycle docs.",
      allowedTools: ["read"],
    });

    assert.equal(prepared.accepted, true);
    assert.match(prepared.prompt ?? "", /schemaRef=schema:mcp-search-v2/);
    assert.match(prepared.prompt ?? "", /args: \{ query: string \}/);
  });
});

test("buildToolSchemaDiscoveryPrompt does not grant target tools implicitly", () => {
  const prompt = buildToolSchemaDiscoveryPrompt("mcp_docs_search", [], ["read"]);
  assert.match(prompt, /Target tool\/MCP: mcp_docs_search/);
  assert.match(prompt, /Allowed tools: scaler_tool_schema, read/);
  assert.doesNotMatch(prompt, /Allowed tools: .*mcp_docs_search/);
});

test("runToolSchemaDiscoveryAgent records prepare-mode probes", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));

    const result = await runToolSchemaDiscoveryAgent(dir, state, { toolName: "mcp_docs_search", tools: ["read"] });

    assert.equal(result.accepted, true);
    assert.equal(result.run?.status, "prepared");
    assert.equal(result.run?.executed, false);
    assert.deepEqual(result.run?.allowedTools, ["scaler_tool_schema", "read"]);
    assert.match(formatToolSchemaDiscoveryRuns(await loadToolSchemaDiscoveryRuns(dir)), /status=prepared/);
  });
});

test("runToolSchemaDiscoveryAgent recognizes structured scaler_tool_schema completion", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));

    const result = await runToolSchemaDiscoveryAgent(dir, state, { toolName: "mcp_docs_search", execute: true, tools: ["read"] }, async (request) => {
      assert.match(request.prompt, /scaler_tool_schema/);
      await recordToolSchema(dir, state, {
        toolName: "mcp_docs_search",
        source: "local-schema",
        description: "Search docs MCP.",
        riskLevel: "low",
        docsRef: "docs-mcp-search",
        schemaRef: "schema-mcp-search-v1",
        discoveredByAgentId: request.taskId,
      });
      return { taskId: request.taskId, exitCode: 0, stdoutEvents: [], stderr: "", timedOut: false, aborted: false, stdoutBytes: 0, stderrBytes: 0 };
    });

    assert.equal(result.accepted, true);
    assert.equal(result.run?.status, "completed");
    assert.equal(result.schemaRecord?.toolName, "mcp_docs_search");
    assert.equal((await loadToolSchemaDiscoveryRuns(dir))[0]?.schemaRecordId, result.schemaRecord?.id);
  });
});

test("runToolSchemaDiscoveryAgent treats prose without schema record as missing_schema", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));

    const result = await runToolSchemaDiscoveryAgent(dir, state, { toolName: "mcp_docs_search", execute: true }, async (request) => ({
      taskId: request.taskId,
      exitCode: 0,
      stdoutEvents: [{ type: "unparsed", text: "Schema is query string." }],
      stderr: "",
      timedOut: false,
      aborted: false,
      stdoutBytes: 0,
      stderrBytes: 0,
    }));

    assert.equal(result.accepted, false);
    assert.equal(result.run?.status, "missing_schema");
    assert.equal((await loadToolSchemaRecords(dir)).length, 0);
  });
});

test("prepareToolRequest persists request and limited invocation with metadata", async () => {
  await withTempDir(async (dir) => {
    const result = await prepareToolRequest(dir, createDefaultState(), {
      toolName: "docs_search",
      request: "Find the API contract for widgets.",
      taskId: "T-001",
      requesterAgentId: "agent-1",
      expectedOutput: "Widget API endpoint summary.",
      requiredFormat: "markdown bullets",
      riskLevel: "low",
      permissionRequirement: "read-only docs lookup",
      safetyNotes: "Do not mutate files.",
      allowedTools: ["docs_search", "read"],
    });
    const requests = await loadToolRequests(dir);

    assert.equal(result.accepted, true);
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.toolName, "docs_search");
    assert.deepEqual(requests[0]?.allowedTools, ["docs_search", "read"]);
    assert.equal(requests[0]?.requesterAgentId, "agent-1");
    assert.equal(requests[0]?.expectedOutput, "Widget API endpoint summary.");
    assert.equal(requests[0]?.requiredFormat, "markdown bullets");
    assert.equal(requests[0]?.riskLevel, "low");
    assert.equal(requests[0]?.permissionRequirement, "read-only docs lookup");
    assert.equal(requests[0]?.safetyNotes, "Do not mutate files.");
    assert.ok(result.invocation?.args.includes("--tools"));
    assert.ok(result.invocation?.args.includes("docs_search,read"));
    assert.ok(!result.invocation?.args.includes("bash"));
  });
});

test("runToolSchedule plans parallel low-risk requests and serializes risky requests", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    await recordToolSchema(dir, state, { toolName: "docs_search", source: "mock", riskLevel: "low", description: "Read-only docs search." });
    const low = await prepareToolRequest(dir, state, { toolName: "docs_search", request: "Find docs A.", riskLevel: "low" });
    const low2 = await prepareToolRequest(dir, state, { toolName: "read", request: "Read docs file.", riskLevel: "low" });
    const risky = await prepareToolRequest(dir, state, { toolName: "bash", request: "Run command.", riskLevel: "high" });
    assert.ok(low.record && low2.record && risky.record);

    const result = await runToolSchedule(dir, state, { parallelism: 4 }, undefined, new Date("2026-01-01T00:00:00.000Z"));

    assert.equal(result.accepted, true);
    assert.equal(result.schedule.status, "planned");
    assert.deepEqual(result.schedule.parallelRequestIds.sort(), [low.record.id, low2.record.id].sort());
    assert.deepEqual(result.schedule.serialRequestIds, [risky.record.id]);
    assert.match(result.schedule.steps.find((step) => step.requestId === risky.record!.id)?.reason ?? "", /serialized/);
    assert.match(formatToolSchedules(await loadToolSchedules(dir)), /parallel=2 serial=1/);
  });
});

test("runToolSchedule executes parallel then serial requests with structured results", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    await recordToolSchema(dir, state, { toolName: "docs_search", source: "mock", riskLevel: "low", description: "Read-only docs search." });
    const low = await prepareToolRequest(dir, state, { toolName: "docs_search", request: "Find docs A.", riskLevel: "low" });
    const low2 = await prepareToolRequest(dir, state, { toolName: "read", request: "Read docs file.", riskLevel: "low" });
    const serial = await prepareToolRequest(dir, state, { toolName: "write", request: "Write result.", riskLevel: "medium" });
    assert.ok(low.record && low2.record && serial.record);
    const order: string[] = [];

    const result = await runToolSchedule(dir, state, { execute: true, parallelism: 2 }, async (request) => {
      order.push(request.taskId);
      const requestId = request.taskId.replace(/^tool-/, "");
      await recordToolResult(dir, state, { requestId, executionId: request.executionId, status: "completed", summary: `Completed ${requestId}`, outputs: { ok: true } });
      return { taskId: request.taskId, exitCode: 0, stdoutEvents: [], stderr: "", timedOut: false, aborted: false, stdoutBytes: 0, stderrBytes: 0 };
    }, new Date("2026-01-01T00:00:00.000Z"));

    assert.equal(result.accepted, true);
    assert.equal(result.schedule.status, "completed");
    assert.equal(result.schedule.steps.length, 3);
    assert.deepEqual(result.schedule.steps.map((step) => step.transactionStatus), ["completed", "completed", "completed"]);
    assert.equal(order.at(-1), `tool-${serial.record.id}`);
    assert.equal((await loadToolRequests(dir)).every((request) => request.status === "completed"), true);
  });
});

test("runToolSchedule executes guarded requests sequentially even when parallelism is requested", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    await recordToolSchema(dir, state, { toolName: "docs_search", source: "mock", riskLevel: "low", description: "Read-only docs search." });
    await prepareToolRequest(dir, state, { toolName: "docs_search", request: "Find docs A.", riskLevel: "low" });
    await prepareToolRequest(dir, state, { toolName: "docs_search", request: "Find docs B.", riskLevel: "low" });
    let active = 0;
    let maximumActive = 0;

    const result = await runToolSchedule(dir, state, { execute: true, parallelism: 8 }, async (request) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      const requestId = request.taskId.replace(/^tool-/, "");
      const executionId = (request as typeof request & { executionId?: string }).executionId;
      await recordToolResult(dir, state, {
        requestId,
        executionId,
        status: "completed",
        summary: `Completed ${requestId}`,
        outputs: { ok: true },
      } as Parameters<typeof recordToolResult>[2] & { executionId?: string });
      active -= 1;
      return { taskId: request.taskId, exitCode: 0, stdoutEvents: [], stderr: "", timedOut: false, aborted: false, stdoutBytes: 0, stderrBytes: 0 };
    });

    assert.equal(result.accepted, true);
    assert.equal(maximumActive, 1);
  });
});

test("buildToolAgentPrompt includes request and excludes unrelated tools", () => {
  const prompt = buildToolAgentPrompt({
    id: "REQ-001",
    toolName: "browser",
    request: "Open the docs page and summarize install steps.",
    allowedTools: ["browser"],
    riskLevel: "external",
    expectedOutput: "Install summary",
    requiredFormat: "one paragraph",
    permissionRequirement: "internet approval",
    safetyNotes: "No private code upload.",
    status: "prepared",
    createdAt: "2026-01-01T00:00:00.000Z",
  });

  assert.match(prompt, /isolated SCALER tool agent/);
  assert.match(prompt, /Tool request id: REQ-001/);
  assert.match(prompt, /scaler_tool_result/);
  assert.match(prompt, /Requested tool\/MCP: browser/);
  assert.match(prompt, /Allowed tools: browser/);
  assert.match(prompt, /Expected output: Install summary/);
  assert.match(prompt, /Required format: one paragraph/);
  assert.match(prompt, /Risk level: external/);
  assert.match(prompt, /Permission requirement: internet approval/);
  assert.match(prompt, /No private code upload/);
  assert.match(prompt, /browser: Requested tool\/MCP/);
  assert.match(prompt, /summarize install steps/);
  assert.doesNotMatch(prompt, /bash, write, edit/);
});

test("prepareToolRequest rejects missing request without persistence", async () => {
  await withTempDir(async (dir) => {
    const result = await prepareToolRequest(dir, createDefaultState(), {
      toolName: "docs_search",
      request: "   ",
    });

    assert.equal(result.accepted, false);
    assert.match(result.message, /request is required/);
    assert.deepEqual(await loadToolRequests(dir), []);
  });
});

test("runToolRequestAgent records prepare-mode transactions", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    const prepared = await prepareToolRequest(dir, state, {
      toolName: "docs_search",
      request: "Find widget docs.",
      allowedTools: ["read"],
    }, new Date("2026-01-01T00:00:00.000Z"));
    assert.ok(prepared.record);

    const result = await runToolRequestAgent(dir, state, { requestId: prepared.record.id });

    assert.equal(result.accepted, true);
    assert.equal(result.transaction?.status, "prepared");
    assert.equal(result.transaction?.executed, false);
    assert.ok(result.invocation?.args.includes("--tools"));
    assert.ok(result.invocation?.args.includes("docs_search,read"));
    assert.match(formatToolTransactions(await loadToolTransactions(dir)), /status=prepared/);
  });
});

test("runToolRequestAgent refuses isolated dispatch without a live route evidence supplier", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    const prepared = await prepareToolRequest(dir, state, {
      toolName: "docs_search",
      request: "Find widget docs.",
      allowedTools: ["read"],
    });
    assert.ok(prepared.record);
    let runnerCalled = false;

    const result = await runToolRequestAgentRaw(dir, state, {
      requestId: prepared.record.id,
      execute: true,
    }, async (request) => {
      runnerCalled = true;
      return { taskId: request.taskId, exitCode: 0, stdoutEvents: [], stderr: "", timedOut: false, aborted: false, stdoutBytes: 0, stderrBytes: 0 };
    });

    assert.equal(result.accepted, false);
    assert.equal(runnerCalled, false);
    assert.match(result.message, /route evidence supplier/i);
    assert.equal((await loadToolRequests(dir))[0]?.status, "prepared");
    assert.equal((await loadToolRequests(dir))[0]?.activeExecutionId, undefined);
  });
});

test("runToolRequestAgent recomputes route and refuses a non-isolated recommendation", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    const prepared = await prepareToolRequest(dir, state, {
      toolName: "docs_search",
      request: "Find widget docs.",
      allowedTools: ["read"],
    });
    assert.ok(prepared.record);
    let runnerCalled = false;
    const payload = {
      model: "synthetic",
      messages: [{ role: "user", content: "bounded" }],
      max_completion_tokens: 1024,
    };
    const model = { api: "openai-completions", provider: "synthetic", id: "synthetic-32k", contextWindow: 32_000 };
    const policy = { requestTokenAllowance: 32_000, outputReserveTokens: 1_024, safetyMarginTokens: 1_024 };

    const result = await runToolRequestAgent(dir, state, {
      requestId: prepared.record.id,
      execute: true,
      routeEvidenceSupplier: (basis) => ({
        version: 1,
        requestId: basis.requestId,
        executionId: basis.executionId,
        evidence: {
          profile: { version: 1, footprint: "selected", toolNames: ["docs_search", "read"], byteSize: 64, fingerprint: "a".repeat(64) },
          authority: "allowed",
          direct: { exactArgumentsAvailable: true, argumentsValidated: true, adapterId: "builtin:direct-v1" },
          currentAgent: { available: false, legs: [] },
          isolated: {
            available: true,
            legs: [
              { id: "worker", role: "worker", payload, model, policy, additionalContextBytes: 0, repeatCount: 1 },
              { id: "caller-continuation", role: "caller-continuation", payload, model, policy, additionalContextBytes: 0, repeatCount: 1 },
            ],
          },
          isolationRequirement: "capability",
        },
      }),
    }, async (request) => {
      runnerCalled = true;
      return { taskId: request.taskId, exitCode: 0, stdoutEvents: [], stderr: "", timedOut: false, aborted: false, stdoutBytes: 0, stderrBytes: 0 };
    });

    assert.equal(result.accepted, false);
    assert.equal(runnerCalled, false);
    assert.match(result.message, /recommended direct/i);
    assert.equal((await loadToolRequests(dir))[0]?.activeExecutionId, undefined);
  });
});

test("runToolRequestAgent recognizes structured scaler_tool_result closure", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    const prepared = await prepareToolRequest(dir, state, {
      toolName: "docs_search",
      request: "Find widget docs.",
      taskId: "T-TOOL-RUN",
      allowedTools: ["read"],
    }, new Date("2026-01-01T00:00:00.000Z"));
    assert.ok(prepared.record);

    const result = await runToolRequestAgent(dir, state, { requestId: prepared.record.id, execute: true }, async (request) => {
      assert.equal(request.model, "synthetic-4m");
      assert.deepEqual(request.providerAdmission, {
        requestTokenAllowance: 4_000_000,
        outputReserveTokens: 1_024,
        safetyMarginTokens: 1_024,
      });
      await recordToolResult(dir, state, {
        requestId: prepared.record!.id,
        executionId: request.executionId,
        status: "completed",
        summary: `Completed ${request.taskId}`,
        outputs: { refs: ["docs:widget"] },
        validationPerformed: ["checked requested format"],
      });
      return { taskId: request.taskId, exitCode: 0, stdoutEvents: [], stderr: "", timedOut: false, aborted: false, stdoutBytes: 0, stderrBytes: 0 };
    });

    assert.equal(result.accepted, true);
    assert.equal(result.transaction?.status, "completed");
    assert.equal(result.resultRecord?.status, "completed");
    assert.equal(result.resultRecord?.acceptanceStatus, "accepted");
    assert.equal((await loadToolRequests(dir))[0]?.status, "completed");
    assert.equal((await loadToolTransactions(dir))[0]?.resultId, result.resultRecord?.id);
    assert.equal(result.transaction?.routeAdmission?.route, "isolated");
    assert.equal(result.transaction?.routeAdmission?.authorized, true);
    assert.ok(result.invocation?.args.includes("--no-extensions"));
    assert.ok(result.invocation?.args.includes("synthetic-4m"));
    assert.doesNotMatch(JSON.stringify(result.transaction), /"messages"|"bounded"/);
  });
});

test("runToolRequestAgent rejects request drift while live route evidence is supplied", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    const prepared = await prepareToolRequest(dir, state, { toolName: "docs_search", request: "Original request." });
    assert.ok(prepared.record);
    let runnerCalled = false;

    const result = await runToolRequestAgentRaw(dir, state, {
      requestId: prepared.record.id,
      execute: true,
      routeEvidenceSupplier: async (basis) => {
        const requests = await loadToolRequests(dir);
        await writeFile(getToolRequestsIndexPath(dir), `${JSON.stringify({
          version: 1,
          requests: requests.map((request) => request.id === prepared.record!.id ? { ...request, request: "Changed request." } : request),
        }, null, 2)}\n`, "utf8");
        return admittedRouteEvidenceSupplier(basis);
      },
    }, async (request) => {
      runnerCalled = true;
      return { taskId: request.taskId, exitCode: 0, stdoutEvents: [], stderr: "", timedOut: false, aborted: false, stdoutBytes: 0, stderrBytes: 0 };
    });

    assert.equal(result.accepted, false);
    assert.equal(runnerCalled, false);
    assert.match(result.message, /changed while live route admission/i);
    assert.equal((await loadToolRequests(dir))[0]?.status, "prepared");
    assert.equal((await loadToolRequests(dir))[0]?.activeExecutionId, undefined);
  });
});

test("runToolRequestAgent rejects foreign live route evidence identity", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    const prepared = await prepareToolRequest(dir, state, { toolName: "docs_search", request: "Find docs." });
    assert.ok(prepared.record);
    let runnerCalled = false;

    const result = await runToolRequestAgentRaw(dir, state, {
      requestId: prepared.record.id,
      execute: true,
      routeEvidenceSupplier: async (basis) => ({ ...(await admittedRouteEvidenceSupplier(basis)), executionId: "foreign-execution" }),
    }, async (request) => {
      runnerCalled = true;
      return { taskId: request.taskId, exitCode: 0, stdoutEvents: [], stderr: "", timedOut: false, aborted: false, stdoutBytes: 0, stderrBytes: 0 };
    });

    assert.equal(result.accepted, false);
    assert.equal(runnerCalled, false);
    assert.match(result.message, /another request\/execution/i);
  });
});

test("runToolRequestAgent rejects a completed proposal after child output overflow", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    const prepared = await prepareToolRequest(dir, state, { toolName: "docs_search", request: "Find docs." });
    assert.ok(prepared.record);

    const result = await runToolRequestAgent(dir, state, { requestId: prepared.record.id, execute: true }, async (request) => {
      await recordToolResult(dir, state, {
        requestId: prepared.record!.id,
        executionId: request.executionId,
        status: "completed",
        summary: "Claimed completion before overflowing output.",
        outputs: { ok: true },
      });
      return {
        taskId: request.taskId,
        exitCode: 0,
        stdoutEvents: [],
        stderr: "",
        timedOut: false,
        aborted: false,
        stdoutBytes: DEFAULT_TOOL_EXECUTION_LIMITS.stdoutBytes + 1,
        stderrBytes: 0,
        outputLimitExceeded: "stdout" as const,
      };
    });

    assert.equal(result.accepted, false);
    assert.equal(result.transaction?.status, "blocked");
    assert.equal(result.transaction?.outputLimitExceeded, "stdout");
    assert.equal((await loadToolResults(dir))[0]?.acceptanceStatus, "rejected");
  });
});

test("runToolRequestAgent refuses a completed proposal without authoritative transport measurements", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    const prepared = await prepareToolRequest(dir, state, { toolName: "docs_search", request: "Find docs." });
    assert.ok(prepared.record);

    const result = await runToolRequestAgent(dir, state, { requestId: prepared.record.id, execute: true }, async (request) => {
      await recordToolResult(dir, state, {
        requestId: prepared.record!.id,
        executionId: request.executionId,
        status: "completed",
        summary: "Completed without transport evidence.",
        outputs: { ok: true },
      });
      return { taskId: request.taskId, exitCode: 0, stdoutEvents: [], stderr: "", timedOut: false, aborted: false };
    });

    assert.equal(result.accepted, false);
    assert.equal(result.transaction?.status, "blocked");
    assert.equal((await loadToolResults(dir))[0]?.acceptanceStatus, "rejected");
    assert.match(result.message, /output limits invalid|measurements/i);
  });
});

test("runToolRequestAgent refuses malformed transport measurements", async () => {
  const malformed = [
    { stdoutBytes: null, stderrBytes: 0 },
    { stdoutBytes: -1, stderrBytes: 0 },
    { stdoutBytes: 0.5, stderrBytes: 0 },
    { stdoutBytes: Number.MAX_SAFE_INTEGER + 1, stderrBytes: 0 },
    { stdoutBytes: 0, stderrBytes: null },
  ];
  for (const measurements of malformed) {
    await withTempDir(async (dir) => {
      const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
      const prepared = await prepareToolRequest(dir, state, { toolName: "docs_search", request: "Find docs." });
      assert.ok(prepared.record);

      const result = await runToolRequestAgent(dir, state, { requestId: prepared.record.id, execute: true }, async (request) => {
        await recordToolResult(dir, state, {
          requestId: prepared.record!.id,
          executionId: request.executionId,
          status: "completed",
          summary: "Completed with malformed transport evidence.",
          outputs: { ok: true },
        });
        return {
          taskId: request.taskId,
          exitCode: 0,
          stdoutEvents: [],
          stderr: "",
          timedOut: false,
          aborted: false,
          ...measurements,
        } as unknown as Awaited<ReturnType<typeof import("../src/subagents.js").runTaskAgent>>;
      });

      assert.equal(result.accepted, false);
      assert.equal(result.transaction?.status, "blocked");
    });
  }
});

test("result publication uses the same bounded representation as byte measurement", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    const prepared = await prepareToolRequest(dir, state, { toolName: "docs_search", request: "Find docs." });
    assert.ok(prepared.record);
    let nested: unknown = "leaf";
    for (let depth = 0; depth < 900; depth += 1) nested = [nested];

    const result = await runToolRequestAgent(dir, state, { requestId: prepared.record.id, execute: true }, async (request) => {
      const proposal = await recordToolResult(dir, state, {
        requestId: prepared.record!.id,
        executionId: request.executionId,
        status: "completed",
        summary: "Deep but compact result.",
        outputs: nested,
      });
      const publishedBytes = Buffer.byteLength(await readFile(getToolResultsPath(dir), "utf8"), "utf8");
      assert.ok(publishedBytes <= DEFAULT_TOOL_EXECUTION_LIMITS.resultBytes,
        `published result ledger ${publishedBytes} exceeds result cap ${DEFAULT_TOOL_EXECUTION_LIMITS.resultBytes} for ${proposal.serializedBytes} measured bytes`);
      return { taskId: request.taskId, exitCode: 0, stdoutEvents: [], stderr: "", timedOut: false, aborted: false, stdoutBytes: 0, stderrBytes: 0 };
    });

    assert.equal(result.accepted, true);
  });
});

test("recordToolResult rejects a proposal above the runtime-owned serialized byte limit", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    const prepared = await prepareToolRequest(dir, state, { toolName: "docs_search", request: "Find docs." });
    assert.ok(prepared.record);

    const run = runToolRequestAgent(dir, state, { requestId: prepared.record.id, execute: true }, async (request) => {
      await assert.rejects(recordToolResult(dir, state, {
        requestId: prepared.record!.id,
        executionId: request.executionId,
        status: "completed",
        summary: "Oversized result.",
        outputs: "x".repeat(DEFAULT_TOOL_EXECUTION_LIMITS.resultBytes),
      }), /serialized result.*limit/i);
      return { taskId: request.taskId, exitCode: 0, stdoutEvents: [], stderr: "", timedOut: false, aborted: false, stdoutBytes: 0, stderrBytes: 0 };
    });

    const result = await run;
    assert.equal(result.accepted, false);
    assert.equal(result.transaction?.status, "blocked");
    assert.deepEqual(await loadToolResults(dir), []);
  });
});

test("finalization rechecks durable result bytes and transaction limits", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    const prepared = await prepareToolRequest(dir, state, { toolName: "docs_search", request: "Find docs." });
    assert.ok(prepared.record);

    const result = await runToolRequestAgent(dir, state, { requestId: prepared.record.id, execute: true }, async (request) => {
      await recordToolResult(dir, state, {
        requestId: prepared.record!.id,
        executionId: request.executionId,
        status: "completed",
        summary: "Initially bounded.",
        outputs: { ok: true },
      });
      const results = await loadToolResults(dir);
      results[0]!.outputs = "x".repeat(DEFAULT_TOOL_EXECUTION_LIMITS.resultBytes);
      await writeFile(join(dir, ".scaler", "tool-requests", "results.json"), `${JSON.stringify({ version: 1, results }, null, 2)}\n`, "utf8");
      return { taskId: request.taskId, exitCode: 0, stdoutEvents: [], stderr: "", timedOut: false, aborted: false, stdoutBytes: 0, stderrBytes: 0 };
    });

    assert.equal(result.accepted, false);
    assert.equal(result.transaction?.status, "blocked");
    assert.match(result.message, /result.*limit/i);
    assert.equal((await loadToolResults(dir))[0]?.acceptanceStatus, "rejected");
  });
});

test("finalization rejects durable execution-limit drift without releasing replacement ownership", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    const prepared = await prepareToolRequest(dir, state, { toolName: "docs_search", request: "Find docs." });
    assert.ok(prepared.record);

    const result = await runToolRequestAgent(dir, state, { requestId: prepared.record.id, execute: true }, async (request) => {
      await recordToolResult(dir, state, {
        requestId: prepared.record!.id,
        executionId: request.executionId,
        status: "completed",
        summary: "Bounded proposal.",
        outputs: { ok: true },
      });
      const transactions = await loadToolTransactions(dir);
      transactions[0]!.limits!.resultBytes -= 1;
      await writeFile(getToolTransactionsPath(dir), `${JSON.stringify({ version: 1, transactions }, null, 2)}\n`, "utf8");
      return { taskId: request.taskId, exitCode: 0, stdoutEvents: [], stderr: "", timedOut: false, aborted: false, stdoutBytes: 0, stderrBytes: 0 };
    });

    assert.equal(result.accepted, false);
    assert.match(result.message, /durable execution .* no longer matches/);
    assert.equal((await loadToolRequests(dir))[0]?.status, "prepared");
    assert.ok((await loadToolRequests(dir))[0]?.activeExecutionId);
    assert.equal((await loadToolResults(dir))[0]?.acceptanceStatus, "rejected");
  });
});

test("finalization rejects missing durable live route admission", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    const prepared = await prepareToolRequest(dir, state, { toolName: "docs_search", request: "Find docs." });
    assert.ok(prepared.record);

    const result = await runToolRequestAgent(dir, state, { requestId: prepared.record.id, execute: true }, async (request) => {
      await recordToolResult(dir, state, {
        requestId: prepared.record!.id,
        executionId: request.executionId,
        status: "completed",
        summary: "Proposal after admission drift.",
        outputs: { ok: true },
      });
      const transactions = await loadToolTransactions(dir);
      delete transactions[0]!.routeAdmission;
      await writeFile(getToolTransactionsPath(dir), `${JSON.stringify({ version: 1, transactions }, null, 2)}\n`, "utf8");
      return { taskId: request.taskId, exitCode: 0, stdoutEvents: [], stderr: "", timedOut: false, aborted: false, stdoutBytes: 0, stderrBytes: 0 };
    });

    assert.equal(result.accepted, false);
    assert.match(result.message, /durable execution .* no longer matches/);
    assert.equal((await loadToolResults(dir))[0]?.acceptanceStatus, "rejected");
    assert.equal((await loadToolRequests(dir))[0]?.status, "prepared");
    assert.ok((await loadToolRequests(dir))[0]?.activeExecutionId);
  });
});

test("runToolRequestAgent rejects a completed result when the child process fails", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    const prepared = await prepareToolRequest(dir, state, {
      toolName: "docs_search",
      request: "Find widget docs.",
      allowedTools: ["read"],
    });
    assert.ok(prepared.record);

    const result = await runToolRequestAgent(dir, state, { requestId: prepared.record.id, execute: true }, async (request) => {
      await recordToolResult(dir, state, {
        requestId: prepared.record!.id,
        executionId: (request as typeof request & { executionId?: string }).executionId,
        status: "completed",
        summary: "Claimed completion before process failure.",
        outputs: { ok: true },
      } as Parameters<typeof recordToolResult>[2] & { executionId?: string });
      return { taskId: request.taskId, exitCode: 1, stdoutEvents: [], stderr: "failed after result", timedOut: true, aborted: false, stdoutBytes: 0, stderrBytes: 0 };
    });

    assert.equal(result.accepted, false);
    assert.equal(result.transaction?.status, "blocked");
    assert.equal((await loadToolRequests(dir))[0]?.status, "blocked");
    const proposal = (await loadToolResults(dir))[0] as unknown as { acceptanceStatus?: string };
    assert.equal(proposal.acceptanceStatus, "rejected");
  });
});

test("runToolRequestAgent durably blocks a thrown runner outcome", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    const prepared = await prepareToolRequest(dir, state, { toolName: "docs_search", request: "Find docs." });
    assert.ok(prepared.record);

    const result = await runToolRequestAgent(dir, state, { requestId: prepared.record.id, execute: true }, async () => {
      throw new Error("synthetic spawn failure");
    });

    assert.equal(result.accepted, false);
    assert.equal(result.transaction?.status, "blocked");
    assert.equal(result.transaction?.runExitCode, 1);
    assert.match(result.transaction?.stderrSummary ?? "", /synthetic spawn failure/);
    assert.equal((await loadToolRequests(dir))[0]?.status, "blocked");
  });
});

test("runToolRequestAgent accepts only a result bound to its execution", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    const prepared = await prepareToolRequest(dir, state, { toolName: "docs_search", request: "Find docs." });
    assert.ok(prepared.record);

    const result = await runToolRequestAgent(dir, state, { requestId: prepared.record.id, execute: true }, async (request) => {
      await assert.rejects(recordToolResult(dir, state, {
        requestId: prepared.record!.id,
        executionId: "foreign-execution",
        status: "completed",
        summary: "Foreign result.",
        outputs: { ok: true },
      } as Parameters<typeof recordToolResult>[2] & { executionId: string }), /not the active prepared execution/);
      assert.ok((request as typeof request & { executionId?: string }).executionId);
      return { taskId: request.taskId, exitCode: 0, stdoutEvents: [], stderr: "", timedOut: false, aborted: false, stdoutBytes: 0, stderrBytes: 0 };
    });

    assert.equal(result.accepted, false);
    assert.equal(result.transaction?.status, "blocked");
    assert.equal((await loadToolRequests(dir))[0]?.status, "blocked");
    assert.equal(result.resultRecord, undefined);
  });
});

test("runToolRequestAgent preserves replacement ownership when a stale execution finalizes", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    const prepared = await prepareToolRequest(dir, state, { toolName: "docs_search", request: "Find docs." });
    assert.ok(prepared.record);

    const result = await runToolRequestAgent(dir, state, { requestId: prepared.record.id, execute: true }, async (request) => {
      await recordToolResult(dir, state, {
        requestId: prepared.record!.id,
        executionId: request.executionId,
        status: "completed",
        summary: "Stale execution result.",
        outputs: { ok: true },
      });
      const requests = await loadToolRequests(dir);
      await writeFile(getToolRequestsIndexPath(dir), `${JSON.stringify({
        version: 1,
        requests: requests.map((candidate) => candidate.id === prepared.record!.id
          ? { ...candidate, activeExecutionId: "replacement-live-execution" }
          : candidate),
      }, null, 2)}\n`, "utf8");
      return { taskId: request.taskId, exitCode: 0, stdoutEvents: [], stderr: "", timedOut: false, aborted: false, stdoutBytes: 0, stderrBytes: 0 };
    });

    assert.equal(result.accepted, false);
    assert.equal((await loadToolRequests(dir))[0]?.activeExecutionId, "replacement-live-execution");
    assert.equal((await loadToolRequests(dir))[0]?.status, "prepared");
    assert.equal((await loadToolResults(dir))[0]?.acceptanceStatus, "rejected");
  });
});

test("runToolRequestAgent refuses acceptance when its durable execution disappears", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    const prepared = await prepareToolRequest(dir, state, { toolName: "docs_search", request: "Find docs." });
    assert.ok(prepared.record);

    const result = await runToolRequestAgent(dir, state, { requestId: prepared.record.id, execute: true }, async (request) => {
      await recordToolResult(dir, state, {
        requestId: prepared.record!.id,
        executionId: request.executionId,
        status: "completed",
        summary: "Proposal with missing durable execution.",
        outputs: { ok: true },
      });
      await writeFile(getToolTransactionsPath(dir), `${JSON.stringify({ version: 1, transactions: [] }, null, 2)}\n`, "utf8");
      return { taskId: request.taskId, exitCode: 0, stdoutEvents: [], stderr: "", timedOut: false, aborted: false, stdoutBytes: 0, stderrBytes: 0 };
    });

    assert.equal(result.accepted, false);
    assert.equal(result.transaction?.status, "blocked");
    assert.match(result.message, /durable execution .* missing or no longer matches/);
    assert.equal((await loadToolRequests(dir))[0]?.status, "prepared");
    assert.ok((await loadToolRequests(dir))[0]?.activeExecutionId);
    assert.equal((await loadToolResults(dir))[0]?.acceptanceStatus, "rejected");
    assert.equal((await loadToolTransactions(dir)).length, 0);
  });
});

test("runToolRequestAgent finalizes before accounting usage against fresh state", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    await saveState(dir, state);
    const prepared = await prepareToolRequest(dir, state, { toolName: "docs_search", request: "Find docs." });
    assert.ok(prepared.record);

    const result = await runToolRequestAgent(dir, state, { requestId: prepared.record.id, execute: true }, async (request) => {
      await recordToolResult(dir, state, {
        requestId: prepared.record!.id,
        executionId: request.executionId,
        status: "completed",
        summary: "Completed after child state update.",
        outputs: { ok: true },
      });
      const childState = await loadState(dir);
      childState.orchestrationReason = "child state update";
      await saveState(dir, childState);
      return {
        taskId: request.taskId,
        exitCode: 0,
        stdoutEvents: [],
        stderr: "",
        timedOut: false,
        aborted: false,
        stdoutBytes: 0,
        stderrBytes: 0,
        usage: { totalTokens: 11, sources: ["test"] },
      };
    });

    assert.equal(result.accepted, true);
    assert.equal(result.transaction?.status, "completed");
    assert.equal((await loadToolRequests(dir))[0]?.status, "completed");
    const budgets = (await loadState(dir)).budgets as { usage: { contextTokens?: number } };
    assert.equal(budgets.usage.contextTokens, 11);
  });
});

test("runToolRequestAgent rejects duplicate proposals for one execution", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    const prepared = await prepareToolRequest(dir, state, { toolName: "docs_search", request: "Find docs." });
    assert.ok(prepared.record);

    const result = await runToolRequestAgent(dir, state, { requestId: prepared.record.id, execute: true }, async (request) => {
      for (const summary of ["First proposal.", "Second proposal."]) {
        await recordToolResult(dir, state, {
          requestId: prepared.record!.id,
          executionId: request.executionId,
          status: "completed",
          summary,
          outputs: { ok: true },
        });
      }
      return { taskId: request.taskId, exitCode: 0, stdoutEvents: [], stderr: "", timedOut: false, aborted: false, stdoutBytes: 0, stderrBytes: 0 };
    });

    assert.equal(result.accepted, false);
    assert.equal(result.transaction?.status, "blocked");
    assert.deepEqual((await loadToolResults(dir)).map((candidate) => candidate.acceptanceStatus), ["rejected", "rejected"]);
  });
});

test("runToolRequestAgent refuses a concurrent execution claim for one request", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    const prepared = await prepareToolRequest(dir, state, { toolName: "docs_search", request: "Find docs." });
    assert.ok(prepared.record);
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    let releaseFirst!: () => void;
    const release = new Promise<void>((resolve) => { releaseFirst = resolve; });

    const first = runToolRequestAgent(dir, state, { requestId: prepared.record.id, execute: true }, async (request) => {
      markStarted();
      await release;
      await recordToolResult(dir, state, {
        requestId: prepared.record!.id,
        executionId: request.executionId,
        status: "completed",
        summary: "First execution completed.",
        outputs: { ok: true },
      });
      return { taskId: request.taskId, exitCode: 0, stdoutEvents: [], stderr: "", timedOut: false, aborted: false, stdoutBytes: 0, stderrBytes: 0 };
    });
    await started;
    let secondRunnerCalled = false;
    const second = await runToolRequestAgent(dir, state, { requestId: prepared.record.id, execute: true }, async (request) => {
      secondRunnerCalled = true;
      return { taskId: request.taskId, exitCode: 0, stdoutEvents: [], stderr: "", timedOut: false, aborted: false, stdoutBytes: 0, stderrBytes: 0 };
    });
    releaseFirst();
    const completed = await first;

    assert.equal(second.accepted, false);
    assert.equal(second.transaction?.status, "rejected");
    assert.match(second.message, /already has active execution/);
    assert.equal(secondRunnerCalled, false);
    assert.equal(completed.accepted, true);
    assert.equal((await loadToolRequests(dir))[0]?.activeExecutionId, undefined);
  });
});

test("runToolRequestAgent treats free-form or missing structured result as incomplete", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    const prepared = await prepareToolRequest(dir, state, {
      toolName: "docs_search",
      request: "Find widget docs.",
      allowedTools: ["read"],
    }, new Date("2026-01-01T00:00:00.000Z"));
    assert.ok(prepared.record);

    const result = await runToolRequestAgent(dir, state, { requestId: prepared.record.id, execute: true }, async (request) => ({
      taskId: request.taskId,
      exitCode: 0,
      stdoutEvents: [{ type: "unparsed", text: "I found it in prose only." }],
      stderr: "",
      timedOut: false,
      aborted: false,
      stdoutBytes: 0,
      stderrBytes: 0,
    }));

    assert.equal(result.accepted, false);
    assert.equal(result.transaction?.status, "blocked");
    assert.equal((await loadToolRequests(dir))[0]?.status, "blocked");
    assert.equal((await loadToolResults(dir)).length, 0);
  });
});

test("replayToolTransaction prepares a replay linked to the original", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    const prepared = await prepareToolRequest(dir, state, { toolName: "docs_search", request: "Find docs.", allowedTools: ["read"] });
    assert.ok(prepared.record);
    const original = await runToolRequestAgent(dir, state, { requestId: prepared.record.id });
    assert.ok(original.transaction);

    const replay = await replayToolTransaction(dir, state, { transactionId: original.transaction.id });

    assert.equal(replay.accepted, true);
    assert.equal(replay.transaction?.status, "prepared");
    assert.equal(replay.transaction?.replayOfTransactionId, original.transaction.id);
    assert.match(formatToolTransactions(await loadToolTransactions(dir)), /replayOf=/);
  });
});

test("replayToolTransaction executes persisted invocation and recognizes structured closure", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    const prepared = await prepareToolRequest(dir, state, { toolName: "docs_search", request: "Find docs.", allowedTools: ["read"] });
    assert.ok(prepared.record);
    const original = await runToolRequestAgent(dir, state, { requestId: prepared.record.id, execute: true }, async (request) => ({
      taskId: request.taskId,
      exitCode: 0,
      stdoutEvents: [{ type: "unparsed", text: "prose only" }],
      stderr: "",
      timedOut: false,
      aborted: false,
      stdoutBytes: 0,
      stderrBytes: 0,
    }));
    assert.equal(original.transaction?.status, "blocked");
    const approval = await createToolReplayApproval(dir, state, { transactionId: original.transaction!.id, reason: "Explicit retry after ambiguous result" });

    const replay = await replayToolTransaction(dir, state, { transactionId: original.transaction!.id, execute: true, approvalId: approval.id }, async (request) => {
      assert.match(request.prompt, /Tool request id:/);
      assert.deepEqual(request.tools, ["docs_search", "read"]);
      await recordToolResult(dir, state, {
        requestId: prepared.record!.id,
        executionId: request.executionId,
        status: "completed",
        summary: "Found docs.",
        outputs: { refs: ["docs-widget"] },
        validationPerformed: ["checked replay output"],
      });
      return { taskId: request.taskId, exitCode: 0, stdoutEvents: [], stderr: "", timedOut: false, aborted: false, stdoutBytes: 0, stderrBytes: 0 };
    });

    assert.equal(replay.accepted, true);
    assert.equal(replay.transaction?.status, "completed");
    assert.equal(replay.transaction?.replayOfTransactionId, original.transaction?.id);
    assert.equal((await loadToolRequests(dir))[0]?.status, "completed");
  });
});

test("replayToolTransaction refuses execute for closed requests", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    const prepared = await prepareToolRequest(dir, state, { toolName: "docs_search", request: "Find docs.", allowedTools: ["read"] });
    assert.ok(prepared.record);
    const original = await runToolRequestAgent(dir, state, { requestId: prepared.record.id, execute: true }, async (request) => {
      await recordToolResult(dir, state, { requestId: prepared.record!.id, executionId: request.executionId, status: "completed", summary: "Done.", outputs: { ok: true } });
      return { taskId: request.taskId, exitCode: 0, stdoutEvents: [], stderr: "", timedOut: false, aborted: false, stdoutBytes: 0, stderrBytes: 0 };
    });

    const replay = await replayToolTransaction(dir, state, { transactionId: original.transaction!.id, execute: true });

    assert.equal(replay.accepted, false);
    assert.equal(replay.transaction?.status, "rejected");
    assert.match(replay.message, /is completed/);
    assert.match(replay.message, /no approval supplied/);
  });
});

test("tool replay approvals can be created, listed, revoked, and validated", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    const prepared = await prepareToolRequest(dir, state, { toolName: "docs_search", request: "Find docs.", allowedTools: ["read"] });
    assert.ok(prepared.record);
    const original = await runToolRequestAgent(dir, state, { requestId: prepared.record.id, execute: true }, async (request) => {
      await recordToolResult(dir, state, { requestId: prepared.record!.id, executionId: request.executionId, status: "completed", summary: "Done.", outputs: { ok: true } });
      return { taskId: request.taskId, exitCode: 0, stdoutEvents: [], stderr: "", timedOut: false, aborted: false, stdoutBytes: 0, stderrBytes: 0 };
    });
    assert.ok(original.transaction);

    const approval = await createToolReplayApproval(dir, state, {
      transactionId: original.transaction.id,
      reason: "Audit follow-up",
      maxUses: 2,
      ttlMinutes: 30,
    }, new Date("2026-01-01T00:00:00.000Z"));

    assert.equal(approval.status, "active");
    assert.equal(approval.maxUses, 2);
    assert.equal(approval.uses, 0);
    assert.equal(approval.expiresAt, "2026-01-01T00:30:00.000Z");
    assert.match(formatToolReplayApprovals(await loadToolReplayApprovals(dir)), /Audit follow-up/);

    const revoked = await revokeToolReplayApproval(dir, state, { id: approval.id, reason: "No longer needed" }, new Date("2026-01-01T00:01:00.000Z"));
    assert.equal(revoked.status, "revoked");
    assert.equal((await loadToolReplayApprovals(dir))[0]?.revokedReason, "No longer needed");
  });
});

test("replayToolTransaction executes closed requests only with a matching approval", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    const prepared = await prepareToolRequest(dir, state, { toolName: "docs_search", request: "Find docs.", allowedTools: ["read"] });
    assert.ok(prepared.record);
    const original = await runToolRequestAgent(dir, state, { requestId: prepared.record.id, execute: true }, async (request) => {
      await recordToolResult(dir, state, { requestId: prepared.record!.id, executionId: request.executionId, status: "completed", summary: "Done.", outputs: { ok: true } });
      return { taskId: request.taskId, exitCode: 0, stdoutEvents: [], stderr: "", timedOut: false, aborted: false, stdoutBytes: 0, stderrBytes: 0 };
    });
    assert.ok(original.transaction);
    const approval = await createToolReplayApproval(dir, state, { transactionId: original.transaction.id, reason: "Second pass" });

    const approved = await replayToolTransaction(dir, state, { transactionId: original.transaction.id, execute: true, approvalId: approval.id }, async (request) => {
      await recordToolResult(dir, state, { requestId: prepared.record!.id, executionId: request.executionId, status: "completed", summary: "Replay done.", outputs: { replay: true } });
      return { taskId: request.taskId, exitCode: 0, stdoutEvents: [], stderr: "", timedOut: false, aborted: false, stdoutBytes: 0, stderrBytes: 0 };
    });

    assert.equal(approved.accepted, true);
    assert.equal(approved.transaction?.status, "completed");
    assert.equal(approved.transaction?.replayOfTransactionId, original.transaction.id);
    const consumed = (await loadToolReplayApprovals(dir))[0];
    assert.equal(consumed?.status, "consumed");
    assert.equal(consumed?.uses, 1);
    assert.deepEqual(consumed?.consumedByTransactionIds, [approved.transaction?.id]);

    const second = await replayToolTransaction(dir, state, { transactionId: original.transaction.id, execute: true, approvalId: approval.id });
    assert.equal(second.accepted, false);
    assert.match(second.message, /approval .* is not usable/);
  });
});

test("replayToolTransaction obtains fresh live admission before consuming approval", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    const prepared = await prepareToolRequest(dir, state, { toolName: "docs_search", request: "Find docs.", allowedTools: ["read"] });
    assert.ok(prepared.record);
    const original = await runToolRequestAgent(dir, state, { requestId: prepared.record.id, execute: true }, async (request) => {
      await recordToolResult(dir, state, {
        requestId: prepared.record!.id,
        executionId: request.executionId,
        status: "completed",
        summary: "Done.",
        outputs: { ok: true },
      });
      return { taskId: request.taskId, exitCode: 0, stdoutEvents: [], stderr: "", timedOut: false, aborted: false, stdoutBytes: 0, stderrBytes: 0 };
    });
    assert.ok(original.transaction);
    const approval = await createToolReplayApproval(dir, state, { transactionId: original.transaction.id, reason: "Fresh dispatch check" });
    let runnerCalled = false;

    const refused = await replayToolTransactionRaw(dir, state, {
      transactionId: original.transaction.id,
      execute: true,
      approvalId: approval.id,
    }, async (request) => {
      runnerCalled = true;
      return { taskId: request.taskId, exitCode: 0, stdoutEvents: [], stderr: "", timedOut: false, aborted: false, stdoutBytes: 0, stderrBytes: 0 };
    });

    assert.equal(refused.accepted, false);
    assert.equal(runnerCalled, false);
    assert.match(refused.message, /live route evidence supplier is required/i);
    const unconsumed = (await loadToolReplayApprovals(dir))[0];
    assert.equal(unconsumed?.status, "active");
    assert.equal(unconsumed?.uses, 0);
    assert.deepEqual(unconsumed?.consumedByTransactionIds ?? [], []);

    let suppliedExecutionId: string | undefined;
    const replayed = await replayToolTransactionRaw(dir, state, {
      transactionId: original.transaction.id,
      execute: true,
      approvalId: approval.id,
      routeEvidenceSupplier: (basis) => {
        suppliedExecutionId = basis.executionId;
        return admittedRouteEvidenceSupplier(basis);
      },
    }, async (request) => {
      await recordToolResult(dir, state, {
        requestId: prepared.record!.id,
        executionId: request.executionId,
        status: "completed",
        summary: "Replay done.",
        outputs: { replay: true },
      });
      return { taskId: request.taskId, exitCode: 0, stdoutEvents: [], stderr: "", timedOut: false, aborted: false, stdoutBytes: 0, stderrBytes: 0 };
    });

    assert.equal(replayed.accepted, true);
    assert.equal(suppliedExecutionId, replayed.transaction?.id);
    assert.notEqual(suppliedExecutionId, original.transaction.id);
    const consumed = (await loadToolReplayApprovals(dir))[0];
    assert.equal(consumed?.status, "consumed");
    assert.equal(consumed?.uses, 1);
    assert.deepEqual(consumed?.consumedByTransactionIds, [replayed.transaction?.id]);
  });
});

test("replayToolTransaction reserves a one-use approval before dispatch", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    const prepared = await prepareToolRequest(dir, state, { toolName: "docs_search", request: "Find docs." });
    assert.ok(prepared.record);
    const original = await runToolRequestAgent(dir, state, { requestId: prepared.record.id, execute: true }, async (request) => {
      await recordToolResult(dir, state, { requestId: prepared.record!.id, executionId: request.executionId, status: "completed", summary: "Done.", outputs: { ok: true } });
      return { taskId: request.taskId, exitCode: 0, stdoutEvents: [], stderr: "", timedOut: false, aborted: false, stdoutBytes: 0, stderrBytes: 0 };
    });
    const approval = await createToolReplayApproval(dir, state, { transactionId: original.transaction!.id, reason: "One retry" });
    let release!: () => void;
    const wait = new Promise<void>((resolve) => { release = resolve; });
    let started!: () => void;
    const didStart = new Promise<void>((resolve) => { started = resolve; });
    let runnerCalls = 0;
    const first = replayToolTransaction(dir, state, { transactionId: original.transaction!.id, execute: true, approvalId: approval.id }, async (request) => {
      runnerCalls += 1;
      assert.equal((await loadToolReplayApprovals(dir))[0]?.status, "consumed");
      started();
      await wait;
      await recordToolResult(dir, state, { requestId: prepared.record!.id, executionId: request.executionId, status: "completed", summary: "Replay done.", outputs: { ok: true } });
      return { taskId: request.taskId, exitCode: 0, stdoutEvents: [], stderr: "", timedOut: false, aborted: false, stdoutBytes: 0, stderrBytes: 0 };
    });
    await didStart;
    const second = await replayToolTransaction(dir, state, { transactionId: original.transaction!.id, execute: true, approvalId: approval.id }, async (request) => {
      runnerCalls += 1;
      return { taskId: request.taskId, exitCode: 0, stdoutEvents: [], stderr: "", timedOut: false, aborted: false, stdoutBytes: 0, stderrBytes: 0 };
    });
    release();
    const completed = await first;

    assert.equal(completed.accepted, true);
    assert.equal(second.accepted, false);
    assert.equal(runnerCalls, 1);
    const storedApproval = (await loadToolReplayApprovals(dir))[0];
    assert.equal(storedApproval?.uses, 1);
    assert.equal(storedApproval?.maxUses, 1);
  });
});

test("replayToolTransaction treats replay prose without result as missing_result", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    const prepared = await prepareToolRequest(dir, state, { toolName: "docs_search", request: "Find docs.", allowedTools: ["read"] });
    assert.ok(prepared.record);
    const original = await runToolRequestAgent(dir, state, { requestId: prepared.record.id });
    assert.ok(original.transaction);

    const replay = await replayToolTransaction(dir, state, { transactionId: original.transaction.id, execute: true }, async (request) => ({
      taskId: request.taskId,
      exitCode: 0,
      stdoutEvents: [{ type: "unparsed", text: "prose only" }],
      stderr: "",
      timedOut: false,
      aborted: false,
      stdoutBytes: 0,
      stderrBytes: 0,
    }));

    assert.equal(replay.accepted, false);
    assert.equal(replay.transaction?.status, "blocked");
    assert.equal((await loadToolRequests(dir))[0]?.status, "blocked");
  });
});

test("tool iteration policy persists bounded replay controls", async () => {
  await withTempDir(async (dir) => {
    assert.match(formatToolIterationPolicy(await loadToolIterationPolicy(dir)), /maxIterations=3 autoReplay=true/);

    const saved = await saveToolIterationPolicy(dir, { maxIterations: 12, autoReplay: false }, new Date("2026-01-01T00:00:00.000Z"));

    assert.equal(saved.maxIterations, 10);
    assert.equal(saved.autoReplay, false);
    assert.equal((await loadToolIterationPolicy(dir)).maxIterations, 10);
    assert.match(formatToolIterationPolicy(saved), /updatedAt=2026-01-01T00:00:00.000Z/);
  });
});

test("runToolIterationWorkflow prepares a bounded iteration run", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    const prepared = await prepareToolRequest(dir, state, { toolName: "docs_search", request: "Find docs.", allowedTools: ["read"] });
    assert.ok(prepared.record);

    const result = await runToolIterationWorkflow(dir, state, { requestId: prepared.record.id, maxIterations: 2 });

    assert.equal(result.accepted, true);
    assert.equal(result.run?.status, "prepared");
    assert.equal(result.run?.steps.length, 1);
    assert.equal(result.run?.maxIterations, 2);
    assert.equal((await loadToolIterationRuns(dir))[0]?.id, result.run?.id);
    assert.match(formatToolIterationRuns(await loadToolIterationRuns(dir)), /status=prepared/);
  });
});

test("runToolIterationWorkflow blocks after an ambiguous missing result without automatic replay", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    const prepared = await prepareToolRequest(dir, state, { toolName: "docs_search", request: "Find docs.", allowedTools: ["read"] });
    assert.ok(prepared.record);
    let calls = 0;

    const result = await runToolIterationWorkflow(dir, state, { requestId: prepared.record.id, execute: true, maxIterations: 3 }, async (request) => {
      calls += 1;
      return {
        taskId: request.taskId,
        exitCode: 0,
        stdoutEvents: calls === 1 ? [{ type: "unparsed", text: "prose only" }] : [],
        stderr: "",
        timedOut: false,
        aborted: false,
        stdoutBytes: 0,
        stderrBytes: 0,
      };
    });

    assert.equal(result.accepted, false);
    assert.equal(result.run?.status, "rejected");
    assert.equal(result.run?.steps.length, 1);
    assert.deepEqual(result.run?.steps.map((step) => step.action), ["run"]);
    assert.deepEqual(result.run?.steps.map((step) => step.transactionStatus), ["blocked"]);
    assert.equal((await loadToolRequests(dir))[0]?.status, "blocked");
    assert.equal((await loadToolTransactions(dir)).length, 1);
    assert.equal(calls, 1);
  });
});

test("runToolIterationWorkflow stops after the first ambiguous missing result", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    const prepared = await prepareToolRequest(dir, state, { toolName: "docs_search", request: "Find docs.", allowedTools: ["read"] });
    assert.ok(prepared.record);

    const result = await runToolIterationWorkflow(dir, state, { requestId: prepared.record.id, execute: true, maxIterations: 2 }, async (request) => ({
      taskId: request.taskId,
      exitCode: 0,
      stdoutEvents: [{ type: "unparsed", text: "still prose" }],
      stderr: "",
      timedOut: false,
      aborted: false,
      stdoutBytes: 0,
      stderrBytes: 0,
    }));

    assert.equal(result.accepted, false);
    assert.equal(result.run?.status, "rejected");
    assert.equal(result.run?.steps.length, 1);
    assert.deepEqual(result.run?.steps.map((step) => step.action), ["run"]);
    assert.equal((await loadToolRequests(dir))[0]?.status, "blocked");
  });
});

test("recordToolResult stores an unbound proposal without closing the request", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    const prepared = await prepareToolRequest(dir, state, {
      toolName: "docs_search",
      request: "Find widget docs.",
      taskId: "T-TOOL",
      allowedTools: ["read"],
    }, new Date("2026-01-01T00:00:00.000Z"));
    assert.ok(prepared.record);

    const result = await recordToolResult(dir, state, {
      requestId: prepared.record.id,
      status: "completed",
      summary: "Found widget docs.",
      outputs: { url: "https://example.invalid/widgets", api: "Widget.create" },
      evidenceRefs: ["docs:widgets", "docs:widgets", " "],
      validationPerformed: ["checked version banner"],
      recommendations: ["Use Widget.create"],
    }, new Date("2026-01-01T00:00:01.000Z"));

    assert.equal(result.requestId, prepared.record.id);
    assert.equal(result.toolName, "docs_search");
    assert.equal(result.taskId, "T-TOOL");
    assert.equal(result.status, "completed");
    assert.equal(result.acceptanceStatus, "unbound");
    assert.deepEqual(result.evidenceRefs, ["docs:widgets"]);
    assert.equal((await loadToolResults(dir))[0]?.id, result.id);
    const requests = await loadToolRequests(dir);
    assert.equal(requests[0]?.status, "prepared");
    assert.equal(requests[0]?.updatedAt, undefined);
  });
});

test("recordToolResult rejects missing request and incomplete status payloads", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    await assert.rejects(
      recordToolResult(dir, state, { requestId: "missing", status: "completed", summary: "Done", outputs: { ok: true } }),
      /request missing not found/,
    );
    const prepared = await prepareToolRequest(dir, state, { toolName: "browser", request: "Open docs." });
    assert.ok(prepared.record);
    await assert.rejects(
      recordToolResult(dir, state, { requestId: prepared.record.id, status: "completed", summary: "Done" }),
      /completed results require/,
    );
    await assert.rejects(
      recordToolResult(dir, state, { requestId: prepared.record.id, status: "blocked", summary: "Blocked" }),
      /failed\/blocked results require/,
    );
  });
});

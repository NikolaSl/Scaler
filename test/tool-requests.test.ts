import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createDefaultState } from "../src/state.js";
import {
  buildRuntimeToolCatalog,
  buildToolAgentPrompt,
  buildToolSchemaDiscoveryPrompt,
  createToolReplayApproval,
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
  replayToolTransaction,
  revokeToolReplayApproval,
  runMcpServerEnumeration,
  runToolIterationWorkflow,
  runToolRequestAgent,
  runToolSchedule,
  runToolSchemaDiscoveryAgent,
  saveToolIterationPolicy,
  selectParentRequesterActiveTools,
  shouldApplyParentToolFocus,
} from "../src/tool-requests.js";

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
      return { taskId: request.taskId, exitCode: 0, stdoutEvents: [], stderr: "", timedOut: false, aborted: false };
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
      await recordToolResult(dir, state, { requestId, status: "completed", summary: `Completed ${requestId}`, outputs: { ok: true } });
      return { taskId: request.taskId, exitCode: 0, stdoutEvents: [], stderr: "", timedOut: false, aborted: false };
    }, new Date("2026-01-01T00:00:00.000Z"));

    assert.equal(result.accepted, true);
    assert.equal(result.schedule.status, "completed");
    assert.equal(result.schedule.steps.length, 3);
    assert.deepEqual(result.schedule.steps.map((step) => step.transactionStatus), ["completed", "completed", "completed"]);
    assert.equal(order.at(-1), `tool-${serial.record.id}`);
    assert.equal((await loadToolRequests(dir)).every((request) => request.status === "completed"), true);
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
      await recordToolResult(dir, state, {
        requestId: prepared.record!.id,
        status: "completed",
        summary: `Completed ${request.taskId}`,
        outputs: { refs: ["docs:widget"] },
        validationPerformed: ["checked requested format"],
      });
      return { taskId: request.taskId, exitCode: 0, stdoutEvents: [], stderr: "", timedOut: false, aborted: false };
    });

    assert.equal(result.accepted, true);
    assert.equal(result.transaction?.status, "completed");
    assert.equal(result.resultRecord?.status, "completed");
    assert.equal((await loadToolRequests(dir))[0]?.status, "completed");
    assert.equal((await loadToolTransactions(dir))[0]?.resultId, result.resultRecord?.id);
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
    }));

    assert.equal(result.accepted, false);
    assert.equal(result.transaction?.status, "missing_result");
    assert.equal((await loadToolRequests(dir))[0]?.status, "prepared");
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
    }));
    assert.equal(original.transaction?.status, "missing_result");

    const replay = await replayToolTransaction(dir, state, { transactionId: original.transaction!.id, execute: true }, async (request) => {
      assert.match(request.prompt, /Tool request id:/);
      assert.deepEqual(request.tools, ["docs_search", "read"]);
      await recordToolResult(dir, state, {
        requestId: prepared.record!.id,
        status: "completed",
        summary: "Found docs.",
        outputs: { refs: ["docs-widget"] },
        validationPerformed: ["checked replay output"],
      });
      return { taskId: request.taskId, exitCode: 0, stdoutEvents: [], stderr: "", timedOut: false, aborted: false };
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
      await recordToolResult(dir, state, { requestId: prepared.record!.id, status: "completed", summary: "Done.", outputs: { ok: true } });
      return { taskId: request.taskId, exitCode: 0, stdoutEvents: [], stderr: "", timedOut: false, aborted: false };
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
      await recordToolResult(dir, state, { requestId: prepared.record!.id, status: "completed", summary: "Done.", outputs: { ok: true } });
      return { taskId: request.taskId, exitCode: 0, stdoutEvents: [], stderr: "", timedOut: false, aborted: false };
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
      await recordToolResult(dir, state, { requestId: prepared.record!.id, status: "completed", summary: "Done.", outputs: { ok: true } });
      return { taskId: request.taskId, exitCode: 0, stdoutEvents: [], stderr: "", timedOut: false, aborted: false };
    });
    assert.ok(original.transaction);
    const approval = await createToolReplayApproval(dir, state, { transactionId: original.transaction.id, reason: "Second pass" });

    const approved = await replayToolTransaction(dir, state, { transactionId: original.transaction.id, execute: true, approvalId: approval.id }, async (request) => {
      await recordToolResult(dir, state, { requestId: prepared.record!.id, status: "completed", summary: "Replay done.", outputs: { replay: true } });
      return { taskId: request.taskId, exitCode: 0, stdoutEvents: [], stderr: "", timedOut: false, aborted: false };
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
    }));

    assert.equal(replay.accepted, false);
    assert.equal(replay.transaction?.status, "missing_result");
    assert.equal((await loadToolRequests(dir))[0]?.status, "prepared");
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

test("runToolIterationWorkflow replays missing structured results until closure", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    const prepared = await prepareToolRequest(dir, state, { toolName: "docs_search", request: "Find docs.", allowedTools: ["read"] });
    assert.ok(prepared.record);
    let calls = 0;

    const result = await runToolIterationWorkflow(dir, state, { requestId: prepared.record.id, execute: true, maxIterations: 3 }, async (request) => {
      calls += 1;
      if (calls === 2) {
        await recordToolResult(dir, state, {
          requestId: prepared.record!.id,
          status: "completed",
          summary: "Found docs after replay.",
          outputs: { refs: ["docs:widget"] },
          validationPerformed: ["checked replay output"],
        });
      }
      return {
        taskId: request.taskId,
        exitCode: 0,
        stdoutEvents: calls === 1 ? [{ type: "unparsed", text: "prose only" }] : [],
        stderr: "",
        timedOut: false,
        aborted: false,
      };
    });

    assert.equal(result.accepted, true);
    assert.equal(result.run?.status, "completed");
    assert.equal(result.run?.steps.length, 2);
    assert.deepEqual(result.run?.steps.map((step) => step.action), ["run", "replay"]);
    assert.deepEqual(result.run?.steps.map((step) => step.transactionStatus), ["missing_result", "completed"]);
    assert.equal((await loadToolRequests(dir))[0]?.status, "completed");
    assert.equal((await loadToolTransactions(dir)).length, 2);
  });
});

test("runToolIterationWorkflow records exhaustion after capped missing results", async () => {
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
    }));

    assert.equal(result.accepted, false);
    assert.equal(result.run?.status, "exhausted");
    assert.equal(result.run?.steps.length, 2);
    assert.deepEqual(result.run?.steps.map((step) => step.action), ["run", "replay"]);
    assert.equal((await loadToolRequests(dir))[0]?.status, "prepared");
  });
});

test("recordToolResult stores structured results and closes the request", async () => {
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
    assert.deepEqual(result.evidenceRefs, ["docs:widgets"]);
    assert.equal((await loadToolResults(dir))[0]?.id, result.id);
    const requests = await loadToolRequests(dir);
    assert.equal(requests[0]?.status, "completed");
    assert.equal(requests[0]?.updatedAt, "2026-01-01T00:00:01.000Z");
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

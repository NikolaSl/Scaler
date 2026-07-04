import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createDefaultState } from "../src/state.js";
import {
  buildToolAgentPrompt,
  formatToolCatalog,
  getToolCatalogEntries,
  loadToolRequests,
  loadToolResults,
  loadToolTransactions,
  normalizeToolRiskLevel,
  prepareToolRequest,
  recordToolResult,
  recordToolSchema,
  runToolRequestAgent,
  formatDiscoveredToolCatalog,
  formatToolTransactions,
  loadToolSchemaRecords,
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

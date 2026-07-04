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
  normalizeToolRiskLevel,
  prepareToolRequest,
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

/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { getBudgetState } from "../../../src/budgets.js";
import { readLogEvents } from "../../../src/logging.js";
import { createDefaultState, loadState } from "../../../src/state.js";
import { createToolReplayApproval, loadMcpServerRecords, loadToolIterationRuns, loadToolReplayApprovals, loadToolRequests, loadToolResults, loadToolSchedules, loadToolSchemaDiscoveryRuns, loadToolTransactions, prepareToolRequest, recordToolResult, recordToolSchema, replayToolTransaction, runMcpServerEnumeration, runToolIterationWorkflow, runToolRequestAgent, runToolSchedule, runToolSchemaDiscoveryAgent } from "../../../src/tool-requests.js";
import { registerScalerTools } from "../../../src/tools.js";

const execFileAsync = promisify(execFile);

async function withTempRepo<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-tool-request-integration-test-"));
  try {
    await execFileAsync("git", ["init"], { cwd: dir });
    await execFileAsync("git", ["config", "user.email", "scaler-test@example.invalid"], { cwd: dir });
    await execFileAsync("git", ["config", "user.name", "Scaler Test"], { cwd: dir });
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "package.json"), JSON.stringify({ type: "module" }, null, 2));
    await writeFile(join(dir, "src/app.js"), "export const value = 1;\n");
    await execFileAsync("git", ["add", "package.json", "src/app.js"], { cwd: dir });
    await execFileAsync("git", ["commit", "-m", "initial fixture"], { cwd: dir });
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("mock integration: MCP enumeration records local server declarations", async () => {
  await withTempRepo(async (dir) => {
    await writeFile(join(dir, ".mcp.json"), JSON.stringify({
      mcpServers: {
        docs: { command: "node", args: ["docs-mcp.js"], env: { DOCS_TOKEN: "do-not-store" } },
        remoteDocs: { url: "https://example.invalid/mcp?key=secret" },
      },
    }, null, 2));
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));

    const result = await runMcpServerEnumeration(dir, state, new Date("2026-01-01T00:00:00.000Z"));

    assert.equal(result.accepted, true);
    assert.equal(result.run.discoveredCount, 2);
    const records = await loadMcpServerRecords(dir);
    assert.equal(records.length, 2);
    assert.ok(records.some((record) => record.name === "docs" && record.transport === "stdio" && record.envKeys?.includes("DOCS_TOKEN")));
    assert.ok(records.some((record) => record.name === "remoteDocs" && record.riskLevel === "external" && record.url?.includes("<redacted>")));
    assert.doesNotMatch(JSON.stringify(records), /do-not-store|key=secret/);
    const events = await readLogEvents(dir);
    assert.ok(events.some((event) => event.eventType === "tool" && event.summary.startsWith("MCP enumeration completed")));
  });
});

test("mock integration: tool schedule executes safe parallel batch and serial risky request", async () => {
  await withTempRepo(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    await recordToolSchema(dir, state, { toolName: "docs_search", source: "mock", riskLevel: "low", description: "Read-only docs search." });
    const a = await prepareToolRequest(dir, state, { toolName: "docs_search", request: "Find A.", taskId: "T-SCHED-A", riskLevel: "low" });
    const b = await prepareToolRequest(dir, state, { toolName: "read", request: "Read file.", taskId: "T-SCHED-B", riskLevel: "low" });
    const c = await prepareToolRequest(dir, state, { toolName: "bash", request: "Run command.", taskId: "T-SCHED-C", riskLevel: "high" });
    assert.ok(a.record && b.record && c.record);

    const result = await runToolSchedule(dir, state, { execute: true, parallelism: 2 }, async (request) => {
      const requestId = request.taskId.replace(/^tool-/, "");
      await recordToolResult(dir, state, { requestId, status: "completed", summary: `Completed ${requestId}`, outputs: { ok: true } });
      return { taskId: request.taskId, exitCode: 0, stdoutEvents: [], stderr: "", timedOut: false, aborted: false };
    });

    assert.equal(result.accepted, true);
    assert.equal(result.schedule.status, "completed");
    assert.deepEqual(result.schedule.parallelRequestIds.sort(), [a.record.id, b.record.id].sort());
    assert.deepEqual(result.schedule.serialRequestIds, [c.record.id]);
    assert.equal((await loadToolSchedules(dir))[0]?.id, result.schedule.id);
    assert.equal((await loadToolTransactions(dir)).length, 3);
    assert.equal((await loadToolRequests(dir)).every((request) => request.status === "completed"), true);
    const events = await readLogEvents(dir);
    assert.ok(events.some((event) => event.eventType === "tool" && event.summary.startsWith("Tool schedule completed")));
  });
});

test("mock integration: schema discovery probe feeds later request and transaction prompts", async () => {
  await withTempRepo(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));

    const discovery = await runToolSchemaDiscoveryAgent(dir, state, { toolName: "mcp_docs_search", execute: true, tools: ["read"] }, async (request) => {
      assert.deepEqual(request.tools, ["scaler_tool_schema", "read"]);
      assert.match(request.prompt, /Do not assume the target tool/);
      await recordToolSchema(dir, state, {
        toolName: "mcp_docs_search",
        source: "mock-schema-source",
        description: "Search project docs with a query argument.",
        riskLevel: "low",
        docsRef: "docs-mcp-search",
        schemaRef: "schema-mcp-search-v1",
        notes: "args query string required",
        evidenceRefs: ["docs_mcp_search"],
        discoveredByAgentId: request.taskId,
      });
      return { taskId: request.taskId, exitCode: 0, stdoutEvents: [], stderr: "", timedOut: false, aborted: false };
    });

    assert.equal(discovery.accepted, true);
    assert.equal(discovery.run?.status, "completed");
    assert.equal((await loadToolSchemaDiscoveryRuns(dir))[0]?.schemaRecordId, discovery.schemaRecord?.id);

    const prepared = await prepareToolRequest(dir, state, {
      toolName: "mcp_docs_search",
      request: "Find widget lifecycle docs.",
      allowedTools: ["read"],
    });
    assert.match(prepared.prompt ?? "", /schemaRef=schema-mcp-search-v1/);

    const transaction = await runToolRequestAgent(dir, state, { requestId: prepared.record?.id });
    assert.match(transaction.prompt ?? "", /Search project docs with a query argument/);
    assert.match(transaction.prompt ?? "", /args query string required/);
  });
});

test("mock integration: tool transaction execution requires structured scaler_tool_result closure", async () => {
  await withTempRepo(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    await recordToolSchema(dir, state, {
      toolName: "mcp_docs_search",
      source: "mcp://docs/schema",
      description: "Search project docs with a query argument.",
      riskLevel: "low",
      docsRef: "docs:mcp-search",
      schemaRef: "schema:mcp-search-v1",
      notes: "args: { query: string }",
      evidenceRefs: ["docs:mcp-search"],
      discoveredByAgentId: "mock-schema-agent",
    });
    const prepared = await prepareToolRequest(dir, state, {
      toolName: "mcp_docs_search",
      request: "Find the widget lifecycle API.",
      taskId: "T-TOOL-TXN",
      expectedOutput: "Widget lifecycle API names and source refs.",
      requiredFormat: "JSON with fields apiNames and refs",
      riskLevel: "low",
      allowedTools: ["read"],
    });
    assert.ok(prepared.record);
    assert.match(prepared.prompt ?? "", /schemaRef=schema:mcp-search-v1/);
    assert.match(prepared.prompt ?? "", /args: \{ query: string \}/);

    const missing = await runToolRequestAgent(dir, state, { requestId: prepared.record.id, execute: true }, async (request) => ({
      taskId: request.taskId,
      exitCode: 0,
      stdoutEvents: [{ type: "unparsed", text: "Free-form answer only." }],
      stderr: "",
      timedOut: false,
      aborted: false,
    }));
    assert.equal(missing.accepted, false);
    assert.equal(missing.transaction?.status, "missing_result");
    assert.equal((await loadToolRequests(dir))[0]?.status, "prepared");

    const completed = await replayToolTransaction(dir, state, { transactionId: missing.transaction!.id, execute: true }, async (request) => {
      assert.match(request.prompt, /scaler_tool_result/);
      assert.match(request.prompt, /Required format: JSON with fields apiNames and refs/);
      assert.match(request.prompt, /Search project docs with a query argument/);
      assert.match(request.prompt, /schemaRef=schema:mcp-search-v1/);
      await recordToolResult(dir, state, {
        requestId: prepared.record!.id,
        status: "completed",
        summary: "Widget lifecycle API located.",
        outputs: { apiNames: ["Widget.create", "Widget.destroy"], refs: ["docs:widget-lifecycle"] },
        evidenceRefs: ["docs:widget-lifecycle"],
        validationPerformed: ["checked requested requiredFormat"],
      });
      return { taskId: request.taskId, exitCode: 0, stdoutEvents: [], stderr: "", timedOut: false, aborted: false };
    });

    assert.equal(completed.accepted, true);
    assert.equal(completed.transaction?.status, "completed");
    assert.equal(completed.transaction?.replayOfTransactionId, missing.transaction?.id);
    assert.equal(completed.resultRecord?.status, "completed");
    assert.equal((await loadToolRequests(dir))[0]?.status, "completed");
    const transactions = await loadToolTransactions(dir);
    assert.equal(transactions[0]?.status, "completed");
    assert.equal(transactions[0]?.replayOfTransactionId, missing.transaction?.id);
    assert.equal(transactions[1]?.status, "missing_result");
    assert.equal(transactions[0]?.resultId, completed.resultRecord?.id);

    const events = await readLogEvents(dir);
    assert.ok(events.some((event) => event.eventType === "tool" && event.summary.startsWith("Tool transaction missing structured result")));
    assert.ok(events.some((event) => event.eventType === "tool" && event.summary.startsWith("Tool transaction replay completed")));
  });
});

test("mock integration: closed tool replay requires explicit approval and consumes it", async () => {
  await withTempRepo(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    const prepared = await prepareToolRequest(dir, state, {
      toolName: "mcp_docs_search",
      request: "Find the widget lifecycle API.",
      taskId: "T-TOOL-CLOSED-REPLAY",
      expectedOutput: "Widget lifecycle API names and source refs.",
      requiredFormat: "JSON with fields apiNames and refs",
      riskLevel: "low",
      allowedTools: ["read"],
    });
    assert.ok(prepared.record);

    const original = await runToolRequestAgent(dir, state, { requestId: prepared.record.id, execute: true }, async (request) => {
      await recordToolResult(dir, state, {
        requestId: prepared.record!.id,
        status: "completed",
        summary: "Widget lifecycle API located.",
        outputs: { apiNames: ["Widget.create"], refs: ["docs:widget-lifecycle"] },
        validationPerformed: ["checked requested requiredFormat"],
      });
      return { taskId: request.taskId, exitCode: 0, stdoutEvents: [], stderr: "", timedOut: false, aborted: false };
    });
    assert.ok(original.transaction);

    const rejected = await replayToolTransaction(dir, state, { transactionId: original.transaction.id, execute: true });
    assert.equal(rejected.accepted, false);
    assert.equal(rejected.transaction?.status, "rejected");

    const approval = await createToolReplayApproval(dir, state, { transactionId: original.transaction.id, reason: "Validate second source", maxUses: 1 });
    const approved = await replayToolTransaction(dir, state, { transactionId: original.transaction.id, execute: true, approvalId: approval.id }, async (request) => {
      assert.match(request.prompt, /Required format: JSON with fields apiNames and refs/);
      await recordToolResult(dir, state, {
        requestId: prepared.record!.id,
        status: "completed",
        summary: "Widget lifecycle API validated by replay.",
        outputs: { apiNames: ["Widget.create", "Widget.destroy"], refs: ["docs:widget-lifecycle", "docs:widget-cleanup"] },
        evidenceRefs: ["docs:widget-cleanup"],
        validationPerformed: ["checked replay output"],
      });
      return { taskId: request.taskId, exitCode: 0, stdoutEvents: [], stderr: "", timedOut: false, aborted: false };
    });

    assert.equal(approved.accepted, true);
    assert.equal(approved.transaction?.status, "completed");
    assert.equal(approved.transaction?.replayOfTransactionId, original.transaction.id);
    const consumed = (await loadToolReplayApprovals(dir))[0];
    assert.equal(consumed?.status, "consumed");
    assert.equal(consumed?.uses, 1);
    assert.deepEqual(consumed?.consumedByTransactionIds, [approved.transaction?.id]);
    const events = await readLogEvents(dir);
    assert.ok(events.some((event) => event.eventType === "tool" && event.summary.startsWith("Tool replay approval created")));
    assert.ok(events.some((event) => event.eventType === "tool" && event.summary.startsWith("Tool transaction replay completed")));
  });
});

test("mock integration: tool iteration workflow corrects missing structured result with replay", async () => {
  await withTempRepo(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    await recordToolSchema(dir, state, {
      toolName: "mcp_docs_search",
      source: "mcp://docs/schema",
      description: "Search project docs with a query argument.",
      riskLevel: "low",
      docsRef: "docs:mcp-search",
      schemaRef: "schema:mcp-search-v1",
      notes: "args: { query: string }",
    });
    const prepared = await prepareToolRequest(dir, state, {
      toolName: "mcp_docs_search",
      request: "Find the widget lifecycle API.",
      taskId: "T-TOOL-ITERATE",
      expectedOutput: "Widget lifecycle API names and source refs.",
      requiredFormat: "JSON with fields apiNames and refs",
      riskLevel: "low",
      allowedTools: ["read"],
    });
    assert.ok(prepared.record);
    let calls = 0;

    const result = await runToolIterationWorkflow(dir, state, { requestId: prepared.record.id, execute: true, maxIterations: 3 }, async (request) => {
      calls += 1;
      assert.match(request.prompt, /scaler_tool_result/);
      assert.match(request.prompt, /schemaRef=mcp-search-v1|schema:mcp-search-v1/);
      if (calls === 2) {
        await recordToolResult(dir, state, {
          requestId: prepared.record!.id,
          status: "completed",
          summary: "Widget lifecycle API located after replay.",
          outputs: { apiNames: ["Widget.create", "Widget.destroy"], refs: ["docs:widget-lifecycle"] },
          evidenceRefs: ["docs:widget-lifecycle"],
          validationPerformed: ["checked requested requiredFormat"],
        });
      }
      return {
        taskId: request.taskId,
        exitCode: 0,
        stdoutEvents: calls === 1 ? [{ type: "unparsed", text: "Free-form answer only." }] : [],
        stderr: "",
        timedOut: false,
        aborted: false,
      };
    });

    assert.equal(result.accepted, true);
    assert.equal(result.run?.status, "completed");
    assert.deepEqual(result.run?.steps.map((step) => step.action), ["run", "replay"]);
    assert.deepEqual(result.run?.steps.map((step) => step.transactionStatus), ["missing_result", "completed"]);
    assert.equal((await loadToolIterationRuns(dir))[0]?.status, "completed");
    assert.equal((await loadToolRequests(dir))[0]?.status, "completed");
    const transactions = await loadToolTransactions(dir);
    assert.equal(transactions.length, 2);
    assert.equal(transactions[0]?.status, "completed");
    assert.equal(transactions[1]?.status, "missing_result");
    const events = await readLogEvents(dir);
    assert.ok(events.some((event) => event.eventType === "tool" && event.summary.startsWith("Tool iteration completed")));
  });
});

test("mock integration: scaler_tool_request persists rich metadata and isolated invocation", async () => {
  await withTempRepo(async (dir) => {
    const registered = new Map<string, { execute: (...args: any[]) => Promise<unknown> }>();
    registerScalerTools({ registerTool(definition: { name: string; execute: (...args: any[]) => Promise<unknown> }) { registered.set(definition.name, definition); } } as never);

    const result = await registered.get("scaler_tool_request")?.execute(
      "tool-call",
      {
        toolName: "docs_search",
        request: "Find the widget lifecycle API.",
        taskId: "T-TOOL-FLOW",
        requesterAgentId: "stage-agent-planning",
        contextSummary: "Need docs for a planned implementation task.",
        expectedOutput: "Widget lifecycle API names and source refs.",
        requiredFormat: "JSON with fields apiNames and refs",
        riskLevel: "low",
        permissionRequirement: "read-only docs access",
        safetyNotes: "Do not call bash or mutate files.",
        allowedTools: ["read"],
      },
      undefined,
      undefined,
      { cwd: dir },
    ) as { details?: { invocation?: { args?: string[] } } } | undefined;

    const record = (await loadToolRequests(dir))[0];
    assert.equal(record?.requesterAgentId, "stage-agent-planning");
    assert.equal(record?.expectedOutput, "Widget lifecycle API names and source refs.");
    assert.equal(record?.requiredFormat, "JSON with fields apiNames and refs");
    assert.equal(record?.riskLevel, "low");
    assert.deepEqual(record?.allowedTools, ["docs_search", "read"]);

    const args = result?.details?.invocation?.args ?? [];
    assert.ok(args.includes("--tools"));
    assert.ok(args.includes("docs_search,read"));
    assert.ok(!args.includes("bash"));
    const prompt = args.at(-1) ?? "";
    assert.match(prompt, /Tool catalog:/);
    assert.match(prompt, /docs_search: Requested tool\/MCP/);
    assert.match(prompt, /read: Read a project file/);
    assert.match(prompt, /Expected output: Widget lifecycle API names and source refs/);
    assert.match(prompt, /Required format: JSON with fields apiNames and refs/);
    assert.match(prompt, /Do not call bash or mutate files/);
    assert.doesNotMatch(prompt, /write: Create or overwrite/);

    await registered.get("scaler_tool_result")?.execute(
      "tool-result-call",
      {
        requestId: record.id,
        status: "completed",
        summary: "Widget lifecycle API located.",
        outputs: { apiNames: ["Widget.create", "Widget.destroy"], refs: ["docs:widget-lifecycle"] },
        evidenceRefs: ["docs:widget-lifecycle"],
        validationPerformed: ["checked requested requiredFormat"],
        recommendations: ["Use Widget.destroy in cleanup paths."],
      },
      undefined,
      undefined,
      { cwd: dir },
    );

    const resultRecord = (await loadToolResults(dir))[0];
    const updatedRequest = (await loadToolRequests(dir))[0];
    assert.equal(resultRecord?.requestId, record.id);
    assert.equal(resultRecord?.status, "completed");
    assert.deepEqual(resultRecord?.validationPerformed, ["checked requested requiredFormat"]);
    assert.equal(updatedRequest?.status, "completed");

    assert.equal(getBudgetState(await loadState(dir)).usage.toolCalls, 2);
    const events = await readLogEvents(dir);
    assert.ok(events.some((event) => event.eventType === "tool" && event.summary === "Tool request prepared: docs_search"));
    assert.ok(events.some((event) => event.eventType === "tool" && event.summary === "Tool result recorded: docs_search completed"));
  });
});

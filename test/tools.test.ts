/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { getBudgetState } from "../src/budgets.js";
import { readLogEvents } from "../src/logging.js";
import { loadMemoryIndex } from "../src/memory.js";
import { loadExecutionPlan, loadPlanningReports } from "../src/plans.js";
import { loadCurrentPrd, loadPrdCoverage, loadPrdRequirements } from "../src/prd.js";
import { loadResearchReports } from "../src/research.js";
import { loadState } from "../src/state.js";
import { loadTaskAgentReports } from "../src/task-reports.js";
import { loadToolRequests, loadToolResults, loadToolSchemaRecords } from "../src/tool-requests.js";
import { scalerToolNames, registerScalerTools } from "../src/tools.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-tools-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("scalerToolNames lists structured Scaler tools", () => {
  assert.deepEqual([...scalerToolNames], [
    "scaler_report",
    "scaler_memory_write",
    "scaler_memory_retrieve",
    "scaler_memory_search",
    "scaler_research_report",
    "scaler_task_report",
    "scaler_spawn_task",
    "scaler_tool_request",
    "scaler_tool_schema",
    "scaler_tool_result",
    "scaler_task_create",
    "scaler_task_update",
    "scaler_planning_report",
    "scaler_prd_write",
    "scaler_prd_requirement_update",
    "scaler_validation_manifest_write",
    "scaler_validation_report",
    "scaler_debug_attempt",
  ]);
});

test("registerScalerTools registers all tool definitions", () => {
  const registered: string[] = [];
  const fakePi = {
    registerTool(definition: { name: string }) {
      registered.push(definition.name);
    },
  };

  registerScalerTools(fakePi as never);

  assert.deepEqual(registered, [...scalerToolNames]);
});

test("scaler_task_create records stable audit summary when quality metadata is complete", async () => {
  await withTempDir(async (dir) => {
    const registered = new Map<string, { execute: (...args: any[]) => Promise<unknown> }>();
    registerScalerTools({ registerTool(definition: { name: string; execute: (...args: any[]) => Promise<unknown> }) { registered.set(definition.name, definition); } } as never);

    await registered.get("scaler_task_create")?.execute(
      "tool-call",
      {
        taskId: "T-AUDIT",
        title: "Audit stable task create",
        status: "ready",
        taskKind: "software",
        atomicityRationale: "T-AUDIT is independently completable and testable.",
        allowedPathPrefixes: ["src/audit"],
        dependsOn: [],
        prdRefs: ["REQ-AUDIT"],
        definitionOfDone: ["Audit task complete"],
        validationCommands: [
          { id: "test-first", command: "node -e \"process.exit(0)\"", gate: "test_first", required: true },
          { id: "unit", command: "node -e \"process.exit(0)\"", gate: "unit_tests", required: true },
        ],
      },
      undefined,
      undefined,
      { cwd: dir },
    );

    const events = await readLogEvents(dir);
    assert.ok(events.some((event) => event.eventType === "state" && event.summary === "Task created: T-AUDIT"));
    assert.ok(events.some((event) => event.eventType === "tool" && event.summary === "Task created: T-AUDIT" && Boolean(event.detailsPath)));
  });
});

test("scaler_memory_search returns summary candidates without full content", async () => {
  await withTempDir(async (dir) => {
    const registered = new Map<string, { execute: (...args: any[]) => Promise<{ content: Array<{ text: string }>; details: any }> }>();
    registerScalerTools({ registerTool(definition: { name: string; execute: (...args: any[]) => Promise<{ content: Array<{ text: string }>; details: any }> }) { registered.set(definition.name, definition); } } as never);

    await registered.get("scaler_memory_write")?.execute("tool-call", { title: "Auth memory", content: "FULL SECRET DETAIL", summary: "Auth summary", taskId: "T-MEM", tags: ["auth", "api"] }, undefined, undefined, { cwd: dir });
    const result = await registered.get("scaler_memory_search")?.execute("tool-call", { query: "auth", tags: ["api"], taskId: "T-MEM" }, undefined, undefined, { cwd: dir });

    assert.equal((await loadMemoryIndex(dir)).entries[0]?.tags?.includes("api"), true);
    assert.match(result?.content[0]?.text ?? "", /Auth memory/);
    assert.doesNotMatch(result?.content[0]?.text ?? "", /FULL SECRET DETAIL/);
    assert.equal(result?.details.status, "searched");
  });
});

test("scaler_tool_request persists structured metadata", async () => {
  await withTempDir(async (dir) => {
    const registered = new Map<string, { execute: (...args: any[]) => Promise<unknown> }>();
    registerScalerTools({ registerTool(definition: { name: string; execute: (...args: any[]) => Promise<unknown> }) { registered.set(definition.name, definition); } } as never);

    await registered.get("scaler_tool_request")?.execute(
      "tool-call",
      {
        toolName: "docs_search",
        request: "Find widget docs.",
        taskId: "T-TOOL",
        requesterAgentId: "agent-tool",
        contextSummary: "Need docs only.",
        expectedOutput: "Widget docs summary.",
        requiredFormat: "json",
        riskLevel: "low",
        permissionRequirement: "read-only",
        safetyNotes: "Do not mutate files.",
        allowedTools: ["read"],
      },
      undefined,
      undefined,
      { cwd: dir },
    );

    const record = (await loadToolRequests(dir))[0];
    const budgets = getBudgetState(await loadState(dir));
    assert.equal(record?.toolName, "docs_search");
    assert.equal(record?.requesterAgentId, "agent-tool");
    assert.equal(record?.expectedOutput, "Widget docs summary.");
    assert.equal(record?.requiredFormat, "json");
    assert.equal(record?.riskLevel, "low");
    assert.equal(record?.permissionRequirement, "read-only");
    assert.equal(record?.safetyNotes, "Do not mutate files.");
    assert.deepEqual(record?.allowedTools, ["docs_search", "read"]);
    assert.equal(budgets.usage.toolCalls, 1);
  });
});

test("scaler_tool_schema records discovered tool metadata", async () => {
  await withTempDir(async (dir) => {
    const registered = new Map<string, { execute: (...args: any[]) => Promise<unknown> }>();
    registerScalerTools({ registerTool(definition: { name: string; execute: (...args: any[]) => Promise<unknown> }) { registered.set(definition.name, definition); } } as never);

    await registered.get("scaler_tool_schema")?.execute(
      "tool-schema-call",
      {
        toolName: "mcp_docs_search",
        source: "mcp://docs/schema",
        description: "Search docs MCP.",
        riskLevel: "low",
        docsRef: "docs:mcp-search",
        schemaRef: "schema:mcp-search-v1",
        notes: "args.query required",
        evidenceRefs: ["docs:mcp-search"],
        discoveredByAgentId: "schema-agent",
      },
      undefined,
      undefined,
      { cwd: dir },
    );

    const record = (await loadToolSchemaRecords(dir))[0];
    const budgets = getBudgetState(await loadState(dir));
    assert.equal(record?.toolName, "mcp_docs_search");
    assert.equal(record?.source, "mcp://docs/schema");
    assert.equal(record?.schemaRef, "schema:mcp-search-v1");
    assert.equal(record?.discoveredByAgentId, "schema-agent");
    assert.equal(budgets.usage.toolCalls, 1);
  });
});

test("scaler_tool_result records structured result and updates request", async () => {
  await withTempDir(async (dir) => {
    const registered = new Map<string, { execute: (...args: any[]) => Promise<unknown> }>();
    registerScalerTools({ registerTool(definition: { name: string; execute: (...args: any[]) => Promise<unknown> }) { registered.set(definition.name, definition); } } as never);

    await registered.get("scaler_tool_request")?.execute(
      "tool-call",
      { toolName: "docs_search", request: "Find widget docs.", taskId: "T-TOOL", allowedTools: ["read"] },
      undefined,
      undefined,
      { cwd: dir },
    );
    const request = (await loadToolRequests(dir))[0];
    assert.ok(request);

    await registered.get("scaler_tool_result")?.execute(
      "tool-result-call",
      {
        requestId: request.id,
        status: "completed",
        summary: "Found widget docs.",
        outputs: { api: "Widget.create" },
        evidenceRefs: ["docs:widgets"],
        validationPerformed: ["checked schema"],
      },
      undefined,
      undefined,
      { cwd: dir },
    );

    const result = (await loadToolResults(dir))[0];
    const updatedRequest = (await loadToolRequests(dir))[0];
    const budgets = getBudgetState(await loadState(dir));
    assert.equal(result?.requestId, request.id);
    assert.equal(result?.status, "completed");
    assert.equal(updatedRequest?.status, "completed");
    assert.equal(budgets.usage.toolCalls, 2);
  });
});

test("scaler_research_report records structured research", async () => {
  await withTempDir(async (dir) => {
    const registered = new Map<string, { execute: (...args: any[]) => Promise<unknown> }>();
    registerScalerTools({ registerTool(definition: { name: string; execute: (...args: any[]) => Promise<unknown> }) { registered.set(definition.name, definition); } } as never);

    await registered.get("scaler_research_report")?.execute(
      "tool-call",
      {
        question: "Which docs apply?",
        status: "complete",
        sources: [{ id: "docs", title: "Official docs", quality: "official", url: "https://example.invalid" }],
        conclusions: [{ summary: "Use official docs.", confidence: "high", sourceRefs: ["docs"] }],
        rawEvidence: [{ title: "Docs excerpt", content: "Exact raw evidence", sourceId: "docs" }],
      },
      undefined,
      undefined,
      { cwd: dir },
    );

    const reports = await loadResearchReports(dir);
    const budgets = getBudgetState(await loadState(dir));
    assert.equal(reports[0]?.question, "Which docs apply?");
    assert.equal(reports[0]?.memoryRefs?.length, 1);
    assert.equal(budgets.usage.researchReports, 1);
    assert.ok((budgets.usage.storageBytes ?? 0) > 0);
  });
});

test("scaler_task_report records structured task-agent report", async () => {
  await withTempDir(async (dir) => {
    const registered = new Map<string, { execute: (...args: any[]) => Promise<unknown> }>();
    registerScalerTools({ registerTool(definition: { name: string; execute: (...args: any[]) => Promise<unknown> }) { registered.set(definition.name, definition); } } as never);

    await registered.get("scaler_task_report")?.execute(
      "task-report-call",
      {
        taskId: "T-REPORT",
        status: "completed",
        summary: "Task completed.",
        changedFiles: ["src/app.ts"],
        validations: [{ command: "npm test", status: "passed", summary: "passed" }],
        evidenceRefs: ["validation:npm-test"],
        recommendedNextAction: "validate",
      },
      undefined,
      undefined,
      { cwd: dir },
    );

    const reports = await loadTaskAgentReports(dir);
    assert.equal(reports[0]?.taskId, "T-REPORT");
    assert.equal(reports[0]?.status, "completed");
    assert.deepEqual(reports[0]?.changedFiles, ["src/app.ts"]);
    assert.ok((getBudgetState(await loadState(dir)).usage.storageBytes ?? 0) > 0);
  });
});

test("scaler_planning_report syncs planner output", async () => {
  await withTempDir(async (dir) => {
    const registered = new Map<string, { execute: (...args: any[]) => Promise<{ details: any }> }>();
    registerScalerTools({ registerTool(definition: { name: string; execute: (...args: any[]) => Promise<{ details: any }> }) { registered.set(definition.name, definition); } } as never);

    const result = await registered.get("scaler_planning_report")?.execute(
      "tool-call",
      {
        id: "PLAN-TOOL",
        requirements: [{ id: "REQ-TOOL", statement: "Tool requirement" }],
        plan: {
          planVersion: 3,
          status: "active",
          tasks: [{
            id: "T-TOOL-PLAN",
            title: "Tool task",
            taskKind: "software",
            atomicityRationale: "T-TOOL-PLAN is independently completable and testable.",
            prdRefs: ["REQ-TOOL"],
            allowedPathPrefixes: ["src"],
            definitionOfDone: ["Tool task complete"],
            validationCommands: [
              { id: "test-first", command: "node -e \"process.exit(0)\"", gate: "test_first", required: true },
              { id: "unit", command: "node -e \"process.exit(0)\"", gate: "unit_tests", required: true },
            ],
          }],
        },
      },
      undefined,
      undefined,
      { cwd: dir },
    );

    assert.equal(result?.details.status, "accepted");
    assert.equal((await loadExecutionPlan(dir)).planVersion, 3);
    assert.equal((await loadPrdRequirements(dir)).requirements[0]?.id, "REQ-TOOL");
    assert.equal((await loadPrdRequirements(dir)).requirements[0]?.acceptanceCriteria, undefined);
    assert.equal((await loadPlanningReports(dir))[0]?.id, "PLAN-TOOL");
  });
});

test("scaler_prd_write writes current PRD and requirements", async () => {
  await withTempDir(async (dir) => {
    const registered = new Map<string, { execute: (...args: any[]) => Promise<unknown> }>();
    registerScalerTools({ registerTool(definition: { name: string; execute: (...args: any[]) => Promise<unknown> }) { registered.set(definition.name, definition); } } as never);

    await registered.get("scaler_prd_write")?.execute(
      "tool-call",
      {
        content: "# Runtime PRD",
        requirements: [{ id: "REQ-001", statement: "Show status." }],
      },
      undefined,
      undefined,
      { cwd: dir },
    );

    assert.equal(await loadCurrentPrd(dir), "# Runtime PRD\n");
    assert.equal((await loadPrdRequirements(dir)).requirements[0]?.id, "REQ-001");
    await registered.get("scaler_prd_write")?.execute(
      "tool-call-2",
      { content: "# Revised PRD", requirements: [{ id: "REQ-001", statement: "Show status." }] },
      undefined,
      undefined,
      { cwd: dir },
    );
    assert.equal((await loadPrdRequirements(dir)).requirements[0]?.acceptanceCriteria, undefined);
  });
});

test("scaler_prd_requirement_update upserts requirement and coverage", async () => {
  await withTempDir(async (dir) => {
    const registered = new Map<string, { execute: (...args: any[]) => Promise<unknown> }>();
    registerScalerTools({ registerTool(definition: { name: string; execute: (...args: any[]) => Promise<unknown> }) { registered.set(definition.name, definition); } } as never);

    await registered.get("scaler_prd_requirement_update")?.execute(
      "tool-call",
      {
        id: "REQ-002",
        statement: "Task is validated.",
        status: "implemented",
        taskIds: ["T-001"],
        evidenceRefs: ["validation:run-1"],
      },
      undefined,
      undefined,
      { cwd: dir },
    );

    assert.equal((await loadPrdRequirements(dir)).requirements[0]?.statement, "Task is validated.");
    assert.equal((await loadPrdCoverage(dir)).entries[0]?.status, "implemented");
    assert.equal((await loadPrdRequirements(dir)).requirements[0]?.acceptanceCriteria, undefined);
  });
});

test("model-facing PRD tools cannot invent mandatory acceptance criteria", async () => {
  await withTempDir(async (dir) => {
    const registered = new Map<string, { execute: (...args: any[]) => Promise<unknown> }>();
    registerScalerTools({ registerTool(definition: { name: string; execute: (...args: any[]) => Promise<unknown> }) { registered.set(definition.name, definition); } } as never);
    const proposal = {
      id: "REQ-UNAUTHORIZED", statement: "Agent proposal", source: "user",
      acceptanceCriteria: [{
        id: "AC-FORGED", statement: "Agent-created blocking gate.", validationTaskId: "T-ONE",
        commandId: "integration", participantTaskIds: ["T-ONE"],
      }],
    };

    await assert.rejects(() => registered.get("scaler_prd_write")!.execute(
      "tool-call", { content: "# Must not be written", requirements: [proposal] }, undefined, undefined, { cwd: dir },
    ), /explicit user command/i);
    assert.equal(await loadCurrentPrd(dir), "");
    assert.deepEqual((await loadPrdRequirements(dir)).requirements, []);

    await assert.rejects(() => registered.get("scaler_prd_requirement_update")!.execute(
      "tool-call", proposal, undefined, undefined, { cwd: dir },
    ), /explicit user command/i);
    assert.deepEqual((await loadPrdRequirements(dir)).requirements, []);
  });
});

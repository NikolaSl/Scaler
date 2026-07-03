import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadCurrentPrd, loadPrdCoverage, loadPrdRequirements } from "../src/prd.js";
import { loadResearchReports } from "../src/research.js";
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
    "scaler_research_report",
    "scaler_spawn_task",
    "scaler_tool_request",
    "scaler_task_create",
    "scaler_task_update",
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
    assert.equal(reports[0]?.question, "Which docs apply?");
    assert.equal(reports[0]?.memoryRefs?.length, 1);
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
  });
});

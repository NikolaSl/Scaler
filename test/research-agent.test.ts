import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { saveExecutionPlan } from "../src/plans.js";
import { computePrdCoverageSummary, loadPrdCoverage, loadPrdRequirements, upsertPrdRequirement } from "../src/prd.js";
import {
  buildResearchAgentPrompt,
  extractResearchReport,
  formatResearchAgentRunList,
  ingestResearchReport,
  loadResearchAgentRunRecords,
  prepareResearchAgentInvocation,
  recordResearchAgentRun,
  runResearchAgentStep,
} from "../src/research-agent.js";
import { readLogEvents } from "../src/logging.js";
import { loadResearchReports, loadResearchRequests, recordResearchReport, upsertResearchRequest } from "../src/research.js";
import { createDefaultState } from "../src/state.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-research-agent-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("buildResearchAgentPrompt includes request context, PRD coverage, prior reports, and report contract", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    state.stage = "knowledge";
    state.tasks = [{ id: "T-001", status: "ready", title: "Research API", prdRefs: ["REQ-001"], updatedAt: state.createdAt }];
    const request = await upsertResearchRequest(dir, {
      id: "RESEARCH-001",
      question: "Which API is supported?",
      reason: "Need implementation evidence.",
      scope: "mixed",
      taskId: "T-001",
      requirementRefs: ["REQ-001"],
    }, new Date("2026-01-01T00:00:00.000Z"));
    await recordResearchReport(dir, {
      id: "REPORT-OLD",
      status: "complete",
      requestId: "RESEARCH-001",
      question: "Which API is supported?",
      sources: [{ id: "local", title: "Local", quality: "project", path: "package.json" }],
      conclusions: [{ summary: "Local package pins version.", confidence: "medium", sourceRefs: ["local"] }],
    }, new Date("2026-01-01T00:00:01.000Z"));
    await upsertPrdRequirement(dir, { id: "REQ-001", statement: "Use supported API", status: "pending" });
    const currentPlan = await saveExecutionPlan(dir, {
      version: 1,
      planVersion: 1,
      status: "active",
      tasks: [{ id: "T-001", title: "Research API", prdRefs: ["REQ-001"] }],
      createdAt: state.createdAt,
      updatedAt: state.createdAt,
    });
    const requirements = await loadPrdRequirements(dir);
    const coverage = await loadPrdCoverage(dir);
    const prompt = buildResearchAgentPrompt({
      state,
      request,
      requests: await loadResearchRequests(dir),
      reports: await loadResearchReports(dir),
      currentPlan,
      requirements,
      coverageSummary: computePrdCoverageSummary(requirements, coverage, state),
      extraInstructions: "Prefer local evidence first.",
    });

    assert.match(prompt, /focused SCALER research agent/);
    assert.match(prompt, /RESEARCH-001/);
    assert.match(prompt, /REQ-001/);
    assert.match(prompt, /REPORT-OLD/);
    assert.match(prompt, /scaler_research_report/);
    assert.match(prompt, /Prefer local evidence first/);
  });
});

test("prepareResearchAgentInvocation builds isolated Pi invocation", async () => {
  const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
  const request = {
    id: "RESEARCH-001",
    status: "open" as const,
    question: "Q?",
    reason: "R",
    scope: "local" as const,
    createdAt: state.createdAt,
    updatedAt: state.createdAt,
  };
  const preparation = prepareResearchAgentInvocation("/repo", {
    state,
    request,
    requests: [request],
    reports: [],
    currentPlan: { version: 1, planVersion: 0, status: "draft", tasks: [], createdAt: state.createdAt, updatedAt: state.createdAt },
    requirements: { version: 1, requirements: [] },
    coverageSummary: { entries: [], countsByStatus: { pending: 0, in_progress: 0, implemented: 0, validated: 0, blocked: 0, needs_replan: 0 }, unlinkedRequirementIds: [], linkedRequirementIds: [] },
  }, { command: "pi-test", model: "test-model", tools: ["read"] });

  assert.equal(preparation.researchRequest.id, "RESEARCH-001");
  assert.equal(preparation.request.taskId, "research-agent-RESEARCH-001");
  assert.equal(preparation.invocation.command, "pi-test");
  assert.equal(preparation.invocation.cwd, "/repo");
  assert.ok(preparation.invocation.args.includes("--model"));
  assert.ok(preparation.invocation.args.includes("test-model"));
  assert.match(preparation.prompt, /Required final response/);
});

test("extractResearchReport validates latest structured research report", () => {
  const result = extractResearchReport([
    { type: "message", text: "working" },
    { payload: { type: "scaler_research_report", error: "old" } },
    {
      type: "scaler_research_report",
      requestId: "RESEARCH-001",
      question: "Which API?",
      status: "complete",
      sources: [{ id: "docs", title: "Official docs", quality: "official", url: "https://example.invalid/docs" }],
      conclusions: [{ summary: "Use the official API.", confidence: "high", sourceRefs: ["docs"] }],
    },
  ], new Date("2026-01-01T00:00:00.000Z"));

  assert.equal(result.ok, true);
  assert.equal(result.input?.requestId, "RESEARCH-001");
  assert.equal(result.input?.sources?.[0]?.id, "docs");
});

test("extractResearchReport reports missing, error, and invalid reports", () => {
  assert.deepEqual(extractResearchReport([]), {
    ok: false,
    reason: "No scaler_research_report report found in research-agent output.",
  });
  assert.deepEqual(extractResearchReport([{ type: "scaler_research_report", error: "blocked" }]), {
    ok: false,
    reason: "Research agent reported no report: blocked",
  });
  assert.deepEqual(extractResearchReport([{ type: "scaler_research_report", question: "Q", sources: [], conclusions: [] }], new Date("2026-01-01T00:00:00.000Z")), {
    ok: false,
    reason: "Research report RPT-RESEARCH-20260101000000000 requires at least one source.",
  });
});

test("ingestResearchReport records report and resolves complete request", async () => {
  await withTempDir(async (dir) => {
    await upsertResearchRequest(dir, { id: "RESEARCH-001", question: "Which API?", reason: "Need docs" }, new Date("2026-01-01T00:00:00.000Z"));
    const ingestion = await ingestResearchReport(dir, [{
      type: "scaler_research_report",
      requestId: "RESEARCH-001",
      question: "Which API?",
      status: "complete",
      sources: [{ id: "local", title: "Local file", quality: "project", path: "package.json" }],
      conclusions: [{ summary: "Use local version.", confidence: "medium", sourceRefs: ["local"] }],
      rawEvidence: [{ title: "package excerpt", content: "version metadata", sourceId: "local" }],
    }], new Date("2026-01-01T00:00:01.000Z"));

    assert.equal(ingestion.attempted, true);
    assert.equal(ingestion.ingested, true);
    assert.equal(ingestion.report?.requestId, "RESEARCH-001");
    assert.equal(ingestion.report?.memoryRefs?.length, 1);
    assert.equal((await loadResearchRequests(dir))[0]?.status, "resolved");
  });
});

test("research agent run records round trip and format", async () => {
  await withTempDir(async (dir) => {
    assert.deepEqual(await loadResearchAgentRunRecords(dir), []);

    await recordResearchAgentRun(dir, "RESEARCH-001", undefined, undefined, "prepared", new Date("2026-01-01T00:00:00.000Z"));
    await recordResearchAgentRun(dir, "RESEARCH-001", {
      taskId: "research-agent-RESEARCH-001",
      exitCode: 1,
      stdoutEvents: [{ type: "message" }],
      stderr: "failed with details",
      timedOut: false,
      aborted: false,
    }, { attempted: true, ingested: false, reason: "missing" }, undefined, new Date("2026-01-01T01:00:00.000Z"));

    const records = await loadResearchAgentRunRecords(dir);
    assert.deepEqual(records.map((record) => record.status), ["failed", "prepared"]);
    assert.equal(
      formatResearchAgentRunList(records),
      "Research-agent runs:\n- failed request=RESEARCH-001 exit=1 flags=none stdout_events=1 ingestion=rejected report=n/a stderr=failed with details\n- prepared request=RESEARCH-001 exit=n/a flags=none stdout_events=0 ingestion=not_attempted report=n/a",
    );
  });
});

test("runResearchAgentStep prepares oldest open request and executes with report ingestion", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    await upsertResearchRequest(dir, { id: "RESEARCH-NEW", question: "New?", reason: "Later" }, new Date("2026-01-01T00:00:02.000Z"));
    await upsertResearchRequest(dir, { id: "RESEARCH-OLD", question: "Old?", reason: "Earlier" }, new Date("2026-01-01T00:00:01.000Z"));

    const prepared = await runResearchAgentStep(dir, state, { command: "pi-test" });
    assert.equal(prepared.accepted, true);
    assert.equal(prepared.researchRequest?.id, "RESEARCH-OLD");
    assert.equal(prepared.runRecord?.status, "prepared");
    assert.match(prepared.prompt ?? "", /Selected research request/);

    const executed = await runResearchAgentStep(dir, state, { requestId: "RESEARCH-OLD", execute: true }, async (request) => ({
      taskId: request.taskId,
      exitCode: 0,
      stdoutEvents: [{
        type: "scaler_research_report",
        requestId: "RESEARCH-OLD",
        question: "Old?",
        status: "complete",
        sources: [{ id: "source", title: "Source", quality: "project", summary: "Local evidence" }],
        conclusions: [{ summary: "Answered.", confidence: "high", sourceRefs: ["source"] }],
      }],
      stderr: "",
      timedOut: false,
      aborted: false,
    }));

    assert.equal(executed.accepted, true);
    assert.equal(executed.runRecord?.status, "passed");
    assert.equal(executed.ingestion?.ingested, true);
    assert.equal((await loadResearchReports(dir))[0]?.requestId, "RESEARCH-OLD");
    const events = await readLogEvents(dir);
    assert.equal(events.some((event) => event.eventType === "agent" && /Agent prompt prepared/.test(event.summary) && event.detailsPath), true);
    assert.equal(events.some((event) => event.eventType === "report" && /Research report ingested/.test(event.summary) && event.detailsPath), true);
  });
});

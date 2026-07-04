import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { retrieveMemory } from "../src/memory.js";
import { createDefaultState } from "../src/state.js";
import {
  formatResearchSummary,
  loadResearchReports,
  loadResearchRequests,
  rankResearchSourceQuality,
  recordResearchReport,
  upsertResearchRequest,
  validateResearchReport,
  validateResearchRequest,
} from "../src/research.js";
import { recordToolSchema } from "../src/tool-requests.js";
import { assessResearchSourceFreshness, buildResearchQueryPlan, discoverResearchToolCandidates, formatResearchWebRunResult, loadResearchWebTransactions, runResearchWebWorkflow } from "../src/research-web.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-research-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("upsertResearchRequest stores normalized newest-first requests", async () => {
  await withTempDir(async (dir) => {
    await upsertResearchRequest(dir, {
      id: "RESEARCH-001",
      question: " Which API version is used? ",
      reason: " Need exact docs ",
      scope: "mixed",
      taskId: "T-001",
      requirementRefs: ["REQ-002", "REQ-001", "REQ-001"],
    }, new Date("2026-01-01T00:00:00.000Z"));
    await upsertResearchRequest(dir, {
      id: "RESEARCH-002",
      question: "What local config exists?",
      reason: "Plan task",
    }, new Date("2026-01-01T00:00:01.000Z"));

    const requests = await loadResearchRequests(dir);
    assert.deepEqual(requests.map((request) => request.id), ["RESEARCH-002", "RESEARCH-001"]);
    assert.equal(requests[0]?.scope, "local");
    assert.deepEqual(requests[1]?.requirementRefs, ["REQ-001", "REQ-002"]);
    assert.match(formatResearchSummary(requests, []), /requests=2 open=2 reports=0/);
  });
});

test("recordResearchReport sorts sources, stores raw evidence in memory, and resolves complete requests", async () => {
  await withTempDir(async (dir) => {
    await upsertResearchRequest(dir, {
      id: "RESEARCH-001",
      question: "Which API should be used?",
      reason: "Implementation needs exact API.",
    }, new Date("2026-01-01T00:00:00.000Z"));

    const report = await recordResearchReport(dir, {
      id: "REPORT-001",
      status: "complete",
      requestId: "RESEARCH-001",
      question: "Which API should be used?",
      taskId: "T-001",
      requirementRefs: ["REQ-001"],
      sources: [
        { id: "blog", title: "Blog", quality: "weak", url: "https://example.invalid/blog" },
        { id: "local", title: "Local package", quality: "project", path: "package.json" },
        { id: "docs", title: "Official docs", quality: "official", url: "https://example.invalid/docs" },
      ],
      conclusions: [{
        summary: "Use the version-matched official API confirmed by local package metadata.",
        confidence: "high",
        sourceRefs: ["docs", "local"],
      }],
      contradictions: [{
        summary: "Blog recommends deprecated API while official docs do not.",
        status: "resolved",
        sourceRefs: ["blog", "docs"],
        resolution: "Prefer official version-matched docs over weak blog source.",
      }],
      unresolvedUnknowns: ["Need live integration test."],
      recommendations: ["Add validation for API call."],
      rawEvidence: [{ title: "Official API excerpt", content: "Long official docs excerpt", sourceId: "docs" }],
    }, new Date("2026-01-01T00:00:01.000Z"));

    assert.deepEqual(report.sources.map((source) => source.id), ["local", "docs", "blog"]);
    assert.equal(report.memoryRefs?.length, 1);
    const memory = await retrieveMemory(dir, report.memoryRefs![0]!);
    assert.equal(memory.entry.source, "research:docs");
    assert.match(memory.content, /Long official docs excerpt/);
    assert.equal((await loadResearchRequests(dir))[0]?.status, "resolved");

    const reports = await loadResearchReports(dir);
    assert.equal(reports[0]?.id, "REPORT-001");
    assert.match(formatResearchSummary(await loadResearchRequests(dir), reports), /confidence=high memory_refs=1/);
  });
});

test("research validation rejects invalid references and incomplete contradictions", () => {
  assert.throws(() => validateResearchRequest({
    id: "REQ",
    status: "bad" as never,
    question: "Q",
    reason: "R",
    scope: "local",
    createdAt: "now",
    updatedAt: "now",
  }), /Invalid research request status/);

  assert.throws(() => validateResearchReport({
    id: "REPORT",
    status: "complete",
    question: "Q",
    sources: [{ id: "source", title: "Source", quality: "official", checkedAt: "now", url: "https://example.invalid" }],
    conclusions: [{ summary: "Conclusion", confidence: "high", sourceRefs: ["missing"] }],
    createdAt: "now",
    updatedAt: "now",
  }), /unknown sources: missing/);

  assert.throws(() => validateResearchReport({
    id: "REPORT",
    status: "complete",
    question: "Q",
    sources: [
      { id: "a", title: "A", quality: "official", checkedAt: "now", url: "https://example.invalid/a" },
      { id: "b", title: "B", quality: "weak", checkedAt: "now", url: "https://example.invalid/b" },
    ],
    conclusions: [{ summary: "Conclusion", confidence: "medium", sourceRefs: ["a"] }],
    contradictions: [{ summary: "Conflict", status: "resolved", sourceRefs: ["a", "b"] }],
    createdAt: "now",
    updatedAt: "now",
  }), /resolved contradiction requires a resolution/);
});

test("rankResearchSourceQuality ranks stronger sources first", () => {
  assert.equal(rankResearchSourceQuality("project") < rankResearchSourceQuality("official"), true);
  assert.equal(rankResearchSourceQuality("official") < rankResearchSourceQuality("weak"), true);
  assert.equal(rankResearchSourceQuality("unknown-value"), rankResearchSourceQuality("unknown"));
});

test("web research query planning and freshness diagnostics are deterministic", () => {
  assert.deepEqual(buildResearchQueryPlan("Widget API", 2), ["Widget API", "Widget API official documentation"]);
  assert.equal(assessResearchSourceFreshness({ id: "local", title: "Local", quality: "project", checkedAt: "2026-01-01T00:00:00.000Z", path: "package.json" }), "project_local");
  assert.equal(assessResearchSourceFreshness({ id: "docs", title: "Docs", quality: "official", checkedAt: "2026-01-01T00:00:00.000Z", url: "https://example.invalid", version: "1.2.3" }), "versioned");
  assert.equal(assessResearchSourceFreshness({ id: "old", title: "Old", quality: "weak", checkedAt: "2020-01-01T00:00:00.000Z", url: "https://example.invalid" }, new Date("2026-01-01T00:00:00.000Z")), "stale_check");
});

test("web research workflow discovers tools, records transactions, and ingests reports", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    await upsertResearchRequest(dir, {
      id: "RESEARCH-WEB",
      question: "Which Widget API version should be used?",
      reason: "Need version-matched web docs.",
      scope: "mixed",
      taskId: "T-WEB",
    }, new Date("2026-01-01T00:00:00.000Z"));
    await recordToolSchema(dir, state, {
      toolName: "browser_search",
      source: "mcp://browser/schema",
      description: "Search web documentation.",
      riskLevel: "external",
      schemaRef: "schema:browser-search",
    }, new Date("2026-01-01T00:00:00.000Z"));

    const candidates = await discoverResearchToolCandidates(dir);
    assert.deepEqual(candidates.map((candidate) => candidate.name), ["browser_search"]);

    const planned = await runResearchWebWorkflow(dir, state, { requestId: "RESEARCH-WEB", maxQueries: 2 });
    assert.equal(planned.accepted, true);
    assert.equal(planned.executed, false);
    assert.deepEqual(planned.tools, ["browser_search"]);
    assert.equal(planned.queries.length, 2);
    assert.match(formatResearchWebRunResult(planned), /queries=2 tools=1/);

    const executed = await runResearchWebWorkflow(dir, state, { requestId: "RESEARCH-WEB", execute: true, allowInternet: true, maxQueries: 2 }, async (request) => {
      assert.deepEqual(request.tools, ["browser_search"]);
      assert.match(request.prompt, /multi-step web research transaction/);
      assert.match(request.prompt, /Which Widget API version should be used\?/);
      return {
        taskId: request.taskId,
        exitCode: 0,
        stdoutEvents: [{
          type: "scaler_research_report",
          id: "RPT-WEB",
          requestId: "RESEARCH-WEB",
          question: "Which Widget API version should be used?",
          status: "complete",
          sources: [{ id: "official", title: "Official Widget docs", quality: "official", url: "https://example.invalid/widget", version: "2.0", checkedAt: "2026-01-01T00:00:00.000Z", summary: "Version 2.0 API." }],
          conclusions: [{ summary: "Use Widget API v2.0.", confidence: "high", sourceRefs: ["official"] }],
          contradictions: [],
          unresolvedUnknowns: [],
          recommendations: ["Pin validation to v2.0 docs."],
        }],
        stderr: "",
        timedOut: false,
        aborted: false,
      };
    });

    assert.equal(executed.accepted, true);
    assert.equal(executed.researchAgent?.ingestion?.report?.id, "RPT-WEB");
    const transactions = await loadResearchWebTransactions(dir);
    assert.ok(transactions.some((transaction) => transaction.kind === "query" && transaction.status === "completed" && transaction.reportId === "RPT-WEB"));
    assert.ok(transactions.some((transaction) => transaction.kind === "source_review" && transaction.sourceId === "official" && transaction.freshnessStatus === "versioned"));
    assert.equal((await loadResearchRequests(dir))[0]?.status, "resolved");
  });
});

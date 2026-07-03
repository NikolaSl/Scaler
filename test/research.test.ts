import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { retrieveMemory } from "../src/memory.js";
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

/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  classifyAutomationStopReason,
  evaluateRequirementsTraceability,
  evaluateScalerEntrypointDocs,
  evaluateTraceabilityMarkdown,
  runConformanceChecks,
} from "../src/conformance.js";

const goodTraceability = `# Matrix\n\n| Req ID | Status | Implementation tasks | Contributing code/artifacts | Tests | Manual/docs | Gap / next action |\n|---|---|---|---|---|---|---|\n| PRD-X01 | Implemented | IMPL-1 | \`src/x.ts\` | \`test/x.test.ts\` | \`manual/x.md\` | Covered. |\n`;

const catalog = `# Catalog\n\n| ID | PRD statement | Spec/reference |\n|---|---|---|\n| PRD-X01 | One | specs/x.md |\n`;

test("classifyAutomationStopReason rejects no-progress/manual handoff outcomes", () => {
  assert.deepEqual(classifyAutomationStopReason("completed"), {
    category: "completed",
    accepted: true,
    reason: "Automation completed all planned work.",
  });
  assert.deepEqual(classifyAutomationStopReason("blocked"), {
    category: "deterministic_blocker",
    accepted: true,
    reason: "Automation stopped on an explicit deterministic blocker.",
  });
  assert.equal(classifyAutomationStopReason("no_progress").accepted, false);
  assert.equal(classifyAutomationStopReason("max_steps").category, "conformance_failure");
  assert.equal(classifyAutomationStopReason("validation_rejected").accepted, false);
});

test("evaluateTraceabilityMarkdown requires implemented rows to include code tests and docs", () => {
  assert.deepEqual(evaluateTraceabilityMarkdown(goodTraceability), []);
  const diagnostics = evaluateTraceabilityMarkdown(`| Req ID | Status | Implementation tasks | Contributing code/artifacts | Tests | Manual/docs | Gap / next action |\n|---|---|---|---|---|---|---|\n| PRD-X01 | Implemented | IMPL-1 | \`src/x.ts\` | — | — | Covered. |\n`);
  assert.equal(diagnostics.length, 2);
  assert.match(diagnostics[0]?.message ?? "", /missing test coverage/i);
});

test("evaluateRequirementsTraceability requires every catalog requirement to have a matrix row", () => {
  assert.deepEqual(evaluateRequirementsTraceability(catalog, goodTraceability), []);
  const diagnostics = evaluateRequirementsTraceability(`${catalog}| PRD-X02 | Two | specs/y.md |\n`, goodTraceability);
  assert.deepEqual(diagnostics.map((diagnostic) => diagnostic.requirementId), ["PRD-X02"]);
});

test("evaluateScalerEntrypointDocs rejects stale early-entrypoint wording", () => {
  assert.deepEqual(evaluateScalerEntrypointDocs({
    manualCommands: "## `/scaler <request>`\nRuns SCALER automation for the request until completion or a deterministic blocker.\n",
    manualWorkflow: "`/scaler` runs the bounded automation loop: staged workflow, plan/task synchronization, task-agent execution, validation, and commit/commit-skip progression until completion or a deterministic blocker.",
  }), []);

  const diagnostics = evaluateScalerEntrypointDocs({
    manualCommands: "## `/scaler <request>`\nThis is an early entrypoint. It does not yet execute the full Stage I-IV workflow.",
    manualWorkflow: "`/scaler` creates state only.",
  });
  assert.ok(diagnostics.some((diagnostic) => /early entrypoint/i.test(diagnostic.message)));
  assert.ok(diagnostics.some((diagnostic) => /bounded automation loop/i.test(diagnostic.message)));
});

test("project conformance checks pass for the current repository documents", async () => {
  const report = runConformanceChecks({
    requirementsCatalog: await readFile("requirements-catalog.md", "utf8"),
    traceabilityMatrix: await readFile("dev-progress-tracker/traceability-matrix.md", "utf8"),
    manualCommands: await readFile("manual/commands.md", "utf8"),
    manualWorkflow: await readFile("manual/workflow.md", "utf8"),
  });

  assert.equal(report.ok, true, report.diagnostics.map((diagnostic) => diagnostic.message).join("\n"));
});

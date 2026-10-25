/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadReplanRequests } from "../src/plans.js";
import { loadPrdRequirements, upsertPrdRequirement } from "../src/prd.js";
import { createDefaultState, loadState, saveState } from "../src/state.js";
import { addTask } from "../src/supervisor.js";
import { loadValidationChecklists, recordValidationChecklist } from "../src/validation.js";

// PLAN-185 preparation: two intentionally RED counterexamples. Do not merge
// until author assessment AND pending-material-finding acceptance guards exist.
for (const status of ["failed", "blocked"] as const) {
  test(`reviewer ${status} proposal cannot impose extra scope before author assessment`, async () => {
    const dir = await mkdtemp(join(tmpdir(), "scaler-review-author-"));
    try {
      const state = addTask(createDefaultState(), { id: "CSV", status: "validating", prdRefs: ["CSV-REQ"] });
      state.stage = "execution";
      state.originalRequest = "Export CSV locally. No Excel or plugin framework.";
      await saveState(dir, state);
      await upsertPrdRequirement(dir, { id: "CSV-REQ", statement: state.originalRequest });
      const requirements = await loadPrdRequirements(dir);
      const result = await recordValidationChecklist(dir, state, {
        taskId: "CSV", gate: "adversarial_review",
        summary: "Reviewer proposes that an Excel/plugin framework is mandatory.",
        items: [{ id: "reviewer-extra", statement: "Excel/plugin framework must exist", status,
          evidenceRefs: ["reviewer:preference-not-user-authority"] }],
      });
      // Findings stay inspectable; this is NOT permission to ignore valid issues.
      assert.equal((await loadValidationChecklists(dir))[0]?.status, status);
      assert.equal(result.applyResult.accepted, false, "No author assessment was submitted");
      assert.equal(result.applyResult.state.tasks[0]?.status, "validating");
      assert.deepEqual(await loadState(dir), state);
      assert.deepEqual(await loadPrdRequirements(dir), requirements);
      assert.deepEqual(await loadReplanRequests(dir), []);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}

test("review approval remains a proposal while ordinary failed validation still applies", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scaler-review-controls-"));
  try {
    const state = addTask(createDefaultState(), { id: "CSV", status: "validating" });
    await saveState(dir, state);
    const approved = await recordValidationChecklist(dir, state, {
      taskId: "CSV", gate: "adversarial_review",
      items: [{ id: "minimal", statement: "No extra feature requested", status: "passed", evidenceRefs: ["fixture:original-request"] }],
    });
    assert.equal(approved.applyResult.accepted, false);
    assert.equal(approved.applyResult.state.tasks[0]?.status, "validating");
    const failed = await recordValidationChecklist(dir, state, {
      taskId: "CSV", gate: "completeness",
      items: [{ id: "csv", statement: "Required CSV output is missing", status: "failed" }],
    });
    assert.equal(failed.applyResult.accepted, true);
    assert.equal(failed.applyResult.state.tasks[0]?.status, "debugging");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

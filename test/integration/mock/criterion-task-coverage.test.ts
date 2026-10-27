/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { verifyAcceptedTaskEvidence } from "../../../src/accepted-evidence.js";
import { acceptReplanProposal, applyPlanningReport, loadExecutionPlan, loadPlanningReports, loadProposedExecutionPlan, loadReplanDecisions, saveProposedExecutionPlan } from "../../../src/plans.js";
import { amendPrdRequirement, loadPrdCoverage, loadPrdRequirements, upsertPrdRequirement } from "../../../src/prd.js";
import { completeRunWithEvidence } from "../../../src/run-completion.js";
import { createDefaultState, loadState, saveState } from "../../../src/state.js";
import { createTask } from "../../../src/tasks.js";
import { runTaskValidation } from "../../../src/validation.js";
import { runConductorStep } from "./provider-bound-helpers.js";

const contract = (id: string) => ({
  id, title: id === "EXPORT" ? "Produce the requested header" : "Verify the requested header",
  taskKind: "non_software", prdRefs: ["CSV"],
  atomicityRationale: "One bounded header artifact or its exact independent check.",
  allowedPathPrefixes: ["out.csv"], outputPaths: id === "EXPORT" ? ["out.csv"] : [],
  definitionOfDone: ["out.csv contains exactly the requested name,email header."],
  validationCommands: [{ id: "columns", gate: "consistency", required: true,
    command: "node -e \"require('node:assert/strict').equal(require('node:fs').readFileSync('out.csv','utf8'),'name,email')\"" }],
});

async function fixture(fn: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "scaler-criterion-path-"));
  try {
    const state = createDefaultState(); state.stage = "execution";
    state.originalRequest = "Produce the name,email CSV header and satisfy the explicitly authorized acceptance criterion.";
    await saveState(dir, state);
    await upsertPrdRequirement(dir, { id: "CSV", statement: state.originalRequest });
    await fn(dir);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

async function criterion(dir: string, owner: string, participants: string[]) {
  await amendPrdRequirement(dir, { id: "CSV", expectedRevision: 1,
    reason: "User explicitly names the header acceptance path.",
    changes: { acceptanceCriteria: [{ id: "COLUMNS", statement: "Exact requested header.",
      validationTaskId: owner, commandId: "columns", participantTaskIds: participants }] } });
}

async function apply(dir: string, tasks = [contract("EXPORT")], version = 1) {
  return applyPlanningReport(dir, await loadState(dir), {
    requirements: [], plan: { planVersion: version, status: "active", tasks },
  });
}

async function snapshot(dir: string) {
  return { state: await loadState(dir),
    // The absent-plan loader synthesizes timestamps; compare actual persisted bytes/absence.
    plan: await readFile(join(dir, ".scaler/plans/current-plan.json"), "utf8").catch(error => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    }),
    requirements: await loadPrdRequirements(dir), coverage: await loadPrdCoverage(dir),
    reports: await loadPlanningReports(dir), draft: await loadProposedExecutionPlan(dir),
    decisions: await loadReplanDecisions(dir) };
}

for (const route of ["planning", "replanning"] as const) {
  for (const missing of ["owner", "participant"] as const) test(`${route} refuses missing explicit criterion ${missing} before publication`, async () => {
    await fixture(async dir => {
      if (route === "replanning") assert.equal((await apply(dir)).accepted, true);
      await criterion(dir, missing === "owner" ? "VERIFY" : "EXPORT", missing === "participant" ? ["EXPORT", "MAPPING"] : ["EXPORT"]);
      if (route === "replanning") await saveProposedExecutionPlan(dir, { ...await loadExecutionPlan(dir), planVersion: 2, status: "draft" });
      const before = await snapshot(dir);
      await assert.rejects(route === "planning" ? apply(dir)
        : acceptReplanProposal(dir, before.state, before.requirements), /criterion.*CSV.*COLUMNS.*(VERIFY|MAPPING)/i);
      assert.deepEqual(await snapshot(dir), before); // No executable/accepted publication or charge.
    });
  });
}

test("planning and replanning accept explicit forward criterion tasks without another planner call", async () => {
  await fixture(async dir => {
    await criterion(dir, "VERIFY", ["EXPORT", "VERIFY"]);
    const verify = { ...contract("VERIFY"), dependsOn: ["EXPORT"] };
    const applied = await apply(dir, [verify, contract("EXPORT")]); // Forward reference is valid.
    assert.equal(applied.accepted, true, applied.message);
    await saveProposedExecutionPlan(dir, { ...await loadExecutionPlan(dir), planVersion: 2, status: "draft" });
    const accepted = await acceptReplanProposal(dir, await loadState(dir), await loadPrdRequirements(dir));
    assert.equal(accepted.accepted, true, accepted.message);
  });
});

for (const standalone of [false, true]) test(`${standalone ? "existing standalone" : "minimal self-owned"} criterion path reaches actual current acceptance`, async () => {
  await fixture(async dir => {
    if (standalone) {
      assert.equal((await apply(dir)).accepted, true); // No-criteria compatibility.
      const created = await createTask(dir, await loadState(dir), {
        ...contract("VERIFY"), dependsOn: ["EXPORT"], acceptanceAuthority: "model", qualityMode: "enforce",
      });
      assert.equal(created.accepted, true, created.message);
    }
    await criterion(dir, standalone ? "VERIFY" : "EXPORT", standalone ? ["EXPORT", "VERIFY"] : ["EXPORT"]);
    const applied = await apply(dir, [contract("EXPORT")], standalone ? 2 : 1);
    assert.equal(applied.accepted, true, applied.message);
    if (standalone) {
      assert.equal((await loadExecutionPlan(dir)).tasks.some(task => task.id === "VERIFY"), false);
      await saveProposedExecutionPlan(dir, { ...await loadExecutionPlan(dir), planVersion: 3, status: "draft" });
      const accepted = await acceptReplanProposal(dir, await loadState(dir), await loadPrdRequirements(dir));
      assert.equal(accepted.accepted, true, accepted.message);
    }
    await writeFile(join(dir, "out.csv"), "name,email");
    const calls: string[] = [];
    for (const id of standalone ? ["EXPORT", "VERIFY"] : ["EXPORT"]) {
      const result = await runConductorStep(dir, await loadState(dir), { execute: true }, async request => {
        calls.push(request.taskId); assert.equal(request.taskId, id);
        return { taskId: id, exitCode: 0, timedOut: false, aborted: false, stderr: "",
          stdoutEvents: [{ type: "scaler_task_report", taskId: id, ...request.attempt,
            status: "completed", summary: "Header ready for the exact command check." }] };
      });
      assert.equal(result.validationHandoff?.status, "validation_required");
      assert.equal((await runTaskValidation(dir, await loadState(dir), id)).status, "passed");
      assert.deepEqual(await verifyAcceptedTaskEvidence(dir, await loadState(dir), id), []);
    }
    assert.deepEqual(calls, standalone ? ["EXPORT", "VERIFY"] : ["EXPORT"]);
    const completion = await completeRunWithEvidence(dir, await loadState(dir));
    assert.equal(completion.accepted, true, completion.message);
  });
});

/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { verifyAcceptedTaskEvidence } from "../../../src/accepted-evidence.js";
import { getExecutionPlanVersionsDir } from "../../../src/paths.js";
import { acceptReplanProposal, applyPlanningReport, loadExecutionPlan, loadProposedExecutionPlan, loadReplanDecisions, saveProposedExecutionPlan, type ExecutionPlanTask } from "../../../src/plans.js";
import { loadPrdCoverage, loadPrdRequirements } from "../../../src/prd.js";
import { completeRunWithEvidence } from "../../../src/run-completion.js";
import { createDefaultState, loadState, saveState } from "../../../src/state.js";
import { updateTask } from "../../../src/tasks.js";
import { getValidationManifestForTask, loadValidationManifests, loadValidationRuns, runTaskValidation } from "../../../src/validation.js";
import { runConductorStep } from "./provider-bound-helpers.js";

const shape = { id: "shape", required: true, timeoutMs: 5000, command: "node -e \"require('node:assert/strict').ok(require('node:fs').readFileSync('out.csv','utf8').includes('name'))\"" };
const columns = { id: "columns", required: true, timeoutMs: 5000, command: "node -e \"require('node:assert/strict').equal(require('node:fs').readFileSync('out.csv','utf8').split('\\n')[0],'name,address')\"" };

async function fixture(fn: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "scaler-replan-validation-"));
  try {
    const state = createDefaultState(); state.stage = "execution";
    state.originalRequest = "Export CSV with name,address columns.";
    await saveState(dir, state);
    const applied = await applyPlanningReport(dir, state, {
      requirements: [{ id: "CSV", statement: state.originalRequest }],
      plan: { planVersion: 1, status: "active", tasks: [{ id: "EXPORT", title: "Export CSV", taskKind: "non_software", prdRefs: ["CSV"],
        atomicityRationale: "One bounded CSV artifact.", allowedPathPrefixes: ["out.csv"], outputPaths: ["out.csv"],
        definitionOfDone: ["Export exactly name,address columns."], validationCommands: [shape] }] },
    });
    assert.equal(applied.accepted, true, applied.message);
    await writeFile(join(dir, "check.cjs"), "process.exit(0)");
    await fn(dir);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

async function propose(dir: string, changes: Partial<ExecutionPlanTask>) {
  const plan = await loadExecutionPlan(dir);
  return saveProposedExecutionPlan(dir, { ...plan, planVersion: plan.planVersion + 1, status: "draft",
    tasks: plan.tasks.map(task => ({ ...task, ...changes })) });
}

async function snapshot(dir: string) {
  return { state: await loadState(dir), plan: await loadExecutionPlan(dir), draft: await loadProposedExecutionPlan(dir),
    requirements: await loadPrdRequirements(dir), coverage: await loadPrdCoverage(dir), decisions: await loadReplanDecisions(dir),
    manifests: await loadValidationManifests(dir), runs: await loadValidationRuns(dir),
    versions: await readdir(getExecutionPlanVersionsDir(dir)).catch(error => { if (error.code === "ENOENT") return []; throw error; }) };
}

async function refuse(dir: string) {
  const before = await snapshot(dir);
  await assert.rejects(acceptReplanProposal(dir, before.state, before.requirements), /replan.*validation basis.*EXPORT/i);
  assert.deepEqual(await snapshot(dir), before);
}

for (const [name, changes] of Object.entries({
  "added required command": { validationCommands: [shape, columns] },
  "changed timeout": { validationCommands: [{ ...shape, timeoutMs: 1000 }] },
  "changed disposition": { validationCommands: [{ ...shape, disposition: "blocked", dispositionReason: "Required check unavailable." }] },
  "changed output": { outputPaths: ["replacement.csv"] },
  "changed input": { validationInputPaths: ["check.cjs"] },
  "changed DoD": { definitionOfDone: ["A revised explicit acceptance obligation."] },
} satisfies Record<string, Partial<ExecutionPlanTask>>)) test(`replan refuses unapplied ${name} before any publication`, async () => {
  await fixture(async dir => { await propose(dir, changes); await refuse(dir); });
});

test("accepted replan retry refuses later runtime validation-policy drift", async () => {
  await fixture(async dir => {
    await propose(dir, {});
    assert.equal((await acceptReplanProposal(dir, await loadState(dir), await loadPrdRequirements(dir))).accepted, true);
    const update = await updateTask(dir, await loadState(dir), { id: "EXPORT", validationCommands: [shape, columns], acceptanceAuthority: "model" });
    assert.equal(update.accepted, true, update.message);
    await refuse(dir); // Same accepted proposal; no accepted-decision shortcut.
  });
});

test("replan accepts inherited policy and canonical command defaults", async () => {
  await fixture(async dir => {
    const manifests = await loadValidationManifests(dir);
    await propose(dir, { outputPaths: undefined, definitionOfDone: undefined,
      validationCommands: [{ ...shape, required: undefined, disposition: "run" }] });
    assert.equal((await acceptReplanProposal(dir, await loadState(dir), await loadPrdRequirements(dir))).accepted, true);
    assert.deepEqual(await loadValidationManifests(dir), manifests);
  });
});

async function completeNext(dir: string, id = "EXPORT") {
  const handoff = await runConductorStep(dir, await loadState(dir), { execute: true, timeoutMs: 5000 }, async request => {
    assert.equal(request.taskId, id);
    return { taskId: id, exitCode: 0, stderr: "", timedOut: false, aborted: false,
      stdoutEvents: [{ type: "scaler_task_report", taskId: id, ...request.attempt, status: "completed", summary: "Artifact proposed for actual validation." }] };
  });
  assert.equal(handoff.validationHandoff?.status, "validation_required", handoff.message);
  return runTaskValidation(dir, await loadState(dir), id);
}

test("guarded model update then matching replan enforces actual columns before current completion", async () => {
  await fixture(async dir => {
    await propose(dir, { validationCommands: [shape, columns] });
    const draft = (await loadProposedExecutionPlan(dir))!;
    await refuse(dir);
    const updated = await updateTask(dir, await loadState(dir), { id: "EXPORT", validationCommands: [shape, columns], acceptanceAuthority: "model", qualityMode: "enforce" });
    assert.equal(updated.accepted, true, updated.message); // No extra user confirmation for an allowed unexercised policy edit.
    const accepted = await acceptReplanProposal(dir, await loadState(dir), await loadPrdRequirements(dir));
    assert.equal(accepted.accepted, true, accepted.message);
    assert.deepEqual((await loadExecutionPlan(dir)).tasks, draft.tasks);
    assert.deepEqual((await getValidationManifestForTask(dir, "EXPORT")).commands.map(command => command.id), ["shape", "columns"]);
    await writeFile(join(dir, "out.csv"), "name\nAda\n");
    const failed = await runTaskValidation(dir, await loadState(dir), "EXPORT");
    assert.equal(failed.status, "failed");
    assert.deepEqual(failed.commandRuns.map(command => command.status), ["passed", "failed"]);
    assert.equal((await loadState(dir)).validatedTaskIds.includes("EXPORT"), false);
    assert.equal((await completeRunWithEvidence(dir, await loadState(dir))).accepted, false);
    await writeFile(join(dir, "out.csv"), "name,address\nAda,London\n");
    assert.equal((await completeNext(dir)).status, "passed");
    assert.deepEqual(await verifyAcceptedTaskEvidence(dir, await loadState(dir), "EXPORT"), []);
    assert.equal((await completeRunWithEvidence(dir, await loadState(dir))).accepted, true);
  });
});

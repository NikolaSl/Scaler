/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { verifyAcceptedTaskEvidence } from "../../../src/accepted-evidence.js";
import { acceptReplanProposal, applyPlanningReport, loadExecutionPlan, loadProposedExecutionPlan, loadReplanDecisions, saveProposedExecutionPlan } from "../../../src/plans.js";
import { loadPrdCoverage, loadPrdRequirements } from "../../../src/prd.js";
import { createDefaultState, loadState, saveState } from "../../../src/state.js";
import { createTask, updateTask } from "../../../src/tasks.js";
import { runTaskValidation } from "../../../src/validation.js";
import { runConductorStep } from "./provider-bound-helpers.js";

const contract = (id: string, dependsOn?: string[]) => ({
  id, title: `Deliver ${id} note`, taskKind: "non_software", prdRefs: ["NOTES"], dependsOn,
  atomicityRationale: "One bounded note with an exact-content check.",
  allowedPathPrefixes: [`${id}.txt`], outputPaths: [`${id}.txt`], definitionOfDone: [`${id}.txt contains ${id}.`],
  validationCommands: [{ id: "contents", gate: "consistency", required: true,
    command: `node -e "require('node:assert/strict').equal(require('node:fs').readFileSync('${id}.txt','utf8'),'${id}')"` }],
});

async function fixture(fn: (dir: string) => Promise<void>, withDependency = false) {
  const dir = await mkdtemp(join(tmpdir(), "scaler-replan-dependency-"));
  try {
    const state = createDefaultState(); state.stage = "execution";
    state.originalRequest = "Deliver KEEP, USE and an independent DIRECT note; resolve MAPPING before USE when the method requires it.";
    await saveState(dir, state);
    const applied = await applyPlanningReport(dir, state, {
      requirements: [{ id: "NOTES", statement: state.originalRequest }],
      plan: { planVersion: 1, status: "active", tasks: withDependency
        ? [contract("MAPPING"), contract("USE", ["MAPPING"])] : [contract("KEEP"), contract("USE")] },
    });
    assert.equal(applied.accepted, true, applied.message);
    await fn(dir);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

async function assertRefusedWithoutPublication(dir: string) {
  const state = await loadState(dir), plan = await loadExecutionPlan(dir);
  const requirements = await loadPrdRequirements(dir), coverage = await loadPrdCoverage(dir);
  const draft = await loadProposedExecutionPlan(dir), decisions = await loadReplanDecisions(dir);
  await assert.rejects(acceptReplanProposal(dir, state, requirements), /replan.*dependency basis.*USE/i);
  assert.deepEqual(await loadState(dir), state);
  assert.deepEqual(await loadExecutionPlan(dir), plan);
  assert.deepEqual(await loadPrdRequirements(dir), requirements);
  assert.deepEqual(await loadPrdCoverage(dir), coverage);
  assert.deepEqual(await loadProposedExecutionPlan(dir), draft);
  assert.deepEqual(await loadReplanDecisions(dir), decisions);
  // Rejected v2 does not silently invalidate the still-current v1 execution basis.
}

for (const status of ["pending", "ready"] as const) test(`replan refuses unapplied added dependency on existing ${status} task`, async () => {
  await fixture(async dir => {
    if (status === "ready") assert.equal((await updateTask(dir, await loadState(dir), { id: "USE", status, acceptanceAuthority: "model" })).accepted, true);
    const plan = await loadExecutionPlan(dir);
    await saveProposedExecutionPlan(dir, { ...plan, status: "draft", planVersion: 2,
      tasks: [...plan.tasks.map(task => task.id === "USE" ? { ...task, dependsOn: ["MAPPING"] } : task), contract("MAPPING")] });
    await assertRefusedWithoutPublication(dir);
  });
});

test("replan refuses an unapplied removed dependency including normalized empty edges", async () => {
  await fixture(async dir => {
    const plan = await loadExecutionPlan(dir);
    await saveProposedExecutionPlan(dir, { ...plan, status: "draft", planVersion: 2,
      tasks: plan.tasks.map(task => task.id === "USE" ? { ...task, dependsOn: [] } : task) });
    assert.equal((await loadProposedExecutionPlan(dir))!.tasks.find(task => task.id === "USE")!.dependsOn, undefined);
    await assertRefusedWithoutPublication(dir);
  }, true);
});

test("accepted replan retry refuses a later changed runtime dependency basis", async () => {
  await fixture(async dir => {
    assert.equal((await createTask(dir, await loadState(dir), { ...contract("MAPPING"), acceptanceAuthority: "model", qualityMode: "enforce" })).accepted, true);
    const plan = await loadExecutionPlan(dir);
    await saveProposedExecutionPlan(dir, { ...plan, status: "draft", planVersion: 2 });
    assert.equal((await acceptReplanProposal(dir, await loadState(dir), await loadPrdRequirements(dir))).accepted, true);
    assert.equal((await updateTask(dir, await loadState(dir), { id: "USE", dependsOn: ["MAPPING"], acceptanceAuthority: "model", qualityMode: "enforce" })).accepted, true);
    await assertRefusedWithoutPublication(dir);
  });
});

test("supported task update admits matching replan and actual prerequisite before downstream", async () => {
  await fixture(async dir => {
    const completeNext = async (id: string) => {
      await writeFile(join(dir, `${id}.txt`), id);
      const result = await runConductorStep(dir, await loadState(dir), { execute: true }, async request => {
        assert.equal(request.taskId, id);
        return { taskId: id, exitCode: 0, timedOut: false, aborted: false, stderr: "",
          stdoutEvents: [{ type: "scaler_task_report", taskId: id, ...request.attempt, status: "completed", summary: `${id} ready for exact validation.` }] };
      });
      assert.equal(result.validationHandoff?.status, "validation_required");
      assert.equal((await runTaskValidation(dir, await loadState(dir), id)).status, "passed");
    };
    await completeNext("KEEP");
    for (const id of ["MAPPING", "DIRECT"]) assert.equal((await createTask(dir, await loadState(dir), {
      ...contract(id), acceptanceAuthority: "model", qualityMode: "enforce",
    })).accepted, true);
    assert.equal((await updateTask(dir, await loadState(dir), {
      id: "USE", dependsOn: ["MAPPING", "KEEP"], acceptanceAuthority: "model", qualityMode: "enforce",
    })).accepted, true);
    const plan = await loadExecutionPlan(dir), before = await loadState(dir);
    await saveProposedExecutionPlan(dir, { ...plan, status: "draft", planVersion: 2,
      tasks: [...plan.tasks.map(task => task.id === "USE" ? { ...task, dependsOn: ["KEEP", "MAPPING", "MAPPING"] } : task), contract("MAPPING")] });
    const accepted = await acceptReplanProposal(dir, before, await loadPrdRequirements(dir));
    assert.equal(accepted.accepted, true, accepted.message);
    assert.deepEqual((await loadState(dir)).tasks, before.tasks);
    assert.deepEqual(await verifyAcceptedTaskEvidence(dir, await loadState(dir), "KEEP"), []);
    assert.equal((await loadExecutionPlan(dir)).tasks.some(task => task.id === "DIRECT"), false);
    await completeNext("MAPPING"); // Normal selection must not invoke USE on its pending prerequisite.
    const admitted: string[] = [];
    for (const id of ["USE", "DIRECT"]) await runConductorStep(dir, await loadState(dir), { execute: true }, async request => {
      admitted.push(request.taskId); assert.equal(request.taskId, id);
      return { taskId: id, exitCode: 1, stdoutEvents: [], stderr: "admission-only stop", timedOut: false, aborted: false };
    });
    assert.deepEqual(admitted, ["USE", "DIRECT"]); // Deliberate failures witness admission, not completion/effects.
  });
});

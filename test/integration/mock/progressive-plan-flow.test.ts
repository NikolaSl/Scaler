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
import { acceptReplanProposal, applyPlanningReport, loadExecutionPlan, loadProposedExecutionPlan, saveProposedExecutionPlan } from "../../../src/plans.js";
import { loadPrdRequirements } from "../../../src/prd.js";
import { createDefaultState, loadState, saveState } from "../../../src/state.js";
import { runTaskValidation } from "../../../src/validation.js";
import { runConductorStep } from "./provider-bound-helpers.js";

test("coarse proposed milestone stays non-executable until concrete replan admission", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scaler-progressive-frontier-"));
  try {
    const state = createDefaultState();
    state.stage = "execution";
    state.originalRequest = "Deliver a bootstrap note now and a future note after its concrete contract is ready.";
    await saveState(dir, state);
    const contract = (id: string, path: string, contents: string) => ({
      id, title: `Deliver ${id} note`, taskKind: "non_software", prdRefs: ["NOTES"],
      atomicityRationale: "One scoped text artifact with an exact content check.",
      allowedPathPrefixes: [path], outputPaths: [path], definitionOfDone: [`${path} contains ${contents}`],
      validationCommands: [{ id: "contents", gate: "consistency", required: true,
        command: `node -e "require('node:assert/strict').equal(require('node:fs').readFileSync('${path}','utf8'),'${contents}')"` }],
    });
    const now = contract("NOW", "now.txt", "bootstrap");
    const created = await applyPlanningReport(dir, state, {
      requirements: [{ id: "NOTES", statement: state.originalRequest }],
      plan: { planVersion: 1, status: "active", tasks: [now] },
    });
    assert.equal(created.accepted, true, created.message);
    const beforePlan = await loadExecutionPlan(dir);
    await saveProposedExecutionPlan(dir, { ...beforePlan, planVersion: 2, status: "draft",
      tasks: [...beforePlan.tasks, { id: "FUTURE", title: "Future note milestone", prdRefs: ["NOTES"] }] });
    const coarse = (await loadProposedExecutionPlan(dir))!;
    assert.equal(coarse.status, "draft");
    assert.deepEqual(coarse.tasks.find(task => task.id === "FUTURE"),
      { id: "FUTURE", title: "Future note milestone", prdRefs: ["NOTES"] });
    assert.equal((await loadState(dir)).tasks.some(task => task.id === "FUTURE"), false);
    assert.deepEqual(await loadExecutionPlan(dir), beforePlan);
    await writeFile(join(dir, "now.txt"), "bootstrap");
    const completed = await runConductorStep(dir, await loadState(dir), { execute: true }, async request => {
      assert.equal(request.taskId, "NOW");
      return { taskId: request.taskId, exitCode: 0, timedOut: false, aborted: false, stderr: "",
        stdoutEvents: [{ type: "scaler_task_report", taskId: request.taskId, ...request.attempt,
          status: "completed", summary: "Bootstrap note ready for exact validation." }] };
    });
    assert.equal(completed.validationHandoff?.status, "validation_required");
    assert.equal((await runTaskValidation(dir, await loadState(dir), "NOW")).status, "passed");
    const beforeState = await loadState(dir), requirements = await loadPrdRequirements(dir);
    await assert.rejects(acceptReplanProposal(dir, beforeState, requirements), /task contract preflight.*FUTURE/i);
    assert.deepEqual(await loadState(dir), beforeState);
    assert.deepEqual(await loadExecutionPlan(dir), beforePlan);
    assert.deepEqual(await loadPrdRequirements(dir), requirements);
    assert.deepEqual(await loadProposedExecutionPlan(dir), coarse);
    let futureCalls = 0;
    const dispatch = async () => runConductorStep(dir, await loadState(dir), { execute: true }, async request => {
      futureCalls++;
      assert.equal(request.taskId, "FUTURE");
      return { taskId: request.taskId, exitCode: 1, stdoutEvents: [], stderr: "admission-only stop", timedOut: false, aborted: false };
    });
    assert.equal((await dispatch()).accepted, false);
    assert.equal(futureCalls, 0);
    await saveProposedExecutionPlan(dir, { ...coarse, tasks: [now,
      { ...contract("FUTURE", "future.txt", "future"), dependsOn: ["NOW"] }] });
    const accepted = await acceptReplanProposal(dir, await loadState(dir), await loadPrdRequirements(dir));
    assert.equal(accepted.accepted, true, accepted.message);
    assert.equal((await loadExecutionPlan(dir)).planVersion, 2);
    assert.deepEqual(await verifyAcceptedTaskEvidence(dir, await loadState(dir), "NOW"), []);
    assert.equal((await loadState(dir)).tasks.find(task => task.id === "FUTURE")?.status, "pending");
    await dispatch();
    assert.equal(futureCalls, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { runScalerAutomation } from "../src/autopilot.js";
import { commitWithExecutionLock } from "../src/operations.js";
import { acquireExecutionLock, releaseExecutionLock } from "../src/locks.js";
import { getCommitSkipsPath, getValidationRunsPath } from "../src/paths.js";
import { loadPrdCoverage, savePrdCoverage, upsertPrdRequirement } from "../src/prd.js";
import { completeRunWithEvidence } from "../src/run-completion.js";
import { advanceStageAfterReadyArtifact } from "../src/stage-advancement.js";
import { runStageConductorLoop } from "../src/stage-conductor.js";
import { runAutonomousStageWorkflow } from "../src/stage-workflow.js";
import { createDefaultState, loadState, saveState } from "../src/state.js";
import { upsertStageArtifact } from "../src/stages.js";
import type { ScalerState } from "../src/types.js";
import { loadValidationRuns, runTaskValidation, saveValidationManifest } from "../src/validation.js";
import { verifyCurrentValidationReceipt } from "../src/validation-acceptance.js";

const exec = promisify(execFile);
async function fixture(fn: (dir: string, state: ScalerState) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "scaler-completion-"));
  try {
    const state = createDefaultState();
    state.stage = "execution";
    state.tasks = [{ id: "T-ONE", status: "validating", updatedAt: state.updatedAt }];
    await saveState(dir, state);
    await writeFile(join(dir, "one.txt"), "one");
    await saveValidationManifest(dir, { taskId: "T-ONE", outputPaths: ["one.txt"], commands: [{
      id: "check", required: true,
      command: 'node -e "if(require(\'fs\').readFileSync(\'one.txt\',\'utf8\')!==\'one\')process.exit(1)"',
    }], createdAt: "", updatedAt: "" });
    await fn(dir, state);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

for (const runner of [runStageConductorLoop, runAutonomousStageWorkflow]) {
  test(`${runner.name} cannot report legacy completed state as complete`, async () => fixture(async (dir, state) => {
    state.stage = "completed";
    state.tasks[0]!.status = "validated";
    state.validatedTaskIds = state.completedTaskIds = ["T-ONE"];
    await saveState(dir, state);
    const result = await runner(dir, state, { maxSteps: 1 });
    assert.equal(result.completed, false);
    assert.equal(result.accepted, false);
    assert.notEqual(result.stopReason, "completed");
    assert.match(result.message, /evidence|receipt/i);
  }));
}

async function automate(dir: string) {
  return runScalerAutomation(dir, await loadState(dir), { maxSteps: 1 }, {
    task: async () => { throw new Error("Completion checks must not dispatch a worker"); },
  });
}

for (const stage of ["execution", "completed"] as const) {
  test(`completion rejects legacy validated labels from ${stage}`, async () => fixture(async (dir, state) => {
    state.stage = stage;
    state.tasks[0]!.status = "validated";
    state.validatedTaskIds = state.completedTaskIds = ["T-ONE"];
    await saveState(dir, state);
    const result = await automate(dir);
    assert.equal(result.completed, false);
    assert.equal(result.accepted, false);
    assert.equal(result.stopReason, "blocked");
    assert.match(result.message, /receipt|evidence|provenance/i);
    assert.deepEqual(await loadValidationRuns(dir), []);
    assert.equal((await loadState(dir)).stage, stage, "Do not fabricate recovery or erase historical state");
  }));
}

test("ready execution artifact cannot complete legacy labels", async () => fixture(async (dir, state) => {
  state.tasks[0]!.status = "validated";
  state.validatedTaskIds = state.completedTaskIds = ["T-ONE"];
  await saveState(dir, state);
  await upsertStageArtifact(dir, { id: "EXEC", stage: "execution", status: "ready", title: "Execution", summary: "All tasks claimed done" });
  const result = await advanceStageAfterReadyArtifact(dir, state, "execution");
  assert.equal(result.accepted, false);
  assert.equal(result.advanced, false);
  assert.equal((await loadState(dir)).stage, "execution");
  assert.match(result.message, /receipt|evidence|provenance/i);
}));

test("accepted-id arrays cannot hide an unvalidated task during artifact completion", async () => fixture(async (dir, state) => {
  state.validatedTaskIds = state.completedTaskIds = ["T-ONE"];
  await saveState(dir, state);
  await upsertStageArtifact(dir, { id: "EXEC", stage: "execution", status: "ready", title: "Execution", summary: "Claimed done" });
  const result = await advanceStageAfterReadyArtifact(dir, state, "execution");
  assert.equal(result.accepted, false);
  assert.equal(result.advanced, false);
  assert.equal((await loadState(dir)).stage, "execution");
}));

for (const mutation of ["run", "task", "policy", "result", "git", "newer_failed"] as const) {
  test(`completion rejects ${mutation} evidence drift`, async () => fixture(async (dir, state) => {
    assert.equal((await runTaskValidation(dir, state, "T-ONE")).acceptance?.accepted, true);
    const current = await loadState(dir);
    if (mutation === "run") {
      // External legacy replacement simulates restart into another run; saveState refuses run replacement.
      const path = join(dir, ".scaler/state.json");
      const data = JSON.parse(await readFile(path, "utf8"));
      data.runId = "another-run";
      await writeFile(path, JSON.stringify(data));
    } else if (mutation === "task") {
      current.tasks[0]!.title = "Changed requirement";
      await saveState(dir, current);
    } else if (mutation === "policy") {
      await saveValidationManifest(dir, { taskId: "T-ONE", commands: [], createdAt: "", updatedAt: "" });
    } else if (mutation === "git") {
      await writeFile(getCommitSkipsPath(dir), JSON.stringify({ version: 1, skips: [] }));
    } else {
      const runs = await loadValidationRuns(dir);
      if (mutation === "result") runs[0]!.commandRuns[0]!.status = "failed";
      else runs.unshift({ ...runs[0]!, id: "newer-failure", status: "failed" });
      await writeFile(getValidationRunsPath(dir), JSON.stringify({ version: 1, runs }));
    }
    const result = await automate(dir);
    assert.equal(result.completed, false);
    assert.equal(result.accepted, false);
    assert.equal(result.stopReason, "blocked");
    assert.equal((await loadState(dir)).stage, "execution");
  }));
}

test("completion honors execution lock instead of accepting while another operation runs", async () => fixture(async (dir, state) => {
  await runTaskValidation(dir, state, "T-ONE");
  const lock = await acquireExecutionLock(dir, { operation: "test-owner" });
  try {
    const result = await automate(dir);
    assert.equal(result.completed, false);
    assert.equal(result.accepted, false);
    assert.match(result.message, /lock/i);
  } finally { await releaseExecutionLock(dir, lock.lock.id); }
}));

test("current independently checked non-Git skip supports completion and restart", async () => fixture(async (dir, state) => {
  assert.equal((await runTaskValidation(dir, state, "T-ONE")).acceptance?.accepted, true);
  const result = await automate(dir);
  assert.equal(result.completed, true, result.message);
  assert.equal(result.accepted, true);
  const resumed = await automate(dir);
  assert.equal(resumed.completed, true, resumed.message);
  assert.equal(resumed.accepted, true);
}));

test("completion rejects a current runtime requirement without a linked task", async () => fixture(async (dir, state) => {
  assert.equal((await runTaskValidation(dir, state, "T-ONE")).acceptance?.accepted, true);
  await upsertPrdRequirement(dir, { id: "REQ-NEW", statement: "Implement the newly added requirement" });
  const result = await completeRunWithEvidence(dir, await loadState(dir));
  assert.equal(result.accepted, false);
  assert.match(result.message, /REQ-NEW.*linked task|linked task.*REQ-NEW/i);
  assert.equal((await loadState(dir)).stage, "execution");
}));

test("completion rejects runtime coverage linked only to a nonexistent task", async () => fixture(async (dir, state) => {
  assert.equal((await runTaskValidation(dir, state, "T-ONE")).acceptance?.accepted, true);
  await upsertPrdRequirement(dir, {
    id: "REQ-STALE",
    statement: "Retain current requirement coverage",
    status: "validated",
    taskIds: ["T-MISSING"],
  });
  const result = await completeRunWithEvidence(dir, await loadState(dir));
  assert.equal(result.accepted, false);
  assert.match(result.message, /REQ-STALE.*T-MISSING|T-MISSING.*REQ-STALE/i);
  assert.equal((await loadState(dir)).stage, "execution");
}));

test("completion accepts a current runtime requirement linked to validated task evidence", async () => fixture(async (dir, state) => {
  state.tasks[0]!.prdRefs = ["REQ-ONE"];
  await saveState(dir, state);
  await upsertPrdRequirement(dir, { id: "REQ-ONE", statement: "Produce the declared output" });
  assert.equal((await runTaskValidation(dir, state, "T-ONE")).acceptance?.accepted, true);
  const result = await completeRunWithEvidence(dir, await loadState(dir));
  assert.equal(result.accepted, true, result.message);
  assert.equal((await loadState(dir)).stage, "completed");
}));

test("completion rejects evidence for an earlier linked requirement statement", async () => fixture(async (dir, state) => {
  state.tasks[0]!.prdRefs = ["REQ-CHANGE"];
  await saveState(dir, state);
  await upsertPrdRequirement(dir, { id: "REQ-CHANGE", statement: "Produce version one" });
  assert.equal((await runTaskValidation(dir, state, "T-ONE")).acceptance?.accepted, true);
  await upsertPrdRequirement(dir, { id: "REQ-CHANGE", statement: "Produce materially different version two" });
  const result = await completeRunWithEvidence(dir, await loadState(dir));
  assert.equal(result.accepted, false);
  assert.match(result.message, /requirement|receipt|evidence|changed/i);
  assert.equal((await loadState(dir)).stage, "execution");
}));

test("completion preserves evidence after an identical requirement-content upsert", async () => fixture(async (dir, state) => {
  state.tasks[0]!.prdRefs = ["REQ-SAME"];
  await saveState(dir, state);
  const requirement = { id: "REQ-SAME", title: "Stable requirement", statement: "Produce the same output", source: "user" };
  await upsertPrdRequirement(dir, requirement);
  assert.equal((await runTaskValidation(dir, state, "T-ONE")).acceptance?.accepted, true);
  await upsertPrdRequirement(dir, requirement);
  const result = await completeRunWithEvidence(dir, await loadState(dir));
  assert.equal(result.accepted, true, result.message);
}));

test("completion rejects evidence captured while a referenced requirement was missing", async () => fixture(async (dir, state) => {
  state.tasks[0]!.prdRefs = ["REQ-LATE"];
  await saveState(dir, state);
  assert.equal((await runTaskValidation(dir, state, "T-ONE")).acceptance?.accepted, true);
  await upsertPrdRequirement(dir, { id: "REQ-LATE", statement: "Requirement added after validation" });
  const result = await completeRunWithEvidence(dir, await loadState(dir));
  assert.equal(result.accepted, false);
  assert.match(result.message, /requirement|receipt|evidence|changed/i);
  assert.equal((await loadState(dir)).stage, "execution");
}));

for (const change of ["statement", "late-link"] as const) {
  test(`explicit-only requirement ${change} invalidates completion evidence`, async () => fixture(async (dir, state) => {
    if (change === "statement") {
      await upsertPrdRequirement(dir, {
        id: "REQ-EXPLICIT", statement: "Original requirement", status: "pending", taskIds: ["T-ONE"],
      });
    }
    assert.equal((await runTaskValidation(dir, state, "T-ONE")).acceptance?.accepted, true);
    await upsertPrdRequirement(dir, {
      id: "REQ-EXPLICIT", statement: "New requirement content", status: "pending", taskIds: ["T-ONE"],
    });
    const current = await loadState(dir);
    const receiptErrors = await verifyCurrentValidationReceipt(dir, current, "T-ONE");
    const completion = await completeRunWithEvidence(dir, current);
    assert.equal(completion.accepted, false, "Explicit ledger links must bind requirement content too");
    assert.match(receiptErrors.join("\n"), /receipt.*changed/i);
    assert.equal((await loadState(dir)).stage, "execution");
  }));
}

test("explicit-only unchanged requirement preserves accepted completion", async () => fixture(async (dir, state) => {
  const requirement = {
    id: "REQ-EXPLICIT", statement: "Produce one", status: "pending" as const, taskIds: ["T-ONE"],
  };
  await upsertPrdRequirement(dir, requirement);
  assert.equal((await runTaskValidation(dir, state, "T-ONE")).acceptance?.accepted, true);
  await upsertPrdRequirement(dir, { ...requirement, now: new Date("2030-01-01") });
  const result = await completeRunWithEvidence(dir, await loadState(dir));
  assert.equal(result.accepted, true, result.message);
}));

for (const taskIds of [[], ["T-OTHER"]]) {
  test(`changing an explicit task link to ${JSON.stringify(taskIds)} invalidates its receipt`, async () => fixture(async (dir, state) => {
    await upsertPrdRequirement(dir, {
      id: "REQ-EXPLICIT", statement: "Produce one", status: "pending", taskIds: ["T-ONE"],
    });
    assert.equal((await runTaskValidation(dir, state, "T-ONE")).acceptance?.accepted, true);
    const coverage = await loadPrdCoverage(dir);
    coverage.entries[0]!.taskIds = taskIds;
    await savePrdCoverage(dir, coverage);
    const errors = await verifyCurrentValidationReceipt(dir, await loadState(dir), "T-ONE");
    assert.match(errors.join("\n"), /receipt.*changed/i);
  }));
}

test("unrelated explicit coverage does not invalidate a task receipt", async () => fixture(async (dir, state) => {
  assert.equal((await runTaskValidation(dir, state, "T-ONE")).acceptance?.accepted, true);
  await upsertPrdRequirement(dir, {
    id: "REQ-OTHER", statement: "Unrelated requirement", status: "pending", taskIds: ["T-OTHER"],
  });
  const errors = await verifyCurrentValidationReceipt(dir, await loadState(dir), "T-ONE");
  assert.deepEqual(errors, []);
}));

test("two real task commits retain valid completion provenance across changed HEAD", async () => fixture(async (dir, state) => {
  await exec("git", ["init"], { cwd: dir });
  await exec("git", ["config", "user.name", "Test"], { cwd: dir });
  await exec("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  await exec("git", ["commit", "--allow-empty", "-m", "base"], { cwd: dir });
  state.tasks[0]!.allowedPathPrefixes = ["one.txt"];
  state.tasks.push({ id: "T-TWO", status: "ready", dependsOn: ["T-ONE"], allowedPathPrefixes: ["two.txt"], updatedAt: state.updatedAt });
  await saveState(dir, state);
  const first = await runTaskValidation(dir, state, "T-ONE");
  assert.equal(first.status, "passed");
  assert.equal(first.acceptance?.git?.status, "commit_required");
  const commit1 = await commitWithExecutionLock(dir, await loadState(dir), "T-ONE", ["one.txt"]);
  assert.equal(commit1.accepted, true, commit1.message);
  await writeFile(join(dir, "two.txt"), "two");
  const secondState = await loadState(dir);
  secondState.tasks[1]!.status = "validating";
  await saveState(dir, secondState);
  await saveValidationManifest(dir, { taskId: "T-TWO", commands: [{ id: "check", required: true,
    command: 'node -e "const f=require(\'fs\');if(f.readFileSync(\'one.txt\',\'utf8\')!==\'one\'||f.readFileSync(\'two.txt\',\'utf8\')!==\'two\')process.exit(1)"',
  }], createdAt: "", updatedAt: "" });
  assert.equal((await runTaskValidation(dir, secondState, "T-TWO")).status, "passed");
  const commit2 = await commitWithExecutionLock(dir, await loadState(dir), "T-TWO", ["two.txt"]);
  assert.equal(commit2.accepted, true, commit2.message);
  assert.notEqual(commit1.result?.commitHash, commit2.result?.commitHash);
  const result = await automate(dir);
  assert.equal(result.completed, true, result.message);
  assert.equal(result.accepted, true);
}));

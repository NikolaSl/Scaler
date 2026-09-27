/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checkAttemptEvidence } from "../src/attempt-evidence.js";
import { runConductorStep as runConductorStepImpl } from "../src/conductor.js";
import { testProviderAdmissionModel } from "./provider-model-fixture.js";

const runConductorStep: typeof runConductorStepImpl = (cwd, state, options = {}, runner) =>
  runConductorStepImpl(cwd, state, { ...options, providerAdmissionModel: testProviderAdmissionModel }, runner);
import { saveTaskContextManifest } from "../src/context.js";
import { getTaskAgentReportsPath } from "../src/paths.js";
import { createDefaultState, loadState, saveState } from "../src/state.js";
import { getValidationManifestForTask, saveValidationManifest, applyValidationReport, runTaskValidation, upsertValidationManifestCommand } from "../src/validation.js";

async function fixture(fn: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "scaler-attempt-evidence-"));
  try { await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

async function completed(dir: string, command = "node -e \"require('fs').writeFileSync('validated-marker', 'ok')\"") {
  const state = createDefaultState();
  state.stage = "execution";
  state.tasks = [{
    id: "T-FRESH", status: "ready", title: "Fresh evidence",
    allowedPathPrefixes: ["validated-marker"],
    definitionOfDone: ["The validation probe confirms the reported result."],
    updatedAt: state.updatedAt,
  }];
  await writeFile(join(dir, "spec.md"), "Original input");
  await saveTaskContextManifest(dir, {
    version: 1, taskId: "T-FRESH", createdAt: state.createdAt, updatedAt: state.updatedAt,
    items: [{ id: "spec", type: "file", reason: "Task input", priority: "required", scope: "full", source: "file", path: "spec.md" }],
  });
  await upsertValidationManifestCommand(dir, { taskId: "T-FRESH", id: "gate", command });
  // The synthetic worker emits only its report; validated-marker is a probe
  // showing whether the validation command ran, not a task deliverable.
  await saveValidationManifest(dir, { ...await getValidationManifestForTask(dir, "T-FRESH"), outputPaths: [] });
  await runConductorStep(dir, state, { execute: true }, async (request) => ({
    taskId: request.taskId, exitCode: 0, stdoutEvents: [{
      type: "scaler_task_report", taskId: request.taskId, ...request.attempt, status: "completed", summary: "Done",
    }], stderr: "", timedOut: false, aborted: false,
  }));
  return loadState(dir);
}

test("unchanged attempt evidence passes validation without timestamp/status false positives", async () => {
  await fixture(async (dir) => {
    const state = await completed(dir);
    assert.deepEqual(await checkAttemptEvidence(dir, state, "T-FRESH"), []);
    const run = await runTaskValidation(dir, state, "T-FRESH");
    assert.equal(run.status, "passed");
    assert.equal(run.acceptance?.accepted, true);
    assert.equal((await loadState(dir)).tasks[0]?.status, "validated");
  });
});

for (const change of ["task", "policy", "input", "report", "attempt_pointer"] as const) {
  test(`changed ${change} rejects validation before any command or validated state`, async () => {
    await fixture(async (dir) => {
      let state = await completed(dir);
      if (change === "task") { state.tasks[0]!.title = "Changed scope"; await saveState(dir, state); }
      if (change === "policy") await upsertValidationManifestCommand(dir, { taskId: "T-FRESH", id: "gate", command: "true" });
      if (change === "input") await writeFile(join(dir, "spec.md"), "Replaced input");
      if (change === "attempt_pointer") { delete state.tasks[0]!.attemptId; await saveState(dir, state); }
      if (change === "report") {
        const path = getTaskAgentReportsPath(dir);
        const reports = JSON.parse(await readFile(path, "utf8"));
        reports.reports[0].summary = "Tampered output";
        await writeFile(path, JSON.stringify(reports));
      }
      state = await loadState(dir);
      const run = await runTaskValidation(dir, state, "T-FRESH");
      assert.equal(run.status, "blocked");
      assert.equal(run.acceptance?.accepted, false);
      assert.deepEqual(run.commandRuns, []);
      await assert.rejects(readFile(join(dir, "validated-marker")), { code: "ENOENT" });
      const manual = await applyValidationReport(dir, state, { taskId: "T-FRESH", status: "passed", summary: "Attempted direct acceptance" });
      assert.equal(manual.accepted, false);
      assert.equal((await loadState(dir)).tasks[0]?.status, "validating");
    });
  });
}

test("input mutation during a green command cannot validate the old handoff", async () => {
  await fixture(async (dir) => {
    const state = await completed(dir, "node -e \"require('fs').writeFileSync('spec.md', 'changed during validation')\"");
    const run = await runTaskValidation(dir, state, "T-FRESH");
    assert.equal(run.status, "blocked");
    assert.equal(run.commandRuns[0]?.status, "passed");
    assert.equal(run.acceptance?.accepted, false);
    assert.equal((await loadState(dir)).tasks[0]?.status, "validating");
  });
});

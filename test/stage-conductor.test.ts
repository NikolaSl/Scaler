/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { savePrdRequirements } from "../src/prd.js";
import { runStageConductorLoop as runStageConductorLoopImpl, runStageConductorStep as runStageConductorStepImpl } from "../src/stage-conductor.js";
import { createDefaultState, loadState, saveState } from "../src/state.js";
import { upsertStageArtifact } from "../src/stages.js";
import { runTaskValidation, saveValidationManifest } from "../src/validation.js";
import type { ScalerState } from "../src/types.js";
import { testProviderAdmissionModel } from "./provider-model-fixture.js";

const runStageConductorStep: typeof runStageConductorStepImpl = (cwd, state, options = {}, runner) =>
  runStageConductorStepImpl(cwd, state, { ...options, providerAdmissionModel: testProviderAdmissionModel }, runner);
const runStageConductorLoop: typeof runStageConductorLoopImpl = (cwd, state, options = {}, runner) =>
  runStageConductorLoopImpl(cwd, state, { ...options, providerAdmissionModel: testProviderAdmissionModel }, runner);

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "scaler-stage-conductor-test-"));
}

async function seedValidatedTask(cwd: string, state: ScalerState): Promise<void> {
  state.tasks = [{ id: "T-001", status: "validating", updatedAt: state.updatedAt }];
  await saveState(cwd, state);
  await writeFile(join(cwd, "result.txt"), "verified");
  await saveValidationManifest(cwd, { taskId: "T-001", outputPaths: ["result.txt"], commands: [{ id: "result", required: true,
    command: 'node -e "if(require(\'fs\').readFileSync(\'result.txt\',\'utf8\')!==\'verified\')process.exit(1)"',
  }], createdAt: "", updatedAt: "" });
  assert.equal((await runTaskValidation(cwd, state, "T-001")).acceptance?.accepted, true);
  Object.assign(state, await loadState(cwd));
}

test("runStageConductorStep advances an already ready active-stage artifact", async () => {
  const cwd = await tempDir();
  await writeFile(join(cwd, "agent-prd.md"), "# PRD\n", "utf8");
  const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
  state.stage = "prd";
  await upsertStageArtifact(cwd, {
    id: "ART-PRD",
    stage: "prd",
    status: "ready",
    title: "PRD",
    path: "agent-prd.md",
    requirementRefs: ["PRD-S01"],
  }, new Date("2026-01-01T01:00:00.000Z"));

  let called = false;
  const result = await runStageConductorStep(cwd, state, {}, async () => {
    called = true;
    throw new Error("runner should not be called");
  });

  assert.equal(result.accepted, true);
  assert.equal(result.action, "advance");
  assert.equal(result.advancement?.advanced, true);
  assert.equal(called, false);
  assert.equal((await loadState(cwd)).stage, "knowledge");
});

test("runStageConductorStep reports consistency-gated advancement failures", async () => {
  const cwd = await tempDir();
  await writeFile(join(cwd, "agent-prd.md"), "# PRD\n", "utf8");
  const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
  state.stage = "prd";
  await savePrdRequirements(cwd, {
    version: 1,
    requirements: [{ id: "PRD-S01", statement: "Requirement", createdAt: state.createdAt, updatedAt: state.createdAt }],
  });
  await upsertStageArtifact(cwd, {
    id: "ART-PRD",
    stage: "prd",
    status: "ready",
    title: "PRD",
    path: "agent-prd.md",
    requirementRefs: ["PRD-MISSING"],
  });

  const result = await runStageConductorStep(cwd, state);

  assert.equal(result.accepted, false);
  assert.equal(result.action, "advance");
  assert.equal(result.advancement?.consistencyValidation?.ok, false);
  assert.match(result.message, /inconsistent/);
});

test("runStageConductorStep prepares a stage agent when no ready artifact exists", async () => {
  const cwd = await tempDir();
  const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
  state.stage = "planning";

  const result = await runStageConductorStep(cwd, state, { command: "pi-test" });

  assert.equal(result.accepted, true);
  assert.equal(result.action, "run_stage_agent");
  assert.equal(result.stage, "planning");
  assert.equal(result.readiness?.ok, false);
  assert.equal(result.stageAgent?.runRecord?.status, "prepared");
  assert.match(result.message, /No artifact recorded for stage planning/);
  assert.match(result.message, /Prepared stage agent planning/);
});

test("runStageConductorStep executes, ingests artifact reports, and advances", async () => {
  const cwd = await tempDir();
  await writeFile(join(cwd, "agent-prd.md"), "# PRD\n", "utf8");
  const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
  state.stage = "prd";

  const result = await runStageConductorStep(cwd, state, { execute: true }, async (request) => ({
    taskId: request.taskId,
    exitCode: 0,
    stdoutEvents: [{
      type: "scaler_stage_artifact",
      stage: "prd",
      status: "ready",
      title: "PRD",
      path: "agent-prd.md",
      summary: "PRD ready.",
    }],
    stderr: "",
    timedOut: false,
    aborted: false,
  }));

  assert.equal(result.accepted, true);
  assert.equal(result.action, "run_stage_agent");
  assert.equal(result.stageAgent?.ingestion?.ingested, true);
  assert.equal(result.advancement?.advanced, true);
  assert.equal((await loadState(cwd)).stage, "knowledge");
  assert.match(result.message, /Ingested stage artifact ART-prd-/);
  assert.match(result.message, /Advanced stage prd -> knowledge/);
});

test("runStageConductorStep rejects unsupported supervisor stages", async () => {
  const cwd = await tempDir();
  const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
  state.stage = "idle";

  const result = await runStageConductorStep(cwd, state);

  assert.equal(result.accepted, false);
  assert.equal(result.action, "unsupported_stage");
  assert.equal(result.message, "Stage conductor cannot run for supervisor stage idle.");
});

test("runStageConductorLoop chains pre-existing ready artifacts until completion", async () => {
  const cwd = await tempDir();
  await writeFile(join(cwd, "agent-prd.md"), "# PRD\n", "utf8");
  await writeFile(join(cwd, "knowledge.md"), "# Knowledge\n", "utf8");
  await writeFile(join(cwd, "plan.md"), "# Plan\n", "utf8");
  const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
  state.stage = "prd";
  await seedValidatedTask(cwd, state);
  await upsertStageArtifact(cwd, { id: "ART-PRD", stage: "prd", status: "ready", title: "PRD", path: "agent-prd.md", requirementRefs: ["PRD-S01"] });
  await upsertStageArtifact(cwd, { id: "ART-K", stage: "knowledge", status: "ready", title: "Knowledge", path: "knowledge.md", summary: "Knowledge summary." });
  await upsertStageArtifact(cwd, { id: "ART-P", stage: "planning", status: "ready", title: "Plan", path: "plan.md", taskRefs: ["T-001"] });
  await upsertStageArtifact(cwd, { id: "ART-E", stage: "execution", status: "ready", title: "Execution", summary: "No tasks remain." });

  const result = await runStageConductorLoop(cwd, state, { maxSteps: 5 });

  assert.equal(result.accepted, true);
  assert.equal(result.completed, true);
  assert.equal(result.stopReason, "completed");
  assert.deepEqual(result.steps.map((step) => step.stage), ["prd", "knowledge", "planning", "execution"]);
  assert.equal(result.finalState.stage, "completed");
  assert.equal((await loadState(cwd)).stage, "completed");
  assert.match(result.message, /steps=4 stop=completed final_stage=completed/);
});

test("runStageConductorLoop executes child reports and carries advanced state forward", async () => {
  const cwd = await tempDir();
  const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
  state.stage = "prd";
  await seedValidatedTask(cwd, state);

  const result = await runStageConductorLoop(cwd, state, { execute: true, maxSteps: 5 }, async (request) => {
    const stage = request.taskId.replace(/^stage-/, "");
    const path = stage === "execution" ? undefined : `${stage}.md`;
    if (path) await writeFile(join(cwd, path), `# ${stage}\n`, "utf8");
    return {
      taskId: request.taskId,
      exitCode: 0,
      stdoutEvents: [{
        type: "scaler_stage_artifact",
        stage,
        status: "ready",
        title: `${stage} artifact`,
        path,
        summary: `${stage} ready`,
        taskRefs: stage === "planning" || stage === "execution" ? ["T-001"] : undefined,
        requirementRefs: stage === "prd" || stage === "planning" ? ["PRD-S01"] : undefined,
      }],
      stderr: "",
      timedOut: false,
      aborted: false,
    };
  });

  assert.equal(result.accepted, true);
  assert.equal(result.completed, true);
  assert.equal(result.stopReason, "completed");
  assert.deepEqual(result.steps.map((step) => step.action), ["run_stage_agent", "run_stage_agent", "run_stage_agent", "run_stage_agent"]);
  assert.equal(result.steps.every((step) => step.advancement?.advanced), true);
  assert.equal(result.finalState.stage, "completed");
});

test("runStageConductorLoop stops after prepare-mode stage-agent handoff", async () => {
  const cwd = await tempDir();
  const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
  state.stage = "knowledge";

  const result = await runStageConductorLoop(cwd, state, { command: "pi-test", maxSteps: 5 });

  assert.equal(result.accepted, true);
  assert.equal(result.completed, false);
  assert.equal(result.stopReason, "prepared_stage_agent");
  assert.equal(result.steps.length, 1);
  assert.equal(result.steps[0].stageAgent?.runRecord?.status, "prepared");
  assert.equal(result.finalState.stage, "knowledge");
});

test("runStageConductorLoop stops at max steps while preserving progress", async () => {
  const cwd = await tempDir();
  await writeFile(join(cwd, "agent-prd.md"), "# PRD\n", "utf8");
  await writeFile(join(cwd, "knowledge.md"), "# Knowledge\n", "utf8");
  await mkdir(join(cwd, ".scaler", "plans"), { recursive: true });
  await writeFile(join(cwd, ".scaler", "plans", "current-plan.json"), "{}\n", "utf8");
  const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
  state.stage = "prd";
  await upsertStageArtifact(cwd, { id: "ART-PRD", stage: "prd", status: "ready", title: "PRD", path: "agent-prd.md", requirementRefs: ["PRD-S01"] });
  await upsertStageArtifact(cwd, { id: "ART-K", stage: "knowledge", status: "ready", title: "Knowledge", path: "knowledge.md", summary: "Knowledge summary." });
  await upsertStageArtifact(cwd, { id: "ART-P", stage: "planning", status: "ready", title: "Plan", path: ".scaler/plans/current-plan.json", taskRefs: ["T-001"] });

  const result = await runStageConductorLoop(cwd, state, { maxSteps: 2 });

  assert.equal(result.accepted, true);
  assert.equal(result.completed, false);
  assert.equal(result.stopReason, "max_steps");
  assert.deepEqual(result.steps.map((step) => step.stage), ["prd", "knowledge"]);
  assert.equal(result.finalState.stage, "planning");
  assert.equal((await loadState(cwd)).stage, "planning");
});

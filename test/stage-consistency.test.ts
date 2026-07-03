import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { appendReplanRequest, saveExecutionPlan, saveProposedExecutionPlan } from "../src/plans.js";
import { savePrdRequirements } from "../src/prd.js";
import { formatStageArtifactConsistency, validateStageArtifactConsistency } from "../src/stage-consistency.js";
import { createDefaultState } from "../src/state.js";
import { upsertStageArtifact } from "../src/stages.js";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "scaler-stage-consistency-test-"));
}

const createdAt = "2026-01-01T00:00:00.000Z";

test("validateStageArtifactConsistency validates requirement refs against runtime PRD when present", async () => {
  const cwd = await tempDir();
  const state = createDefaultState(new Date(createdAt));
  await savePrdRequirements(cwd, {
    version: 1,
    requirements: [{ id: "PRD-S01", statement: "Requirement", createdAt, updatedAt: createdAt }],
  });
  const artifact = await upsertStageArtifact(cwd, {
    id: "ART-PRD",
    stage: "prd",
    status: "ready",
    title: "PRD",
    summary: "PRD summary",
    requirementRefs: ["PRD-MISSING"],
  });

  const invalid = await validateStageArtifactConsistency(cwd, state, "prd", artifact);
  assert.equal(invalid.ok, false);
  assert.deepEqual(invalid.reasons, ["Stage prd artifact ART-PRD references unknown runtime PRD requirement ids: PRD-MISSING."]);
  assert.equal(
    formatStageArtifactConsistency(invalid),
    "Stage prd artifact is inconsistent. artifact=ART-PRD\n- Stage prd artifact ART-PRD references unknown runtime PRD requirement ids: PRD-MISSING.",
  );

  const validArtifact = await upsertStageArtifact(cwd, {
    id: "ART-PRD",
    stage: "prd",
    status: "ready",
    title: "PRD",
    requirementRefs: ["PRD-S01"],
  });
  const valid = await validateStageArtifactConsistency(cwd, state, "prd", validArtifact);
  assert.equal(valid.ok, true);
  assert.equal(formatStageArtifactConsistency(valid), "Stage prd artifact is consistent. artifact=ART-PRD");
});

test("validateStageArtifactConsistency checks planning task refs against current execution plan", async () => {
  const cwd = await tempDir();
  const state = createDefaultState(new Date(createdAt));
  await saveExecutionPlan(cwd, {
    version: 1,
    planVersion: 1,
    status: "active",
    tasks: [{ id: "T-001", title: "Task 1" }],
    createdAt,
    updatedAt: createdAt,
  });
  const artifact = await upsertStageArtifact(cwd, {
    id: "ART-PLAN",
    stage: "planning",
    status: "ready",
    title: "Plan",
    taskRefs: ["T-002"],
  });

  const validation = await validateStageArtifactConsistency(cwd, state, "planning", artifact);
  assert.equal(validation.ok, false);
  assert.deepEqual(validation.reasons, ["Stage planning artifact ART-PLAN references task ids not in current execution plan: T-002."]);
});

test("validateStageArtifactConsistency checks execution refs against supervisor tasks", async () => {
  const cwd = await tempDir();
  const state = createDefaultState(new Date(createdAt));
  state.tasks = [{ id: "T-001", status: "ready", updatedAt: createdAt }];
  const artifact = await upsertStageArtifact(cwd, {
    id: "ART-EXEC",
    stage: "execution",
    status: "ready",
    title: "Execution",
    taskRefs: ["T-002"],
  });

  const validation = await validateStageArtifactConsistency(cwd, state, "execution", artifact);
  assert.equal(validation.ok, false);
  assert.deepEqual(validation.reasons, ["Stage execution artifact ART-EXEC references unknown supervisor task ids: T-002."]);
});

test("validateStageArtifactConsistency checks replanning request refs and proposed plan", async () => {
  const cwd = await tempDir();
  const state = createDefaultState(new Date(createdAt));
  await appendReplanRequest(cwd, {
    id: "REPLAN-1",
    trigger: "manual",
    reason: "Need replan",
  }, new Date(createdAt));
  await mkdir(join(cwd, ".scaler", "plans"), { recursive: true });
  await writeFile(join(cwd, ".scaler", "plans", "proposed-plan.json"), "not json\n", "utf8");
  const artifact = await upsertStageArtifact(cwd, {
    id: "ART-REPLAN",
    stage: "replanning",
    status: "ready",
    title: "Replan",
    path: ".scaler/plans/proposed-plan.json",
    evidenceRefs: ["ev:1"],
    requirementRefs: ["PRD-S01"],
  });

  const invalidPlan = await validateStageArtifactConsistency(cwd, state, "replanning", artifact);
  assert.equal(invalidPlan.ok, false);
  assert.match(invalidPlan.reasons.join("\n"), /invalid proposed execution plan/);

  await saveProposedExecutionPlan(cwd, {
    version: 1,
    planVersion: 2,
    status: "draft",
    tasks: [{ id: "T-001", title: "Task 1" }],
    createdAt,
    updatedAt: createdAt,
  });
  const invalid = await validateStageArtifactConsistency(cwd, state, "replanning", artifact);
  assert.equal(invalid.ok, false);
  assert.deepEqual(invalid.reasons, ["Stage replanning artifact ART-REPLAN must reference a known replan request id in evidence refs."]);

  const validArtifact = await upsertStageArtifact(cwd, {
    id: "ART-REPLAN",
    stage: "replanning",
    status: "ready",
    title: "Replan",
    path: ".scaler/plans/proposed-plan.json",
    evidenceRefs: ["REPLAN-1"],
    taskRefs: ["T-001"],
  });
  const valid = await validateStageArtifactConsistency(cwd, state, "replanning", validArtifact);
  assert.equal(valid.ok, true);
});

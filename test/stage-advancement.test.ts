import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { savePrdRequirements } from "../src/prd.js";
import { advanceStageAfterReadyArtifact, nextStageForArtifact } from "../src/stage-advancement.js";
import { createDefaultState, loadState, saveState } from "../src/state.js";
import { upsertStageArtifact } from "../src/stages.js";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "scaler-stage-advance-test-"));
}

test("nextStageForArtifact maps stage artifacts to deterministic targets", () => {
  assert.equal(nextStageForArtifact("prd"), "knowledge");
  assert.equal(nextStageForArtifact("knowledge"), "planning");
  assert.equal(nextStageForArtifact("planning"), "execution");
  assert.equal(nextStageForArtifact("replanning"), "execution");
  assert.equal(nextStageForArtifact("execution"), "completed");
});

test("advanceStageAfterReadyArtifact validates artifact and advances matching supervisor stage", async () => {
  const cwd = await tempDir();
  await writeFile(join(cwd, "agent-prd.md"), "# PRD\n", "utf8");
  const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
  state.stage = "prd";
  await saveState(cwd, state);
  await upsertStageArtifact(cwd, {
    id: "ART-PRD",
    stage: "prd",
    status: "ready",
    title: "PRD",
    path: "agent-prd.md",
    requirementRefs: ["PRD-S01"],
  }, new Date("2026-01-01T01:00:00.000Z"));

  const result = await advanceStageAfterReadyArtifact(cwd, state, "prd", new Date("2026-01-01T02:00:00.000Z"));

  assert.equal(result.accepted, true);
  assert.equal(result.advanced, true);
  assert.equal(result.state.stage, "knowledge");
  assert.equal((await loadState(cwd)).stage, "knowledge");
  assert.match(result.message, /Advanced stage prd -> knowledge/);
});

test("advanceStageAfterReadyArtifact refuses invalid artifact and stage mismatches", async () => {
  const cwd = await tempDir();
  const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
  state.stage = "knowledge";
  await upsertStageArtifact(cwd, {
    id: "ART-PRD",
    stage: "prd",
    status: "ready",
    title: "PRD",
    path: "missing.md",
  }, new Date("2026-01-01T01:00:00.000Z"));

  const invalid = await advanceStageAfterReadyArtifact(cwd, state, "prd");
  assert.equal(invalid.accepted, false);
  assert.match(invalid.message, /Artifact path does not exist/);

  await writeFile(join(cwd, "agent-prd.md"), "# PRD\n", "utf8");
  await upsertStageArtifact(cwd, {
    id: "ART-PRD",
    stage: "prd",
    status: "ready",
    title: "PRD",
    path: "agent-prd.md",
    requirementRefs: ["PRD-S01"],
  }, new Date("2026-01-01T02:00:00.000Z"));
  const mismatch = await advanceStageAfterReadyArtifact(cwd, state, "prd");
  assert.equal(mismatch.accepted, false);
  assert.equal(mismatch.message, "Cannot advance prd artifact while supervisor stage is knowledge.");
});

test("advanceStageAfterReadyArtifact refuses semantically invalid artifacts", async () => {
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
  }, new Date("2026-01-01T01:00:00.000Z"));

  const result = await advanceStageAfterReadyArtifact(cwd, state, "prd");

  assert.equal(result.accepted, false);
  assert.equal(result.advanced, false);
  assert.equal(result.semanticValidation?.ok, false);
  assert.match(result.message, /semantically invalid/);
  assert.match(result.message, /requires requirement refs or a summary/);
});

test("advanceStageAfterReadyArtifact refuses inconsistent artifacts", async () => {
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
  }, new Date("2026-01-01T01:00:00.000Z"));

  const result = await advanceStageAfterReadyArtifact(cwd, state, "prd");

  assert.equal(result.accepted, false);
  assert.equal(result.advanced, false);
  assert.equal(result.consistencyValidation?.ok, false);
  assert.match(result.message, /inconsistent/);
  assert.match(result.message, /unknown runtime PRD requirement ids/);
});

test("advanceStageAfterReadyArtifact preserves supervisor completion guard", async () => {
  const cwd = await tempDir();
  const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
  state.stage = "execution";
  state.tasks = [{ id: "T-001", status: "ready", updatedAt: state.createdAt }];
  await upsertStageArtifact(cwd, {
    id: "ART-EXEC",
    stage: "execution",
    status: "ready",
    title: "Execution",
    summary: "Execution artifact",
  }, new Date("2026-01-01T01:00:00.000Z"));

  const result = await advanceStageAfterReadyArtifact(cwd, state, "execution", new Date("2026-01-01T02:00:00.000Z"));

  assert.equal(result.accepted, false);
  assert.equal(result.advanced, false);
  assert.equal(result.state.stage, "execution");
  assert.equal(result.state.rejectedTransitions.length, 1);
});

import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  formatStageArtifactReadiness,
  formatStageArtifactSummary,
  loadStageArtifacts,
  saveStageArtifacts,
  summarizeStageArtifacts,
  upsertStageArtifact,
  validateStageArtifact,
  validateStageArtifactReadiness,
} from "../src/stages.js";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "scaler-stages-test-"));
}

test("loadStageArtifacts returns empty array when missing", async () => {
  assert.deepEqual(await loadStageArtifacts(await tempDir()), []);
});

test("upsertStageArtifact creates and updates normalized artifacts", async () => {
  const cwd = await tempDir();
  const created = await upsertStageArtifact(cwd, {
    id: "ART-PRD",
    stage: "prd",
    status: "ready",
    title: " Polished PRD ",
    path: "agent-prd.md",
    evidenceRefs: [" log:2 ", "log:1", "log:1"],
    requirementRefs: ["PRD-S01"],
  }, new Date("2026-01-01T00:00:00.000Z"));

  assert.equal(created.id, "ART-PRD");
  assert.deepEqual(created.evidenceRefs, ["log:1", "log:2"]);

  const updated = await upsertStageArtifact(cwd, {
    id: "ART-PRD",
    stage: "prd",
    status: "accepted",
    summary: "Reviewed and accepted.",
  }, new Date("2026-01-01T01:00:00.000Z"));

  assert.equal(updated.createdAt, "2026-01-01T00:00:00.000Z");
  assert.equal(updated.updatedAt, "2026-01-01T01:00:00.000Z");
  assert.equal(updated.title, "Polished PRD");
  assert.equal(updated.summary, "Reviewed and accepted.");
  assert.equal((await loadStageArtifacts(cwd)).length, 1);
});

test("saveStageArtifacts sorts and formatStageArtifactSummary renders latest per stage", async () => {
  const cwd = await tempDir();
  const artifacts = await saveStageArtifacts(cwd, [
    {
      id: "ART-PLAN-OLD",
      stage: "planning",
      status: "superseded",
      title: "Old plan",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "ART-PRD",
      stage: "prd",
      status: "accepted",
      title: "PRD",
      path: "agent-prd.md",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "ART-PLAN",
      stage: "planning",
      status: "ready",
      title: "Plan",
      createdAt: "2026-01-01T01:00:00.000Z",
      updatedAt: "2026-01-01T01:00:00.000Z",
    },
  ]);

  assert.deepEqual(artifacts.map((artifact) => artifact.id), ["ART-PRD", "ART-PLAN", "ART-PLAN-OLD"]);
  const summary = summarizeStageArtifacts(artifacts);
  assert.deepEqual(summary.readyStages, ["prd", "planning"]);
  assert.deepEqual(summary.missingStages, ["knowledge", "execution", "replanning"]);
  assert.equal(summary.latestByStage.planning?.id, "ART-PLAN");
  assert.equal(
    formatStageArtifactSummary(summary),
    "Stage artifacts: total=3 ready=2/5\n- prd: ART-PRD accepted path=agent-prd.md title=PRD\n- knowledge: missing\n- planning: ART-PLAN ready title=Plan\n- execution: missing\n- replanning: missing",
  );
});

test("validateStageArtifactReadiness checks latest ready artifact details and paths", async () => {
  const cwd = await tempDir();
  await writeFile(join(cwd, "agent-prd.md"), "# PRD\n", "utf8");
  const ready = await validateStageArtifactReadiness(cwd, [{
    id: "ART-PRD",
    stage: "prd",
    status: "ready",
    title: "PRD",
    path: "agent-prd.md",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }], "prd");

  assert.equal(ready.ok, true);
  assert.equal(formatStageArtifactReadiness(ready), "Stage prd artifact is ready. artifact=ART-PRD");

  const notReady = await validateStageArtifactReadiness(cwd, [{
    id: "ART-PLAN",
    stage: "planning",
    status: "draft",
    title: "Plan",
    path: ".scaler/plans/current-plan.json",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }], "planning");

  assert.equal(notReady.ok, false);
  assert.deepEqual(notReady.reasons, [
    "Latest planning artifact ART-PLAN status is draft, expected ready or accepted.",
    "Artifact path does not exist: .scaler/plans/current-plan.json",
  ]);
});

test("validateStageArtifactReadiness requires path for planning but allows execution summaries", async () => {
  const cwd = await tempDir();
  const planning = await validateStageArtifactReadiness(cwd, [{
    id: "ART-PLAN",
    stage: "planning",
    status: "ready",
    title: "Plan",
    summary: "Plan created in memory",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }], "planning");
  assert.equal(planning.ok, false);
  assert.deepEqual(planning.reasons, ["Stage planning requires an artifact path."]);

  const execution = await validateStageArtifactReadiness(cwd, [{
    id: "ART-EXEC",
    stage: "execution",
    status: "accepted",
    title: "Execution status",
    summary: "All tasks are ready for execution.",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }], "execution");
  assert.equal(execution.ok, true);
});

test("validateStageArtifact rejects invalid records", () => {
  assert.throws(() => validateStageArtifact({
    id: "ART-BAD",
    stage: "bad",
    status: "ready",
    title: "Bad",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  } as never), /Invalid stage artifact stage/);
});

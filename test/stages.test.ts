import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  formatStageArtifactSummary,
  loadStageArtifacts,
  saveStageArtifacts,
  summarizeStageArtifacts,
  upsertStageArtifact,
  validateStageArtifact,
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

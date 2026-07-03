import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runStageConductorStep } from "../src/stage-conductor.js";
import { createDefaultState, loadState } from "../src/state.js";
import { upsertStageArtifact } from "../src/stages.js";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "scaler-stage-conductor-test-"));
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

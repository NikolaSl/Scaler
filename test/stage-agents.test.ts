import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  buildStageAgentPrompt,
  formatStageAgentRunList,
  loadStageAgentRunRecords,
  normalizeStage,
  prepareStageAgentInvocation,
  recordStageAgentRun,
  runStageAgentStep,
} from "../src/stage-agents.js";
import { createDefaultState } from "../src/state.js";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "scaler-stage-agents-test-"));
}

test("buildStageAgentPrompt includes stage contract, state, and artifact refs", () => {
  const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
  state.stage = "planning";
  const prompt = buildStageAgentPrompt({
    stage: "planning",
    state,
    artifacts: [{
      id: "ART-PLAN",
      stage: "planning",
      status: "draft",
      title: "Draft plan",
      path: ".scaler/plans/current-plan.json",
      createdAt: state.createdAt,
      updatedAt: state.createdAt,
    }],
    extraInstructions: "Prefer small tasks.",
  });

  assert.match(prompt, /Target stage: planning/);
  assert.match(prompt, /SCALER stage=planning/);
  assert.match(prompt, /Create or refresh the sequential execution plan/);
  assert.match(prompt, /ART-PLAN \| draft \| Draft plan \| path=.scaler\/plans\/current-plan.json/);
  assert.match(prompt, /Prefer small tasks/);
  assert.match(prompt, /\/scaler-stage-record/);
});

test("prepareStageAgentInvocation builds isolated Pi invocation", () => {
  const state = createDefaultState();
  const preparation = prepareStageAgentInvocation("/repo", {
    stage: "prd",
    state,
  }, {
    command: "pi-test",
    tools: ["read", "write"],
    model: "test-model",
    extensionPaths: [".pi/extensions/scaler"],
  });

  assert.equal(preparation.stage, "prd");
  assert.equal(preparation.invocation.command, "pi-test");
  assert.equal(preparation.invocation.cwd, "/repo");
  assert.deepEqual(preparation.invocation.args.slice(0, 4), ["--mode", "json", "-p", "--no-session"]);
  assert.ok(preparation.invocation.args.includes("--tools"));
  assert.ok(preparation.invocation.args.includes("read,write"));
  assert.ok(preparation.invocation.args.includes("--model"));
  assert.ok(preparation.invocation.args.includes("test-model"));
  assert.equal(preparation.request.taskId, "stage-prd");
  assert.match(preparation.prompt, /Write or update `agent-prd.md`/);
});

test("stage agent run records round trip and format", async () => {
  const cwd = await tempDir();
  assert.deepEqual(await loadStageAgentRunRecords(cwd), []);

  await recordStageAgentRun(cwd, "knowledge", undefined, "prepared", new Date("2026-01-01T00:00:00.000Z"));
  await recordStageAgentRun(cwd, "planning", {
    taskId: "stage-planning",
    exitCode: 1,
    stdoutEvents: [{ type: "message" }],
    stderr: "failed with details",
    timedOut: false,
    aborted: false,
  }, undefined, new Date("2026-01-01T01:00:00.000Z"));

  const records = await loadStageAgentRunRecords(cwd);
  assert.deepEqual(records.map((record) => record.stage), ["planning", "knowledge"]);
  assert.equal(
    formatStageAgentRunList(records),
    "Stage-agent runs:\n- planning: failed exit=1 flags=none stdout_events=1 stderr=failed with details\n- knowledge: prepared exit=n/a flags=none stdout_events=0",
  );
  assert.equal(formatStageAgentRunList(records, "knowledge"), "Stage-agent runs for knowledge:\n- knowledge: prepared exit=n/a flags=none stdout_events=0");
});

test("runStageAgentStep prepares and executes under lock", async () => {
  const cwd = await tempDir();
  const state = createDefaultState();
  const prepared = await runStageAgentStep(cwd, state, "prd", { command: "pi-test" });

  assert.equal(prepared.accepted, true);
  assert.equal(prepared.runRecord?.status, "prepared");
  assert.match(prepared.prompt ?? "", /Target stage: prd/);

  const executed = await runStageAgentStep(cwd, state, "planning", { execute: true }, async (request) => ({
    taskId: request.taskId,
    exitCode: 0,
    stdoutEvents: [{ type: "done" }],
    stderr: "",
    timedOut: false,
    aborted: false,
  }));

  assert.equal(executed.accepted, true);
  assert.equal(executed.runRecord?.status, "passed");
  assert.equal(executed.runResult?.taskId, "stage-planning");
});

test("normalizeStage rejects invalid stage agents", () => {
  assert.equal(normalizeStage("knowledge"), "knowledge");
  assert.throws(() => normalizeStage("bad"), /Invalid stage agent stage/);
});

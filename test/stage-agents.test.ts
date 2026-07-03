import assert from "node:assert/strict";
import { test } from "node:test";
import { buildStageAgentPrompt, normalizeStage, prepareStageAgentInvocation } from "../src/stage-agents.js";
import { createDefaultState } from "../src/state.js";

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
  assert.match(preparation.prompt, /Write or update `agent-prd.md`/);
});

test("normalizeStage rejects invalid stage agents", () => {
  assert.equal(normalizeStage("knowledge"), "knowledge");
  assert.throws(() => normalizeStage("bad"), /Invalid stage agent stage/);
});

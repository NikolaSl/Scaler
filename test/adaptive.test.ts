import assert from "node:assert/strict";
import { test } from "node:test";
import { selectComplexity, startScalerRun } from "../src/adaptive.js";
import { createDefaultState } from "../src/state.js";

test("selectComplexity returns level 0 for empty request", () => {
  const decision = selectComplexity("   ");

  assert.equal(decision.level, 0);
  assert.equal(decision.stage, "idle");
});

test("selectComplexity routes simple request to lightweight execution", () => {
  const decision = selectComplexity("Explain this term");

  assert.equal(decision.level, 1);
  assert.equal(decision.stage, "execution");
});

test("selectComplexity routes implementation request to planning", () => {
  const decision = selectComplexity("add unit tests for parser");

  assert.equal(decision.level, 2);
  assert.equal(decision.stage, "planning");
});

test("selectComplexity routes high-risk request to full workflow", () => {
  const decision = selectComplexity("deploy kubernetes auth service");

  assert.equal(decision.level, 4);
  assert.equal(decision.stage, "prd");
});

test("startScalerRun updates state and applies selected transition", () => {
  const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
  const next = startScalerRun(state, "add parser tests", new Date("2026-01-01T00:00:01.000Z"));

  assert.equal(next.complexityLevel, 2);
  assert.equal(next.stage, "planning");
  assert.match(next.orchestrationReason ?? "", /Implementation request/);
});

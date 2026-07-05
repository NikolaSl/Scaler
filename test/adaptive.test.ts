/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { applyAdaptiveOrchestration, assessAdaptiveOrchestration, formatAdaptiveAssessment, selectComplexity, startScalerRun } from "../src/adaptive.js";
import { setBudgetLimits, setBudgetUsage } from "../src/budgets.js";
import { createDefaultState } from "../src/state.js";
import { addTask } from "../src/supervisor.js";

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

test("assessAdaptiveOrchestration escalates validation failures into debugging", () => {
  const base = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
  const execution = { ...base, stage: "execution" as const, complexityLevel: 2 };
  const state = addTask(execution, { id: "T-FAIL", status: "debugging", title: "Fix parser" }, new Date("2026-01-01T00:00:01.000Z"));

  const assessment = assessAdaptiveOrchestration(state);

  assert.equal(assessment.action, "escalate");
  assert.equal(assessment.targetStage, "debugging");
  assert.equal(assessment.targetLevel, 3);
  assert.equal(assessment.stageTransitionAvailable, true);
  assert.match(formatAdaptiveAssessment(assessment), /Validation\/debug failure threshold reached/);
});

test("applyAdaptiveOrchestration pauses on hard budget and records complexity", () => {
  const base = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
  const execution = { ...base, stage: "execution" as const, complexityLevel: 3 };
  const limited = setBudgetLimits(execution, { validationLoops: { hard: 1 } }, new Date("2026-01-01T00:00:01.000Z"));
  const used = setBudgetUsage(limited, "validationLoops", 1, new Date("2026-01-01T00:00:02.000Z")).state;

  const assessment = assessAdaptiveOrchestration(used);
  const applied = applyAdaptiveOrchestration(used, assessment, new Date("2026-01-01T00:00:03.000Z"));

  assert.equal(assessment.action, "pause");
  assert.equal(applied.stageTransitionApplied, true);
  assert.equal(applied.state.stage, "paused");
  assert.equal(applied.state.complexityLevel, 3);
  assert.match(applied.state.orchestrationReason ?? "", /Budget hard limit/);
});

test("assessAdaptiveOrchestration deescalates clear low-risk execution", () => {
  const base = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
  const execution = { ...base, stage: "execution" as const, complexityLevel: 3 };
  const state = addTask(execution, { id: "T-DONE", status: "validated", title: "Done" }, new Date("2026-01-01T00:00:01.000Z"));

  const assessment = assessAdaptiveOrchestration(state);

  assert.equal(assessment.action, "deescalate");
  assert.equal(assessment.targetStage, "execution");
  assert.equal(assessment.targetLevel, 2);
  assert.equal(assessment.budgetDecision.status, "ok");
});

test("assessAdaptiveOrchestration escalates blocked tasks to replanning when transition is valid", () => {
  const base = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
  const execution = { ...base, stage: "execution" as const, complexityLevel: 2 };
  const state = addTask(execution, { id: "T-BLOCK", status: "blocked", title: "Blocked" }, new Date("2026-01-01T00:00:01.000Z"));

  const assessment = assessAdaptiveOrchestration(state);

  assert.equal(assessment.action, "escalate");
  assert.equal(assessment.targetStage, "replanning");
  assert.equal(assessment.stageTransitionAvailable, true);
  assert.equal(assessment.targetLevel, 3);
});

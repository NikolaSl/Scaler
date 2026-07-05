/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createDefaultState } from "../src/state.js";
import { formatWorkflowSummary, summarizeWorkflow } from "../src/workflow.js";

test("summarizeWorkflow recommends task creation when no tasks exist", () => {
  const summary = summarizeWorkflow(createDefaultState());

  assert.equal(summary.currentTask, "none");
  assert.equal(summary.nextAction, "/scaler-task-create <taskId> | <title> | <paths>");
});

test("summarizeWorkflow recommends validation before commits or steps", () => {
  const state = createDefaultState();
  state.tasks = [
    { id: "T-001", status: "validated", updatedAt: state.createdAt },
    { id: "T-002", status: "validating", updatedAt: state.createdAt },
    { id: "T-003", status: "ready", updatedAt: state.createdAt },
  ];

  const summary = summarizeWorkflow(state);

  assert.equal(summary.nextAction, "/scaler-validate T-002");
  assert.deepEqual(summary.hints, [
    "1 validated task(s) can be committed",
    "1 runnable task(s)",
    "1 task(s) awaiting validation",
  ]);
});

test("summarizeWorkflow reports current task and warnings", () => {
  const state = createDefaultState();
  state.currentTaskId = "T-001";
  state.tasks = [
    { id: "T-001", title: "Fix bug", status: "debugging", updatedAt: state.createdAt },
    { id: "T-002", status: "blocked", updatedAt: state.createdAt },
  ];
  state.rejectedTransitions = [{ kind: "task", from: "ready", to: "validated", reason: "invalid", timestamp: state.createdAt }];

  const summary = summarizeWorkflow(state);

  assert.equal(summary.currentTask, "T-001:debugging (Fix bug)");
  assert.equal(summary.nextAction, "debug T-001, then report a validation/debug outcome");
  assert.deepEqual(summary.warnings, [
    "1 task(s) in debugging",
    "1 blocked/replan task(s)",
    "1 rejected transition(s)",
  ]);
});

test("summarizeWorkflow recommends active stage artifact records before task execution", () => {
  const state = createDefaultState();
  state.stage = "planning";
  state.tasks = [{ id: "T-001", status: "ready", updatedAt: state.createdAt }];

  assert.equal(
    summarizeWorkflow(state, { stageArtifacts: [] }).nextAction,
    "/scaler-stage-record planning | ready | Stage III execution plan artifact | <path> | <summary>",
  );

  assert.equal(
    summarizeWorkflow(state, {
      stageArtifacts: [{
        id: "ART-PLAN",
        stage: "planning",
        status: "accepted",
        title: "Plan",
        createdAt: state.createdAt,
        updatedAt: state.createdAt,
      }],
    }).nextAction,
    "/scaler-step",
  );
});

test("formatWorkflowSummary renders compact multiline summary", () => {
  assert.equal(
    formatWorkflowSummary({ currentTask: "none", nextAction: "/scaler-step", hints: ["1 runnable task(s)"], warnings: [] }),
    "Workflow:\n- current: none\n- next: /scaler-step\n- hints: 1 runnable task(s)",
  );
});

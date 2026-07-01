import assert from "node:assert/strict";
import { test } from "node:test";
import { createDefaultState } from "../src/state.js";
import { addTask, canTransitionStage, transitionStage, transitionTask } from "../src/supervisor.js";

test("allows valid stage transition", () => {
  const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));

  const next = transitionStage(state, "prd", {
    reason: "start PRD stage",
    now: new Date("2026-01-01T00:00:01.000Z"),
  });

  assert.equal(next.stage, "prd");
  assert.equal(next.orchestrationReason, "start PRD stage");
  assert.equal(next.rejectedTransitions.length, 0);
});

test("rejects invalid stage transition and keeps previous stage", () => {
  const state = createDefaultState();
  const planning = transitionStage(state, "planning", { reason: "skip to planning" });
  const rejected = transitionStage(planning, "knowledge", { reason: "go backwards" });

  assert.equal(rejected.stage, "planning");
  assert.equal(rejected.rejectedTransitions.length, 1);
  assert.match(rejected.rejectedTransitions[0]?.reason ?? "", /Invalid stage transition/);
});

test("does not complete run before all tasks are validated", () => {
  const state = addTask(createDefaultState(), { id: "T-001", status: "ready" });

  const result = canTransitionStage({ ...state, stage: "execution" }, "completed");

  assert.equal(result.ok, false);
  assert.match(result.reason ?? "", /all tasks are validated/);
});

test("pause resumes only to previous active stage", () => {
  const state = { ...createDefaultState(), stage: "execution" as const };
  const paused = transitionStage(state, "paused", { reason: "budget pause" });
  const rejected = transitionStage(paused, "planning", { reason: "wrong resume" });
  const resumed = transitionStage(paused, "execution", { reason: "resume" });

  assert.equal(paused.previousStage, "execution");
  assert.equal(rejected.stage, "paused");
  assert.equal(rejected.rejectedTransitions.length, 1);
  assert.equal(resumed.stage, "execution");
  assert.equal(resumed.previousStage, null);
});

test("task transitions update task and validation lists", () => {
  let state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
  state = addTask(state, { id: "T-001", status: "pending", title: "Test task" });
  state = transitionTask(state, "T-001", "ready", { reason: "inputs ready" });
  state = transitionTask(state, "T-001", "running", { reason: "spawned" });
  state = transitionTask(state, "T-001", "validating", { reason: "report submitted" });
  state = transitionTask(state, "T-001", "validated", { reason: "validation accepted" });

  assert.equal(state.tasks[0]?.status, "validated");
  assert.deepEqual(state.completedTaskIds, ["T-001"]);
  assert.deepEqual(state.validatedTaskIds, ["T-001"]);
});

test("rejects invalid task transition", () => {
  const state = addTask(createDefaultState(), { id: "T-001", status: "pending" });
  const rejected = transitionTask(state, "T-001", "validated", { reason: "invalid skip" });

  assert.equal(rejected.tasks[0]?.status, "pending");
  assert.equal(rejected.rejectedTransitions.length, 1);
});

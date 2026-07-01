import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTaskAgentPrompt, selectNextTask } from "../src/conductor.js";
import { createDefaultState } from "../src/state.js";
import type { ScalerTaskStatus } from "../src/types.js";

function stateWithTasks(statuses: ScalerTaskStatus[]) {
  const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
  state.tasks = statuses.map((status, index) => ({ id: `T-00${index + 1}`, status, updatedAt: state.createdAt }));
  return state;
}

test("selectNextTask prefers ready tasks in stable order", () => {
  const selection = selectNextTask(stateWithTasks(["pending", "ready", "ready"]));

  assert.equal(selection.task?.id, "T-002");
  assert.equal(selection.promotePending, false);
});

test("selectNextTask selects pending task when no ready tasks exist", () => {
  const selection = selectNextTask(stateWithTasks(["blocked", "pending"]));

  assert.equal(selection.task?.id, "T-002");
  assert.equal(selection.promotePending, true);
});

test("selectNextTask ignores blocked and terminal tasks", () => {
  const selection = selectNextTask(stateWithTasks(["blocked", "validated", "failed"]));

  assert.equal(selection.task, undefined);
  assert.equal(selection.promotePending, false);
  assert.match(selection.reason, /No runnable tasks/);
  assert.match(selection.reason, /T-001:blocked/);
});

test("selectNextTask returns clear reason for empty state", () => {
  const selection = selectNextTask(createDefaultState());

  assert.equal(selection.task, undefined);
  assert.equal(selection.reason, "No tasks exist.");
});

test("buildTaskAgentPrompt includes task metadata and report instructions", () => {
  const state = stateWithTasks(["ready"]);
  state.stage = "execution";
  state.tasks[0]!.title = "Implement widget";

  const result = buildTaskAgentPrompt({
    state,
    task: state.tasks[0]!,
    contextItems: [
      {
        id: "spec",
        type: "file",
        reason: "Task requirement",
        content: "Widget must render labels.",
        priority: "required",
        scope: "summary",
      },
    ],
  });

  assert.match(result.prompt, /Task ID: T-001/);
  assert.match(result.prompt, /Task title: Implement widget/);
  assert.match(result.prompt, /Current task status: ready/);
  assert.match(result.prompt, /Required final report/);
  assert.match(result.prompt, /Widget must render labels/);
});

test("buildTaskAgentPrompt returns context omissions from resolver", () => {
  const state = stateWithTasks(["ready"]);
  const result = buildTaskAgentPrompt({
    state,
    task: state.tasks[0]!,
    tokenBudget: 20,
    contextItems: [
      {
        id: "required",
        type: "file",
        reason: "Must include",
        content: "Required context",
        priority: "required",
        scope: "summary",
      },
      {
        id: "optional",
        type: "file",
        reason: "Can omit",
        content: "Optional ".repeat(100),
        priority: "optional",
        scope: "summary",
      },
    ],
  });

  assert.deepEqual(result.resolvedContext.included.map((item) => item.id), ["required"]);
  assert.deepEqual(result.resolvedContext.omitted.map((item) => item.id), ["optional"]);
  assert.doesNotMatch(result.prompt, /Optional Optional Optional/);
});

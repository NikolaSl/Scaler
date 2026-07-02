import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildTaskAgentPrompt, dependenciesSatisfied, loadValidationHandoffs, missingDependencies, runConductorStep, selectNextTask } from "../src/conductor.js";
import { createDefaultState, loadState } from "../src/state.js";
import type { ScalerTaskStatus } from "../src/types.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-conductor-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

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

test("selectNextTask skips tasks with unmet dependencies", () => {
  const state = stateWithTasks(["ready", "pending", "validated"]);
  state.tasks[0]!.dependsOn = ["T-003"];
  state.tasks[1]!.dependsOn = ["T-404"];
  state.validatedTaskIds = ["T-003"];

  const selection = selectNextTask(state);

  assert.equal(selection.task?.id, "T-001");
  assert.equal(dependenciesSatisfied(state, state.tasks[0]!), true);
  assert.deepEqual(missingDependencies(state, state.tasks[1]!), ["T-404"]);
});

test("selectNextTask reports dependency-blocked tasks when none are runnable", () => {
  const state = stateWithTasks(["ready", "pending"]);
  state.tasks[0]!.dependsOn = ["T-000"];
  state.tasks[1]!.dependsOn = ["T-001"];

  const selection = selectNextTask(state);

  assert.equal(selection.task, undefined);
  assert.match(selection.reason, /Blocked by dependencies T-001:waiting-for:T-000, T-002:waiting-for:T-001/);
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
  state.tasks[0]!.allowedPathPrefixes = ["src", "test"];
  state.tasks[0]!.dependsOn = ["T-000"];

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
  assert.match(result.prompt, /Allowed paths: src, test/);
  assert.match(result.prompt, /Dependencies: T-000/);
  assert.match(result.prompt, /Safety and scope/);
  assert.match(result.prompt, /read\/write\/edit only files under those paths/);
  assert.match(result.prompt, /Do not read or modify protected paths/);
  assert.match(result.prompt, /Do not run destructive commands/);
  assert.match(result.prompt, /Required final report/);
  assert.match(result.prompt, /Widget must render labels/);
});

test("runConductorStep prepares selected task and writes checkpoint", async () => {
  await withTempDir(async (dir) => {
    const state = stateWithTasks(["pending"]);
    state.stage = "execution";
    const result = await runConductorStep(dir, state, { tools: ["read"] });
    const persisted = await loadState(dir);

    assert.equal(result.accepted, true);
    assert.equal(result.task?.id, "T-001");
    assert.equal(persisted.tasks[0]?.status, "running");
    assert.ok(result.invocation?.args.includes("--tools"));
    assert.ok(result.checkpointPath?.includes("conductor-step-t-001"));
  });
});

test("runConductorStep executes task with injected runner", async () => {
  await withTempDir(async (dir) => {
    const state = stateWithTasks(["ready"]);
    state.stage = "execution";
    const result = await runConductorStep(
      dir,
      state,
      { execute: true, timeoutMs: 123 },
      async (request, options) => ({
        taskId: request.taskId,
        exitCode: options?.timeoutMs === 123 ? 0 : 1,
        stdoutEvents: [{ type: "done" }],
        stderr: "",
      }),
    );

    const persisted = await loadState(dir);
    const handoffs = await loadValidationHandoffs(dir);

    assert.equal(result.accepted, true);
    assert.equal(result.runResult?.exitCode, 0);
    assert.deepEqual(result.runResult?.stdoutEvents, [{ type: "done" }]);
    assert.equal(persisted.tasks[0]?.status, "validating");
    assert.equal(handoffs[0]?.status, "validation_required");
  });
});

test("runConductorStep records failed task-agent validation handoff", async () => {
  await withTempDir(async (dir) => {
    const state = stateWithTasks(["ready"]);
    state.stage = "execution";
    const result = await runConductorStep(
      dir,
      state,
      { execute: true },
      async (request) => ({
        taskId: request.taskId,
        exitCode: 2,
        stdoutEvents: [],
        stderr: "boom",
      }),
    );
    const persisted = await loadState(dir);
    const handoffs = await loadValidationHandoffs(dir);

    assert.equal(result.validationHandoff?.status, "task_agent_failed");
    assert.equal(persisted.tasks[0]?.status, "failed");
    assert.equal(handoffs[0]?.runExitCode, 2);
  });
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

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createDefaultState, loadState } from "../src/state.js";
import { createTask, formatTaskList, retryTask, updateTask } from "../src/tasks.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-task-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("createTask adds pending task by default", async () => {
  await withTempDir(async (dir) => {
    const result = await createTask(dir, createDefaultState(), { id: "T-001", title: "First task" });
    const persisted = await loadState(dir);

    assert.equal(result.accepted, true);
    assert.equal(persisted.tasks[0]?.id, "T-001");
    assert.equal(persisted.tasks[0]?.status, "pending");
  });
});

test("createTask supports explicit ready status", async () => {
  await withTempDir(async (dir) => {
    const result = await createTask(dir, createDefaultState(), { id: "T-001", status: "ready" });

    assert.equal(result.accepted, true);
    assert.equal(result.state.tasks[0]?.status, "ready");
  });
});

test("createTask stores normalized allowed path prefixes, dependencies, PRD refs, and DoD", async () => {
  await withTempDir(async (dir) => {
    const result = await createTask(dir, createDefaultState(), {
      id: "T-001",
      allowedPathPrefixes: ["./src/", "src", " test ", ""],
      dependsOn: ["T-000", "", "T-000", "T-BASE"],
      prdRefs: ["REQ-001", "", "REQ-001", "REQ-002"],
      definitionOfDone: [" tests pass ", "", "tests pass", "docs updated"],
    });

    assert.equal(result.accepted, true);
    assert.deepEqual(result.state.tasks[0]?.allowedPathPrefixes, ["src", "test"]);
    assert.deepEqual(result.state.tasks[0]?.dependsOn, ["T-000", "T-BASE"]);
    assert.deepEqual(result.state.tasks[0]?.prdRefs, ["REQ-001", "REQ-002"]);
    assert.deepEqual(result.state.tasks[0]?.definitionOfDone, ["tests pass", "docs updated"]);
  });
});

test("createTask enforces task quality requirements in strict mode", async () => {
  await withTempDir(async (dir) => {
    const rejected = await createTask(dir, createDefaultState(), { id: "T-STRICT", title: "Too loose", qualityMode: "enforce" });

    assert.equal(rejected.accepted, false);
    assert.match(rejected.message, /quality blocked/);
    assert.deepEqual(rejected.qualityReview?.warnings.map((warning) => warning.code).sort(), ["missing_allowed_paths", "missing_atomicity", "missing_dod", "missing_test_first", "missing_validation"]);
  });
});

test("createTask accepts strict task when requirements are present", async () => {
  await withTempDir(async (dir) => {
    const result = await createTask(dir, createDefaultState(), {
      id: "T-STRICT-OK",
      title: "Strict task",
      qualityMode: "enforce",
      taskKind: "software",
      atomicityRationale: "T-STRICT-OK is independently completable and testable.",
      allowedPathPrefixes: ["src"],
      definitionOfDone: ["Tests pass"],
      validationCommands: [
        { id: "test-first", command: "npm test -- --list", gate: "test_first", required: true },
        { id: "unit", command: "npm test", gate: "unit_tests", required: true },
      ],
    });

    assert.equal(result.accepted, true);
    assert.equal(result.qualityReview?.status, "ok");
  });
});

test("formatTaskList renders current task, status, title, and allowed paths", () => {
  const state = createDefaultState();
  state.currentTaskId = "T-001";
  state.tasks = [
    {
      id: "T-001",
      title: "Add feature",
      status: "validated",
      allowedPathPrefixes: ["src", "test"],
      dependsOn: ["T-000"],
      prdRefs: ["REQ-001"],
      definitionOfDone: ["Tests pass"],
      updatedAt: state.createdAt,
    },
  ];

  assert.equal(formatTaskList(state), "Scaler tasks:\n- T-001: validated *current* - Add feature [paths: src, test] [depends: T-000] [prd: REQ-001] [dod: 1]");
});

test("formatTaskList handles no tasks", () => {
  assert.equal(formatTaskList(createDefaultState()), "No Scaler tasks.");
});

test("updateTask updates metadata and valid status transition", async () => {
  await withTempDir(async (dir) => {
    const created = await createTask(dir, createDefaultState(), { id: "T-001", status: "pending" });
    const result = await updateTask(dir, created.state, {
      id: "T-001",
      title: "Updated",
      status: "ready",
      allowedPathPrefixes: ["src", "test"],
      dependsOn: ["T-000"],
      prdRefs: ["REQ-001", "REQ-002"],
      definitionOfDone: ["Tests pass", "Feature documented"],
    });
    const task = result.state.tasks[0];

    assert.equal(result.accepted, true);
    assert.equal(task?.title, "Updated");
    assert.equal(task?.status, "ready");
    assert.deepEqual(task?.allowedPathPrefixes, ["src", "test"]);
    assert.deepEqual(task?.dependsOn, ["T-000"]);
    assert.deepEqual(task?.prdRefs, ["REQ-001", "REQ-002"]);
    assert.deepEqual(task?.definitionOfDone, ["Tests pass", "Feature documented"]);
  });
});

test("updateTask rejects invalid status transition without metadata changes", async () => {
  await withTempDir(async (dir) => {
    const created = await createTask(dir, createDefaultState(), { id: "T-001", status: "ready", title: "Original" });
    const result = await updateTask(dir, created.state, { id: "T-001", title: "Changed", status: "validated" });

    assert.equal(result.accepted, false);
    assert.equal(result.state.tasks[0]?.title, "Original");
    assert.equal(result.state.tasks[0]?.status, "ready");
    assert.equal(result.state.rejectedTransitions.length, 1);
  });
});

test("updateTask rejects missing tasks", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState();
    const result = await updateTask(dir, state, { id: "missing", title: "Nope" });

    assert.equal(result.accepted, false);
    assert.equal(result.state, state);
  });
});

test("retryTask moves debugging tasks to running", async () => {
  await withTempDir(async (dir) => {
    const created = await createTask(dir, createDefaultState(), { id: "T-001", status: "debugging" });
    const result = await retryTask(dir, created.state, "T-001", "try again");

    assert.equal(result.accepted, true);
    assert.equal(result.state.tasks[0]?.status, "running");
  });
});

test("retryTask moves blocked and needs_replan tasks to ready", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState();
    state.tasks = [
      { id: "T-001", status: "blocked", updatedAt: state.createdAt },
      { id: "T-002", status: "needs_replan", updatedAt: state.createdAt },
    ];

    const first = await retryTask(dir, state, "T-001");
    const second = await retryTask(dir, first.state, "T-002");

    assert.equal(first.accepted, true);
    assert.equal(second.accepted, true);
    assert.equal(second.state.tasks[0]?.status, "ready");
    assert.equal(second.state.tasks[1]?.status, "ready");
  });
});

test("retryTask rejects failed terminal tasks", async () => {
  await withTempDir(async (dir) => {
    const created = await createTask(dir, createDefaultState(), { id: "T-001", status: "failed" });
    const result = await retryTask(dir, created.state, "T-001");

    assert.equal(result.accepted, false);
    assert.equal(result.state.tasks[0]?.status, "failed");
  });
});

test("createTask rejects duplicate task id", async () => {
  await withTempDir(async (dir) => {
    const first = await createTask(dir, createDefaultState(), { id: "T-001" });
    const second = await createTask(dir, first.state, { id: "T-001" });

    assert.equal(second.accepted, false);
    assert.equal(second.state.tasks.length, 1);
    assert.equal(second.state.rejectedTransitions.length, 1);
  });
});

test("createTask rejects invalid status without changing state", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState();
    const result = await createTask(dir, state, { id: "T-001", status: "done" });

    assert.equal(result.accepted, false);
    assert.equal(result.state, state);
    assert.match(result.message, /invalid status/);
  });
});

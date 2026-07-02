import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  applyExecutionPlanTasks,
  createExecutionPlanSnapshot,
  formatExecutionPlanSummary,
  loadExecutionPlan,
  saveExecutionPlan,
  summarizeExecutionPlan,
  validateExecutionPlan,
} from "../src/plans.js";
import { createDefaultState } from "../src/state.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-plans-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("loadExecutionPlan returns empty default when missing", async () => {
  await withTempDir(async (dir) => {
    const plan = await loadExecutionPlan(dir);

    assert.equal(plan.version, 1);
    assert.equal(plan.status, "draft");
    assert.deepEqual(plan.tasks, []);
  });
});

test("saveExecutionPlan and loadExecutionPlan round trip normalized tasks", async () => {
  await withTempDir(async (dir) => {
    await saveExecutionPlan(dir, {
      version: 1,
      planVersion: 1,
      status: "active",
      title: "Plan",
      tasks: [
        {
          id: "T-001",
          title: "Do work",
          prdRefs: ["REQ-001", "REQ-001"],
          allowedPathPrefixes: ["./src/"],
          dependsOn: ["T-000"],
        },
      ],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const loaded = await loadExecutionPlan(dir);
    assert.equal(loaded.status, "active");
    assert.deepEqual(loaded.tasks[0]?.prdRefs, ["REQ-001"]);
    assert.deepEqual(loaded.tasks[0]?.allowedPathPrefixes, ["src"]);
  });
});

test("validateExecutionPlan rejects duplicate task ids and invalid status", () => {
  assert.throws(
    () => validateExecutionPlan({
      version: 1,
      planVersion: 1,
      status: "draft",
      tasks: [
        { id: "T-001", title: "One" },
        { id: "T-001", title: "Two" },
      ],
      createdAt: "now",
      updatedAt: "now",
    }),
    /Duplicate/,
  );

  assert.throws(
    () => validateExecutionPlan({
      version: 1,
      planVersion: 1,
      status: "bad" as never,
      tasks: [],
      createdAt: "now",
      updatedAt: "now",
    }),
    /Invalid execution plan status/,
  );
});

test("applyExecutionPlanTasks creates missing tasks and preserves existing tasks", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    state.tasks = [{ id: "T-001", title: "Existing", status: "ready", updatedAt: state.createdAt }];
    const result = await applyExecutionPlanTasks(dir, state, {
      version: 1,
      planVersion: 1,
      status: "active",
      tasks: [
        { id: "T-001", title: "Existing changed" },
        { id: "T-002", title: "New task", prdRefs: ["REQ-001"], allowedPathPrefixes: ["src"], dependsOn: ["T-001"] },
      ],
      createdAt: state.createdAt,
      updatedAt: state.createdAt,
    });

    assert.deepEqual(result.existingTaskIds, ["T-001"]);
    assert.deepEqual(result.createdTaskIds, ["T-002"]);
    assert.equal(result.state.tasks.find((task) => task.id === "T-001")?.title, "Existing");
    const created = result.state.tasks.find((task) => task.id === "T-002");
    assert.equal(created?.status, "pending");
    assert.deepEqual(created?.prdRefs, ["REQ-001"]);
    assert.deepEqual(created?.allowedPathPrefixes, ["src"]);
    assert.deepEqual(created?.dependsOn, ["T-001"]);
  });
});

test("summarizeExecutionPlan reports task and requirement coverage", () => {
  const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
  state.tasks = [
    { id: "T-001", status: "validated", prdRefs: ["REQ-001"], updatedAt: state.createdAt },
    { id: "T-003", status: "ready", updatedAt: state.createdAt },
  ];
  const summary = summarizeExecutionPlan(
    {
      version: 1,
      planVersion: 2,
      status: "active",
      tasks: [
        { id: "T-001", title: "One", prdRefs: ["REQ-001"] },
        { id: "T-002", title: "Two", prdRefs: ["REQ-002"] },
        { id: "T-003", title: "Three" },
      ],
      createdAt: state.createdAt,
      updatedAt: state.createdAt,
    },
    { version: 1, requirements: [
      { id: "REQ-001", statement: "One", createdAt: state.createdAt, updatedAt: state.createdAt },
      { id: "REQ-002", statement: "Two", createdAt: state.createdAt, updatedAt: state.createdAt },
      { id: "REQ-003", statement: "Three", createdAt: state.createdAt, updatedAt: state.createdAt },
    ] },
    state,
  );

  assert.equal(summary.plannedTaskCount, 3);
  assert.equal(summary.createdTaskCount, 2);
  assert.deepEqual(summary.missingTaskIds, ["T-002"]);
  assert.equal(summary.validatedPlannedTaskCount, 1);
  assert.deepEqual(summary.linkedRequirementIds, ["REQ-001", "REQ-002"]);
  assert.deepEqual(summary.unlinkedRequirementIds, ["REQ-003"]);
  assert.deepEqual(summary.planUnlinkedTaskIds, ["T-003"]);
  assert.match(formatExecutionPlanSummary(summary), /missing=1/);
});

test("createExecutionPlanSnapshot writes incrementing version files", async () => {
  await withTempDir(async (dir) => {
    const plan = await saveExecutionPlan(dir, {
      version: 1,
      planVersion: 1,
      status: "active",
      tasks: [{ id: "T-001", title: "Do work" }],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    assert.equal(await createExecutionPlanSnapshot(dir, { plan }), ".scaler/plans/versions/PLAN-v001.json");
    assert.equal(await createExecutionPlanSnapshot(dir, { plan }), ".scaler/plans/versions/PLAN-v002.json");
  });
});

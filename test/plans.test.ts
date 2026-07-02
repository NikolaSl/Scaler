import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  createExecutionPlanSnapshot,
  loadExecutionPlan,
  saveExecutionPlan,
  validateExecutionPlan,
} from "../src/plans.js";

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

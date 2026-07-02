import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadReplanRequests } from "../src/plans.js";
import { createDefaultState } from "../src/state.js";
import { addTask } from "../src/supervisor.js";
import { applyValidationReport } from "../src/validation.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-validation-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function stateWithTask(status: "running" | "validating" | "debugging") {
  return addTask(createDefaultState(), { id: "T-001", status });
}

test("passed validation moves validating task to validated", async () => {
  await withTempDir(async (dir) => {
    const result = await applyValidationReport(dir, stateWithTask("validating"), {
      taskId: "T-001",
      status: "passed",
      summary: "tests passed",
    });

    assert.equal(result.accepted, true);
    assert.equal(result.state.tasks[0]?.status, "validated");
    assert.deepEqual(result.state.validatedTaskIds, ["T-001"]);
  });
});

test("passed validation moves debugging task to validated", async () => {
  await withTempDir(async (dir) => {
    const result = await applyValidationReport(dir, stateWithTask("debugging"), {
      taskId: "T-001",
      status: "passed",
      summary: "debug fix passed",
    });

    assert.equal(result.accepted, true);
    assert.equal(result.state.tasks[0]?.status, "validated");
  });
});

test("failed validation moves validating task to debugging", async () => {
  await withTempDir(async (dir) => {
    const result = await applyValidationReport(dir, stateWithTask("validating"), {
      taskId: "T-001",
      status: "failed",
      summary: "unit test failed",
    });

    assert.equal(result.accepted, true);
    assert.equal(result.state.tasks[0]?.status, "debugging");
  });
});

test("blocked validation moves running task to blocked", async () => {
  await withTempDir(async (dir) => {
    const result = await applyValidationReport(dir, stateWithTask("running"), {
      taskId: "T-001",
      status: "blocked",
      summary: "needs permission",
    });

    assert.equal(result.accepted, true);
    assert.equal(result.state.tasks[0]?.status, "blocked");
  });
});

test("blocked validation creates a replan request and enters replanning when stage allows", async () => {
  await withTempDir(async (dir) => {
    const state = stateWithTask("validating");
    state.stage = "execution";
    state.tasks[0] = { ...state.tasks[0]!, prdRefs: ["REQ-001"] };
    const result = await applyValidationReport(dir, state, {
      taskId: "T-001",
      status: "blocked",
      summary: "validation environment unavailable",
      details: { evidenceRefs: ["run-1"] },
    });

    const requests = await loadReplanRequests(dir);
    assert.equal(result.accepted, true);
    assert.equal(result.state.stage, "replanning");
    assert.equal(result.state.tasks[0]?.status, "blocked");
    assert.equal(requests[0]?.trigger, "validation_blocked");
    assert.deepEqual(requests[0]?.evidenceRefs, ["run-1"]);
    assert.deepEqual(requests[0]?.requirementRefs, ["REQ-001"]);
  });
});

test("blocked validation moves validating task to blocked", async () => {
  await withTempDir(async (dir) => {
    const result = await applyValidationReport(dir, stateWithTask("validating"), {
      taskId: "T-001",
      status: "blocked",
      summary: "validation environment unavailable",
    });

    assert.equal(result.accepted, true);
    assert.equal(result.state.tasks[0]?.status, "blocked");
  });
});

test("invalid validation status is rejected without changing state", async () => {
  await withTempDir(async (dir) => {
    const state = stateWithTask("validating");
    const result = await applyValidationReport(dir, state, {
      taskId: "T-001",
      status: "unknown",
      summary: "bad",
    });

    assert.equal(result.accepted, false);
    assert.equal(result.state, state);
  });
});

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readLogEvents } from "../src/logging.js";
import { ingestReport, validateReportInput } from "../src/reports.js";
import { createDefaultState, loadState } from "../src/state.js";
import { addTask } from "../src/supervisor.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-report-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("ingestReport applies valid stage transition and persists state", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState();
    const result = await ingestReport(dir, state, {
      reportType: "prd",
      summary: "start PRD",
      stageTransition: "prd",
    });

    const persisted = await loadState(dir);
    const events = await readLogEvents(dir);

    assert.equal(result.accepted, true);
    assert.equal(persisted.stage, "prd");
    assert.equal(events.length, 1);
    assert.match(events[0]?.summary ?? "", /Report ingested/);
  });
});

test("ingestReport records rejected invalid stage transition", async () => {
  await withTempDir(async (dir) => {
    const state = { ...createDefaultState(), stage: "planning" as const };
    const result = await ingestReport(dir, state, {
      reportType: "knowledge",
      summary: "go backwards",
      stageTransition: "knowledge",
    });

    assert.equal(result.accepted, false);
    assert.equal(result.state.stage, "planning");
    assert.equal(result.state.rejectedTransitions.length, 1);
  });
});

test("ingestReport applies task transition", async () => {
  await withTempDir(async (dir) => {
    const state = addTask(createDefaultState(), { id: "T-001", status: "pending" });
    const result = await ingestReport(dir, state, {
      reportType: "task",
      summary: "task ready",
      taskId: "T-001",
      taskTransition: "ready",
    });

    assert.equal(result.accepted, true);
    assert.equal(result.state.tasks[0]?.status, "ready");
  });
});

test("validateReportInput rejects invalid transition values", () => {
  assert.equal(
    validateReportInput({ reportType: "task", summary: "bad", taskTransition: "done" }),
    "Invalid task transition target: done.",
  );
  assert.equal(
    validateReportInput({ reportType: "stage", summary: "bad", stageTransition: "review" }),
    "Invalid stage transition target: review.",
  );
});

test("ingestReport rejects task transition without task id without mutating state", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState();
    const result = await ingestReport(dir, state, {
      reportType: "task",
      summary: "missing task",
      taskTransition: "ready",
    });

    assert.equal(result.accepted, false);
    assert.equal(result.state, state);
    assert.equal(result.rejectionReason, "Task transition report did not include taskId.");
  });
});

test("ingestReport rejects invalid stage value without saving corrupted state", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState();
    const result = await ingestReport(dir, state, {
      reportType: "stage",
      summary: "bad stage",
      stageTransition: "review",
    });
    const events = await readLogEvents(dir);

    assert.equal(result.accepted, false);
    assert.equal(result.state.stage, "idle");
    assert.equal(events.length, 1);
    assert.match(events[0]?.summary ?? "", /Report rejected/);
  });
});

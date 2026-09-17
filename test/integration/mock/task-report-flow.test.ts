/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadTaskAgentRunRecords, loadValidationHandoffs, runConductorStep } from "../../../src/conductor.js";
import { readLogEvents } from "../../../src/logging.js";
import { createDefaultState, loadState } from "../../../src/state.js";
import type { TaskAgentRequest, TaskAgentRunResult } from "../../../src/subagents.js";
import { loadTaskAgentReports } from "../../../src/task-reports.js";
import { saveValidationManifest } from "../../../src/validation.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-task-report-integration-test-"));
  try {
    for (const taskId of ["T-REPORT", "T-MISSING"]) {
      await saveValidationManifest(dir, {
        taskId, outputPaths: [], acceptanceCriteria: ["The report is handed to validation."],
        commands: [], createdAt: "", updatedAt: "",
      });
    }
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function stateWithReadyTask() {
  const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
  state.stage = "execution";
  state.tasks = [{
    id: "T-REPORT", status: "ready", title: "Report task", allowedPathPrefixes: ["src"],
    definitionOfDone: ["The report is handed to validation."], updatedAt: state.createdAt,
  }];
  return state;
}

async function completedRun(request: TaskAgentRequest): Promise<TaskAgentRunResult> {
  return {
    taskId: request.taskId,
    exitCode: 0,
    stdoutEvents: [{
      type: "scaler_task_report",
      taskId: request.taskId,
      ...request.attempt,
      status: "completed",
      summary: "Task report complete.",
      changedFiles: ["src/app.ts"],
      memoryRefs: [],
      validations: [{ command: "npm test", status: "passed", summary: "passed" }],
      validationRefs: [],
      evidenceRefs: ["validation:npm-test"],
      blockers: [],
      missingData: [],
      recommendedNextAction: "validate",
    }],
    stderr: "",
    timedOut: false,
    aborted: false,
  };
}

test("mock integration: task-agent report is required before validation handoff", async () => {
  await withTempDir(async (dir) => {
    const accepted = await runConductorStep(dir, stateWithReadyTask(), { execute: true }, completedRun);
    assert.equal(accepted.accepted, true);
    assert.equal((await loadState(dir)).tasks[0]?.status, "validating");
    assert.equal((await loadValidationHandoffs(dir))[0]?.status, "validation_required");
    assert.equal((await loadTaskAgentRunRecords(dir))[0]?.reportStatus, "accepted");
    assert.equal((await loadTaskAgentReports(dir))[0]?.status, "completed");

    const missingState = await loadState(dir);
    missingState.currentTaskId = null;
    missingState.tasks = [{ ...stateWithReadyTask().tasks[0]!, id: "T-MISSING" }];
    const missing = await runConductorStep(dir, missingState, { execute: true }, async (request) => ({
      taskId: request.taskId,
      exitCode: 0,
      stdoutEvents: [{ type: "unparsed", text: "done" }],
      stderr: "",
      timedOut: false,
      aborted: false,
    }));

    assert.equal(missing.validationHandoff?.status, "task_agent_report_missing");
    assert.equal((await loadState(dir)).tasks[0]?.status, "blocked");
    assert.equal((await loadTaskAgentRunRecords(dir))[0]?.reportStatus, "missing");

    const events = await readLogEvents(dir);
    assert.ok(events.some((event) => event.eventType === "agent" && event.summary.startsWith("Task-agent report ingested")));
    assert.ok(events.some((event) => event.eventType === "agent" && event.summary.startsWith("Task-agent report missing")));
  });
});

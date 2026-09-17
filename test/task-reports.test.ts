/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createDefaultState } from "../src/state.js";
import { fingerprintJson } from "../src/fingerprints.js";
import { formatTaskAgentReportList, ingestTaskAgentReportFromRun, loadTaskAgentReports, recordTaskAgentReport } from "../src/task-reports.js";
import type { TaskAttemptBinding } from "../src/task-attempts.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-task-reports-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function bindingFor(runId: string): TaskAttemptBinding {
  return {
    runId, attemptId: "current-attempt",
    taskFingerprint: fingerprintJson({ task: 1 }),
    inputFingerprint: fingerprintJson({ input: 1 }),
    routeFingerprint: fingerprintJson({ route: 1 }),
    validationPolicyFingerprint: fingerprintJson({ policy: 1 }),
  };
}

test("report ingestion refuses an omitted binding even for a runtime JavaScript caller", async () => {
  await withTempDir(async (dir) => {
    const result = await ingestTaskAgentReportFromRun(dir, createDefaultState(), "T-1", {
      taskId: "T-1", exitCode: 0,
      stdoutEvents: [{ type: "scaler_task_report", taskId: "T-1", status: "completed", summary: "unbound" }],
      stderr: "", timedOut: false, aborted: false,
    }, undefined as unknown as TaskAttemptBinding);
    assert.equal(result.accepted, false);
    assert.deepEqual(await loadTaskAgentReports(dir), []);
  });
});

test("recordTaskAgentReport persists normalized report records", async () => {
  await withTempDir(async (dir) => {
    const report = await recordTaskAgentReport(dir, {
      taskId: "T-001",
      status: "completed",
      summary: "Done.",
      changedFiles: ["src/app.ts"],
      validations: [{ command: "npm test", status: "passed", summary: "passed" }],
    }, new Date("2026-01-01T00:00:00.000Z"));

    assert.equal(report.id, "T-001-report-1767225600000");
    assert.equal(report.status, "completed");
    assert.equal((await loadTaskAgentReports(dir))[0]?.id, report.id);
    assert.match(formatTaskAgentReportList([report]), /T-001: completed/);
  });
});

test("ingestTaskAgentReportFromRun accepts exact assistant JSON payloads", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    const payload = JSON.stringify({
      type: "scaler_task_report",
      ...bindingFor(state.runId),
      taskId: "T-JSON",
      status: "completed",
      summary: "JSON report accepted.",
      changedFiles: [],
      memoryRefs: [],
      validations: [],
      validationRefs: [],
      evidenceRefs: [],
      blockers: [],
      missingData: [],
    });

    const result = await ingestTaskAgentReportFromRun(dir, state, "T-JSON", {
      taskId: "T-JSON",
      exitCode: 0,
      stdoutEvents: [{ type: "message_end", message: { role: "assistant", content: payload } }],
      stderr: "",
      timedOut: false,
      aborted: false,
    }, bindingFor(state.runId), new Date("2026-01-01T00:00:01.000Z"));

    assert.equal(result.accepted, true);
    assert.equal(result.report?.runId, state.runId);
    assert.equal((await loadTaskAgentReports(dir))[0]?.summary, "JSON report accepted.");
  });
});

test("ingestTaskAgentReportFromRun reports missing and invalid payloads", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    const missing = await ingestTaskAgentReportFromRun(dir, state, "T-MISS", {
      taskId: "T-MISS",
      exitCode: 0,
      stdoutEvents: [{ type: "unparsed", text: "done" }],
      stderr: "",
      timedOut: false,
      aborted: false,
    }, bindingFor(state.runId));
    assert.equal(missing.status, "missing");
    assert.match(missing.diagnostics.join(" "), /Missing required scaler_task_report/);

    const invalid = await ingestTaskAgentReportFromRun(dir, state, "T-MISS", {
      taskId: "T-MISS",
      exitCode: 0,
      stdoutEvents: [{ type: "scaler_task_report", taskId: "OTHER", status: "completed", summary: "wrong" }],
      stderr: "",
      timedOut: false,
      aborted: false,
    }, bindingFor(state.runId));
    assert.equal(invalid.status, "invalid");
    assert.match(invalid.diagnostics.join(" "), /does not match expected task/);
  });
});

test("ingestTaskAgentReportFromRun requires the exact admitted attempt binding", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    const binding: TaskAttemptBinding = {
      runId: state.runId,
      attemptId: "attempt-current",
      taskFingerprint: fingerprintJson({ task: 1 }),
      inputFingerprint: fingerprintJson({ input: 1 }),
      routeFingerprint: fingerprintJson({ route: 1 }),
      validationPolicyFingerprint: fingerprintJson({ policy: 1 }),
    };
    const result = await ingestTaskAgentReportFromRun(dir, state, "T-BOUND", {
      taskId: "T-BOUND",
      exitCode: 0,
      stdoutEvents: [{
        type: "scaler_task_report",
        taskId: "T-BOUND",
        ...binding,
        attemptId: "attempt-stale",
        status: "completed",
        summary: "Stale report.",
      }],
      stderr: "",
      timedOut: false,
      aborted: false,
    }, binding);

    assert.equal(result.status, "invalid");
    assert.match(result.diagnostics.join(" "), /attempt-stale.*attempt-current/);
    assert.deepEqual(await loadTaskAgentReports(dir), []);
  });
});

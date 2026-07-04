import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createDefaultState } from "../src/state.js";
import { formatTaskAgentReportList, ingestTaskAgentReportFromRun, loadTaskAgentReports, recordTaskAgentReport } from "../src/task-reports.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-task-reports-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

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
    }, "run-1", new Date("2026-01-01T00:00:01.000Z"));

    assert.equal(result.accepted, true);
    assert.equal(result.report?.runId, "run-1");
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
    });
    assert.equal(missing.status, "missing");
    assert.match(missing.diagnostics.join(" "), /Missing required scaler_task_report/);

    const invalid = await ingestTaskAgentReportFromRun(dir, state, "T-MISS", {
      taskId: "T-MISS",
      exitCode: 0,
      stdoutEvents: [{ type: "scaler_task_report", taskId: "OTHER", status: "completed", summary: "wrong" }],
      stderr: "",
      timedOut: false,
      aborted: false,
    });
    assert.equal(invalid.status, "invalid");
    assert.match(invalid.diagnostics.join(" "), /does not match expected task/);
  });
});

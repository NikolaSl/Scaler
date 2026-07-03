import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { appendLogEvent, createLogEvent, logAgentPromptAudit, logCommandAudit, logGitCommitAudit, logStateEvent, logStructuredReportAudit, logValidationSummaryAudit, readLogEvents, writeAuditDetail } from "../src/logging.js";
import { getEventLogPath, getLogDetailsDir } from "../src/paths.js";
import { createDefaultState } from "../src/state.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-log-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("createLogEvent fills state-derived fields", () => {
  const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
  state.stage = "planning";

  const event = createLogEvent(
    state,
    { eventType: "system", summary: "created event" },
    new Date("2026-01-01T00:00:01.000Z"),
  );

  assert.equal(event.timestamp, "2026-01-01T00:00:01.000Z");
  assert.equal(event.runId, state.runId);
  assert.equal(event.stage, "planning");
  assert.equal(event.summary, "created event");
});

test("appendLogEvent writes JSONL event", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState();
    const event = createLogEvent(state, { eventType: "system", summary: "hello" });

    await appendLogEvent(dir, event);
    const raw = await readFile(getEventLogPath(dir), "utf8");

    assert.equal(raw.trim().split("\n").length, 1);
    assert.equal(JSON.parse(raw).summary, "hello");
  });
});

test("readLogEvents returns appended events", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState();
    await appendLogEvent(dir, createLogEvent(state, { eventType: "system", summary: "one" }));
    await appendLogEvent(dir, createLogEvent(state, { eventType: "state", summary: "two" }));

    const events = await readLogEvents(dir);

    assert.equal(events.length, 2);
    assert.deepEqual(events.map((event) => event.summary), ["one", "two"]);
  });
});

test("readLogEvents returns empty array when log is missing", async () => {
  await withTempDir(async (dir) => {
    assert.deepEqual(await readLogEvents(dir), []);
  });
});

test("writeAuditDetail persists payload under log details", async () => {
  await withTempDir(async (dir) => {
    const path = await writeAuditDetail(dir, "agent prompt/test", { prompt: "hello" }, new Date("2026-01-01T00:00:00.000Z"));
    const raw = await readFile(path, "utf8");
    const detail = JSON.parse(raw) as { category: string; payload: { prompt: string } };

    assert.equal(path.startsWith(getLogDetailsDir(dir)), true);
    assert.equal(detail.category, "agent prompt/test");
    assert.equal(detail.payload.prompt, "hello");
  });
});

test("audit helpers append events with detail refs", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));

    await logCommandAudit(dir, state, { command: "scaler-status", phase: "start", args: "" }, new Date("2026-01-01T00:00:01.000Z"));
    await logAgentPromptAudit(dir, state, { agentType: "task", agentId: "T-001", prompt: "Do work", taskId: "T-001" }, new Date("2026-01-01T00:00:02.000Z"));
    await logStructuredReportAudit(dir, state, { reportType: "scaler_report", summary: "done", report: { ok: true }, accepted: true }, new Date("2026-01-01T00:00:03.000Z"));
    await logValidationSummaryAudit(dir, state, { taskId: "T-001", runId: "run-1", status: "passed", commandCount: 2 }, new Date("2026-01-01T00:00:04.000Z"));
    await logGitCommitAudit(dir, state, { taskId: "T-001", accepted: true, message: "Committed T-001: abc123", commitHash: "abc123" }, new Date("2026-01-01T00:00:05.000Z"));

    const events = await readLogEvents(dir);
    assert.deepEqual(events.map((event) => event.eventType), ["command", "agent", "report", "validation", "git"]);
    assert.equal(events.every((event) => Boolean(event.detailsPath)), true);
    assert.deepEqual(events[4]?.outputRefs, ["abc123"]);
  });
});

test("logStateEvent appends state event and returns it", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState();
    const event = await logStateEvent(dir, state, "status requested", { command: "scaler-status" });
    const events = await readLogEvents(dir);

    assert.equal(event.eventType, "state");
    assert.equal(events[0]?.details && (events[0].details as { command: string }).command, "scaler-status");
  });
});

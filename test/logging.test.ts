import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { appendLogEvent, createLogEvent, logStateEvent, readLogEvents } from "../src/logging.js";
import { getEventLogPath } from "../src/paths.js";
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

test("logStateEvent appends state event and returns it", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState();
    const event = await logStateEvent(dir, state, "status requested", { command: "scaler-status" });
    const events = await readLogEvents(dir);

    assert.equal(event.eventType, "state");
    assert.equal(events[0]?.details && (events[0].details as { command: string }).command, "scaler-status");
  });
});

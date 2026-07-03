import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import scalerExtension from "../src/index.js";
import { readLogEvents } from "../src/logging.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-extension-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("extension factory exports a function", () => {
  assert.equal(typeof scalerExtension, "function");
});

test("extension registers scaler commands", () => {
  const commands: string[] = [];
  const fakePi = {
    on() {},
    registerTool() {},
    registerCommand(name: string) {
      commands.push(name);
    },
  };

  scalerExtension(fakePi as never);

  assert.deepEqual(commands, [
    "scaler",
    "scaler-lock",
    "scaler-lock-clear",
    "scaler-runs",
    "scaler-tasks",
    "scaler-context-init",
    "scaler-context-status",
    "scaler-stage-status",
    "scaler-stage-validate",
    "scaler-stage-advance",
    "scaler-stage-step",
    "scaler-stage-loop",
    "scaler-stage-run",
    "scaler-stage-runs",
    "scaler-stage-record",
    "scaler-task-create",
    "scaler-task-update",
    "scaler-prd-status",
    "scaler-plan-status",
    "scaler-plan-apply",
    "scaler-replans",
    "scaler-replan-run",
    "scaler-replan-runs",
    "scaler-research-run",
    "scaler-research-runs",
    "scaler-research-status",
    "scaler-research-request",
    "scaler-research-report",
    "scaler-replan-proposal-status",
    "scaler-replan-accept",
    "scaler-replan-request",
    "scaler-prd-link",
    "scaler-task-retry",
    "scaler-step",
    "scaler-validation-add",
    "scaler-commit",
    "scaler-validate",
    "scaler-pause",
    "scaler-resume",
    "scaler-status",
  ]);
});

test("extension command handlers write command audit events", async () => {
  await withTempDir(async (dir) => {
    const commands = new Map<string, { handler: (args: string | undefined, ctx: { cwd: string; hasUI: boolean }) => Promise<void> }>();
    const fakePi = {
      on() {},
      registerTool() {},
      registerCommand(name: string, command: { handler: (args: string | undefined, ctx: { cwd: string; hasUI: boolean }) => Promise<void> }) {
        commands.set(name, command);
      },
    };

    scalerExtension(fakePi as never);
    await commands.get("scaler-lock")?.handler(undefined, { cwd: dir, hasUI: false });
    const events = await readLogEvents(dir);

    assert.deepEqual(events.filter((event) => event.eventType === "command").map((event) => (event.details as { phase: string }).phase), ["start", "end"]);
    assert.equal(events.filter((event) => event.eventType === "command").every((event) => Boolean(event.detailsPath)), true);
  });
});

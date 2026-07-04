import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import scalerExtension from "../../../src/index.js";
import { readLogEvents } from "../../../src/logging.js";
import { createDefaultState, loadState, saveState } from "../../../src/state.js";
import { addTask } from "../../../src/supervisor.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-adaptive-integration-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("mock integration: scaler-adapt applies validation-failure escalation", async () => {
  await withTempDir(async (dir) => {
    const commands = new Map<string, { handler: (args: string | undefined, ctx: { cwd: string; hasUI: boolean }) => Promise<void> }>();
    scalerExtension({
      on() {},
      registerTool() {},
      registerCommand(name: string, command: { handler: (args: string | undefined, ctx: { cwd: string; hasUI: boolean }) => Promise<void> }) {
        commands.set(name, command);
      },
    } as never);

    const base = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    const execution = { ...base, stage: "execution" as const, complexityLevel: 2 };
    const state = addTask(execution, { id: "T-ADAPT", status: "debugging", title: "Needs debug" }, new Date("2026-01-01T00:00:01.000Z"));
    await saveState(dir, state);

    await commands.get("scaler-adapt")?.handler("apply", { cwd: dir, hasUI: false });

    const next = await loadState(dir);
    assert.equal(next.stage, "debugging");
    assert.equal(next.complexityLevel, 3);
    assert.match(next.orchestrationReason ?? "", /Validation\/debug failure threshold reached/);

    const events = await readLogEvents(dir);
    assert.ok(events.some((event) => event.eventType === "state" && event.summary === "Scaler adaptive orchestration applied"));
    assert.deepEqual(
      events
        .filter((event) => event.eventType === "command" && event.details && (event.details as { command?: string }).command === "scaler-adapt")
        .map((event) => (event.details as { phase: string }).phase),
      ["start", "end"],
    );
  });
});

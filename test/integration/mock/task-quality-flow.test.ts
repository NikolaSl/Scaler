import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import scalerExtension from "../../../src/index.js";
import { readLogEvents } from "../../../src/logging.js";
import { createDefaultState } from "../../../src/state.js";
import { createTask } from "../../../src/tasks.js";
import { loadTaskDefinitionReviews } from "../../../src/task-quality.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-task-quality-integration-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("mock integration: task-quality command records atomic task warnings", async () => {
  await withTempDir(async (dir) => {
    const commands = new Map<string, { handler: (args: string | undefined, ctx: { cwd: string; hasUI: boolean }) => Promise<void> }>();
    scalerExtension({
      on() {},
      registerTool() {},
      registerCommand(name: string, command: { handler: (args: string | undefined, ctx: { cwd: string; hasUI: boolean }) => Promise<void> }) {
        commands.set(name, command);
      },
    } as never);

    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    await createTask(dir, state, { id: "T-QUALITY", title: "Unscoped task" });

    await commands.get("scaler-task-quality")?.handler("T-QUALITY", { cwd: dir, hasUI: false });

    const reviews = await loadTaskDefinitionReviews(dir);
    assert.equal(reviews[0]?.taskId, "T-QUALITY");
    assert.equal(reviews[0]?.status, "warnings");
    assert.ok(reviews[0]?.warnings.some((warning) => warning.code === "missing_dod"));
    assert.ok(reviews[0]?.warnings.some((warning) => warning.code === "missing_validation"));
    assert.ok(reviews[0]?.warnings.some((warning) => warning.code === "missing_allowed_paths"));

    const events = await readLogEvents(dir);
    assert.ok(events.some((event) => event.eventType === "state" && event.summary === "Task definition review warnings: T-QUALITY"));
    assert.deepEqual(
      events
        .filter((event) => event.eventType === "command" && event.details && (event.details as { command?: string }).command === "scaler-task-quality")
        .map((event) => (event.details as { phase: string }).phase),
      ["start", "end"],
    );
  });
});

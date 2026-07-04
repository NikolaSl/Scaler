import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import scalerExtension from "../../../src/index.js";
import { readLogEvents } from "../../../src/logging.js";
import { createDefaultState, saveState } from "../../../src/state.js";

const execFileAsync = promisify(execFile);

type ToolCallHandler = (event: { toolName: string; input: Record<string, unknown> }, ctx: { cwd: string; hasUI: boolean }) => Promise<unknown>;
type CommandHandler = (args: string | undefined, ctx: { cwd: string; hasUI: boolean }) => Promise<void>;

async function withTempRepo<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-safety-hook-integration-test-"));
  try {
    await execFileAsync("git", ["init"], { cwd: dir });
    await execFileAsync("git", ["config", "user.email", "scaler-test@example.invalid"], { cwd: dir });
    await execFileAsync("git", ["config", "user.name", "Scaler Test"], { cwd: dir });
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "package.json"), JSON.stringify({ type: "module" }, null, 2));
    await writeFile(join(dir, "src/app.js"), "export const value = 1;\n");
    await execFileAsync("git", ["add", "package.json", "src/app.js"], { cwd: dir });
    await execFileAsync("git", ["commit", "-m", "initial fixture"], { cwd: dir });
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function registeredToolCallHook(): ToolCallHandler {
  return registeredSafetyHarness().hook;
}

function registeredSafetyHarness(): { hook: ToolCallHandler; commands: Map<string, { handler: CommandHandler }> } {
  let handler: ToolCallHandler | undefined;
  const commands = new Map<string, { handler: CommandHandler }>();
  const fakePi = {
    on(name: string, candidate: ToolCallHandler) {
      if (name === "tool_call") handler = candidate;
    },
    registerTool() {},
    registerCommand(name: string, command: { handler: CommandHandler }) {
      commands.set(name, command);
    },
  };
  scalerExtension(fakePi as never);
  assert.ok(handler, "expected tool_call hook registration");
  return { hook: handler, commands };
}

test("mock integration: persisted safety policy allows configured external and internet commands", async () => {
  await withTempRepo(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    state.stage = "execution";
    await saveState(dir, state);
    const { hook, commands } = registeredSafetyHarness();

    await commands.get("scaler-safety-policy")?.handler("allow-external=on allow-internet=on", { cwd: dir, hasUI: false });

    const publish = await hook({ toolName: "bash", input: { command: "npm publish --dry-run" } }, { cwd: dir, hasUI: false });
    const curl = await hook({ toolName: "bash", input: { command: "curl https://example.invalid/docs" } }, { cwd: dir, hasUI: false });
    const secret = await hook({ toolName: "bash", input: { command: "echo $OPENAI_API_KEY" } }, { cwd: dir, hasUI: false });

    assert.equal(publish, undefined);
    assert.equal(curl, undefined);
    assert.deepEqual(secret, { block: true, reason: "Bash command may expose secret environment variables." });

    const events = await readLogEvents(dir);
    assert.ok(events.some((event) => event.eventType === "state" && event.summary === "Scaler safety policy requested"));
    const safetyEvents = events.filter((event) => event.eventType === "safety");
    assert.deepEqual(safetyEvents.map((event) => (event.details as { risk: string }).risk), ["secret"]);
  });
});

test("mock integration: extension hook blocks external mutation and secret environment commands", async () => {
  await withTempRepo(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    state.stage = "execution";
    await saveState(dir, state);
    const hook = registeredToolCallHook();

    const publish = await hook({ toolName: "bash", input: { command: "npm publish --dry-run" } }, { cwd: dir, hasUI: false });
    const secret = await hook({ toolName: "bash", input: { command: "echo $OPENAI_API_KEY" } }, { cwd: dir, hasUI: false });

    assert.deepEqual(publish, { block: true, reason: "Bash command may mutate remote or published external systems." });
    assert.deepEqual(secret, { block: true, reason: "Bash command may expose secret environment variables." });

    const events = await readLogEvents(dir);
    assert.ok(events.some((event) => event.eventType === "tool" && event.summary === "Tool call observed: bash"));
    const safetyEvents = events.filter((event) => event.eventType === "safety");
    assert.deepEqual(safetyEvents.map((event) => (event.details as { risk: string }).risk), ["external", "secret"]);
    assert.ok(safetyEvents.every((event) => (event.details as { requiresApproval: boolean }).requiresApproval === true));
  });
});

import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildTaskAgentInvocation, runTaskAgent } from "../src/subagents.js";

async function withScript<T>(content: string, fn: (script: string, dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-subagent-test-"));
  const script = join(dir, "runner.sh");
  try {
    await writeFile(script, content, "utf8");
    await chmod(script, 0o755);
    return await fn(script, dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("buildTaskAgentInvocation creates minimal isolated pi invocation", () => {
  const invocation = buildTaskAgentInvocation({ taskId: "T-001", prompt: "Do task" });

  assert.equal(invocation.command, "pi");
  assert.deepEqual(invocation.args, ["--mode", "json", "-p", "--no-session", "Do task"]);
});

test("buildTaskAgentInvocation includes tools, model, cwd, prompt file, and extensions", () => {
  const invocation = buildTaskAgentInvocation(
    {
      taskId: "T-002",
      prompt: "Task prompt",
      cwd: "/tmp/project",
      tools: ["read", "bash"],
      model: "test-model",
      appendSystemPromptPath: "/tmp/prompt.md",
      extensionPaths: ["./src/index.ts"],
    },
    "custom-pi",
  );

  assert.equal(invocation.command, "custom-pi");
  assert.equal(invocation.cwd, "/tmp/project");
  assert.deepEqual(invocation.args, [
    "--mode",
    "json",
    "-p",
    "--no-session",
    "-e",
    "./src/index.ts",
    "--model",
    "test-model",
    "--tools",
    "read,bash",
    "--append-system-prompt",
    "/tmp/prompt.md",
    "Task prompt",
  ]);
});

test("buildTaskAgentInvocation omits empty optional arrays", () => {
  const invocation = buildTaskAgentInvocation({ taskId: "T-003", prompt: "Task", tools: [], extensionPaths: [] });

  assert.deepEqual(invocation.args, ["--mode", "json", "-p", "--no-session", "Task"]);
});

test("runTaskAgent reports default timeout and abort flags", async () => {
  await withScript('#!/bin/sh\necho "{\\\"type\\\":\\\"done\\\"}"\n', async (script, dir) => {
    const result = await runTaskAgent({ taskId: "T-004", prompt: "ignored", cwd: dir }, { command: script });

    assert.equal(result.exitCode, 0);
    assert.equal(result.timedOut, false);
    assert.equal(result.aborted, false);
    assert.deepEqual(result.stdoutEvents, [{ type: "done" }]);
  });
});

test("runTaskAgent reports timeout diagnostics", async () => {
  await withScript("#!/bin/sh\nsleep 0.2\n", async (script, dir) => {
    const result = await runTaskAgent({ taskId: "T-005", prompt: "ignored", cwd: dir }, { command: script, timeoutMs: 10 });

    assert.equal(result.timedOut, true);
    assert.equal(result.aborted, false);
    assert.match(result.stderr, /timed out/);
  });
});

test("runTaskAgent reports abort diagnostics", async () => {
  await withScript("#!/bin/sh\nsleep 0.2\n", async (script, dir) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10);
    const result = await runTaskAgent({ taskId: "T-006", prompt: "ignored", cwd: dir }, { command: script, signal: controller.signal });

    assert.equal(result.timedOut, false);
    assert.equal(result.aborted, true);
  });
});

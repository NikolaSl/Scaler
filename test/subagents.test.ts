import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTaskAgentInvocation } from "../src/subagents.js";

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

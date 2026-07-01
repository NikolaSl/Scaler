import assert from "node:assert/strict";
import { test } from "node:test";
import { prepareOrRunSpawnTask } from "../src/tools.js";
import type { TaskAgentRequest, RunTaskAgentOptions, TaskAgentRunResult } from "../src/subagents.js";

test("prepareOrRunSpawnTask prepares invocation when execute is false", async () => {
  let called = false;
  const result = await prepareOrRunSpawnTask(
    "/tmp/project",
    { taskId: "T-001", prompt: "Do it", tools: ["read"] },
    undefined,
    async () => {
      called = true;
      throw new Error("should not run");
    },
  );

  assert.equal(called, false);
  assert.match(result.text, /prepared/);
  assert.deepEqual((result.details as { status: string }).status, "prepared");
});

test("prepareOrRunSpawnTask executes runner when execute is true", async () => {
  let capturedRequest: TaskAgentRequest | undefined;
  let capturedOptions: RunTaskAgentOptions | undefined;
  const fakeRunner = async (request: TaskAgentRequest, options?: RunTaskAgentOptions): Promise<TaskAgentRunResult> => {
    capturedRequest = request;
    capturedOptions = options;
    return { taskId: request.taskId, exitCode: 0, stdoutEvents: [{ type: "message" }], stderr: "" };
  };

  const result = await prepareOrRunSpawnTask(
    "/tmp/project",
    { taskId: "T-002", prompt: "Run it", execute: true, timeoutMs: 1234 },
    undefined,
    fakeRunner,
  );

  assert.equal(capturedRequest?.taskId, "T-002");
  assert.equal(capturedRequest?.cwd, "/tmp/project");
  assert.equal(capturedOptions?.timeoutMs, 1234);
  assert.match(result.text, /executed/);
  assert.equal((result.details as { status: string }).status, "executed");
});

test("prepareOrRunSpawnTask reports failed execution status", async () => {
  const result = await prepareOrRunSpawnTask(
    "/tmp/project",
    { taskId: "T-003", prompt: "Run it", execute: true },
    undefined,
    async (request) => ({ taskId: request.taskId, exitCode: 2, stdoutEvents: [], stderr: "failed" }),
  );

  assert.equal((result.details as { status: string }).status, "failed");
});

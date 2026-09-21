/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { acquireExecutionLock, loadExecutionLock } from "../src/locks.js";
import { prepareOrRunSpawnTask as prepareOrRunSpawnTaskImpl } from "../src/tools.js";
import type { TaskAgentRequest, RunTaskAgentOptions, TaskAgentRunResult } from "../src/subagents.js";
import { testProviderAdmissionModel } from "./provider-model-fixture.js";

const prepareOrRunSpawnTask: typeof prepareOrRunSpawnTaskImpl = (cwd, params, signal, runner) =>
  prepareOrRunSpawnTaskImpl(cwd, { ...params, providerAdmissionModel: testProviderAdmissionModel }, signal, runner);

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-spawn-tool-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

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
  const details = result.details as { status: string; invocation: { args: string[] } };
  assert.equal(details.status, "prepared");
  assert.ok(details.invocation.args.includes("--no-extensions"));
  assert.ok(details.invocation.args.includes("--no-context-files"));
});

test("prepareOrRunSpawnTask refuses executed spawn when lock is held", async () => {
  await withTempDir(async (dir) => {
    await acquireExecutionLock(dir, { operation: "test", taskId: "T-LOCK" });
    const result = await prepareOrRunSpawnTask(
      dir,
      { taskId: "T-LOCKED", prompt: "Run it", execute: true },
      undefined,
      async () => {
        throw new Error("should not run");
      },
    );

    assert.equal((result.details as { status: string }).status, "locked");
    assert.equal((await loadExecutionLock(dir))?.taskId, "T-LOCK");
  });
});

test("prepareOrRunSpawnTask executes runner when execute is true", async () => {
  let capturedRequest: TaskAgentRequest | undefined;
  let capturedOptions: RunTaskAgentOptions | undefined;
  const fakeRunner = async (request: TaskAgentRequest, options?: RunTaskAgentOptions): Promise<TaskAgentRunResult> => {
    capturedRequest = request;
    capturedOptions = options;
    return { taskId: request.taskId, exitCode: 0, stdoutEvents: [{ type: "message" }], stderr: "", timedOut: false, aborted: false };
  };

  const result = await prepareOrRunSpawnTask(
    "/tmp/project",
    { taskId: "T-002", prompt: "Run it", execute: true, timeoutMs: 1234 },
    undefined,
    fakeRunner,
  );

  assert.equal(capturedRequest?.taskId, "T-002");
  assert.equal(capturedRequest?.cwd, "/tmp/project");
  assert.deepEqual(capturedRequest?.providerAdmission, {
    requestTokenAllowance: 8_000,
    outputReserveTokens: 1_024,
    safetyMarginTokens: 1_024,
  });
  assert.equal(capturedOptions?.timeoutMs, 1234);
  assert.match(result.text, /executed/);
  assert.equal((result.details as { status: string }).status, "executed");
});

test("prepareOrRunSpawnTask reports failed execution status", async () => {
  const result = await prepareOrRunSpawnTask(
    "/tmp/project",
    { taskId: "T-003", prompt: "Run it", execute: true },
    undefined,
    async (request) => ({ taskId: request.taskId, exitCode: 2, stdoutEvents: [], stderr: "failed", timedOut: false, aborted: false }),
  );

  assert.equal((result.details as { status: string }).status, "failed");
});

test("prepareOrRunSpawnTask treats a Pi JSON-mode provider abort as failed even with exit zero", async () => {
  const result = await prepareOrRunSpawnTask(
    "/tmp/project",
    { taskId: "T-ABORT", prompt: "Run it", execute: true },
    undefined,
    async (request) => ({
      taskId: request.taskId, exitCode: 0, stderr: "", timedOut: false, aborted: false,
      stdoutEvents: [{ type: "message_end", message: { role: "assistant", stopReason: "aborted" } }],
    }),
  );
  assert.equal((result.details as { status: string }).status, "failed");
});

test("prepareOrRunSpawnTask refuses external tools unavailable under strict isolated loading", async () => {
  const result = await prepareOrRunSpawnTask("/tmp/project", {
    taskId: "T-EXTERNAL", prompt: "Browse", tools: ["browser"], execute: true,
  }, undefined, async () => { throw new Error("must not run"); });
  assert.equal((result.details as { status: string }).status, "refused");
  assert.match(result.text, /cannot load granted tools: browser/);
});

test("prepareOrRunSpawnTask refuses an oversized prompt before runner and releases its lock", async () => {
  await withTempDir(async (dir) => {
    let runnerCalled = false;
    const result = await prepareOrRunSpawnTask(
      dir,
      {
        taskId: "T-LARGE",
        prompt: "EXACT-SOURCE\n".repeat(4_000),
        execute: true,
        tokenBudget: 1,
      } as never,
      undefined,
      async () => {
        runnerCalled = true;
        throw new Error("runner must not be called");
      },
    );

    assert.equal(runnerCalled, false);
    assert.match(result.text, /final SCALER prompt refused/i);
    assert.equal((result.details as { status: string }).status, "refused");
    assert.equal(await loadExecutionLock(dir), undefined);
  });
});

/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadDebugAttempts, loadDebugRetries, recordDebugReport } from "../src/debug.js";
import { approveDebugRetry, buildNextApproachContextItem, formatDebugRetryPolicy, loadDebugRetryApprovals, loadDebugRetryPolicy, runDebugNextApproachRetry, runDebugRetryPolicyWorkflow, saveDebugRetryPolicy, selectDebugRetryWork } from "../src/debug-retry.js";
import { createDefaultState, loadState, saveState } from "../src/state.js";
import type { TaskAgentRequest, TaskAgentRunResult, RunTaskAgentOptions } from "../src/subagents.js";
import type { ScalerState } from "../src/types.js";
import { getValidationManifestForTask, saveValidationManifest, runTaskValidation, upsertValidationManifestCommand } from "../src/validation.js";
import { getBudgetState, setBudgetLimits } from "../src/budgets.js";
import { loadTaskAttempts } from "../src/task-attempts.js";
import { loadTaskAgentReports } from "../src/task-reports.js";
import { loadExecutionLock } from "../src/locks.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-debug-retry-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function seedDebuggingTask(dir: string): Promise<ScalerState> {
  const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
  const updatedAt = new Date("2026-01-01T00:00:00.000Z").toISOString();
  state.stage = "execution";
  state.currentTaskId = "T-RETRY";
  state.tasks = [{ id: "T-RETRY", status: "validating", title: "Retry task", updatedAt }];
  await saveState(dir, state);
  await upsertValidationManifestCommand(dir, {
    taskId: "T-RETRY",
    id: "exact",
    command: "node -e \"process.exit(require('fs').existsSync('fixed.txt') ? 0 : 1)\"",
    description: "Exact failing validation",
    required: true,
    gate: "unit",
    expectedResult: "fixed.txt exists",
    evidenceRefs: ["validation:exact"],
  });
  await saveValidationManifest(dir, { ...await getValidationManifestForTask(dir, "T-RETRY"), outputPaths: ["fixed.txt"] });
  await runTaskValidation(dir, state, "T-RETRY");
  const debugging = await loadState(dir);
  await recordDebugReport(dir, debugging, {
    id: "RPT-RETRY",
    taskId: "T-RETRY",
    status: "next_approach",
    summary: "Create the missing marker file.",
    failureId: "F-RETRY",
    failureFingerprint: "missing fixed marker",
    rootCause: "The implementation did not write fixed.txt.",
    nextApproach: "Write fixed.txt and rerun the exact marker validation.",
    evidenceRefs: ["validation:exact"],
  });
  return await loadState(dir);
}

function taskReport(taskId: string): Record<string, unknown> {
  return { type: "scaler_task_report", taskId, status: "completed", summary: "Debug retry task completed.", changedFiles: ["fixed.txt"], memoryRefs: [], validations: [], validationRefs: [], evidenceRefs: ["validation:exact"], blockers: [], missingData: [], recommendedNextAction: "validate" };
}

function passingRun(request: TaskAgentRequest): TaskAgentRunResult {
  return { taskId: request.taskId, exitCode: 0, stdoutEvents: [{ ...taskReport(request.taskId), ...request.attempt }], stderr: "", timedOut: false, aborted: false };
}

test("debug retry refuses hard budget before running state or attempt admission", async () => {
  await withTempDir(async (dir) => {
    const state = setBudgetLimits(await seedDebuggingTask(dir), { spawnedAgents: { hard: 1 } });
    const result = await runDebugNextApproachRetry(dir, state, { execute: true }, async () => {
      throw new Error("must not dispatch");
    });
    assert.equal(result.status, "rejected");
    assert.equal(result.state.tasks[0]?.status, "debugging");
    assert.equal(getBudgetState(result.state).usage.spawnedAgents ?? 0, 0);
    assert.deepEqual(await loadTaskAttempts(dir), []);
  });
});

test("debug retry binds reports and rejects stale attempts before exact validation", async () => {
  await withTempDir(async (dir) => {
    const state = await seedDebuggingTask(dir);
    const result = await runDebugNextApproachRetry(dir, state, { execute: true }, async (request) => {
      assert.ok(request.attempt);
      assert.equal((await loadTaskAttempts(dir))[0]?.status, "dispatching");
      assert.equal((await loadState(dir)).tasks[0]?.attemptId, request.attempt.attemptId);
      return { ...passingRun(request), stdoutEvents: [{ ...taskReport(request.taskId), ...request.attempt, attemptId: "old-attempt" }] };
    });
    assert.equal(result.accepted, false);
    assert.equal(result.exactValidationRun, undefined);
    assert.equal((await loadState(dir)).tasks[0]?.status, "blocked");
    assert.deepEqual(await loadTaskAgentReports(dir), []);
  });
});

test("debug retry preserves child state and records unknown outcome after runner failure", async () => {
  await withTempDir(async (dir) => {
    const state = await seedDebuggingTask(dir);
    await assert.rejects(runDebugNextApproachRetry(dir, state, { execute: true }, async () => {
      const childState = await loadState(dir);
      childState.memoryRefs.push("child-evidence");
      await saveState(dir, childState);
      throw new Error("transport lost");
    }), /transport lost/);
    const durable = await loadState(dir);
    assert.deepEqual(durable.memoryRefs, ["child-evidence"]);
    assert.equal(durable.tasks[0]?.status, "blocked");
    assert.equal((await loadTaskAttempts(dir))[0]?.outcome, "unknown");
    assert.equal(await loadExecutionLock(dir), undefined);
  });
});

test("selectDebugRetryWork finds latest next approach and failed exact validation command", async () => {
  await withTempDir(async (dir) => {
    const state = await seedDebuggingTask(dir);
    const selection = await selectDebugRetryWork(dir, state, "T-RETRY");

    assert.ok(selection, "expected retry selection");
    assert.equal(selection.report.id, "RPT-RETRY");
    assert.equal(selection.failedValidationRun.status, "failed");
    assert.deepEqual(selection.exactCommands.map((command) => command.id), ["exact"]);
    assert.match(buildNextApproachContextItem(selection).content, /Write fixed\.txt/);
  });
});

test("runDebugNextApproachRetry prepare mode records prompt without changing debugging task", async () => {
  await withTempDir(async (dir) => {
    const state = await seedDebuggingTask(dir);
    const result = await runDebugNextApproachRetry(dir, state, { taskId: "T-RETRY" });

    assert.equal(result.accepted, true);
    assert.equal(result.status, "prepared");
    assert.match(result.prompt ?? "", /Debug next approach report: RPT-RETRY/);
    assert.equal((await loadState(dir)).tasks.find((task) => task.id === "T-RETRY")?.status, "debugging");
    const retries = await loadDebugRetries(dir);
    assert.equal(retries[0]?.status, "prepared");
    assert.equal(retries[0]?.debugReportId, "RPT-RETRY");
  });
});

test("debug retry policy persists automation controls", async () => {
  await withTempDir(async (dir) => {
    assert.equal((await loadDebugRetryPolicy(dir)).autoStart, false);
    const policy = await saveDebugRetryPolicy(dir, {
      autoStart: true,
      requireApproval: true,
      postExactPass: "validate",
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    assert.deepEqual(await loadDebugRetryPolicy(dir), policy);
    assert.match(formatDebugRetryPolicy(policy), /autoStart=true requireApproval=true postExactPass=full_validation/);
  });
});

test("debug retry policy workflow requires and consumes approval when configured", async () => {
  await withTempDir(async (dir) => {
    const state = await seedDebuggingTask(dir);
    await saveDebugRetryPolicy(dir, { requireApproval: true });

    const rejected = await runDebugRetryPolicyWorkflow(dir, state, { taskId: "T-RETRY", execute: true }, async (request) => passingRun(request));
    assert.equal(rejected.accepted, false);
    assert.match(rejected.message, /approval required/);

    await approveDebugRetry(dir, { debugReportId: "RPT-RETRY", taskId: "T-RETRY", reason: "Approve controlled retry." });
    const approved = await runDebugRetryPolicyWorkflow(dir, await loadState(dir), { taskId: "T-RETRY", execute: true }, async (request) => {
      await writeFile(join(request.cwd ?? dir, "fixed.txt"), "ok\n", "utf8");
      return passingRun(request);
    });

    assert.equal(approved.accepted, true);
    assert.equal(approved.status, "exact_validation_passed");
    assert.equal((await loadDebugRetryApprovals(dir))[0]?.status, "used");
    assert.equal((await loadDebugRetryApprovals(dir))[0]?.usedByRetryId, approved.retry?.id);
  });
});

test("debug retry policy workflow can run full validation after exact pass", async () => {
  await withTempDir(async (dir) => {
    const state = await seedDebuggingTask(dir);
    await saveDebugRetryPolicy(dir, { postExactPass: "validate" });

    const result = await runDebugRetryPolicyWorkflow(dir, state, { taskId: "T-RETRY", execute: true }, async (request) => {
      await writeFile(join(request.cwd ?? dir, "fixed.txt"), "ok\n", "utf8");
      return passingRun(request);
    });

    assert.equal(result.accepted, true);
    assert.equal(result.status, "exact_validation_passed");
    assert.equal(result.postValidation?.accepted, true);
    assert.equal(result.postValidation?.result?.status, "passed");
    assert.equal((await loadState(dir)).tasks.find((task) => task.id === "T-RETRY")?.status, "validated");
  });
});

test("runDebugNextApproachRetry executes next approach and leaves exact-pass task validating", async () => {
  await withTempDir(async (dir) => {
    const state = await seedDebuggingTask(dir);
    const runner = async (request: TaskAgentRequest, _options?: RunTaskAgentOptions): Promise<TaskAgentRunResult> => {
      await writeFile(join(request.cwd ?? dir, "fixed.txt"), "ok\n", "utf8");
      return passingRun(request);
    };

    const result = await runDebugNextApproachRetry(dir, state, { taskId: "T-RETRY", execute: true }, runner);

    assert.equal(result.accepted, true);
    assert.equal(result.status, "exact_validation_passed");
    assert.equal(result.exactValidationRun?.status, "passed");
    assert.equal((await loadState(dir)).tasks.find((task) => task.id === "T-RETRY")?.status, "validating");
    const retries = await loadDebugRetries(dir);
    assert.equal(retries[0]?.status, "exact_validation_passed");
    assert.equal(retries[0]?.validationRunId, result.exactValidationRun?.id);
    const attempts = await loadDebugAttempts(dir);
    assert.equal(attempts.at(-1)?.result, "fixed");
    assert.equal(attempts.at(-1)?.validationRun, result.exactValidationRun?.id);
  });
});

test("runDebugNextApproachRetry returns task to debugging when exact validation still fails", async () => {
  await withTempDir(async (dir) => {
    const state = await seedDebuggingTask(dir);
    const result = await runDebugNextApproachRetry(dir, state, { taskId: "T-RETRY", execute: true }, async (request) => passingRun(request));

    assert.equal(result.accepted, false);
    assert.equal(result.status, "exact_validation_failed");
    assert.equal(result.exactValidationRun?.status, "failed");
    assert.equal((await loadState(dir)).tasks.find((task) => task.id === "T-RETRY")?.status, "debugging");
    const retries = await loadDebugRetries(dir);
    assert.equal(retries[0]?.status, "exact_validation_failed");
    const attempts = await loadDebugAttempts(dir);
    assert.equal(attempts.at(-1)?.result, "same_failure");
    assert.equal(attempts.at(-1)?.validationRun, result.exactValidationRun?.id);
  });
});

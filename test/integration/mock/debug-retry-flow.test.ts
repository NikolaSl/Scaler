/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadDebugAttempts, loadDebugReports, loadDebugRetries, recordDebugAttempt, recordDebugReport } from "../../../src/debug.js";
import { verifyAcceptedTaskEvidence } from "../../../src/accepted-evidence.js";
import { getBudgetState } from "../../../src/budgets.js";
import { saveDebugRetryPolicy } from "../../../src/debug-retry.js";
import { readLogEvents } from "../../../src/logging.js";
import { runValidationWithExecutionLock } from "../../../src/operations.js";
import { createDefaultState, loadState, saveState } from "../../../src/state.js";
import type { TaskAgentRequest, TaskAgentRunResult } from "../../../src/subagents.js";
import { getValidationManifestForTask, saveValidationManifest, loadValidationRuns, runTaskValidation, runValidationCommand, upsertValidationManifestCommand } from "../../../src/validation.js";
import { runDebugAgentStep, runDebugConductorLoop, runDebugNextApproachRetry } from "./provider-bound-helpers.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-debug-retry-integration-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function taskReport(taskId: string): Record<string, unknown> {
  return { type: "scaler_task_report", taskId, status: "completed", summary: "Debug retry task completed.", changedFiles: ["fixed.txt"], memoryRefs: [], validations: [], validationRefs: [], evidenceRefs: ["validation:exact-marker"], blockers: [], missingData: [], recommendedNextAction: "validate" };
}

function passingRun(request: TaskAgentRequest): TaskAgentRunResult {
  return { taskId: request.taskId, exitCode: 0, stdoutEvents: [{ ...taskReport(request.taskId), ...request.attempt }], stderr: "", timedOut: false, aborted: false };
}

test("mock integration: normalized failed approaches reach the fresh implementation retry", async () => {
  await withTempDir(async dir => {
    const state = createDefaultState(); state.stage = "execution"; state.currentTaskId = "HISTORY";
    state.budgets = { limits: { spawnedAgents: { hard: 4 }, tacticChanges: { hard: 1 }, wallClockMs: { hard: 60_000 } } };
    state.tasks = [{ id: "HISTORY", status: "validating", taskKind: "non_software", title: "Write the required payload",
      allowedPathPrefixes: ["fixed.txt"], definitionOfDone: ["fixed.txt contains the required payload."], updatedAt: state.createdAt }];
    await saveState(dir, state);
    await writeFile(join(dir, "fixed.txt"), ""); // An actual ineffective approach, not an invented history label.
    await saveValidationManifest(dir, { taskId: "HISTORY", outputPaths: ["fixed.txt"], commands: [{ id: "payload",
      command: "node -e \"require('node:assert/strict').equal(require('node:fs').readFileSync('fixed.txt','utf8'),'required payload')\"",
      required: true, gate: "consistency", timeoutMs: 5000 }], createdAt: state.createdAt, updatedAt: state.createdAt });
    const failed = await runTaskValidation(dir, await loadState(dir), "HISTORY");
    assert.equal(failed.status, "failed");
    const prior = await recordDebugAttempt(dir, await loadState(dir), { taskId: "HISTORY", failureId: "EMPTY",
      hypothesis: "Creating an empty marker is sufficient.", actionSummary: "EMPTY-MARKER did not satisfy the payload criterion.",
      result: "same_failure", failureFingerprint: "missing-payload", evidence: [failed.id], validationRun: failed.id });
    assert.equal(prior.accepted, true);
    const history = `${prior.attempt!.id}: ${prior.attempt!.actionSummary} Evidence: ${failed.id}`;
    const diagnosed = await runDebugAgentStep(dir, await loadState(dir), { taskId: "HISTORY", execute: true, tools: [], timeoutMs: 5000 }, async request => {
      assert.match(request.prompt, /EMPTY-MARKER/);
      return { taskId: request.taskId, exitCode: 0, stderr: "", timedOut: false, aborted: false, stdoutEvents: [{
        type: "scaler_debug_report", id: "HISTORY-NEXT", taskId: "HISTORY", status: "next_approach",
        summary: "Repair the payload", attemptedApproaches: [history], rootCause: "The payload is empty.",
        nextApproach: "Write required payload to fixed.txt.", evidenceRefs: [failed.id],
      }] };
    });
    assert.equal(diagnosed.ingestion?.ingested, true);
    assert.deepEqual((await loadDebugReports(dir))[0]?.attemptedApproaches, [history]);
    let calls = 0;
    const retried = await runDebugNextApproachRetry(dir, await loadState(dir), { taskId: "HISTORY", execute: true, tools: [], timeoutMs: 5000 }, async request => {
      calls++; assert.deepEqual(request.tools, []);
      assert.ok(request.prompt.includes(history), "Fresh implementation worker must receive the normalized failed-approach summary.");
      await writeFile(join(dir, "fixed.txt"), "required payload");
      return passingRun(request);
    });
    assert.equal(calls, 1); assert.equal(retried.status, "exact_validation_passed", retried.message);
    assert.equal((await runValidationWithExecutionLock(dir, await loadState(dir), "HISTORY")).result?.status, "passed");
    assert.deepEqual(await verifyAcceptedTaskEvidence(dir, await loadState(dir), "HISTORY"), []);
    assert.deepEqual((await loadDebugAttempts(dir)).find(a => a.id === prior.attempt!.id), prior.attempt);
    assert.equal(getBudgetState(await loadState(dir)).usage.spawnedAgents, 2);
  });
});

test("mock integration: actual timeout trace discriminates causes and cosmetic output cannot replace cause repair", async () => {
  await withTempDir(async dir => {
    const state = createDefaultState(); state.stage = "execution"; state.currentTaskId = "WAIT";
    state.budgets = { limits: { spawnedAgents: { hard: 5 }, tacticChanges: { hard: 2 }, wallClockMs: { hard: 60_000 } } };
    state.tasks = [{ id: "WAIT", status: "validating", taskKind: "non_software",
      title: "Resolve a worker timeout without suppressing the required result",
      allowedPathPrefixes: ["input.txt", "work.lock", "result.txt"],
      definitionOfDone: ["Worker completes without a lock and result.txt equals the required input."], updatedAt: state.createdAt }];
    await saveState(dir, state);
    await writeFile(join(dir, "worker.cjs"), `
const fs = require('node:fs'), assert = require('node:assert/strict');
const backstop = setTimeout(() => process.exit(9), 5000);
const poll = setInterval(() => {
  const stage = !fs.existsSync('input.txt') ? 'waiting-for-input' : fs.existsSync('work.lock') ? 'waiting-for-lock' : 'ready';
  fs.writeFileSync('trace.txt', stage);
  if (stage !== 'ready') return;
  clearInterval(poll); clearTimeout(backstop);
  assert.equal(fs.readFileSync('input.txt', 'utf8'), 'required payload');
  assert.equal(fs.readFileSync('result.txt', 'utf8'), fs.readFileSync('input.txt', 'utf8'));
}, 10);
`);
    await writeFile(join(dir, "probe.cjs"), "process.stdout.write(require('node:fs').readFileSync('trace.txt','utf8'));");
    const worker = { id: "worker", command: "exec node worker.cjs", required: true, gate: "consistency" as const, timeoutMs: 1000 };
    const probe = { id: "probe", command: "exec node probe.cjs", required: true, timeoutMs: 1000 };
    const predictions = { input: "waiting-for-input", lock: "waiting-for-lock" }; // Declared before either diagnostic.
    // Same actual command, alternate cause: present input but held lock.
    await writeFile(join(dir, "input.txt"), "required payload"); await writeFile(join(dir, "work.lock"), "held");
    assert.equal((await runValidationCommand(dir, worker)).status, "timed_out");
    const alternate = await runValidationCommand(dir, probe);
    assert.equal(alternate.status, "passed"); assert.equal(alternate.stdoutSummary, predictions.lock);
    await rm(join(dir, "input.txt")); await rm(join(dir, "work.lock"));
    await upsertValidationManifestCommand(dir, { taskId: "WAIT", ...worker });
    await saveValidationManifest(dir, { ...await getValidationManifestForTask(dir, "WAIT"),
      outputPaths: ["input.txt", "work.lock", "result.txt"], validationInputPaths: ["worker.cjs", "probe.cjs"] });
    const initial = await runTaskValidation(dir, await loadState(dir), "WAIT");
    assert.equal(initial.status, "failed"); assert.equal(initial.commandRuns[0]?.status, "timed_out");
    assert.equal(initial.commandRuns[0]?.timeoutMs, worker.timeoutMs);
    assert.equal((await loadState(dir)).tasks[0]?.status, "debugging");
    let diagnostic: Awaited<ReturnType<typeof runValidationCommand>> | undefined;
    const diagnosed = await runDebugAgentStep(dir, await loadState(dir), { taskId: "WAIT", execute: true, tools: ["read"], timeoutMs: 5000 }, async request => {
      diagnostic = await runValidationCommand(dir, probe); // Real trace, not the fixture case label.
      assert.equal(diagnostic.status, "passed"); assert.equal(diagnostic.stdoutSummary, predictions.input);
      assert.notEqual(diagnostic.stdoutSummary, alternate.stdoutSummary);
      return { taskId: request.taskId, exitCode: 0, timedOut: false, aborted: false, stderr: "", stdoutEvents: [{
        type: "scaler_debug_report", id: "COSMETIC", taskId: "WAIT", status: "next_approach",
        summary: "Adversarial cosmetic proposal after actual diagnosis", failureFingerprint: "worker-timeout",
        rootCause: "Input unavailable", investigationSummary: `Predicted ${predictions.input} or ${predictions.lock}; observed ${diagnostic.stdoutSummary}`,
        nextApproach: "Write result.txt only without supplying the missing input.", evidenceRefs: [initial.id, diagnostic.id],
      }] };
    });
    assert.equal(diagnosed.ingestion?.ingested, true);
    assert.ok((await loadDebugReports(dir))[0]?.evidenceRefs?.includes(diagnostic!.id));
    const cosmetic = await runDebugNextApproachRetry(dir, await loadState(dir), { taskId: "WAIT", execute: true, timeoutMs: 5000 }, async request => {
      await writeFile(join(dir, "result.txt"), "required payload");
      return { ...passingRun(request), stdoutEvents: [{ ...taskReport(request.taskId), ...request.attempt, changedFiles: ["result.txt"] }] };
    });
    assert.equal(cosmetic.status, "exact_validation_failed");
    assert.equal(cosmetic.exactValidationRun?.commandRuns[0]?.status, "timed_out");
    assert.equal(cosmetic.exactValidationRun?.commandRuns[0]?.command, worker.command);
    assert.equal((await loadState(dir)).validatedTaskIds.includes("WAIT"), false);
    assert.notDeepEqual(await verifyAcceptedTaskEvidence(dir, await loadState(dir), "WAIT"), []);
    const corrected = await recordDebugReport(dir, await loadState(dir), { id: "CAUSE-FIX", taskId: "WAIT", status: "next_approach",
      summary: "Correct the observed input cause, not the output symptom", rootCause: "Input unavailable", failureFingerprint: "worker-timeout",
      nextApproach: "Supply required input.txt and rerun the unchanged worker command.",
      evidenceRefs: [diagnostic!.id, cosmetic.exactValidationRun!.id] });
    assert.equal(corrected.accepted, true);
    const fixed = await runDebugNextApproachRetry(dir, await loadState(dir), { taskId: "WAIT", execute: true, timeoutMs: 5000 }, async request => {
      assert.match(request.prompt, /Supply required input/);
      await writeFile(join(dir, "input.txt"), "required payload");
      return { ...passingRun(request), stdoutEvents: [{ ...taskReport(request.taskId), ...request.attempt, changedFiles: ["input.txt"] }] };
    });
    assert.equal(fixed.status, "exact_validation_passed", fixed.message);
    assert.equal(fixed.exactValidationRun?.commandRuns[0]?.command, worker.command);
    assert.equal((await loadState(dir)).tasks[0]?.status, "validating");
    const full = await runValidationWithExecutionLock(dir, await loadState(dir), "WAIT");
    assert.equal(full.result?.status, "passed", full.message);
    assert.deepEqual(await verifyAcceptedTaskEvidence(dir, await loadState(dir), "WAIT"), []);
    assert.equal(await readFile(join(dir, "trace.txt"), "utf8"), "ready");
    assert.equal(getBudgetState(await loadState(dir)).usage.spawnedAgents, 3);
    assert.deepEqual((await loadDebugAttempts(dir)).map(a => a.result).sort(), ["fixed", "same_failure"]);
  });
});

test("mock integration: debug retry policy auto-starts next approach and runs full validation", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    const updatedAt = state.createdAt;
    state.stage = "execution";
    state.currentTaskId = "T-RETRY-AUTO";
    state.tasks = [{
      id: "T-RETRY-AUTO", status: "validating", title: "Retry auto flow",
      allowedPathPrefixes: ["fixed.txt"], definitionOfDone: ["The exact marker validation passes."], updatedAt,
    }];
    await saveState(dir, state);
    await upsertValidationManifestCommand(dir, {
      taskId: "T-RETRY-AUTO",
      id: "exact-marker",
      command: "node -e \"process.exit(require('fs').existsSync('fixed.txt') ? 0 : 1)\"",
      description: "Exact marker validation",
      required: true,
      gate: "unit",
      expectedResult: "fixed.txt exists",
      evidenceRefs: ["validation:exact-marker"],
    });

    await saveValidationManifest(dir, { ...await getValidationManifestForTask(dir, "T-RETRY-AUTO"), outputPaths: ["fixed.txt"] });
    const initialRun = await runTaskValidation(dir, state, "T-RETRY-AUTO");
    assert.equal(initialRun.status, "failed");
    await saveDebugRetryPolicy(dir, { autoStart: true, postExactPass: "validate" });
    const debugging = await loadState(dir);

    const result = await runDebugConductorLoop(dir, debugging, { taskId: "T-RETRY-AUTO", execute: true, maxSteps: 2 }, {
      debug: async (request) => ({
        taskId: request.taskId,
        exitCode: 0,
        stdoutEvents: [{
          type: "scaler_debug_report",
          id: "RPT-RETRY-AUTO",
          taskId: "T-RETRY-AUTO",
          status: "next_approach",
          summary: "Write the missing marker file.",
          failureId: "F-RETRY-AUTO",
          failureFingerprint: "missing marker file",
          rootCause: "The implementation did not create fixed.txt.",
          nextApproach: "Create fixed.txt and rerun the exact marker validation.",
          evidenceRefs: [initialRun.id],
        }],
        stderr: "",
        timedOut: false,
        aborted: false,
      }),
      retry: async (request) => {
        assert.match(request.prompt, /Create fixed\.txt/);
        await writeFile(join(request.cwd ?? dir, "fixed.txt"), "ok\n", "utf8");
        return passingRun(request);
      },
    });

    assert.equal(result.accepted, true);
    assert.equal(result.stopReason, "retry_exact_validation_passed");
    assert.deepEqual(result.steps.map((step) => step.action), ["run_debug_agent", "run_debug_retry"]);
    assert.equal(result.steps[1]?.debugRetry?.postValidation?.result?.status, "passed");
    assert.equal((await loadState(dir)).tasks.find((task) => task.id === "T-RETRY-AUTO")?.status, "validated");
    assert.equal((await loadDebugRetries(dir))[0]?.status, "exact_validation_passed");
  });
});

test("mock integration: debug next approach retry fixes exact validation before full validation", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    const updatedAt = state.createdAt;
    state.stage = "execution";
    state.currentTaskId = "T-RETRY-FLOW";
    state.tasks = [{
      id: "T-RETRY-FLOW", status: "validating", title: "Retry flow",
      allowedPathPrefixes: ["fixed.txt"], definitionOfDone: ["The exact marker validation passes."], updatedAt,
    }];
    await saveState(dir, state);
    await upsertValidationManifestCommand(dir, {
      taskId: "T-RETRY-FLOW",
      id: "exact-marker",
      command: "node -e \"process.exit(require('fs').existsSync('fixed.txt') ? 0 : 1)\"",
      description: "Exact marker validation",
      required: true,
      gate: "unit",
      expectedResult: "fixed.txt exists",
      evidenceRefs: ["validation:exact-marker"],
    });

    await saveValidationManifest(dir, { ...await getValidationManifestForTask(dir, "T-RETRY-FLOW"), outputPaths: ["fixed.txt"] });
    const initialRun = await runTaskValidation(dir, state, "T-RETRY-FLOW");
    assert.equal(initialRun.status, "failed");
    const debugging = await loadState(dir);
    assert.equal(debugging.tasks.find((task) => task.id === "T-RETRY-FLOW")?.status, "debugging");

    await recordDebugReport(dir, debugging, {
      id: "RPT-RETRY-FLOW",
      taskId: "T-RETRY-FLOW",
      status: "next_approach",
      summary: "Write the missing marker file.",
      failureId: "F-RETRY-FLOW",
      failureFingerprint: "missing marker file",
      rootCause: "The implementation did not create fixed.txt.",
      nextApproach: "Create fixed.txt and rerun the exact marker validation.",
      evidenceRefs: [initialRun.id],
    });

    const retry = await runDebugNextApproachRetry(dir, await loadState(dir), { taskId: "T-RETRY-FLOW", execute: true }, async (request) => {
      assert.match(request.prompt, /Create fixed\.txt/);
      assert.match(request.prompt, /exact-marker/);
      await writeFile(join(request.cwd ?? dir, "fixed.txt"), "ok\n", "utf8");
      return passingRun(request);
    });

    assert.equal(retry.accepted, true);
    assert.equal(retry.status, "exact_validation_passed");
    assert.equal(retry.exactValidationRun?.status, "passed");
    assert.equal((await loadState(dir)).tasks.find((task) => task.id === "T-RETRY-FLOW")?.status, "validating");

    const fullValidation = await runValidationWithExecutionLock(dir, await loadState(dir), "T-RETRY-FLOW");
    assert.equal(fullValidation.accepted, true);
    assert.equal(fullValidation.result?.status, "passed");
    assert.equal((await loadState(dir)).tasks.find((task) => task.id === "T-RETRY-FLOW")?.status, "validated");

    const retries = await loadDebugRetries(dir);
    assert.equal(retries[0]?.status, "exact_validation_passed");
    assert.equal(retries[0]?.validationRunId, retry.exactValidationRun?.id);
    const attempts = await loadDebugAttempts(dir);
    assert.equal(attempts.at(-1)?.result, "fixed");
    assert.equal(attempts.at(-1)?.validationRun, retry.exactValidationRun?.id);

    const validationRuns = await loadValidationRuns(dir);
    assert.ok(validationRuns.some((run) => run.id === retry.exactValidationRun?.id && run.status === "passed"));
    assert.ok(validationRuns.some((run) => run.id === fullValidation.result?.id && run.status === "passed"));

    const events = await readLogEvents(dir);
    assert.ok(events.some((event) => event.eventType === "debug" && event.summary === "Debug retry exact validation passed: T-RETRY-FLOW. Run full validation next."));
    assert.ok(events.some((event) => event.eventType === "validation" && event.summary === "Validation applied: T-RETRY-FLOW passed"));
  });
});

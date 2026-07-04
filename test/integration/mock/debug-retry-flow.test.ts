import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadDebugAttempts, loadDebugRetries, recordDebugReport } from "../../../src/debug.js";
import { runDebugNextApproachRetry } from "../../../src/debug-retry.js";
import { readLogEvents } from "../../../src/logging.js";
import { runValidationWithExecutionLock } from "../../../src/operations.js";
import { createDefaultState, loadState, saveState } from "../../../src/state.js";
import type { TaskAgentRequest, TaskAgentRunResult } from "../../../src/subagents.js";
import { loadValidationRuns, runTaskValidation, upsertValidationManifestCommand } from "../../../src/validation.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-debug-retry-integration-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function passingRun(request: TaskAgentRequest): TaskAgentRunResult {
  return { taskId: request.taskId, exitCode: 0, stdoutEvents: [], stderr: "", timedOut: false, aborted: false };
}

test("mock integration: debug next approach retry fixes exact validation before full validation", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    const updatedAt = state.createdAt;
    state.stage = "execution";
    state.currentTaskId = "T-RETRY-FLOW";
    state.tasks = [{ id: "T-RETRY-FLOW", status: "validating", title: "Retry flow", updatedAt }];
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

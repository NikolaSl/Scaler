/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadDebugReports } from "../src/debug.js";
import { createDefaultState, loadState, saveState } from "../src/state.js";
import type { TaskAgentRequest, TaskAgentRunResult } from "../src/subagents.js";
import { runValidationDebugLoopWorkflow, selectTaskForValidationDebugLoop, type ValidationDebugLoopValidator } from "../src/validation-debug-loop.js";
import type { ScalerState } from "../src/types.js";
import { getValidationManifestForTask, saveValidationManifest } from "../src/validation.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-validation-debug-loop-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function writePackage(dir: string, exitCode: number): Promise<void> {
  await writeFile(join(dir, "package.json"), JSON.stringify({
    type: "module",
    scripts: { test: `node -e \"process.exit(${exitCode})\"` },
  }, null, 2));
}

function validatingState(): ScalerState {
  const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
  state.stage = "execution";
  state.currentTaskId = "T-VAL-DEBUG";
  state.tasks = [{ id: "T-VAL-DEBUG", status: "validating", title: "Validate then debug", updatedAt: state.createdAt }];
  return state;
}

function runResult(request: TaskAgentRequest, stdoutEvents: unknown[]): TaskAgentRunResult {
  return { taskId: request.taskId, exitCode: 0, stdoutEvents, stderr: "", timedOut: false, aborted: false };
}

test("selectTaskForValidationDebugLoop prefers explicit, current, then first candidate", () => {
  const state = validatingState();
  state.tasks.unshift({ id: "T-FIRST", status: "debugging", title: "First", updatedAt: state.createdAt });

  assert.equal(selectTaskForValidationDebugLoop(state, "T-EXPLICIT"), "T-EXPLICIT");
  assert.equal(selectTaskForValidationDebugLoop(state), "T-VAL-DEBUG");
  state.currentTaskId = null;
  assert.equal(selectTaskForValidationDebugLoop(state), "T-FIRST");
});

test("runValidationDebugLoopWorkflow skips debug loop when validation passes", async () => {
  await withTempDir(async (dir) => {
    await writePackage(dir, 0);
    await saveValidationManifest(dir, { ...await getValidationManifestForTask(dir, "T-VAL-DEBUG"), outputPaths: [] });
    const state = validatingState();
    await saveState(dir, state);

    const result = await runValidationDebugLoopWorkflow(dir, state, "T-VAL-DEBUG", { execute: true });

    assert.equal(result.accepted, true);
    assert.equal(result.validation.result?.status, "passed");
    assert.equal(result.debugLoop, undefined);
    assert.equal((await loadState(dir)).tasks[0]?.status, "validated");
  });
});

test("runValidationDebugLoopWorkflow starts bounded debug loop after failed validation releases lock", async () => {
  await withTempDir(async (dir) => {
    await writePackage(dir, 1);
    const state = validatingState();
    await saveState(dir, state);

    const result = await runValidationDebugLoopWorkflow(dir, state, "T-VAL-DEBUG", { execute: true, maxSteps: 2 }, {
      debug: async (request) => runResult(request, [{
        type: "scaler_debug_report",
        id: "RPT-VAL-DEBUG-NEXT",
        taskId: "T-VAL-DEBUG",
        status: "next_approach",
        summary: "Validation failure has a clear next approach.",
        nextApproach: "Patch the deterministic failing fixture and rerun validation.",
        evidenceRefs: ["validation-run"],
      }]),
    });

    assert.equal(result.accepted, true);
    assert.equal(result.validation.result?.status, "failed");
    assert.equal(result.debugLoop?.stopReason, "next_approach");
    assert.equal((await loadState(dir)).tasks[0]?.status, "debugging");
    assert.equal((await loadDebugReports(dir))[0]?.id, "RPT-VAL-DEBUG-NEXT");
  });
});

test("runValidationDebugLoopWorkflow stops when validation is rejected", async () => {
  await withTempDir(async (dir) => {
    const state = validatingState();
    await saveState(dir, state);
    const validator: ValidationDebugLoopValidator = async () => ({ accepted: false, message: "lock held" });

    const result = await runValidationDebugLoopWorkflow(dir, state, "T-VAL-DEBUG", { execute: true }, {}, validator);

    assert.equal(result.accepted, false);
    assert.match(result.message, /lock held/);
    assert.equal(result.debugLoop, undefined);
  });
});

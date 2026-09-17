/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { loadCommitReports, loadCommitSkips } from "../src/git.js";
import { getStatePath } from "../src/paths.js";
import { createDefaultState, loadState, saveState } from "../src/state.js";
import type { ScalerState } from "../src/types.js";
import { loadValidationRuns, runTaskValidation, saveValidationManifest } from "../src/validation.js";
import { fingerprintValidationResult, verifyValidationRunReceipt } from "../src/validation-acceptance.js";

const exec = promisify(execFile);
async function fixture(git: boolean, fn: (dir: string, state: ScalerState) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "scaler-auto-acceptance-"));
  try {
    if (git) {
      await exec("git", ["init"], { cwd: dir });
      await exec("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-m", "base"], { cwd: dir });
    }
    const state = createDefaultState();
    state.stage = "execution";
    state.tasks = [{ id: "T-AUTO", status: "validating", updatedAt: state.updatedAt }];
    await saveState(dir, state);
    await fn(dir, state);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

for (const git of [false, true]) {
  for (const evidence of ["empty", "optional_failure"] as const) {
    test(`automatic ${git ? "Git" : "non-Git"} acceptance refuses ${evidence} without publishing a skip`, async () => {
      await fixture(git, async (dir, state) => {
        await saveValidationManifest(dir, { taskId: "T-AUTO", commands: evidence === "empty" ? [] : [
          { id: "failed", command: "node -e 'process.exit(1)'", required: false },
        ], createdAt: "", updatedAt: "" });
        const before = await readFile(getStatePath(dir), "utf8");
        const head = git ? (await exec("git", ["rev-parse", "HEAD"], { cwd: dir })).stdout : undefined;
        const run = await runTaskValidation(dir, state, "T-AUTO");
        assert.equal(run.acceptance?.accepted, false);
        assert.equal(run.status, "blocked");
        assert.match(run.acceptance?.message ?? "", /evidence|receipt/i);
        assert.equal(await readFile(getStatePath(dir), "utf8"), before);
        assert.deepEqual(await loadCommitSkips(dir), []);
        assert.deepEqual(await loadCommitReports(dir), []);
        assert.equal((await loadValidationRuns(dir))[0]?.status, "blocked");
        if (evidence === "optional_failure") assert.equal(run.commandRuns[0]?.status, "failed", "failed command evidence is retained");
        if (git) assert.equal((await exec("git", ["rev-parse", "HEAD"], { cwd: dir })).stdout, head);
      });
    });
  }
  for (const evidence of ["passed", "declared_skip"] as const) {
    test(`automatic ${git ? "Git" : "non-Git"} acceptance preserves current ${evidence} evidence`, async () => {
      await fixture(git, async (dir, state) => {
        await saveValidationManifest(dir, { taskId: "T-AUTO", commands: [{
          id: "check", command: "node -e 'process.exit(0)'", required: true,
          ...(evidence === "declared_skip" ? { disposition: "skipped", dispositionReason: "Capability not applicable to this fixture" } : {}),
        }], createdAt: "", updatedAt: "" });
        const run = await runTaskValidation(dir, state, "T-AUTO");
        assert.equal(run.status, "passed");
        assert.equal(run.acceptance?.accepted, true, run.acceptance?.message);
        assert.equal((await loadState(dir)).tasks[0]?.status, "validated");
        assert.deepEqual((await loadState(dir)).validatedTaskIds, ["T-AUTO"]);
        assert.equal((await loadCommitSkips(dir)).length, 1);
        assert.equal(run.commandRuns[0]?.status, evidence === "passed" ? "passed" : "skipped");
      });
    });
  }
}

test("automatic acceptance rejects a stale state snapshot before publishing Git acceptance", async () => {
  await fixture(false, async (dir, state) => {
    await saveValidationManifest(dir, { taskId: "T-AUTO", commands: [
      { id: "check", command: "node -e 'process.exit(0)'", required: true },
    ], createdAt: "", updatedAt: "" });
    const newer = structuredClone(state);
    newer.orchestrationReason = "Concurrent supervisor update";
    await saveState(dir, newer);
    const before = await readFile(getStatePath(dir), "utf8");
    const run = await runTaskValidation(dir, state, "T-AUTO");
    assert.equal(run.acceptance?.accepted, false);
    assert.equal(run.status, "blocked");
    assert.match(run.acceptance?.message ?? "", /state changed|persisted/i);
    assert.equal(run.commandRuns[0]?.status, "passed");
    assert.equal(await readFile(getStatePath(dir), "utf8"), before);
    assert.deepEqual(await loadCommitSkips(dir), []);
  });
});

test("shared verifier refuses a self-consistent record naming a different task", async () => {
  await fixture(false, async (dir, state) => {
    await saveValidationManifest(dir, { taskId: "T-AUTO", commands: [
      { id: "check", command: "node -e 'process.exit(0)'", required: true },
    ], createdAt: "", updatedAt: "" });
    const run = await runTaskValidation(dir, state, "T-AUTO");
    const current = await loadState(dir);
    assert.deepEqual(await verifyValidationRunReceipt(dir, current, "T-AUTO", run), []);
    run.taskId = "T-OTHER";
    run.receipt!.resultFingerprint = fingerprintValidationResult(run);
    assert.ok((await verifyValidationRunReceipt(dir, current, "T-AUTO", run)).length > 0);
  });
});

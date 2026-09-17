/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { evaluateValidationGitAcceptance, loadCommitSkips } from "../src/git.js";
import { createDefaultState, loadState, saveState } from "../src/state.js";
import type { ScalerState } from "../src/types.js";
import { runTaskValidation, saveValidationManifest, type ValidationRunRecord } from "../src/validation.js";

const exec = promisify(execFile);
async function fixture(git: boolean, fn: (dir: string, state: ScalerState) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "scaler-git-decision-"));
  try {
    await writeFile(join(dir, "result.txt"), "ok");
    if (git) {
      await exec("git", ["init"], { cwd: dir });
      await exec("git", ["config", "user.name", "Test"], { cwd: dir });
      await exec("git", ["config", "user.email", "test@example.com"], { cwd: dir });
      await exec("git", ["add", "result.txt"], { cwd: dir });
      await exec("git", ["commit", "-m", "base"], { cwd: dir });
    }
    const state = createDefaultState();
    state.stage = "execution";
    state.tasks = [{ id: "T-DIRECT", status: "validating", updatedAt: state.updatedAt }];
    await saveState(dir, state);
    await saveValidationManifest(dir, { taskId: "T-DIRECT", commands: [{ id: "check", required: true,
      command: 'node -e "if(require(\'fs\').readFileSync(\'result.txt\',\'utf8\')!==\'ok\')process.exit(1)"',
    }], createdAt: "", updatedAt: "" });
    await fn(dir, state);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

for (const git of [false, true]) {
  for (const mutation of ["bare_summary", "empty", "tampered", "stale_state"] as const) {
    test(`direct ${git ? "Git" : "non-Git"} decision refuses ${mutation}`, async () => fixture(git, async (dir, state) => {
      let run: ValidationRunRecord;
      let current = state;
      if (mutation === "bare_summary") {
        run = { runId: "claimed", status: "passed", commandCount: 1, failedCommandIds: [] } as unknown as ValidationRunRecord;
      } else {
        run = await runTaskValidation(dir, state, "T-DIRECT");
        current = await loadState(dir);
        if (mutation === "empty") run.commandRuns = [];
        if (mutation === "tampered") run.commandRuns[0]!.status = "failed";
        if (mutation === "stale_state") {
          const newer = structuredClone(current);
          newer.orchestrationReason = "Another supervisor update";
          await saveState(dir, newer);
        }
      }
      const skips = await loadCommitSkips(dir);
      const before = await readFile(join(dir, ".scaler/state.json"), "utf8");
      const result = await evaluateValidationGitAcceptance(dir, current, "T-DIRECT", run);
      assert.equal(result.accepted, false);
      assert.equal(result.status, "blocked");
      assert.match(result.message, /receipt|evidence|state/i);
      assert.deepEqual(await loadCommitSkips(dir), skips);
      assert.equal(await readFile(join(dir, ".scaler/state.json"), "utf8"), before);
    }));
  }
  test(`direct ${git ? "Git" : "non-Git"} decision derives skip summary from verified run`, async () => fixture(git, async (dir, state) => {
    const run = await runTaskValidation(dir, state, "T-DIRECT");
    const result = await evaluateValidationGitAcceptance(dir, await loadState(dir), "T-DIRECT", run);
    assert.equal(result.accepted, true, result.message);
    assert.equal(result.skip?.validation.runId, run.id);
    assert.equal(result.skip?.validation.commandCount, run.commandRuns.length);
  }));
}

test("direct clean Git decision refuses a changed committed candidate", async () => fixture(true, async (dir, state) => {
  const run = await runTaskValidation(dir, state, "T-DIRECT");
  await writeFile(join(dir, "result.txt"), "changed");
  await exec("git", ["add", "result.txt"], { cwd: dir });
  await exec("git", ["commit", "-m", "unvalidated"], { cwd: dir });
  const skips = await loadCommitSkips(dir);
  const result = await evaluateValidationGitAcceptance(dir, await loadState(dir), "T-DIRECT", run);
  assert.equal(result.accepted, false);
  assert.deepEqual(await loadCommitSkips(dir), skips);
}));

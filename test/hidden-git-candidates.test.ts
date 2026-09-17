/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { commitValidatedTask, loadCommitSkips, skipTaskCommit } from "../src/git.js";
import { createDefaultState, loadState, saveState } from "../src/state.js";
import { runTaskValidation, saveValidationManifest } from "../src/validation.js";
import { captureValidationSnapshot } from "../src/validation-acceptance.js";

const exec = promisify(execFile);
async function fixture(flag: string | undefined, fn: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "scaler-hidden-candidate-"));
  try {
    await exec("git", ["init"], { cwd: dir });
    await exec("git", ["config", "user.name", "Test"], { cwd: dir });
    await exec("git", ["config", "user.email", "test@example.com"], { cwd: dir });
    await writeFile(join(dir, "result.txt"), "accepted");
    await exec("git", ["add", "result.txt"], { cwd: dir });
    await exec("git", ["commit", "-m", "base"], { cwd: dir });
    if (flag) await exec("git", ["update-index", flag, "result.txt"], { cwd: dir });
    const state = createDefaultState();
    state.stage = "execution";
    state.tasks = [{ id: "T-HIDDEN", status: "validating", allowedPathPrefixes: ["result.txt"], updatedAt: state.updatedAt }];
    await saveState(dir, state);
    await saveValidationManifest(dir, { taskId: "T-HIDDEN", outputPaths: ["result.txt"], commands: [{ id: "check", required: true,
      command: 'node -e "if(require(\'fs\').readFileSync(\'result.txt\',\'utf8\')!==\'accepted\')process.exit(1)"',
    }], createdAt: "", updatedAt: "" });
    assert.equal((await runTaskValidation(dir, state, "T-HIDDEN")).acceptance?.accepted, true);
    await fn(dir);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

for (const flag of ["--assume-unchanged", "--skip-worktree"]) {
  for (const action of ["commit", "skip"]) {
    test(`${action} rejects a post-validation edit hidden by ${flag}`, async () => fixture(flag, async (dir) => {
      const head = (await exec("git", ["rev-parse", "HEAD"], { cwd: dir })).stdout;
      const skips = await loadCommitSkips(dir);
      const candidateBefore = await captureValidationSnapshot(dir, await loadState(dir), "T-HIDDEN");
      await writeFile(join(dir, "result.txt"), "hidden mutation");
      const state = await loadState(dir);
      const candidateAfter = await captureValidationSnapshot(dir, state, "T-HIDDEN");
      assert.notEqual(candidateAfter.gitCandidateFingerprint, candidateBefore.gitCandidateFingerprint,
        "Git candidate protection must still work independently of declared-output identity");
      const result = action === "commit" ? await commitValidatedTask(dir, state, "T-HIDDEN", ["result.txt"])
        : await skipTaskCommit(dir, state, "T-HIDDEN", "No commit required");
      assert.equal(result.accepted, false);
      assert.match(result.message, /receipt|candidate|evidence/i);
      assert.deepEqual(await loadCommitSkips(dir), skips);
      assert.equal((await exec("git", ["rev-parse", "HEAD"], { cwd: dir })).stdout, head);
    }));
  }
  test(`unchanged ${flag} file retains current validation evidence`, async () => fixture(flag, async (dir) => {
    const result = await skipTaskCommit(dir, await loadState(dir), "T-HIDDEN", "No output changed");
    assert.equal(result.accepted, true, result.message);
  }));
}

test("commit skip rejects changed index with restored working bytes", async () => fixture(undefined, async (dir) => {
  await writeFile(join(dir, "result.txt"), "index-only mutation");
  await exec("git", ["add", "result.txt"], { cwd: dir });
  await writeFile(join(dir, "result.txt"), "accepted");
  const skips = await loadCommitSkips(dir);
  const result = await skipTaskCommit(dir, await loadState(dir), "T-HIDDEN", "Working file restored");
  assert.equal(result.accepted, false);
  assert.deepEqual(await loadCommitSkips(dir), skips);
}));

test("staged runtime bookkeeping does not invalidate output evidence", async () => fixture(undefined, async (dir) => {
  await writeFile(join(dir, ".scaler/runtime-note.json"), "{}");
  await exec("git", ["add", ".scaler/runtime-note.json"], { cwd: dir });
  const result = await skipTaskCommit(dir, await loadState(dir), "T-HIDDEN", "Runtime-only change");
  assert.equal(result.accepted, true, result.message);
}));

test("clean large index does not overflow snapshot metadata capture", async () => fixture(undefined, async (dir) => {
  await mkdir(join(dir, "many"));
  // Full --stage output exceeds execFile's 1 MiB bound, while path/flag
  // metadata stays below it. Real tracked files keep the worktree clean.
  for (let offset = 0; offset < 12000; offset += 100) {
    await Promise.all(Array.from({ length: 100 }, (_, i) => writeFile(
      join(dir, "many", `${String(offset + i).padStart(5, "0")}-${"x".repeat(40)}.txt`), "ok")));
  }
  await exec("git", ["add", "many"], { cwd: dir });
  await exec("git", ["commit", "-m", "large clean index"], { cwd: dir });
  const state = await loadState(dir);
  const before = await captureValidationSnapshot(dir, state, "T-HIDDEN");
  const after = await captureValidationSnapshot(dir, state, "T-HIDDEN");
  assert.equal(after.gitCandidateFingerprint, before.gitCandidateFingerprint);
}));

test("unborn index drift is bound even when working bytes are restored", async () => fixture(undefined, async (dir) => {
  await rm(join(dir, ".git"), { recursive: true });
  await exec("git", ["init"], { cwd: dir });
  await exec("git", ["add", "result.txt"], { cwd: dir });
  const state = await loadState(dir);
  const before = await captureValidationSnapshot(dir, state, "T-HIDDEN");
  await writeFile(join(dir, "result.txt"), "staged mutation");
  await exec("git", ["add", "result.txt"], { cwd: dir });
  await writeFile(join(dir, "result.txt"), "accepted");
  const after = await captureValidationSnapshot(dir, state, "T-HIDDEN");
  assert.notEqual(after.gitCandidateFingerprint, before.gitCandidateFingerprint);
}));

test("unmerged index is refused rather than binding incomplete stage identities", async () => fixture(undefined, async (dir) => {
  await exec("git", ["checkout", "-b", "other"], { cwd: dir });
  await writeFile(join(dir, "result.txt"), "other");
  await exec("git", ["commit", "-am", "other"], { cwd: dir });
  await exec("git", ["checkout", "-b", "conflict", "HEAD~1"], { cwd: dir });
  await writeFile(join(dir, "result.txt"), "conflict");
  await exec("git", ["commit", "-am", "conflict"], { cwd: dir });
  await assert.rejects(exec("git", ["merge", "other"], { cwd: dir }));
  await assert.rejects(captureValidationSnapshot(dir, await loadState(dir), "T-HIDDEN"), /unmerged index/i);
}));

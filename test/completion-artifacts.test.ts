/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { runScalerAutomation } from "../src/autopilot.js";
import { loadCommitReports } from "../src/git.js";
import { commitWithExecutionLock } from "../src/operations.js";
import { getCommitReportsPath } from "../src/paths.js";
import { createDefaultState, loadState, saveState } from "../src/state.js";
import { runTaskValidation, saveValidationManifest } from "../src/validation.js";

const exec = promisify(execFile);
async function fixture(deletion: boolean, fn: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "scaler-accepted-artifact-"));
  try {
    await exec("git", ["init"], { cwd: dir });
    await exec("git", ["config", "user.name", "Test"], { cwd: dir });
    await exec("git", ["config", "user.email", "test@example.com"], { cwd: dir });
    await writeFile(join(dir, "result.txt"), "old");
    await exec("git", ["add", "result.txt"], { cwd: dir });
    await exec("git", ["commit", "-m", "base"], { cwd: dir });
    const state = createDefaultState();
    state.stage = "execution";
    state.tasks = [{ id: "T-OUTPUT", status: "validating", allowedPathPrefixes: ["result.txt"], updatedAt: state.updatedAt }];
    await saveState(dir, state);
    if (deletion) await unlink(join(dir, "result.txt"));
    else await writeFile(join(dir, "result.txt"), "accepted");
    await saveValidationManifest(dir, { taskId: "T-OUTPUT", commands: [{ id: "output", required: true,
      command: deletion ? 'node -e "if(require(\'fs\').existsSync(\'result.txt\'))process.exit(1)"'
        : 'node -e "if(require(\'fs\').readFileSync(\'result.txt\',\'utf8\')!==\'accepted\')process.exit(1)"',
    }], createdAt: "", updatedAt: "" });
    assert.equal((await runTaskValidation(dir, state, "T-OUTPUT")).status, "passed");
    const committed = await commitWithExecutionLock(dir, await loadState(dir), "T-OUTPUT", ["result.txt"]);
    assert.equal(committed.accepted, true, committed.message);
    assert.ok(committed.result?.commitHash);
    await fn(dir);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

async function complete(dir: string) {
  return runScalerAutomation(dir, await loadState(dir), { maxSteps: 1 });
}

for (const mutation of ["unstaged", "staged", "index_only", "assume_unchanged", "skip_worktree", "external_commit", "deleted", "mode", "missing_commit", "rollback", "path_list"] as const) {
  test(`completion rejects committed output drift: ${mutation}`, async () => fixture(false, async (dir) => {
    if (["unstaged", "staged", "index_only", "external_commit"].includes(mutation)) {
      await writeFile(join(dir, "result.txt"), "changed after acceptance");
      if (mutation !== "unstaged") await exec("git", ["add", "result.txt"], { cwd: dir });
      if (mutation === "index_only") await writeFile(join(dir, "result.txt"), "accepted");
      if (mutation === "external_commit") await exec("git", ["commit", "-m", "unvalidated change"], { cwd: dir });
    } else if (mutation === "assume_unchanged" || mutation === "skip_worktree") {
      await exec("git", ["update-index", mutation === "assume_unchanged" ? "--assume-unchanged" : "--skip-worktree", "result.txt"], { cwd: dir });
      await writeFile(join(dir, "result.txt"), "hidden change");
    } else if (mutation === "deleted") await unlink(join(dir, "result.txt"));
    else if (mutation === "mode") {
      await exec("git", ["config", "core.filemode", "false"], { cwd: dir });
      await chmod(join(dir, "result.txt"), 0o755);
    }
    else if (mutation === "rollback") await exec("git", ["reset", "--hard", "HEAD~1"], { cwd: dir });
    else {
      const commits = await loadCommitReports(dir);
      if (mutation === "missing_commit") commits[0]!.commitHash = "0000000000000000000000000000000000000000";
      else commits[0]!.includedPaths = ["unrelated.txt"];
      await writeFile(getCommitReportsPath(dir), JSON.stringify({ version: 1, commits }));
    }
    const result = await complete(dir);
    assert.equal(result.completed, false);
    assert.equal(result.accepted, false);
    assert.equal(result.stopReason, "blocked");
    assert.equal((await loadState(dir)).stage, "execution");
    assert.match(result.message, /commit|output|artifact/i);
    if (mutation === "index_only") assert.match(result.message, /index|staged/i);
  }));
}

test("a real accepted rename completes and still protects deletion of its source", async () => fixture(false, async (dir) => {
  await exec("git", ["mv", "result.txt", "renamed.txt"], { cwd: dir });
  const state = await loadState(dir);
  state.tasks = [{ id: "T-RENAME", status: "validating", allowedPathPrefixes: ["renamed.txt"], updatedAt: state.updatedAt }];
  state.validatedTaskIds = [];
  state.completedTaskIds = [];
  await saveState(dir, state);
  await saveValidationManifest(dir, { taskId: "T-RENAME", commands: [{ id: "rename", required: true,
    command: 'node -e "const f=require(\'fs\');if(f.existsSync(\'result.txt\')||f.readFileSync(\'renamed.txt\',\'utf8\')!==\'accepted\')process.exit(1)"',
  }], createdAt: "", updatedAt: "" });
  assert.equal((await runTaskValidation(dir, state, "T-RENAME")).status, "passed");
  const commit = await commitWithExecutionLock(dir, await loadState(dir), "T-RENAME", ["renamed.txt"]);
  assert.equal(commit.accepted, true, commit.message);
  assert.deepEqual(commit.result?.report?.includedPaths, ["renamed.txt"]);
  const completed = await complete(dir);
  assert.equal(completed.completed, true, completed.message);
  await writeFile(join(dir, "result.txt"), "recreated source");
  const rejected = await complete(dir);
  assert.equal(rejected.completed, false);
  assert.match(rejected.message, /deletion.*recreated/i);
}));

test("completion rejects an untracked recreation of an accepted deletion", async () => fixture(true, async (dir) => {
  await writeFile(join(dir, "result.txt"), "recreated");
  assert.equal((await complete(dir)).completed, false);
}));

for (const deletion of [false, true]) {
  test(`unchanged committed ${deletion ? "deletion" : "file"} supports completion and restart`, async () => fixture(deletion, async (dir) => {
    const first = await complete(dir);
    assert.equal(first.completed, true, first.message);
    assert.equal(first.accepted, true);
    const second = await complete(dir);
    assert.equal(second.completed, true, second.message);
    assert.equal(second.accepted, true);
  }));
}

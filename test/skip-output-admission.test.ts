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
import { evaluateValidationGitAcceptance, loadCommitSkips, skipTaskCommit } from "../src/git.js";
import { createDefaultState, loadState, saveState } from "../src/state.js";
import { runTaskValidation, saveValidationManifest } from "../src/validation.js";

const exec = promisify(execFile);
async function fixture(kind: "non_git" | "clean" | "runtime" | "changed", fn: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "scaler-skip-basis-"));
  try {
    await writeFile(join(dir, "result.txt"), "ok");
    if (kind !== "non_git") {
      await exec("git", ["init"], { cwd: dir });
      await exec("git", ["config", "user.name", "Test"], { cwd: dir });
      await exec("git", ["config", "user.email", "test@example.com"], { cwd: dir });
      await exec("git", ["add", "result.txt"], { cwd: dir });
      await exec("git", ["commit", "-m", "base"], { cwd: dir });
      if (kind !== "runtime") await writeFile(join(dir, ".git/info/exclude"), ".scaler/\n");
    }
    const state = createDefaultState();
    state.stage = "execution";
    state.tasks = [{ id: "T-SKIP", status: "validating", allowedPathPrefixes: ["result.txt"], updatedAt: state.updatedAt }];
    await saveState(dir, state);
    if (kind === "runtime") {
      await writeFile(join(dir, ".scaler/note.json"), "{}");
      await exec("git", ["add", ".scaler/note.json"], { cwd: dir });
    }
    if (kind === "changed") await writeFile(join(dir, "result.txt"), "changed");
    await saveValidationManifest(dir, { taskId: "T-SKIP", commands: [{ id: "check", required: true,
      command: `node -e "if(require('fs').readFileSync('result.txt','utf8')!=='${kind === "changed" ? "changed" : "ok"}')process.exit(1)"`,
    }], createdAt: "", updatedAt: "" });
    await fn(dir);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

for (const kind of ["non_git", "clean", "runtime"] as const) {
  test(`automatic ${kind} skip refuses unknown outputs without task promotion`, async () => fixture(kind, async (dir) => {
    const before = await readFile(join(dir, ".scaler/state.json"), "utf8");
    const run = await runTaskValidation(dir, await loadState(dir), "T-SKIP");
    assert.equal(run.status, "passed");
    assert.equal(run.acceptance?.accepted, false);
    assert.match(run.acceptance?.message ?? "", /^Automatic commit skip refused:.*outputPaths.*revalidat/i);
    assert.equal((await loadCommitSkips(dir)).length, 0);
    assert.equal(await readFile(join(dir, ".scaler/state.json"), "utf8"), before);
    const direct = await evaluateValidationGitAcceptance(dir, await loadState(dir), "T-SKIP", run);
    assert.equal(direct.accepted, false);
    assert.match(direct.message, /^Automatic commit skip refused:/);
    assert.equal((await loadCommitSkips(dir)).length, 0);
  }));
}

for (const kind of ["non_git", "clean", "changed"] as const) {
  test(`explicit ${kind} commit skip refuses unknown output basis`, async () => fixture(kind, async (dir) => {
    await runTaskValidation(dir, await loadState(dir), "T-SKIP");
    const before = await loadCommitSkips(dir);
    const result = await skipTaskCommit(dir, await loadState(dir), "T-SKIP", "No commit requested");
    assert.equal(result.accepted, false);
    assert.match(result.message, /^Commit skip refused:.*outputPaths.*revalidat/i);
    assert.deepEqual(await loadCommitSkips(dir), before);
  }));
}

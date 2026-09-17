/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { runConductorStep } from "../src/conductor.js";
import { commitValidatedTask, loadCommitReports, loadCommitSkips, skipTaskCommit } from "../src/git.js";
import { commitWithExecutionLock, skipCommitWithExecutionLock } from "../src/operations.js";
import { getValidationRunsPath } from "../src/paths.js";
import { createDefaultState, loadState, saveState } from "../src/state.js";
import { runTaskValidation, upsertValidationManifestCommand } from "../src/validation.js";
import { captureValidationSnapshot } from "../src/validation-acceptance.js";

const exec = promisify(execFile);
async function fixture(fn: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "scaler-acceptance-"));
  try {
    await exec("git", ["init"], { cwd: dir });
    await exec("git", ["config", "user.email", "test@example.com"], { cwd: dir });
    await exec("git", ["config", "user.name", "Test"], { cwd: dir });
    await writeFile(join(dir, "output.txt"), "before");
    await exec("git", ["add", "output.txt"], { cwd: dir });
    await exec("git", ["commit", "-m", "base"], { cwd: dir });
    await fn(dir);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

async function validated(dir: string, command = "node -e \"process.exit(0)\"") {
  const state = createDefaultState();
  state.stage = "execution";
  state.tasks = [{ id: "T-RECEIPT", title: "Output", status: "ready", allowedPathPrefixes: ["output.txt"], updatedAt: state.updatedAt }];
  await upsertValidationManifestCommand(dir, { taskId: "T-RECEIPT", id: "check", command });
  await runConductorStep(dir, state, { execute: true }, async (request) => {
    await writeFile(join(dir, "output.txt"), "candidate");
    return { taskId: request.taskId, exitCode: 0, stdoutEvents: [{ type: "scaler_task_report", taskId: request.taskId, ...request.attempt, status: "completed", summary: "done", changedFiles: ["output.txt"] }], stderr: "", timedOut: false, aborted: false };
  });
  const run = await runTaskValidation(dir, await loadState(dir), "T-RECEIPT");
  return { state: await loadState(dir), run };
}

for (const route of ["commit", "skip", "locked_commit", "locked_skip"] as const) {
  test(`${route} rejects changed candidate before Git or accepted skip publication`, async () => {
    await fixture(async (dir) => {
      const { state } = await validated(dir);
      const head = (await exec("git", ["rev-parse", "HEAD"], { cwd: dir })).stdout;
      await writeFile(join(dir, "output.txt"), "not the validated candidate");
      const result = route === "commit" ? await commitValidatedTask(dir, state, "T-RECEIPT", ["output.txt"])
        : route === "skip" ? await skipTaskCommit(dir, state, "T-RECEIPT", "leave uncommitted")
          : route === "locked_commit" ? await commitWithExecutionLock(dir, state, "T-RECEIPT", ["output.txt"])
            : await skipCommitWithExecutionLock(dir, state, "T-RECEIPT", "leave uncommitted");
      assert.equal(result.accepted, false);
      assert.match(result.message, /validation|evidence|receipt/i);
      assert.equal((await exec("git", ["rev-parse", "HEAD"], { cwd: dir })).stdout, head);
      assert.equal((await exec("git", ["diff", "--cached", "--name-only"], { cwd: dir })).stdout, "");
      assert.deepEqual(await loadCommitReports(dir), []);
      assert.deepEqual(await loadCommitSkips(dir), []);
      assert.equal((await loadState(dir)).tasks[0]?.status, "validating");
    });
  });
}

for (const change of ["task", "policy", "run", "attempt", "legacy", "result"] as const) {
  test(`commit refuses ${change} mismatch instead of trusting prior passed status`, async () => {
    await fixture(async (dir) => {
      const { state } = await validated(dir);
      if (change === "task") { state.tasks[0]!.title = "other task"; await saveState(dir, state); }
      if (change === "policy") await upsertValidationManifestCommand(dir, { taskId: "T-RECEIPT", id: "check", command: "false" });
      if (change === "run") state.runId = "replacement-run";
      if (change === "attempt") { state.tasks[0]!.attemptId = "replacement-attempt"; await saveState(dir, state); }
      if (change === "legacy" || change === "result") {
        const path = getValidationRunsPath(dir);
        const ledger = JSON.parse(await readFile(path, "utf8"));
        if (change === "legacy") delete ledger.runs[0].receipt;
        else ledger.runs[0].commandRuns = [];
        await writeFile(path, JSON.stringify(ledger));
      }
      const result = await commitValidatedTask(dir, state, "T-RECEIPT", ["output.txt"]);
      assert.equal(result.accepted, false);
      assert.deepEqual(await loadCommitReports(dir), []);
    });
  });
}

test("current validation receipt permits an unchanged candidate commit", async () => {
  await fixture(async (dir) => {
    const { state, run } = await validated(dir);
    assert.equal(run.status, "passed");
    const result = await commitWithExecutionLock(dir, state, "T-RECEIPT", ["output.txt"]);
    assert.equal(result.accepted, true, result.message);
    assert.equal((await loadState(dir)).tasks[0]?.status, "validated");
  });
});

test("current validation receipt permits an explicit unchanged candidate skip", async () => {
  await fixture(async (dir) => {
    const { state } = await validated(dir);
    const result = await skipCommitWithExecutionLock(dir, state, "T-RECEIPT", "Operator keeps validated output uncommitted");
    assert.equal(result.accepted, true, result.message);
    assert.equal((await loadState(dir)).tasks[0]?.status, "validated");
    assert.equal((await loadCommitSkips(dir)).length, 1);
  });
});

test("a persisted validated label without validation evidence is not commit authority", async () => {
  await fixture(async (dir) => {
    const state = createDefaultState();
    state.tasks = [{ id: "T-LABEL", status: "validated", allowedPathPrefixes: ["output.txt"], updatedAt: state.updatedAt }];
    await saveState(dir, state);
    await writeFile(join(dir, "output.txt"), "unvalidated output");
    const result = await commitValidatedTask(dir, state, "T-LABEL", ["output.txt"]);
    assert.equal(result.accepted, false);
    assert.match(result.message, /receipt/);
    assert.deepEqual(await loadCommitReports(dir), []);
  });
});

test("all-optional failures do not become positive commit evidence via rollup status", async () => {
  await fixture(async (dir) => {
    const state = createDefaultState();
    state.tasks = [{ id: "T-OPTIONAL", status: "validating", allowedPathPrefixes: ["output.txt"], updatedAt: state.updatedAt }];
    await saveState(dir, state);
    await writeFile(join(dir, "output.txt"), "unvalidated output");
    await upsertValidationManifestCommand(dir, { taskId: "T-OPTIONAL", id: "optional", command: "node -e \"process.exit(1)\"", required: false });
    const run = await runTaskValidation(dir, state, "T-OPTIONAL");
    assert.equal(run.status, "passed"); // Existing optional-check rollup is not authority.
    assert.equal(run.commandRuns[0]?.status, "failed");
    const result = await commitValidatedTask(dir, state, "T-OPTIONAL", ["output.txt"]);
    assert.equal(result.accepted, false);
    assert.match(result.message, /no current version-bound passing command evidence/);
  });
});

test("a command changing candidate output cannot certify its earlier snapshot", async () => {
  await fixture(async (dir) => {
    const { run } = await validated(dir, "node -e \"require('fs').writeFileSync('output.txt', 'changed by check')\"");
    assert.equal(run.status, "blocked");
    assert.equal(run.commandRuns[0]?.status, "passed");
    assert.equal(run.acceptance?.accepted, false);
  });
});

test("Git candidate fingerprints cover untracked bytes, deletion, mode and symlink target", async () => {
  await fixture(async (dir) => {
    const state = createDefaultState();
    state.tasks = [{ id: "T-FILES", status: "validating", updatedAt: state.updatedAt }];
    const capture = async () => (await captureValidationSnapshot(dir, state, "T-FILES")).gitCandidateFingerprint;
    const base = await capture();
    await writeFile(join(dir, "new file.bin"), Buffer.from([0, 255]));
    const untracked = await capture();
    assert.notEqual(untracked, base);
    await writeFile(join(dir, "new file.bin"), Buffer.from([0, 254]));
    assert.notEqual(await capture(), untracked);
    await unlink(join(dir, "new file.bin"));
    assert.equal(await capture(), base);
    await chmod(join(dir, "output.txt"), 0o755);
    assert.notEqual(await capture(), base);
    await chmod(join(dir, "output.txt"), 0o644);
    await unlink(join(dir, "output.txt"));
    const deleted = await capture();
    assert.notEqual(deleted, base);
    await symlink("missing-target", join(dir, "output.txt"));
    const linked = await capture();
    assert.notEqual(linked, deleted);
    await unlink(join(dir, "output.txt"));
    await symlink("other-target", join(dir, "output.txt"));
    assert.notEqual(await capture(), linked);
  });
});

test("nested project runtime records do not invalidate candidate output", async () => {
  await fixture(async (dir) => {
    const project = join(dir, "nested");
    await mkdir(join(project, ".scaler"), { recursive: true });
    const state = createDefaultState();
    state.tasks = [{ id: "T-NESTED", status: "validating", updatedAt: state.updatedAt }];
    const before = await captureValidationSnapshot(project, state, "T-NESTED");
    await writeFile(join(project, ".scaler", "runtime.json"), "{}");
    const after = await captureValidationSnapshot(project, state, "T-NESTED");
    assert.equal(after.gitCandidateFingerprint, before.gitCandidateFingerprint);
  });
});

test("Git rename and copy candidates cannot share a snapshot by hiding the deleted source", async () => {
  await fixture(async (dir) => {
    const state = createDefaultState();
    state.tasks = [{ id: "T-RENAME", status: "validating", updatedAt: state.updatedAt }];
    await exec("git", ["mv", "output.txt", "moved.txt"], { cwd: dir });
    const renamed = await captureValidationSnapshot(dir, state, "T-RENAME");
    await writeFile(join(dir, "output.txt"), "before");
    await exec("git", ["add", "output.txt"], { cwd: dir });
    const copied = await captureValidationSnapshot(dir, state, "T-RENAME");
    assert.notEqual(copied.gitCandidateFingerprint, renamed.gitCandidateFingerprint);
  });
});

test("candidate snapshot refuses symlink ancestors instead of reading their targets", async () => {
  await fixture(async (dir) => {
    await mkdir(join(dir, "data"));
    await writeFile(join(dir, "data", "input.txt"), "before");
    await exec("git", ["add", "data"], { cwd: dir });
    await exec("git", ["commit", "-m", "data"], { cwd: dir });
    await rm(join(dir, "data"), { recursive: true });
    await symlink("untrusted-target", join(dir, "data"));
    const state = createDefaultState();
    state.tasks = [{ id: "T-LINK", status: "validating", updatedAt: state.updatedAt }];
    await assert.rejects(captureValidationSnapshot(dir, state, "T-LINK"), /symlink ancestor/);
  });
});

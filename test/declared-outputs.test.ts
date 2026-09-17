/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import fsPromises from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { evaluateValidationGitAcceptance, loadCommitSkips } from "../src/git.js";
import { completeRunWithEvidence } from "../src/run-completion.js";
import { fingerprintDeclaredOutputs, normalizeOutputPaths } from "../src/output-artifacts.js";
import { captureValidationSnapshot } from "../src/validation-acceptance.js";
import { createDefaultState, loadState, saveState } from "../src/state.js";
import { registerScalerTools } from "../src/tools.js";
import { createTask, updateTask } from "../src/tasks.js";
import { getValidationManifestForTask, runTaskValidation, saveValidationManifest, type TaskValidationManifest } from "../src/validation.js";

const exec = promisify(execFile);
const check = 'node -e "if(require(\'fs\').readFileSync(\'result.txt\',\'utf8\')!==\'ok\')process.exit(1)"';

test("task command replacement preserves the rest of the validation policy", async () => fixture(false, async (dir) => {
  await createTask(dir, await loadState(dir), { id: "T-POLICY" });
  await saveValidationManifest(dir, { taskId: "T-POLICY", outputPaths: ["result.txt"],
    definitionOfDone: ["Original task-specific criterion"], acceptanceCriteria: ["Existing acceptance basis"],
    qualityWaivers: [{ code: "test_first", reason: "Document-only check", approvedBy: "fixture-supervisor" }],
    commands: [{ id: "old", required: true, command: check }], createdAt: "2026-01-01T00:00:00Z", updatedAt: "" });
  const before = await getValidationManifestForTask(dir, "T-POLICY");
  const result = await updateTask(dir, await loadState(dir), { id: "T-POLICY", validationCommands: [{ id: "new", command: check, required: true }] });
  assert.equal(result.accepted, true, result.message);
  const after = await getValidationManifestForTask(dir, "T-POLICY");
  assert.deepEqual(after.outputPaths, before.outputPaths);
  assert.deepEqual(after.definitionOfDone, before.definitionOfDone);
  assert.deepEqual(after.acceptanceCriteria, before.acceptanceCriteria);
  assert.deepEqual(after.qualityWaivers, before.qualityWaivers);
  assert.equal(after.createdAt, before.createdAt);
  assert.equal(after.commands[0]!.id, "new");
}));

for (const replacement of ["symlink", "file"] as const) {
  test(`declared hashing refuses a ${replacement} swap after lstat`, async (t) => fixture(false, async (dir) => {
    const target = join(dir, "result.txt");
    await writeFile(join(dir, "other.txt"), "different synthetic output");
    const original = fsPromises.lstat;
    let swapped = false;
    t.mock.method(fsPromises, "lstat", (async (path: string) => {
      const stat = await original(path);
      if (path === target && !swapped) {
        swapped = true;
        // Keep the old inode alive so regular-file replacement is deterministic.
        await fsPromises.rename(target, join(dir, "old-output.txt"));
        if (replacement === "symlink") await symlink("other.txt", target);
        else await writeFile(target, "replaced inode");
      }
      return stat;
    }) as typeof fsPromises.lstat);
    syncBuiltinESMExports();
    try {
      await assert.rejects(fingerprintDeclaredOutputs(dir, ["result.txt"]), /ELOOP|changed|replaced|symlink/i);
      assert.equal(swapped, true);
    } finally {
      t.mock.restoreAll();
      syncBuiltinESMExports();
    }
  }));
}

test("declared-output snapshot advertises schema version 2", async () => fixture(false, async (dir) => {
  assert.equal((await captureValidationSnapshot(dir, await loadState(dir), "T-OUT")).version, 2);
}));

test("version 1 receipt cannot be reused under declared-output snapshot semantics", async () => fixture(false, async (dir) => {
  const run = await runTaskValidation(dir, await loadState(dir), "T-OUT");
  assert.ok(run.receipt);
  (run.receipt.snapshot as { version: number }).version = 1;
  const skips = await loadCommitSkips(dir);
  const result = await evaluateValidationGitAcceptance(dir, await loadState(dir), "T-OUT", run);
  assert.equal(result.accepted, false, result.message);
  assert.deepEqual(await loadCommitSkips(dir), skips);
}));
async function fixture(git: boolean, fn: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "scaler-declared-output-"));
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
    state.tasks = [{ id: "T-OUT", status: "validating", updatedAt: state.updatedAt }];
    await saveState(dir, state);
    await manifest(dir, ["result.txt"]);
    await fn(dir);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

async function manifest(dir: string, outputPaths: string[], command = check) {
  return saveValidationManifest(dir, { taskId: "T-OUT", outputPaths,
    commands: [{ id: "check", required: true, command }], createdAt: "", updatedAt: "",
  } satisfies TaskValidationManifest);
}

for (const git of [false, true]) {
  for (const mutation of ["bytes", "mode", "delete", "symlink"] as const) {
    test(`${git ? "Git skip" : "non-Git"} completion refuses changed declared output: ${mutation}`, async () => fixture(git, async (dir) => {
      assert.equal((await runTaskValidation(dir, await loadState(dir), "T-OUT")).status, "passed");
      if (mutation === "bytes") await writeFile(join(dir, "result.txt"), "changed");
      if (mutation === "mode") await chmod(join(dir, "result.txt"), 0o755);
      if (mutation === "delete" || mutation === "symlink") await unlink(join(dir, "result.txt"));
      if (mutation === "symlink") await symlink("elsewhere", join(dir, "result.txt"));
      const before = await readFile(join(dir, ".scaler/state.json"), "utf8");
      const result = await completeRunWithEvidence(dir, await loadState(dir));
      assert.equal(result.accepted, false, result.message);
      assert.equal(await readFile(join(dir, ".scaler/state.json"), "utf8"), before);
    }));
  }
  test(`${git ? "Git skip" : "non-Git"} unchanged declared output supports completion and restart`, async () => fixture(git, async (dir) => {
    assert.equal((await runTaskValidation(dir, await loadState(dir), "T-OUT")).status, "passed");
    for (let i = 0; i < 2; i++) {
      const result = await completeRunWithEvidence(dir, await loadState(dir));
      assert.equal(result.accepted, true, result.message);
    }
  }));
}

test("direct non-Git skip refuses post-check declared output changes", async () => fixture(false, async (dir) => {
  const run = await runTaskValidation(dir, await loadState(dir), "T-OUT");
  const skips = await loadCommitSkips(dir);
  await writeFile(join(dir, "result.txt"), "changed");
  const result = await evaluateValidationGitAcceptance(dir, await loadState(dir), "T-OUT", run);
  assert.equal(result.accepted, false, result.message);
  assert.deepEqual(await loadCommitSkips(dir), skips);
}));

test("non-Git validation refuses output mutation during a successful command", async () => fixture(false, async (dir) => {
  await manifest(dir, ["result.txt"], 'node -e "require(\'fs\').writeFileSync(\'result.txt\',\'changed\')"');
  const run = await runTaskValidation(dir, await loadState(dir), "T-OUT");
  assert.equal(run.status, "blocked");
  assert.equal((await loadState(dir)).tasks[0]!.status, "validating");
  assert.equal((await loadCommitSkips(dir)).length, 0);
}));

test("changing the declared output set invalidates accepted policy", async () => fixture(false, async (dir) => {
  await runTaskValidation(dir, await loadState(dir), "T-OUT");
  await manifest(dir, []);
  assert.equal((await completeRunWithEvidence(dir, await loadState(dir))).accepted, false);
}));

test("declared deletion remains absent through acceptance and restart", async () => fixture(false, async (dir) => {
  await unlink(join(dir, "result.txt"));
  await manifest(dir, ["result.txt"], 'node -e "if(require(\'fs\').existsSync(\'result.txt\'))process.exit(1)"');
  assert.equal((await runTaskValidation(dir, await loadState(dir), "T-OUT")).status, "passed");
  assert.equal((await completeRunWithEvidence(dir, await loadState(dir))).accepted, true);
  await writeFile(join(dir, "result.txt"), "recreated");
  assert.equal((await completeRunWithEvidence(dir, await loadState(dir))).accepted, false);
}));

test("independent task outputs do not invalidate earlier task evidence", async () => fixture(false, async (dir) => {
  const initial = await loadState(dir);
  initial.tasks.push({ id: "T-TWO", status: "validating", updatedAt: initial.updatedAt });
  await saveState(dir, initial);
  await saveValidationManifest(dir, { taskId: "T-TWO", outputPaths: ["second.txt"],
    commands: [{ id: "second", required: true, command: check.replaceAll("result.txt", "second.txt") }], createdAt: "", updatedAt: "" });
  assert.equal((await runTaskValidation(dir, initial, "T-OUT")).status, "passed");
  await writeFile(join(dir, "second.txt"), "ok");
  assert.equal((await runTaskValidation(dir, await loadState(dir), "T-TWO")).status, "passed");
  const result = await completeRunWithEvidence(dir, await loadState(dir));
  assert.equal(result.accepted, true, result.message);
  await writeFile(join(dir, "result.txt"), "invalidated earlier output");
  assert.equal((await completeRunWithEvidence(dir, await loadState(dir))).accepted, false);
}));

test("declared symlink identity binds its target without following it", async () => fixture(false, async (dir) => {
  await unlink(join(dir, "result.txt"));
  await symlink("missing-target-a", join(dir, "result.txt"));
  const before = await fingerprintDeclaredOutputs(dir, ["result.txt"]);
  assert.equal(await fingerprintDeclaredOutputs(dir, ["result.txt"]), before);
  await unlink(join(dir, "result.txt"));
  await symlink("missing-target-b", join(dir, "result.txt"));
  assert.notEqual(await fingerprintDeclaredOutputs(dir, ["result.txt"]), before);
}));

test("unsafe declared paths and unsupported objects are refused", async () => fixture(false, async (dir) => {
  for (const path of ["", ".", "../outside", "/absolute", "C:\\outside", "C:outside", "a\\b", "a//b", "a/./b", "a/../b", "a\0b", "*.txt", "[ab].txt", ".scaler/state.json", "a/.git/config", ".GIT/config"]) {
    await assert.rejects(manifest(dir, [path]), /output path/i);
  }
  await mkdir(join(dir, "folder"));
  await assert.rejects(fingerprintDeclaredOutputs(dir, ["folder"]), /not a file/i);
  await symlink("folder", join(dir, "linked"));
  await assert.rejects(fingerprintDeclaredOutputs(dir, ["linked/missing.txt"]), /ancestor/i);
  assert.deepEqual(normalizeOutputPaths(["b.txt", "a.txt", "b.txt"]), ["a.txt", "b.txt"]);
  assert.equal(await fingerprintDeclaredOutputs(dir, undefined), null);
  assert.notEqual(await fingerprintDeclaredOutputs(dir, []), null);
}));

test("public manifest tool retains declared output identity through acceptance", async () => fixture(false, async (dir) => {
  const registered = new Map<string, { execute: (...args: any[]) => Promise<unknown> }>();
  registerScalerTools({ registerTool(definition: { name: string; execute: (...args: any[]) => Promise<unknown> }) {
    registered.set(definition.name, definition);
  } } as never);
  const tool = registered.get("scaler_validation_manifest_write");
  assert.ok(tool);
  await tool.execute("manifest", { taskId: "T-OUT", outputPaths: ["result.txt"], commands: [{ id: "check", command: check }] }, undefined, undefined, { cwd: dir });
  assert.deepEqual((await getValidationManifestForTask(dir, "T-OUT")).outputPaths, ["result.txt"]);
  assert.equal((await runTaskValidation(dir, await loadState(dir), "T-OUT")).status, "passed");
  await writeFile(join(dir, "result.txt"), "changed after validation");
  assert.equal((await completeRunWithEvidence(dir, await loadState(dir))).accepted, false);
}));

for (const git of [false, true]) {
  for (const stage of ["execution", "completed"] as const) {
    test(`${git ? "Git skip" : "non-Git"} ${stage} cannot complete with unknown output coverage`, async () => fixture(git, async (dir) => {
      const policy = await getValidationManifestForTask(dir, "T-OUT");
      delete policy.outputPaths;
      await saveValidationManifest(dir, policy);
      assert.equal((await runTaskValidation(dir, await loadState(dir), "T-OUT")).status, "passed");
      const current = await loadState(dir);
      current.stage = stage;
      await saveState(dir, current);
      const before = await readFile(join(dir, ".scaler/state.json"), "utf8");
      const result = await completeRunWithEvidence(dir, current);
      assert.equal(result.accepted, false, result.message);
      assert.match(result.message, /declare.*outputPaths.*revalidat/i);
      assert.equal(await readFile(join(dir, ".scaler/state.json"), "utf8"), before);
    }));
  }
}

test("explicit no-filesystem-output policy can complete independently checked work", async () => fixture(false, async (dir) => {
  await unlink(join(dir, "result.txt"));
  await manifest(dir, [], 'node -e "if(2+2!==4)process.exit(1)"');
  assert.equal((await runTaskValidation(dir, await loadState(dir), "T-OUT")).status, "passed");
  const result = await completeRunWithEvidence(dir, await loadState(dir));
  assert.equal(result.accepted, true, result.message);
}));

test("large declared files bind all bytes with bounded streaming reads", async () => fixture(false, async (dir) => {
  const bytes = Buffer.alloc(4 * 1024 * 1024, 0x61);
  await writeFile(join(dir, "result.txt"), bytes);
  const before = await fingerprintDeclaredOutputs(dir, ["result.txt"]);
  bytes[bytes.length - 1] = 0x62;
  await writeFile(join(dir, "result.txt"), bytes);
  assert.notEqual(await fingerprintDeclaredOutputs(dir, ["result.txt"]), before);
}));

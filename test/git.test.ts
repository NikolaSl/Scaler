import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { assessGitStatusSafety } from "../src/git.js";

const execFileAsync = promisify(execFile);

async function withGitRepo<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-git-test-"));
  try {
    await execFileAsync("git", ["init"], { cwd: dir });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
    await execFileAsync("git", ["config", "user.name", "Test User"], { cwd: dir });
    await writeFile(join(dir, "README.md"), "initial\n", "utf8");
    await execFileAsync("git", ["add", "README.md"], { cwd: dir });
    await execFileAsync("git", ["commit", "-m", "initial"], { cwd: dir });
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("assessGitStatusSafety detects clean working tree", async () => {
  await withGitRepo(async (dir) => {
    const decision = await assessGitStatusSafety(dir);

    assert.equal(decision.status, "clean");
    assert.equal(decision.clean, true);
  });
});

test("assessGitStatusSafety detects runtime-only scaler changes", async () => {
  await withGitRepo(async (dir) => {
    await mkdir(join(dir, ".scaler"), { recursive: true });
    await writeFile(join(dir, ".scaler", "state.json"), "{}\n", "utf8");

    const decision = await assessGitStatusSafety(dir);

    assert.equal(decision.status, "runtime_only");
    assert.deepEqual(decision.runtimePaths, [".scaler/"]);
  });
});

test("assessGitStatusSafety detects allowed task paths", async () => {
  await withGitRepo(async (dir) => {
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src", "feature.ts"), "export {};\n", "utf8");

    const decision = await assessGitStatusSafety(dir, ["src"]);

    assert.equal(decision.status, "allowed");
    assert.deepEqual(decision.allowedPaths, ["src/"]);
  });
});

test("assessGitStatusSafety detects unrelated user changes", async () => {
  await withGitRepo(async (dir) => {
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src", "feature.ts"), "export {};\n", "utf8");
    await writeFile(join(dir, "notes.txt"), "user notes\n", "utf8");

    const decision = await assessGitStatusSafety(dir, ["src"]);

    assert.equal(decision.status, "unrelated");
    assert.deepEqual(decision.unrelatedPaths, ["notes.txt"]);
  });
});

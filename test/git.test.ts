import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { assessGitStatusSafety, commitValidatedTask, ensureGitRepository, evaluateValidationGitAcceptance, formatCommitReports, formatCommitSkips, formatGitBootstrapRecords, loadCommitReports, loadCommitSkips, loadGitBootstrapRecords, skipTaskCommit } from "../src/git.js";
import { createDefaultState, loadState, saveState } from "../src/state.js";
import { runTaskValidation, upsertValidationManifestCommand } from "../src/validation.js";

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
    assert.deepEqual(decision.runtimePaths, [".scaler/state.json"]);
  });
});

test("assessGitStatusSafety detects allowed task paths", async () => {
  await withGitRepo(async (dir) => {
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src", "feature.ts"), "export {};\n", "utf8");

    const decision = await assessGitStatusSafety(dir, ["src"]);

    assert.equal(decision.status, "allowed");
    assert.deepEqual(decision.allowedPaths, ["src/feature.ts"]);
    const exactDecision = await assessGitStatusSafety(dir, ["src/feature.ts"]);
    assert.equal(exactDecision.status, "allowed");
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

test("commitValidatedTask refuses unrelated changes", async () => {
  await withGitRepo(async (dir) => {
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src", "feature.ts"), "export {};\n", "utf8");
    await writeFile(join(dir, "notes.txt"), "user notes\n", "utf8");
    const state = createDefaultState();
    state.tasks = [{ id: "T-001", title: "Feature", status: "validated", updatedAt: state.createdAt }];

    const result = await commitValidatedTask(dir, state, "T-001", ["src"]);

    assert.equal(result.accepted, false);
    assert.match(result.message, /unrelated/i);
  });
});

test("commitValidatedTask commits allowed validated task changes and excludes scaler runtime", async () => {
  await withGitRepo(async (dir) => {
    await mkdir(join(dir, "src"), { recursive: true });
    await mkdir(join(dir, ".scaler"), { recursive: true });
    await writeFile(join(dir, "src", "feature.ts"), "export const value = 1;\n", "utf8");
    await writeFile(join(dir, ".scaler", "state.json"), "{}\n", "utf8");
    const state = createDefaultState();
    state.tasks = [{ id: "T-001", title: "Add feature", status: "validating", allowedPathPrefixes: ["src"], updatedAt: state.createdAt }];
    await saveState(dir, state);
    await upsertValidationManifestCommand(dir, { taskId: "T-001", id: "test", command: "node -e \"process.exit(0)\"", required: true });
    const validation = await runTaskValidation(dir, state, "T-001");
    const validatedState = await loadState(dir);
    assert.equal(validation.acceptance?.accepted, false);
    assert.equal(validation.acceptance?.git?.status, "commit_required");

    const result = await commitValidatedTask(dir, validatedState, "T-001", ["src"]);
    const { stdout: message } = await execFileAsync("git", ["log", "-1", "--pretty=%s"], { cwd: dir });
    const { stdout: showFiles } = await execFileAsync("git", ["show", "--name-only", "--pretty=", "HEAD"], { cwd: dir });

    assert.equal(result.accepted, true);
    assert.equal(message.trim(), "T-001: Add feature");
    assert.match(showFiles, /src\/feature.ts/);
    assert.doesNotMatch(showFiles, /.scaler\/state.json/);
    assert.equal(result.report?.taskId, "T-001");
    assert.equal(result.report?.validation.status, "passed");
    assert.equal(result.report?.validation.commandCount, 1);
    const reports = await loadCommitReports(dir);
    assert.equal(reports[0]?.commitHash, result.commitHash);
    assert.match(formatCommitReports(reports), /T-001/);
  });
});

test("ensureGitRepository initializes repo and writes SCALER exclude rules without dirty project files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scaler-git-bootstrap-test-"));
  try {
    const record = await ensureGitRepository(dir, { now: new Date("2026-01-01T00:00:00.000Z") });
    const records = await loadGitBootstrapRecords(dir);
    const exclude = await readFile(join(dir, ".git/info/exclude"), "utf8");
    const safety = await assessGitStatusSafety(dir);

    assert.equal(record.status, "initialized");
    assert.equal(record.gitignoreUpdated, true);
    assert.match(exclude, /.scaler\/logs\//);
    assert.equal(records[0]?.id, record.id);
    assert.match(formatGitBootstrapRecords(records), /initialized/);
    assert.equal(safety.status, "runtime_only");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("validation git acceptance records auto skip for clean task and explicit skip for allowed changes", async () => {
  await withGitRepo(async (dir) => {
    const cleanState = createDefaultState();
    cleanState.tasks = [{ id: "T-CLEAN", title: "Clean task", status: "validating", allowedPathPrefixes: ["src"], updatedAt: cleanState.createdAt }];
    const cleanDecision = await evaluateValidationGitAcceptance(dir, cleanState, "T-CLEAN", { runId: "run-clean", status: "passed", commandCount: 1, failedCommandIds: [] });
    assert.equal(cleanDecision.accepted, true);
    assert.equal(cleanDecision.status, "commit_skipped");
    assert.equal((await loadCommitSkips(dir))[0]?.taskId, "T-CLEAN");

    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src", "skip.ts"), "export const skip = true;\n", "utf8");
    const state = createDefaultState();
    state.tasks = [{ id: "T-SKIP", title: "Skip task", status: "validating", allowedPathPrefixes: ["src"], updatedAt: state.createdAt }];
    await upsertValidationManifestCommand(dir, { taskId: "T-SKIP", id: "test", command: "node -e \"process.exit(0)\"", required: true });
    await runTaskValidation(dir, state, "T-SKIP");

    const result = await skipTaskCommit(dir, state, "T-SKIP", "No commit wanted for generated scratch output.");
    assert.equal(result.accepted, true);
    const skips = await loadCommitSkips(dir);
    assert.equal(skips[0]?.taskId, "T-SKIP");
    assert.match(formatCommitSkips(skips), /No commit wanted/);
  });
});

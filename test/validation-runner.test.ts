import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createDefaultState, loadState, saveState } from "../src/state.js";
import { loadValidationRuns, runTaskValidation, runValidationCommand, saveValidationManifest } from "../src/validation.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-validation-runner-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("runValidationCommand captures passing command", async () => {
  await withTempDir(async (dir) => {
    const result = await runValidationCommand(dir, {
      id: "ok",
      command: "node -e \"console.log('ok')\"",
      required: true,
      gate: "unit_tests",
      expectedResult: "prints ok",
      evidenceRefs: ["manifest:ok"],
    });

    assert.equal(result.status, "passed");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdoutSummary, "ok");
    assert.equal(result.required, true);
    assert.equal(result.gate, "unit_tests");
    assert.equal(result.expectedResult, "prints ok");
    assert.deepEqual(result.evidenceRefs, ["manifest:ok"]);
  });
});

test("runTaskValidation records policy warnings without blocking default implementation gates", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState();
    state.tasks = [{ id: "T-001", status: "validating", updatedAt: state.createdAt }];
    await saveState(dir, state);
    await saveValidationManifest(dir, {
      taskId: "T-001",
      commands: [{ id: "ok", command: "node -e \"process.exit(0)\"", required: true, gate: "unit_tests" }],
      createdAt: "",
      updatedAt: "",
    });

    const run = await runTaskValidation(dir, state, "T-001");

    assert.equal(run.status, "passed");
    assert.deepEqual(run.policyDiagnostics?.map((diagnostic) => diagnostic.code), ["missing_dependency_check", "missing_test_first"]);
    assert.equal((await loadState(dir)).tasks[0]?.status, "validated");
  });
});

test("runTaskValidation fails manifest policy before executing blocked commands", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState();
    state.tasks = [{ id: "T-001", status: "validating", updatedAt: state.createdAt }];
    await saveState(dir, state);
    await saveValidationManifest(dir, {
      taskId: "T-001",
      commands: [
        { id: "expensive", command: "node -e \"require('node:fs').writeFileSync('should-not-exist.txt','ran')\"", required: true, gate: "unit_tests" },
        { id: "deps", command: "node -e \"process.exit(0)\"", required: true, gate: "dependency_check" },
      ],
      createdAt: "",
      updatedAt: "",
    });

    const run = await runTaskValidation(dir, state, "T-001");
    const persisted = await loadState(dir);
    const runs = await loadValidationRuns(dir);

    assert.equal(run.status, "failed");
    assert.deepEqual(run.policyDiagnostics?.map((diagnostic) => diagnostic.code), ["missing_test_first", "dependency_check_order"]);
    assert.equal(run.commandRuns.length, 1);
    assert.equal(run.commandRuns[0]?.command, "SCALER validation manifest policy preflight");
    assert.equal(run.commandRuns[0]?.stdoutSummary.includes("dependency_check command deps"), true);
    assert.equal(persisted.tasks[0]?.status, "debugging");
    assert.equal(runs[0]?.policyDiagnostics?.some((diagnostic) => diagnostic.code === "dependency_check_order"), true);
    await assert.rejects(readFile(join(dir, "should-not-exist.txt"), "utf8"));
  });
});

test("runTaskValidation validates task when all required commands pass", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState();
    state.tasks = [{ id: "T-001", status: "validating", updatedAt: state.createdAt }];
    await saveState(dir, state);
    await saveValidationManifest(dir, {
      taskId: "T-001",
      commands: [{ id: "ok", command: "node -e \"process.exit(0)\"", required: true, gate: "build_compile", expectedResult: "build exits 0", environment: "host" }],
      createdAt: "",
      updatedAt: "",
    });

    const run = await runTaskValidation(dir, state, "T-001");
    const persisted = await loadState(dir);
    const runs = await loadValidationRuns(dir);

    assert.equal(run.status, "passed");
    assert.equal(persisted.tasks[0]?.status, "validated");
    assert.equal(runs[0]?.taskId, "T-001");
    assert.equal(runs[0]?.commandRuns[0]?.gate, "build_compile");
    assert.equal(runs[0]?.commandRuns[0]?.expectedResult, "build exits 0");
    assert.equal(runs[0]?.commandRuns[0]?.environment, "host");
  });
});

test("runTaskValidation moves validating task to debugging when required command fails", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState();
    state.tasks = [{ id: "T-001", status: "validating", updatedAt: state.createdAt }];
    await saveState(dir, state);
    await saveValidationManifest(dir, {
      taskId: "T-001",
      commands: [{ id: "fail", command: "node -e \"process.exit(2)\"", required: true }],
      createdAt: "",
      updatedAt: "",
    });

    const run = await runTaskValidation(dir, state, "T-001");
    const persisted = await loadState(dir);

    assert.equal(run.status, "failed");
    assert.equal(run.commandRuns[0]?.exitCode, 2);
    assert.equal(persisted.tasks[0]?.status, "debugging");
  });
});

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
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

test("runTaskValidation validates task when all required commands pass", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState();
    state.tasks = [{ id: "T-001", status: "validating", updatedAt: state.createdAt }];
    await saveState(dir, state);
    await saveValidationManifest(dir, {
      taskId: "T-001",
      commands: [{ id: "ok", command: "node -e \"process.exit(0)\"", required: true, gate: "build_compile", expectedResult: "build exits 0" }],
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

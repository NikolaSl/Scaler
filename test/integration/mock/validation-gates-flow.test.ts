/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { loadCicdEnvironmentRecords } from "../../../src/cicd-environments.js";
import scalerExtension from "../../../src/index.js";
import { readLogEvents } from "../../../src/logging.js";
import { runValidationWithExecutionLock } from "../../../src/operations.js";
import { createDefaultState, loadState, saveState } from "../../../src/state.js";
import { loadValidationEnvironmentRecords } from "../../../src/validation-environments.js";
import { loadValidationChecklists, loadValidationManifests, loadValidationRuns } from "../../../src/validation.js";

const execFileAsync = promisify(execFile);

type CommandHandler = (args: string | undefined, ctx: { cwd: string; hasUI: boolean }) => Promise<void>;

async function withTempRepo<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-validation-gates-integration-test-"));
  try {
    await execFileAsync("git", ["init"], { cwd: dir });
    await execFileAsync("git", ["config", "user.email", "scaler-test@example.invalid"], { cwd: dir });
    await execFileAsync("git", ["config", "user.name", "Scaler Test"], { cwd: dir });
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "package.json"), JSON.stringify({ type: "module" }, null, 2));
    await writeFile(join(dir, "src/app.js"), "export const value = 1;\n");
    await execFileAsync("git", ["add", "package.json", "src/app.js"], { cwd: dir });
    await execFileAsync("git", ["commit", "-m", "initial fixture"], { cwd: dir });
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function registeredCommands(): Map<string, { handler: CommandHandler }> {
  const commands = new Map<string, { handler: CommandHandler }>();
  const fakePi = {
    on() {},
    registerTool() {},
    registerCommand(name: string, command: { handler: CommandHandler }) {
      commands.set(name, command);
    },
  };
  scalerExtension(fakePi as never);
  return commands;
}

test("mock integration: non-software checklist failure then pass updates task state and audit", async () => {
  await withTempRepo(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    state.stage = "execution";
    state.currentTaskId = "T-CHECKLIST";
    state.tasks = [{
      id: "T-CHECKLIST",
      status: "validating",
      title: "Checklist task",
      allowedPathPrefixes: ["src/app.js"],
      prdRefs: ["REQ-CHECKLIST"],
      updatedAt: state.createdAt,
    }];
    await saveState(dir, state);

    const commands = registeredCommands();
    await commands.get("scaler-validation-checklist")?.handler(
      "T-CHECKLIST | completeness | Checklist incomplete | scope::passed::required::Scope covered::evidence:scope;edge::failed::required::Edge cases documented::evidence:edge | evidence:root",
      { cwd: dir, hasUI: false },
    );

    const failedChecklist = (await loadValidationChecklists(dir))[0];
    assert.equal(failedChecklist?.status, "failed");
    assert.equal(failedChecklist?.gate, "completeness");
    assert.equal((await loadState(dir)).tasks[0]?.status, "debugging");

    await commands.get("scaler-validation-checklist")?.handler(
      "T-CHECKLIST | source_validation | Sources verified | source::passed::required::Primary source cited::source:primary;optional::not_applicable::optional::Second source not needed:: | evidence:source",
      { cwd: dir, hasUI: false },
    );

    const checklists = await loadValidationChecklists(dir);
    assert.equal(checklists[0]?.status, "passed");
    assert.equal(checklists[0]?.gate, "source_validation");
    assert.equal((await loadState(dir)).tasks[0]?.status, "validated");

    const events = await readLogEvents(dir);
    assert.ok(events.some((event) => event.eventType === "validation" && event.summary === "Validation summary: T-CHECKLIST failed"));
    assert.ok(events.some((event) => event.eventType === "validation" && event.summary === "Validation summary: T-CHECKLIST passed"));
  });
});

test("mock integration: evidence-required checklist fails without evidence then passes with evidence", async () => {
  await withTempRepo(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    state.stage = "execution";
    state.currentTaskId = "T-EVIDENCE";
    state.tasks = [{ id: "T-EVIDENCE", status: "validating", title: "Evidence task", updatedAt: state.createdAt }];
    await saveState(dir, state);

    const commands = registeredCommands();
    await commands.get("scaler-validation-checklist")?.handler(
      "T-EVIDENCE | acceptance | Missing evidence | acceptance::passed::required::Acceptance behavior demonstrated:: |",
      { cwd: dir, hasUI: false },
    );

    let checklists = await loadValidationChecklists(dir);
    assert.equal(checklists[0]?.status, "failed");
    assert.deepEqual(checklists[0]?.evidencePolicy?.missingEvidenceItemIds, ["acceptance"]);
    assert.equal((await loadState(dir)).tasks[0]?.status, "debugging");

    await commands.get("scaler-validation-checklist")?.handler(
      "T-EVIDENCE | acceptance | Evidence present | acceptance::passed::required::Acceptance behavior demonstrated::evidence:acceptance |",
      { cwd: dir, hasUI: false },
    );

    checklists = await loadValidationChecklists(dir);
    assert.equal(checklists[0]?.status, "passed");
    assert.deepEqual(checklists[0]?.evidencePolicy?.missingEvidenceItemIds, []);
    assert.equal((await loadState(dir)).tasks[0]?.status, "validated");
  });
});

test("mock integration: validation gate policy blocks misordered dependency checks before command execution", async () => {
  await withTempRepo(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    state.stage = "execution";
    state.currentTaskId = "T-POLICY";
    state.tasks = [{ id: "T-POLICY", status: "validating", title: "Policy task", updatedAt: state.createdAt }];
    await saveState(dir, state);

    const commands = registeredCommands();
    await commands.get("scaler-validation-add")?.handler(
      "T-POLICY | deps | node -e \"process.exit(0)\" | Check dependencies | required | dependency | dependencies verified | manifest:deps",
      { cwd: dir, hasUI: false },
    );
    await commands.get("scaler-validation-add")?.handler(
      "T-POLICY | expensive | node -e \"require('node:fs').writeFileSync('policy-should-not-run.txt','ran')\" | Expensive validation | required | unit | unit exits 0 | manifest:unit",
      { cwd: dir, hasUI: false },
    );

    await commands.get("scaler-validate")?.handler("T-POLICY", { cwd: dir, hasUI: false });

    const runs = await loadValidationRuns(dir);
    assert.equal(runs[0]?.status, "failed");
    assert.deepEqual(runs[0]?.policyDiagnostics?.map((diagnostic) => diagnostic.code), ["missing_test_first", "dependency_check_order"]);
    assert.equal(runs[0]?.commandRuns[0]?.command, "SCALER validation manifest policy preflight");
    assert.equal((await loadState(dir)).tasks[0]?.status, "debugging");
    await assert.rejects(readFile(join(dir, "policy-should-not-run.txt"), "utf8"));
  });
});

test("mock integration: validation environment policy blocks local-ci host execution", async () => {
  await withTempRepo(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    state.stage = "execution";
    state.currentTaskId = "T-ENV";
    state.tasks = [{ id: "T-ENV", status: "validating", title: "Environment task", updatedAt: state.createdAt }];
    await saveState(dir, state);

    const commands = registeredCommands();
    await commands.get("scaler-validation-add")?.handler(
      "T-ENV | ci | node -e \"require('node:fs').writeFileSync('env-should-not-run.txt','ran')\" | Local CI validation | required | local_ci | local CI exits 0 | manifest:ci",
      { cwd: dir, hasUI: false },
    );

    await commands.get("scaler-validate")?.handler("T-ENV", { cwd: dir, hasUI: false });

    const runs = await loadValidationRuns(dir);
    assert.equal(runs[0]?.status, "failed");
    assert.equal(runs[0]?.policyDiagnostics?.some((diagnostic) => diagnostic.code === "local_ci_requires_environment"), true);
    assert.equal(runs[0]?.commandRuns[0]?.command, "SCALER validation manifest policy preflight");
    assert.equal((await loadState(dir)).tasks[0]?.status, "debugging");
    await assert.rejects(readFile(join(dir, "env-should-not-run.txt"), "utf8"));
  });
});

test("mock integration: validation records local-CI lifecycle evidence and status command", async () => {
  await withTempRepo(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    state.stage = "execution";
    state.currentTaskId = "T-LIFECYCLE";
    state.tasks = [{ id: "T-LIFECYCLE", status: "validating", title: "Lifecycle task", updatedAt: state.createdAt }];
    await saveState(dir, state);

    const commands = registeredCommands();
    await commands.get("scaler-validation-add")?.handler(
      "T-LIFECYCLE | ci | node -e \"const fs=require('node:fs');fs.mkdirSync('.scaler/artifacts',{recursive:true});fs.writeFileSync('.scaler/artifacts/lifecycle-ran.txt','ok')\" | Local CI validation | required | local_ci | local CI exits 0 | manifest:ci | local_ci",
      { cwd: dir, hasUI: false },
    );

    await commands.get("scaler-validate")?.handler("T-LIFECYCLE", { cwd: dir, hasUI: false });
    await commands.get("scaler-validation-envs")?.handler(undefined, { cwd: dir, hasUI: false });

    const runs = await loadValidationRuns(dir);
    const lifecycle = await loadValidationEnvironmentRecords(dir);
    assert.equal(runs[0]?.status, "passed");
    assert.equal(runs[0]?.commandRuns[0]?.environment, "local_ci");
    assert.ok(runs[0]?.commandRuns[0]?.cicdProvisionRef);
    assert.match(runs[0]?.commandRuns[0]?.executionCommand ?? "", /run-local-ci\.sh/);
    assert.equal(runs[0]?.commandRuns[0]?.environmentLifecycleRefs?.length, 2);
    assert.deepEqual(lifecycle.map((record) => record.phase), ["cleanup", "prepare"]);
    assert.deepEqual(lifecycle.map((record) => record.status), ["cleanup_completed", "prepared"]);
    assert.equal(await readFile(join(dir, ".scaler/artifacts/lifecycle-ran.txt"), "utf8"), "ok");
    assert.equal((await loadState(dir)).tasks[0]?.status, "validated");
  });
});

test("mock integration: CI/CD provision command generates wrapper records and validation uses them", async () => {
  await withTempRepo(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    state.stage = "execution";
    state.currentTaskId = "T-CICD";
    state.tasks = [{ id: "T-CICD", status: "validating", title: "CI/CD task", updatedAt: state.createdAt }];
    await saveState(dir, state);

    const commands = registeredCommands();
    await commands.get("scaler-cicd-env")?.handler(
      "local_ci | node -e \"process.exit(0)\" | T-CICD | ci | node | execute scan=off",
      { cwd: dir, hasUI: false },
    );
    await commands.get("scaler-validation-add")?.handler(
      "T-CICD | ci | node -e \"require('node:fs').writeFileSync('.scaler/cicd/artifacts/cicd-wrapper-ran.txt','ok')\" | Local CI validation | required | local_ci | local CI exits 0 | manifest:ci | local_ci",
      { cwd: dir, hasUI: false },
    );
    await commands.get("scaler-validate")?.handler("T-CICD", { cwd: dir, hasUI: false });
    await commands.get("scaler-cicd-envs")?.handler(undefined, { cwd: dir, hasUI: false });

    const records = await loadCicdEnvironmentRecords(dir);
    const runs = await loadValidationRuns(dir);
    assert.equal(records.some((record) => record.status === "generated" && record.environment === "local_ci"), true);
    assert.ok(runs[0]?.commandRuns[0]?.cicdProvisionRef);
    assert.equal(runs[0]?.status, "passed");
    assert.equal(await readFile(join(dir, ".scaler/cicd/artifacts/cicd-wrapper-ran.txt"), "utf8"), "ok");
  });
});

test("mock integration: validation dispositions skip with reason and block with reason", async () => {
  await withTempRepo(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    state.stage = "execution";
    state.currentTaskId = "T-SKIP";
    state.tasks = [
      { id: "T-SKIP", status: "validating", title: "Skip task", updatedAt: state.createdAt },
      { id: "T-BLOCK", status: "validating", title: "Block task", updatedAt: state.createdAt },
    ];
    await saveState(dir, state);

    const commands = registeredCommands();
    await commands.get("scaler-validation-add")?.handler(
      "T-SKIP | integration | node -e \"require('node:fs').writeFileSync('skip-disposition-should-not-run.txt','ran')\" | Integration tests | required | integration | exits 0 | manifest:skip | host | skipped:No integration surface changed",
      { cwd: dir, hasUI: false },
    );
    await commands.get("scaler-validate")?.handler("T-SKIP", { cwd: dir, hasUI: false });

    let runs = await loadValidationRuns(dir);
    assert.equal(runs[0]?.status, "passed");
    assert.equal(runs[0]?.commandRuns[0]?.status, "skipped");
    assert.equal((await loadState(dir)).tasks.find((task) => task.id === "T-SKIP")?.status, "validated");
    await assert.rejects(readFile(join(dir, "skip-disposition-should-not-run.txt"), "utf8"));

    await commands.get("scaler-validation-add")?.handler(
      "T-BLOCK | ci | node -e \"process.exit(0)\" | Local CI | required | local_ci | exits 0 | manifest:block | local_ci | blocked:Docker daemon unavailable",
      { cwd: dir, hasUI: false },
    );
    await commands.get("scaler-validate")?.handler("T-BLOCK", { cwd: dir, hasUI: false });

    runs = await loadValidationRuns(dir);
    assert.equal(runs[0]?.status, "blocked");
    assert.equal(runs[0]?.commandRuns[0]?.status, "blocked");
    const persisted = await loadState(dir);
    assert.equal(persisted.tasks.find((task) => task.id === "T-BLOCK")?.status, "blocked");
    assert.equal(persisted.stage, "replanning");
  });
});

test("mock integration: validation-add gate metadata persists through validation run and audit", async () => {
  await withTempRepo(async (dir) => {
    const commands = registeredCommands();
    await commands.get("scaler-validation-add")?.handler(
      "T-GATE | unit | node -e \"process.exit(0)\" | Unit validation | required | unit | process exits 0 | evidence:unit",
      { cwd: dir, hasUI: false },
    );

    const manifest = (await loadValidationManifests(dir))[0];
    assert.equal(manifest?.commands[0]?.gate, "unit_tests");
    assert.equal(manifest?.commands[0]?.expectedResult, "process exits 0");
    assert.deepEqual(manifest?.commands[0]?.evidenceRefs, ["evidence:unit"]);

    const state = await loadState(dir);
    state.stage = "execution";
    state.currentTaskId = "T-GATE";
    state.tasks = [{
      id: "T-GATE",
      status: "validating",
      title: "Typed validation gate task",
      allowedPathPrefixes: ["src/app.js"],
      prdRefs: ["REQ-VALIDATION-GATES"],
      updatedAt: state.createdAt,
    }];
    await saveState(dir, state);

    const result = await runValidationWithExecutionLock(dir, state, "T-GATE");

    assert.equal(result.accepted, true);
    assert.equal(result.result?.status, "passed");
    assert.equal((await loadState(dir)).tasks[0]?.status, "validated");
    const run = (await loadValidationRuns(dir))[0];
    assert.equal(run?.commandRuns[0]?.gate, "unit_tests");
    assert.equal(run?.commandRuns[0]?.required, true);
    assert.equal(run?.commandRuns[0]?.expectedResult, "process exits 0");
    assert.deepEqual(run?.commandRuns[0]?.evidenceRefs, ["evidence:unit"]);

    const validationSummary = (await readLogEvents(dir)).find((event) => event.eventType === "validation" && event.summary === "Validation summary: T-GATE passed");
    assert.ok(validationSummary, "expected validation summary audit event");
    assert.deepEqual((validationSummary.details as { gates?: unknown }).gates, [{ commandId: "unit", gate: "unit_tests", required: true, status: "passed", disposition: "run" }]);
  });
});

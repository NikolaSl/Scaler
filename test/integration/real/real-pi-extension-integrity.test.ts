import assert from "node:assert/strict";
import { mkdir, readFile, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { getBudgetState } from "../../../src/budgets.js";
import { loadDebugRetries, recordDebugReport } from "../../../src/debug.js";
import { readLogEvents } from "../../../src/logging.js";
import { loadSafetyPolicy } from "../../../src/safety.js";
import { createDefaultState, loadState, saveState } from "../../../src/state.js";
import { loadStorageInventory, loadStorageMaintenanceReport, loadStorageMaintenanceSchedule } from "../../../src/storage.js";
import { loadToolRequests, loadToolResults, loadToolSchemaDiscoveryRuns, loadToolSchemaRecords, loadToolTransactions, prepareToolRequest, runToolRequestAgent } from "../../../src/tool-requests.js";
import { loadValidationEnvironmentRecords } from "../../../src/validation-environments.js";
import { loadValidationChecklists, loadValidationManifests, loadValidationRuns, runTaskValidation, saveValidationManifest, upsertValidationManifestCommand } from "../../../src/validation.js";
import { REAL_PI_ENABLED, REAL_PI_MODEL, runScalerPi, withRealPiTempRepo } from "./real-pi-harness.js";

test("real Pi extension: slash command dispatch writes SCALER command audit logs", { skip: !REAL_PI_ENABLED }, async () => {
  await withRealPiTempRepo(async (dir) => {
    const result = await runScalerPi({
      cwd: dir,
      prompt: "/scaler-lock",
    });

    assert.equal(result.exitCode, 0, result.stderr || result.stdout);
    assert.match(`${result.stdout}\n${result.stderr}`, /No execution lock\./);
    assert.ok(result.events.some((event) => isRecord(event) && event.type === "session"), "expected Pi JSON session event");

    const state = await loadState(dir);
    assert.equal(state.stage, "idle");

    const events = await readLogEvents(dir);
    const commandEvents = events.filter((event) => event.eventType === "command" && isRecord(event.details) && event.details.command === "scaler-lock");
    assert.deepEqual(commandEvents.map((event) => (event.details as { phase: string }).phase), ["start", "end"]);
    assert.equal(commandEvents.every((event) => Boolean(event.detailsPath)), true);
    assert.match(commandEvents[0]?.summary ?? "", /Command start: scaler-lock/);
    assert.match(commandEvents[1]?.summary ?? "", /Command end: scaler-lock/);
  });
});

test("real Pi extension: records provider usage budgets from turn metadata", { skip: !REAL_PI_ENABLED }, async () => {
  await withRealPiTempRepo(async (dir) => {
    const result = await runScalerPi({
      cwd: dir,
      model: REAL_PI_MODEL,
      prompt: "Reply with exactly: SCALER_USAGE_OK",
    });

    assert.equal(result.exitCode, 0, result.stderr || result.stdout);
    assert.ok(result.events.some((event) => isRecord(event) && event.type === "session"), "expected Pi JSON session event");

    const state = await loadState(dir);
    const budgets = getBudgetState(state);
    assert.ok(Number(budgets.usage.contextTokens) > 0, "expected provider token usage to update contextTokens");

    const events = await readLogEvents(dir);
    assert.ok(events.some((event) => event.eventType === "budget" && event.summary.includes("Provider usage recorded")));
  });
});

test("real Pi extension: slash command dispatch persists budget limits", { skip: !REAL_PI_ENABLED }, async () => {
  await withRealPiTempRepo(async (dir) => {
    const setResult = await runScalerPi({
      cwd: dir,
      prompt: "/scaler-budget-set validationLoops | 1 | 2",
    });

    assert.equal(setResult.exitCode, 0, setResult.stderr || setResult.stdout);
    assert.match(`${setResult.stdout}\n${setResult.stderr}`, /Budget limit updated: validationLoops soft=1 hard=2/);
    assert.ok(setResult.events.some((event) => isRecord(event) && event.type === "session"), "expected Pi JSON session event");

    const statusResult = await runScalerPi({
      cwd: dir,
      prompt: "/scaler-budget-status",
    });

    assert.equal(statusResult.exitCode, 0, statusResult.stderr || statusResult.stdout);
    assert.match(`${statusResult.stdout}\n${statusResult.stderr}`, /validationLoops: usage=0 soft=1 hard=2 status=ok/);

    const state = await loadState(dir);
    assert.deepEqual(getBudgetState(state).limits.validationLoops, { soft: 1, hard: 2 });

    const events = await readLogEvents(dir);
    assert.ok(events.some((event) => event.eventType === "state" && event.summary === "Budget limit updated: validationLoops"));
    assert.deepEqual(
      events
        .filter((event) => event.eventType === "command" && isRecord(event.details) && ["scaler-budget-set", "scaler-budget-status"].includes(String(event.details.command)))
        .map((event) => `${(event.details as { command: string; phase: string }).command}:${(event.details as { command: string; phase: string }).phase}`),
      ["scaler-budget-set:start", "scaler-budget-set:end", "scaler-budget-status:start", "scaler-budget-status:end"],
    );
  });
});

test("real Pi extension: slash command dispatch persists safety policy", { skip: !REAL_PI_ENABLED }, async () => {
  await withRealPiTempRepo(async (dir) => {
    const result = await runScalerPi({
      cwd: dir,
      prompt: "/scaler-safety-policy allow-internet=on allow-external=off",
    });

    assert.equal(result.exitCode, 0, result.stderr || result.stdout);
    assert.match(`${result.stdout}\n${result.stderr}`, /allowInternet=true allowExternalMutations=false/);
    assert.ok(result.events.some((event) => isRecord(event) && event.type === "session"), "expected Pi JSON session event");

    const policy = await loadSafetyPolicy(dir);
    assert.equal(policy.allowInternet, true);
    assert.equal(policy.allowExternalMutations, false);

    const events = await readLogEvents(dir);
    assert.ok(events.some((event) => event.eventType === "state" && event.summary === "Scaler safety policy requested"));
    assert.deepEqual(
      events
        .filter((event) => event.eventType === "command" && isRecord(event.details) && event.details.command === "scaler-safety-policy")
        .map((event) => (event.details as { phase: string }).phase),
      ["start", "end"],
    );
  });
});

test("real Pi extension: slash command dispatch persists storage inventory", { skip: !REAL_PI_ENABLED }, async () => {
  await withRealPiTempRepo(async (dir) => {
    const result = await runScalerPi({
      cwd: dir,
      prompt: "/scaler-storage-status",
    });

    assert.equal(result.exitCode, 0, result.stderr || result.stdout);
    assert.match(`${result.stdout}\n${result.stderr}`, /Storage: totalBytes=\d+ files=\d+ dirs=\d+/);
    assert.match(`${result.stdout}\n${result.stderr}`, /Budget: ok storageBytes within budget/);
    assert.ok(result.events.some((event) => isRecord(event) && event.type === "session"), "expected Pi JSON session event");

    const inventory = await loadStorageInventory(dir);
    const state = await loadState(dir);
    assert.ok(inventory, "expected persisted storage inventory");
    assert.equal(getBudgetState(state).usage.storageBytes, inventory.totalBytes);

    const events = await readLogEvents(dir);
    assert.ok(events.some((event) => event.eventType === "state" && event.summary === "Scaler storage status requested"));
    assert.deepEqual(
      events
        .filter((event) => event.eventType === "command" && isRecord(event.details) && event.details.command === "scaler-storage-status")
        .map((event) => (event.details as { phase: string }).phase),
      ["start", "end"],
    );
  });
});

test("real Pi extension: slash command dispatch executes storage maintenance", { skip: !REAL_PI_ENABLED }, async () => {
  await withRealPiTempRepo(async (dir) => {
    await mkdir(join(dir, ".scaler", "reports"), { recursive: true });
    await mkdir(join(dir, ".scaler", "cache"), { recursive: true });
    const reportPath = join(dir, ".scaler", "reports", "real-report.json");
    const cachePath = join(dir, ".scaler", "cache", "real-cache.bin");
    await writeFile(reportPath, "r".repeat(4096), "utf8");
    await writeFile(cachePath, "c".repeat(4096), "utf8");

    const result = await runScalerPi({
      cwd: dir,
      prompt: "/scaler-storage-maintain execute delete-cache min-age-days=999 min-size=2048",
    });

    assert.equal(result.exitCode, 0, result.stderr || result.stdout);
    assert.ok(result.events.some((event) => isRecord(event) && event.type === "session"), "expected Pi JSON session event");

    const maintenance = await loadStorageMaintenanceReport(dir);
    assert.ok(maintenance, "expected persisted maintenance report");
    assert.equal(maintenance.executed, true);
    assert.equal(maintenance.summary.failed, 0);
    assert.ok(maintenance.actions.some((action) => action.type === "compress" && action.path === ".scaler/reports/real-report.json" && action.status === "completed"));
    assert.ok(maintenance.actions.some((action) => action.type === "delete_cache" && action.path === ".scaler/cache/real-cache.bin" && action.status === "completed"));
    assert.equal(await pathExists(reportPath), false);
    assert.equal(await pathExists(`${reportPath}.gz`), true);
    assert.equal(await pathExists(cachePath), false);

    const state = await loadState(dir);
    assert.ok(Number(getBudgetState(state).usage.storageBytes) > 0);

    const events = await readLogEvents(dir);
    assert.ok(events.some((event) => event.eventType === "state" && event.summary === "Scaler storage maintenance requested"));
    assert.deepEqual(
      events
        .filter((event) => event.eventType === "command" && isRecord(event.details) && event.details.command === "scaler-storage-maintain")
        .map((event) => (event.details as { phase: string }).phase),
      ["start", "end"],
    );
  });
});

test("real Pi extension: slash command dispatch runs scheduled storage maintenance", { skip: !REAL_PI_ENABLED }, async () => {
  await withRealPiTempRepo(async (dir) => {
    await mkdir(join(dir, ".scaler", "logs"), { recursive: true });
    const eventsPath = join(dir, ".scaler", "logs", "events.jsonl");
    await writeFile(eventsPath, `${JSON.stringify({ eventType: "test", summary: "scheduled real active event" })}\n`, "utf8");

    const result = await runScalerPi({
      cwd: dir,
      prompt: "/scaler-storage-schedule enable run force execute=off interval-hours=1 compress=off rotate-active=on max-active-bytes=1",
    });

    assert.equal(result.exitCode, 0, result.stderr || result.stdout);
    assert.match(`${result.stdout}\n${result.stderr}`, /Storage schedule: enabled=true intervalHours=1 execute=false/);
    assert.match(`${result.stdout}\n${result.stderr}`, /Run: status=planned due=true/);
    assert.ok(result.events.some((event) => isRecord(event) && event.type === "session"), "expected Pi JSON session event");

    const schedule = await loadStorageMaintenanceSchedule(dir);
    const maintenance = await loadStorageMaintenanceReport(dir);
    assert.equal(schedule.enabled, true);
    assert.equal(schedule.execute, false);
    assert.ok(schedule.lastRunAt, "expected schedule last run metadata");
    assert.ok(schedule.nextRunAt, "expected schedule next run metadata");
    assert.ok(maintenance, "expected persisted scheduled maintenance report");
    assert.equal(maintenance.executed, false);
    assert.ok(maintenance.actions.some((action) => action.type === "rotate_active" && action.status === "planned"));
    assert.match(await readFile(eventsPath, "utf8"), /scheduled real active event/);
  });
});

test("real Pi extension: slash command dispatch rotates active storage ledgers", { skip: !REAL_PI_ENABLED }, async () => {
  await withRealPiTempRepo(async (dir) => {
    await mkdir(join(dir, ".scaler", "logs"), { recursive: true });
    await mkdir(join(dir, ".scaler", "reports"), { recursive: true });
    const eventsPath = join(dir, ".scaler", "logs", "events.jsonl");
    const runsPath = join(dir, ".scaler", "reports", "validation-runs.json");
    await writeFile(eventsPath, "old real active event\n", "utf8");
    await writeFile(runsPath, "[{\"id\":\"real-run-old\"}]\n", "utf8");

    const result = await runScalerPi({
      cwd: dir,
      prompt: "/scaler-storage-maintain execute rotate-active no-compress max-active-bytes=1 min-free-bytes=1",
    });

    assert.equal(result.exitCode, 0, result.stderr || result.stdout);
    assert.match(`${result.stdout}\n${result.stderr}`, /rotate_active/);
    assert.ok(result.events.some((event) => isRecord(event) && event.type === "session"), "expected Pi JSON session event");

    const maintenance = await loadStorageMaintenanceReport(dir);
    assert.ok(maintenance, "expected persisted maintenance report");
    assert.equal(maintenance.executed, true);
    assert.equal(maintenance.summary.failed, 0);
    assert.equal(maintenance.disk?.status, "ok");
    const eventRotation = maintenance.actions.find((action) => action.type === "rotate_active" && action.path === ".scaler/logs/events.jsonl");
    const runRotation = maintenance.actions.find((action) => action.type === "rotate_active" && action.path === ".scaler/reports/validation-runs.json");
    assert.equal(eventRotation?.status, "completed");
    assert.equal(runRotation?.status, "completed");
    assert.match(await readFile(join(dir, eventRotation?.targetPath ?? "missing"), "utf8"), /old real active event/);
    assert.equal(await readFile(join(dir, runRotation?.targetPath ?? "missing"), "utf8"), "[{\"id\":\"real-run-old\"}]\n");
    assert.doesNotMatch(await readFile(eventsPath, "utf8"), /old real active event/);
    assert.equal(await readFile(runsPath, "utf8"), "[]\n");
  });
});

test("real Pi extension: slash command dispatch deletes approved storage archives", { skip: !REAL_PI_ENABLED }, async () => {
  await withRealPiTempRepo(async (dir) => {
    await mkdir(join(dir, ".scaler", "storage", "archive", "logs"), { recursive: true });
    const oldArchive = join(dir, ".scaler", "storage", "archive", "logs", "events-old.jsonl");
    const newArchive = join(dir, ".scaler", "storage", "archive", "logs", "events-new.jsonl");
    await writeFile(oldArchive, "o".repeat(5), "utf8");
    await writeFile(newArchive, "n".repeat(5), "utf8");
    await utimes(oldArchive, new Date("2025-12-01T00:00:00.000Z"), new Date("2025-12-01T00:00:00.000Z"));
    await utimes(newArchive, new Date("2025-12-31T00:00:00.000Z"), new Date("2025-12-31T00:00:00.000Z"));

    const result = await runScalerPi({
      cwd: dir,
      prompt: "/scaler-storage-maintain execute no-compress delete-archives max-archive-bytes=6",
    });

    assert.equal(result.exitCode, 0, result.stderr || result.stdout);
    assert.match(`${result.stdout}\n${result.stderr}`, /delete_archive/);
    assert.ok(result.events.some((event) => isRecord(event) && event.type === "session"), "expected Pi JSON session event");

    const maintenance = await loadStorageMaintenanceReport(dir);
    assert.ok(maintenance, "expected persisted maintenance report");
    assert.equal(maintenance.executed, true);
    assert.equal(maintenance.summary.failed, 0);
    const deletion = maintenance.actions.find((action) => action.type === "delete_archive");
    assert.equal(deletion?.path, ".scaler/storage/archive/logs/events-old.jsonl");
    assert.equal(deletion?.status, "completed");
    assert.equal(await pathExists(oldArchive), false);
    assert.equal(await readFile(newArchive, "utf8"), "n".repeat(5));
  });
});

test("real Pi extension: slash command dispatch prepares debug next-approach retry", { skip: !REAL_PI_ENABLED }, async () => {
  await withRealPiTempRepo(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    state.stage = "execution";
    state.currentTaskId = "T-REAL-RETRY";
    state.tasks = [{ id: "T-REAL-RETRY", status: "validating", title: "Real retry", updatedAt: state.createdAt }];
    await saveState(dir, state);
    await upsertValidationManifestCommand(dir, {
      taskId: "T-REAL-RETRY",
      id: "exact-real",
      command: "node -e \"process.exit(1)\"",
      description: "Exact real retry validation",
      required: true,
      gate: "unit",
      expectedResult: "exits 0 after retry",
      evidenceRefs: ["validation:real-retry"],
    });
    const failedRun = await runTaskValidation(dir, state, "T-REAL-RETRY");
    const debugging = await loadState(dir);
    assert.equal(debugging.tasks.find((task) => task.id === "T-REAL-RETRY")?.status, "debugging");
    await recordDebugReport(dir, debugging, {
      id: "RPT-REAL-RETRY",
      taskId: "T-REAL-RETRY",
      status: "next_approach",
      summary: "Replace the failing marker behavior.",
      failureId: "F-REAL-RETRY",
      failureFingerprint: "real retry marker failure",
      rootCause: "The exact retry validation exits 1.",
      nextApproach: "Patch the marker behavior and rerun exact-real.",
      evidenceRefs: [failedRun.id],
    });

    const result = await runScalerPi({
      cwd: dir,
      prompt: "/scaler-debug-retry T-REAL-RETRY",
    });

    assert.equal(result.exitCode, 0, result.stderr || result.stdout);
    assert.ok(result.events.some((event) => isRecord(event) && event.type === "session"), "expected Pi JSON session event");

    const retries = await loadDebugRetries(dir);
    assert.equal(retries[0]?.status, "prepared");
    assert.equal(retries[0]?.debugReportId, "RPT-REAL-RETRY");
    assert.equal((await loadState(dir)).tasks.find((task) => task.id === "T-REAL-RETRY")?.status, "debugging");

    const events = await readLogEvents(dir);
    assert.deepEqual(
      events
        .filter((event) => event.eventType === "command" && isRecord(event.details) && event.details.command === "scaler-debug-retry")
        .map((event) => (event.details as { phase: string }).phase),
      ["start", "end"],
    );
    assert.ok(events.some((event) => event.eventType === "agent" && event.summary === "Agent prompt prepared: debug-retry-task/T-REAL-RETRY"));
  });
});

test("real Pi extension: slash command dispatch enforces validation evidence policy", { skip: !REAL_PI_ENABLED }, async () => {
  await withRealPiTempRepo(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    state.stage = "execution";
    state.currentTaskId = "T-REAL-EVIDENCE";
    state.tasks = [{ id: "T-REAL-EVIDENCE", status: "validating", title: "Real evidence", updatedAt: state.createdAt }];
    await saveState(dir, state);

    const result = await runScalerPi({
      cwd: dir,
      prompt: "/scaler-validation-checklist T-REAL-EVIDENCE | acceptance | Missing evidence | acceptance::passed::required::Acceptance demonstrated:: |",
    });

    assert.equal(result.exitCode, 0, result.stderr || result.stdout);
    assert.match(`${result.stdout}\n${result.stderr}`, /Evidence policy: missing=acceptance/);
    assert.ok(result.events.some((event) => isRecord(event) && event.type === "session"), "expected Pi JSON session event");

    const checklist = (await loadValidationChecklists(dir))[0];
    assert.equal(checklist?.status, "failed");
    assert.deepEqual(checklist?.evidencePolicy?.missingEvidenceItemIds, ["acceptance"]);
    assert.equal((await loadState(dir)).tasks.find((task) => task.id === "T-REAL-EVIDENCE")?.status, "debugging");
  });
});

test("real Pi extension: slash command dispatch persists validation checklist", { skip: !REAL_PI_ENABLED }, async () => {
  await withRealPiTempRepo(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    state.stage = "execution";
    state.currentTaskId = "T-REAL-CHECKLIST";
    state.tasks = [{ id: "T-REAL-CHECKLIST", status: "validating", title: "Real checklist", updatedAt: state.createdAt }];
    await saveState(dir, state);

    const result = await runScalerPi({
      cwd: dir,
      prompt: "/scaler-validation-checklist T-REAL-CHECKLIST | completeness | Checklist passed | scope::passed::required::Scope covered::evidence-real | evidence-root",
    });

    assert.equal(result.exitCode, 0, result.stderr || result.stdout);
    assert.match(`${result.stdout}\n${result.stderr}`, /Validation checklist T-REAL-CHECKLIST-checklist-/);
    assert.ok(result.events.some((event) => isRecord(event) && event.type === "session"), "expected Pi JSON session event");

    const checklist = (await loadValidationChecklists(dir))[0];
    assert.equal(checklist?.taskId, "T-REAL-CHECKLIST");
    assert.equal(checklist?.status, "passed");
    assert.equal(checklist?.gate, "completeness");
    assert.equal((await loadState(dir)).tasks.find((task) => task.id === "T-REAL-CHECKLIST")?.status, "validated");

    const events = await readLogEvents(dir);
    assert.deepEqual(
      events
        .filter((event) => event.eventType === "command" && isRecord(event.details) && event.details.command === "scaler-validation-checklist")
        .map((event) => (event.details as { phase: string }).phase),
      ["start", "end"],
    );
    assert.ok(events.some((event) => event.eventType === "validation" && event.summary === "Validation summary: T-REAL-CHECKLIST passed"));
  });
});

test("real Pi extension: slash command dispatch enforces validation gate policy", { skip: !REAL_PI_ENABLED }, async () => {
  await withRealPiTempRepo(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    state.stage = "execution";
    state.currentTaskId = "T-REAL-POLICY";
    state.tasks = [{ id: "T-REAL-POLICY", status: "validating", title: "Real policy", updatedAt: state.createdAt }];
    await saveState(dir, state);
    await saveValidationManifest(dir, {
      taskId: "T-REAL-POLICY",
      createdAt: "",
      updatedAt: "",
      commands: [
        { id: "expensive", command: "node -e \"require('node:fs').writeFileSync('real-policy-should-not-run.txt','ran')\"", required: true, gate: "unit_tests" },
        { id: "deps", command: "node -e \"process.exit(0)\"", required: true, gate: "dependency_check" },
      ],
    });

    const result = await runScalerPi({
      cwd: dir,
      prompt: "/scaler-validate T-REAL-POLICY",
    });

    assert.equal(result.exitCode, 0, result.stderr || result.stdout);
    assert.match(`${result.stdout}\n${result.stderr}`, /policyFailures=1 policyWarnings=1/);
    assert.ok(result.events.some((event) => isRecord(event) && event.type === "session"), "expected Pi JSON session event");

    const runs = await loadValidationRuns(dir);
    assert.equal(runs[0]?.status, "failed");
    assert.deepEqual(runs[0]?.policyDiagnostics?.map((diagnostic) => diagnostic.code), ["missing_test_first", "dependency_check_order"]);
    assert.equal(runs[0]?.commandRuns[0]?.command, "SCALER validation manifest policy preflight");
    assert.equal((await loadState(dir)).tasks.find((task) => task.id === "T-REAL-POLICY")?.status, "debugging");
    await assert.rejects(stat(join(dir, "real-policy-should-not-run.txt")));
  });
});

test("real Pi extension: slash command dispatch enforces validation environment policy", { skip: !REAL_PI_ENABLED }, async () => {
  await withRealPiTempRepo(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    state.stage = "execution";
    state.currentTaskId = "T-REAL-ENV";
    state.tasks = [{ id: "T-REAL-ENV", status: "validating", title: "Real environment", updatedAt: state.createdAt }];
    await saveState(dir, state);

    const addResult = await runScalerPi({
      cwd: dir,
      prompt: "/scaler-validation-add T-REAL-ENV | ci | node -e \"require('node:fs').writeFileSync('real-env-should-not-run.txt','ran')\" | Local CI validation | required | local_ci | local CI exits 0 | manifest:ci",
    });
    assert.equal(addResult.exitCode, 0, addResult.stderr || addResult.stdout);
    assert.match(`${addResult.stdout}\n${addResult.stderr}`, /gate=local_ci/);

    const result = await runScalerPi({
      cwd: dir,
      prompt: "/scaler-validate T-REAL-ENV",
    });

    assert.equal(result.exitCode, 0, result.stderr || result.stdout);
    assert.match(`${result.stdout}\n${result.stderr}`, /policyFailures=1/);
    assert.ok(result.events.some((event) => isRecord(event) && event.type === "session"), "expected Pi JSON session event");

    const runs = await loadValidationRuns(dir);
    assert.equal(runs[0]?.status, "failed");
    assert.equal(runs[0]?.policyDiagnostics?.some((diagnostic) => diagnostic.code === "local_ci_requires_environment"), true);
    assert.equal(runs[0]?.commandRuns[0]?.command, "SCALER validation manifest policy preflight");
    await assert.rejects(stat(join(dir, "real-env-should-not-run.txt")));
  });
});

test("real Pi extension: slash command dispatch records validation environment lifecycle", { skip: !REAL_PI_ENABLED }, async () => {
  await withRealPiTempRepo(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    state.stage = "execution";
    state.currentTaskId = "T-REAL-LIFECYCLE";
    state.tasks = [{ id: "T-REAL-LIFECYCLE", status: "validating", title: "Real lifecycle", updatedAt: state.createdAt }];
    await saveState(dir, state);

    const addResult = await runScalerPi({
      cwd: dir,
      prompt: "/scaler-validation-add T-REAL-LIFECYCLE | ci | node -e \"require('node:fs').writeFileSync('real-lifecycle-ran.txt','ok')\" | Local CI validation | required | local_ci | exits 0 | evidence:ci | local_ci",
    });
    assert.equal(addResult.exitCode, 0, addResult.stderr || addResult.stdout);

    const result = await runScalerPi({ cwd: dir, prompt: "/scaler-validate T-REAL-LIFECYCLE" });
    assert.equal(result.exitCode, 0, result.stderr || result.stdout);
    assert.match(`${result.stdout}\n${result.stderr}`, /Validation passed: T-REAL-LIFECYCLE/);

    const statusResult = await runScalerPi({ cwd: dir, prompt: "/scaler-validation-envs" });
    assert.equal(statusResult.exitCode, 0, statusResult.stderr || statusResult.stdout);
    assert.match(`${statusResult.stdout}\n${statusResult.stderr}`, /Validation environments: records=2/);

    const runs = await loadValidationRuns(dir);
    const lifecycle = await loadValidationEnvironmentRecords(dir);
    assert.equal(runs[0]?.commandRuns[0]?.environment, "local_ci");
    assert.equal(runs[0]?.commandRuns[0]?.environmentLifecycleRefs?.length, 2);
    assert.deepEqual(lifecycle.map((record) => record.phase), ["cleanup", "prepare"]);
    assert.deepEqual(lifecycle.map((record) => record.status), ["cleanup_completed", "prepared"]);
    assert.equal(await readFile(join(dir, "real-lifecycle-ran.txt"), "utf8"), "ok");
  });
});

test("real Pi extension: slash command dispatch persists validation disposition", { skip: !REAL_PI_ENABLED }, async () => {
  await withRealPiTempRepo(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    state.stage = "execution";
    state.currentTaskId = "T-REAL-SKIP";
    state.tasks = [{ id: "T-REAL-SKIP", status: "validating", title: "Real skip", updatedAt: state.createdAt }];
    await saveState(dir, state);

    const addResult = await runScalerPi({
      cwd: dir,
      prompt: "/scaler-validation-add T-REAL-SKIP | integration | node -e \"require('node:fs').writeFileSync('real-skip-should-not-run.txt','ran')\" | Integration tests | required | integration | exits 0 | manifest:skip | host | skipped:No integration surface changed",
    });
    assert.equal(addResult.exitCode, 0, addResult.stderr || addResult.stdout);

    const result = await runScalerPi({ cwd: dir, prompt: "/scaler-validate T-REAL-SKIP" });

    assert.equal(result.exitCode, 0, result.stderr || result.stdout);
    assert.match(`${result.stdout}\n${result.stderr}`, /Validation passed: T-REAL-SKIP/);
    assert.ok(result.events.some((event) => isRecord(event) && event.type === "session"), "expected Pi JSON session event");

    const runs = await loadValidationRuns(dir);
    assert.equal(runs[0]?.status, "passed");
    assert.equal(runs[0]?.commandRuns[0]?.status, "skipped");
    assert.equal(runs[0]?.commandRuns[0]?.dispositionReason, "No integration surface changed");
    assert.equal((await loadState(dir)).tasks.find((task) => task.id === "T-REAL-SKIP")?.status, "validated");
    await assert.rejects(stat(join(dir, "real-skip-should-not-run.txt")));
  });
});

test("real Pi extension: slash command dispatch persists typed validation gate metadata", { skip: !REAL_PI_ENABLED }, async () => {
  await withRealPiTempRepo(async (dir) => {
    const result = await runScalerPi({
      cwd: dir,
      prompt: "/scaler-validation-add T-REAL-GATE | unit | node -e \"process.exit(0)\" | Unit validation | required | unit | exits 0 | evidence:real",
    });

    assert.equal(result.exitCode, 0, result.stderr || result.stdout);
    assert.match(`${result.stdout}\n${result.stderr}`, /Validation command saved: T-REAL-GATE\/unit commands=3 gate=unit_tests/);
    assert.ok(result.events.some((event) => isRecord(event) && event.type === "session"), "expected Pi JSON session event");

    const manifest = (await loadValidationManifests(dir)).find((candidate) => candidate.taskId === "T-REAL-GATE");
    assert.equal(manifest?.commands[0]?.gate, "unit_tests");
    assert.equal(manifest?.commands[0]?.expectedResult, "exits 0");
    assert.deepEqual(manifest?.commands[0]?.evidenceRefs, ["evidence:real"]);

    const events = await readLogEvents(dir);
    assert.deepEqual(
      events
        .filter((event) => event.eventType === "command" && isRecord(event.details) && event.details.command === "scaler-validation-add")
        .map((event) => (event.details as { phase: string }).phase),
      ["start", "end"],
    );
  });
});

test("real Pi extension: slash command dispatch prepares isolated tool transaction", { skip: !REAL_PI_ENABLED }, async () => {
  await withRealPiTempRepo(async (dir) => {
    const prepared = await prepareToolRequest(dir, createDefaultState(new Date("2026-01-01T00:00:00.000Z")), {
      toolName: "docs_search",
      request: "Find widget lifecycle docs.",
      taskId: "REAL-TOOL-TXN",
      requesterAgentId: "real-tool-requester",
      expectedOutput: "Lifecycle API summary.",
      requiredFormat: "json",
      riskLevel: "low",
      allowedTools: ["read"],
    });
    assert.ok(prepared.record, "expected seeded tool request");

    const result = await runScalerPi({
      cwd: dir,
      prompt: `/scaler-tool-run ${prepared.record.id}`,
    });

    assert.equal(result.exitCode, 0, result.stderr || result.stdout);
    assert.ok(result.events.some((event) => isRecord(event) && event.type === "session"), "expected Pi JSON session event");

    const transaction = (await loadToolTransactions(dir))[0];
    assert.equal(transaction?.requestId, prepared.record.id);
    assert.equal(transaction?.status, "prepared");
    assert.equal(transaction?.executed, false);
    assert.ok(transaction?.invocation.args.includes("--tools"));
    assert.ok(transaction?.invocation.args.includes("docs_search,read"));

    const events = await readLogEvents(dir);
    assert.deepEqual(
      events
        .filter((event) => event.eventType === "command" && isRecord(event.details) && event.details.command === "scaler-tool-run")
        .map((event) => (event.details as { phase: string }).phase),
      ["start", "end"],
    );
    assert.ok(events.some((event) => event.eventType === "tool" && event.summary === `Tool transaction prepared: ${prepared.record?.id}`));
  });
});

test("real Pi extension: slash command dispatch prepares tool transaction replay", { skip: !REAL_PI_ENABLED }, async () => {
  await withRealPiTempRepo(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    const prepared = await prepareToolRequest(dir, state, {
      toolName: "docs_search",
      request: "Find widget lifecycle docs.",
      taskId: "REAL-TOOL-REPLAY",
      allowedTools: ["read"],
    });
    assert.ok(prepared.record, "expected seeded tool request");
    const original = await runToolRequestAgent(dir, state, { requestId: prepared.record.id });
    assert.ok(original.transaction, "expected seeded transaction");

    const result = await runScalerPi({
      cwd: dir,
      prompt: `/scaler-tool-replay ${original.transaction.id}`,
    });

    assert.equal(result.exitCode, 0, result.stderr || result.stdout);
    assert.ok(result.events.some((event) => isRecord(event) && event.type === "session"), "expected Pi JSON session event");

    const replay = (await loadToolTransactions(dir))[0];
    assert.equal(replay?.status, "prepared");
    assert.equal(replay?.replayOfTransactionId, original.transaction.id);
    assert.equal(replay?.requestId, prepared.record.id);

    const events = await readLogEvents(dir);
    assert.deepEqual(
      events
        .filter((event) => event.eventType === "command" && isRecord(event.details) && event.details.command === "scaler-tool-replay")
        .map((event) => (event.details as { phase: string }).phase),
      ["start", "end"],
    );
    assert.ok(events.some((event) => event.eventType === "tool" && event.summary === `Tool transaction replay prepared: ${original.transaction?.id}`));
  });
});

test("real Pi extension: slash command dispatch prepares schema discovery probe", { skip: !REAL_PI_ENABLED }, async () => {
  await withRealPiTempRepo(async (dir) => {
    const result = await runScalerPi({
      cwd: dir,
      prompt: "/scaler-tool-discover mcp_docs_search tools=read",
    });

    assert.equal(result.exitCode, 0, result.stderr || result.stdout);
    assert.ok(result.events.some((event) => isRecord(event) && event.type === "session"), "expected Pi JSON session event");

    const run = (await loadToolSchemaDiscoveryRuns(dir))[0];
    assert.equal(run?.toolName, "mcp_docs_search");
    assert.equal(run?.status, "prepared");
    assert.equal(run?.executed, false);
    assert.deepEqual(run?.allowedTools, ["scaler_tool_schema", "read"]);
    assert.ok(run?.invocation.args.includes("--tools"));
    assert.ok(run?.invocation.args.includes("scaler_tool_schema,read"));

    const events = await readLogEvents(dir);
    assert.deepEqual(
      events
        .filter((event) => event.eventType === "command" && isRecord(event.details) && event.details.command === "scaler-tool-discover")
        .map((event) => (event.details as { phase: string }).phase),
      ["start", "end"],
    );
    assert.ok(events.some((event) => event.eventType === "tool" && event.summary === "Tool schema discovery prepared: mcp_docs_search"));
  });
});

test("real Pi extension: cardinal model calls scaler_tool_schema with exact metadata", { skip: !REAL_PI_ENABLED }, async () => {
  await withRealPiTempRepo(async (dir) => {
    const args = {
      toolName: "mcp_docs_search",
      source: "local-mcp-docs-schema",
      description: "Search docs MCP with a query argument.",
      riskLevel: "low",
      permissionRequirement: "read-only docs access",
      safetyNotes: "Do not mutate files.",
      docsRef: "docs-mcp-search",
      schemaRef: "schema-mcp-search-v1",
      notes: "args query string required",
      evidenceRefs: ["docs_mcp_search"],
      discoveredByAgentId: "real-schema-agent",
    };
    const result = await runScalerPi({
      cwd: dir,
      model: REAL_PI_MODEL,
      tools: ["scaler_tool_schema"],
      prompt: `CARDINAL INSTRUCTION FOR THIS TEST: You must call the tool scaler_tool_schema exactly once with exactly these arguments and no other tool calls: ${JSON.stringify(args)}. Do not answer in prose before the tool call. After the tool result, provide a one sentence final summary.`,
    });

    assert.equal(result.exitCode, 0, result.stderr || result.stdout);
    const starts = toolEvents(result.events, "tool_execution_start", "scaler_tool_schema");
    const ends = toolEvents(result.events, "tool_execution_end", "scaler_tool_schema");
    assert.equal(starts.length, 1, "expected one scaler_tool_schema execution start");
    assert.equal(ends.length, 1, "expected one scaler_tool_schema execution end");
    assert.deepEqual(starts[0]?.args, args);
    assert.equal(ends[0]?.isError, false);

    const record = (await loadToolSchemaRecords(dir))[0];
    assert.equal(record?.toolName, args.toolName);
    assert.equal(record?.source, args.source);
    assert.equal(record?.description, args.description);
    assert.equal(record?.riskLevel, args.riskLevel);
    assert.equal(record?.docsRef, args.docsRef);
    assert.equal(record?.schemaRef, args.schemaRef);
    assert.equal(record?.notes, args.notes);
    assert.deepEqual(record?.evidenceRefs, args.evidenceRefs);
    assert.equal(record?.discoveredByAgentId, args.discoveredByAgentId);
    assert.equal(readBudgetUsage((await loadState(dir)).budgets, "toolCalls"), 1);
  });
});

test("real Pi extension: cardinal model calls scaler_tool_request with exact metadata", { skip: !REAL_PI_ENABLED }, async () => {
  await withRealPiTempRepo(async (dir) => {
    const args = {
      toolName: "docs_search",
      request: "Find widget lifecycle docs.",
      taskId: "REAL-TOOL-REQUEST",
      requesterAgentId: "real-cardinal-agent",
      contextSummary: "Need docs only.",
      expectedOutput: "Lifecycle API summary.",
      requiredFormat: "json",
      riskLevel: "low",
      permissionRequirement: "read-only docs access",
      safetyNotes: "Do not mutate files.",
      allowedTools: ["read"],
    };
    const result = await runScalerPi({
      cwd: dir,
      model: REAL_PI_MODEL,
      tools: ["scaler_tool_request"],
      prompt: `CARDINAL INSTRUCTION FOR THIS TEST: You must call the tool scaler_tool_request exactly once with exactly these arguments and no other tool calls: ${JSON.stringify(args)}. Do not answer in prose before the tool call. After the tool result, provide a one sentence final summary.`,
    });

    assert.equal(result.exitCode, 0, result.stderr || result.stdout);
    const starts = toolEvents(result.events, "tool_execution_start", "scaler_tool_request");
    const ends = toolEvents(result.events, "tool_execution_end", "scaler_tool_request");
    assert.equal(starts.length, 1, "expected one scaler_tool_request execution start");
    assert.equal(ends.length, 1, "expected one scaler_tool_request execution end");
    assert.deepEqual(starts[0]?.args, args);
    assert.equal(ends[0]?.isError, false);

    const record = (await loadToolRequests(dir))[0];
    assert.equal(record?.toolName, args.toolName);
    assert.equal(record?.requesterAgentId, args.requesterAgentId);
    assert.equal(record?.expectedOutput, args.expectedOutput);
    assert.equal(record?.requiredFormat, args.requiredFormat);
    assert.equal(record?.riskLevel, args.riskLevel);
    assert.equal(record?.permissionRequirement, args.permissionRequirement);
    assert.equal(record?.safetyNotes, args.safetyNotes);
    assert.deepEqual(record?.allowedTools, ["docs_search", "read"]);
  });
});

test("real Pi extension: cardinal model calls scaler_tool_result with exact metadata", { skip: !REAL_PI_ENABLED }, async () => {
  await withRealPiTempRepo(async (dir) => {
    const prepared = await prepareToolRequest(dir, createDefaultState(new Date("2026-01-01T00:00:00.000Z")), {
      toolName: "docs_search",
      request: "Find widget lifecycle docs.",
      taskId: "REAL-TOOL-RESULT",
      requesterAgentId: "real-cardinal-agent",
      expectedOutput: "Lifecycle API summary.",
      requiredFormat: "json",
      riskLevel: "low",
      allowedTools: ["read"],
    });
    assert.ok(prepared.record, "expected seeded tool request");
    const args = {
      requestId: prepared.record.id,
      status: "completed",
      summary: "Lifecycle API summary found.",
      outputs: { apiNames: ["Widget.create", "Widget.destroy"], refs: ["docs:widget-lifecycle"] },
      evidenceRefs: ["docs:widget-lifecycle"],
      validationPerformed: ["checked requested JSON format"],
      recommendations: ["Use Widget.destroy for cleanup."],
    };
    const result = await runScalerPi({
      cwd: dir,
      model: REAL_PI_MODEL,
      tools: ["scaler_tool_result"],
      prompt: `CARDINAL INSTRUCTION FOR THIS TEST: You must call the tool scaler_tool_result exactly once with exactly these arguments and no other tool calls: ${JSON.stringify(args)}. Do not answer in prose before the tool call. After the tool result, provide a one sentence final summary.`,
    });

    assert.equal(result.exitCode, 0, result.stderr || result.stdout);
    const starts = toolEvents(result.events, "tool_execution_start", "scaler_tool_result");
    const ends = toolEvents(result.events, "tool_execution_end", "scaler_tool_result");
    assert.equal(starts.length, 1, "expected one scaler_tool_result execution start");
    assert.equal(ends.length, 1, "expected one scaler_tool_result execution end");
    assert.deepEqual(starts[0]?.args, args);
    assert.equal(ends[0]?.isError, false);

    const resultRecord = (await loadToolResults(dir))[0];
    const requestRecord = (await loadToolRequests(dir))[0];
    assert.equal(resultRecord?.requestId, args.requestId);
    assert.equal(resultRecord?.status, "completed");
    assert.deepEqual(resultRecord?.validationPerformed, ["checked requested JSON format"]);
    assert.equal(requestRecord?.status, "completed");
    assert.equal(readBudgetUsage((await loadState(dir)).budgets, "toolCalls"), 1);
  });
});

test("real Pi extension: cardinal model calls a SCALER tool and mutates SCALER state", { skip: !REAL_PI_ENABLED }, async () => {
  await withRealPiTempRepo(async (dir) => {
    const args = {
      taskId: "REAL-TOOL-001",
      title: "Real Pi cardinal task",
      status: "ready",
      allowedPathPrefixes: ["src/real-pi-cardinal"],
      dependsOn: [],
      prdRefs: ["REQ-REAL-PI"],
    };
    const result = await runScalerPi({
      cwd: dir,
      model: REAL_PI_MODEL,
      tools: ["scaler_task_create"],
      prompt: `CARDINAL INSTRUCTION FOR THIS TEST: You must call the tool scaler_task_create exactly once with exactly these arguments and no other tool calls: ${JSON.stringify(args)}. Do not answer in prose before the tool call. After the tool result, provide a one sentence final summary.`,
    });

    assert.equal(result.exitCode, 0, result.stderr || result.stdout);
    const starts = toolEvents(result.events, "tool_execution_start", "scaler_task_create");
    const ends = toolEvents(result.events, "tool_execution_end", "scaler_task_create");
    assert.equal(starts.length, 1, "expected one scaler_task_create execution start");
    assert.equal(ends.length, 1, "expected one scaler_task_create execution end");
    assert.deepEqual(starts[0]?.args, args);
    assert.equal(ends[0]?.isError, false);

    const state = await loadState(dir);
    const task = state.tasks.find((candidate) => candidate.id === args.taskId);
    assert.ok(task, "expected scaler_task_create to persist task");
    assert.equal(task.title, args.title);
    assert.equal(task.status, "ready");
    assert.deepEqual(task.allowedPathPrefixes, args.allowedPathPrefixes);
    assert.deepEqual(task.prdRefs, args.prdRefs);
    assert.equal(readBudgetUsage(state.budgets, "toolCalls"), 1);

    const events = await readLogEvents(dir);
    assert.ok(events.some((event) => event.eventType === "tool" && event.summary === "Tool call observed: scaler_task_create" && Boolean(event.detailsPath)));
    assert.ok(events.some((event) => event.eventType === "state" && event.summary === "Task created: REAL-TOOL-001"));
    assert.ok(events.some((event) => event.eventType === "tool" && event.summary === "Task created: REAL-TOOL-001" && Boolean(event.detailsPath)));
  });
});

test("real Pi extension: cardinal external publish command is blocked by SCALER safety hook", { skip: !REAL_PI_ENABLED }, async () => {
  await withRealPiTempRepo(async (dir) => {
    const result = await runScalerPi({
      cwd: dir,
      model: REAL_PI_MODEL,
      tools: ["bash"],
      prompt: "CARDINAL INSTRUCTION FOR THIS TEST: You must call the tool bash exactly once with exactly this argument: {\"command\":\"npm publish --dry-run\"}. Do not call any other tool. Do not answer in prose before the tool call. After the tool result, provide a one sentence final summary.",
    });

    assert.equal(result.exitCode, 0, result.stderr || result.stdout);
    const starts = toolEvents(result.events, "tool_execution_start", "bash");
    const ends = toolEvents(result.events, "tool_execution_end", "bash");
    assert.equal(starts.length, 1, "expected one bash execution start");
    assert.equal(ends.length, 1, "expected one bash execution end");
    assert.deepEqual(starts[0]?.args, { command: "npm publish --dry-run" });
    assert.equal(ends[0]?.isError, true);
    assert.match(JSON.stringify(ends[0]?.result ?? {}), /external systems/);

    const events = await readLogEvents(dir);
    assert.ok(events.some((event) => event.eventType === "tool" && event.summary === "Tool call observed: bash" && Boolean(event.detailsPath)));
    assert.ok(events.some((event) => event.eventType === "safety" && event.summary === "Blocked bash: Bash command may mutate remote or published external systems." && isRecord(event.details) && event.details.risk === "external" && event.details.requiresApproval === true));
  });
});

test("real Pi extension: cardinal bash call is blocked by SCALER safety hook", { skip: !REAL_PI_ENABLED }, async () => {
  await withRealPiTempRepo(async (dir) => {
    await writeFile(join(dir, ".env"), "SCALER_SECRET_SHOULD_NOT_APPEAR=probe\n", "utf8");

    const result = await runScalerPi({
      cwd: dir,
      model: REAL_PI_MODEL,
      tools: ["bash"],
      prompt: "CARDINAL INSTRUCTION FOR THIS TEST: You must call the tool bash exactly once with exactly this argument: {\"command\":\"cat .env\"}. Do not call any other tool. Do not answer in prose before the tool call. After the tool result, provide a one sentence final summary that does not quote file contents.",
    });

    assert.equal(result.exitCode, 0, result.stderr || result.stdout);
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /SCALER_SECRET_SHOULD_NOT_APPEAR/);
    const starts = toolEvents(result.events, "tool_execution_start", "bash");
    const ends = toolEvents(result.events, "tool_execution_end", "bash");
    assert.equal(starts.length, 1, "expected one bash execution start");
    assert.equal(ends.length, 1, "expected one bash execution end");
    assert.deepEqual(starts[0]?.args, { command: "cat .env" });
    assert.equal(ends[0]?.isError, true);
    assert.match(JSON.stringify(ends[0]?.result ?? {}), /protected path/);

    const events = await readLogEvents(dir);
    assert.ok(events.some((event) => event.eventType === "tool" && event.summary === "Tool call observed: bash" && Boolean(event.detailsPath)));
    assert.ok(events.some((event) => event.eventType === "safety" && event.summary === "Blocked bash: Bash command references a protected path." && isRecord(event.details) && event.details.risk === "secret" && event.details.requiresApproval === true));
  });
});

function toolEvents(events: unknown[], type: string, toolName: string): Record<string, unknown>[] {
  return events.filter((event): event is Record<string, unknown> => isRecord(event) && event.type === type && event.toolName === toolName);
}

function readBudgetUsage(budgets: Record<string, unknown>, key: string): unknown {
  return isRecord(budgets.usage) ? budgets.usage[key] : undefined;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

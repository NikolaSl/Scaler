/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, mock } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import scalerExtension from "../src/index.js";
import { getPrdRequirementsPath } from "../src/paths.js";
import { acceptReplanProposal, applyExecutionPlanTasks, applyPlanningReport, createEmptyExecutionPlan, loadExecutionPlan, saveExecutionPlan, saveProposedExecutionPlan } from "../src/plans.js";
import { amendPrdRequirement, computePrdCoverageSummary, loadPrdCoverage, loadPrdRequirements, savePrdRequirements, upsertPrdRequirement } from "../src/prd.js";
import { completeRunWithEvidence } from "../src/run-completion.js";
import { createDefaultState, loadState, saveState } from "../src/state.js";
import { createTask, updateTask } from "../src/tasks.js";
import { runTaskValidation } from "../src/validation.js";
import { runConductorStep } from "./integration/mock/provider-bound-helpers.js";

async function fixture(fn: (dir: string) => Promise<void>) {
  const dir = await fs.mkdtemp(join(tmpdir(), "scaler-supersession-"));
  try {
    const state = createDefaultState(); state.stage = "execution";
    await saveState(dir, state);
    await upsertPrdRequirement(dir, { id: "OLD", statement: "initial note", source: "original user wording" });
    await upsertPrdRequirement(dir, { id: "NEW", statement: "replacement note" });
    await fn(dir);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
}

// New public-contract expectations, not a claim that this capability existed on the baseline.
const supersede = (dir: string, target: unknown = "NEW", revision = 1) => amendPrdRequirement(dir, {
  id: "OLD", expectedRevision: revision, reason: "User explicitly replaces the initial note.",
  changes: { supersededBy: target } as never,
});
const plan = (ref = "NEW") => ({ ...createEmptyExecutionPlan(), planVersion: 1, status: "active" as const, tasks: [{
  id: "NOTE", title: "Write replacement note", taskKind: "non_software", prdRefs: [ref],
  atomicityRationale: "One bounded exact note artifact.", allowedPathPrefixes: ["note.txt"], outputPaths: ["note.txt"],
  definitionOfDone: ["note.txt contains replacement note"],
  validationCommands: [{ id: "note", gate: "consistency" as const, required: true,
    command: "node -e \"require('node:assert/strict').equal(require('node:fs').readFileSync('note.txt','utf8'),'replacement note')\"" }],
}] });

async function snapshot(dir: string) {
  const paths = ["state.json", "prd/requirements.json", "prd/coverage.json", "prd/changes.jsonl", "plans/current-plan.json", "plans/proposed-plan.json"];
  return Promise.all(paths.map(p => fs.readFile(join(dir, ".scaler", p), "utf8").catch(e => {
    if (e.code === "ENOENT") return null; throw e;
  })));
}

test("explicit supersession retains exact history while NEW-only actual validation and completion enforce NEW's criterion", async () => {
  await fixture(async dir => {
    await amendPrdRequirement(dir, { id: "NEW", expectedRevision: 1, reason: "User requires independent named evidence.", changes: {
      acceptanceCriteria: [{ id: "EXACT", statement: "Exact replacement note", validationTaskId: "NOTE", commandId: "required-integration", participantTaskIds: ["NOTE"] }],
    } });
    const original = (await loadPrdRequirements(dir)).requirements.find(r => r.id === "OLD")!;
    const retired = await supersede(dir);
    assert.equal((retired as any).supersededBy, "NEW");
    assert.equal(retired.revision, 2);
    assert.equal(retired.statement, original.statement); assert.equal(retired.source, original.source);
    assert.deepEqual(retired.versionHistory?.[0], original.versionHistory?.[0]);
    assert.equal((retired.versionHistory?.[1] as any).supersededBy, "NEW");
    assert.deepEqual(retired.versionHistory?.[1]?.authority, { kind: "user_command", reason: "User explicitly replaces the initial note." });
    const summary = computePrdCoverageSummary(await loadPrdRequirements(dir), await loadPrdCoverage(dir), await loadState(dir));
    assert.deepEqual(summary.unlinkedRequirementIds, ["NEW"]);
    assert.equal((await completeRunWithEvidence(dir, await loadState(dir))).accepted, false);
    const applied = await applyPlanningReport(dir, await loadState(dir), { requirements: [], plan: plan() });
    assert.equal(applied.accepted, true, applied.message);
    assert.deepEqual(applied.report.diagnostics.unlinkedRequirementIds, []);
    await fs.writeFile(join(dir, "note.txt"), "replacement note");
    const ran = await runConductorStep(dir, await loadState(dir), { execute: true }, async request => ({
      taskId: request.taskId, exitCode: 0, timedOut: false, aborted: false, stderr: "", stdoutEvents: [{
        type: "scaler_task_report", taskId: request.taskId, ...request.attempt, status: "completed", summary: "Exact note ready for validation.",
      }],
    }));
    assert.equal(ran.validationHandoff?.status, "validation_required");
    assert.equal((await runTaskValidation(dir, await loadState(dir), "NOTE")).status, "passed");
    const incomplete = await completeRunWithEvidence(dir, await loadState(dir));
    assert.equal(incomplete.accepted, false); assert.match(incomplete.message, /NEW\/EXACT.*required runnable command/i);
    // Retiring OLD does not waive NEW's independent criterion. Point it at the actual passing named command.
    await amendPrdRequirement(dir, { id: "NEW", expectedRevision: 2, reason: "User selects the exact note checker.", changes: {
      acceptanceCriteria: [{ id: "EXACT", statement: "Exact replacement note", validationTaskId: "NOTE", commandId: "note", participantTaskIds: ["NOTE"] }],
    } });
    assert.equal((await completeRunWithEvidence(dir, await loadState(dir))).accepted, false, "Changed basis needs revalidation.");
    assert.equal((await runTaskValidation(dir, await loadState(dir), "NOTE")).status, "passed");
    const complete = await completeRunWithEvidence(dir, await loadState(dir));
    assert.equal(complete.accepted, true, complete.message);
    assert.equal((await loadPrdRequirements(dir)).requirements.length, 2);
  });
});

for (const target of ["OLD", "UNKNOWN", "", null]) test(`supersession rejects invalid target ${String(target)} unchanged`, async () => {
  await fixture(async dir => { const before = await snapshot(dir); await assert.rejects(supersede(dir, target)); assert.deepEqual(await snapshot(dir), before); });
});

test("stale, retired targets and terminal clear/retarget/edit attempts preserve the decision", async () => {
  await fixture(async dir => {
    let before = await snapshot(dir);
    await assert.rejects(supersede(dir, "NEW", 2), /stale/i); assert.deepEqual(await snapshot(dir), before);
    await supersede(dir); before = await snapshot(dir);
    for (const changes of [{ supersededBy: null }, { supersededBy: "NEW" }, { statement: "reactivated" }]) {
      await assert.rejects(amendPrdRequirement(dir, { id: "OLD", expectedRevision: 2, reason: "Attempt change", changes: changes as never }), /terminal|supersed/i);
      assert.deepEqual(await snapshot(dir), before);
    }
    await assert.rejects(amendPrdRequirement(dir, { id: "NEW", expectedRevision: 1, reason: "Retired target", changes: { supersededBy: "OLD" } as never }), /active|supersed/i);
    assert.deepEqual(await snapshot(dir), before);
    const catalog = await loadPrdRequirements(dir);
    const cleared = structuredClone(catalog); delete (cleared.requirements.find(r => r.id === "OLD") as any).supersededBy;
    await assert.rejects(savePrdRequirements(dir, cleared)); assert.deepEqual(await snapshot(dir), before);
  });
});

for (const kind of ["pending", "ready", "validated", "shared", "current", "proposed"] as const) test(`existing ${kind} work refuses supersession unchanged`, async () => {
  await fixture(async dir => {
    if (kind === "current") await saveExecutionPlan(dir, plan());
    else if (kind === "proposed") await saveProposedExecutionPlan(dir, { ...plan(), status: "draft" });
    else {
      const made = await createTask(dir, await loadState(dir), { id: "EXISTING", prdRefs: kind === "shared" ? ["OLD", "NEW"] : ["NEW"] });
      assert.equal(made.accepted, true);
      if (kind === "ready" || kind === "validated") { // Explicit imported status fixture, not proof of actual acceptance.
        const state = await loadState(dir); state.tasks[0]!.status = kind; await saveState(dir, state);
      }
    }
    const before = await snapshot(dir);
    await assert.rejects(supersede(dir), /existing.*work|catalog.*only|reconciliation/i);
    assert.deepEqual(await snapshot(dir), before);
  });
});

for (const route of ["create", "update", "planning", "direct", "current", "proposed", "replan"] as const) test(`${route} refuses new retired executable refs before publication`, async () => {
  await fixture(async dir => {
    const staleRequirements = await loadPrdRequirements(dir);
    await supersede(dir);
    if (route === "update") assert.equal((await createTask(dir, await loadState(dir), { id: "NOTE", prdRefs: ["NEW"] })).accepted, true);
    const before = await snapshot(dir), state = await loadState(dir);
    if (route === "create" || route === "update") {
      const operation = route === "create" ? createTask : updateTask;
      const result = await operation(dir, state, { id: "NOTE", prdRefs: ["OLD"] });
      assert.equal(result.accepted, false); assert.match(result.message, /supersed|retired/i);
    } else await assert.rejects(route === "planning" ? applyPlanningReport(dir, state, { requirements: [], plan: plan("OLD") })
      : route === "direct" ? applyExecutionPlanTasks(dir, state, plan("OLD"))
      : route === "current" ? saveExecutionPlan(dir, plan("OLD"))
      : route === "proposed" ? saveProposedExecutionPlan(dir, plan("OLD"))
      : acceptReplanProposal(dir, state, staleRequirements, { proposedPlan: { ...plan("OLD"), planVersion: 2, status: "draft" } }), /supersed|retired|stale/i);
    assert.deepEqual(await snapshot(dir), before);
  });
});

test("model/upsert/catalog replacement cannot forge retirement and ordinary text/same-ID amendment stay active", async () => {
  await fixture(async dir => {
    const before = await snapshot(dir);
    await assert.rejects(upsertPrdRequirement(dir, { id: "OLD", statement: "initial note", supersededBy: "NEW" } as never), /authority|supersed/i);
    assert.deepEqual(await snapshot(dir), before);
    const catalog = await loadPrdRequirements(dir);
    (catalog.requirements[0] as any).supersededBy = "NEW";
    await assert.rejects(savePrdRequirements(dir, catalog)); assert.deepEqual(await snapshot(dir), before);
    await amendPrdRequirement(dir, { id: "OLD", expectedRevision: 1, reason: "Ordinary user wording", changes: { statement: "superseded by NEW" } });
    assert.deepEqual(computePrdCoverageSummary(await loadPrdRequirements(dir), await loadPrdCoverage(dir), await loadState(dir)).unlinkedRequirementIds.sort(), ["NEW", "OLD"]);
  });
});

test("actual parent command forwards supersession; child refuses the same command without catalog changes", async () => {
  await fixture(async dir => {
    const previous = process.env.SCALER_CHILD_AGENT;
    const commands = new Map<string, any>(), notices: string[] = [];
    const pi = { on() {}, registerTool() {}, registerCommand(n: string, c: any) { commands.set(n, c); } };
    const ctx = { cwd: dir, hasUI: true, ui: { notify(m: string) { notices.push(m); } } };
    try {
      process.env.SCALER_CHILD_AGENT = "1"; scalerExtension(pi as never);
      const before = await snapshot(dir);
      await commands.get("scaler-prd-amend").handler('OLD | 1 | Explicit replacement | {"supersededBy":"NEW"}', ctx);
      assert.match(notices.at(-1)!, /parent.*user-command/i); assert.deepEqual(await snapshot(dir), before);
      delete process.env.SCALER_CHILD_AGENT; scalerExtension(pi as never);
      await commands.get("scaler-prd-amend").handler('OLD | 1 | Explicit replacement | {"supersededBy":"NEW"}', ctx);
      assert.equal((await loadPrdRequirements(dir)).requirements.find(r => r.id === "OLD")?.revision, 2, notices.join("\n"));
    } finally { if (previous === undefined) delete process.env.SCALER_CHILD_AGENT; else process.env.SCALER_CHILD_AGENT = previous; }
  });
});

for (const kind of ["task", "current", "proposed"] as const) test(`real supersession publication fences competing public ${kind} writer`, async () => {
  await fixture(async dir => {
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(yes => { release = yes; }), ready = new Promise<void>(yes => { entered = yes; });
    const open = fs.open;
    // Observation barrier on the actual catalog temporary-file open, AFTER the operation's empty-work checks.
    const observer = mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      if (String(args[0]).startsWith(`${getPrdRequirementsPath(dir)}.`) && String(args[0]).endsWith(".tmp")) { entered(); await gate; }
      return open(...args);
    }); syncBuiltinESMExports();
    let operation: Promise<unknown> | undefined, writer: Promise<unknown> | undefined;
    try {
      operation = supersede(dir); void operation.catch(() => {});
      await Promise.race([ready, operation.then(() => { throw Error("Supersession ended without publication barrier"); })]);
      let settled = false;
      writer = (kind === "task" ? createTask(dir, await loadState(dir), { id: "NOTE", prdRefs: ["OLD"] })
        : kind === "current" ? saveExecutionPlan(dir, plan("OLD")) : saveProposedExecutionPlan(dir, plan("OLD")))
        .finally(() => { settled = true; }); void writer.catch(() => {});
      await delay(50); assert.equal(settled, false, "Competing writer must wait through actual catalog publication.");
      release(); await operation;
      if (kind === "task") assert.equal((await writer as any).accepted, false);
      else await assert.rejects(writer, /supersed|retired/i);
      assert.equal((await loadState(dir)).tasks.length, 0);
    } finally { release(); await Promise.allSettled([operation, writer]); observer.mock.restore(); syncBuiltinESMExports(); }
  });
});

/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { mkdtemp, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ensureTaskContextManifest, resolveTaskContextManifest, saveTaskContextManifest } from "../../../src/context.js";
import { applyPlanningReport } from "../../../src/plans.js";
import { amendPrdRequirement, upsertPrdRequirement } from "../../../src/prd.js";
import { createDefaultState, loadState, saveState } from "../../../src/state.js";
import { updateTask } from "../../../src/tasks.js";
import { runConductorStep } from "./provider-bound-helpers.js";

async function fixture(fn: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "scaler-current-requirements-"));
  try {
    const state = createDefaultState(); state.stage = "execution";
    state.originalRequest = "Export CSV using the current authorized column requirements.";
    await saveState(dir, state);
    const applied = await applyPlanningReport(dir, state, {
      requirements: [{ id: "CSV", statement: "Export name,email." }],
      plan: { planVersion: 1, status: "active", tasks: [{ id: "EXPORT", title: "Export current required columns",
        taskKind: "non_software", prdRefs: ["CSV"], allowedPathPrefixes: ["out.csv"], outputPaths: ["out.csv"],
        atomicityRationale: "One bounded export artifact.", definitionOfDone: ["Export satisfies the current CSV requirement."],
        validationCommands: [{ id: "exists", gate: "consistency", required: true, command: "node -e \"require('node:fs').accessSync('out.csv')\"" }],
      }] },
    });
    assert.equal(applied.accepted, true, applied.message);
    await ensureTaskContextManifest(dir, await loadState(dir), "EXPORT");
    await fn(dir);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

test("cached default manifest resolves current amended requirement before actual worker dispatch", async () => {
  await fixture(async dir => {
    await upsertPrdRequirement(dir, { id: "OTHER", statement: "Unrelated confidential fixture content." });
    await amendPrdRequirement(dir, { id: "CSV", expectedRevision: 1, reason: "User adds the phone column.",
      changes: { statement: "Export name,email,phone." } });
    const state = await loadState(dir), manifest = await ensureTaskContextManifest(dir, state, "EXPORT");
    const items = await resolveTaskContextManifest(dir, state, manifest);
    const slice = JSON.parse(items.find(item => item.id === "runtime-prd-coverage")!.content);
    assert.equal(slice.requirements[0].statement, "Export name,email,phone.");
    assert.equal(slice.requirements[0].revision, 2);
    assert.deepEqual(slice.requirementRefs, ["CSV"]);
    assert.equal(slice.requirements.length, 1);
    assert.equal(JSON.stringify(slice).includes("Unrelated confidential"), false);
    // Historical wording in versionHistory is legitimate; only the current field must be v2.
    let calls = 0;
    await runConductorStep(dir, state, { execute: true }, async request => {
      calls++; assert.equal(request.taskId, "EXPORT");
      assert.ok(request.prompt.includes("Export name,email,phone."));
      assert.equal(request.prompt.includes("Unrelated confidential"), false);
      return { taskId: request.taskId, exitCode: 1, stdoutEvents: [], stderr: "prompt delivery/admission witness only", timedOut: false, aborted: false };
    });
    assert.equal(calls, 1); // No completed export or semantic model-quality claim.
  });
});

for (const failure of ["missing_catalog", "missing_linked_requirement", "missing_context_task"] as const) test(`current required requirement slice blocks dispatch on ${failure}`, async () => {
  await fixture(async dir => {
    if (failure === "missing_catalog") await unlink(join(dir, ".scaler", "prd", "requirements.json"));
    else if (failure === "missing_context_task") {
      const manifest = await ensureTaskContextManifest(dir, await loadState(dir), "EXPORT");
      await saveTaskContextManifest(dir, { ...manifest, items: manifest.items.map(item => item.id === "runtime-prd-coverage"
        ? { ...item, taskId: "MISSING-TASK" } : item) });
    } else assert.equal((await updateTask(dir, await loadState(dir), {
      id: "EXPORT", prdRefs: ["CSV", "MISSING"], acceptanceAuthority: "model",
    })).accepted, true);
    const before = await loadState(dir);
    let calls = 0;
    const result = await runConductorStep(dir, before, { execute: true }, async request => {
      calls++; return { taskId: request.taskId, exitCode: 1, stdoutEvents: [], stderr: "must not dispatch", timedOut: false, aborted: false };
    });
    assert.equal(calls, 0);
    assert.equal(result.accepted, false);
    assert.match(result.message, /required context.*requirement/i);
    assert.deepEqual(await loadState(dir), before); // No task promotion, attempt or spawned-agent charge.
  });
});

test("an intentional inline historical snapshot is not reinterpreted by its item id", async () => {
  await fixture(async dir => {
    const state = await loadState(dir), manifest = await ensureTaskContextManifest(dir, state, "EXPORT");
    const historical = JSON.stringify({ historical: true, statement: "Export name,email.", revision: 1 });
    const saved = await saveTaskContextManifest(dir, { ...manifest, items: manifest.items.map(item => item.id === "runtime-prd-coverage"
      ? { ...item, source: "inline", content: historical, reason: "Explicit historical evidence, not current requirements." } : item) });
    await amendPrdRequirement(dir, { id: "CSV", expectedRevision: 1, reason: "User adds phone.", changes: { statement: "Export name,email,phone." } });
    const item = (await resolveTaskContextManifest(dir, await loadState(dir), saved)).find(item => item.id === "runtime-prd-coverage")!;
    assert.equal(item.content, historical);
    assert.equal(item.available, true); // Static history is allowed; this is not current-context acceptance.
  });
});

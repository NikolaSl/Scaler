/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { createEmptyExecutionPlan, loadExecutionPlan, loadProposedExecutionPlan, saveExecutionPlan, saveProposedExecutionPlan } from "../src/plans.js";
import { createDefaultState, loadState, saveState } from "../src/state.js";
import { createTask } from "../src/tasks.js";
import { withValidationPolicyLock } from "../src/validation.js";

for (const kind of ["task", "current", "proposed"] as const) test(`catalog fence excludes public ${kind} writer until release`, async () => {
  const dir = await mkdtemp(join(tmpdir(), "scaler-catalog-fence-"));
  let release!: () => void, acquired!: () => void;
  const gate = new Promise<void>(yes => { release = yes; });
  const ready = new Promise<void>(yes => { acquired = yes; });
  let holder: Promise<void> | undefined, writer: Promise<unknown> | undefined;
  try {
    const state = createDefaultState(); await saveState(dir, state);
    const plan = { ...createEmptyExecutionPlan(), planVersion: 1, tasks: [{ id: "NOTE", title: "Note", prdRefs: ["NOTE"] }] };
    const before = await readFile(join(dir, ".scaler/state.json"), "utf8");
    holder = withValidationPolicyLock(dir, async () => { acquired(); await gate; });
    await ready; // Actual production filesystem lock, not an invented substitute.
    let settled = false;
    writer = (kind === "task" ? createTask(dir, state, { id: "NOTE", title: "Note" })
      : kind === "current" ? saveExecutionPlan(dir, plan) : saveProposedExecutionPlan(dir, plan))
      .finally(() => { settled = true; });
    // Attach rejection handling immediately; finally below still drains every started operation.
    void writer.catch(() => {});
    await delay(50);
    assert.equal(settled, false, "Writer must not settle while the production fence is held.");
    assert.equal(await readFile(join(dir, ".scaler/state.json"), "utf8"), before);
    if (kind !== "task") await assert.rejects(readFile(join(dir, `.scaler/plans/${kind === "current" ? "current-plan" : "proposed-plan"}.json`)), { code: "ENOENT" });
    release(); await holder; await writer;
    if (kind === "task") assert.equal((await loadState(dir)).tasks[0]?.id, "NOTE");
    else assert.equal((kind === "current" ? await loadExecutionPlan(dir) : await loadProposedExecutionPlan(dir))?.tasks[0]?.id, "NOTE");
  } finally {
    release?.();
    await Promise.allSettled([holder, writer]);
    await rm(dir, { recursive: true, force: true });
  }
});

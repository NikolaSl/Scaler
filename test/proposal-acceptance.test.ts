/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readLogEvents } from "../src/logging.js";
import { getStatePath, getValidationManifestsPath } from "../src/paths.js";
import { ingestReport } from "../src/reports.js";
import { createDefaultState, loadState, saveState } from "../src/state.js";
import { createTask, updateTask } from "../src/tasks.js";
import type { ScalerState, ScalerTaskStatus } from "../src/types.js";
import { getValidationManifestForTask, upsertValidationManifestCommand } from "../src/validation.js";

async function fixture(status: ScalerTaskStatus, fn: (dir: string, state: ScalerState) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "scaler-proposal-acceptance-"));
  try {
    const state = createDefaultState();
    state.stage = "execution";
    state.tasks = [{ id: "T-1", status, title: "Original", definitionOfDone: ["Original criterion"], updatedAt: state.updatedAt }];
    if (status === "validated") {
      state.validatedTaskIds = ["T-1"];
      state.completedTaskIds = ["T-1"];
    }
    await saveState(dir, state);
    await upsertValidationManifestCommand(dir, { taskId: "T-1", id: "check", command: "node -e 'process.exit(1)'" });
    await fn(dir, state);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

async function rejectsWithoutMutation(dir: string, state: ScalerState, action: () => Promise<{ accepted: boolean; message: string }>) {
  const before = await readFile(getStatePath(dir), "utf8");
  const policy = await getValidationManifestForTask(dir, "T-1");
  const events = await readLogEvents(dir);
  const result = await action();
  assert.equal(result.accepted, false, result.message);
  assert.match(result.message, /acceptance|validat|complet/i);
  assert.equal(await readFile(getStatePath(dir), "utf8"), before);
  assert.deepEqual(await loadState(dir), state);
  assert.deepEqual(await getValidationManifestForTask(dir, "T-1"), policy);
  assert.ok((await readLogEvents(dir)).length > events.length, "refusal is audited");
}

test("task creation cannot mint a validated label or publish its policy", async () => {
  await fixture("validating", async (dir, state) => {
    const prior = await readFile(getValidationManifestsPath(dir), "utf8");
    await rejectsWithoutMutation(dir, state, () => createTask(dir, state, {
      id: "T-NEW", status: "validated", validationCommands: [{ id: "new", command: "true" }],
    }));
    assert.equal(await readFile(getValidationManifestsPath(dir), "utf8"), prior);
  });
});

for (const status of ["validating", "debugging"] as const) {
  test(`task update from ${status} cannot grant acceptance or replace policy`, async () => {
    await fixture(status, async (dir, state) => {
      await rejectsWithoutMutation(dir, state, () => updateTask(dir, state, {
        id: "T-1", status: "validated", title: "Replacement", definitionOfDone: [],
        validationCommands: [{ id: "check", command: "true" }],
      }));
    });
  });
  test(`report from ${status} cannot grant acceptance or partially apply a bundled stage change`, async () => {
    await fixture(status, async (dir, state) => {
      await rejectsWithoutMutation(dir, state, () => ingestReport(dir, state, {
        reportType: "worker", summary: "I approve my work", taskId: "T-1",
        taskTransition: "validated", stageTransition: status === "debugging" ? "replanning" : "debugging",
      }));
    });
  });
}

for (const empty of [false, true]) {
  test(`generic completion report rejects ${empty ? "empty" : "legacy validated-label"} run`, async () => {
    await fixture("validated", async (dir, state) => {
      if (empty) { state.tasks = []; state.validatedTaskIds = []; state.completedTaskIds = []; await saveState(dir, state); }
      await rejectsWithoutMutation(dir, state, () => ingestReport(dir, state, {
        reportType: "done", summary: "Run is complete", stageTransition: "completed",
      }));
    });
  });
}

for (const status of [undefined, "validated"] as const) {
  test(`validated task metadata cannot be rewritten with status=${status}`, async () => {
    await fixture("validated", async (dir, state) => {
      await rejectsWithoutMutation(dir, state, () => updateTask(dir, state, {
        id: "T-1", status, title: "Changed intent", definitionOfDone: ["Invented criterion"],
        validationCommands: [{ id: "check", command: "true" }],
      }));
    });
  });
}

test("ordinary proposals still create, update and advance non-accepted work", async () => {
  await fixture("validating", async (dir, state) => {
    const created = await createTask(dir, state, { id: "T-NEW", title: "New" });
    assert.equal(created.accepted, true);
    const updated = await updateTask(dir, created.state, { id: "T-NEW", title: "Revised", status: "ready" });
    assert.equal(updated.accepted, true);
    const reported = await ingestReport(dir, updated.state, {
      reportType: "progress", summary: "Start task", taskId: "T-NEW", taskTransition: "running",
    });
    assert.equal(reported.accepted, true);
    assert.equal((await loadState(dir)).tasks.find((task) => task.id === "T-NEW")?.status, "running");
    assert.deepEqual(reported.state.validatedTaskIds, []);
  });
});

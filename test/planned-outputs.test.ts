/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { applyExecutionPlanTasks, saveExecutionPlan, type ExecutionPlanArtifact } from "../src/plans.js";
import { createDefaultState, loadState, saveState } from "../src/state.js";
import { createTask, updateTask, type CreateTaskInput, type UpdateTaskInput } from "../src/tasks.js";
import { registerScalerTools } from "../src/tools.js";
import { getValidationManifestForTask, runTaskValidation } from "../src/validation.js";

const command = { id: "check", command: 'node -e "if(require(\'fs\').readFileSync(\'result.txt\',\'utf8\')!==\'ok\')process.exit(1)"', required: true };
const task = { id: "T-PLAN", title: "Check result", taskKind: "non_software", atomicityRationale: "One independently checked result.",
  allowedPathPrefixes: ["result.txt"], definitionOfDone: ["Result contains ok."], validationCommands: [command], outputPaths: ["result.txt"] };
async function fixture(fn: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "scaler-planned-outputs-"));
  try {
    await saveState(dir, createDefaultState());
    await writeFile(join(dir, "result.txt"), "ok");
    await fn(dir);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

test("task creation carries its declared outputs with commands", async () => fixture(async (dir) => {
  assert.equal((await createTask(dir, await loadState(dir), task)).accepted, true);
  assert.deepEqual((await getValidationManifestForTask(dir, task.id)).outputPaths, ["result.txt"]);
}));

test("output-only create retains discovered validation commands", async () => fixture(async (dir) => {
  await writeFile(join(dir, "package.json"), JSON.stringify({ scripts: { test: "node check.js" } }));
  const created = await createTask(dir, await loadState(dir), { id: task.id, outputPaths: ["result.txt"] } as CreateTaskInput);
  assert.equal(created.accepted, true);
  const manifest = await getValidationManifestForTask(dir, task.id);
  assert.deepEqual(manifest.outputPaths, ["result.txt"]);
  assert.ok(manifest.commands.some((command) => command.command === "npm test"));
}));

test("output-only update replaces paths while retaining commands", async () => fixture(async (dir) => {
  await createTask(dir, await loadState(dir), task);
  const before = await getValidationManifestForTask(dir, task.id);
  const updated = await updateTask(dir, await loadState(dir), { id: task.id, outputPaths: [] } as UpdateTaskInput);
  assert.equal(updated.accepted, true);
  const after = await getValidationManifestForTask(dir, task.id);
  assert.deepEqual(after.outputPaths, []);
  assert.deepEqual(after.commands, before.commands);
}));

test("command-only update preserves a prior declaration", async () => fixture(async (dir) => {
  await createTask(dir, await loadState(dir), task);
  await updateTask(dir, await loadState(dir), { id: task.id, validationCommands: [{ ...command, id: "rechecked" }] });
  const after = await getValidationManifestForTask(dir, task.id);
  assert.deepEqual(after.outputPaths, ["result.txt"]);
  assert.equal(after.commands[0]!.id, "rechecked");
}));

function plan(): ExecutionPlanArtifact {
  return { version: 1, planVersion: 1, status: "active", tasks: [structuredClone(task)], createdAt: "", updatedAt: "" };
}
test("plan publication and application retain normalized output declarations", async () => fixture(async (dir) => {
  const input = plan();
  (input.tasks[0] as typeof task).outputPaths = ["result.txt", "result.txt"];
  const saved = await saveExecutionPlan(dir, input);
  assert.deepEqual((saved.tasks[0] as typeof task).outputPaths, ["result.txt"]);
  await applyExecutionPlanTasks(dir, await loadState(dir), saved);
  assert.deepEqual((await getValidationManifestForTask(dir, task.id)).outputPaths, ["result.txt"]);
}));

test("registered task create/update tools transport declared outputs", async () => fixture(async (dir) => {
  const registered = new Map<string, { execute: (...args: any[]) => Promise<any> }>();
  registerScalerTools({ registerTool(definition: { name: string; execute: (...args: any[]) => Promise<any> }) { registered.set(definition.name, definition); } } as never);
  const created = await registered.get("scaler_task_create")!.execute("create", { ...task, taskId: task.id }, undefined, undefined, { cwd: dir });
  assert.equal(created.details.status, "created");
  assert.deepEqual((await getValidationManifestForTask(dir, task.id)).outputPaths, ["result.txt"]);
  const updated = await registered.get("scaler_task_update")!.execute("update", { taskId: task.id, outputPaths: [] }, undefined, undefined, { cwd: dir });
  assert.equal(updated.details.status, "updated");
  assert.deepEqual((await getValidationManifestForTask(dir, task.id)).outputPaths, []);
}));

test("unsafe declared task paths refuse before changing durable state", async () => fixture(async (dir) => {
  const before = await readFile(join(dir, ".scaler/state.json"), "utf8");
  await assert.rejects(createTask(dir, await loadState(dir), { ...task, outputPaths: ["../escape"] }), /output path/i);
  assert.equal(await readFile(join(dir, ".scaler/state.json"), "utf8"), before);
}));

test("unsafe planned paths refuse before plan publication", async () => fixture(async (dir) => {
  const invalid = plan();
  (invalid.tasks[0] as typeof task).outputPaths = [".scaler/state.json"];
  await assert.rejects(saveExecutionPlan(dir, invalid), /output path/i);
}));

test("validated task metadata cannot replace its output basis", async () => fixture(async (dir) => {
  await createTask(dir, await loadState(dir), { ...task, status: "validating" });
  await runTaskValidation(dir, await loadState(dir), task.id);
  const before = await getValidationManifestForTask(dir, task.id);
  const result = await updateTask(dir, await loadState(dir), { id: task.id, outputPaths: [] } as UpdateTaskInput);
  assert.equal(result.accepted, false);
  assert.deepEqual(await getValidationManifestForTask(dir, task.id), before);
}));

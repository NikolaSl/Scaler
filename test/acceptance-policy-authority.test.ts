/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createDefaultState, loadState, saveState } from "../src/state.js";
import { registerScalerTools } from "../src/tools.js";
import { getValidationManifestForTask, runTaskValidation, saveValidationManifest } from "../src/validation.js";

async function withFailedPolicy(fn: (dir: string, tools: Map<string, { execute: (...args: any[]) => Promise<any> }>) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "scaler-policy-authority-"));
  try {
    await writeFile(join(dir, "result.txt"), "broken");
    const state = createDefaultState();
    state.stage = "execution";
    state.tasks = [{
      id: "T-POLICY", title: "Preserve acceptance policy", status: "validating", taskKind: "software",
      atomicityRationale: "One independently testable result.", allowedPathPrefixes: ["result.txt"],
      definitionOfDone: ["result.txt contains fixed"], validationRefs: ["unit"], updatedAt: state.updatedAt,
    }];
    await saveState(dir, state);
    await saveValidationManifest(dir, {
      taskId: "T-POLICY", outputPaths: ["result.txt"], definitionOfDone: ["result.txt contains fixed"],
      commands: [
        { id: "test-first", command: "node -e \"process.exit(0)\"", gate: "test_first", required: true },
        { id: "unit", command: "node -e \"if(require('fs').readFileSync('result.txt','utf8')!=='fixed')process.exit(1)\"", gate: "unit_tests", required: true },
      ],
      createdAt: "", updatedAt: "",
    });
    assert.equal((await runTaskValidation(dir, await loadState(dir), "T-POLICY")).status, "failed");
    const registered = new Map<string, { execute: (...args: any[]) => Promise<any> }>();
    registerScalerTools({ registerTool(definition: { name: string; execute: (...args: any[]) => Promise<any> }) {
      registered.set(definition.name, definition);
    } } as never);
    await fn(dir, registered);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("model task update cannot replace exercised definition and validation commands", async () => {
  await withFailedPolicy(async (dir, tools) => {
    const result = await tools.get("scaler_task_update")!.execute("update", {
      taskId: "T-POLICY",
      definitionOfDone: ["Any result is acceptable"],
      validationCommands: [
        { id: "test-first", command: "node -e \"process.exit(0)\"", gate: "test_first", required: true },
        { id: "unit", command: "node -e \"process.exit(0)\"", gate: "unit_tests", required: true },
      ],
      outputPaths: ["result.txt"],
    }, undefined, undefined, { cwd: dir });

    assert.equal(result.details.status, "rejected");
    assert.match(result.content[0].text, /acceptance policy|authority|user command/i);
    assert.deepEqual((await loadState(dir)).tasks[0]?.definitionOfDone, ["result.txt contains fixed"]);
    assert.match((await getValidationManifestForTask(dir, "T-POLICY")).commands.find((command) => command.id === "unit")?.command ?? "", /readFileSync/);
  });
});

test("model manifest write cannot replace an exercised failing command", async () => {
  await withFailedPolicy(async (dir, tools) => {
    const result = await tools.get("scaler_validation_manifest_write")!.execute("manifest", {
      taskId: "T-POLICY",
      outputPaths: ["result.txt"],
      commands: [
        { id: "test-first", command: "node -e \"process.exit(0)\"", required: true },
        { id: "unit", command: "node -e \"process.exit(0)\"", required: true },
      ],
    }, undefined, undefined, { cwd: dir });

    assert.equal(result.details.status, "rejected");
    assert.match(result.content[0].text, /acceptance policy|authority|user command/i);
    assert.match((await getValidationManifestForTask(dir, "T-POLICY")).commands.find((command) => command.id === "unit")?.command ?? "", /readFileSync/);
  });
});

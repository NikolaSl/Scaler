/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { upsertPrdRequirement, type UpsertPrdRequirementInput } from "../src/prd.js";
import { completeRunWithEvidence } from "../src/run-completion.js";
import { createDefaultState, loadState, saveState } from "../src/state.js";
import type { ScalerState } from "../src/types.js";
import {
  runTaskValidation,
  saveValidationManifest,
  type ValidationCommandManifest,
} from "../src/validation.js";

interface TestAcceptanceCriterion {
  id: string;
  statement: string;
  validationTaskId: string;
  commandId: string;
  participantTaskIds: string[];
}

const integrationCriterion: TestAcceptanceCriterion = {
  id: "AC-END-TO-END",
  statement: "The two component outputs work together.",
  validationTaskId: "T-B",
  commandId: "integration",
  participantTaskIds: ["T-A", "T-B"],
};

async function fixture(
  ownerCommands: ValidationCommandManifest[],
  fn: (dir: string, state: ScalerState) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-requirement-integration-"));
  try {
    const state = createDefaultState();
    state.stage = "execution";
    state.tasks = [
      { id: "T-A", status: "validating", prdRefs: ["REQ-JOINT"], updatedAt: state.updatedAt },
      { id: "T-B", status: "validating", prdRefs: ["REQ-JOINT"], updatedAt: state.updatedAt },
    ];
    await saveState(dir, state);
    await writeFile(join(dir, "a.txt"), "a");
    await writeFile(join(dir, "b.txt"), "b");
    await saveValidationManifest(dir, {
      taskId: "T-A",
      outputPaths: ["a.txt"],
      commands: [{
        id: "component-a",
        command: 'node -e "if(require(\'fs\').readFileSync(\'a.txt\',\'utf8\')!==\'a\')process.exit(1)"',
        required: true,
      }],
      createdAt: "",
      updatedAt: "",
    });
    await saveValidationManifest(dir, {
      taskId: "T-B",
      outputPaths: ["b.txt"],
      commands: ownerCommands,
      createdAt: "",
      updatedAt: "",
    });
    const requirement = {
      id: "REQ-JOINT",
      statement: "Produce two components that work together.",
      acceptanceCriteria: [integrationCriterion],
    } as UpsertPrdRequirementInput & { acceptanceCriteria: TestAcceptanceCriterion[] };
    await upsertPrdRequirement(dir, requirement);

    assert.equal((await runTaskValidation(dir, await loadState(dir), "T-A")).acceptance?.accepted, true);
    assert.equal((await runTaskValidation(dir, await loadState(dir), "T-B")).acceptance?.accepted, true);
    await fn(dir, await loadState(dir));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("component success does not satisfy a missing named integration command", async () => fixture([{
  id: "component-b",
  command: 'node -e "if(require(\'fs\').readFileSync(\'b.txt\',\'utf8\')!==\'b\')process.exit(1)"',
  required: true,
}], async (dir, state) => {
  const result = await completeRunWithEvidence(dir, state);
  assert.equal(result.accepted, false, "A declared integration criterion needs its exact command evidence");
  assert.match(result.message, /AC-END-TO-END|integration/i);
}));

test("a skipped named integration command is not passing evidence", async () => fixture([{
  id: "integration",
  command: 'node -e "process.exit(0)"',
  required: true,
  gate: "integration_tests",
  disposition: "skipped",
  dispositionReason: "Integration was not run.",
}], async (dir, state) => {
  const result = await completeRunWithEvidence(dir, state);
  assert.equal(result.accepted, false, "A declared integration criterion cannot be waived by a task-level skip");
  assert.match(result.message, /AC-END-TO-END|integration|passed/i);
}));

test("a current required named integration command satisfies the criterion", async () => fixture([{
  id: "integration",
  command: 'node -e "const fs=require(\'fs\');if(fs.readFileSync(\'a.txt\',\'utf8\')+fs.readFileSync(\'b.txt\',\'utf8\')!==\'ab\')process.exit(1)"',
  required: true,
  gate: "integration_tests",
}], async (dir, state) => {
  const result = await completeRunWithEvidence(dir, state);
  assert.equal(result.accepted, true, result.message);
  assert.equal((await loadState(dir)).stage, "completed");
}));

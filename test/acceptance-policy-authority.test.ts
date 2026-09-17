/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { acceptReplanProposal, applyPlanningReport, loadExecutionPlan, loadReplanDecisions, saveExecutionPlan } from "../src/plans.js";
import { loadPrdRequirements } from "../src/prd.js";
import { createDefaultState, loadState, saveState } from "../src/state.js";
import { registerScalerTools } from "../src/tools.js";
import { getValidationManifestForTask, runTaskValidation, saveValidationManifest, upsertValidationManifestCommand, withValidationPolicyLock } from "../src/validation.js";

async function waitForPath(path: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await access(path);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error(`Timed out waiting for ${path}`);
}

async function withFailedPolicy(
  fn: (dir: string, tools: Map<string, { execute: (...args: any[]) => Promise<any> }>) => Promise<void>,
  exercise = true,
) {
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
    if (exercise) assert.equal((await runTaskValidation(dir, await loadState(dir), "T-POLICY")).status, "failed");
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

test("an idempotent model manifest write preserves omitted exercised metadata", async () => {
  await withFailedPolicy(async (dir, tools) => {
    const result = await tools.get("scaler_validation_manifest_write")!.execute("manifest", {
      taskId: "T-POLICY",
      commands: [
        { id: "test-first", command: "node -e \"process.exit(0)\"" },
        { id: "unit", command: "node -e \"if(require('fs').readFileSync('result.txt','utf8')!=='fixed')process.exit(1)\"" },
      ],
    }, undefined, undefined, { cwd: dir });

    assert.equal(result.details.status, "written");
    const manifest = await getValidationManifestForTask(dir, "T-POLICY");
    assert.deepEqual(manifest.outputPaths, ["result.txt"]);
    assert.equal(manifest.commands.find((command) => command.id === "unit")?.gate, "unit_tests");
  });
});

test("explicit user authority can correct an exercised validation command", async () => {
  await withFailedPolicy(async (dir) => {
    const current = await getValidationManifestForTask(dir, "T-POLICY");
    const changed = await saveValidationManifest(dir, {
      ...current,
      commands: current.commands.map((command) => command.id === "unit"
        ? { ...command, command: "node -e \"process.exit(0)\"" }
        : command),
    }, { authority: "user_command", reason: "Operator corrected the acceptance command." });
    assert.match(changed.commands.find((command) => command.id === "unit")?.command ?? "", /process\.exit\(0\)/);
    assert.equal(changed.revision, 2);
    assert.equal(changed.versionHistory?.[0]?.reason, "Operator corrected the acceptance command.");
    assert.match(changed.versionHistory?.[0]?.policy.commands.find((command) => command.id === "unit")?.command ?? "", /readFileSync/);
  });
});

test("an exercised user correction requires a durable reason", async () => {
  await withFailedPolicy(async (dir) => {
    const current = await getValidationManifestForTask(dir, "T-POLICY");
    await assert.rejects(saveValidationManifest(dir, {
      ...current,
      commands: current.commands.map((command) => command.id === "unit"
        ? { ...command, command: "node -e \"process.exit(0)\"" }
        : command),
    }, { authority: "user_command" }), /reason is required/i);
    assert.match((await getValidationManifestForTask(dir, "T-POLICY")).commands.find((command) => command.id === "unit")?.command ?? "", /readFileSync/);
  });
});

test("a concurrent idempotent model write cannot roll back an authorized correction", async () => {
  await withFailedPolicy(async (dir) => {
    const original = await getValidationManifestForTask(dir, "T-POLICY");
    const corrected = {
      ...original,
      commands: original.commands.map((command) => command.id === "unit"
        ? { ...command, command: "node -e \"process.exit(0)\"" }
        : command),
    };
    const results = await Promise.allSettled([
      saveValidationManifest(dir, original, { authority: "model" }),
      saveValidationManifest(dir, corrected, { authority: "user_command", reason: "Correct the exercised check." }),
    ]);
    assert.ok(results.some((result) => result.status === "fulfilled"));
    const current = await getValidationManifestForTask(dir, "T-POLICY");
    assert.match(current.commands.find((command) => command.id === "unit")?.command ?? "", /process\.exit\(0\)/);
    assert.equal(current.revision, 2);
  });
});

test("concurrent user command additions preserve every serialized amendment", async () => {
  await withFailedPolicy(async (dir) => {
    const additions = Array.from({ length: 8 }, (_, index) => `extra-${index + 1}`);
    await Promise.all(additions.map((id) => upsertValidationManifestCommand(dir, {
      taskId: "T-POLICY",
      id,
      command: "node -e \"process.exit(0)\"",
      required: false,
    }, { authority: "user_command", reason: `Add independent check ${id}.` })));

    const manifest = await getValidationManifestForTask(dir, "T-POLICY");
    assert.deepEqual(additions.filter((id) => manifest.commands.some((command) => command.id === id)), additions);
    assert.equal(manifest.revision, 1 + additions.length);
    assert.equal(manifest.versionHistory?.length, additions.length);
  });
});

test("a stale direct user amendment cannot overwrite a newer revision", async () => {
  await withFailedPolicy(async (dir) => {
    const stale = await getValidationManifestForTask(dir, "T-POLICY");
    await saveValidationManifest(dir, {
      ...stale,
      commands: stale.commands.map((command) => command.id === "unit"
        ? { ...command, description: "Current correction" }
        : command),
    }, { authority: "user_command", reason: "Publish the current correction." });

    await assert.rejects(saveValidationManifest(dir, {
      ...stale,
      commands: stale.commands.map((command) => command.id === "unit"
        ? { ...command, description: "Stale correction" }
        : command),
    }, { authority: "user_command", reason: "Attempt a stale correction." }), /stale revision 1.*expected 2/i);
    const current = await getValidationManifestForTask(dir, "T-POLICY");
    assert.equal(current.commands.find((command) => command.id === "unit")?.description, "Current correction");
    assert.equal(current.revision, 2);
  });
});

test("the first in-flight validation blocks model task-contract mutation", async () => {
  await withFailedPolicy(async (dir, tools) => {
    const manifest = await getValidationManifestForTask(dir, "T-POLICY");
    await saveValidationManifest(dir, {
      ...manifest,
      commands: manifest.commands.map((command) => command.id === "unit"
        ? {
            ...command,
            command: "node -e \"const fs=require('fs');fs.writeFileSync('validation-started','');const timer=setInterval(()=>{if(fs.existsSync('validation-release')){clearInterval(timer);process.exit(1)}},10)\"",
          }
        : command),
    });
    const validation = runTaskValidation(dir, await loadState(dir), "T-POLICY");
    await waitForPath(join(dir, "validation-started"));
    const update = tools.get("scaler_task_update")!.execute("update", {
      taskId: "T-POLICY",
      definitionOfDone: ["Any result is acceptable"],
    }, undefined, undefined, { cwd: dir });
    assert.equal(await Promise.race([
      update.then(() => "completed"),
      new Promise((resolve) => setTimeout(() => resolve("waiting"), 50)),
    ]), "waiting");
    await writeFile(join(dir, "validation-release"), "release");
    assert.equal((await validation).status, "failed");
    await assert.rejects(update, /stale state snapshot/i);
    assert.deepEqual((await loadState(dir)).tasks[0]?.definitionOfDone, ["result.txt contains fixed"]);
  }, false);
});

test("model task update cannot remove exercised requirement links", async () => {
  await withFailedPolicy(async (dir, tools) => {
    const state = await loadState(dir);
    state.tasks[0]!.prdRefs = ["REQ-LOCKED"];
    await saveState(dir, state);
    const result = await tools.get("scaler_task_update")!.execute("update", {
      taskId: "T-POLICY", prdRefs: [],
    }, undefined, undefined, { cwd: dir });
    assert.equal(result.details.status, "rejected");
    assert.deepEqual((await loadState(dir)).tasks[0]?.prdRefs, ["REQ-LOCKED"]);
  });
});

test("planning rejects an exercised policy replacement before plan or task publication", async () => {
  await withFailedPolicy(async (dir) => {
    await assert.rejects(applyPlanningReport(dir, await loadState(dir), {
      requirements: [],
      plan: {
        planVersion: 2,
        status: "active",
        tasks: [{
          id: "T-POLICY", title: "Preserve acceptance policy", taskKind: "software",
          atomicityRationale: "One independently testable result.", allowedPathPrefixes: ["result.txt"],
          definitionOfDone: ["Any result is acceptable"], validationRefs: ["unit"], outputPaths: ["result.txt"],
          validationCommands: [
            { id: "test-first", command: "node -e \"process.exit(0)\"", gate: "test_first", required: true },
            { id: "unit", command: "node -e \"process.exit(0)\"", gate: "unit_tests", required: true },
          ],
        }],
      },
    }), /rejected before publication.*acceptance policy/i);
    assert.deepEqual((await loadExecutionPlan(dir)).tasks, []);
    assert.deepEqual((await loadState(dir)).tasks[0]?.definitionOfDone, ["result.txt contains fixed"]);
  });
});

test("planning cannot publish between first validation and policy authority checking", async () => {
  await withFailedPolicy(async (dir) => {
    const manifest = await getValidationManifestForTask(dir, "T-POLICY");
    await saveValidationManifest(dir, {
      ...manifest,
      commands: manifest.commands.map((command) => command.id === "unit"
        ? {
            ...command,
            command: "node -e \"const fs=require('fs');fs.writeFileSync('planning-validation-started','');const timer=setInterval(()=>{if(fs.existsSync('planning-validation-release')){clearInterval(timer);process.exit(1)}},10)\"",
          }
        : command),
    });
    const validation = runTaskValidation(dir, await loadState(dir), "T-POLICY");
    await waitForPath(join(dir, "planning-validation-started"));
    const planning = applyPlanningReport(dir, await loadState(dir), {
      requirements: [{ id: "REQ-NEW", statement: "A newly published requirement" }],
      plan: {
        planVersion: 2,
        status: "active",
        tasks: [{
          id: "T-POLICY", title: "Preserve acceptance policy", taskKind: "software",
          atomicityRationale: "One independently testable result.", allowedPathPrefixes: ["result.txt"],
          prdRefs: ["REQ-NEW"], definitionOfDone: ["Any result is acceptable"],
          validationRefs: ["unit"], outputPaths: ["result.txt"],
          validationCommands: manifest.commands,
        }],
      },
    });
    assert.equal(await Promise.race([
      planning.then(() => "completed", () => "rejected"),
      new Promise((resolve) => setTimeout(() => resolve("waiting"), 50)),
    ]), "waiting");
    await writeFile(join(dir, "planning-validation-release"), "release");
    assert.equal((await validation).status, "failed");
    await assert.rejects(planning, /stale state snapshot/i);
    assert.deepEqual((await loadExecutionPlan(dir)).tasks, []);
    assert.deepEqual((await loadPrdRequirements(dir)).requirements, []);
    assert.deepEqual((await loadState(dir)).tasks[0]?.definitionOfDone, ["result.txt contains fixed"]);
  }, false);
});

test("planning rejects a stale state after waiting for first validation without partial publication", async () => {
  await withFailedPolicy(async (dir) => {
    const manifest = await getValidationManifestForTask(dir, "T-POLICY");
    await saveValidationManifest(dir, {
      ...manifest,
      commands: manifest.commands.map((command) => command.id === "unit"
        ? {
            ...command,
            command: "node -e \"const fs=require('fs');fs.writeFileSync('stale-planning-started','');const timer=setInterval(()=>{if(fs.existsSync('stale-planning-release')){clearInterval(timer);process.exit(1)}},10)\"",
          }
        : command),
    });
    const staleState = await loadState(dir);
    const validation = runTaskValidation(dir, staleState, "T-POLICY");
    await waitForPath(join(dir, "stale-planning-started"));
    const planning = applyPlanningReport(dir, staleState, {
      requirements: [{ id: "REQ-UNLINKED", statement: "Must not publish from stale state" }],
      plan: {
        planVersion: 2,
        status: "active",
        tasks: [{
          id: "T-POLICY", title: "Preserve acceptance policy", taskKind: "software",
          atomicityRationale: "One independently testable result.", allowedPathPrefixes: ["result.txt"],
          definitionOfDone: ["result.txt contains fixed"], validationRefs: ["unit"], outputPaths: ["result.txt"],
          validationCommands: manifest.commands,
        }],
      },
    });
    assert.equal(await Promise.race([
      planning.then(() => "completed", () => "rejected"),
      new Promise((resolve) => setTimeout(() => resolve("waiting"), 50)),
    ]), "waiting");
    await writeFile(join(dir, "stale-planning-release"), "release");
    assert.equal((await validation).status, "failed");
    await assert.rejects(planning, /stale state snapshot/i);
    assert.deepEqual((await loadExecutionPlan(dir)).tasks, []);
    assert.deepEqual((await loadPrdRequirements(dir)).requirements, []);
  }, false);
});

test("a detached lock descendant cannot retain reentrant authority after release", async () => {
  await withFailedPolicy(async (dir) => {
    const manifest = await getValidationManifestForTask(dir, "T-POLICY");
    let releaseDescendant!: () => void;
    const descendantGate = new Promise<void>((resolve) => { releaseDescendant = resolve; });
    let descendant!: Promise<void>;
    await withValidationPolicyLock(dir, async () => {
      descendant = (async () => {
        await descendantGate;
        await saveValidationManifest(dir, manifest);
      })();
    });

    await withValidationPolicyLock(dir, async () => {
      releaseDescendant();
      assert.equal(await Promise.race([
        descendant.then(() => "completed"),
        new Promise((resolve) => setTimeout(() => resolve("waiting"), 50)),
      ]), "waiting");
    });
    await descendant;
  });
});

test("planning preflight uses the same task DoD overlay as manifest persistence", async () => {
  await withFailedPolicy(async (dir) => {
    const manifest = await getValidationManifestForTask(dir, "T-POLICY");
    await saveValidationManifest(dir, { ...manifest, definitionOfDone: ["manifest-only historical DoD"] });
    await assert.rejects(applyPlanningReport(dir, await loadState(dir), {
      requirements: [],
      plan: {
        planVersion: 2, status: "active",
        tasks: [{
          id: "T-POLICY", title: "Preserve acceptance policy", taskKind: "software",
          atomicityRationale: "One independently testable result.", allowedPathPrefixes: ["result.txt"],
          definitionOfDone: ["result.txt contains fixed"], validationRefs: ["unit"], outputPaths: ["result.txt"],
          validationCommands: manifest.commands,
        }],
      },
    }), /rejected before publication.*acceptance policy/i);
    assert.deepEqual((await loadExecutionPlan(dir)).tasks, []);
  });
});

test("replan rejects an exercised policy replacement before snapshot or plan publication", async () => {
  await withFailedPolicy(async (dir) => {
    const state = await loadState(dir);
    const currentPlan = await saveExecutionPlan(dir, {
      version: 1, planVersion: 1, status: "active",
      createdAt: "2026-09-17T23:59:00.000Z", updatedAt: "2026-09-17T23:59:00.000Z",
      tasks: [{
        id: "T-POLICY", title: "Preserve acceptance policy", taskKind: "software",
        atomicityRationale: "One independently testable result.", allowedPathPrefixes: ["result.txt"],
        definitionOfDone: ["result.txt contains fixed"], validationRefs: ["unit"], outputPaths: ["result.txt"],
        validationCommands: (await getValidationManifestForTask(dir, "T-POLICY")).commands,
      }],
    });
    const proposedPlan = {
      ...currentPlan,
      planVersion: 2,
      status: "draft" as const,
      tasks: currentPlan.tasks.map((task) => ({
        ...task,
        definitionOfDone: ["Any result is acceptable"],
        validationCommands: task.validationCommands?.map((command) => command.id === "unit"
          ? { ...command, command: "node -e \"process.exit(0)\"" }
          : command),
      })),
    };

    const result = await acceptReplanProposal(dir, state, { version: 1, requirements: [] }, {
      currentPlan,
      proposedPlan,
      now: new Date("2026-09-18T00:00:00.000Z"),
    });

    assert.equal(result.accepted, false);
    assert.match(result.message, /acceptance-policy authority/i);
    assert.deepEqual((await loadExecutionPlan(dir)).tasks[0]?.definitionOfDone, ["result.txt contains fixed"]);
    assert.deepEqual((await loadState(dir)).tasks[0]?.definitionOfDone, ["result.txt contains fixed"]);
    assert.equal((await loadReplanDecisions(dir))[0]?.status, "rejected");
    assert.equal(result.snapshotPath, undefined);
  });
});

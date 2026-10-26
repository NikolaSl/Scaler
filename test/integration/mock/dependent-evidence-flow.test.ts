/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { verifyAcceptedTaskEvidence } from "../../../src/accepted-evidence.js";
import { createDefaultState, loadState } from "../../../src/state.js";
import { createTask, updateTask } from "../../../src/tasks.js";
import { acceptReplanProposal, saveExecutionPlan } from "../../../src/plans.js";
import { loadPrdRequirements, savePrdCoverage, upsertPrdRequirement } from "../../../src/prd.js";
import { requestReplan } from "../../../src/replanning.js";
import { runTaskValidation } from "../../../src/validation.js";
import { runConductorStep } from "./provider-bound-helpers.js";

for (const mode of ["evidence", "dispatch", "revalidated", "same_basis", "unchanged", "unrelated"] as const) {
  test(`accepted dependent evidence: ${mode}`, async () => {
    const dir = await mkdtemp(join(tmpdir(), "scaler-dependent-evidence-"));
    try {
      let state = createDefaultState();
      state.stage = "execution";
      state.originalRequest = "Use only a copy of the current accepted local decision.";
      const commands = [{ id: "check", command: 'node -e "process.exit(0)"', required: true }];
      const revalidation = mode === "revalidated" || mode === "same_basis";
      if (revalidation) for (const id of ["DECISION", "COPY"]) await upsertPrdRequirement(dir, { id, statement: id === "COPY" ? "Copy the current decision." : "Provide the current local decision." });
      await writeFile(join(dir, "decision.txt"), "local decision v1");
      await writeFile(join(dir, "copy.txt"), "local decision v1");
      for (const id of ["DECISION", "COPY"] as const) {
        const result = await createTask(dir, state, {
          id, status: "validating", title: id === "COPY" ? "Copy the accepted decision" : "One local decision",
          taskKind: "non_software", allowedPathPrefixes: [id === "COPY" ? "copy.txt" : "decision.txt"],
          atomicityRationale: "One independently checkable local decision artifact.",
          definitionOfDone: [id === "COPY" ? "Copy equals the current accepted decision." : "Local decision is available."],
          prdRefs: revalidation ? [id] : undefined,
          dependsOn: id === "COPY" ? ["DECISION"] : [],
          protectedDependsOn: id === "COPY" ? ["DECISION"] : [], acceptanceAuthority: "user_command",
          outputPaths: [id === "COPY" ? "copy.txt" : "decision.txt"],
          validationCommands: id === "COPY" ? [{ id: "equal", required: true,
            command: 'node -e "const f=require(\'fs\');require(\'assert/strict\').equal(f.readFileSync(\'copy.txt\',\'utf8\'),f.readFileSync(\'decision.txt\',\'utf8\'))"' }] : commands,
        });
        assert.equal(result.accepted, true, result.message);
        const validated = await runTaskValidation(dir, result.state, id);
        assert.equal(validated.acceptance?.accepted, true, validated.acceptance?.message);
        state = await loadState(dir);
      }
      if (revalidation) {
        const currentPlan = await saveExecutionPlan(dir, { version: 1, planVersion: 1, status: "active",
          tasks: state.tasks, createdAt: state.createdAt, updatedAt: state.updatedAt });
        // Supervisor source invalidation uses the coverage ledger, not a task-state reset.
        await savePrdCoverage(dir, { version: 1, entries: [{ requirementId: "DECISION", taskIds: ["DECISION"],
          status: "needs_replan", evidenceRefs: ["decision.txt"], notes: "Explicit source revalidation requested.", updatedAt: state.updatedAt }] });
        state = (await requestReplan(dir, state, { trigger: "manual", reason: "Revalidate the decision source.", taskId: "DECISION" })).state;
        const replanned = await acceptReplanProposal(dir, state, await loadPrdRequirements(dir), {
          currentPlan, proposedPlan: { ...currentPlan, planVersion: 2, status: "draft" },
        });
        assert.equal(replanned.accepted, true, replanned.message);
        assert.deepEqual(replanned.decision.reopenedTaskIds, ["DECISION"]);
        assert.equal(replanned.state.tasks.find(t => t.id === "COPY")?.status, "validated");
        state = replanned.state;
        for (const status of ["running", "validating"] as const) {
          const updated = await updateTask(dir, state, { id: "DECISION", status, acceptanceAuthority: "user_command" });
          assert.equal(updated.accepted, true, updated.message); state = updated.state;
        }
        if (mode === "revalidated") await writeFile(join(dir, "decision.txt"), "local decision v2");
        const rechecked = await runTaskValidation(dir, state, "DECISION");
        assert.equal(rechecked.acceptance?.accepted, true, rechecked.acceptance?.message);
        state = await loadState(dir);
        assert.deepEqual(await verifyAcceptedTaskEvidence(dir, state, "DECISION"), []);
      }
      const use = await createTask(dir, state, {
        id: "USE", status: "ready", dependsOn: ["COPY"], title: "Use the current copy",
        taskKind: "non_software", allowedPathPrefixes: ["effect.txt"],
        atomicityRationale: "One bounded use of a current accepted copy.", definitionOfDone: ["Use only a current accepted copy."],
        outputPaths: [], validationCommands: commands,
      });
      assert.equal(use.accepted, true, use.message);
      state = await loadState(dir);
      if (mode !== "revalidated") assert.deepEqual(await verifyAcceptedTaskEvidence(dir, state, "COPY"), []);
      const stale = mode === "evidence" || mode === "dispatch";
      if (stale) {
        await writeFile(join(dir, "decision.txt"), "local decision v2");
        assert.notDeepEqual(await verifyAcceptedTaskEvidence(dir, state, "DECISION"), []);
      } else if (mode === "unrelated") await writeFile(join(dir, "unrelated.txt"), "unrelated bytes");
      if (mode === "evidence" || mode === "revalidated") {
        assert.notDeepEqual(await verifyAcceptedTaskEvidence(dir, state, "COPY"), [], "Accepted copy cannot retain current applicability after its prerequisite output changes.");
      } else {
        if (!stale) assert.deepEqual(await verifyAcceptedTaskEvidence(dir, state, "COPY"), []);
        let dispatches = 0;
        await runConductorStep(dir, state, { execute: true }, async request => {
          assert.equal(request.taskId, "USE"); dispatches++;
          return { taskId: request.taskId, exitCode: 1, stdoutEvents: [], stderr: "admission witness only", timedOut: false, aborted: false };
        });
        assert.equal(dispatches, stale ? 0 : 1, "Downstream dispatch must preserve the accepted prerequisite basis.");
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}

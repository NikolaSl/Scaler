/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadStageAgentRunRecords, type StageAgentRunner } from "../src/stage-agents.js";
import { runStageConductorLoop } from "../src/stage-conductor.js";
import { runAutonomousStageWorkflow } from "../src/stage-workflow.js";
import { createDefaultState, loadState, saveState } from "../src/state.js";
import { loadStageArtifacts, upsertStageArtifact } from "../src/stages.js";
import { testProviderAdmissionModel } from "./provider-model-fixture.js";

async function readyArtifact(cwd: string) {
  await writeFile(join(cwd, "replan.md"), "# Replanning evidence\n");
  await upsertStageArtifact(cwd, {
    id: "ART-REPLAN",
    stage: "replanning",
    status: "ready",
    title: "Replanning artifact",
    path: "replan.md",
    evidenceRefs: ["evidence-1"],
    requirementRefs: ["REQ-1"],
  });
}

async function invoke(kind: "conductor" | "workflow", cwd: string, runner: StageAgentRunner) {
  const state = await loadState(cwd);
  const options = { execute: true, maxSteps: 1, providerAdmissionModel: testProviderAdmissionModel };
  return kind === "conductor"
    ? await runStageConductorLoop(cwd, state, options, runner)
    : await runAutonomousStageWorkflow(cwd, state, options, { stage: runner });
}

for (const kind of ["conductor", "workflow"] as const) {
  for (const stopReason of ["aborted", "error"] as const) {
    test(`${kind} refuses a failed child's ready artifact on a later invocation (${stopReason})`, async () => {
      const cwd = await mkdtemp(join(tmpdir(), "scaler-stage-outcome-"));
      try {
        const state = createDefaultState();
        state.stage = "replanning";
        await saveState(cwd, state);
        const first = await invoke(kind, cwd, async (request) => {
          await readyArtifact(cwd);
          return {
            taskId: request.taskId,
            exitCode: 0,
            stdoutEvents: [{ type: "message_end", message: { role: "assistant", stopReason } }],
            stderr: "",
            timedOut: false,
            aborted: false,
          };
        });
        assert.equal(first.accepted, false);
        assert.equal(first.finalState.stage, "replanning");
        assert.equal((await loadStageArtifacts(cwd)).find((artifact) => artifact.id === "ART-REPLAN")?.status, "blocked");
        assert.deepEqual((await loadStageAgentRunRecords(cwd))[0]?.blockedArtifactIds, ["ART-REPLAN"]);

        // A fresh call has no in-memory outcome from the failed invocation.
        const resumed = await invoke(kind, cwd, async () => {
          throw new Error("Unaccepted artifact must be refused before another child is launched.");
        });
        assert.equal(resumed.accepted, false);
        assert.equal(resumed.finalState.stage, "replanning");
        assert.equal((await loadState(cwd)).stage, "replanning");
      } finally {
        await rm(cwd, { recursive: true, force: true });
      }
    });
  }

  test(`${kind} preserves a pre-existing ready artifact without a failed child writer`, async () => {
    const cwd = await mkdtemp(join(tmpdir(), "scaler-stage-outcome-control-"));
    try {
      const state = createDefaultState();
      state.stage = "replanning";
      await saveState(cwd, state);
      await readyArtifact(cwd);
      const result = await invoke(kind, cwd, async () => { throw new Error("No child needed."); });
      assert.equal(result.accepted, true);
      assert.equal(result.finalState.stage, "execution");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test(`${kind} durably blocks a ready artifact when the child runner throws`, async () => {
    const cwd = await mkdtemp(join(tmpdir(), "scaler-stage-outcome-exception-"));
    try {
      const state = createDefaultState();
      state.stage = "replanning";
      await saveState(cwd, state);
      await assert.rejects(invoke(kind, cwd, async () => {
        await readyArtifact(cwd);
        throw new Error("spawn transport failed");
      }), /spawn transport failed/);

      assert.equal((await loadStageArtifacts(cwd)).find((artifact) => artifact.id === "ART-REPLAN")?.status, "blocked");
      const resumed = await invoke(kind, cwd, async () => {
        throw new Error("Blocked artifact must stop before another child launch.");
      });
      assert.equal(resumed.accepted, false);
      assert.equal(resumed.finalState.stage, "replanning");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
}

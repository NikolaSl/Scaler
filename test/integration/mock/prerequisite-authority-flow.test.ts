/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createDefaultState, loadState } from "../../../src/state.js";
import { createTask, updateTask } from "../../../src/tasks.js";
import { runConductorStep } from "./provider-bound-helpers.js";

for (const check of ["mutation", "dispatch", "model_draft", "user_update"] as const) {
  test(`explicit decision prerequisite authority: ${check}`, async () => {
    const dir = await mkdtemp(join(tmpdir(), "scaler-prerequisite-authority-"));
    try {
      const initial = createDefaultState();
      initial.stage = "execution";
      initial.originalRequest = "Use a local provider only after the decision is accepted.";
      const decision = await createTask(dir, initial, {
        id: "DECISION", status: "blocked", title: "Resolve local-only constraint before use", outputPaths: [],
      });
      assert.equal(decision.accepted, true, decision.message);
      const owner = check === "model_draft" ? "model" : "user_command";
      const use = await createTask(dir, decision.state, {
        id: "USE", title: "Use only an accepted decision", status: "ready", dependsOn: ["DECISION"],
        acceptanceAuthority: owner, taskKind: "non_software", atomicityRationale: "One decision-dependent action.",
        allowedPathPrefixes: ["effect.txt"], outputPaths: [], definitionOfDone: ["Use only the accepted current decision."],
        validationCommands: [{ id: "check", command: "node -e \"process.exit(0)\"", required: true }],
      });
      assert.equal(use.accepted, true, use.message);
      let dispatches = 0;
      const dispatch = async () => runConductorStep(dir, await loadState(dir), { execute: true }, async request => {
        assert.equal(request.taskId, "USE");
        dispatches++;
        return { taskId: request.taskId, exitCode: 1, stdoutEvents: [], stderr: "admission witness only", timedOut: false, aborted: false };
      });
      const before = await dispatch();
      assert.equal(before.accepted, false);
      assert.match(before.message, /waiting-for:DECISION/);
      assert.equal(dispatches, 0);
      const updated = await updateTask(dir, await loadState(dir), {
        id: "USE", dependsOn: [], acceptanceAuthority: check === "user_update" ? "user_command" : "model",
      });
      if (check === "mutation") {
        assert.equal(updated.accepted, false, "Model must not silently drop an explicit user decision prerequisite.");
        assert.deepEqual((await loadState(dir)).tasks.find(t => t.id === "USE")?.dependsOn, ["DECISION"]);
      } else if (check === "dispatch") {
        await dispatch();
        assert.equal(dispatches, 0, "Removing a configured decision prerequisite must not admit its dependent runner.");
      } else {
        assert.equal(updated.accepted, true, updated.message);
        assert.deepEqual((await loadState(dir)).tasks.find(t => t.id === "USE")?.dependsOn ?? [], []);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}

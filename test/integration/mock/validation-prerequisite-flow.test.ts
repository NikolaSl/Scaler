/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createDefaultState, loadState } from "../../../src/state.js";
import { createTask } from "../../../src/tasks.js";
import { runTaskValidation } from "../../../src/validation.js";

for (const mode of ["blocked", "missing", "stale", "during", "after", "fresh", "none"] as const) {
  test(`direct validation prerequisite admission: ${mode}`, async () => {
    const dir = await mkdtemp(join(tmpdir(), "scaler-validation-prerequisite-"));
    try {
      let state = createDefaultState();
      state.stage = "execution";
      state.originalRequest = "Validate use only after the current decision is accepted.";
      const commands = [{ id: "check", command: 'node -e "process.exit(0)"', required: true }];
      if (mode !== "missing" && mode !== "none") {
        await writeFile(join(dir, "decision.txt"), "accepted local decision");
        const decision = await createTask(dir, state, {
          id: "DECISION", status: mode === "blocked" ? "blocked" : "validating",
          outputPaths: ["decision.txt"], validationCommands: commands,
        });
        assert.equal(decision.accepted, true, decision.message);
        state = decision.state;
        if (mode !== "blocked") {
          const validated = await runTaskValidation(dir, state, "DECISION");
          assert.equal(validated.acceptance?.accepted, true, validated.acceptance?.message);
          state = await loadState(dir);
          if (mode === "stale") await writeFile(join(dir, "decision.txt"), "changed after acceptance");
        }
      }
      const use = await createTask(dir, state, {
        id: "USE", status: "validating", acceptanceAuthority: "user_command",
        dependsOn: mode === "none" ? [] : ["DECISION"],
        protectedDependsOn: mode === "none" ? [] : ["DECISION"],
        outputPaths: [], validationCommands: mode === "during" || mode === "after" ? [
          { id: "change", command: 'node -e "require(\'fs\').writeFileSync(\'decision.txt\',\'changed during validation\')"', required: true },
          ...(mode === "during" ? commands : []),
        ] : commands,
      });
      assert.equal(use.accepted, true, use.message);
      const result = await runTaskValidation(dir, await loadState(dir), "USE");
      if (mode === "fresh" || mode === "none") {
        assert.equal(result.status, "passed");
        assert.equal(result.acceptance?.accepted, true, result.acceptance?.message);
        assert.equal(result.commandRuns.length, 1);
      } else {
        assert.equal(result.commandRuns.length, mode === "during" || mode === "after" ? 1 : 0, "Invalid prerequisite must refuse before further validation command dispatch.");
        assert.notEqual(result.acceptance?.accepted, true, "Invalid prerequisite must not grant acceptance.");
        assert.notEqual((await loadState(dir)).tasks.find(t => t.id === "USE")?.status, "validated");
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}

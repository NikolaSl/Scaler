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
import { loadCommitSkips } from "../../../src/git.js";
import { upsertPrdRequirement } from "../../../src/prd.js";
import { createDefaultState, loadState, saveState } from "../../../src/state.js";
import { runTaskValidation, saveValidationManifest } from "../../../src/validation.js";
import { runConductorStep } from "./provider-bound-helpers.js";

for (const mode of ["remote", "local", "unavailable"] as const) {
  test(`configured objective direction check: ${mode} decision`, async () => {
    const dir = await mkdtemp(join(tmpdir(), "scaler-objective-direction-"));
    try {
      const state = createDefaultState();
      state.stage = "execution";
      state.originalRequest = "Prepare a local-only provider decision. Do not send data to a cloud provider.";
      state.tasks = [{ id: "DECISION", title: "One provider decision", status: "validating",
        taskKind: "non_software", atomicityRationale: "One bounded decision with an explicit constraint.",
        prdRefs: ["LOCAL"], allowedPathPrefixes: ["candidate.json"],
        definitionOfDone: ["Candidate is structurally valid and satisfies the local-only constraint."],
        validationRefs: ["shape", "direction"], updatedAt: state.updatedAt },
        { id: "USE", title: "Use the accepted decision", status: "ready", dependsOn: ["DECISION"],
          taskKind: "non_software", atomicityRationale: "One downstream action gated by the decision.",
          allowedPathPrefixes: ["effect.txt"], definitionOfDone: ["Use only an accepted current decision."],
          updatedAt: state.updatedAt }];
      await saveState(dir, state);
      await upsertPrdRequirement(dir, { id: "LOCAL", statement: state.originalRequest });
      // This explicit interpretation is fixture-supplied, not NLP-derived authority.
      await writeFile(join(dir, "constraint.json"), JSON.stringify({ allowedProvider: "local" }));
      const candidate = (provider: string) => JSON.stringify({ provider, confidence: 1, rationale: "Technically valid and ready" });
      await writeFile(join(dir, "candidate.json"), candidate(mode === "remote" ? "remote" : "local"));
      await writeFile(join(dir, "check.cjs"), [
        "const assert=require('node:assert/strict'), fs=require('node:fs');",
        "const c=JSON.parse(fs.readFileSync('candidate.json','utf8'));",
        "if(process.argv[2]==='shape'){assert.equal(typeof c.provider,'string');assert.equal(c.confidence,1);}",
        "else{const source=JSON.parse(fs.readFileSync('constraint.json','utf8'));assert.equal(c.provider,source.allowedProvider,'local-only constraint violated');}",
      ].join("\n"));
      await saveValidationManifest(dir, {
        taskId: "DECISION", outputPaths: ["candidate.json"],
        validationInputPaths: ["check.cjs", "constraint.json"],
        definitionOfDone: state.tasks[0]!.definitionOfDone,
        commands: [
          { id: "shape", command: "node check.cjs shape", gate: "consistency", required: true },
          { id: "direction", command: "node check.cjs direction", gate: "compliance", required: true,
            description: "Configured trigger: before accepting this provider decision, check the explicit LOCAL constraint regardless of confidence.",
            evidenceRefs: ["constraint.json", "requirement:LOCAL"],
            disposition: mode === "unavailable" ? "blocked" : "run",
            dispositionReason: mode === "unavailable" ? "Required constraint check unavailable; no authorized alternative." : undefined },
        ], createdAt: "", updatedAt: "",
      });
      await saveValidationManifest(dir, { taskId: "USE", outputPaths: [],
        commands: [{ id: "check", command: "node -e \"process.exit(0)\"", required: true }], createdAt: "", updatedAt: "" });
      let dispatches = 0;
      const dispatch = async () => runConductorStep(dir, await loadState(dir), { execute: true }, async request => {
        dispatches++;
        assert.equal(request.taskId, "USE");
        // Admission witness, not a successful effect/provider/model simulation.
        return { taskId: request.taskId, exitCode: 1, stdoutEvents: [], stderr: "deliberate admission-only stop", timedOut: false, aborted: false };
      });
      const beforeDecision = await dispatch();
      assert.equal(beforeDecision.accepted, false);
      assert.match(beforeDecision.message, /waiting-for:DECISION/);
      assert.equal(dispatches, 0);
      const result = await runTaskValidation(dir, await loadState(dir), "DECISION");
      assert.equal(result.commandRuns.find(r => r.commandId === "shape")?.status, "passed");
      assert.equal(result.status, mode === "local" ? "passed" : mode === "remote" ? "failed" : "blocked");
      if (mode !== "local") {
        assert.equal((await loadState(dir)).tasks[0]?.status, mode === "remote" ? "debugging" : "blocked");
        assert.deepEqual(await loadCommitSkips(dir), []);
        const refused = await dispatch();
        assert.equal(refused.accepted, false);
        assert.match(refused.message, /waiting-for:DECISION/);
        assert.equal(dispatches, 0);
      }
      if (mode === "unavailable") {
        assert.equal(result.commandRuns.find(r => r.commandId === "direction")?.exitCode, null);
        assert.match(result.commandRuns.find(r => r.commandId === "direction")?.dispositionReason ?? "", /no authorized alternative/);
        return;
      }
      // Repair only the candidate, never the exercised required check or source.
      if (mode === "remote") {
        assert.match(result.commandRuns.find(r => r.commandId === "direction")?.stderrSummary ?? "", /local-only constraint violated/);
        await writeFile(join(dir, "candidate.json"), candidate("local"));
      }
      const accepted = mode === "local" ? result : await runTaskValidation(dir, await loadState(dir), "DECISION");
      assert.equal(accepted.status, "passed");
      assert.equal(accepted.acceptance?.accepted, true, accepted.acceptance?.message);
      assert.equal((await loadState(dir)).tasks[0]?.status, "validated");
      assert.equal((await loadCommitSkips(dir)).length, 1);
      assert.deepEqual(await verifyAcceptedTaskEvidence(dir, await loadState(dir), "DECISION"), []);
      await writeFile(join(dir, "candidate.json"), candidate("remote"));
      assert.notDeepEqual(await verifyAcceptedTaskEvidence(dir, await loadState(dir), "DECISION"), []);
      const staleOutput = await dispatch();
      assert.equal(staleOutput.accepted, false);
      assert.match(staleOutput.message, /dependenc/i);
      assert.equal(dispatches, 0);
      await writeFile(join(dir, "candidate.json"), candidate("local"));
      await writeFile(join(dir, "constraint.json"), JSON.stringify({ allowedProvider: "remote" }));
      const staleSource = await dispatch();
      assert.equal(staleSource.accepted, false);
      assert.match(staleSource.message, /dependenc/i);
      assert.equal(dispatches, 0);
      await writeFile(join(dir, "constraint.json"), JSON.stringify({ allowedProvider: "local" }));
      const admitted = await dispatch();
      assert.equal(dispatches, 1, admitted.message);
      // A newer blocked validation must not be erased merely by restoring bytes.
      // Exercise that existing validation control after the dispatch positive control.
      await writeFile(join(dir, "constraint.json"), JSON.stringify({ allowedProvider: "remote" }));
      const stale = await runTaskValidation(dir, await loadState(dir), "DECISION");
      assert.equal(stale.status, "blocked");
      assert.equal(stale.commandRuns.length, 0);
      assert.equal(stale.acceptance?.accepted, false);
      assert.match(stale.acceptance?.message ?? "", /validation basis changed/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}

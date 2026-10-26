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
import { getBudgetState } from "../../../src/budgets.js";
import { loadCommitSkips } from "../../../src/git.js";
import { upsertPrdRequirement } from "../../../src/prd.js";
import { createDefaultState, loadState, saveState } from "../../../src/state.js";
import { getValidationManifestForTask, runTaskValidation, saveValidationManifest } from "../../../src/validation.js";
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

for (const [primary, alternative, authorized, provider] of [
  [true, false, false, "local"], [true, false, false, "remote"], [false, false, false, "local"],
  [false, true, true, "local"], [false, true, true, "remote"], [false, true, false, "local"],
] as const) {
  test(`content-selected direction profile: primary=${primary} alternative=${alternative} authorized=${authorized} provider=${provider}`, async () => {
    const dir = await mkdtemp(join(tmpdir(), "scaler-content-direction-"));
    try {
      const state = createDefaultState();
      state.stage = "execution";
      state.originalRequest = "Answer 2+2 or prepare a local-only provider commitment. No cloud provider. Commitment has a simulated projected cost of 100 units; no real provisioning.";
      state.tasks = [
        { id: "DECISION", status: "validating", taskKind: "non_software", allowedPathPrefixes: ["candidate.json"],
          definitionOfDone: ["Correct lookup or checked local-only commitment."], updatedAt: state.updatedAt },
        { id: "USE", status: "ready", taskKind: "non_software", dependsOn: ["DECISION"], allowedPathPrefixes: ["effect.txt"],
          definitionOfDone: ["Use only an accepted current decision."], updatedAt: state.updatedAt },
      ];
      await saveState(dir, state);
      await writeFile(join(dir, "config.json"), JSON.stringify({ allowedProvider: "local", alternativeAuthorized: authorized }));
      await writeFile(join(dir, "capabilities.json"), JSON.stringify({ primary, alternative }));
      await writeFile(join(dir, "primary.cjs"), "module.exports=(c,p)=>require('node:assert/strict').equal(c.provider,p.allowedProvider,'local-only constraint violated');");
      await writeFile(join(dir, "alternative.cjs"), "module.exports=(c,p)=>require('node:assert/strict').ok([p.allowedProvider].includes(c.provider),'local-only constraint violated');");
      await writeFile(join(dir, "profile.cjs"), [
        "const a=require('node:assert/strict'),f=require('node:fs');",
        "const c=JSON.parse(f.readFileSync('candidate.json')),p=JSON.parse(f.readFileSync('config.json')),cap=JSON.parse(f.readFileSync('capabilities.json'));",
        "const commitment=Object.hasOwn(c,'provider');",
        "if(process.argv[2]==='shape'){a.equal(c.confidence,1);if(commitment){a.equal(typeof c.provider,'string');a.equal(c.projectedCost,100);a.equal(Object.hasOwn(c,'answer'),false);}else{a.deepEqual(c,{answer:4,confidence:1});}process.exit(0);}",
        "if(!commitment){a.deepEqual(c,{answer:4,confidence:1});console.log('routine:objective-answer');process.exit(0);}",
        "console.log('trigger:provider-commitment');",
        "const selected=cap.primary?'primary':p.alternativeAuthorized&&cap.alternative?'alternative':null;",
        "if(!selected){console.log('unavailable:no-authorized-alternative');process.exit(2);}",
        "console.log('executed:'+selected);require('./'+selected+'.cjs')(c,p);",
      ].join("\n"));
      await saveValidationManifest(dir, { taskId: "DECISION", outputPaths: ["candidate.json"],
        validationInputPaths: ["config.json", "capabilities.json", "profile.cjs", "primary.cjs", "alternative.cjs"],
        commands: [{ id: "shape", command: "node profile.cjs shape", required: true, gate: "consistency" },
          { id: "profile", command: "node profile.cjs", required: true, gate: "compliance" }], createdAt: "", updatedAt: "" });
      await saveValidationManifest(dir, { taskId: "USE", outputPaths: [], commands: [{ id: "check", command: "node -e \"process.exit(0)\"", required: true }], createdAt: "", updatedAt: "" });
      const policy = await getValidationManifestForTask(dir, "DECISION");
      await writeFile(join(dir, "candidate.json"), JSON.stringify({ answer: 4, confidence: 1 }));
      const routine = await runTaskValidation(dir, await loadState(dir), "DECISION");
      assert.equal(routine.status, "passed");
      assert.equal(routine.commandRuns[1]?.stdoutSummary, "routine:objective-answer");
      assert.equal(getBudgetState(await loadState(dir)).usage.spawnedAgents ?? 0, 0);
      const skips = (await loadCommitSkips(dir)).length;
      // Only candidate bytes change; command/config/capability policy stays identical.
      await writeFile(join(dir, "candidate.json"), JSON.stringify({ provider, projectedCost: 100, confidence: 1 }));
      const commitment = await runTaskValidation(dir, await loadState(dir), "DECISION");
      assert.equal(commitment.commandRuns[0]?.status, "passed");
      assert.match(commitment.commandRuns[1]?.stdoutSummary ?? "", /trigger:provider-commitment/);
      const selected = primary ? "primary" : alternative && authorized ? "alternative" : null;
      assert.match(commitment.commandRuns[1]?.stdoutSummary ?? "", selected ? new RegExp(`executed:${selected}`) : /unavailable:no-authorized-alternative/);
      const valid = selected !== null && provider === "local";
      assert.equal(commitment.status, valid ? "passed" : "failed");
      const current = await loadState(dir);
      // This rerun starts from historical validated state; the latest failed
      // run invalidates current evidence even when the FSM retains that label.
      assert.equal(current.tasks[0]?.status, "validated");
      assert.equal(commitment.commandRuns[1]?.exitCode, valid ? 0 : selected ? 1 : 2);
      assert.equal((await loadCommitSkips(dir)).length, skips + Number(valid));
      if (selected && !valid) assert.match(commitment.commandRuns[1]?.stderrSummary ?? "", /local-only constraint violated/);
      assert.equal(getBudgetState(current).usage.spawnedAgents ?? 0, 0);
      assert.deepEqual(await getValidationManifestForTask(dir, "DECISION"), policy);
      const evidence = await verifyAcceptedTaskEvidence(dir, current, "DECISION");
      if (valid) assert.deepEqual(evidence, []); else assert.notDeepEqual(evidence, []);
      let dispatches = 0;
      await runConductorStep(dir, current, { execute: true }, async request => {
        dispatches++;
        assert.equal(request.taskId, "USE");
        return { taskId: request.taskId, exitCode: 1, stdoutEvents: [], stderr: "admission-only stop", timedOut: false, aborted: false };
      });
      assert.equal(dispatches, Number(valid));
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
}

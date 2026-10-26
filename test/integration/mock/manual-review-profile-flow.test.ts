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
import { getBudgetState, setBudgetLimits } from "../../../src/budgets.js";
import { saveTaskContextManifest } from "../../../src/context.js";
import { loadTaskAgentReports } from "../../../src/task-reports.js";
import { createTask } from "../../../src/tasks.js";
import { runConductorStep } from "./provider-bound-helpers.js";
import { loadPrdRequirements, upsertPrdRequirement } from "../../../src/prd.js";
import { createDefaultState, loadState, saveState } from "../../../src/state.js";
import { recordValidationChecklist, runTaskValidation, saveValidationManifest } from "../../../src/validation.js";

for (const handoff of [false, true]) for (const mode of ["unsupported_extra", "material", "inconclusive"] as const) {
  test(`${handoff ? "completed child proposal to" : "explicit"} manual author review profile: ${mode}`, async () => {
    const dir = await mkdtemp(join(tmpdir(), "scaler-manual-review-profile-"));
    try {
      const state = handoff ? setBudgetLimits(createDefaultState(), { spawnedAgents: { hard: 2 } }) : createDefaultState();
      state.stage = "execution";
      state.originalRequest = "Choose a local-only provider. No cloud provider or plugin framework.";
      state.tasks = [{ id: "DECISION", status: "validating", taskKind: "non_software",
        prdRefs: ["LOCAL"], allowedPathPrefixes: ["candidate.json"],
        definitionOfDone: ["One local-only provider decision; no extra framework."], updatedAt: state.updatedAt }];
      await saveState(dir, state);
      await upsertPrdRequirement(dir, { id: "LOCAL", statement: state.originalRequest });
      const requirements = await loadPrdRequirements(dir);
      await writeFile(join(dir, "request.txt"), state.originalRequest);
      // Scripted observations/author decisions, not model-quality evidence.
      const finding = mode === "unsupported_extra"
        ? "Reviewer proposes a mandatory plugin framework."
        : mode === "material" ? "Remote provider violates the explicit local-only constraint."
        : "Required assessment is inconclusive; no authorized alternative.";
      const candidate = (provider: string) => JSON.stringify({ provider });
      await writeFile(join(dir, "candidate.json"), candidate(mode === "material" ? "remote" : "local"));
      let proposalRef: string | undefined;
      let assessedFinding = finding;
      if (handoff) {
        const created = await createTask(dir, await loadState(dir), { id: "REVIEW", title: "Compare candidate with request.txt; return a cited proposal only",
          status: "ready", taskKind: "non_software", allowedPathPrefixes: ["review-output.txt"],
          definitionOfDone: ["Return a finding proposal without changing candidate or acceptance."], outputPaths: [],
          validationCommands: [{ id: "observation", command: 'node -e "process.exit(0)"', required: true }] });
        assert.equal(created.accepted, true, created.message);
        await saveTaskContextManifest(dir, { version: 1, taskId: "REVIEW", items: ["request.txt", "candidate.json"].map(path => ({
          id: path, type: "file", reason: "Exact configured comparison basis", priority: "required", scope: "full", source: "file", path,
        })), createdAt: "", updatedAt: "" });
        let calls = 0;
        const compared = await runConductorStep(dir, await loadState(dir), { execute: true, tools: [] }, async child => {
          calls++;
          assert.equal(child.taskId, "REVIEW");
          assert.deepEqual(child.tools, []);
          assert.ok(child.prompt.includes(state.originalRequest!));
          assert.ok(child.prompt.includes(candidate(mode === "material" ? "remote" : "local")));
          return { taskId: child.taskId, exitCode: 0, stderr: "", timedOut: false, aborted: false,
            stdoutEvents: [{ type: "scaler_task_report", taskId: child.taskId, ...child.attempt, status: "completed",
              summary: finding, evidenceRefs: ["request.txt", "candidate.json"], recommendedNextAction: "Author must assess this proposal against original intent." }] };
        });
        assert.equal(compared.validationHandoff?.status, "validation_required");
        const proposal = (await loadTaskAgentReports(dir)).find(report => report.id === compared.validationHandoff?.reportId);
        assert.ok(proposal?.attemptId);
        assert.equal(proposal.summary, finding);
        proposalRef = proposal.id;
        assessedFinding = proposal.summary;
        await writeFile(join(dir, "review.txt"), JSON.stringify({ proposalRef, attemptId: proposal.attemptId, finding: proposal.summary }));
        const current = await loadState(dir);
        assert.equal(calls, 1);
        assert.equal(getBudgetState(current).usage.spawnedAgents, 1);
        assert.equal(current.tasks.find(task => task.id === "DECISION")?.status, "validating");
        assert.equal(current.validatedTaskIds.includes("DECISION"), false);
        assert.deepEqual(await loadPrdRequirements(dir), requirements);
      } else await writeFile(join(dir, "review.txt"), finding);
      await writeFile(join(dir, "check.cjs"), [
        "const a=require('node:assert/strict'),f=require('node:fs');",
        "const c=JSON.parse(f.readFileSync('candidate.json','utf8'));",
        "a.equal(typeof c.provider,'string');",
        "if(process.argv[2]==='constraint'){a.match(f.readFileSync('request.txt','utf8'),/local-only/);a.equal(c.provider,'local','explicit local-only violation');}",
      ].join("\n"));
      await saveValidationManifest(dir, { taskId: "DECISION", outputPaths: ["candidate.json"],
        validationInputPaths: ["request.txt", "review.txt", "check.cjs"],
        commands: [
          { id: "shape", command: "node check.cjs", required: true, gate: "consistency" },
          { id: "constraint", command: "node check.cjs constraint", required: true, gate: "compliance",
            disposition: mode === "inconclusive" ? "blocked" : "run",
            dispositionReason: mode === "inconclusive" ? "Required assessment inconclusive; no authorized alternative." : undefined },
        ], createdAt: "", updatedAt: "" });
      const assessed = await recordValidationChecklist(dir, await loadState(dir), {
        taskId: "DECISION", gate: "adversarial_review",
        items: [{ id: "finding", statement: `Author assessment of ${proposalRef ?? "external finding"}: ${assessedFinding}`, required: true,
          status: mode === "unsupported_extra" ? "not_applicable" : mode === "material" ? "failed" : "blocked",
          evidenceRefs: ["request.txt", "review.txt", ...(proposalRef ? [proposalRef] : [])],
          notes: mode === "unsupported_extra" ? "Reject extra scope: original wording explicitly excludes a plugin framework."
            : mode === "material" ? "Accept finding: remote provider contradicts original constraint; repair candidate only."
            : "Unresolved required assessment; stop without substituting a reviewer vote." }],
      });
      assert.equal(assessed.applyResult.accepted, mode !== "unsupported_extra");
      const checked = await runTaskValidation(dir, await loadState(dir), "DECISION");
      assert.equal(checked.commandRuns[0]?.status, "passed");
      assert.equal(checked.status, mode === "unsupported_extra" ? "passed" : mode === "material" ? "failed" : "blocked");
      assert.deepEqual(await loadPrdRequirements(dir), requirements);
      assert.equal((await loadState(dir)).originalRequest, state.originalRequest);
      if (mode === "inconclusive") {
        assert.equal(checked.acceptance?.accepted, false); // Already blocked; no second state transition or positive acceptance.
        assert.equal((await loadState(dir)).tasks[0]?.status, "blocked");
        assert.equal(checked.commandRuns[1]?.exitCode, null);
        return;
      }
      if (mode === "material") {
        assert.equal((await loadState(dir)).tasks[0]?.status, "debugging");
        await writeFile(join(dir, "candidate.json"), candidate("local"));
      }
      const accepted = mode === "material" ? await runTaskValidation(dir, await loadState(dir), "DECISION") : checked;
      assert.equal(accepted.status, "passed");
      assert.equal(accepted.acceptance?.accepted, true, accepted.acceptance?.message);
      assert.deepEqual(await verifyAcceptedTaskEvidence(dir, await loadState(dir), "DECISION"), []);
      await writeFile(join(dir, "review.txt"), "Changed external assessment after validation.");
      assert.notDeepEqual(await verifyAcceptedTaskEvidence(dir, await loadState(dir), "DECISION"), []);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}

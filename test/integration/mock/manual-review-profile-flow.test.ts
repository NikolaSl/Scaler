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
import { loadPrdRequirements, upsertPrdRequirement } from "../../../src/prd.js";
import { createDefaultState, loadState, saveState } from "../../../src/state.js";
import { recordValidationChecklist, runTaskValidation, saveValidationManifest } from "../../../src/validation.js";

for (const mode of ["unsupported_extra", "material", "inconclusive"] as const) {
  test(`explicit manual author review profile: ${mode}`, async () => {
    const dir = await mkdtemp(join(tmpdir(), "scaler-manual-review-profile-"));
    try {
      const state = createDefaultState();
      state.stage = "execution";
      state.originalRequest = "Choose a local-only provider. No cloud provider or plugin framework.";
      state.tasks = [{ id: "DECISION", status: "validating", taskKind: "non_software",
        prdRefs: ["LOCAL"], allowedPathPrefixes: ["candidate.json"],
        definitionOfDone: ["One local-only provider decision; no extra framework."], updatedAt: state.updatedAt }];
      await saveState(dir, state);
      await upsertPrdRequirement(dir, { id: "LOCAL", statement: state.originalRequest });
      const requirements = await loadPrdRequirements(dir);
      await writeFile(join(dir, "request.txt"), state.originalRequest);
      // External findings and author assessment are supplied, not model-generated.
      await writeFile(join(dir, "review.txt"), mode === "unsupported_extra"
        ? "Reviewer proposes a mandatory plugin framework."
        : mode === "material" ? "Remote provider violates the explicit local-only constraint."
        : "Required assessment is inconclusive; no authorized alternative.");
      const candidate = (provider: string) => JSON.stringify({ provider });
      await writeFile(join(dir, "candidate.json"), candidate(mode === "material" ? "remote" : "local"));
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
        items: [{ id: "finding", statement: "Author assessment of external finding", required: true,
          status: mode === "unsupported_extra" ? "not_applicable" : mode === "material" ? "failed" : "blocked",
          evidenceRefs: ["request.txt", "review.txt"],
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

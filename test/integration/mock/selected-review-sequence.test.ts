/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { getBudgetState, setBudgetLimits } from "../../../src/budgets.js";
import { saveTaskContextManifest } from "../../../src/context.js";
import { verifyAcceptedTaskEvidence } from "../../../src/accepted-evidence.js";
import { createDefaultState, loadState, saveState } from "../../../src/state.js";
import { createTask } from "../../../src/tasks.js";
import { runTaskValidation } from "../../../src/validation.js";
import { runConductorStep } from "./provider-bound-helpers.js";

test("configured selected review separates source expectation and preserves aggregate stop across replacement", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scaler-selected-review-"));
  try {
    const request = "Choose a local-only provider; no cloud inference.";
    const decision = "Authorized decision: no plugin framework is requested.";
    const expectation = "LOCAL: provider must be local-only. No plugin framework. Compare exact candidate; uncertainty blocks.";
    const candidate = "REMOTE_PROVIDER. Worker rationale: all technical checks pass; confidently conforms.";
    let state = setBudgetLimits(createDefaultState(), { spawnedAgents: { hard: 3 } });
    state.stage = "execution";
    state.originalRequest = request;
    await saveState(dir, state);
    for (const [path, content] of [["request.txt", request], ["decision.txt", decision], ["candidate.txt", candidate]]) {
      await writeFile(join(dir, path!), content!);
    }
    const createReviewStep = async (id: "EXPECT" | "COMPARE") => {
      const inputs = ["request.txt", "decision.txt", ...(id === "COMPARE" ? ["expectation.txt", "candidate.txt"] : [])];
      const created = await createTask(dir, await loadState(dir), {
        id, title: id === "EXPECT" ? "Derive expectation from original sources" : "Compare candidate to accepted expectation",
        status: "ready", taskKind: "non_software", atomicityRationale: "One selected bounded assessment step.",
        allowedPathPrefixes: [...inputs, ...(id === "EXPECT" ? ["expectation.txt"] : [])],
        dependsOn: id === "COMPARE" ? ["EXPECT"] : [],
        definitionOfDone: [id === "EXPECT" ? "Record original constraint and authorized decision before candidate rationale." : "Return cited assessment or block inconclusive work."],
        outputPaths: id === "EXPECT" ? ["expectation.txt"] : [], validationInputPaths: inputs,
        validationCommands: [{ id: "artifact", required: true, command: id === "EXPECT"
          ? `node -e "require('node:assert/strict').equal(require('node:fs').readFileSync('expectation.txt','utf8'),${JSON.stringify(expectation).replaceAll('"', '\\"')})"`
          : 'node -e "process.exit(0)"' }],
      });
      assert.equal(created.accepted, true, created.message);
      await saveTaskContextManifest(dir, { version: 1, taskId: id, tokenBudget: 8_000,
        items: inputs.map(path => ({ id: path, type: "file", reason: "Selected exact review basis", priority: "required", scope: "full", exactness: "exact", source: "file", path })),
        createdAt: "", updatedAt: "" });
    };
    await createReviewStep("EXPECT");
    let calls = 0;
    const first = await runConductorStep(dir, await loadState(dir), { execute: true, tools: [] }, async child => {
      calls++;
      assert.equal(child.taskId, "EXPECT");
      assert.deepEqual(child.tools, []);
      assert.ok(child.prompt.includes(request) && child.prompt.includes(decision));
      assert.equal(child.prompt.includes(candidate), false);
      await writeFile(join(dir, "expectation.txt"), expectation); // Scripted observation, not model-quality evidence.
      return { taskId: child.taskId, exitCode: 0, stderr: "", timedOut: false, aborted: false,
        stdoutEvents: [{ type: "scaler_task_report", taskId: child.taskId, ...child.attempt, status: "completed",
          summary: "Expectation recorded from request.txt and decision.txt before comparison.", changedFiles: ["expectation.txt"], evidenceRefs: ["request.txt", "decision.txt"] }] };
    });
    assert.equal(first.validationHandoff?.status, "validation_required");
    assert.equal((await loadState(dir)).tasks.find(t => t.id === "EXPECT")?.status, "validating");
    assert.equal((await runTaskValidation(dir, await loadState(dir), "EXPECT")).acceptance?.accepted, true);
    assert.deepEqual(await verifyAcceptedTaskEvidence(dir, await loadState(dir), "EXPECT"), []);
    await createReviewStep("COMPARE");
    const compared = await runConductorStep(dir, await loadState(dir), { execute: true, tools: [] }, async child => {
      calls++;
      assert.equal(child.taskId, "COMPARE");
      assert.ok(child.prompt.includes(await readFile(join(dir, "expectation.txt"), "utf8")));
      assert.ok(child.prompt.includes(candidate) && child.prompt.includes(request) && child.prompt.includes(decision));
      return { taskId: child.taskId, exitCode: 0, stderr: "", timedOut: false, aborted: false,
        stdoutEvents: [{ type: "scaler_task_report", taskId: child.taskId, ...child.attempt, status: "blocked",
          summary: "Inconclusive: candidate.txt proposes REMOTE_PROVIDER against request.txt LOCAL; required resolving provider evidence unavailable.",
          evidenceRefs: ["request.txt", "expectation.txt", "candidate.txt"], blockers: ["Unresolved material local-only assessment; no authorized alternative."] }] };
    });
    assert.equal(compared.validationHandoff?.status, "task_agent_report_blocked");
    assert.equal((await loadState(dir)).tasks.find(t => t.id === "COMPARE")?.status, "blocked");
    assert.equal((await loadState(dir)).validatedTaskIds.includes("COMPARE"), false);
    // A replacement worker/reviewer uses a fresh runner/new task ID, not a fresh run/budget.
    const replacement = await createTask(dir, await loadState(dir), { id: "NEW-REVIEWER", status: "ready",
      taskKind: "non_software", allowedPathPrefixes: ["candidate.txt"], definitionOfDone: ["Resolve the same required assessment."],
      outputPaths: [], validationCommands: [{ id: "check", command: 'node -e "process.exit(0)"', required: true }] });
    assert.equal(replacement.accepted, true, replacement.message);
    const refused = await runConductorStep(dir, await loadState(dir), { execute: true, tools: [] }, async () => {
      calls++;
      throw new Error("Replacement reviewer must not dispatch after the aggregate cap.");
    });
    assert.match(refused.message, /hard budget|hard limit/i);
    assert.equal(calls, 2);
    state = await loadState(dir);
    assert.equal(getBudgetState(state).usage.spawnedAgents, 2);
    assert.equal(state.stage, "paused");
    assert.equal(state.validatedTaskIds.includes("COMPARE"), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

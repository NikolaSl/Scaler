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
import { loadValidationRuns, recordValidationChecklist, runTaskValidation, runValidationCommandSet, saveValidationManifest } from "../../../src/validation.js";
import { loadTaskAgentReports } from "../../../src/task-reports.js";
import { loadPrdRequirements, upsertPrdRequirement } from "../../../src/prd.js";
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
        id, title: id === "EXPECT" ? "Record expectation.txt from original sources" : "Compare candidate to accepted expectation",
        status: "ready", taskKind: "non_software", atomicityRationale: "One selected bounded assessment step.",
        allowedPathPrefixes: [id === "EXPECT" ? "expectation.txt" : "assessment.txt"],
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
    const first = await runConductorStep(dir, await loadState(dir), { execute: true, tools: ["write"] }, async child => {
      calls++;
      assert.equal(child.taskId, "EXPECT");
      assert.deepEqual(child.tools, ["write"]); // Real children need an output capability; no read tool exposes the candidate.
      assert.ok(child.prompt.includes("Allowed paths: expectation.txt\n"));
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
      assert.deepEqual(child.tools, []);
      assert.ok(child.prompt.includes("Allowed paths: assessment.txt\n"));
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

for (const material of [true, false]) test(`source-first completed review to current author acceptance: ${material ? "material plus unsupported extra" : "correct minimal without objections"}`, async () => {
  const dir = await mkdtemp(join(tmpdir(), "scaler-selected-author-"));
  try {
    const request = "Choose a local-only provider; no cloud inference.";
    const decision = "Authorized decision: no plugin framework.";
    const expectation = "local-only; no plugin framework";
    const candidate = (provider: string) => JSON.stringify({ provider, rationale: "Confidently conforms; technical shape checks pass." });
    let state = setBudgetLimits(createDefaultState(), { spawnedAgents: { hard: 3 }, wallClockMs: { hard: 60_000 } });
    state.stage = "execution"; state.originalRequest = request;
    state.tasks = [{ id: "DECISION", status: "validating", taskKind: "non_software", prdRefs: ["LOCAL"],
      allowedPathPrefixes: ["candidate.json"], definitionOfDone: ["One local-only provider, no plugin framework."], updatedAt: state.updatedAt }];
    await saveState(dir, state);
    await upsertPrdRequirement(dir, { id: "LOCAL", statement: `${request} ${decision}` });
    const requirements = await loadPrdRequirements(dir);
    for (const [path, content] of [["request.txt", request], ["decision.txt", decision], ["candidate.json", candidate(material ? "remote" : "local")]]) await writeFile(join(dir, path!), content!);
    let calls = 0;
    for (const id of ["EXPECT", "COMPARE"] as const) {
      const inputs = ["request.txt", "decision.txt", ...(id === "COMPARE" ? ["expectation.txt", "candidate.json"] : [])];
      const created = await createTask(dir, await loadState(dir), { id, status: "ready", taskKind: "non_software",
        title: id === "EXPECT" ? "Write expectation.txt from original sources" : "Compare exact current candidate against expectation",
        atomicityRationale: "One selected bounded review step.", allowedPathPrefixes: [id === "EXPECT" ? "expectation.txt" : "assessment.txt"],
        dependsOn: id === "COMPARE" ? ["EXPECT"] : [], outputPaths: id === "EXPECT" ? ["expectation.txt"] : [],
        validationInputPaths: inputs, definitionOfDone: [id === "EXPECT" ? "Record exact original constraints before candidate exposure." : "Return comparison proposals without changing acceptance."],
        validationCommands: [{ id: "artifact", required: true, timeoutMs: 5000, command: id === "EXPECT"
          ? `node -e "require('node:assert/strict').equal(require('node:fs').readFileSync('expectation.txt','utf8'),'${expectation}')"`
          : 'node -e "process.exit(0)"' }] });
      assert.equal(created.accepted, true, created.message);
      await saveTaskContextManifest(dir, { version: 1, taskId: id, items: inputs.map(path => ({ id: path, type: "file", reason: "Exact selected review basis", priority: "required", scope: "full", source: "file", path })), createdAt: "", updatedAt: "" });
      const result = await runConductorStep(dir, await loadState(dir), { execute: true, tools: id === "EXPECT" ? ["write"] : [], timeoutMs: 5000 }, async child => {
        calls++; assert.equal(child.taskId, id);
        assert.ok(child.prompt.includes(request) && child.prompt.includes(decision));
        assert.ok(child.prompt.includes(`Allowed paths: ${id === "EXPECT" ? "expectation.txt" : "assessment.txt"}\n`));
        assert.deepEqual(child.tools, id === "EXPECT" ? ["write"] : []);
        if (id === "EXPECT") {
          assert.equal(child.prompt.includes(candidate(material ? "remote" : "local")), false);
          assert.equal(child.prompt.includes("Confidently conforms"), false);
          await writeFile(join(dir, "expectation.txt"), expectation);
        } else {
          assert.deepEqual(await verifyAcceptedTaskEvidence(dir, await loadState(dir), "EXPECT"), []);
          assert.ok(child.prompt.includes(expectation) && child.prompt.includes(candidate(material ? "remote" : "local")));
        }
        return { taskId: id, exitCode: 0, stderr: "", timedOut: false, aborted: false, stdoutEvents: [{ type: "scaler_task_report", taskId: id, ...child.attempt, status: "completed",
          summary: id === "EXPECT" ? "Expectation recorded before candidate exposure." : material
            ? "MATERIAL: remote provider violates request.txt local-only.\nEXTRA: reviewer demands a plugin framework despite decision.txt."
            : "CONFORMS: local provider is sufficient; no additional feature or objection.",
          changedFiles: id === "EXPECT" ? ["expectation.txt"] : [], evidenceRefs: inputs }] };
      });
      assert.equal(result.validationHandoff?.status, "validation_required");
      if (id === "EXPECT") {
        assert.equal((await runTaskValidation(dir, await loadState(dir), id)).status, "passed");
        assert.deepEqual(await verifyAcceptedTaskEvidence(dir, await loadState(dir), id), []);
      } else {
        const proposal = (await loadTaskAgentReports(dir)).find(report => report.id === result.validationHandoff?.reportId);
        assert.ok(proposal?.attemptId);
        await writeFile(join(dir, "review.txt"), JSON.stringify({ id: proposal.id, attemptId: proposal.attemptId, summary: proposal.summary }));
      }
    }
    const proposal = JSON.parse(await readFile(join(dir, "review.txt"), "utf8")) as { id: string; summary: string };
    const findings = proposal.summary.split("\n");
    assert.equal(findings.length, material ? 2 : 1);
    assert.equal((await loadState(dir)).validatedTaskIds.includes("DECISION"), false);
    assert.equal((await loadState(dir)).tasks.find(t => t.id === "COMPARE")?.status, "validating");
    assert.deepEqual(await loadPrdRequirements(dir), requirements);
    await writeFile(join(dir, "check.cjs"), "const a=require('node:assert/strict'),f=require('node:fs'),c=JSON.parse(f.readFileSync('candidate.json','utf8')); a.equal(typeof c.provider,'string'); if(process.argv[2]==='constraint'){a.equal(c.provider,'local');a.equal(c.pluginFramework,undefined);}");
    const constraint = { id: "constraint", command: "node check.cjs constraint", required: true, timeoutMs: 5000, gate: "compliance" as const };
    await saveValidationManifest(dir, { taskId: "DECISION", outputPaths: ["candidate.json"], validationInputPaths: ["request.txt", "decision.txt", "expectation.txt", "review.txt", "check.cjs"],
      commands: [{ id: "shape", command: "node check.cjs", required: true, timeoutMs: 5000, gate: "consistency" }, constraint], createdAt: "", updatedAt: "" });
    const assess = async (resolved: boolean, evidence: string[]) => recordValidationChecklist(dir, await loadState(dir), { taskId: "DECISION", gate: "adversarial_review", items: findings.map((finding, index) => ({
      id: `finding-${index}`, statement: `Author assessment of ${proposal.id}: ${finding}`, required: true,
      status: material && index === 1 ? "not_applicable" as const : material && !resolved ? "failed" as const : "passed" as const,
      notes: material && index === 1 ? "Reject unsupported scope: decision.txt excludes plugins; do not add a blocking feature."
        : material ? resolved ? "Resolve material mismatch using current local-only command evidence after candidate-only repair." : "Accept material mismatch; remote candidate cannot be accepted."
        : "Correct minimal candidate conforms; do not invent objections.",
      evidenceRefs: [proposal.id, "request.txt", "decision.txt", "review.txt", ...evidence],
    })) });
    await assess(false, []);
    const first = await runTaskValidation(dir, await loadState(dir), "DECISION");
    assert.equal(first.commandRuns[0]?.status, "passed");
    assert.equal(first.status, material ? "failed" : "passed");
    if (material) {
      assert.equal((await loadState(dir)).validatedTaskIds.includes("DECISION"), false);
      assert.equal(first.commandRuns[1]?.status, "failed");
      await writeFile(join(dir, "candidate.json"), candidate("local"));
      const resolution = await runValidationCommandSet(dir, "DECISION", [constraint], "author-resolution");
      assert.equal(resolution.status, "passed");
      assert.equal((await loadValidationRuns(dir)).find(run => run.id === resolution.id)?.commandRuns[0]?.status, "passed");
      assert.equal((await loadState(dir)).validatedTaskIds.includes("DECISION"), false);
      await assess(true, [first.id, resolution.id]); // Fresh author disposition, not a fresh reviewer vote.
      assert.equal((await loadState(dir)).validatedTaskIds.includes("DECISION"), false);
      assert.equal((await runTaskValidation(dir, await loadState(dir), "DECISION")).status, "passed");
    }
    assert.deepEqual(await verifyAcceptedTaskEvidence(dir, await loadState(dir), "DECISION"), []);
    assert.deepEqual(await loadPrdRequirements(dir), requirements);
    assert.equal((await loadState(dir)).originalRequest, request);
    assert.equal(calls, 2); assert.equal(getBudgetState(await loadState(dir)).usage.spawnedAgents, 2);
    const replacement = await createTask(dir, await loadState(dir), { id: "REPLACEMENT", status: "ready", taskKind: "non_software", allowedPathPrefixes: ["assessment.txt"],
      outputPaths: [], definitionOfDone: ["Resolve selected assessment without resetting the run cap."], validationCommands: [{ id: "check", required: true, command: 'node -e "process.exit(0)"' }] });
    assert.equal(replacement.accepted, true);
    const stopped = await runConductorStep(dir, await loadState(dir), { execute: true, tools: [] }, async () => { assert.fail("Replacement must inherit exhausted aggregate admission."); });
    assert.match(stopped.message, /hard budget|hard limit/i);
    assert.equal(getBudgetState(await loadState(dir)).usage.spawnedAgents, 2);
    assert.equal((await loadState(dir)).stage, "paused");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

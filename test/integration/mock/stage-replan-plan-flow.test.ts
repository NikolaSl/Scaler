/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { readLogEvents } from "../../../src/logging.js";
import { commitWithExecutionLock } from "../../../src/operations.js";
import {
  acceptReplanProposal,
  appendReplanRequest,
  loadExecutionPlan,
  loadProposedExecutionPlan,
  loadReplanDecisions,
  loadReplanRequests,
  saveExecutionPlan,
} from "../../../src/plans.js";
import { loadPrdRequirements, upsertPrdRequirement } from "../../../src/prd.js";
import { loadReplanAgentRunRecords, runReplanAgentStep } from "../../../src/replan-agent.js";
import { createDefaultState, loadState, saveState } from "../../../src/state.js";
import { loadStageAgentRunRecords } from "../../../src/stage-agents.js";
import { runStageConductorLoop } from "../../../src/stage-conductor.js";
import { loadStageArtifacts } from "../../../src/stages.js";
import type { TaskAgentRequest, TaskAgentRunResult } from "../../../src/subagents.js";
import type { ScalerState } from "../../../src/types.js";
import { runTaskValidation, upsertValidationManifestCommand } from "../../../src/validation.js";

const execFileAsync = promisify(execFile);

async function withTempRepo<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-chain-integration-test-"));
  try {
    await execFileAsync("git", ["init"], { cwd: dir });
    await execFileAsync("git", ["config", "user.email", "scaler-test@example.invalid"], { cwd: dir });
    await execFileAsync("git", ["config", "user.name", "Scaler Test"], { cwd: dir });
    await mkdir(join(dir, "docs"), { recursive: true });
    await writeFile(join(dir, "package.json"), JSON.stringify({
      type: "module",
      scripts: { test: "node test-runner.js", build: "node -e \"process.exit(0)\"" },
    }, null, 2));
    await writeFile(join(dir, "test-runner.js"), "process.exit(0);\n");
    await writeFile(join(dir, "index.js"), "export const value = 1;\n");
    await execFileAsync("git", ["add", "package.json", "test-runner.js", "index.js"], { cwd: dir });
    await execFileAsync("git", ["commit", "-m", "initial fixture"], { cwd: dir });
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function createState(stage: ScalerState["stage"] = "execution"): ScalerState {
  const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
  state.stage = stage;
  return state;
}

function validPlanTask(id: string, title: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title,
    taskKind: "software",
    atomicityRationale: `${id} is independently completable and testable for the replan flow.`,
    allowedPathPrefixes: ["index.js"],
    definitionOfDone: ["Task output and validation evidence are complete."],
    validationCommands: [
      { id: "test-first", command: "node -e \"process.exit(0)\"", gate: "test_first", required: true },
      { id: "unit", command: "npm test", gate: "unit_tests", required: true },
    ],
    ...overrides,
  };
}

async function stageArtifactRunner(request: TaskAgentRequest): Promise<TaskAgentRunResult> {
  const stage = request.taskId.replace(/^stage-/, "");
  const pathByStage: Record<string, string | undefined> = {
    prd: "docs/stage-prd.md",
    knowledge: "docs/stage-knowledge.md",
    planning: "docs/stage-plan.md",
    execution: undefined,
  };
  const path = pathByStage[stage];
  if (path) await writeFile(join(request.cwd ?? process.cwd(), path), `# ${stage}\n\nDeterministic ${stage} artifact.\n`);

  const event = {
    type: "scaler_stage_artifact",
    stage,
    status: "ready",
    title: `${stage} artifact`,
    path,
    summary: `Ready ${stage} artifact from integration runner.`,
    evidenceRefs: [`evidence-${stage}`],
    requirementRefs: ["REQ-STAGE"],
    taskRefs: stage === "execution" ? [] : undefined,
  };

  return {
    taskId: request.taskId,
    exitCode: 0,
    stdoutEvents: [event],
    stderr: "",
    timedOut: false,
    aborted: false,
  };
}

test("integration: stage conductor ingests artifacts and advances through implemented Stage I-IV chain", async () => {
  await withTempRepo(async (dir) => {
    await upsertPrdRequirement(dir, {
      id: "REQ-STAGE",
      title: "Stage chain requirement",
      statement: "The staged conductor must advance only through ready, consistent artifacts.",
      status: "pending",
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    const state = createState("prd");
    await saveState(dir, state);

    const result = await runStageConductorLoop(dir, state, { execute: true, maxSteps: 5 }, stageArtifactRunner);

    assert.equal(result.accepted, true);
    assert.equal(result.completed, true);
    assert.equal(result.stopReason, "completed");
    assert.equal(result.finalState.stage, "completed");
    assert.deepEqual(result.steps.map((step) => step.stage), ["prd", "knowledge", "planning", "execution"]);
    assert.ok(result.steps.every((step) => step.stageAgent?.ingestion?.ingested));
    assert.ok(result.steps.every((step) => step.advancement?.advanced));

    const artifacts = await loadStageArtifacts(dir);
    assert.deepEqual(artifacts.map((artifact) => artifact.stage), ["prd", "knowledge", "planning", "execution"]);
    assert.ok(artifacts.every((artifact) => artifact.status === "ready"));
    assert.equal((await loadStageAgentRunRecords(dir)).length, 4);
    assert.equal((await loadState(dir)).stage, "completed");

    const events = await readLogEvents(dir);
    assert.ok(events.some((event) => event.eventType === "agent" && event.agentType === "stage"));
    assert.ok(events.some((event) => event.eventType === "report" && event.summary.includes("scaler_stage_artifact")));
  });
});

async function replanProposalRunner(request: TaskAgentRequest): Promise<TaskAgentRunResult> {
  assert.match(request.prompt, /REQ-NEW/);
  assert.match(request.prompt, /REPLAN-INTEGRATION/);
  return {
    taskId: request.taskId,
    exitCode: 0,
    stdoutEvents: [{
      type: "scaler_replan_proposal",
      plan: {
        version: 1,
        planVersion: 2,
        status: "draft",
        title: "Integrated replan proposal",
        source: "integration-test",
        tasks: [
          validPlanTask("T-KEEP", "Keep validated work", {
            prdRefs: ["REQ-KEEP"],
            allowedPathPrefixes: ["index.js"],
            validationRefs: ["validation-keep", "test-first"],
          }),
          validPlanTask("T-NEW", "Cover new requirement", {
            prdRefs: ["REQ-NEW"],
            allowedPathPrefixes: ["new-feature.js"],
            dependsOn: ["T-KEEP"],
            validationRefs: ["validation-new", "test-first"],
          }),
        ],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    }],
    stderr: "",
    timedOut: false,
    aborted: false,
  };
}

test("integration: runtime PRD replan request becomes preserved plan, accepted decision, and created tasks", async () => {
  await withTempRepo(async (dir) => {
    await upsertPrdRequirement(dir, {
      id: "REQ-KEEP",
      title: "Existing validated requirement",
      statement: "Validated work must be preserved during replanning.",
      status: "validated",
      taskIds: ["T-KEEP"],
      evidenceRefs: ["validation-keep"],
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    await upsertPrdRequirement(dir, {
      id: "REQ-NEW",
      title: "New requirement",
      statement: "New coverage gaps must be planned without dropping validated work.",
      status: "pending",
      now: new Date("2026-01-01T00:00:01.000Z"),
    });

    const state = createState("replanning");
    state.tasks = [{
      id: "T-KEEP",
      status: "validated",
      title: "Keep validated work",
      allowedPathPrefixes: ["index.js"],
      prdRefs: ["REQ-KEEP"],
      updatedAt: state.createdAt,
    }];
    state.validatedTaskIds = ["T-KEEP"];
    state.completedTaskIds = ["T-KEEP"];
    await saveState(dir, state);
    await saveExecutionPlan(dir, {
      version: 1,
      planVersion: 1,
      status: "active",
      title: "Current plan",
      tasks: [validPlanTask("T-KEEP", "Keep validated work", { prdRefs: ["REQ-KEEP"], allowedPathPrefixes: ["index.js"], validationRefs: ["validation-keep", "test-first"] })],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    await appendReplanRequest(dir, {
      id: "REPLAN-INTEGRATION",
      trigger: "coverage_gap",
      reason: "REQ-NEW is not linked to any planned task.",
      requirementRefs: ["REQ-NEW"],
      evidenceRefs: ["runtime-prd-coverage"],
      planVersion: 1,
    }, new Date("2026-01-01T00:00:02.000Z"));

    const replan = await runReplanAgentStep(dir, state, { execute: true }, replanProposalRunner);
    assert.equal(replan.accepted, true);
    assert.equal(replan.ingestion?.ingested, true, replan.ingestion?.reason);
    assert.equal(replan.ingestion?.preservation?.ok, true);
    assert.equal((await loadProposedExecutionPlan(dir))?.planVersion, 2);
    assert.equal((await loadReplanAgentRunRecords(dir))[0]?.ingestionStatus, "ingested");

    const accepted = await acceptReplanProposal(dir, state, await loadPrdRequirements(dir), {
      now: new Date("2026-01-01T00:00:03.000Z"),
    });
    assert.equal(accepted.accepted, true, accepted.message);
    assert.deepEqual(accepted.applyResult?.createdTaskIds, ["T-NEW"]);
    assert.deepEqual(accepted.applyResult?.existingTaskIds, ["T-KEEP"]);
    assert.equal(accepted.savedPlan?.status, "active");
    assert.equal((await loadExecutionPlan(dir)).planVersion, 2);
    assert.equal((await loadReplanRequests(dir))[0]?.status, "resolved");
    assert.equal((await loadReplanDecisions(dir))[0]?.status, "accepted");
    assert.ok(accepted.snapshotPath?.startsWith(".scaler/plans/versions/PLAN-v"));
    assert.equal((await loadState(dir)).tasks.some((task) => task.id === "T-NEW" && task.status === "pending"), true);

    const events = await readLogEvents(dir);
    assert.ok(events.some((event) => event.eventType === "agent" && event.agentType === "replan"));
    assert.ok(events.some((event) => event.eventType === "report" && event.summary.includes("scaler_replan_proposal")));
  });
});

test("integration: validated task commit preserves runtime artifacts and records git audit", async () => {
  await withTempRepo(async (dir) => {
    const state = createState("execution");
    state.tasks = [{
      id: "T-COMMIT",
      status: "validated",
      title: "Commit validated implementation",
      allowedPathPrefixes: ["index.js"],
      prdRefs: ["REQ-COMMIT"],
      updatedAt: state.createdAt,
    }];
    state.validatedTaskIds = ["T-COMMIT"];
    state.completedTaskIds = ["T-COMMIT"];
    await saveState(dir, state);
    await writeFile(join(dir, "index.js"), "export const value = 2;\n");
    await upsertValidationManifestCommand(dir, { taskId: "T-COMMIT", id: "output", command: "node -e \"require('node:assert/strict').equal(require('node:fs').readFileSync('index.js', 'utf8'), 'export const value = 2;\\n')\"", required: true });
    assert.equal((await runTaskValidation(dir, state, "T-COMMIT")).status, "passed");

    const result = await commitWithExecutionLock(dir, state, "T-COMMIT", ["index.js"]);
    assert.equal(result.accepted, true, result.message);
    assert.match(result.result?.commitHash ?? "", /^[a-f0-9]+$/);

    const { stdout } = await execFileAsync("git", ["status", "--porcelain"], { cwd: dir });
    assert.doesNotMatch(stdout, /index\.js/);
    assert.match(stdout, /\.scaler\//);

    const committedIndex = await execFileAsync("git", ["show", "HEAD:index.js"], { cwd: dir });
    assert.equal(committedIndex.stdout, "export const value = 2;\n");
    const events = await readLogEvents(dir);
    assert.ok(events.some((event) => event.eventType === "git" && event.taskId === "T-COMMIT" && event.outputRefs?.length === 1));
  });
});

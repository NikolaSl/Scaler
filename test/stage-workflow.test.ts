/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadExecutionPlan, saveExecutionPlan } from "../src/plans.js";
import { loadPrdRequirements, upsertPrdRequirement } from "../src/prd.js";
import { loadResearchReports, loadResearchRequests } from "../src/research.js";
import { createDefaultState, loadState, saveState } from "../src/state.js";
import {
  deriveKnowledgeResearchRequests,
  loadStageWorkflowRunRecords,
  runAutonomousStageWorkflow,
} from "../src/stage-workflow.js";
import type { TaskAgentRequest, TaskAgentRunResult } from "../src/subagents.js";
import type { ScalerState } from "../src/types.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-stage-workflow-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function createState(stage: ScalerState["stage"]): ScalerState {
  const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
  state.stage = stage;
  return state;
}

function validWorkflowTask(id: string, title: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title,
    taskKind: "software",
    atomicityRationale: `${id} is independently completable and testable in the autonomous workflow.`,
    allowedPathPrefixes: ["src"],
    definitionOfDone: ["Workflow task completed and relevant tests pass."],
    validationCommands: [
      { id: "test-first", command: "node -e \"process.exit(0)\"", gate: "test_first", required: true },
      { id: "unit", command: "node -e \"process.exit(0)\"", gate: "unit_tests", required: true },
    ],
    ...overrides,
  };
}

test("deriveKnowledgeResearchRequests creates deterministic Stage II requests for uncovered requirements", () => {
  const requests = deriveKnowledgeResearchRequests([
    { id: "REQ-1", statement: "One", createdAt: "now", updatedAt: "now" },
    { id: "REQ-2", statement: "Two", createdAt: "now", updatedAt: "now" },
  ], [{
    id: "RESEARCH-REQ-1",
    status: "open",
    question: "q",
    reason: "Stage II knowledge collection for runtime requirement REQ-1.",
    scope: "local",
    requirementRefs: ["REQ-1"],
    createdAt: "now",
    updatedAt: "now",
  }], [{
    id: "RPT-2",
    status: "complete",
    question: "q",
    requirementRefs: ["REQ-2"],
    sources: [{ id: "src", title: "Source", quality: "project", checkedAt: "now" }],
    conclusions: [{ summary: "Done", confidence: "high", sourceRefs: ["src"] }],
    createdAt: "now",
    updatedAt: "now",
  }], 5);

  assert.deepEqual(requests, []);
});

async function stageRunner(request: TaskAgentRequest): Promise<TaskAgentRunResult> {
  if (request.taskId === "stage-prd") {
    assert.ok(request.tools?.includes("scaler_prd_write"));
    return {
      taskId: request.taskId,
      exitCode: 0,
      stdoutEvents: [{
        type: "scaler_prd_write",
        content: "# Runtime PRD\n\n- REQ-1: Implement the workflow.\n",
        requirements: [{ id: "REQ-1", title: "Workflow", statement: "Implement the autonomous workflow.", source: "test" }],
      }],
      stderr: "",
      timedOut: false,
      aborted: false,
    };
  }

  if (request.taskId === "stage-planning") {
    assert.ok(request.tools?.includes("scaler_planning_report"));
    return {
      taskId: request.taskId,
      exitCode: 0,
      stdoutEvents: [{
        type: "scaler_planning_report",
        id: "planning-test",
        reason: "Initial autonomous plan.",
        source: "stage-workflow-test",
        requirements: [{ id: "REQ-1", title: "Workflow", statement: "Implement the autonomous workflow.", status: "in_progress" }],
        plan: {
          planVersion: 1,
          status: "active",
          title: "Initial plan",
          source: "stage-workflow-test",
          tasks: [validWorkflowTask("T-1", "Implement workflow", {
            prdRefs: ["REQ-1"],
            allowedPathPrefixes: ["src/stage-workflow.ts"],
            validationRefs: ["unit", "test-first"],
          })],
        },
      }],
      stderr: "",
      timedOut: false,
      aborted: false,
    };
  }

  throw new Error(`Unexpected stage request ${request.taskId}`);
}

async function researchRunner(request: TaskAgentRequest): Promise<TaskAgentRunResult> {
  assert.equal(request.taskId, "research-agent-RESEARCH-REQ-1");
  return {
    taskId: request.taskId,
    exitCode: 0,
    stdoutEvents: [{
      type: "scaler_research_report",
      status: "complete",
      question: "What project-local knowledge is needed?",
      requestId: "RESEARCH-REQ-1",
      requirementRefs: ["REQ-1"],
      sources: [{ id: "src-local", title: "Local source", quality: "project", path: "src/stage-workflow.ts" }],
      conclusions: [{ summary: "The workflow needs deterministic ledgers and bounded agents.", confidence: "high", sourceRefs: ["src-local"], evidenceRefs: ["src/stage-workflow.ts"] }],
      unresolvedUnknowns: [],
      recommendations: ["Keep the plan atomic."],
    }],
    stderr: "",
    timedOut: false,
    aborted: false,
  };
}

test("runAutonomousStageWorkflow executes PRD, Stage II research merge, and planning ledger sync", async () => {
  await withTempDir(async (dir) => {
    const state = createState("prd");
    await saveState(dir, state);

    const result = await runAutonomousStageWorkflow(dir, state, { execute: true, maxSteps: 10, maxResearchAgents: 2 }, {
      stage: stageRunner,
      research: researchRunner,
    });

    assert.equal(result.accepted, true, result.message);
    assert.equal(result.finalState.stage, "execution");
    assert.deepEqual(result.steps.map((step) => step.action), [
      "stage_agent",
      "research_requests",
      "research_agents",
      "knowledge_merge",
      "stage_agent",
      "execution_ready",
    ]);
    assert.equal((await loadPrdRequirements(dir)).requirements[0]?.id, "REQ-1");
    assert.equal((await loadResearchRequests(dir))[0]?.status, "resolved");
    assert.equal((await loadResearchReports(dir))[0]?.status, "complete");
    assert.match(await readFile(join(dir, ".scaler", "knowledge", "knowledge-report.md"), "utf8"), /deterministic ledgers/);
    assert.equal((await loadExecutionPlan(dir)).tasks[0]?.id, "T-1");
    assert.equal((await loadState(dir)).tasks.some((task) => task.id === "T-1" && task.status === "pending"), true);
    assert.equal((await loadStageWorkflowRunRecords(dir)).length, 1);
  });
});

async function replanRunner(request: TaskAgentRequest): Promise<TaskAgentRunResult> {
  assert.equal(request.taskId, "replan-agent");
  assert.match(request.prompt, /REQ-NEW/);
  return {
    taskId: request.taskId,
    exitCode: 0,
    stdoutEvents: [{
      type: "scaler_replan_proposal",
      plan: {
        version: 1,
        planVersion: 2,
        status: "draft",
        title: "Refresh plan",
        source: "stage-workflow-test",
        tasks: [
          validWorkflowTask("T-KEEP", "Keep validated", { prdRefs: ["REQ-KEEP"], allowedPathPrefixes: ["keep.ts"], validationRefs: ["keep", "test-first"] }),
          validWorkflowTask("T-NEW", "Cover new requirement", { prdRefs: ["REQ-NEW"], allowedPathPrefixes: ["new.ts"], dependsOn: ["T-KEEP"], validationRefs: ["new", "test-first"] }),
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

test("runAutonomousStageWorkflow refreshes planning after execution coverage discoveries", async () => {
  await withTempDir(async (dir) => {
    await upsertPrdRequirement(dir, {
      id: "REQ-KEEP",
      statement: "Keep validated work.",
      status: "validated",
      taskIds: ["T-KEEP"],
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    await upsertPrdRequirement(dir, {
      id: "REQ-NEW",
      statement: "New execution discovery must be planned.",
      status: "pending",
      now: new Date("2026-01-01T00:00:01.000Z"),
    });
    const state = createState("execution");
    state.tasks = [{
      id: "T-KEEP",
      title: "Keep validated",
      status: "validated",
      prdRefs: ["REQ-KEEP"],
      allowedPathPrefixes: ["keep.ts"],
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
      tasks: [validWorkflowTask("T-KEEP", "Keep validated", { prdRefs: ["REQ-KEEP"], allowedPathPrefixes: ["keep.ts"], validationRefs: ["keep", "test-first"] })],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const result = await runAutonomousStageWorkflow(dir, state, { execute: true, maxSteps: 6 }, { replan: replanRunner });

    assert.equal(result.accepted, true, result.message);
    assert.equal(result.finalState.stage, "execution");
    assert.ok(result.steps.some((step) => step.action === "execution_replan_request"));
    assert.ok(result.steps.some((step) => step.action === "replan_accept"));
    const plan = await loadExecutionPlan(dir);
    assert.equal(plan.planVersion, 2);
    assert.equal(plan.tasks.some((task) => task.id === "T-NEW"), true);
    const savedState = await loadState(dir);
    assert.equal(savedState.tasks.some((task) => task.id === "T-NEW" && task.status === "pending"), true);
  });
});

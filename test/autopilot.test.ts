/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runScalerAutomation as runScalerAutomationImpl } from "../src/autopilot.js";
import { dispatchMissingContextRequest, loadMissingContextRequests } from "../src/missing-context.js";
import { recordResearchReport } from "../src/research.js";
import { loadState, saveState, createDefaultState } from "../src/state.js";
import { getValidationManifestForTask, saveValidationManifest, upsertValidationManifestCommand } from "../src/validation.js";
import type { TaskAgentRequest, TaskAgentRunResult } from "../src/subagents.js";
import type { ScalerState } from "../src/types.js";
import { testProviderAdmissionModel } from "./provider-model-fixture.js";

const runScalerAutomation: typeof runScalerAutomationImpl = (cwd, state, options = {}, runners) =>
  runScalerAutomationImpl(cwd, state, { ...options, providerAdmissionModel: testProviderAdmissionModel }, runners);

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-autopilot-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function createState(stage: ScalerState["stage"]): ScalerState {
  const state = createDefaultState(new Date("2026-03-01T00:00:00.000Z"));
  state.stage = stage;
  return state;
}

function planTask() {
  return {
    id: "T-AUTO",
    title: "Run fully automated task",
    taskKind: "software",
    atomicityRationale: "T-AUTO is independently completable and testable for full automation.",
    allowedPathPrefixes: ["src/autopilot.ts"],
    outputPaths: [], // Synthetic orchestration-only task produces no files.
    prdRefs: ["REQ-AUTO"],
    definitionOfDone: ["The automation task reports completion and validation passes."],
    validationCommands: [
      { id: "test-first", command: "node -e \"process.exit(0)\"", gate: "test_first", required: true, environment: "host" },
      { id: "unit", command: "node -e \"process.exit(0)\"", gate: "unit_tests", required: true, environment: "host" },
    ],
  };
}

async function stageRunner(request: TaskAgentRequest): Promise<TaskAgentRunResult> {
  assert.equal(request.taskId, "stage-planning");
  assert.ok(request.tools?.includes("read"));
  assert.ok(request.tools?.includes("bash"));
  assert.ok(request.tools?.includes("scaler_planning_report"));
  return {
    taskId: request.taskId,
    exitCode: 0,
    stdoutEvents: [{
      type: "scaler_planning_report",
      id: "planning-autopilot",
      reason: "Plan used by the full automation test.",
      source: "autopilot-test",
      requirements: [{ id: "REQ-AUTO", title: "Automation", statement: "Run stage, task, validation, and completion automatically.", status: "in_progress" }],
      plan: {
        planVersion: 1,
        status: "active",
        title: "Automation test plan",
        source: "autopilot-test",
        tasks: [planTask()],
      },
    }],
    stderr: "",
    timedOut: false,
    aborted: false,
  };
}

async function taskRunner(request: TaskAgentRequest): Promise<TaskAgentRunResult> {
  assert.equal(request.taskId, "T-AUTO");
  assert.ok(request.tools?.includes("read"));
  assert.ok(request.tools?.includes("bash"));
  assert.ok(request.tools?.includes("edit"));
  assert.ok(request.tools?.includes("write"));
  assert.ok(request.tools?.includes("scaler_task_report"));
  return {
    taskId: request.taskId,
    exitCode: 0,
    stdoutEvents: [{
      type: "scaler_task_report",
      taskId: "T-AUTO",
      ...request.attempt,
      status: "completed",
      summary: "Task completed by full automation test.",
      changedFiles: [],
      validations: [{ id: "unit", command: "node -e \"process.exit(0)\"", status: "passed", summary: "Runner supplied completion." }],
    }],
    stderr: "",
    timedOut: false,
    aborted: false,
  };
}

test("runScalerAutomation debug-retries validation failures before completing", async () => {
  await withTempDir(async (dir) => {
    const state = createState("execution");
    state.currentTaskId = "T-DEBUG-AUTO";
    state.tasks = [{
      id: "T-DEBUG-AUTO",
      title: "Debug auto task",
      status: "validating",
      allowedPathPrefixes: ["fixed.txt"],
      definitionOfDone: ["The marker validation passes."],
      updatedAt: state.createdAt,
    }];
    await saveState(dir, state);
    await upsertValidationManifestCommand(dir, {
      taskId: "T-DEBUG-AUTO",
      id: "marker",
      command: "node -e \"process.exit(require('fs').existsSync('fixed.txt') ? 0 : 1)\"",
      description: "Marker validation",
      required: true,
      gate: "unit",
      expectedResult: "fixed.txt exists",
    });
    await saveValidationManifest(dir, {
      ...await getValidationManifestForTask(dir, "T-DEBUG-AUTO"), outputPaths: ["fixed.txt"],
    });

    const result = await runScalerAutomation(dir, state, { maxSteps: 12, maxDebugSteps: 4 }, {
      debug: async (request) => ({
        taskId: request.taskId,
        exitCode: 0,
        stdoutEvents: [{
          type: "scaler_debug_report",
          id: "RPT-DEBUG-AUTO",
          taskId: "T-DEBUG-AUTO",
          status: "next_approach",
          summary: "Create the missing marker file.",
          failureId: "F-DEBUG-AUTO",
          failureFingerprint: "missing marker",
          rootCause: "The task did not create fixed.txt.",
          nextApproach: "Create fixed.txt and rerun marker validation.",
          evidenceRefs: ["validation:marker"],
        }],
        stderr: "",
        timedOut: false,
        aborted: false,
      }),
      task: async (request) => {
        assert.equal(request.taskId, "T-DEBUG-AUTO");
        await writeFile(join(request.cwd ?? dir, "fixed.txt"), "ok\n", "utf8");
        return {
          taskId: request.taskId,
          exitCode: 0,
          stdoutEvents: [{ type: "scaler_task_report", taskId: request.taskId, ...request.attempt, status: "completed", summary: "Debug retry wrote fixed.txt.", changedFiles: ["fixed.txt"] }],
          stderr: "",
          timedOut: false,
          aborted: false,
        };
      },
    });

    assert.equal(result.completed, true, result.message);
    assert.ok(result.steps.some((step) => step.action === "debug"));
    assert.ok(result.steps.some((step) => step.action === "debug_retry"));
    assert.equal((await loadState(dir)).tasks.find((task) => task.id === "T-DEBUG-AUTO")?.status, "validated");
  });
});

test("runScalerAutomation drives planning, task execution, validation, and completion", async () => {
  await withTempDir(async (dir) => {
    const state = createState("planning");
    await saveState(dir, state);

    const result = await runScalerAutomation(dir, state, { maxSteps: 12, maxStageSteps: 5 }, {
      stage: stageRunner,
      task: taskRunner,
    });

    assert.equal(result.completed, true, result.message);
    assert.equal(result.stopReason, "completed");
    assert.ok(result.steps.some((step) => step.action === "stage_workflow"));
    assert.ok(result.steps.some((step) => step.action === "task_agent"));
    assert.ok(result.steps.some((step) => step.action === "validation"));
    const savedState = await loadState(dir);
    assert.equal(savedState.stage, "completed");
    assert.equal(savedState.tasks.find((task) => task.id === "T-AUTO")?.status, "validated");
  });
});

test("runScalerAutomation continues a blocked task through local missing-context research", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src", "autopilot.ts"), "// Widgets use the accepted local ledger rule.\n");
    const state = createState("planning");
    await saveState(dir, state);
    const question = "Determine the local canonical widget rule.";
    let taskCalls = 0;
    let researchCalls = 0;

    const result = await runScalerAutomation(dir, state, {
      maxSteps: 12,
      maxStageSteps: 5,
    }, {
      stage: stageRunner,
      task: async (request) => {
        taskCalls += 1;
        if (taskCalls === 1) {
          return {
            taskId: request.taskId,
            exitCode: 0,
            stdoutEvents: [{
              type: "scaler_task_report",
              taskId: request.taskId,
              ...request.attempt,
              status: "needs_data",
              summary: "Need a focused local fact before continuing.",
              changedFiles: [],
              blockers: [],
              missingData: [question],
            }],
            stderr: "",
            timedOut: false,
            aborted: false,
          };
        }
        assert.match(request.prompt, /Research answer \(reported claim, not verified source bytes\)/);
        assert.match(request.prompt, /Widgets use the accepted local ledger rule/);
        return taskRunner(request);
      },
      research: async (request) => {
        researchCalls += 1;
        assert.match(request.taskId, /^research-agent-RESEARCH-MCTX-T-AUTO-/);
        assert.match(request.prompt, /Determine the local canonical widget rule/);
        assert.ok(request.tools?.includes("read"));
        assert.ok(request.tools?.includes("bash"));
        assert.ok(request.tools?.includes("scaler_research_report"));
        const requestId = request.taskId.slice("research-agent-".length);
        return {
          taskId: request.taskId,
          exitCode: 0,
          stdoutEvents: [{
            type: "scaler_research_report",
            id: "R-AUTO-CONTEXT",
            requestId,
            taskId: "T-AUTO",
            question,
            status: "complete",
            sources: [{ id: "local-ledger", title: "Local ledger", quality: "project", path: "src/autopilot.ts" }],
            conclusions: [{
              summary: "Widgets use the accepted local ledger rule.",
              confidence: "high",
              sourceRefs: ["local-ledger"],
            }],
            unresolvedUnknowns: [],
          }],
          stderr: "",
          timedOut: false,
          aborted: false,
        };
      },
    });

    assert.equal(result.completed, true, result.message);
    assert.equal(taskCalls, 2);
    assert.equal(researchCalls, 1);
    assert.ok((await loadMissingContextRequests(dir)).every((request) => request.status === "resolved"));
    assert.equal((await loadState(dir)).tasks.find((task) => task.id === "T-AUTO")?.status, "validated");
  });
});

test("runScalerAutomation stops after one unresolved missing-context research result", async () => {
  await withTempDir(async (dir) => {
    const state = createState("planning");
    await saveState(dir, state);
    const question = "Determine the unresolved local widget rule.";
    let taskCalls = 0;
    let researchCalls = 0;

    const result = await runScalerAutomation(dir, state, {
      maxSteps: 12,
      maxStageSteps: 5,
      researchTools: ["read"],
    }, {
      stage: stageRunner,
      task: async (request) => {
        taskCalls += 1;
        return {
          taskId: request.taskId,
          exitCode: 0,
          stdoutEvents: [{
            type: "scaler_task_report",
            taskId: request.taskId,
            ...request.attempt,
            status: "needs_data",
            summary: "Need a focused local fact before continuing.",
            changedFiles: [],
            blockers: [],
            missingData: [question],
          }],
          stderr: "",
          timedOut: false,
          aborted: false,
        };
      },
      research: async (request) => {
        researchCalls += 1;
        const requestId = request.taskId.slice("research-agent-".length);
        return {
          taskId: request.taskId,
          exitCode: 0,
          stdoutEvents: [{
            type: "scaler_research_report",
            id: "R-AUTO-CONTEXT-PARTIAL",
            requestId,
            taskId: "T-AUTO",
            question,
            status: "partial",
            sources: [{ id: "local-ledger", title: "Local ledger", quality: "project", path: "docs/local-ledger.md" }],
            conclusions: [],
            unresolvedUnknowns: ["The local rule is still unknown."],
          }],
          stderr: "",
          timedOut: false,
          aborted: false,
        };
      },
    });

    assert.equal(result.completed, false);
    assert.equal(result.stopReason, "blocked");
    assert.equal(taskCalls, 1);
    assert.equal(researchCalls, 1, "automation must not rerun incomplete research within the same call");
    assert.notEqual((await loadMissingContextRequests(dir))[0]?.status, "resolved");
    assert.equal((await loadState(dir)).tasks.find((task) => task.id === "T-AUTO")?.status, "blocked");
  });
});

test("runScalerAutomation refreshes completed explicit research before attempting another run", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src", "autopilot.ts"), "// Explicit research already established the widget rule.\n");
    const state = createState("planning");
    await saveState(dir, state);
    const question = "Determine the already researched local widget rule.";
    let taskCalls = 0;
    let researchCalls = 0;
    const task = async (request: TaskAgentRequest): Promise<TaskAgentRunResult> => {
      taskCalls += 1;
      if (taskCalls === 1) {
        return {
          taskId: request.taskId,
          exitCode: 0,
          stdoutEvents: [{
            type: "scaler_task_report", taskId: request.taskId, ...request.attempt,
            status: "needs_data", summary: "Need a focused local fact.", changedFiles: [], blockers: [], missingData: [question],
          }],
          stderr: "", timedOut: false, aborted: false,
        };
      }
      assert.match(request.prompt, /Explicit research already established the widget rule/);
      return taskRunner(request);
    };

    await runScalerAutomation(dir, state, { maxSteps: 2, maxStageSteps: 5 }, { stage: stageRunner, task });
    const [missing] = await loadMissingContextRequests(dir);
    const dispatched = await dispatchMissingContextRequest(dir, await loadState(dir), missing!.id, { execute: true });
    const researchRequestId = dispatched.request?.evidenceRefs?.find((reference) => reference.startsWith("RESEARCH-"));
    assert.ok(researchRequestId);
    await recordResearchReport(dir, {
      id: "R-AUTO-EXPLICIT",
      requestId: researchRequestId,
      taskId: "T-AUTO",
      question,
      status: "complete",
      sources: [{ id: "explicit-local", title: "Explicit local evidence", quality: "project", path: "src/autopilot.ts" }],
      conclusions: [{
        summary: "Explicit research already established the widget rule.",
        confidence: "high",
        sourceRefs: ["explicit-local"],
      }],
      unresolvedUnknowns: [],
    });

    const result = await runScalerAutomation(dir, await loadState(dir), { maxSteps: 8 }, {
      task,
      research: async () => {
        researchCalls += 1;
        throw new Error("completed research must be refreshed instead of rerun");
      },
    });

    assert.equal(result.completed, true, result.message);
    assert.equal(taskCalls, 2);
    assert.equal(researchCalls, 0);
    assert.equal((await loadMissingContextRequests(dir))[0]?.status, "resolved");
  });
});

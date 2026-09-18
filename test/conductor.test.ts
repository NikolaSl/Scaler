/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { getBudgetState, setBudgetLimits } from "../src/budgets.js";
import {
  buildTaskAgentPrompt,
  dependenciesSatisfied,
  formatTaskAgentRunList,
  loadTaskAgentRunRecords,
  loadValidationHandoffs,
  missingDependencies,
  recordTaskAgentRun,
  runConductorStep,
  selectNextTask,
} from "../src/conductor.js";
import { saveTaskContextManifest } from "../src/context.js";
import { loadContextSplitRecords } from "../src/context-splits.js";
import { recordDebugAttempt } from "../src/debug.js";
import { loadTaskAgentReports } from "../src/task-reports.js";
import { admitTaskAttempt, loadTaskAttempts, markTaskAttemptDispatching, type TaskAttemptBinding } from "../src/task-attempts.js";
import { fingerprintJson } from "../src/fingerprints.js";
import { acquireExecutionLock, loadExecutionLock, releaseExecutionLock } from "../src/locks.js";
import { createDefaultState, loadState, saveState } from "../src/state.js";
import type { ScalerTaskStatus } from "../src/types.js";
import { saveValidationManifest } from "../src/validation.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-conductor-test-"));
  try {
    for (const taskId of ["T-001", "T-002", "T-003"]) {
      await saveValidationManifest(dir, {
        taskId, outputPaths: [], acceptanceCriteria: ["The synthetic task report is handed to validation."],
        commands: [], createdAt: "", updatedAt: "",
      });
    }
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function stateWithTasks(statuses: ScalerTaskStatus[]) {
  const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
  state.tasks = statuses.map((status, index) => ({
    id: `T-00${index + 1}`, status,
    allowedPathPrefixes: ["src"], definitionOfDone: ["The synthetic task report is handed to validation."],
    updatedAt: state.createdAt,
  }));
  return state;
}

function completedTaskReport(request: string | { taskId: string; attempt?: TaskAttemptBinding }, summary = "Task complete.") {
  const taskId = typeof request === "string" ? request : request.taskId;
  return {
    type: "scaler_task_report",
    taskId,
    ...(typeof request === "string" ? {} : request.attempt),
    status: "completed",
    summary,
    changedFiles: ["src/app.ts"],
    memoryRefs: [],
    validations: [{ command: "npm test", status: "passed", summary: "passed" }],
    validationRefs: [],
    evidenceRefs: ["validation:npm-test"],
    blockers: [],
    missingData: [],
    recommendedNextAction: "validate",
  };
}

test("selectNextTask prefers ready tasks in stable order", () => {
  const selection = selectNextTask(stateWithTasks(["pending", "ready", "ready"]));

  assert.equal(selection.task?.id, "T-002");
  assert.equal(selection.promotePending, false);
});

test("selectNextTask selects pending task when no ready tasks exist", () => {
  const selection = selectNextTask(stateWithTasks(["blocked", "pending"]));

  assert.equal(selection.task?.id, "T-002");
  assert.equal(selection.promotePending, true);
});

test("selectNextTask skips tasks with unmet dependencies", () => {
  const state = stateWithTasks(["ready", "pending", "validated"]);
  state.tasks[0]!.dependsOn = ["T-003"];
  state.tasks[1]!.dependsOn = ["T-404"];
  state.validatedTaskIds = ["T-003"];

  const selection = selectNextTask(state);

  assert.equal(selection.task?.id, "T-001");
  assert.equal(dependenciesSatisfied(state, state.tasks[0]!), true);
  assert.deepEqual(missingDependencies(state, state.tasks[1]!), ["T-404"]);
});

test("selectNextTask reports dependency-blocked tasks when none are runnable", () => {
  const state = stateWithTasks(["ready", "pending"]);
  state.tasks[0]!.dependsOn = ["T-000"];
  state.tasks[1]!.dependsOn = ["T-001"];

  const selection = selectNextTask(state);

  assert.equal(selection.task, undefined);
  assert.match(selection.reason, /Blocked by dependencies T-001:waiting-for:T-000, T-002:waiting-for:T-001/);
});

test("selectNextTask ignores blocked and terminal tasks", () => {
  const selection = selectNextTask(stateWithTasks(["blocked", "validated", "failed"]));

  assert.equal(selection.task, undefined);
  assert.equal(selection.promotePending, false);
  assert.match(selection.reason, /No runnable tasks/);
  assert.match(selection.reason, /T-001:blocked/);
});

test("selectNextTask returns clear reason for empty state", () => {
  const selection = selectNextTask(createDefaultState());

  assert.equal(selection.task, undefined);
  assert.equal(selection.reason, "No tasks exist.");
});

test("buildTaskAgentPrompt includes task metadata and report instructions", () => {
  const state = stateWithTasks(["ready"]);
  state.stage = "execution";
  state.tasks[0]!.title = "Implement widget";
  state.tasks[0]!.allowedPathPrefixes = ["src", "test"];
  state.tasks[0]!.dependsOn = ["T-000"];

  const result = buildTaskAgentPrompt({
    state,
    task: state.tasks[0]!,
    contextItems: [
      {
        id: "spec",
        type: "file",
        reason: "Task requirement",
        content: "Widget must render labels.",
        priority: "required",
        scope: "summary",
      },
    ],
  });

  assert.match(result.prompt, /Task ID: T-001/);
  assert.match(result.prompt, /Task title: Implement widget/);
  assert.match(result.prompt, /Current task status: ready/);
  assert.match(result.prompt, /Allowed paths: src, test/);
  assert.match(result.prompt, /Dependencies: T-000/);
  assert.match(result.prompt, /Safety and scope/);
  assert.match(result.prompt, /read\/write\/edit only files under those paths/);
  assert.match(result.prompt, /Do not read or modify protected paths/);
  assert.match(result.prompt, /Do not run destructive commands/);
  assert.match(result.prompt, /Required final report/);
  assert.match(result.prompt, /scaler_task_report/);
  assert.match(result.prompt, /Compression and Exact-Preservation Policy/);
  assert.match(result.prompt, /Summary-ok refs: spec/);
  assert.match(result.prompt, /Widget must render labels/);
});

test("runConductorStep refuses unresolved debug retry gates before locking", async () => {
  await withTempDir(async (dir) => {
    const state = stateWithTasks(["ready"]);
    state.stage = "debugging";
    await recordDebugAttempt(dir, state, {
      taskId: "T-001",
      failureId: "F-001",
      hypothesis: "Fix A",
      actionSummary: "Change A",
      result: "new_failure",
      failureFingerprint: "failure-a",
      resultingFailureFingerprint: "failure-b",
    }, new Date("2026-01-01T00:00:01.000Z"));
    await recordDebugAttempt(dir, state, {
      taskId: "T-001",
      failureId: "F-001",
      hypothesis: "Fix B",
      actionSummary: "Change B",
      result: "new_failure",
      failureFingerprint: "failure-b",
      resultingFailureFingerprint: "failure-a",
    }, new Date("2026-01-01T00:00:02.000Z"));

    const result = await runConductorStep(dir, state);

    assert.equal(result.accepted, false);
    assert.match(result.message, /Debug retry blocked for T-001/);
    assert.equal(await loadExecutionLock(dir), undefined);
  });
});

test("runConductorStep refuses when execution lock is held", async () => {
  await withTempDir(async (dir) => {
    const state = stateWithTasks(["ready"]);
    await acquireExecutionLock(dir, { operation: "other", taskId: "T-999" });

    const result = await runConductorStep(dir, state);

    assert.equal(result.accepted, false);
    assert.match(result.message, /Execution lock held/);
    assert.equal((await loadExecutionLock(dir))?.taskId, "T-999");
  });
});

test("runConductorStep releases execution lock after prepare", async () => {
  await withTempDir(async (dir) => {
    const state = stateWithTasks(["ready"]);

    const result = await runConductorStep(dir, state);

    assert.equal(result.accepted, true);
    assert.equal(await loadExecutionLock(dir), undefined);
    assert.deepEqual(await loadTaskAttempts(dir), []);
  });
});

test("runConductorStep prepares selected task and writes checkpoint", async () => {
  await withTempDir(async (dir) => {
    const state = stateWithTasks(["pending"]);
    state.stage = "execution";
    const result = await runConductorStep(dir, state, { tools: ["read"] });
    const persisted = await loadState(dir);

    assert.equal(result.accepted, true);
    assert.equal(result.task?.id, "T-001");
    assert.equal(persisted.tasks[0]?.status, "pending");
    assert.equal(persisted.currentTaskId, null);
    const executed = await runConductorStep(dir, persisted, { execute: true }, async (request) => {
      assert.equal((await loadState(dir)).tasks[0]?.status, "running");
      return { taskId: request.taskId, exitCode: 0, stdoutEvents: [completedTaskReport(request)], stderr: "", timedOut: false, aborted: false };
    });
    assert.equal(executed.accepted, true);
    assert.equal(executed.state.tasks[0]?.status, "validating");
    assert.ok(result.invocation?.args.includes("--tools"));
    assert.ok(result.checkpointPath?.includes("conductor-step-t-001"));
  });
});

test("runConductorStep records context split artifacts for oversized resolved context", async () => {
  await withTempDir(async (dir) => {
    const state = stateWithTasks(["ready"]);
    state.tasks[0]!.title = "Oversized";
    const result = await runConductorStep(dir, state, {
      tokenBudget: 100,
      contextItems: [
        { id: "huge", type: "file", reason: "Need exact huge data", content: "x".repeat(400), priority: "required", scope: "full", exactness: "exact" },
      ],
    });

    const records = await loadContextSplitRecords(dir);
    assert.equal(result.contextSplit?.taskId, "T-001");
    assert.equal(records[0]?.id, result.contextSplit?.id);
    assert.ok(records[0]?.overByTokens && records[0].overByTokens > 0);
  });
});

test("runConductorStep refuses an oversized required prompt before execution side effects", async () => {
  await withTempDir(async (dir) => {
    const state = stateWithTasks(["ready"]);
    state.stage = "execution";
    let runnerCalls = 0;
    const result = await runConductorStep(dir, state, {
      execute: true,
      tokenBudget: 1_000,
      contextItems: [{
        id: "huge-exact", type: "file", reason: "The task requires the exact source.",
        content: `EXACT_START\n${"x".repeat(40_000)}\nEXACT_END`,
        priority: "required", scope: "full", exactness: "exact",
      }],
    }, async () => {
      runnerCalls += 1;
      throw new Error("must not dispatch");
    });

    assert.equal(result.accepted, false);
    assert.equal(result.promptAdmission?.accepted, false);
    assert.ok((result.promptAdmission?.estimatedTokens ?? 0) > 1_000);
    assert.match(result.message, /final SCALER prompt refused/i);
    assert.equal(runnerCalls, 0);
    assert.deepEqual(await loadTaskAttempts(dir), []);
    assert.equal(result.state.tasks[0]?.status, "ready");
    assert.equal(getBudgetState(result.state).usage.spawnedAgents ?? 0, 0);
    assert.ok(result.contextSplit);
  });
});

test("runConductorStep measures prompt bytes instead of trusting understated item estimates", async () => {
  await withTempDir(async (dir) => {
    const state = stateWithTasks(["ready"]);
    state.stage = "execution";
    let runnerCalls = 0;
    const result = await runConductorStep(dir, state, {
      execute: true,
      tokenBudget: 1_000,
      contextItems: [{
        id: "understated", type: "file", reason: "Caller estimate is not dispatch authority.",
        content: "x".repeat(20_000), priority: "required", scope: "full", exactness: "exact", estimatedTokens: 1,
      }],
    }, async () => {
      runnerCalls += 1;
      throw new Error("must not dispatch");
    });

    assert.equal(result.promptAdmission?.accepted, false);
    assert.equal(runnerCalls, 0);
    assert.deepEqual(await loadTaskAttempts(dir), []);
    assert.equal(result.contextSplit, undefined);
  });
});

test("runConductorStep refuses when the final wrapper alone exceeds the allowance", async () => {
  await withTempDir(async (dir) => {
    const state = stateWithTasks(["ready"]);
    state.stage = "execution";
    let runnerCalls = 0;
    const result = await runConductorStep(dir, state, { execute: true, tokenBudget: 1, contextItems: [] }, async () => {
      runnerCalls += 1;
      throw new Error("must not dispatch");
    });

    assert.equal(result.accepted, false);
    assert.equal(result.promptAdmission?.accepted, false);
    assert.equal(runnerCalls, 0);
    assert.deepEqual(await loadTaskAttempts(dir), []);
    assert.equal(result.state.tasks[0]?.status, "ready");
  });
});

test("runConductorStep refuses a non-finite prompt allowance", async () => {
  await withTempDir(async (dir) => {
    const state = stateWithTasks(["ready"]);
    state.stage = "execution";
    let runnerCalls = 0;
    const result = await runConductorStep(dir, state, {
      execute: true,
      tokenBudget: Number.POSITIVE_INFINITY,
      contextItems: [{ id: "huge", type: "file", reason: "Must not become unbounded.", content: "x".repeat(40_000), priority: "required", scope: "full" }],
    }, async () => {
      runnerCalls += 1;
      throw new Error("must not dispatch");
    });

    assert.equal(result.promptAdmission?.accepted, false);
    assert.match(result.message, /positive finite integer/i);
    assert.equal(runnerCalls, 0);
    assert.deepEqual(await loadTaskAttempts(dir), []);
  });
});

test("runConductorStep uses task context manifest when explicit context is absent", async () => {
  await withTempDir(async (dir) => {
    const state = stateWithTasks(["ready"]);
    state.stage = "execution";
    await writeFile(join(dir, "context.md"), "Manifest file context", "utf8");
    await saveTaskContextManifest(dir, {
      version: 1,
      taskId: "T-001",
      items: [
        { id: "file", type: "file", reason: "Needed file", priority: "required", scope: "full", source: "file", path: "context.md" },
      ],
      createdAt: state.createdAt,
      updatedAt: state.createdAt,
    });

    const result = await runConductorStep(dir, state);

    assert.equal(result.accepted, true);
    assert.match(result.prompt ?? "", /Manifest file context/);
    assert.deepEqual(result.prompt?.match(/## Context: file/g), ["## Context: file"]);
  });
});

test("runConductorStep records context tokens and spawned agents", async () => {
  await withTempDir(async (dir) => {
    const state = stateWithTasks(["ready"]);
    state.stage = "execution";

    const result = await runConductorStep(dir, state, { execute: true }, async (request) => ({
      taskId: request.taskId,
      exitCode: 0,
      stdoutEvents: [completedTaskReport(request)],
      stderr: "",
      timedOut: false,
      aborted: false,
    }));

    const budgets = getBudgetState(result.state);
    assert.equal(budgets.usage.spawnedAgents, 1);
    assert.ok((budgets.usage.contextTokens ?? 0) > 0);
  });
});

test("runConductorStep records provider usage budgets from task-agent runs", async () => {
  await withTempDir(async (dir) => {
    const state = stateWithTasks(["ready"]);
    state.stage = "execution";

    const result = await runConductorStep(dir, state, { execute: true }, async (request) => ({
      taskId: request.taskId,
      exitCode: 0,
      stdoutEvents: [completedTaskReport(request)],
      stderr: "",
      timedOut: false,
      aborted: false,
      usage: { inputTokens: 21, outputTokens: 9, totalTokens: 30, costMicros: 44, sources: ["mock"] },
    }));

    const budgets = getBudgetState(result.state);
    assert.ok((budgets.usage.contextTokens ?? 0) >= 30);
    assert.equal(budgets.usage.estimatedCostMicros, 44);
    const runs = await loadTaskAgentRunRecords(dir);
    assert.equal(runs[0]?.usage?.totalTokens, 30);
  });
});

test("runConductorStep refuses hard budget limits before executing runner", async () => {
  await withTempDir(async (dir) => {
    const state = setBudgetLimits(stateWithTasks(["ready"]), { spawnedAgents: { hard: 1 } });
    state.stage = "execution";
    let called = false;

    const result = await runConductorStep(dir, state, { execute: true }, async (request) => {
      called = true;
      return { taskId: request.taskId, exitCode: 0, stdoutEvents: [], stderr: "", timedOut: false, aborted: false };
    });

    assert.equal(result.accepted, false);
    assert.equal(called, false);
    assert.match(result.message, /Budget hard limit refused task T-001/);
    assert.equal(getBudgetState(result.state).usage.spawnedAgents ?? 0, 0);
    assert.equal(result.state.tasks[0]?.status, "ready");
    assert.equal(result.state.currentTaskId, null);
  });
});

test("runConductorStep preserves worker-persisted state before accounting and handoff", async () => {
  await withTempDir(async (dir) => {
    const state = stateWithTasks(["ready", "pending"]);
    state.stage = "execution";
    const result = await runConductorStep(dir, state, { execute: true }, async (request) => {
      const childState = await loadState(dir);
      childState.memoryRefs.push("child-evidence");
      childState.tasks[1]!.title = "Preserved child update";
      await saveState(dir, childState);
      return {
        taskId: request.taskId, exitCode: 0,
        stdoutEvents: [completedTaskReport(request)], stderr: "", timedOut: false, aborted: false,
        usage: { inputTokens: 21, outputTokens: 9, totalTokens: 30, costMicros: 44, sources: ["mock"] },
      };
    });
    const persisted = await loadState(dir);
    assert.equal(result.accepted, true);
    assert.deepEqual(persisted.memoryRefs, ["child-evidence"]);
    assert.equal(persisted.tasks[1]?.title, "Preserved child update");
    assert.equal(persisted.tasks[0]?.status, "validating");
    assert.equal(getBudgetState(persisted).usage.estimatedCostMicros, 44);
  });
});

test("runConductorStep rejects a child result after the durable run is replaced", async () => {
  await withTempDir(async (dir) => {
    const state = stateWithTasks(["ready"]);
    const replacement = createDefaultState();
    const result = await runConductorStep(dir, state, { execute: true }, async (request) => {
      // Inject an externally replaced run: the normal save API now rejects it.
      await writeFile(join(dir, ".scaler", "state.json"), JSON.stringify({ ...replacement, revision: 1 }));
      return { taskId: request.taskId, exitCode: 0, stdoutEvents: [completedTaskReport(request)], stderr: "", timedOut: false, aborted: false };
    });
    assert.equal(result.accepted, false);
    assert.match(result.message, /stale.*run|run.*changed/i);
    assert.equal((await loadState(dir)).runId, replacement.runId);
    assert.equal((await loadValidationHandoffs(dir)).length, 0);
    assert.equal(await loadExecutionLock(dir), undefined);
  });
});

test("runConductorStep executes task with injected runner", async () => {
  await withTempDir(async (dir) => {
    const state = stateWithTasks(["ready"]);
    state.stage = "execution";
    const result = await runConductorStep(
      dir,
      state,
      { execute: true, timeoutMs: 123 },
      async (request, options) => {
        assert.ok(request.tools?.includes("read"));
        assert.ok(request.tools?.includes("bash"));
        assert.ok(request.tools?.includes("edit"));
        assert.ok(request.tools?.includes("write"));
        assert.ok(request.tools?.includes("scaler_task_report"));
        assert.ok(request.providerAdmission);
        assert.equal(request.providerAdmission.outputReserveTokens, 1_024);
        assert.equal(request.providerAdmission.safetyMarginTokens, 1_024);
        assert.ok(request.providerAdmission.requestTokenAllowance > 0);
        return {
          taskId: request.taskId,
          exitCode: options?.timeoutMs === 123 ? 0 : 1,
          stdoutEvents: [{ type: "done" }, completedTaskReport(request)],
          stderr: "",
          timedOut: false,
          aborted: false,
        };
      },
    );

    const persisted = await loadState(dir);
    const handoffs = await loadValidationHandoffs(dir);
    const runs = await loadTaskAgentRunRecords(dir);

    assert.equal(result.accepted, true);
    assert.equal(result.runResult?.exitCode, 0);
    assert.equal(result.runResult?.stdoutEvents.length, 2);
    assert.deepEqual(result.runResult?.stdoutEvents[0], { type: "done" });
    assert.equal((result.runResult?.stdoutEvents[1] as { taskId?: string })?.taskId, "T-001");
    assert.equal((result.runResult?.stdoutEvents[1] as { attemptId?: string })?.attemptId, runs[0]?.attempt?.attemptId);
    assert.equal(persisted.tasks[0]?.status, "validating");
    assert.equal(handoffs[0]?.status, "validation_required");
    assert.equal(runs[0]?.status, "passed");
    assert.equal(runs[0]?.stdoutEventCount, 2);
    assert.equal(runs[0]?.reportStatus, "accepted");
    assert.ok(runs[0]?.reportId);
    assert.equal((await loadTaskAgentReports(dir))[0]?.status, "completed");
    assert.equal(runs[0]?.timedOut, false);
    assert.equal(runs[0]?.aborted, false);
    const attempts = await loadTaskAttempts(dir);
    assert.equal(attempts[0]?.status, "completed");
    assert.equal(attempts[0]?.outcome, "succeeded");
    assert.equal(attempts[0]?.id, runs[0]?.attempt?.attemptId);
    assert.equal(attempts[0]?.id, handoffs[0]?.attempt?.attemptId);
    assert.equal(attempts[0]?.outputFingerprint, runs[0]?.outputFingerprint);
    assert.equal(attempts[0]?.outputFingerprint, handoffs[0]?.outputFingerprint);
    assert.equal(persisted.tasks[0]?.attemptId, attempts[0]?.id);
    assert.match(result.prompt ?? "", new RegExp(`Attempt ID: ${attempts[0]?.id}`));
  });
});

test("runConductorStep rejects a report from a different attempt", async () => {
  await withTempDir(async (dir) => {
    const state = stateWithTasks(["ready"]);
    state.stage = "execution";
    const result = await runConductorStep(dir, state, { execute: true }, async (request) => ({
      taskId: request.taskId,
      exitCode: 0,
      stdoutEvents: [{ ...completedTaskReport(request), attemptId: "stale-attempt" }],
      stderr: "",
      timedOut: false,
      aborted: false,
    }));

    assert.equal(result.validationHandoff?.status, "task_agent_report_invalid");
    assert.match(result.validationHandoff?.diagnostics?.join(" ") ?? "", /stale-attempt.*does not match admitted/);
    assert.equal((await loadState(dir)).tasks[0]?.status, "blocked");
    assert.deepEqual(await loadTaskAgentReports(dir), []);
    const attempt = (await loadTaskAttempts(dir))[0];
    assert.equal(attempt?.status, "failed");
    assert.equal(attempt?.outcome, "failed");
  });
});

test("runConductorStep records unknown outcome and blocks replay when runner throws after dispatch", async () => {
  await withTempDir(async (dir) => {
    const state = stateWithTasks(["ready"]);
    state.stage = "execution";

    await assert.rejects(
      runConductorStep(dir, state, { execute: true }, async () => { throw new Error("runner transport lost"); }),
      /runner transport lost/,
    );

    const attempt = (await loadTaskAttempts(dir))[0];
    assert.equal(attempt?.status, "interrupted");
    assert.equal(attempt?.outcome, "unknown");
    assert.match(attempt?.diagnostics?.join(" ") ?? "", /runner transport lost/);
    assert.equal((await loadState(dir)).tasks[0]?.status, "blocked");
    assert.equal(await loadExecutionLock(dir), undefined);
  });
});

test("runConductorStep reconciles an orphaned dispatch before selecting new work", async () => {
  await withTempDir(async (dir) => {
    const state = stateWithTasks(["running", "ready"]);
    state.stage = "execution";
    await saveState(dir, state);
    const lock = await acquireExecutionLock(dir, { operation: "crashed", taskId: "T-001" });
    const attempt = await admitTaskAttempt(dir, lock.lock.id, {
      runId: state.runId,
      taskId: "T-001",
      taskFingerprint: fingerprintJson({ task: "T-001" }),
      inputFingerprint: fingerprintJson({ input: "one" }),
      routeFingerprint: fingerprintJson({ route: "one" }),
      validationPolicyFingerprint: fingerprintJson({ policy: "one" }),
    });
    state.tasks[0]!.attemptId = attempt.id;
    await saveState(dir, state);
    await markTaskAttemptDispatching(dir, lock.lock.id, attempt.id);
    await releaseExecutionLock(dir, lock.lock.id);

    const result = await runConductorStep(dir, await loadState(dir), { execute: true }, async () => {
      throw new Error("must not dispatch");
    });

    assert.equal(result.accepted, false);
    assert.match(result.message, /automatic replay is blocked/);
    assert.equal((await loadState(dir)).tasks[0]?.status, "blocked");
    assert.equal((await loadState(dir)).tasks[1]?.status, "ready");
    assert.equal((await loadTaskAttempts(dir))[0]?.status, "interrupted");
  });
});

test("runConductorStep blocks validation when successful task-agent omits report", async () => {
  await withTempDir(async (dir) => {
    const state = stateWithTasks(["ready"]);
    state.stage = "execution";
    const result = await runConductorStep(dir, state, { execute: true }, async (request) => ({
      taskId: request.taskId,
      exitCode: 0,
      stdoutEvents: [{ type: "done" }],
      stderr: "",
      timedOut: false,
      aborted: false,
    }));

    const persisted = await loadState(dir);
    const handoffs = await loadValidationHandoffs(dir);
    const runs = await loadTaskAgentRunRecords(dir);

    assert.equal(result.validationHandoff?.status, "task_agent_report_missing");
    assert.equal(persisted.tasks[0]?.status, "blocked");
    assert.equal(handoffs[0]?.status, "task_agent_report_missing");
    assert.equal(runs[0]?.reportStatus, "missing");
    assert.match(runs[0]?.reportDiagnostics?.join(" ") ?? "", /Missing required scaler_task_report/);
  });
});

test("runConductorStep blocks validation when task-agent report is invalid", async () => {
  await withTempDir(async (dir) => {
    const state = stateWithTasks(["ready"]);
    state.stage = "execution";
    const result = await runConductorStep(dir, state, { execute: true }, async (request) => ({
      taskId: request.taskId,
      exitCode: 0,
      stdoutEvents: [{ type: "scaler_task_report", taskId: "WRONG", status: "completed", summary: "Wrong task" }],
      stderr: "",
      timedOut: false,
      aborted: false,
    }));

    const persisted = await loadState(dir);
    const handoffs = await loadValidationHandoffs(dir);
    const runs = await loadTaskAgentRunRecords(dir);

    assert.equal(result.validationHandoff?.status, "task_agent_report_invalid");
    assert.equal(persisted.tasks[0]?.status, "blocked");
    assert.equal(handoffs[0]?.status, "task_agent_report_invalid");
    assert.equal(runs[0]?.reportStatus, "invalid");
    assert.match(runs[0]?.reportDiagnostics?.join(" ") ?? "", /does not match expected task/);
  });
});

test("runConductorStep records failed task-agent validation handoff", async () => {
  await withTempDir(async (dir) => {
    const state = stateWithTasks(["ready"]);
    state.stage = "execution";
    const result = await runConductorStep(
      dir,
      state,
      { execute: true },
      async (request) => ({
        taskId: request.taskId,
        exitCode: 2,
        stdoutEvents: [],
        stderr: "boom",
        timedOut: false,
        aborted: false,
      }),
    );
    const persisted = await loadState(dir);
    const handoffs = await loadValidationHandoffs(dir);
    const runs = await loadTaskAgentRunRecords(dir);

    assert.equal(result.validationHandoff?.status, "task_agent_failed");
    assert.equal(persisted.tasks[0]?.status, "failed");
    assert.equal(handoffs[0]?.runExitCode, 2);
    assert.equal(runs[0]?.status, "failed");
    assert.equal(runs[0]?.stderrSummary, "boom");
  });
});

test("formatTaskAgentRunList renders and filters run records", () => {
  const records = [
    {
      id: "1",
      taskId: "T-001",
      status: "failed" as const,
      exitCode: 124,
      stdoutEventCount: 2,
      stderrSummary: "timeout",
      timedOut: true,
      aborted: false,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "2",
      taskId: "T-002",
      status: "passed" as const,
      exitCode: 0,
      stdoutEventCount: 1,
      stderrSummary: "",
      timedOut: false,
      aborted: false,
      createdAt: "2026-01-01T00:01:00.000Z",
    },
  ];

  assert.match(formatTaskAgentRunList(records), /T-001: failed exit=124 flags=timed_out stdout_events=2 stderr=timeout/);
  assert.doesNotMatch(formatTaskAgentRunList(records, "T-002"), /T-001/);
  assert.equal(formatTaskAgentRunList(records, "missing"), "No task-agent runs for missing.");
});

test("recordTaskAgentRun truncates stderr summaries", async () => {
  await withTempDir(async (dir) => {
    const record = await recordTaskAgentRun(dir, {
      taskId: "T-001",
      exitCode: 1,
      stdoutEvents: [],
      stderr: "x".repeat(1_010),
      timedOut: true,
      aborted: false,
    });

    assert.equal(record.status, "failed");
    assert.equal(record.timedOut, true);
    assert.equal(record.aborted, false);
    assert.match(record.stderrSummary, /truncated 10 chars/);
  });
});

test("buildTaskAgentPrompt returns context omissions from resolver", () => {
  const state = stateWithTasks(["ready"]);
  const result = buildTaskAgentPrompt({
    state,
    task: state.tasks[0]!,
    tokenBudget: 20,
    contextItems: [
      {
        id: "required",
        type: "file",
        reason: "Must include",
        content: "Required context",
        priority: "required",
        scope: "summary",
      },
      {
        id: "optional",
        type: "file",
        reason: "Can omit",
        content: "Optional ".repeat(100),
        priority: "optional",
        scope: "summary",
      },
    ],
  });

  assert.deepEqual(result.resolvedContext.included.map((item) => item.id), ["required"]);
  assert.deepEqual(result.resolvedContext.omitted.map((item) => item.id), ["optional"]);
  assert.doesNotMatch(result.prompt, /Optional Optional Optional/);
});

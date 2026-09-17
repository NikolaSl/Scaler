/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import { fingerprintAdmittedInput, fingerprintTaskContract, fingerprintTaskRoute, fingerprintValidationPolicy } from "./attempt-identity.js";
import { verifyTaskDependenciesAccepted } from "./accepted-evidence.js";
import type { ResolvedContext } from "./context.js";
import { acquireExecutionLock, releaseExecutionLock } from "./locks.js";
import { appendLogEvent, createLogEvent } from "./logging.js";
import { loadState, saveState } from "./state.js";
import { transitionTask } from "./supervisor.js";
import { admitTaskAttempt, assertAttemptWriter, completeTaskAttempt, loadTaskAttempts, markTaskAttemptDispatching, taskAttemptBinding, type TaskAttemptRecord } from "./task-attempts.js";
import type { ScalerState, ScalerTaskState } from "./types.js";
import { getValidationManifestForTask } from "./validation.js";

export class TaskDependencyAdmissionError extends Error {
  constructor(
    readonly taskId: string,
    readonly diagnostics: string[],
  ) {
    super(`Task ${taskId} dependency admission rejected: ${diagnostics.join(" ")}`);
    this.name = "TaskDependencyAdmissionError";
  }
}

export class TaskContractAdmissionError extends Error {
  constructor(
    readonly taskId: string,
    readonly diagnostics: string[],
  ) {
    super(`Task ${taskId} contract admission rejected: ${diagnostics.join(" ")}`);
    this.name = "TaskContractAdmissionError";
  }
}

export async function verifyTaskExecutionContract(cwd: string, task: ScalerTaskState): Promise<string[]> {
  const diagnostics: string[] = [];
  if (!task.allowedPathPrefixes?.some((path) => path.trim())) {
    diagnostics.push("missing declared project write scope (allowedPathPrefixes).");
  }

  let manifest;
  try {
    manifest = await getValidationManifestForTask(cwd, task.id);
  } catch (error) {
    diagnostics.push(`validation contract unavailable: ${String(error)}`);
    return diagnostics;
  }
  if (manifest.outputPaths === undefined) {
    diagnostics.push("missing declared output basis (outputPaths; use [] explicitly for no filesystem outputs).");
  }
  const acceptanceStatements = [
    ...(task.definitionOfDone ?? []),
    ...(manifest.definitionOfDone ?? []),
    ...(manifest.acceptanceCriteria ?? []),
  ];
  if (!acceptanceStatements.some((statement) => statement.trim())) {
    diagnostics.push("missing acceptance criteria (Definition of Done or validation-manifest acceptance criteria).");
  }
  return diagnostics;
}

export async function admitTaskExecution(
  cwd: string, lockId: string, state: ScalerState, task: ScalerTaskState,
  context: ResolvedContext, model: string | undefined, tools: string[],
): Promise<TaskAttemptRecord> {
  const contractDiagnostics = await verifyTaskExecutionContract(cwd, task);
  if (contractDiagnostics.length > 0) throw new TaskContractAdmissionError(task.id, contractDiagnostics);
  const dependencyDiagnostics = await verifyTaskDependenciesAccepted(cwd, state, task);
  if (dependencyDiagnostics.length > 0) throw new TaskDependencyAdmissionError(task.id, dependencyDiagnostics);
  const taskFingerprint = fingerprintTaskContract(task);
  return admitTaskAttempt(cwd, lockId, {
    runId: state.runId,
    taskId: task.id,
    taskFingerprint,
    inputFingerprint: fingerprintAdmittedInput(taskFingerprint, context),
    routeFingerprint: fingerprintTaskRoute(model, tools),
    validationPolicyFingerprint: fingerprintValidationPolicy(await getValidationManifestForTask(cwd, task.id)),
  });
}

export async function startTaskExecution(cwd: string, lockId: string, state: ScalerState, attempt: TaskAttemptRecord) {
  await assertAttemptWriter(cwd, lockId, attempt.taskId);
  const current = (await loadTaskAttempts(cwd)).find((candidate) => candidate.id === attempt.id);
  if (current?.status !== "admitted" || state.runId !== attempt.runId) {
    throw new Error(`Task attempt ${attempt.id} is not an admitted attempt for this run.`);
  }
  const nextState = transitionTask({
    ...state,
    tasks: state.tasks.map((task) => task.id === attempt.taskId ? { ...task, attemptId: attempt.id } : task),
  }, attempt.taskId, "running", { reason: `Dispatching task attempt ${attempt.id}.` });
  if (nextState.tasks.find((task) => task.id === attempt.taskId)?.status !== "running") {
    throw new Error(`Task attempt ${attempt.id} cannot enter running state.`);
  }
  await saveState(cwd, nextState);
  return { state: nextState, attempt: await markTaskAttemptDispatching(cwd, lockId, attempt.id) };
}

// Check durable identities before accounting or storing returned worker evidence.
export async function checkTaskExecutionResult(cwd: string, attempt: TaskAttemptRecord, resultTaskId: string) {
  const state = await loadState(cwd);
  const task = state.tasks.find((candidate) => candidate.id === attempt.taskId);
  const current = (await loadTaskAttempts(cwd)).find((candidate) => candidate.id === attempt.id);
  const diagnostics: string[] = [];
  if (resultTaskId !== attempt.taskId || state.runId !== attempt.runId || !task
    || task.attemptId !== attempt.id || !["running", "validating"].includes(task.status)) {
    diagnostics.push(`Rejected stale task result: run, task or attempt changed during execution of ${attempt.taskId}.`);
  }
  if (!current || current.status !== "dispatching"
    || JSON.stringify(taskAttemptBinding(current)) !== JSON.stringify(taskAttemptBinding(attempt))) {
    diagnostics.push(`Rejected stale task result: admitted identity ${attempt.id} is no longer dispatching.`);
  }
  if (task && fingerprintTaskContract(task) !== attempt.taskFingerprint) {
    diagnostics.push("Rejected stale task result: task contract changed during execution.");
  }
  if (fingerprintValidationPolicy(await getValidationManifestForTask(cwd, attempt.taskId)) !== attempt.validationPolicyFingerprint) {
    diagnostics.push("Rejected stale task result: validation policy changed during execution.");
  }
  return { state, task, diagnostics };
}

// Block state before closing the ledger. If either publication fails, the open
// attempt remains discoverable on restart. Never block a replacement attempt.
export async function interruptTaskExecution(cwd: string, lockId: string, attemptId: string, diagnostics: string[]) {
  const attempts = await loadTaskAttempts(cwd);
  const attempt = attempts.find((candidate) => candidate.id === attemptId);
  if (!attempt) throw new Error(`Missing task attempt ${attemptId} during interruption.`);
  await assertAttemptWriter(cwd, lockId, attempt.taskId);
  let state = await loadState(cwd);
  if (!["admitted", "dispatching"].includes(attempt.status)) return state;
  const task = state.tasks.find((candidate) => candidate.id === attempt.taskId);
  const previousAttempt = attempts.find((candidate) => candidate.id === task?.attemptId);
  const beforeDispatch = attempt.status === "admitted" && task
    && ["pending", "ready", "debugging"].includes(task.status)
    && (!task.attemptId || (previousAttempt && !["admitted", "dispatching"].includes(previousAttempt.status)));
  if (state.runId === attempt.runId && task
    && (task.attemptId === attempt.id || beforeDispatch)
    && ["pending", "ready", "running", "validating", "debugging"].includes(task.status)) {
    state = transitionTask(state, task.id, "blocked", { reason: diagnostics.join(" ") });
    await saveState(cwd, state);
  }
  const dispatched = attempt.status === "dispatching";
  await completeTaskAttempt(cwd, lockId, attempt.id, {
    status: dispatched ? "interrupted" : "failed",
    outcome: dispatched ? "unknown" : "not_started",
    diagnostics,
  });
  return state;
}

export async function reconcileInterruptedTaskAttempt(cwd: string, state: ScalerState) {
  const candidate = (await loadTaskAttempts(cwd)).find((attempt) => ["admitted", "dispatching"].includes(attempt.status));
  if (!candidate) return undefined;
  const lock = await acquireExecutionLock(cwd, {
    operation: "task_attempt_recovery",
    taskId: candidate.taskId,
    reason: `Reconcile interrupted attempt ${candidate.id}.`,
  });
  if (!lock.acquired) return { accepted: false, message: lock.message, state };
  try {
    // Another owner may have completed this attempt between discovery and lock.
    const current = (await loadTaskAttempts(cwd)).find((attempt) => attempt.id === candidate.id);
    if (!current || !["admitted", "dispatching"].includes(current.status)) {
      return { accepted: false, message: "Task attempt changed before recovery; reload state before retrying.", state: await loadState(cwd) };
    }
    const message = current.status === "dispatching"
      ? `Recovered interrupted task attempt ${current.id}; dispatch outcome is unknown and automatic replay is blocked.`
      : `Recovered unlaunched task attempt ${current.id}; automatic replay is blocked pending operator review.`;
    const durableState = await interruptTaskExecution(cwd, lock.lock.id, current.id, [message]);
    await appendLogEvent(cwd, createLogEvent(durableState, {
      eventType: "rejected_transition", summary: message, taskId: current.taskId,
      details: { attempt: taskAttemptBinding(current), previousStatus: current.status },
    }));
    return { accepted: false, message, state: durableState };
  } finally {
    await releaseExecutionLock(cwd, lock.lock.id);
  }
}

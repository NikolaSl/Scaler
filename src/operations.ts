/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import { incrementBudgetUsage, persistBudgetDecision } from "./budgets.js";
import { verifyTaskDependenciesAccepted } from "./accepted-evidence.js";
import { commitValidatedTask, skipTaskCommit, type GitCommitTaskResult } from "./git.js";
import { acquireExecutionLock, releaseExecutionLock } from "./locks.js";
import { appendLogEvent, createLogEvent } from "./logging.js";
import { saveState } from "./state.js";
import { transitionTask } from "./supervisor.js";
import type { ScalerState } from "./types.js";
import { runTaskValidation, type ValidationRunRecord } from "./validation.js";

export interface LockedOperationResult<T> {
  accepted: boolean;
  message: string;
  result?: T;
}

export async function runValidationWithExecutionLock(
  cwd: string,
  state: ScalerState,
  taskId: string,
): Promise<LockedOperationResult<ValidationRunRecord>> {
  const lock = await acquireExecutionLock(cwd, { operation: "validate", taskId, reason: "Task validation requested." });
  if (!lock.acquired) return { accepted: false, message: lock.message };

  try {
    const task = state.tasks.find((candidate) => candidate.id === taskId);
    if (task) {
      const dependencyDiagnostics = await verifyTaskDependenciesAccepted(cwd, state, task);
      if (dependencyDiagnostics.length > 0) {
        const message = `Validation refused: ${dependencyDiagnostics.join(" ")}`;
        await appendLogEvent(cwd, createLogEvent(state, { eventType: "validation", taskId, summary: message }));
        return { accepted: false, message };
      }
    }
    const budgetResult = incrementBudgetUsage(state, "validationLoops");
    const budgetedState = await persistBudgetDecision(cwd, budgetResult.state, budgetResult.decision);
    if (budgetResult.decision.status === "hard_limit") {
      return { accepted: false, message: `Validation refused by budget: ${budgetResult.decision.reason}` };
    }

    const run = await runTaskValidation(cwd, budgetedState, taskId);
    const policyFailures = run.policyDiagnostics?.filter((diagnostic) => diagnostic.severity === "failure").length ?? 0;
    const policyWarnings = run.policyDiagnostics?.filter((diagnostic) => diagnostic.severity === "warning").length ?? 0;
    const policySummary = policyFailures || policyWarnings ? ` policyFailures=${policyFailures} policyWarnings=${policyWarnings}` : "";
    const acceptanceSummary = run.acceptance && !run.acceptance.accepted ? ` acceptance=${run.acceptance.message}` : "";
    return { accepted: run.acceptance?.accepted ?? true, message: `Validation ${run.status}: ${taskId} commands=${run.commandRuns.length}${policySummary}${acceptanceSummary}`, result: run };
  } finally {
    await releaseExecutionLock(cwd, lock.lock.id);
  }
}

export async function commitWithExecutionLock(
  cwd: string,
  state: ScalerState,
  taskId: string,
  allowedPaths: string[],
): Promise<LockedOperationResult<GitCommitTaskResult>> {
  const lock = await acquireExecutionLock(cwd, { operation: "commit", taskId, reason: "Task commit requested." });
  if (!lock.acquired) return { accepted: false, message: lock.message };

  try {
    const result = await commitValidatedTask(cwd, state, taskId, allowedPaths);
    if (result.accepted && state.tasks.find((task) => task.id === taskId)?.status === "validating") {
      const nextState = transitionTask(state, taskId, "validated", { reason: result.commitHash ? `Git commit ${result.commitHash} recorded after validation.` : result.message });
      await saveState(cwd, nextState);
    }
    return { accepted: result.accepted, message: result.message, result };
  } finally {
    await releaseExecutionLock(cwd, lock.lock.id);
  }
}

export async function skipCommitWithExecutionLock(
  cwd: string,
  state: ScalerState,
  taskId: string,
  reason: string,
): Promise<LockedOperationResult<GitCommitTaskResult>> {
  const lock = await acquireExecutionLock(cwd, { operation: "commit_skip", taskId, reason: "Task commit skip requested." });
  if (!lock.acquired) return { accepted: false, message: lock.message };

  try {
    const result = await skipTaskCommit(cwd, state, taskId, reason);
    if (result.accepted && state.tasks.find((task) => task.id === taskId)?.status === "validating") {
      const nextState = transitionTask(state, taskId, "validated", { reason: result.message });
      await saveState(cwd, nextState);
    }
    return { accepted: result.accepted, message: result.message, result };
  } finally {
    await releaseExecutionLock(cwd, lock.lock.id);
  }
}

import { commitValidatedTask, type GitCommitTaskResult } from "./git.js";
import { acquireExecutionLock, releaseExecutionLock } from "./locks.js";
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
    const run = await runTaskValidation(cwd, state, taskId);
    return { accepted: true, message: `Validation ${run.status}: ${taskId} commands=${run.commandRuns.length}`, result: run };
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
    return { accepted: result.accepted, message: result.message, result };
  } finally {
    await releaseExecutionLock(cwd, lock.lock.id);
  }
}

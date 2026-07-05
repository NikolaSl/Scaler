/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import { runDebugConductorLoop, type DebugConductorLoopOptions, type DebugConductorLoopResult, type DebugConductorRunners } from "./debug-conductor.js";
import { appendLogEvent, createLogEvent } from "./logging.js";
import { runValidationWithExecutionLock, type LockedOperationResult } from "./operations.js";
import { loadState } from "./state.js";
import type { ValidationRunRecord } from "./validation.js";
import type { ScalerState, ScalerTaskState } from "./types.js";

export interface ValidationDebugLoopOptions extends DebugConductorLoopOptions {}

export interface ValidationDebugLoopResult {
  accepted: boolean;
  message: string;
  state: ScalerState;
  taskId: string;
  validation: LockedOperationResult<ValidationRunRecord>;
  debugLoop?: DebugConductorLoopResult;
}

export type ValidationDebugLoopValidator = (
  cwd: string,
  state: ScalerState,
  taskId: string,
) => Promise<LockedOperationResult<ValidationRunRecord>>;

export async function runValidationDebugLoopWorkflow(
  cwd: string,
  state: ScalerState,
  taskId: string,
  options: ValidationDebugLoopOptions = {},
  runners: DebugConductorRunners = {},
  validator: ValidationDebugLoopValidator = runValidationWithExecutionLock,
): Promise<ValidationDebugLoopResult> {
  const validation = await validator(cwd, state, taskId);
  const afterValidationState = await loadState(cwd);

  if (!validation.accepted || !validation.result) {
    const message = `Validation debug loop stopped: ${validation.message}`;
    await appendLogEvent(cwd, createLogEvent(afterValidationState, { eventType: "validation", summary: message, taskId }));
    return { accepted: false, message, state: afterValidationState, taskId, validation };
  }

  if (validation.result.status !== "failed") {
    const message = `Validation debug loop not needed: validation ${validation.result.status} for ${taskId}.`;
    await appendLogEvent(cwd, createLogEvent(afterValidationState, { eventType: "validation", summary: message, taskId }));
    return { accepted: true, message, state: afterValidationState, taskId, validation };
  }

  const task = afterValidationState.tasks.find((candidate) => candidate.id === taskId);
  if (task?.status !== "debugging") {
    const message = `Validation debug loop stopped: task ${taskId} is ${task?.status ?? "missing"}, not debugging.`;
    await appendLogEvent(cwd, createLogEvent(afterValidationState, { eventType: "validation", summary: message, taskId }));
    return { accepted: false, message, state: afterValidationState, taskId, validation };
  }

  const debugLoop = await runDebugConductorLoop(cwd, afterValidationState, {
    ...options,
    taskId,
  }, runners);
  const finalState = debugLoop.finalState;
  const message = `Validation debug loop: validation=${validation.result.status} debug_stop=${debugLoop.stopReason} steps=${debugLoop.steps.length}`;
  await appendLogEvent(cwd, createLogEvent(finalState, {
    eventType: "validation",
    summary: message,
    taskId,
    details: { validationRunId: validation.result.id, debugStopReason: debugLoop.stopReason, debugStepCount: debugLoop.steps.length },
  }));
  return { accepted: debugLoop.accepted, message, state: finalState, taskId, validation, debugLoop };
}

export function selectTaskForValidationDebugLoop(state: ScalerState, requestedTaskId?: string): string | undefined {
  if (requestedTaskId) return requestedTaskId;
  if (state.currentTaskId && isValidationCandidate(state.tasks.find((task) => task.id === state.currentTaskId))) return state.currentTaskId;
  return state.tasks.find(isValidationCandidate)?.id;
}

function isValidationCandidate(task: ScalerTaskState | undefined): task is ScalerTaskState {
  return task?.status === "validating" || task?.status === "debugging";
}

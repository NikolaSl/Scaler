import { appendLogEvent, createLogEvent } from "./logging.js";
import { saveState } from "./state.js";
import { transitionTask } from "./supervisor.js";
import type { ScalerState, ScalerTaskStatus } from "./types.js";

export type ValidationStatus = "passed" | "failed" | "partial" | "blocked" | "not_applicable";

export interface ValidationReportInput {
  taskId: string;
  status: ValidationStatus | string;
  summary: string;
  details?: unknown;
}

export interface ValidationApplyResult {
  state: ScalerState;
  accepted: boolean;
  message: string;
  targetStatus?: ScalerTaskStatus;
}

const validationStatuses = new Set<ValidationStatus>(["passed", "failed", "partial", "blocked", "not_applicable"]);

export function isValidationStatus(value: unknown): value is ValidationStatus {
  return typeof value === "string" && validationStatuses.has(value as ValidationStatus);
}

export async function applyValidationReport(
  cwd: string,
  state: ScalerState,
  report: ValidationReportInput,
): Promise<ValidationApplyResult> {
  if (!isValidationStatus(report.status)) {
    return logAndReturn(cwd, state, report, false, `Validation rejected: invalid status ${String(report.status)}`);
  }

  const task = state.tasks.find((candidate) => candidate.id === report.taskId);
  if (!task) {
    return logAndReturn(cwd, state, report, false, `Validation rejected: task ${report.taskId} does not exist`);
  }

  const targetStatus = getTargetTaskStatus(task.status, report.status);
  if (!targetStatus) {
    return logAndReturn(
      cwd,
      state,
      report,
      false,
      `Validation ${report.status} cannot be applied from task status ${task.status}`,
    );
  }

  const beforeRejected = state.rejectedTransitions.length;
  const nextState = transitionTask(state, report.taskId, targetStatus, { reason: report.summary });
  const accepted = nextState.rejectedTransitions.length === beforeRejected;
  await saveState(cwd, nextState);
  await appendLogEvent(
    cwd,
    createLogEvent(nextState, {
      eventType: "validation",
      summary: `${accepted ? "Validation applied" : "Validation rejected"}: ${report.taskId} ${report.status}`,
      taskId: report.taskId,
      details: { report, targetStatus },
    }),
  );

  return {
    state: nextState,
    accepted,
    message: accepted ? `Validation applied: ${report.taskId} -> ${targetStatus}` : `Validation transition rejected: ${report.taskId}`,
    targetStatus,
  };
}

function getTargetTaskStatus(current: ScalerTaskStatus, validation: ValidationStatus): ScalerTaskStatus | undefined {
  if (validation === "passed" || validation === "not_applicable") {
    if (current === "validating" || current === "debugging") return "validated";
    return undefined;
  }

  if (validation === "failed" || validation === "partial") {
    if (current === "validating") return "debugging";
    return undefined;
  }

  if (validation === "blocked") {
    if (current === "running" || current === "validating") return "blocked";
    return undefined;
  }

  return undefined;
}

async function logAndReturn(
  cwd: string,
  state: ScalerState,
  report: ValidationReportInput,
  accepted: boolean,
  message: string,
): Promise<ValidationApplyResult> {
  await appendLogEvent(
    cwd,
    createLogEvent(state, {
      eventType: "validation",
      summary: message,
      taskId: report.taskId,
      details: report,
    }),
  );
  return { state, accepted, message };
}

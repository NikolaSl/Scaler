import { appendLogEvent, createLogEvent } from "./logging.js";
import { saveState } from "./state.js";
import { transitionStage, transitionTask } from "./supervisor.js";
import type { ScalerStage, ScalerState, ScalerTaskStatus } from "./types.js";

export interface ScalerReportInput {
  reportType: string;
  summary: string;
  taskId?: string;
  details?: unknown;
  stageTransition?: ScalerStage | string;
  taskTransition?: ScalerTaskStatus | string;
  reason?: string;
}

export interface IngestReportResult {
  state: ScalerState;
  accepted: boolean;
  message: string;
  rejectionReason?: string;
}

const scalerStages = new Set<ScalerStage>([
  "idle",
  "prd",
  "knowledge",
  "planning",
  "execution",
  "debugging",
  "replanning",
  "paused",
  "completed",
  "failed",
]);

const scalerTaskStatuses = new Set<ScalerTaskStatus>([
  "pending",
  "ready",
  "running",
  "validating",
  "debugging",
  "validated",
  "blocked",
  "needs_replan",
  "failed",
]);

export function isScalerStage(value: unknown): value is ScalerStage {
  return typeof value === "string" && scalerStages.has(value as ScalerStage);
}

export function isScalerTaskStatus(value: unknown): value is ScalerTaskStatus {
  return typeof value === "string" && scalerTaskStatuses.has(value as ScalerTaskStatus);
}

export function validateReportInput(report: ScalerReportInput): string | undefined {
  if (!report.reportType.trim()) return "Report type is required.";
  if (!report.summary.trim()) return "Report summary is required.";
  if (report.stageTransition !== undefined && !isScalerStage(report.stageTransition)) {
    return `Invalid stage transition target: ${String(report.stageTransition)}.`;
  }
  if (report.taskTransition !== undefined && !isScalerTaskStatus(report.taskTransition)) {
    return `Invalid task transition target: ${String(report.taskTransition)}.`;
  }
  if (report.taskTransition !== undefined && !report.taskId) {
    return "Task transition report did not include taskId.";
  }
  return undefined;
}

export async function ingestReport(cwd: string, state: ScalerState, report: ScalerReportInput): Promise<IngestReportResult> {
  const validationError = validateReportInput(report);
  if (validationError) {
    await appendLogEvent(
      cwd,
      createLogEvent(state, {
        eventType: "state",
        summary: `Report rejected: ${report.reportType || "unknown"} - ${validationError}`,
        taskId: report.taskId,
        details: report,
      }),
    );
    return {
      state,
      accepted: false,
      message: `Report rejected: ${validationError}`,
      rejectionReason: validationError,
    };
  }

  let nextState = state;
  const rejectionCountBefore = state.rejectedTransitions.length;
  const reason = report.reason ?? report.summary;

  if (isScalerStage(report.stageTransition)) {
    nextState = transitionStage(nextState, report.stageTransition, { reason });
  }

  if (isScalerTaskStatus(report.taskTransition)) {
    nextState = transitionTask(nextState, report.taskId!, report.taskTransition, { reason });
  }

  await saveState(cwd, nextState);
  await appendLogEvent(
    cwd,
    createLogEvent(nextState, {
      eventType: "state",
      summary: `Report ingested: ${report.reportType} - ${report.summary}`,
      taskId: report.taskId,
      details: report,
    }),
  );

  const accepted = nextState.rejectedTransitions.length === rejectionCountBefore;
  return {
    state: nextState,
    accepted,
    message: accepted ? "Report accepted." : "Report recorded with rejected transition.",
    rejectionReason: accepted ? undefined : nextState.rejectedTransitions.at(-1)?.reason,
  };
}

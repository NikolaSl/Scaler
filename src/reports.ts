import { appendLogEvent, createLogEvent } from "./logging.js";
import { saveState } from "./state.js";
import { transitionStage, transitionTask } from "./supervisor.js";
import type { ScalerStage, ScalerState, ScalerTaskStatus } from "./types.js";

export interface ScalerReportInput {
  reportType: string;
  summary: string;
  taskId?: string;
  details?: unknown;
  stageTransition?: ScalerStage;
  taskTransition?: ScalerTaskStatus;
  reason?: string;
}

export interface IngestReportResult {
  state: ScalerState;
  accepted: boolean;
  message: string;
}

export async function ingestReport(cwd: string, state: ScalerState, report: ScalerReportInput): Promise<IngestReportResult> {
  let nextState = state;
  const rejectionCountBefore = state.rejectedTransitions.length;
  const reason = report.reason ?? report.summary;

  if (report.stageTransition) {
    nextState = transitionStage(nextState, report.stageTransition, { reason });
  }

  if (report.taskTransition) {
    if (!report.taskId) {
      nextState = {
        ...nextState,
        rejectedTransitions: [
          ...nextState.rejectedTransitions,
          {
            kind: "task",
            from: "missing",
            to: report.taskTransition,
            reason: "Task transition report did not include taskId.",
            timestamp: new Date().toISOString(),
          },
        ],
      };
    } else {
      nextState = transitionTask(nextState, report.taskId, report.taskTransition, { reason });
    }
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
  };
}

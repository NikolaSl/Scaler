export type ScalerStage =
  | "idle"
  | "prd"
  | "knowledge"
  | "planning"
  | "execution"
  | "debugging"
  | "replanning"
  | "paused"
  | "completed"
  | "failed";

export type ScalerTaskStatus =
  | "pending"
  | "ready"
  | "running"
  | "validating"
  | "debugging"
  | "validated"
  | "blocked"
  | "needs_replan"
  | "failed";

export interface ScalerTaskState {
  id: string;
  status: ScalerTaskStatus;
  title?: string;
  allowedPathPrefixes?: string[];
  updatedAt: string;
}

export interface RejectedTransition {
  kind: "stage" | "task";
  from: string;
  to: string;
  reason: string;
  timestamp: string;
}

export interface ScalerState {
  version: 1;
  runId: string;
  complexityLevel: number;
  stage: ScalerStage;
  previousStage: ScalerStage | null;
  currentTaskId: string | null;
  tasks: ScalerTaskState[];
  completedTaskIds: string[];
  validatedTaskIds: string[];
  failedTaskId: string | null;
  blockers: string[];
  memoryRefs: string[];
  rejectedTransitions: RejectedTransition[];
  budgets: Record<string, unknown>;
  orchestrationReason?: string;
  createdAt: string;
  updatedAt: string;
}

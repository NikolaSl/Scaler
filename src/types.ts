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

export type ScalerTaskKind = "software" | "non_software" | "mixed";

export interface ScalerTaskQualityWaiver {
  code: string;
  reason: string;
  evidenceRefs?: string[];
  approvedBy?: string;
}

export interface ScalerTaskState {
  id: string;
  status: ScalerTaskStatus;
  title?: string;
  taskKind?: ScalerTaskKind;
  atomicityRationale?: string;
  allowedPathPrefixes?: string[];
  dependsOn?: string[];
  prdRefs?: string[];
  definitionOfDone?: string[];
  validationRefs?: string[];
  qualityWaivers?: ScalerTaskQualityWaiver[];
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

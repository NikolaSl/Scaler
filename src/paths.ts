import { join } from "node:path";

export const SCALER_DIR = ".scaler";

export function getScalerDir(cwd: string): string {
  return join(cwd, SCALER_DIR);
}

export function getStatePath(cwd: string): string {
  return join(getScalerDir(cwd), "state.json");
}

export function getLogsDir(cwd: string): string {
  return join(getScalerDir(cwd), "logs");
}

export function getEventLogPath(cwd: string): string {
  return join(getLogsDir(cwd), "events.jsonl");
}

export function getMemoryDir(cwd: string): string {
  return join(getScalerDir(cwd), "memory");
}

export function getMemoryIndexPath(cwd: string): string {
  return join(getMemoryDir(cwd), "index.json");
}

export function getDebugDir(cwd: string): string {
  return join(getScalerDir(cwd), "debug");
}

export function getDebugFailuresPath(cwd: string): string {
  return join(getDebugDir(cwd), "failures.json");
}

export function getDebugAttemptsPath(cwd: string): string {
  return join(getDebugDir(cwd), "attempts.json");
}

export function getCheckpointsDir(cwd: string): string {
  return join(getScalerDir(cwd), "checkpoints");
}

export function getContextDir(cwd: string): string {
  return join(getScalerDir(cwd), "context");
}

export function getTaskContextDir(cwd: string): string {
  return join(getContextDir(cwd), "tasks");
}

export function getTaskContextManifestPath(cwd: string, taskId: string): string {
  return join(getTaskContextDir(cwd), `${taskId}.json`);
}

export function getToolRequestsDir(cwd: string): string {
  return join(getScalerDir(cwd), "tool-requests");
}

export function getToolRequestsIndexPath(cwd: string): string {
  return join(getToolRequestsDir(cwd), "requests.json");
}

export function getReportsDir(cwd: string): string {
  return join(getScalerDir(cwd), "reports");
}

export function getLocksDir(cwd: string): string {
  return join(getScalerDir(cwd), "locks");
}

export function getExecutionLockPath(cwd: string): string {
  return join(getLocksDir(cwd), "execution-lock.json");
}

export function getValidationHandoffsPath(cwd: string): string {
  return join(getReportsDir(cwd), "validation-handoffs.json");
}

export function getTaskAgentRunsPath(cwd: string): string {
  return join(getReportsDir(cwd), "task-agent-runs.json");
}

export function getStageAgentRunsPath(cwd: string): string {
  return join(getReportsDir(cwd), "stage-agent-runs.json");
}

export function getValidationManifestsPath(cwd: string): string {
  return join(getReportsDir(cwd), "validation-manifests.json");
}

export function getValidationRunsPath(cwd: string): string {
  return join(getReportsDir(cwd), "validation-runs.json");
}

export function getPrdDir(cwd: string): string {
  return join(getScalerDir(cwd), "prd");
}

export function getCurrentPrdPath(cwd: string): string {
  return join(getPrdDir(cwd), "current.md");
}

export function getPrdRequirementsPath(cwd: string): string {
  return join(getPrdDir(cwd), "requirements.json");
}

export function getPrdCoveragePath(cwd: string): string {
  return join(getPrdDir(cwd), "coverage.json");
}

export function getPrdChangesPath(cwd: string): string {
  return join(getPrdDir(cwd), "changes.jsonl");
}

export function getPrdVersionsDir(cwd: string): string {
  return join(getPrdDir(cwd), "versions");
}

export function getExecutionPlansDir(cwd: string): string {
  return join(getScalerDir(cwd), "plans");
}

export function getCurrentExecutionPlanPath(cwd: string): string {
  return join(getExecutionPlansDir(cwd), "current-plan.json");
}

export function getProposedExecutionPlanPath(cwd: string): string {
  return join(getExecutionPlansDir(cwd), "proposed-plan.json");
}

export function getExecutionPlanVersionsDir(cwd: string): string {
  return join(getExecutionPlansDir(cwd), "versions");
}

export function getReplanRequestsPath(cwd: string): string {
  return join(getExecutionPlansDir(cwd), "replan-requests.json");
}

export function getReplanDecisionsPath(cwd: string): string {
  return join(getExecutionPlansDir(cwd), "replan-decisions.json");
}

export function getStagesDir(cwd: string): string {
  return join(getScalerDir(cwd), "stages");
}

export function getStageArtifactsPath(cwd: string): string {
  return join(getStagesDir(cwd), "stage-artifacts.json");
}

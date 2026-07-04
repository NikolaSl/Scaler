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

export function getLogDetailsDir(cwd: string): string {
  return join(getLogsDir(cwd), "details");
}

export function getStorageDir(cwd: string): string {
  return join(getScalerDir(cwd), "storage");
}

export function getStorageIndexPath(cwd: string): string {
  return join(getStorageDir(cwd), "index.json");
}

export function getStorageMaintenancePath(cwd: string): string {
  return join(getStorageDir(cwd), "maintenance.json");
}

export function getStorageSchedulePath(cwd: string): string {
  return join(getStorageDir(cwd), "schedule.json");
}

export function getSafetyDir(cwd: string): string {
  return join(getScalerDir(cwd), "safety");
}

export function getSafetyPolicyPath(cwd: string): string {
  return join(getSafetyDir(cwd), "policy.json");
}

export function getSafetyApprovalsPath(cwd: string): string {
  return join(getSafetyDir(cwd), "approvals.json");
}

export function getSafetyScansPath(cwd: string): string {
  return join(getSafetyDir(cwd), "scans.json");
}

export function getMemoryDir(cwd: string): string {
  return join(getScalerDir(cwd), "memory");
}

export function getMemoryIndexPath(cwd: string): string {
  return join(getMemoryDir(cwd), "index.json");
}

export function getResearchDir(cwd: string): string {
  return join(getScalerDir(cwd), "research");
}

export function getResearchRequestsPath(cwd: string): string {
  return join(getResearchDir(cwd), "requests.json");
}

export function getResearchReportsPath(cwd: string): string {
  return join(getResearchDir(cwd), "reports.json");
}

export function getResearchTransactionsPath(cwd: string): string {
  return join(getResearchDir(cwd), "transactions.json");
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

export function getDebugReportsPath(cwd: string): string {
  return join(getDebugDir(cwd), "reports.json");
}

export function getDebugRetriesPath(cwd: string): string {
  return join(getDebugDir(cwd), "retries.json");
}

export function getDebugRetryPolicyPath(cwd: string): string {
  return join(getDebugDir(cwd), "retry-policy.json");
}

export function getDebugRetryApprovalsPath(cwd: string): string {
  return join(getDebugDir(cwd), "retry-approvals.json");
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

export function getToolResultsPath(cwd: string): string {
  return join(getToolRequestsDir(cwd), "results.json");
}

export function getToolTransactionsPath(cwd: string): string {
  return join(getToolRequestsDir(cwd), "transactions.json");
}

export function getToolCatalogPath(cwd: string): string {
  return join(getToolRequestsDir(cwd), "catalog.json");
}

export function getToolSchemaDiscoveryRunsPath(cwd: string): string {
  return join(getToolRequestsDir(cwd), "schema-runs.json");
}

export function getToolIterationPolicyPath(cwd: string): string {
  return join(getToolRequestsDir(cwd), "iteration-policy.json");
}

export function getToolIterationRunsPath(cwd: string): string {
  return join(getToolRequestsDir(cwd), "iteration-runs.json");
}

export function getToolReplayApprovalsPath(cwd: string): string {
  return join(getToolRequestsDir(cwd), "replay-approvals.json");
}

export function getMcpServersPath(cwd: string): string {
  return join(getToolRequestsDir(cwd), "mcp-servers.json");
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

export function getReplanAgentRunsPath(cwd: string): string {
  return join(getReportsDir(cwd), "replan-agent-runs.json");
}

export function getResearchAgentRunsPath(cwd: string): string {
  return join(getReportsDir(cwd), "research-agent-runs.json");
}

export function getDebugAgentRunsPath(cwd: string): string {
  return join(getReportsDir(cwd), "debug-agent-runs.json");
}

export function getValidationManifestsPath(cwd: string): string {
  return join(getReportsDir(cwd), "validation-manifests.json");
}

export function getValidationRunsPath(cwd: string): string {
  return join(getReportsDir(cwd), "validation-runs.json");
}

export function getValidationChecklistsPath(cwd: string): string {
  return join(getReportsDir(cwd), "validation-checklists.json");
}

export function getValidationEnvironmentsPath(cwd: string): string {
  return join(getReportsDir(cwd), "validation-environments.json");
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

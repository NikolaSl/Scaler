import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { appendLogEvent, createLogEvent } from "./logging.js";
import { getTaskQualityPath } from "./paths.js";
import type { ScalerState, ScalerTaskState } from "./types.js";
import { loadValidationManifests } from "./validation.js";

export type TaskDefinitionWarningCode = "missing_dod" | "missing_validation" | "missing_allowed_paths" | "missing_task";

export interface TaskDefinitionWarning {
  code: TaskDefinitionWarningCode;
  severity: "warning";
  message: string;
  hint: string;
}

export interface TaskDefinitionReviewRecord {
  id: string;
  taskId: string;
  status: "ok" | "warnings" | "missing_task";
  warnings: TaskDefinitionWarning[];
  createdAt: string;
}

export interface TaskDefinitionReviewIndex {
  version: 1;
  reviews: TaskDefinitionReviewRecord[];
}

export async function loadTaskDefinitionReviews(cwd: string): Promise<TaskDefinitionReviewRecord[]> {
  try {
    const raw = await readFile(getTaskQualityPath(cwd), "utf8");
    return (JSON.parse(raw) as TaskDefinitionReviewIndex).reviews;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function reviewTaskDefinition(
  cwd: string,
  state: ScalerState,
  taskId: string,
  now = new Date(),
): Promise<TaskDefinitionReviewRecord> {
  const task = state.tasks.find((candidate) => candidate.id === taskId);
  const warnings = task ? await buildTaskDefinitionWarnings(cwd, task) : [{
    code: "missing_task" as const,
    severity: "warning" as const,
    message: `Task ${taskId} does not exist; cannot review atomic definition.`,
    hint: "Create the task before reviewing Definition of Done, validation, and allowed paths.",
  }];
  const record: TaskDefinitionReviewRecord = {
    id: `${taskId}-quality-${now.getTime()}`,
    taskId,
    status: task ? (warnings.length > 0 ? "warnings" : "ok") : "missing_task",
    warnings,
    createdAt: now.toISOString(),
  };
  await writeTaskDefinitionReviews(cwd, [record, ...(await loadTaskDefinitionReviews(cwd))]);
  await appendLogEvent(cwd, createLogEvent(state, {
    eventType: "state",
    summary: record.status === "ok" ? `Task definition review passed: ${taskId}` : `Task definition review warnings: ${taskId}`,
    taskId,
    details: record,
  }));
  return record;
}

export async function reviewAllTaskDefinitions(cwd: string, state: ScalerState, now = new Date()): Promise<TaskDefinitionReviewRecord[]> {
  const records: TaskDefinitionReviewRecord[] = [];
  for (const task of state.tasks) {
    records.push(await reviewTaskDefinition(cwd, state, task.id, now));
  }
  return records;
}

export async function buildTaskDefinitionWarnings(cwd: string, task: ScalerTaskState): Promise<TaskDefinitionWarning[]> {
  const warnings: TaskDefinitionWarning[] = [];
  if (!task.definitionOfDone || task.definitionOfDone.length === 0) {
    warnings.push({
      code: "missing_dod",
      severity: "warning",
      message: `Task ${task.id} has no Definition of Done items.`,
      hint: "Add concrete DoD items to /scaler-task-create or /scaler-task-update as the final pipe field, e.g. `tests pass; docs updated`.",
    });
  }
  if (!task.allowedPathPrefixes || task.allowedPathPrefixes.length === 0) {
    warnings.push({
      code: "missing_allowed_paths",
      severity: "warning",
      message: `Task ${task.id} has no allowed path scope.`,
      hint: "Set allowed path prefixes so task agents and commit checks have an explicit scope.",
    });
  }
  const manifests = await loadValidationManifests(cwd);
  const manifest = manifests.find((candidate) => candidate.taskId === task.id);
  if (!manifest || manifest.commands.length === 0) {
    warnings.push({
      code: "missing_validation",
      severity: "warning",
      message: `Task ${task.id} has no task-specific validation commands.`,
      hint: "Add /scaler-validation-add commands or a validation checklist that maps directly to the task Definition of Done.",
    });
  }
  return warnings;
}

export function formatTaskDefinitionReviews(records: TaskDefinitionReviewRecord[], taskId?: string, limit = 20): string {
  const filtered = taskId ? records.filter((record) => record.taskId === taskId) : records;
  if (filtered.length === 0) return taskId ? `No task definition reviews for ${taskId}.` : "No task definition reviews.";
  const lines = [taskId ? `Task definition reviews for ${taskId}:` : "Task definition reviews:"];
  for (const record of filtered.slice(0, limit)) {
    lines.push(`- ${record.taskId}: ${record.status} warnings=${record.warnings.length} id=${record.id}`);
    for (const warning of record.warnings) lines.push(`  - ${warning.code}: ${warning.message} Hint: ${warning.hint}`);
  }
  return lines.join("\n");
}

async function writeTaskDefinitionReviews(cwd: string, reviews: TaskDefinitionReviewRecord[]): Promise<void> {
  const path = getTaskQualityPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ version: 1, reviews } satisfies TaskDefinitionReviewIndex, null, 2)}\n`, "utf8");
}

/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { appendLogEvent, createLogEvent } from "./logging.js";
import { getTaskQualityPath } from "./paths.js";
import type { ScalerState, ScalerTaskKind, ScalerTaskQualityWaiver, ScalerTaskState } from "./types.js";
import { loadValidationManifests, normalizeValidationGateKind, type EmbeddedValidationManifestCommandInput, type ValidationCommandManifest } from "./validation.js";

export type TaskDefinitionWarningCode =
  | "missing_dod"
  | "missing_validation"
  | "missing_allowed_paths"
  | "missing_task"
  | "missing_atomicity"
  | "missing_test_first"
  | "unvalidated_dependency";

export type TaskQualityEnforcementMode = "warn" | "enforce";

export interface TaskDefinitionWarning {
  code: TaskDefinitionWarningCode;
  severity: "warning" | "error";
  message: string;
  hint: string;
}

export interface TaskQualityWaiverInput {
  code: TaskDefinitionWarningCode | string;
  reason: string;
  evidenceRefs?: string[];
  approvedBy?: string;
}

export interface TaskDefinitionReviewRecord {
  id: string;
  taskId: string;
  status: "ok" | "warnings" | "blocked" | "missing_task";
  enforcement: TaskQualityEnforcementMode;
  warnings: TaskDefinitionWarning[];
  waivedWarnings?: TaskDefinitionWarning[];
  waivers?: ScalerTaskQualityWaiver[];
  createdAt: string;
}

export interface TaskDefinitionReviewIndex {
  version: 1;
  reviews: TaskDefinitionReviewRecord[];
}

export interface TaskDefinitionQualityOptions {
  enforcement?: TaskQualityEnforcementMode;
  supplementalValidationCommands?: ValidationCommandManifest[] | EmbeddedValidationManifestCommandInput[];
  supplementalValidationRefs?: string[];
}

const taskKinds = new Set<ScalerTaskKind>(["software", "non_software", "mixed"]);

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
  options: TaskDefinitionQualityOptions = {},
): Promise<TaskDefinitionReviewRecord> {
  const enforcement = options.enforcement ?? "warn";
  const task = state.tasks.find((candidate) => candidate.id === taskId);
  const assessment = task
    ? await assessTaskDefinitionQuality(cwd, state, task, options)
    : {
        warnings: [{
          code: "missing_task" as const,
          severity: enforcement === "enforce" ? "error" as const : "warning" as const,
          message: `Task ${taskId} does not exist; cannot review atomic definition.`,
          hint: "Create the task before reviewing Definition of Done, validation, allowed paths, atomicity, and test-first coverage.",
        }],
        waivedWarnings: [] as TaskDefinitionWarning[],
        waivers: [] as ScalerTaskQualityWaiver[],
      };
  const record: TaskDefinitionReviewRecord = {
    id: `${taskId}-quality-${now.getTime()}`,
    taskId,
    status: task ? getReviewStatus(enforcement, assessment.warnings) : "missing_task",
    enforcement,
    warnings: assessment.warnings,
    waivedWarnings: assessment.waivedWarnings.length > 0 ? assessment.waivedWarnings : undefined,
    waivers: assessment.waivers.length > 0 ? assessment.waivers : undefined,
    createdAt: now.toISOString(),
  };
  await writeTaskDefinitionReviews(cwd, [record, ...(await loadTaskDefinitionReviews(cwd))]);
  await appendLogEvent(cwd, createLogEvent(state, {
    eventType: "state",
    summary: record.status === "ok" ? `Task definition review passed: ${taskId}` : `Task definition review ${record.status}: ${taskId}`,
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

export async function assessTaskDefinitionQuality(
  cwd: string,
  state: ScalerState,
  task: ScalerTaskState,
  options: TaskDefinitionQualityOptions = {},
): Promise<{ warnings: TaskDefinitionWarning[]; waivedWarnings: TaskDefinitionWarning[]; waivers: ScalerTaskQualityWaiver[] }> {
  const enforcement = options.enforcement ?? "warn";
  const waivers = normalizeTaskQualityWaivers(task.qualityWaivers) ?? [];
  const allWarnings = await buildTaskDefinitionWarnings(cwd, task, state, options);
  const waivedWarnings = allWarnings.filter((warning) => isTaskQualityWaived(warning.code, waivers));
  const warnings = allWarnings.filter((warning) => !isTaskQualityWaived(warning.code, waivers)).map((warning) => ({
    ...warning,
    severity: enforcement === "enforce" ? "error" as const : "warning" as const,
  }));
  return { warnings, waivedWarnings, waivers };
}

export async function buildTaskDefinitionWarnings(
  cwd: string,
  task: ScalerTaskState,
  stateOrOptions: ScalerState | TaskDefinitionQualityOptions = {},
  maybeOptions: TaskDefinitionQualityOptions = {},
): Promise<TaskDefinitionWarning[]> {
  const state = isScalerStateLike(stateOrOptions) ? stateOrOptions : undefined;
  const options = isScalerStateLike(stateOrOptions) ? maybeOptions : stateOrOptions;
  const severity = (options.enforcement ?? "warn") === "enforce" ? "error" as const : "warning" as const;
  const warnings: TaskDefinitionWarning[] = [];
  if (!task.definitionOfDone || task.definitionOfDone.length === 0) {
    warnings.push({
      code: "missing_dod",
      severity,
      message: `Task ${task.id} has no Definition of Done items.`,
      hint: "Add concrete DoD items to /scaler-task-create or /scaler-task-update, e.g. `tests pass; docs updated`, or add an explicit missing_dod waiver with a reason.",
    });
  }
  if (!task.allowedPathPrefixes || task.allowedPathPrefixes.length === 0) {
    warnings.push({
      code: "missing_allowed_paths",
      severity,
      message: `Task ${task.id} has no allowed path scope.`,
      hint: "Set allowed path prefixes so task agents and commit checks have an explicit scope, or add an explicit missing_allowed_paths waiver with a reason.",
    });
  }
  if (!task.atomicityRationale || task.atomicityRationale.trim().length < 12) {
    warnings.push({
      code: "missing_atomicity",
      severity,
      message: `Task ${task.id} has no atomicity rationale.`,
      hint: "Record why this is the smallest independently completable/testable task, or add an explicit missing_atomicity waiver with a reason.",
    });
  }

  const validationCommands = await collectValidationCommands(cwd, task, options.supplementalValidationCommands);
  const validationRefs = uniqueStrings([...(task.validationRefs ?? []), ...(options.supplementalValidationRefs ?? [])]);
  if (validationCommands.length === 0 && validationRefs.length === 0) {
    warnings.push({
      code: "missing_validation",
      severity,
      message: `Task ${task.id} has no task-specific validation commands or checks.`,
      hint: "Add validation commands/check references through the task or /scaler-validation-add, or add an explicit missing_validation waiver with a reason.",
    });
  }

  if (isSoftwareTaskKind(task.taskKind) && !hasTestFirstCoverage(validationCommands, validationRefs)) {
    warnings.push({
      code: "missing_test_first",
      severity,
      message: `Task ${task.id} has no test-first/update-tests-before-implementation validation gate.`,
      hint: "Add a validation command/check with gate=test_first before implementation gates, mark the task non_software, or add an explicit missing_test_first waiver with the alternative validation path.",
    });
  }

  if (state && task.dependsOn && task.dependsOn.length > 0 && ["ready", "running", "validating", "debugging"].includes(task.status)) {
    const validated = new Set(state.validatedTaskIds);
    const missing = task.dependsOn.filter((dependencyId) => !validated.has(dependencyId));
    if (missing.length > 0) {
      warnings.push({
        code: "unvalidated_dependency",
        severity,
        message: `Task ${task.id} is ${task.status} but depends on unvalidated task(s): ${missing.join(", ")}.`,
        hint: "Keep dependent tasks pending until dependencies validate, split/reorder the plan, or add an explicit unvalidated_dependency waiver with evidence.",
      });
    }
  }

  return warnings;
}

export function normalizeTaskKind(value: unknown): ScalerTaskKind | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!normalized) return undefined;
  if (normalized === "nonsoftware" || normalized === "non_software" || normalized === "non-code" || normalized === "docs") return "non_software";
  if (normalized === "code" || normalized === "software") return "software";
  if (normalized === "mixed" || normalized === "hybrid") return "mixed";
  return taskKinds.has(normalized as ScalerTaskKind) ? normalized as ScalerTaskKind : undefined;
}

export function normalizeTaskQualityWaivers(waivers: Array<TaskQualityWaiverInput | ScalerTaskQualityWaiver> | undefined): ScalerTaskQualityWaiver[] | undefined {
  const normalized = (waivers ?? [])
    .map((waiver) => ({
      code: String(waiver.code ?? "").trim(),
      reason: String(waiver.reason ?? "").trim(),
      evidenceRefs: uniqueStrings(waiver.evidenceRefs),
      approvedBy: typeof waiver.approvedBy === "string" && waiver.approvedBy.trim() ? waiver.approvedBy.trim() : undefined,
    }))
    .filter((waiver) => waiver.code.length > 0 && waiver.reason.length > 0);
  return normalized.length > 0 ? normalized : undefined;
}

export function parseTaskQualityWaivers(value: string | undefined): ScalerTaskQualityWaiver[] | undefined {
  if (!value?.trim()) return undefined;
  const waivers = value
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [codePart, ...reasonParts] = part.split(":");
      return { code: codePart?.trim() ?? "", reason: reasonParts.join(":").trim() } satisfies ScalerTaskQualityWaiver;
    });
  return normalizeTaskQualityWaivers(waivers);
}

export function formatTaskDefinitionReviews(records: TaskDefinitionReviewRecord[], taskId?: string, limit = 20): string {
  const filtered = taskId ? records.filter((record) => record.taskId === taskId) : records;
  if (filtered.length === 0) return taskId ? `No task definition reviews for ${taskId}.` : "No task definition reviews.";
  const lines = [taskId ? `Task definition reviews for ${taskId}:` : "Task definition reviews:"];
  for (const record of filtered.slice(0, limit)) {
    lines.push(`- ${record.taskId}: ${record.status} enforcement=${record.enforcement} warnings=${record.warnings.length} waived=${record.waivedWarnings?.length ?? 0} id=${record.id}`);
    for (const warning of record.warnings) lines.push(`  - ${warning.severity} ${warning.code}: ${warning.message} Hint: ${warning.hint}`);
    for (const warning of record.waivedWarnings ?? []) {
      const waiver = record.waivers?.find((candidate) => candidate.code === warning.code);
      lines.push(`  - waived ${warning.code}: ${waiver?.reason ?? warning.message}`);
    }
  }
  return lines.join("\n");
}

async function collectValidationCommands(
  cwd: string,
  task: ScalerTaskState,
  supplementalCommands: ValidationCommandManifest[] | EmbeddedValidationManifestCommandInput[] | undefined,
): Promise<ValidationCommandManifest[]> {
  const manifests = await loadValidationManifests(cwd);
  const manifest = manifests.find((candidate) => candidate.taskId === task.id);
  const existing = manifest?.commands ?? [];
  const supplemental = (supplementalCommands ?? []).map((command, index) => ({
    id: command.id || `supplemental-${index + 1}`,
    command: command.command,
    description: command.description,
    timeoutMs: command.timeoutMs,
    required: command.required ?? true,
    gate: normalizeValidationGateKind(command.gate),
    expectedResult: command.expectedResult,
    evidenceRefs: command.evidenceRefs,
    environment: command.environment,
    disposition: command.disposition,
    dispositionReason: command.dispositionReason,
  }));
  return [...supplemental, ...existing];
}

function hasTestFirstCoverage(commands: ValidationCommandManifest[], validationRefs: string[]): boolean {
  if (commands.some((command) => normalizeValidationGateKind(command.gate) === "test_first")) return true;
  return validationRefs.some((ref) => /test[-_ ]?first|tests?[-_ ]?updated|tdd/i.test(ref));
}

function isSoftwareTaskKind(kind: ScalerTaskKind | undefined): boolean {
  return kind !== "non_software";
}

function getReviewStatus(enforcement: TaskQualityEnforcementMode, warnings: TaskDefinitionWarning[]): TaskDefinitionReviewRecord["status"] {
  if (warnings.length === 0) return "ok";
  return enforcement === "enforce" ? "blocked" : "warnings";
}

function isTaskQualityWaived(code: TaskDefinitionWarningCode, waivers: ScalerTaskQualityWaiver[] | undefined): boolean {
  return Boolean(waivers?.some((waiver) => waiver.code === code || waiver.code === "all"));
}

function uniqueStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(new Set(values.filter((value): value is string => typeof value === "string" && value.trim().length > 0).map((value) => value.trim())));
}

function isScalerStateLike(value: unknown): value is ScalerState {
  return Boolean(value && typeof value === "object" && Array.isArray((value as ScalerState).tasks));
}

async function writeTaskDefinitionReviews(cwd: string, reviews: TaskDefinitionReviewRecord[]): Promise<void> {
  const path = getTaskQualityPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ version: 1, reviews } satisfies TaskDefinitionReviewIndex, null, 2)}\n`, "utf8");
}

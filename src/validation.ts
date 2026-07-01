import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { appendLogEvent, createLogEvent } from "./logging.js";
import { getValidationManifestsPath } from "./paths.js";
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

export interface ValidationCommandManifest {
  id: string;
  command: string;
  description?: string;
  timeoutMs?: number;
  required: boolean;
}

export interface TaskValidationManifest {
  taskId: string;
  commands: ValidationCommandManifest[];
  createdAt: string;
  updatedAt: string;
}

interface ValidationManifestIndex {
  version: 1;
  manifests: TaskValidationManifest[];
}

const validationStatuses = new Set<ValidationStatus>(["passed", "failed", "partial", "blocked", "not_applicable"]);

export function isValidationStatus(value: unknown): value is ValidationStatus {
  return typeof value === "string" && validationStatuses.has(value as ValidationStatus);
}

export async function loadValidationManifests(cwd: string): Promise<TaskValidationManifest[]> {
  try {
    const raw = await readFile(getValidationManifestsPath(cwd), "utf8");
    return (JSON.parse(raw) as ValidationManifestIndex).manifests;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function saveValidationManifest(cwd: string, manifest: TaskValidationManifest): Promise<TaskValidationManifest> {
  const manifests = await loadValidationManifests(cwd);
  const timestamp = new Date().toISOString();
  const normalized: TaskValidationManifest = {
    ...manifest,
    createdAt: manifest.createdAt || timestamp,
    updatedAt: timestamp,
    commands: manifest.commands.map((command, index) => ({
      ...command,
      id: command.id || `cmd-${index + 1}`,
      required: command.required,
    })),
  };
  const next = [normalized, ...manifests.filter((candidate) => candidate.taskId !== manifest.taskId)];
  await writeValidationManifestIndex(cwd, next);
  return normalized;
}

export async function getValidationManifestForTask(cwd: string, taskId: string): Promise<TaskValidationManifest> {
  const manifests = await loadValidationManifests(cwd);
  return manifests.find((manifest) => manifest.taskId === taskId) ?? (await createDefaultValidationManifest(cwd, taskId));
}

export async function createDefaultValidationManifest(cwd: string, taskId: string): Promise<TaskValidationManifest> {
  const commands: ValidationCommandManifest[] = [];
  const packageJsonPath = join(cwd, "package.json");
  try {
    const pkg = JSON.parse(await readFile(packageJsonPath, "utf8")) as { scripts?: Record<string, string> };
    if (pkg.scripts?.test) {
      commands.push({ id: "npm-test", command: "npm test", description: "Run package test script.", required: true });
    }
    if (pkg.scripts?.build) {
      commands.push({ id: "npm-build", command: "npm run build", description: "Run package build script.", required: true });
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const timestamp = new Date().toISOString();
  return { taskId, commands, createdAt: timestamp, updatedAt: timestamp };
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

async function writeValidationManifestIndex(cwd: string, manifests: TaskValidationManifest[]): Promise<void> {
  const path = getValidationManifestsPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ version: 1, manifests } satisfies ValidationManifestIndex, null, 2)}\n`, "utf8");
}

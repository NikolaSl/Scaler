import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { appendLogEvent, createLogEvent } from "./logging.js";
import { getValidationManifestsPath, getValidationRunsPath } from "./paths.js";
import { requestReplan } from "./replanning.js";
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

export interface ValidationManifestCommandInput {
  taskId: string;
  id: string;
  command: string;
  description?: string;
  timeoutMs?: number;
  required?: boolean;
}

interface ValidationManifestIndex {
  version: 1;
  manifests: TaskValidationManifest[];
}

export type ValidationCommandStatus = "passed" | "failed" | "timed_out";

export interface ValidationCommandRunRecord {
  id: string;
  commandId: string;
  command: string;
  status: ValidationCommandStatus;
  exitCode: number | null;
  stdoutSummary: string;
  stderrSummary: string;
  startedAt: string;
  finishedAt: string;
}

export interface ValidationRunRecord {
  id: string;
  taskId: string;
  status: "passed" | "failed";
  commandRuns: ValidationCommandRunRecord[];
  createdAt: string;
}

interface ValidationRunIndex {
  version: 1;
  runs: ValidationRunRecord[];
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

export async function upsertValidationManifestCommand(
  cwd: string,
  input: ValidationManifestCommandInput,
): Promise<TaskValidationManifest> {
  const existing = (await loadValidationManifests(cwd)).find((manifest) => manifest.taskId === input.taskId);
  const base = existing ?? (await createDefaultValidationManifest(cwd, input.taskId));
  const command: ValidationCommandManifest = {
    id: input.id,
    command: input.command,
    description: input.description,
    timeoutMs: input.timeoutMs,
    required: input.required ?? true,
  };
  return await saveValidationManifest(cwd, {
    ...base,
    commands: [command, ...base.commands.filter((candidate) => candidate.id !== input.id)],
  });
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

export async function loadValidationRuns(cwd: string): Promise<ValidationRunRecord[]> {
  try {
    const raw = await readFile(getValidationRunsPath(cwd), "utf8");
    return (JSON.parse(raw) as ValidationRunIndex).runs;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function runTaskValidation(cwd: string, state: ScalerState, taskId: string): Promise<ValidationRunRecord> {
  const manifest = await getValidationManifestForTask(cwd, taskId);
  const commandRuns: ValidationCommandRunRecord[] = [];
  for (const command of manifest.commands) {
    commandRuns.push(await runValidationCommand(cwd, command));
  }

  const failedRequired = commandRuns.some((run, index) => manifest.commands[index]?.required && run.status !== "passed");
  const record: ValidationRunRecord = {
    id: `${taskId}-${Date.now()}`,
    taskId,
    status: failedRequired ? "failed" : "passed",
    commandRuns,
    createdAt: new Date().toISOString(),
  };
  await writeValidationRuns(cwd, [record, ...(await loadValidationRuns(cwd))]);
  await applyValidationReport(cwd, state, {
    taskId,
    status: record.status === "passed" ? "passed" : "failed",
    summary: `Validation ${record.status}: ${taskId}`,
    details: { runId: record.id, commandRuns },
  });
  return record;
}

export async function runValidationCommand(cwd: string, command: ValidationCommandManifest): Promise<ValidationCommandRunRecord> {
  const startedAt = new Date();
  const result = await executeCommand(cwd, command.command, command.timeoutMs);
  const finishedAt = new Date();
  const status: ValidationCommandStatus = result.timedOut ? "timed_out" : result.exitCode === 0 ? "passed" : "failed";
  return {
    id: `${command.id}-${startedAt.getTime()}`,
    commandId: command.id,
    command: command.command,
    status,
    exitCode: result.exitCode,
    stdoutSummary: summarizeOutput(result.stdout),
    stderrSummary: summarizeOutput(result.stderr),
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
  };
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
  let finalState = nextState;
  await saveState(cwd, nextState);
  let replanRequestId: string | undefined;
  if (accepted && report.status === "blocked") {
    const replan = await requestReplan(cwd, nextState, {
      trigger: "validation_blocked",
      reason: report.summary,
      taskId: report.taskId,
      evidenceRefs: extractEvidenceRefs(report.details),
      requirementRefs: task.prdRefs,
    });
    finalState = replan.state;
    replanRequestId = replan.request.id;
  }
  await appendLogEvent(
    cwd,
    createLogEvent(finalState, {
      eventType: "validation",
      summary: `${accepted ? "Validation applied" : "Validation rejected"}: ${report.taskId} ${report.status}`,
      taskId: report.taskId,
      details: { report, targetStatus, replanRequestId },
    }),
  );

  return {
    state: finalState,
    accepted,
    message: accepted ? `Validation applied: ${report.taskId} -> ${targetStatus}` : `Validation transition rejected: ${report.taskId}`,
    targetStatus,
  };
}

function extractEvidenceRefs(details: unknown): string[] | undefined {
  if (!details || typeof details !== "object") return undefined;
  const refs = (details as { evidenceRefs?: unknown; runId?: unknown }).evidenceRefs;
  if (Array.isArray(refs)) return refs.filter((ref): ref is string => typeof ref === "string");
  const runId = (details as { runId?: unknown }).runId;
  return typeof runId === "string" ? [runId] : undefined;
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

async function writeValidationRuns(cwd: string, runs: ValidationRunRecord[]): Promise<void> {
  const path = getValidationRunsPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ version: 1, runs } satisfies ValidationRunIndex, null, 2)}\n`, "utf8");
}

async function executeCommand(
  cwd: string,
  command: string,
  timeoutMs?: number,
): Promise<{ exitCode: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, { cwd, shell: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let timeout: NodeJS.Timeout | undefined;

    const settle = (exitCode: number | null): void => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      resolve({ exitCode, stdout, stderr, timedOut });
    };

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => settle(code));

    if (timeoutMs && timeoutMs > 0) {
      timeout = setTimeout(() => {
        timedOut = true;
        stderr += `\nValidation command timed out after ${timeoutMs}ms.`;
        child.kill("SIGTERM");
        setTimeout(() => {
          if (!child.killed) child.kill("SIGKILL");
        }, 1_000).unref();
      }, timeoutMs);
    }
  });
}

function summarizeOutput(output: string, limit = 2_000): string {
  const normalized = output.trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit)}\n...[truncated ${normalized.length - limit} chars]`;
}

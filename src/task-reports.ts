import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { appendLogEvent, createLogEvent } from "./logging.js";
import { getTaskAgentReportsPath } from "./paths.js";
import { extractStructuredReportPayloads, type TaskAgentRunResult } from "./subagents.js";
import type { ScalerState } from "./types.js";

export type TaskAgentReportStatus = "completed" | "needs_data" | "blocked" | "failed" | "needs_replan";
export type TaskAgentReportIngestionStatus = "accepted" | "missing" | "invalid";

export interface TaskAgentValidationSummary {
  id?: string;
  command?: string;
  status?: string;
  summary?: string;
  evidenceRefs?: string[];
}

export interface TaskAgentReportRecord {
  id: string;
  type: "scaler_task_report";
  taskId: string;
  status: TaskAgentReportStatus;
  summary: string;
  outputs?: unknown;
  artifacts?: string[];
  changedFiles: string[];
  memoryRefs: string[];
  validations: TaskAgentValidationSummary[];
  validationRefs: string[];
  evidenceRefs: string[];
  blockers: string[];
  missingData: string[];
  recommendedNextAction?: string;
  runId?: string;
  source: "child-agent" | "tool";
  createdAt: string;
}

export interface TaskAgentReportIndex {
  version: 1;
  reports: TaskAgentReportRecord[];
}

export interface TaskAgentReportInput {
  taskId?: string;
  status?: string;
  summary?: string;
  outputs?: unknown;
  artifacts?: string[];
  changedFiles?: string[];
  memoryRefs?: string[];
  validations?: TaskAgentValidationSummary[];
  validationRefs?: string[];
  evidenceRefs?: string[];
  blockers?: string[];
  missingData?: string[];
  recommendedNextAction?: string;
  runId?: string;
  source?: "child-agent" | "tool";
}

export interface TaskAgentReportIngestionResult {
  status: TaskAgentReportIngestionStatus;
  accepted: boolean;
  report?: TaskAgentReportRecord;
  diagnostics: string[];
}

const taskReportStatuses = new Set<TaskAgentReportStatus>(["completed", "needs_data", "blocked", "failed", "needs_replan"]);

export async function loadTaskAgentReports(cwd: string): Promise<TaskAgentReportRecord[]> {
  try {
    const raw = await readFile(getTaskAgentReportsPath(cwd), "utf8");
    return (JSON.parse(raw) as TaskAgentReportIndex).reports;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function recordTaskAgentReport(
  cwd: string,
  input: TaskAgentReportInput,
  now = new Date(),
): Promise<TaskAgentReportRecord> {
  const normalized = normalizeTaskAgentReportInput(input);
  if (!normalized.ok) throw new Error(normalized.diagnostics.join(" "));

  const record: TaskAgentReportRecord = {
    id: `${normalized.input.taskId}-report-${now.getTime()}`,
    type: "scaler_task_report",
    taskId: normalized.input.taskId,
    status: normalized.input.status,
    summary: normalized.input.summary,
    outputs: normalized.input.outputs,
    artifacts: normalized.input.artifacts,
    changedFiles: normalized.input.changedFiles ?? [],
    memoryRefs: normalized.input.memoryRefs ?? [],
    validations: normalized.input.validations ?? [],
    validationRefs: normalized.input.validationRefs ?? [],
    evidenceRefs: normalized.input.evidenceRefs ?? [],
    blockers: normalized.input.blockers ?? [],
    missingData: normalized.input.missingData ?? [],
    recommendedNextAction: normalized.input.recommendedNextAction,
    runId: normalized.input.runId,
    source: normalized.input.source ?? "child-agent",
    createdAt: now.toISOString(),
  };
  await writeTaskAgentReports(cwd, [record, ...(await loadTaskAgentReports(cwd))]);
  return record;
}

export async function ingestTaskAgentReportFromRun(
  cwd: string,
  state: ScalerState,
  taskId: string,
  runResult: TaskAgentRunResult,
  runId?: string,
  now = new Date(),
): Promise<TaskAgentReportIngestionResult> {
  const payloads = extractStructuredReportPayloads(runResult.stdoutEvents, "scaler_task_report");
  if (payloads.length === 0) {
    const result: TaskAgentReportIngestionResult = {
      status: "missing",
      accepted: false,
      diagnostics: ["Missing required scaler_task_report from successful task-agent run."],
    };
    await logTaskReportIngestion(cwd, state, taskId, result);
    return result;
  }

  const diagnostics: string[] = [];
  for (const payload of payloads) {
    const input = taskAgentReportInputFromPayload(payload, runId);
    const normalized = normalizeTaskAgentReportInput(input, taskId);
    if (!normalized.ok) {
      diagnostics.push(...normalized.diagnostics);
      continue;
    }
    const report = await recordTaskAgentReport(cwd, normalized.input, now);
    const result: TaskAgentReportIngestionResult = { status: "accepted", accepted: true, report, diagnostics };
    await logTaskReportIngestion(cwd, state, taskId, result);
    return result;
  }

  const result: TaskAgentReportIngestionResult = {
    status: "invalid",
    accepted: false,
    diagnostics: diagnostics.length > 0 ? diagnostics : ["No valid scaler_task_report matched the executed task."],
  };
  await logTaskReportIngestion(cwd, state, taskId, result);
  return result;
}

export function formatTaskAgentReportList(records: TaskAgentReportRecord[], taskId?: string, limit = 10): string {
  const filtered = taskId ? records.filter((record) => record.taskId === taskId) : records;
  if (filtered.length === 0) return taskId ? `No task-agent reports for ${taskId}.` : "No task-agent reports.";
  const lines = [taskId ? `Task-agent reports for ${taskId}:` : "Task-agent reports:"];
  for (const record of filtered.slice(0, limit)) {
    const changes = record.changedFiles.length > 0 ? ` changed=${record.changedFiles.join(",")}` : "";
    const blockers = record.blockers.length > 0 ? ` blockers=${record.blockers.join(",")}` : "";
    lines.push(`- ${record.taskId}: ${record.status} ${record.id} summary=${record.summary}${changes}${blockers}`);
  }
  return lines.join("\n");
}

function taskAgentReportInputFromPayload(payload: Record<string, unknown>, runId: string | undefined): TaskAgentReportInput {
  return {
    taskId: stringField(payload.taskId),
    status: stringField(payload.status),
    summary: stringField(payload.summary),
    outputs: payload.outputs,
    artifacts: stringArrayField(payload.artifacts),
    changedFiles: stringArrayField(payload.changedFiles),
    memoryRefs: stringArrayField(payload.memoryRefs),
    validations: validationArrayField(payload.validations),
    validationRefs: stringArrayField(payload.validationRefs),
    evidenceRefs: stringArrayField(payload.evidenceRefs),
    blockers: stringArrayField(payload.blockers),
    missingData: stringArrayField(payload.missingData),
    recommendedNextAction: stringField(payload.recommendedNextAction),
    runId,
    source: "child-agent",
  };
}

function normalizeTaskAgentReportInput(
  input: TaskAgentReportInput,
  expectedTaskId?: string,
): { ok: true; input: TaskAgentReportInput & { taskId: string; status: TaskAgentReportStatus; summary: string } } | { ok: false; diagnostics: string[] } {
  const diagnostics: string[] = [];
  const taskId = input.taskId?.trim();
  const status = input.status?.trim() as TaskAgentReportStatus;
  const summary = input.summary?.trim();

  if (!taskId) diagnostics.push("Task report requires taskId.");
  if (expectedTaskId && taskId && taskId !== expectedTaskId) diagnostics.push(`Task report taskId ${taskId} does not match expected task ${expectedTaskId}.`);
  if (!taskReportStatuses.has(status)) diagnostics.push(`Task report status must be one of ${Array.from(taskReportStatuses).join(", ")}.`);
  if (!summary) diagnostics.push("Task report requires summary.");

  if (diagnostics.length > 0) return { ok: false, diagnostics };
  return {
    ok: true,
    input: {
      ...input,
      taskId: taskId!,
      status,
      summary: summary!,
      artifacts: input.artifacts ?? [],
      changedFiles: input.changedFiles ?? [],
      memoryRefs: input.memoryRefs ?? [],
      validations: input.validations ?? [],
      validationRefs: input.validationRefs ?? [],
      evidenceRefs: input.evidenceRefs ?? [],
      blockers: input.blockers ?? [],
      missingData: input.missingData ?? [],
    },
  };
}

async function logTaskReportIngestion(
  cwd: string,
  state: ScalerState,
  taskId: string,
  result: TaskAgentReportIngestionResult,
): Promise<void> {
  const summary = result.accepted
    ? `Task-agent report ingested: ${result.report?.id ?? taskId}`
    : `Task-agent report ${result.status}: ${taskId}`;
  await appendLogEvent(
    cwd,
    createLogEvent(state, {
      eventType: "agent",
      summary,
      taskId,
      details: result,
    }),
  );
}

async function writeTaskAgentReports(cwd: string, reports: TaskAgentReportRecord[]): Promise<void> {
  const path = getTaskAgentReportsPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ version: 1, reports } satisfies TaskAgentReportIndex, null, 2)}\n`, "utf8");
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function stringArrayField(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
}

function validationArrayField(value: unknown): TaskAgentValidationSummary[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .map((item) => ({
      id: stringField(item.id),
      command: stringField(item.command),
      status: stringField(item.status),
      summary: stringField(item.summary),
      evidenceRefs: stringArrayField(item.evidenceRefs),
    }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

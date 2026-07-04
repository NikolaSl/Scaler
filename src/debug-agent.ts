import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { acquireExecutionLock, releaseExecutionLock } from "./locks.js";
import { logAgentPromptAudit, logStructuredReportAudit } from "./logging.js";
import {
  findDebugFingerprintCycles,
  formatDebugReportSummary,
  loadDebugAttempts,
  loadDebugFailures,
  loadDebugReports,
  recordDebugReport,
  type DebugAttemptRecord,
  type DebugFailureRecord,
  type DebugReportApplyResult,
  type DebugReportInput,
  type DebugReportRecord,
} from "./debug.js";
import { getDebugAgentRunsPath } from "./paths.js";
import { loadReplanRequests } from "./plans.js";
import { recordProviderUsageBudget, type ProviderUsage } from "./provider-usage.js";
import { formatResearchSummary, loadResearchReports, loadResearchRequests } from "./research.js";
import { buildTaskAgentInvocation, extractStructuredReportPayloads, runTaskAgent, type TaskAgentInvocation, type TaskAgentRequest, type TaskAgentRunResult } from "./subagents.js";
import { formatStateStatus } from "./state.js";
import type { ScalerState, ScalerTaskState } from "./types.js";

export interface DebugAgentPromptInput {
  state: ScalerState;
  task: ScalerTaskState;
  failures: DebugFailureRecord[];
  attempts: DebugAttemptRecord[];
  reports: DebugReportRecord[];
  researchSummary: string;
  replanRequests: unknown[];
  extraInstructions?: string;
}

export interface DebugAgentInvocationOptions {
  tools?: string[];
  model?: string;
  appendSystemPromptPath?: string;
  extensionPaths?: string[];
  command?: string;
}

export interface RunDebugAgentOptions extends DebugAgentInvocationOptions {
  taskId?: string;
  execute?: boolean;
  timeoutMs?: number;
  extraInstructions?: string;
}

export interface DebugAgentPreparation {
  prompt: string;
  request: TaskAgentRequest;
  invocation: TaskAgentInvocation;
  task: ScalerTaskState;
}

export interface DebugReportExtractionResult {
  ok: boolean;
  input?: DebugReportInput;
  reason?: string;
}

export interface DebugReportIngestionResult {
  attempted: boolean;
  ingested: boolean;
  report?: DebugReportApplyResult["report"];
  researchRequestIds?: string[];
  replanRequestId?: string;
  reason?: string;
}

export interface DebugAgentRunRecord {
  id: string;
  taskId?: string;
  status: "prepared" | "passed" | "failed";
  exitCode?: number;
  stdoutEventCount?: number;
  stderrSummary?: string;
  timedOut?: boolean;
  aborted?: boolean;
  ingestionStatus?: "not_attempted" | "ingested" | "rejected";
  reportId?: string;
  createdAt: string;
  usage?: ProviderUsage;
}

export interface DebugAgentRunIndex {
  version: 1;
  runs: DebugAgentRunRecord[];
}

export interface DebugAgentStepResult {
  accepted: boolean;
  message: string;
  prompt?: string;
  invocation?: TaskAgentInvocation;
  runResult?: TaskAgentRunResult;
  runRecord?: DebugAgentRunRecord;
  ingestion?: DebugReportIngestionResult;
  task?: ScalerTaskState;
}

export type DebugAgentRunner = typeof runTaskAgent;

export function buildDebugAgentPrompt(input: DebugAgentPromptInput): string {
  const cycles = findDebugFingerprintCycles(input.attempts, input.task.id);
  const relatedFailures = input.failures.filter((failure) => failure.taskId === input.task.id);
  const relatedAttempts = input.attempts.filter((attempt) => attempt.taskId === input.task.id);
  const relatedReports = input.reports.filter((report) => report.taskId === input.task.id);

  const lines = [
    "You are a focused SCALER debug agent.",
    "Your job is to diagnose exactly one failing task and avoid token-wasting debug loops.",
    "Do not implement broad changes. Investigate and choose the next best evidence-backed step, request research, or request replanning.",
    "Use local evidence first. If local evidence is insufficient, request research instead of guessing. Internet/deep research must be requested when needed and allowed; do not pretend unavailable tools were used.",
    "If previous fixes form a cycle, do not propose another fix in the same cycle. Identify a shared root cause or a materially different approach that addresses the full cycle.",
    "Only recommend replanning when no realistic debug or research-backed approach remains, the task/plan is wrong, or a POC/plan change is required.",
    "Active context must stay compact; raw logs and large evidence should remain referenced by id/path.",
    "SCALER ingests structured JSON events only. Do not rely on free-form prose for state changes.",
    "",
    `Supervisor: ${formatStateStatus(input.state)}`,
    "",
    "Selected task:",
    JSON.stringify({
      id: input.task.id,
      status: input.task.status,
      title: input.task.title,
      prdRefs: input.task.prdRefs,
      allowedPathPrefixes: input.task.allowedPathPrefixes,
      dependsOn: input.task.dependsOn,
    }, null, 2),
    "",
    "Failure records:",
    JSON.stringify(relatedFailures, null, 2),
    "",
    "Attempt stack:",
    JSON.stringify(relatedAttempts, null, 2),
    "",
    "Detected fingerprint cycles:",
    cycles.length > 0 ? JSON.stringify(cycles, null, 2) : "[]",
    "",
    "Prior debug reports:",
    relatedReports.length > 0 ? formatDebugReportSummary(relatedReports) : "No prior debug reports for this task.",
    "",
    "Research ledger summary:",
    input.researchSummary,
    "",
    "Related replan requests:",
    JSON.stringify(input.replanRequests, null, 2),
    "",
    "Decision rules:",
    "- Emit status `next_approach` only when a realistic, untried, evidence-backed approach exists. Include nextApproach and evidenceRefs.",
    "- Emit status `needs_research` when more local/internet evidence is needed. Include researchQuestions and researchScope (`local`, `mixed`, or `internet`).",
    "- Emit status `needs_replan` only after debug plus available research cannot produce a realistic approach, or the plan/task definition is wrong. Include exhaustedReason or replanReason.",
    "- Emit status `blocked` only for an immediate non-plan blocker that still requires supervisor escalation. Include exhaustedReason or replanReason.",
    "",
    "Required final response:",
    "- Emit exactly one JSON event with type `scaler_debug_report`.",
    "- Include taskId, status, summary, optional failureId/failureFingerprint/cycleSummary, attemptedApproaches, investigationSummary, rootCause, nextApproach, evidenceRefs, researchQuestions, researchScope, replanReason, and exhaustedReason as applicable.",
    "- Do not emit arbitrary free-form child text as the only result.",
  ];

  if (input.extraInstructions?.trim()) {
    lines.push("", "Extra instructions:", input.extraInstructions.trim());
  }

  return lines.join("\n");
}

export function prepareDebugAgentInvocation(
  cwd: string,
  input: DebugAgentPromptInput,
  options: DebugAgentInvocationOptions = {},
): DebugAgentPreparation {
  const prompt = buildDebugAgentPrompt(input);
  const request: TaskAgentRequest = {
    taskId: `debug-agent-${input.task.id}`,
    prompt,
    cwd,
    tools: options.tools,
    model: options.model,
    appendSystemPromptPath: options.appendSystemPromptPath,
    extensionPaths: options.extensionPaths,
  };
  const invocation = buildTaskAgentInvocation(request, options.command ?? "pi");
  return { prompt, request, invocation, task: input.task };
}

export async function runDebugAgentStep(
  cwd: string,
  state: ScalerState,
  options: RunDebugAgentOptions = {},
  runner: DebugAgentRunner = runTaskAgent,
): Promise<DebugAgentStepResult> {
  const lock = await acquireExecutionLock(cwd, {
    operation: options.execute ? "debug_agent_execute" : "debug_agent_prepare",
    taskId: options.taskId,
    reason: "Debug agent escalation workflow",
  });
  if (!lock.acquired) return { accepted: false, message: lock.message };

  try {
    const context = await loadDebugAgentContext(cwd, state, options.taskId, options.extraInstructions);
    if (!context) {
      const detail = options.taskId ? `No debug task found for ${options.taskId}.` : "No debug task found.";
      return { accepted: false, message: detail };
    }

    const preparation = prepareDebugAgentInvocation(cwd, context, options);
    await logAgentPromptAudit(cwd, state, {
      agentType: "debug",
      agentId: context.task.id,
      prompt: preparation.prompt,
      taskId: context.task.id,
      inputRefs: [context.task.id, ...context.failures.map((failure) => failure.id), ...context.attempts.map((attempt) => attempt.id)],
      details: { invocation: preparation.invocation },
    });
    const runResult = options.execute ? await runner(preparation.request, { timeoutMs: options.timeoutMs }) : undefined;
    if (runResult?.usage) {
      await recordProviderUsageBudget(cwd, state, runResult.usage, {
        source: "debug-agent-run",
        taskId: context.task.id,
        agentId: context.task.id,
        agentType: "debug",
      });
    }
    const ingestion = runResult?.exitCode === 0 ? await ingestDebugReport(cwd, state, runResult.stdoutEvents) : { attempted: false, ingested: false };
    if (ingestion.attempted) {
      await logStructuredReportAudit(cwd, state, {
        reportType: "scaler_debug_report",
        summary: ingestion.ingested ? `Debug report ingested: ${ingestion.report?.id ?? "unknown"}` : (ingestion.reason ?? "Debug report rejected"),
        report: ingestion.report ?? { reason: ingestion.reason },
        accepted: ingestion.ingested,
        taskId: context.task.id,
        outputRefs: ingestion.report ? [ingestion.report.id] : undefined,
      });
    }
    const runRecord = await recordDebugAgentRun(cwd, context.task.id, runResult, options.execute ? ingestion : undefined, options.execute ? undefined : "prepared");
    return {
      accepted: true,
      message: `${options.execute ? "Executed" : "Prepared"} debug agent for ${context.task.id}`,
      prompt: preparation.prompt,
      invocation: preparation.invocation,
      runResult,
      runRecord,
      ingestion,
      task: context.task,
    };
  } finally {
    await releaseExecutionLock(cwd, lock.lock.id);
  }
}

export async function ingestDebugReport(cwd: string, state: ScalerState, stdoutEvents: unknown[], now = new Date()): Promise<DebugReportIngestionResult> {
  const extraction = extractDebugReport(stdoutEvents);
  if (!extraction.ok || !extraction.input) {
    return { attempted: true, ingested: false, reason: extraction.reason ?? "Debug report extraction failed." };
  }

  const result = await recordDebugReport(cwd, state, extraction.input, now);
  if (!result.accepted) return { attempted: true, ingested: false, reason: result.message };
  return {
    attempted: true,
    ingested: true,
    report: result.report,
    researchRequestIds: result.researchRequestIds,
    replanRequestId: result.replanRequestId,
  };
}

export function extractDebugReport(stdoutEvents: unknown[]): DebugReportExtractionResult {
  const candidates = extractStructuredReportPayloads(stdoutEvents, "scaler_debug_report");
  if (candidates.length === 0) return { ok: false, reason: "No scaler_debug_report report found in debug-agent output." };

  const payload = candidates[candidates.length - 1];
  const error = stringField(payload, "error");
  if (error) return { ok: false, reason: `Debug agent reported no report: ${error}` };

  const reportRecord = isRecord(payload.report) ? payload.report : payload;
  const input: DebugReportInput = {
    id: stringField(reportRecord, "id"),
    taskId: stringField(reportRecord, "taskId") ?? "",
    status: stringField(reportRecord, "status") ?? "blocked",
    summary: stringField(reportRecord, "summary") ?? "Debug report",
    failureId: stringField(reportRecord, "failureId"),
    failureFingerprint: stringField(reportRecord, "failureFingerprint"),
    cycleSummary: stringField(reportRecord, "cycleSummary"),
    attemptedApproaches: stringArrayField(reportRecord, "attemptedApproaches"),
    investigationSummary: stringField(reportRecord, "investigationSummary"),
    rootCause: stringField(reportRecord, "rootCause"),
    nextApproach: stringField(reportRecord, "nextApproach"),
    evidenceRefs: stringArrayField(reportRecord, "evidenceRefs"),
    researchQuestions: stringArrayField(reportRecord, "researchQuestions"),
    researchScope: stringField(reportRecord, "researchScope"),
    replanReason: stringField(reportRecord, "replanReason"),
    exhaustedReason: stringField(reportRecord, "exhaustedReason"),
  };
  return { ok: true, input };
}

export async function loadDebugAgentRunRecords(cwd: string): Promise<DebugAgentRunRecord[]> {
  try {
    const raw = await readFile(getDebugAgentRunsPath(cwd), "utf8");
    const index = JSON.parse(raw) as DebugAgentRunIndex;
    if (index.version !== 1) throw new Error(`Unsupported debug-agent run index version: ${String(index.version)}`);
    return index.runs;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function recordDebugAgentRun(
  cwd: string,
  taskId: string | undefined,
  runResult: TaskAgentRunResult | undefined,
  ingestion?: DebugReportIngestionResult,
  preparedStatus?: "prepared",
  now = new Date(),
): Promise<DebugAgentRunRecord> {
  const timestamp = now.toISOString();
  const record: DebugAgentRunRecord = runResult ? {
    id: `debug-agent-${now.getTime()}`,
    taskId,
    status: runResult.exitCode === 0 ? "passed" : "failed",
    exitCode: runResult.exitCode,
    stdoutEventCount: runResult.stdoutEvents.length,
    stderrSummary: summarizeOutput(runResult.stderr),
    timedOut: runResult.timedOut,
    aborted: runResult.aborted,
    ingestionStatus: ingestion?.attempted ? (ingestion.ingested ? "ingested" : "rejected") : "not_attempted",
    reportId: ingestion?.report?.id,
    createdAt: timestamp,
    usage: runResult.usage,
  } : {
    id: `debug-agent-${now.getTime()}`,
    taskId,
    status: preparedStatus ?? "prepared",
    ingestionStatus: "not_attempted",
    createdAt: timestamp,
  };
  const path = getDebugAgentRunsPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ version: 1, runs: [record, ...(await loadDebugAgentRunRecords(cwd))] }, null, 2)}\n`, "utf8");
  return record;
}

export function formatDebugAgentRunList(records: DebugAgentRunRecord[], taskId?: string, limit = 10): string {
  const filtered = taskId ? records.filter((record) => record.taskId === taskId) : records;
  if (filtered.length === 0) return taskId ? `No debug-agent runs for ${taskId}.` : "No debug-agent runs.";
  const lines = ["Debug-agent runs:"];
  for (const record of filtered.slice(0, limit)) {
    const exit = record.exitCode === undefined ? "n/a" : String(record.exitCode);
    const flags = [record.timedOut && "timed_out", record.aborted && "aborted"].filter(Boolean).join(",") || "none";
    const ingestion = record.ingestionStatus ?? "not_attempted";
    const stderr = record.stderrSummary ? ` stderr=${record.stderrSummary}` : "";
    lines.push(`- ${record.status} task=${record.taskId ?? "n/a"} exit=${exit} flags=${flags} stdout_events=${record.stdoutEventCount ?? 0} ingestion=${ingestion} report=${record.reportId ?? "n/a"}${stderr}`);
  }
  return lines.join("\n");
}

async function loadDebugAgentContext(cwd: string, state: ScalerState, taskId?: string, extraInstructions?: string): Promise<DebugAgentPromptInput | undefined> {
  const task = selectDebugTask(state, taskId);
  if (!task) return undefined;
  const [failures, attempts, reports, researchRequests, researchReports, replanRequests] = await Promise.all([
    loadDebugFailures(cwd),
    loadDebugAttempts(cwd),
    loadDebugReports(cwd),
    loadResearchRequests(cwd),
    loadResearchReports(cwd),
    loadReplanRequests(cwd),
  ]);
  return {
    state,
    task,
    failures,
    attempts,
    reports,
    researchSummary: formatResearchSummary(researchRequests, researchReports),
    replanRequests: replanRequests.filter((request) => request.taskId === task.id),
    extraInstructions,
  };
}

function selectDebugTask(state: ScalerState, taskId?: string): ScalerTaskState | undefined {
  if (taskId) return state.tasks.find((task) => task.id === taskId);
  if (state.currentTaskId) {
    const current = state.tasks.find((task) => task.id === state.currentTaskId);
    if (current && (current.status === "debugging" || current.status === "needs_replan" || current.status === "blocked")) return current;
  }
  return state.tasks.find((task) => task.status === "debugging")
    ?? state.tasks.find((task) => task.status === "needs_replan")
    ?? state.tasks.find((task) => task.status === "blocked");
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function stringArrayField(record: Record<string, unknown>, key: string): string[] | undefined {
  const value = record[key];
  if (!Array.isArray(value)) return undefined;
  const normalized = value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
  return normalized.length > 0 ? Array.from(new Set(normalized)).sort((a, b) => a.localeCompare(b)) : undefined;
}

function summarizeOutput(output: string, maxLength = 500): string {
  const singleLine = output.replace(/\s+/g, " ").trim();
  return singleLine.length > maxLength ? `${singleLine.slice(0, maxLength - 3)}...` : singleLine;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

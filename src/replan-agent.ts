/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { acquireExecutionLock, releaseExecutionLock } from "./locks.js";
import { logAgentPromptAudit, logStructuredReportAudit } from "./logging.js";
import { getReplanAgentRunsPath } from "./paths.js";
import {
  checkExecutionPlanPreservation,
  formatExecutionPlanPreservationCheck,
  formatExecutionPlanSummary,
  loadExecutionPlan,
  loadReplanRequests,
  saveProposedExecutionPlan,
  summarizeExecutionPlan,
  validateExecutionPlan,
  type ExecutionPlanArtifact,
  type ExecutionPlanPreservationCheck,
  type ReplanRequest,
} from "./plans.js";
import { computePrdCoverageSummary, loadPrdCoverage, loadPrdRequirements, type RuntimePrdCoverageSummary, type RuntimePrdRequirementsFile } from "./prd.js";
import { recordProviderUsageBudget, type ProviderUsage } from "./provider-usage.js";
import { buildTaskAgentInvocation, extractStructuredReportPayloads, runTaskAgent, type TaskAgentInvocation, type TaskAgentRequest, type TaskAgentRunResult } from "./subagents.js";
import { formatStateStatus } from "./state.js";
import type { ScalerState } from "./types.js";

export interface ReplanAgentPromptInput {
  state: ScalerState;
  currentPlan: ExecutionPlanArtifact;
  requirements: RuntimePrdRequirementsFile;
  coverageSummary: RuntimePrdCoverageSummary;
  replanRequests: ReplanRequest[];
  extraInstructions?: string;
}

export interface ReplanAgentInvocationOptions {
  tools?: string[];
  model?: string;
  appendSystemPromptPath?: string;
  extensionPaths?: string[];
  command?: string;
}

export interface ReplanAgentPreparation {
  prompt: string;
  request: TaskAgentRequest;
  invocation: TaskAgentInvocation;
}

export interface RunReplanAgentOptions extends ReplanAgentInvocationOptions {
  execute?: boolean;
  timeoutMs?: number;
  extraInstructions?: string;
}

export interface ReplanProposalExtractionResult {
  ok: boolean;
  plan?: ExecutionPlanArtifact;
  reason?: string;
}

export interface ReplanProposalIngestionResult {
  attempted: boolean;
  ingested: boolean;
  plan?: ExecutionPlanArtifact;
  preservation?: ExecutionPlanPreservationCheck;
  reason?: string;
}

export interface ReplanAgentRunRecord {
  id: string;
  status: "prepared" | "passed" | "failed";
  exitCode?: number;
  stdoutEventCount?: number;
  stderrSummary?: string;
  timedOut?: boolean;
  aborted?: boolean;
  ingestionStatus?: "not_attempted" | "ingested" | "rejected";
  proposedPlanVersion?: number;
  createdAt: string;
  usage?: ProviderUsage;
}

export interface ReplanAgentRunIndex {
  version: 1;
  runs: ReplanAgentRunRecord[];
}

export interface ReplanAgentStepResult {
  accepted: boolean;
  message: string;
  prompt?: string;
  invocation?: TaskAgentInvocation;
  runResult?: TaskAgentRunResult;
  runRecord?: ReplanAgentRunRecord;
  ingestion?: ReplanProposalIngestionResult;
}

export type ReplanAgentRunner = typeof runTaskAgent;

export function buildReplanAgentPrompt(input: ReplanAgentPromptInput): string {
  const openRequests = input.replanRequests.filter((request) => request.status === "open");
  const planSummary = summarizeExecutionPlan(input.currentPlan, input.requirements, input.state);
  const stateTasks = input.state.tasks.map((task) => ({
    id: task.id,
    status: task.status,
    title: task.title,
    prdRefs: task.prdRefs,
    allowedPathPrefixes: task.allowedPathPrefixes,
    dependsOn: task.dependsOn,
  }));
  const requirementCoverage = input.coverageSummary.entries.map((entry) => ({
    requirementId: entry.requirementId,
    status: entry.status,
    linkedTaskIds: entry.linkedTaskIds,
    evidenceRefs: entry.evidenceRefs,
    notes: entry.notes,
  }));

  const lines = [
    "You are a focused SCALER replanner agent.",
    "Consume only the supplied supervisor state, open replan requests, runtime PRD coverage, and current execution plan.",
    "Produce a replacement execution plan only when it preserves validated progress and links all known runtime requirements.",
    "Do not accept the plan yourself; SCALER will run preservation checks and `/scaler-replan-accept` separately.",
    "",
    `Supervisor: ${formatStateStatus(input.state)}`,
    "",
    "Current execution plan summary:",
    formatExecutionPlanSummary(planSummary),
    "",
    "Open replan requests:",
    JSON.stringify(openRequests, null, 2),
    "",
    "Runtime PRD requirements:",
    JSON.stringify(input.requirements.requirements, null, 2),
    "",
    "Runtime PRD coverage:",
    JSON.stringify(requirementCoverage, null, 2),
    "",
    "Supervisor tasks:",
    JSON.stringify(stateTasks, null, 2),
    "",
    "Current execution plan JSON:",
    JSON.stringify(input.currentPlan, null, 2),
    "",
    "Required preservation rules:",
    "- Preserve every validated task id already in the current plan.",
    "- Preserve validated requirement coverage; do not unlink known runtime requirements.",
    "- Link every proposed task to runtime PRD refs when possible.",
    "- Keep tasks atomic, sequential, independently validateable, and include taskKind, atomicityRationale, allowedPathPrefixes, definitionOfDone, and validationRefs or validationCommands.",
    "- Software/mixed tasks must include a test_first validation command/check before implementation gates, or a qualityWaivers entry with an explicit reason and alternative validation path.",
    "- For software/mixed tasks, decide whether local_ci, Docker, Compose, devcontainer, or Minikube validation is needed; set validationCommands.environment and include generated CI/CD setup work when the current plan lacks it.",
    "- Keep existing task ids stable unless a task is unvalidated and replacement is justified by evidence.",
    "",
    "Required final response:",
    "- Summarize the proposed plan and how each open replan request is addressed.",
    "- Emit exactly one JSON event with type `scaler_replan_proposal` and a `plan` field containing an ExecutionPlanArtifact v1.",
    "- The plan must be draft status, include planVersion, tasks, PRD refs, dependencies, taskKind, atomicityRationale, definitionOfDone, validationRefs/validationCommands, and explicit qualityWaivers where a requirement is intentionally waived.",
    "- If no safe plan can be produced, emit a JSON event with type `scaler_replan_proposal` and an `error` string instead of a plan.",
  ];

  if (input.extraInstructions?.trim()) {
    lines.push("", "Extra instructions:", input.extraInstructions.trim());
  }

  return lines.join("\n");
}

export function prepareReplanAgentInvocation(
  cwd: string,
  input: ReplanAgentPromptInput,
  options: ReplanAgentInvocationOptions = {},
): ReplanAgentPreparation {
  const prompt = buildReplanAgentPrompt(input);
  const request: TaskAgentRequest = {
    taskId: "replan-agent",
    prompt,
    cwd,
    tools: options.tools,
    model: options.model,
    appendSystemPromptPath: options.appendSystemPromptPath,
    extensionPaths: options.extensionPaths,
  };
  const invocation = buildTaskAgentInvocation(request, options.command ?? "pi");
  return { prompt, request, invocation };
}

export async function runReplanAgentStep(
  cwd: string,
  state: ScalerState,
  options: RunReplanAgentOptions = {},
  runner: ReplanAgentRunner = runTaskAgent,
): Promise<ReplanAgentStepResult> {
  const lock = await acquireExecutionLock(cwd, {
    operation: options.execute ? "replan_agent_execute" : "replan_agent_prepare",
    reason: "Replanner agent proposal workflow",
  });
  if (!lock.acquired) return { accepted: false, message: lock.message };

  try {
    const context = await loadReplanAgentContext(cwd, state, options.extraInstructions);
    const preparation = prepareReplanAgentInvocation(cwd, context, options);
    await logAgentPromptAudit(cwd, state, {
      agentType: "replan",
      agentId: "replan-agent",
      prompt: preparation.prompt,
      inputRefs: context.replanRequests.map((request) => request.id),
      details: { invocation: preparation.invocation, currentPlanVersion: context.currentPlan.planVersion },
    });
    const runResult = options.execute ? await runner(preparation.request, { timeoutMs: options.timeoutMs }) : undefined;
    if (runResult?.usage) {
      await recordProviderUsageBudget(cwd, state, runResult.usage, {
        source: "replan-agent-run",
        agentId: "replan-agent",
        agentType: "replan",
      });
    }
    const ingestion = runResult?.exitCode === 0 ? await ingestReplanProposalReport(cwd, runResult.stdoutEvents, state) : { attempted: false, ingested: false };
    if (ingestion.attempted) {
      await logStructuredReportAudit(cwd, state, {
        reportType: "scaler_replan_proposal",
        summary: ingestion.ingested ? `Replan proposal ingested: ${ingestion.plan?.planVersion ?? "unknown"}` : (ingestion.reason ?? "Replan proposal rejected"),
        report: ingestion.plan ?? { reason: ingestion.reason },
        accepted: ingestion.ingested,
        outputRefs: ingestion.plan ? [String(ingestion.plan.planVersion)] : undefined,
      });
    }
    const runRecord = await recordReplanAgentRun(cwd, runResult, options.execute ? ingestion : undefined, options.execute ? undefined : "prepared");
    return {
      accepted: true,
      message: `${options.execute ? "Executed" : "Prepared"} replanner agent`,
      prompt: preparation.prompt,
      invocation: preparation.invocation,
      runResult,
      runRecord,
      ingestion,
    };
  } finally {
    await releaseExecutionLock(cwd, lock.lock.id);
  }
}

export async function ingestReplanProposalReport(
  cwd: string,
  stdoutEvents: unknown[],
  state: ScalerState,
  now = new Date(),
): Promise<ReplanProposalIngestionResult> {
  const currentPlan = await loadExecutionPlan(cwd);
  const requirements = await loadPrdRequirements(cwd);
  const extraction = extractReplanProposalReport(stdoutEvents, currentPlan.planVersion + 1, now);
  if (!extraction.ok || !extraction.plan) {
    return { attempted: true, ingested: false, reason: extraction.reason ?? "Replan proposal extraction failed." };
  }

  const savedPlan = await saveProposedExecutionPlan(cwd, extraction.plan, now);
  const preservation = checkExecutionPlanPreservation(currentPlan, savedPlan, requirements, state);
  return {
    attempted: true,
    ingested: true,
    plan: savedPlan,
    preservation,
    reason: preservation.ok ? undefined : formatExecutionPlanPreservationCheck(preservation),
  };
}

export function extractReplanProposalReport(
  stdoutEvents: unknown[],
  defaultPlanVersion = 1,
  now = new Date(),
): ReplanProposalExtractionResult {
  const candidates = extractStructuredReportPayloads(stdoutEvents, "scaler_replan_proposal");
  if (candidates.length === 0) return { ok: false, reason: "No scaler_replan_proposal report found in replanner output." };

  const report = candidates[candidates.length - 1];
  const error = stringField(report, "error");
  if (error) return { ok: false, reason: `Replanner reported no proposal: ${error}` };

  const planRecord = isRecord(report.plan) ? report.plan : report;
  if (!isRecord(planRecord)) return { ok: false, reason: "Replan proposal report is missing plan." };

  const timestamp = now.toISOString();
  const plan = {
    ...planRecord,
    version: planRecord.version === 1 ? 1 : 1,
    planVersion: numberField(planRecord, "planVersion") ?? defaultPlanVersion,
    status: stringField(planRecord, "status") ?? "draft",
    tasks: Array.isArray(planRecord.tasks) ? planRecord.tasks : [],
    createdAt: stringField(planRecord, "createdAt") ?? timestamp,
    updatedAt: stringField(planRecord, "updatedAt") ?? timestamp,
  } as ExecutionPlanArtifact;

  try {
    validateExecutionPlan(plan);
  } catch (validationError) {
    return { ok: false, reason: (validationError as Error).message };
  }

  return { ok: true, plan };
}

export async function loadReplanAgentRunRecords(cwd: string): Promise<ReplanAgentRunRecord[]> {
  try {
    const raw = await readFile(getReplanAgentRunsPath(cwd), "utf8");
    const index = JSON.parse(raw) as ReplanAgentRunIndex;
    if (index.version !== 1) throw new Error(`Unsupported replan-agent run index version: ${String(index.version)}`);
    return index.runs;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function recordReplanAgentRun(
  cwd: string,
  runResult: TaskAgentRunResult | undefined,
  ingestion?: ReplanProposalIngestionResult,
  preparedStatus?: "prepared",
  now = new Date(),
): Promise<ReplanAgentRunRecord> {
  const timestamp = now.toISOString();
  const record: ReplanAgentRunRecord = runResult ? {
    id: `replan-agent-${now.getTime()}`,
    status: runResult.exitCode === 0 ? "passed" : "failed",
    exitCode: runResult.exitCode,
    stdoutEventCount: runResult.stdoutEvents.length,
    stderrSummary: summarizeOutput(runResult.stderr),
    timedOut: runResult.timedOut,
    aborted: runResult.aborted,
    ingestionStatus: ingestion?.attempted ? (ingestion.ingested ? "ingested" : "rejected") : "not_attempted",
    proposedPlanVersion: ingestion?.plan?.planVersion,
    createdAt: timestamp,
    usage: runResult.usage,
  } : {
    id: `replan-agent-${now.getTime()}`,
    status: preparedStatus ?? "prepared",
    ingestionStatus: "not_attempted",
    createdAt: timestamp,
  };
  const path = getReplanAgentRunsPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ version: 1, runs: [record, ...(await loadReplanAgentRunRecords(cwd))] }, null, 2)}\n`, "utf8");
  return record;
}

export function formatReplanAgentRunList(records: ReplanAgentRunRecord[], limit = 10): string {
  if (records.length === 0) return "No replan-agent runs.";
  const lines = ["Replan-agent runs:"];
  for (const record of records.slice(0, limit)) {
    const exit = record.exitCode === undefined ? "n/a" : String(record.exitCode);
    const flags = [record.timedOut && "timed_out", record.aborted && "aborted"].filter(Boolean).join(",") || "none";
    const ingestion = record.ingestionStatus ?? "not_attempted";
    const proposed = record.proposedPlanVersion === undefined ? "n/a" : String(record.proposedPlanVersion);
    const stderr = record.stderrSummary ? ` stderr=${record.stderrSummary}` : "";
    lines.push(`- ${record.status} exit=${exit} flags=${flags} stdout_events=${record.stdoutEventCount ?? 0} ingestion=${ingestion} proposed_plan=${proposed}${stderr}`);
  }
  return lines.join("\n");
}

async function loadReplanAgentContext(cwd: string, state: ScalerState, extraInstructions?: string): Promise<ReplanAgentPromptInput> {
  const currentPlan = await loadExecutionPlan(cwd);
  const requirements = await loadPrdRequirements(cwd);
  const coverage = await loadPrdCoverage(cwd);
  const coverageSummary = computePrdCoverageSummary(requirements, coverage, state);
  const replanRequests = await loadReplanRequests(cwd);
  return { state, currentPlan, requirements, coverageSummary, replanRequests, extraInstructions };
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function numberField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function summarizeOutput(output: string, maxLength = 500): string {
  const singleLine = output.replace(/\s+/g, " ").trim();
  return singleLine.length > maxLength ? `${singleLine.slice(0, maxLength - 3)}...` : singleLine;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

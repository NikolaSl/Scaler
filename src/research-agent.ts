import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { acquireExecutionLock, releaseExecutionLock } from "./locks.js";
import { logAgentPromptAudit, logStructuredReportAudit } from "./logging.js";
import { loadExecutionPlan, summarizeExecutionPlan, formatExecutionPlanSummary, type ExecutionPlanArtifact } from "./plans.js";
import { getResearchAgentRunsPath } from "./paths.js";
import { computePrdCoverageSummary, loadPrdCoverage, loadPrdRequirements, type RuntimePrdCoverageSummary, type RuntimePrdRequirementsFile } from "./prd.js";
import { recordProviderUsageBudget, type ProviderUsage } from "./provider-usage.js";
import {
  formatResearchSummary,
  loadResearchReports,
  loadResearchRequests,
  recordResearchReport,
  validateResearchReport,
  type ResearchReport,
  type ResearchReportInput,
  type ResearchRequest,
} from "./research.js";
import { buildTaskAgentInvocation, extractStructuredReportPayloads, runTaskAgent, type TaskAgentInvocation, type TaskAgentRequest, type TaskAgentRunResult } from "./subagents.js";
import { formatStateStatus } from "./state.js";
import type { ScalerState } from "./types.js";

export interface ResearchAgentPromptInput {
  state: ScalerState;
  request: ResearchRequest;
  requests: ResearchRequest[];
  reports: ResearchReport[];
  currentPlan: ExecutionPlanArtifact;
  requirements: RuntimePrdRequirementsFile;
  coverageSummary: RuntimePrdCoverageSummary;
  grantedTools?: string[];
  allowInternet?: boolean;
  extraInstructions?: string;
}

export interface ResearchAgentInvocationOptions {
  tools?: string[];
  allowInternet?: boolean;
  model?: string;
  appendSystemPromptPath?: string;
  extensionPaths?: string[];
  command?: string;
}

export interface RunResearchAgentOptions extends ResearchAgentInvocationOptions {
  requestId?: string;
  execute?: boolean;
  timeoutMs?: number;
  extraInstructions?: string;
}

export interface ResearchAgentPreparation {
  prompt: string;
  request: TaskAgentRequest;
  invocation: TaskAgentInvocation;
  researchRequest: ResearchRequest;
}

export interface ResearchReportExtractionResult {
  ok: boolean;
  input?: ResearchReportInput;
  reason?: string;
}

export interface ResearchReportIngestionResult {
  attempted: boolean;
  ingested: boolean;
  report?: ResearchReport;
  reason?: string;
}

export interface ResearchAgentRunRecord {
  id: string;
  requestId?: string;
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

export interface ResearchAgentRunIndex {
  version: 1;
  runs: ResearchAgentRunRecord[];
}

export interface ResearchAgentStepResult {
  accepted: boolean;
  message: string;
  prompt?: string;
  invocation?: TaskAgentInvocation;
  runResult?: TaskAgentRunResult;
  runRecord?: ResearchAgentRunRecord;
  ingestion?: ResearchReportIngestionResult;
  researchRequest?: ResearchRequest;
}

export type ResearchAgentRunner = typeof runTaskAgent;

export function buildResearchAgentPrompt(input: ResearchAgentPromptInput): string {
  const request = input.request;
  const stateTasks = input.state.tasks.map((task) => ({
    id: task.id,
    status: task.status,
    title: task.title,
    prdRefs: task.prdRefs,
    allowedPathPrefixes: task.allowedPathPrefixes,
    dependsOn: task.dependsOn,
  }));
  const coverage = input.coverageSummary.entries.map((entry) => ({
    requirementId: entry.requirementId,
    status: entry.status,
    linkedTaskIds: entry.linkedTaskIds,
    evidenceRefs: entry.evidenceRefs,
    notes: entry.notes,
  }));
  const relatedReports = input.reports.filter((report) => report.requestId === request.id || report.taskId === request.taskId || intersects(report.requirementRefs, request.requirementRefs));

  const lines = [
    "You are a focused SCALER research agent.",
    "Answer exactly one research request using only reliable local/project evidence and any explicitly granted tools.",
    "Preserve raw evidence through the structured report's rawEvidence field; SCALER will store it in memory.",
    "Do not mutate project files. Do not mark stage artifacts or execution plans. Do not ingest free-form prose.",
    "If internet/browser tools are not explicitly granted for an internet-scope request, record the limitation as a partial or blocked report with unresolvedUnknowns.",
    formatResearchToolPolicy(request, input.grantedTools, input.allowInternet),
    "Prefer project, official, and primary sources over weak sources. Resolve or explicitly list contradictions.",
    "",
    `Supervisor: ${formatStateStatus(input.state)}`,
    "",
    "Selected research request:",
    JSON.stringify(request, null, 2),
    "",
    "Other open research requests:",
    JSON.stringify(input.requests.filter((candidate) => candidate.id !== request.id && (candidate.status === "open" || candidate.status === "in_progress")), null, 2),
    "",
    "Runtime PRD requirements:",
    JSON.stringify(input.requirements.requirements, null, 2),
    "",
    "Runtime PRD coverage:",
    JSON.stringify(coverage, null, 2),
    "",
    "Current execution plan summary:",
    formatExecutionPlanSummary(summarizeExecutionPlan(input.currentPlan, input.requirements, input.state)),
    "",
    "Supervisor tasks:",
    JSON.stringify(stateTasks, null, 2),
    "",
    "Prior related research reports:",
    relatedReports.length > 0 ? JSON.stringify(relatedReports, null, 2) : "[]",
    "",
    "All research ledger summary:",
    formatResearchSummary(input.requests, input.reports),
    "",
    "Required final response:",
    "- Emit exactly one JSON event with type `scaler_research_report`.",
    "- The event must include question, status (`complete`, `partial`, or `blocked`), requestId, optional taskId/requirementRefs, sources, conclusions, contradictions, unresolvedUnknowns, recommendations, and optional rawEvidence.",
    "- Every conclusion must cite sourceRefs. Every contradiction must cite at least two sourceRefs and resolved contradictions require a resolution.",
    "- Source quality must be one of: project, official, primary, trusted, reputable, weak, unknown.",
    "- Confidence must be one of: high, medium, low, unknown.",
    "- If no reliable answer can be produced, emit a `scaler_research_report` event with status `blocked`, sources explaining attempted evidence, and unresolvedUnknowns.",
  ];

  if (input.extraInstructions?.trim()) {
    lines.push("", "Extra instructions:", input.extraInstructions.trim());
  }

  return lines.join("\n");
}

export function prepareResearchAgentInvocation(
  cwd: string,
  input: ResearchAgentPromptInput,
  options: ResearchAgentInvocationOptions = {},
): ResearchAgentPreparation {
  const grantedTools = resolveResearchAgentGrantedTools(input.request, options);
  const prompt = buildResearchAgentPrompt({ ...input, grantedTools, allowInternet: options.allowInternet });
  const request: TaskAgentRequest = {
    taskId: `research-agent-${input.request.id}`,
    prompt,
    cwd,
    tools: grantedTools.length > 0 ? grantedTools : undefined,
    model: options.model,
    appendSystemPromptPath: options.appendSystemPromptPath,
    extensionPaths: options.extensionPaths,
  };
  const invocation = buildTaskAgentInvocation(request, options.command ?? "pi");
  return { prompt, request, invocation, researchRequest: input.request };
}

export function resolveResearchAgentGrantedTools(request: ResearchRequest, options: ResearchAgentInvocationOptions = {}): string[] {
  const tools = uniqueNonEmpty(options.tools ?? []);
  if (request.scope === "local") return tools;
  return options.allowInternet ? tools : [];
}

export function formatResearchToolPolicy(request: ResearchRequest, grantedTools: string[] = [], allowInternet = false): string {
  if (request.scope === "local") {
    return grantedTools.length > 0
      ? `Research tool policy: local-scope request; granted tools=${grantedTools.join(", ")}. Do not use internet/network behavior.`
      : "Research tool policy: local-scope request; no internet tools are required or granted.";
  }
  if (!allowInternet || grantedTools.length === 0) {
    return `Research tool policy: ${request.scope}-scope request, but internet tools are not explicitly granted. Use local/project evidence only and report missing internet capability as partial or blocked.`;
  }
  return `Research tool policy: ${request.scope}-scope request with explicit internet grant. Granted tools=${grantedTools.join(", ")}. Use only these tools, do not upload private code/secrets, prefer official/primary sources, and cite every source.`;
}

export async function runResearchAgentStep(
  cwd: string,
  state: ScalerState,
  options: RunResearchAgentOptions = {},
  runner: ResearchAgentRunner = runTaskAgent,
): Promise<ResearchAgentStepResult> {
  const lock = await acquireExecutionLock(cwd, {
    operation: options.execute ? "research_agent_execute" : "research_agent_prepare",
    reason: "Research agent evidence workflow",
  });
  if (!lock.acquired) return { accepted: false, message: lock.message };

  try {
    const context = await loadResearchAgentContext(cwd, state, options.requestId, options.extraInstructions);
    if (!context) {
      const detail = options.requestId ? `No open research request found for ${options.requestId}.` : "No open research request found.";
      return { accepted: false, message: detail };
    }
    const preparation = prepareResearchAgentInvocation(cwd, context, options);
    await logAgentPromptAudit(cwd, state, {
      agentType: "research",
      agentId: context.request.id,
      prompt: preparation.prompt,
      taskId: context.request.taskId,
      inputRefs: [context.request.id, ...(context.request.requirementRefs ?? [])],
      details: { invocation: preparation.invocation, scope: context.request.scope },
    });
    const runResult = options.execute ? await runner(preparation.request, { timeoutMs: options.timeoutMs }) : undefined;
    if (runResult?.usage) {
      await recordProviderUsageBudget(cwd, state, runResult.usage, {
        source: "research-agent-run",
        taskId: context.request.taskId,
        agentId: context.request.id,
        agentType: "research",
      });
    }
    const ingestion = runResult?.exitCode === 0 ? await ingestResearchReport(cwd, runResult.stdoutEvents) : { attempted: false, ingested: false };
    if (ingestion.attempted) {
      await logStructuredReportAudit(cwd, state, {
        reportType: "scaler_research_report",
        summary: ingestion.ingested ? `Research report ingested: ${ingestion.report?.id ?? "unknown"}` : (ingestion.reason ?? "Research report rejected"),
        report: ingestion.report ?? { reason: ingestion.reason },
        accepted: ingestion.ingested,
        taskId: context.request.taskId,
        outputRefs: ingestion.report ? [ingestion.report.id] : undefined,
      });
    }
    const runRecord = await recordResearchAgentRun(cwd, context.request.id, runResult, options.execute ? ingestion : undefined, options.execute ? undefined : "prepared");
    return {
      accepted: true,
      message: `${options.execute ? "Executed" : "Prepared"} research agent for ${context.request.id}`,
      prompt: preparation.prompt,
      invocation: preparation.invocation,
      runResult,
      runRecord,
      ingestion,
      researchRequest: context.request,
    };
  } finally {
    await releaseExecutionLock(cwd, lock.lock.id);
  }
}

export async function ingestResearchReport(cwd: string, stdoutEvents: unknown[], now = new Date()): Promise<ResearchReportIngestionResult> {
  const extraction = extractResearchReport(stdoutEvents, now);
  if (!extraction.ok || !extraction.input) {
    return { attempted: true, ingested: false, reason: extraction.reason ?? "Research report extraction failed." };
  }

  try {
    const report = await recordResearchReport(cwd, extraction.input, now);
    return { attempted: true, ingested: true, report };
  } catch (error) {
    return { attempted: true, ingested: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

export function extractResearchReport(stdoutEvents: unknown[], now = new Date()): ResearchReportExtractionResult {
  const candidates = extractStructuredReportPayloads(stdoutEvents, "scaler_research_report");
  if (candidates.length === 0) return { ok: false, reason: "No scaler_research_report report found in research-agent output." };

  const payload = candidates[candidates.length - 1];
  const error = stringField(payload, "error");
  if (error) return { ok: false, reason: `Research agent reported no report: ${error}` };

  const reportRecord = isRecord(payload.report) ? payload.report : payload;
  const timestamp = now.toISOString();
  const input = {
    ...reportRecord,
    id: stringField(reportRecord, "id"),
    status: stringField(reportRecord, "status") ?? "partial",
    question: stringField(reportRecord, "question") ?? "Research report",
    requestId: stringField(reportRecord, "requestId"),
    taskId: stringField(reportRecord, "taskId"),
    requirementRefs: stringArrayField(reportRecord, "requirementRefs"),
    sources: Array.isArray(reportRecord.sources) ? reportRecord.sources : [],
    conclusions: Array.isArray(reportRecord.conclusions) ? reportRecord.conclusions : [],
    contradictions: Array.isArray(reportRecord.contradictions) ? reportRecord.contradictions : undefined,
    unresolvedUnknowns: stringArrayField(reportRecord, "unresolvedUnknowns"),
    recommendations: stringArrayField(reportRecord, "recommendations"),
    memoryRefs: stringArrayField(reportRecord, "memoryRefs"),
    rawEvidence: Array.isArray(reportRecord.rawEvidence) ? reportRecord.rawEvidence : undefined,
  } as ResearchReportInput;

  try {
    validateResearchReport({
      id: input.id ?? `RPT-RESEARCH-${timestamp.replace(/[^0-9]/g, "")}`,
      status: input.status as ResearchReport["status"],
      question: input.question,
      requestId: input.requestId,
      taskId: input.taskId,
      requirementRefs: input.requirementRefs,
      sources: input.sources?.map((source) => ({
        id: source.id.trim(),
        title: source.title.trim(),
        quality: source.quality as ResearchReport["sources"][number]["quality"],
        checkedAt: source.checkedAt?.trim() || timestamp,
        url: source.url?.trim() || undefined,
        path: source.path?.trim() || undefined,
        version: source.version?.trim() || undefined,
        summary: source.summary?.trim() || undefined,
      })) ?? [],
      conclusions: input.conclusions?.map((conclusion) => ({
        summary: conclusion.summary.trim(),
        confidence: conclusion.confidence as ResearchReport["conclusions"][number]["confidence"],
        sourceRefs: conclusion.sourceRefs,
        evidenceRefs: conclusion.evidenceRefs,
      })) ?? [],
      contradictions: input.contradictions?.map((contradiction) => ({
        summary: contradiction.summary.trim(),
        status: contradiction.status as ResearchReport["contradictions"] extends Array<infer T> ? T extends { status: infer S } ? S : never : never,
        sourceRefs: contradiction.sourceRefs,
        resolution: contradiction.resolution?.trim() || undefined,
      })),
      memoryRefs: input.memoryRefs,
      unresolvedUnknowns: input.unresolvedUnknowns,
      recommendations: input.recommendations,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  } catch (validationError) {
    return { ok: false, reason: (validationError as Error).message };
  }

  return { ok: true, input };
}

export async function loadResearchAgentRunRecords(cwd: string): Promise<ResearchAgentRunRecord[]> {
  try {
    const raw = await readFile(getResearchAgentRunsPath(cwd), "utf8");
    const index = JSON.parse(raw) as ResearchAgentRunIndex;
    if (index.version !== 1) throw new Error(`Unsupported research-agent run index version: ${String(index.version)}`);
    return index.runs;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function recordResearchAgentRun(
  cwd: string,
  requestId: string | undefined,
  runResult: TaskAgentRunResult | undefined,
  ingestion?: ResearchReportIngestionResult,
  preparedStatus?: "prepared",
  now = new Date(),
): Promise<ResearchAgentRunRecord> {
  const timestamp = now.toISOString();
  const record: ResearchAgentRunRecord = runResult ? {
    id: `research-agent-${now.getTime()}`,
    requestId,
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
    id: `research-agent-${now.getTime()}`,
    requestId,
    status: preparedStatus ?? "prepared",
    ingestionStatus: "not_attempted",
    createdAt: timestamp,
  };
  const path = getResearchAgentRunsPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ version: 1, runs: [record, ...(await loadResearchAgentRunRecords(cwd))] }, null, 2)}\n`, "utf8");
  return record;
}

export function formatResearchAgentRunList(records: ResearchAgentRunRecord[], requestId?: string, limit = 10): string {
  const filtered = requestId ? records.filter((record) => record.requestId === requestId) : records;
  if (filtered.length === 0) return requestId ? `No research-agent runs for ${requestId}.` : "No research-agent runs.";
  const lines = ["Research-agent runs:"];
  for (const record of filtered.slice(0, limit)) {
    const exit = record.exitCode === undefined ? "n/a" : String(record.exitCode);
    const flags = [record.timedOut && "timed_out", record.aborted && "aborted"].filter(Boolean).join(",") || "none";
    const ingestion = record.ingestionStatus ?? "not_attempted";
    const stderr = record.stderrSummary ? ` stderr=${record.stderrSummary}` : "";
    lines.push(`- ${record.status} request=${record.requestId ?? "n/a"} exit=${exit} flags=${flags} stdout_events=${record.stdoutEventCount ?? 0} ingestion=${ingestion} report=${record.reportId ?? "n/a"}${stderr}`);
  }
  return lines.join("\n");
}

async function loadResearchAgentContext(cwd: string, state: ScalerState, requestId?: string, extraInstructions?: string): Promise<ResearchAgentPromptInput | undefined> {
  const requests = await loadResearchRequests(cwd);
  const selectable = requests.filter((request) => request.status === "open" || request.status === "in_progress");
  const request = requestId
    ? selectable.find((candidate) => candidate.id === requestId)
    : [...selectable].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))[0];
  if (!request) return undefined;

  const requirements = await loadPrdRequirements(cwd);
  const coverage = await loadPrdCoverage(cwd);
  const currentPlan = await loadExecutionPlan(cwd);
  const reports = await loadResearchReports(cwd);
  return {
    state,
    request,
    requests,
    reports,
    currentPlan,
    requirements,
    coverageSummary: computePrdCoverageSummary(requirements, coverage, state),
    extraInstructions,
  };
}

function intersects(left: string[] | undefined, right: string[] | undefined): boolean {
  if (!left?.length || !right?.length) return false;
  const set = new Set(left);
  return right.some((item) => set.has(item));
}

function uniqueNonEmpty(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
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

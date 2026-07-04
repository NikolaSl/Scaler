import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { appendLogEvent, createLogEvent } from "./logging.js";
import { getToolCatalogPath, getToolIterationPolicyPath, getToolIterationRunsPath, getToolRequestsIndexPath, getToolResultsPath, getToolSchemaDiscoveryRunsPath, getToolTransactionsPath } from "./paths.js";
import { recordProviderUsageBudget, type ProviderUsage } from "./provider-usage.js";
import { buildTaskAgentInvocation, runTaskAgent, type RunTaskAgentOptions, type TaskAgentInvocation, type TaskAgentRunResult } from "./subagents.js";
import type { ScalerState } from "./types.js";

export type ToolRiskLevel = "low" | "medium" | "high" | "destructive" | "external" | "secret" | "unknown";

export interface ToolCatalogEntry {
  name: string;
  description: string;
  riskLevel: ToolRiskLevel;
  docsAvailable: boolean;
  schemaAvailable: boolean;
  source?: string;
  docsRef?: string;
  schemaRef?: string;
  notes?: string;
}

export interface ToolSchemaInput {
  toolName: string;
  source: string;
  description?: string;
  riskLevel?: ToolRiskLevel | string;
  permissionRequirement?: string;
  safetyNotes?: string;
  docsRef?: string;
  schemaRef?: string;
  notes?: string;
  evidenceRefs?: string[];
  discoveredByAgentId?: string;
}

export interface ToolRequestInput {
  toolName: string;
  request: string;
  taskId?: string;
  requesterAgentId?: string;
  contextSummary?: string;
  expectedOutput?: string;
  requiredFormat?: string;
  riskLevel?: ToolRiskLevel | string;
  permissionRequirement?: string;
  safetyNotes?: string;
  allowedTools?: string[];
}

export type ToolRequestStatus = "prepared" | "completed" | "failed" | "blocked";
export type ToolResultStatus = "completed" | "failed" | "blocked";
export type ToolTransactionStatus = "prepared" | "completed" | "failed" | "blocked" | "missing_result" | "rejected";
export type ToolSchemaDiscoveryRunStatus = "prepared" | "completed" | "missing_schema" | "rejected";
export type ToolIterationRunStatus = "prepared" | "completed" | "failed" | "blocked" | "missing_result" | "exhausted" | "rejected";
export type ToolIterationStepAction = "run" | "replay";

export interface ToolRequestRecord {
  id: string;
  taskId?: string;
  requesterAgentId?: string;
  toolName: string;
  request: string;
  contextSummary?: string;
  expectedOutput?: string;
  requiredFormat?: string;
  riskLevel: ToolRiskLevel;
  permissionRequirement?: string;
  safetyNotes?: string;
  allowedTools: string[];
  status: ToolRequestStatus;
  createdAt: string;
  updatedAt?: string;
}

export interface ToolSchemaDiscoveryRunRecord {
  id: string;
  toolName: string;
  status: ToolSchemaDiscoveryRunStatus;
  executed: boolean;
  allowedTools: string[];
  invocation: TaskAgentInvocation;
  runExitCode?: number;
  stdoutEventCount?: number;
  stderrSummary?: string;
  schemaRecordId?: string;
  message: string;
  createdAt: string;
  updatedAt: string;
  usage?: ProviderUsage;
}

export interface ToolSchemaRecord {
  id: string;
  toolName: string;
  source: string;
  description?: string;
  riskLevel: ToolRiskLevel;
  permissionRequirement?: string;
  safetyNotes?: string;
  docsRef?: string;
  schemaRef?: string;
  notes?: string;
  evidenceRefs?: string[];
  discoveredByAgentId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ToolResultInput {
  requestId: string;
  status: ToolResultStatus | string;
  summary: string;
  outputs?: unknown;
  evidenceRefs?: string[];
  validationPerformed?: string[];
  errors?: string[];
  recommendations?: string[];
}

export interface ToolTransactionRecord {
  id: string;
  requestId: string;
  taskId?: string;
  toolName: string;
  status: ToolTransactionStatus;
  executed: boolean;
  invocation: TaskAgentInvocation;
  runExitCode?: number;
  stdoutEventCount?: number;
  stderrSummary?: string;
  resultId?: string;
  replayOfTransactionId?: string;
  message: string;
  createdAt: string;
  updatedAt: string;
  usage?: ProviderUsage;
}

export interface ToolResultRecord {
  id: string;
  requestId: string;
  taskId?: string;
  toolName: string;
  status: ToolResultStatus;
  summary: string;
  outputs?: unknown;
  evidenceRefs?: string[];
  validationPerformed?: string[];
  errors?: string[];
  recommendations?: string[];
  createdAt: string;
}

export interface ToolIterationPolicy {
  version: 1;
  maxIterations: number;
  autoReplay: boolean;
  updatedAt?: string;
}

export interface ToolIterationStepRecord {
  iteration: number;
  action: ToolIterationStepAction;
  accepted: boolean;
  transactionId?: string;
  transactionStatus?: ToolTransactionStatus;
  resultId?: string;
  message: string;
}

export interface ToolIterationRunRecord {
  id: string;
  requestId?: string;
  taskId?: string;
  toolName?: string;
  status: ToolIterationRunStatus;
  executed: boolean;
  maxIterations: number;
  autoReplay: boolean;
  steps: ToolIterationStepRecord[];
  finalRequestStatus?: ToolRequestStatus;
  message: string;
  createdAt: string;
  updatedAt: string;
}

export interface ToolRequestPrepareResult {
  accepted: boolean;
  message: string;
  record?: ToolRequestRecord;
  prompt?: string;
  invocation?: TaskAgentInvocation;
}

export interface ToolRequestRunOptions {
  requestId?: string;
  execute?: boolean;
  timeoutMs?: number;
  command?: string;
}

export interface ToolIterationWorkflowOptions {
  requestId?: string;
  execute?: boolean;
  maxIterations?: number;
  timeoutMs?: number;
  command?: string;
}

export interface ToolIterationPolicyInput {
  maxIterations?: number;
  autoReplay?: boolean;
}

export interface ToolTransactionReplayOptions {
  transactionId: string;
  execute?: boolean;
  timeoutMs?: number;
  command?: string;
}

export interface ToolSchemaDiscoveryRunOptions {
  toolName: string;
  execute?: boolean;
  tools?: string[];
  timeoutMs?: number;
  command?: string;
}

export interface ToolRequestRunResult {
  accepted: boolean;
  message: string;
  request?: ToolRequestRecord;
  prompt?: string;
  invocation?: TaskAgentInvocation;
  runResult?: TaskAgentRunResult;
  transaction?: ToolTransactionRecord;
  resultRecord?: ToolResultRecord;
}

export interface ToolTransactionReplayResult {
  accepted: boolean;
  message: string;
  original?: ToolTransactionRecord;
  request?: ToolRequestRecord;
  prompt?: string;
  invocation?: TaskAgentInvocation;
  runResult?: TaskAgentRunResult;
  transaction?: ToolTransactionRecord;
  resultRecord?: ToolResultRecord;
}

export interface ToolSchemaDiscoveryRunResult {
  accepted: boolean;
  message: string;
  toolName?: string;
  prompt?: string;
  invocation?: TaskAgentInvocation;
  runResult?: TaskAgentRunResult;
  run?: ToolSchemaDiscoveryRunRecord;
  schemaRecord?: ToolSchemaRecord;
}

export interface ToolIterationWorkflowResult {
  accepted: boolean;
  message: string;
  request?: ToolRequestRecord;
  run?: ToolIterationRunRecord;
  steps: ToolIterationStepRecord[];
}

interface ToolRequestIndex {
  version: 1;
  requests: ToolRequestRecord[];
}

interface ToolResultIndex {
  version: 1;
  results: ToolResultRecord[];
}

interface ToolTransactionIndex {
  version: 1;
  transactions: ToolTransactionRecord[];
}

interface ToolSchemaIndex {
  version: 1;
  records: ToolSchemaRecord[];
}

interface ToolSchemaDiscoveryRunIndex {
  version: 1;
  runs: ToolSchemaDiscoveryRunRecord[];
}

interface ToolIterationRunIndex {
  version: 1;
  runs: ToolIterationRunRecord[];
}

const toolRiskLevels = new Set<ToolRiskLevel>(["low", "medium", "high", "destructive", "external", "secret", "unknown"]);
const toolResultStatuses = new Set<ToolResultStatus>(["completed", "failed", "blocked"]);

const defaultToolCatalog: ToolCatalogEntry[] = [
  { name: "read", description: "Read a project file or image from the working tree.", riskLevel: "low", docsAvailable: false, schemaAvailable: true },
  { name: "write", description: "Create or overwrite a project file.", riskLevel: "medium", docsAvailable: false, schemaAvailable: true },
  { name: "edit", description: "Apply targeted edits to a project file.", riskLevel: "medium", docsAvailable: false, schemaAvailable: true },
  { name: "bash", description: "Run a shell command in the project.", riskLevel: "high", docsAvailable: true, schemaAvailable: true },
  { name: "scaler_memory_retrieve", description: "Retrieve a SCALER memory entry by id/path.", riskLevel: "low", docsAvailable: true, schemaAvailable: true },
  { name: "scaler_memory_write", description: "Write inactive detail to SCALER memory.", riskLevel: "medium", docsAvailable: true, schemaAvailable: true },
  { name: "scaler_research_report", description: "Record structured research evidence.", riskLevel: "medium", docsAvailable: true, schemaAvailable: true },
  { name: "scaler_tool_request", description: "Prepare another isolated tool-agent request.", riskLevel: "low", docsAvailable: true, schemaAvailable: true },
];

export function normalizeToolRiskLevel(value: unknown): ToolRiskLevel {
  if (typeof value !== "string") return "unknown";
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return toolRiskLevels.has(normalized as ToolRiskLevel) ? normalized as ToolRiskLevel : "unknown";
}

export function getDefaultToolCatalog(): ToolCatalogEntry[] {
  return defaultToolCatalog.map((entry) => ({ ...entry }));
}

export function getToolCatalogEntries(toolNames: string[], discoveredRecords: ToolSchemaRecord[] = []): ToolCatalogEntry[] {
  const catalog = getDefaultToolCatalog();
  const requested = uniqueNonEmpty(toolNames);
  const latestDiscovered = latestToolSchemaRecords(discoveredRecords);
  return requested.map((name) => {
    const discovered = latestDiscovered.get(name);
    const base = catalog.find((entry) => entry.name === name) ?? {
      name,
      description: "Requested tool/MCP; full docs/schema may be inspected by the isolated tool agent if available.",
      riskLevel: "unknown" as ToolRiskLevel,
      docsAvailable: false,
      schemaAvailable: false,
    };
    if (!discovered) return { ...base };
    return {
      ...base,
      description: discovered.description ?? base.description,
      riskLevel: discovered.riskLevel === "unknown" ? base.riskLevel : discovered.riskLevel,
      docsAvailable: base.docsAvailable || Boolean(discovered.docsRef),
      schemaAvailable: base.schemaAvailable || Boolean(discovered.schemaRef),
      source: discovered.source,
      docsRef: discovered.docsRef,
      schemaRef: discovered.schemaRef,
      notes: discovered.notes,
    };
  });
}

export function formatToolCatalog(entries: ToolCatalogEntry[]): string {
  if (entries.length === 0) return "Tool catalog: none";
  return [
    "Tool catalog:",
    ...entries.map((entry) => {
      const refs = [entry.source ? `source=${entry.source}` : undefined, entry.docsRef ? `docsRef=${entry.docsRef}` : undefined, entry.schemaRef ? `schemaRef=${entry.schemaRef}` : undefined].filter(Boolean).join(" ");
      const notes = entry.notes ? ` notes=${entry.notes}` : "";
      return `- ${entry.name}: ${entry.description} risk=${entry.riskLevel} docs=${entry.docsAvailable ? "yes" : "no"} schema=${entry.schemaAvailable ? "yes" : "no"}${refs ? ` ${refs}` : ""}${notes}`;
    }),
  ].join("\n");
}

export async function loadToolRequests(cwd: string): Promise<ToolRequestRecord[]> {
  try {
    const raw = await readFile(getToolRequestsIndexPath(cwd), "utf8");
    return (JSON.parse(raw) as ToolRequestIndex).requests;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function loadToolResults(cwd: string): Promise<ToolResultRecord[]> {
  try {
    const raw = await readFile(getToolResultsPath(cwd), "utf8");
    return (JSON.parse(raw) as ToolResultIndex).results;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function loadToolTransactions(cwd: string): Promise<ToolTransactionRecord[]> {
  try {
    const raw = await readFile(getToolTransactionsPath(cwd), "utf8");
    return (JSON.parse(raw) as ToolTransactionIndex).transactions;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function loadToolSchemaRecords(cwd: string): Promise<ToolSchemaRecord[]> {
  try {
    const raw = await readFile(getToolCatalogPath(cwd), "utf8");
    return (JSON.parse(raw) as ToolSchemaIndex).records;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function loadToolSchemaDiscoveryRuns(cwd: string): Promise<ToolSchemaDiscoveryRunRecord[]> {
  try {
    const raw = await readFile(getToolSchemaDiscoveryRunsPath(cwd), "utf8");
    return (JSON.parse(raw) as ToolSchemaDiscoveryRunIndex).runs;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export function createDefaultToolIterationPolicy(): ToolIterationPolicy {
  return { version: 1, maxIterations: 3, autoReplay: true };
}

export async function loadToolIterationPolicy(cwd: string): Promise<ToolIterationPolicy> {
  try {
    const raw = await readFile(getToolIterationPolicyPath(cwd), "utf8");
    const parsed = JSON.parse(raw) as Partial<ToolIterationPolicy>;
    return normalizeToolIterationPolicy(parsed);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return createDefaultToolIterationPolicy();
    throw error;
  }
}

export async function saveToolIterationPolicy(cwd: string, input: ToolIterationPolicyInput, now = new Date()): Promise<ToolIterationPolicy> {
  const current = await loadToolIterationPolicy(cwd);
  const next = normalizeToolIterationPolicy({
    ...current,
    maxIterations: input.maxIterations ?? current.maxIterations,
    autoReplay: input.autoReplay ?? current.autoReplay,
    updatedAt: now.toISOString(),
  });
  const path = getToolIterationPolicyPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

export async function loadToolIterationRuns(cwd: string): Promise<ToolIterationRunRecord[]> {
  try {
    const raw = await readFile(getToolIterationRunsPath(cwd), "utf8");
    return (JSON.parse(raw) as ToolIterationRunIndex).runs;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export function formatToolIterationPolicy(policy: ToolIterationPolicy): string {
  return `Tool iteration policy: maxIterations=${policy.maxIterations} autoReplay=${policy.autoReplay} updatedAt=${policy.updatedAt ?? "default"}`;
}

export function formatToolIterationRuns(records: ToolIterationRunRecord[], requestId?: string, limit = 10): string {
  const filtered = requestId ? records.filter((record) => record.requestId === requestId) : records;
  if (filtered.length === 0) return requestId ? `No tool iteration runs for ${requestId}.` : "No tool iteration runs.";
  const lines = [requestId ? `Tool iteration runs for ${requestId}:` : "Tool iteration runs:"];
  for (const record of filtered.slice(0, limit)) {
    lines.push(`- ${record.id} request=${record.requestId ?? "n/a"} tool=${record.toolName ?? "n/a"} status=${record.status} executed=${record.executed} steps=${record.steps.length}/${record.maxIterations} final=${record.finalRequestStatus ?? "n/a"}: ${record.message}`);
  }
  return lines.join("\n");
}

export async function recordToolSchema(cwd: string, state: ScalerState, input: ToolSchemaInput, now = new Date()): Promise<ToolSchemaRecord> {
  const toolName = input.toolName.trim();
  const source = input.source.trim();
  if (!toolName) throw new Error("Tool schema rejected: toolName is required.");
  if (!source) throw new Error("Tool schema rejected: source is required.");
  const timestamp = now.toISOString();
  const evidenceRefs = uniqueNonEmpty(input.evidenceRefs ?? []);
  const record: ToolSchemaRecord = {
    id: randomUUID(),
    toolName,
    source,
    description: input.description?.trim() || undefined,
    riskLevel: normalizeToolRiskLevel(input.riskLevel),
    permissionRequirement: input.permissionRequirement?.trim() || undefined,
    safetyNotes: input.safetyNotes?.trim() || undefined,
    docsRef: input.docsRef?.trim() || undefined,
    schemaRef: input.schemaRef?.trim() || undefined,
    notes: input.notes?.trim() || undefined,
    evidenceRefs: evidenceRefs.length > 0 ? evidenceRefs : undefined,
    discoveredByAgentId: input.discoveredByAgentId?.trim() || undefined,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const records = await loadToolSchemaRecords(cwd);
  await writeToolSchemaIndex(cwd, [record, ...records]);
  await appendLogEvent(cwd, createLogEvent(state, {
    eventType: "tool",
    summary: `Tool schema recorded: ${record.toolName}`,
    outputRefs: [record.id, ...(record.evidenceRefs ?? [])],
    details: { record },
  }));
  return record;
}

export function formatDiscoveredToolCatalog(toolNames: string[], discoveredRecords: ToolSchemaRecord[]): string {
  return formatToolCatalog(getToolCatalogEntries(toolNames, discoveredRecords));
}

export function formatKnownToolCatalog(discoveredRecords: ToolSchemaRecord[], toolName?: string): string {
  const names = toolName
    ? [toolName]
    : uniqueNonEmpty([...getDefaultToolCatalog().map((entry) => entry.name), ...discoveredRecords.map((record) => record.toolName)]);
  return formatDiscoveredToolCatalog(names, discoveredRecords);
}

export async function runToolSchemaDiscoveryAgent(
  cwd: string,
  state: ScalerState,
  options: ToolSchemaDiscoveryRunOptions,
  runner: typeof runTaskAgent = runTaskAgent,
): Promise<ToolSchemaDiscoveryRunResult> {
  const toolName = options.toolName.trim();
  if (!toolName) {
    const message = "Tool schema discovery rejected: toolName is required.";
    await appendLogEvent(cwd, createLogEvent(state, { eventType: "tool", summary: message, details: options }));
    return { accepted: false, message };
  }

  const existingRecords = await loadToolSchemaRecords(cwd);
  const prompt = buildToolSchemaDiscoveryPrompt(toolName, existingRecords, options.tools ?? []);
  const allowedTools = uniqueNonEmpty(["scaler_tool_schema", ...(options.tools ?? [])]);
  const agentRequest = {
    taskId: `tool-schema-${toolName}`,
    prompt,
    tools: allowedTools,
    cwd,
  };
  const invocation = buildTaskAgentInvocation(agentRequest, options.command ?? "pi");

  if (!options.execute) {
    const run = await recordToolSchemaDiscoveryRun(cwd, {
      toolName,
      status: "prepared",
      executed: false,
      allowedTools,
      invocation,
      message: `Tool schema discovery prepared: ${toolName}`,
    });
    await appendLogEvent(cwd, createLogEvent(state, { eventType: "tool", summary: run.message, details: { run } }));
    return { accepted: true, message: run.message, toolName, prompt, invocation, run };
  }

  const beforeIds = new Set(existingRecords.map((record) => record.id));
  const runResult = await runner(agentRequest, { timeoutMs: options.timeoutMs, command: options.command } satisfies RunTaskAgentOptions);
  if (runResult.usage) {
    await recordProviderUsageBudget(cwd, state, runResult.usage, {
      source: "tool-schema-discovery-run",
      agentId: `tool-schema-${toolName}`,
      agentType: "tool-schema",
    });
  }
  const schemaRecord = (await loadToolSchemaRecords(cwd)).find((record) => record.toolName === toolName && !beforeIds.has(record.id));
  const status: ToolSchemaDiscoveryRunStatus = schemaRecord ? "completed" : "missing_schema";
  const run = await recordToolSchemaDiscoveryRun(cwd, {
    toolName,
    status,
    executed: true,
    allowedTools,
    invocation,
    runResult,
    schemaRecordId: schemaRecord?.id,
    message: status === "missing_schema"
      ? `Tool schema discovery missing structured schema: ${toolName}`
      : `Tool schema discovery completed: ${toolName}`,
  });
  await appendLogEvent(cwd, createLogEvent(state, { eventType: "tool", summary: run.message, details: { run, runResult, schemaRecord } }));
  return { accepted: status === "completed", message: run.message, toolName, prompt, invocation, runResult, run, schemaRecord };
}

export function formatToolSchemaDiscoveryRuns(records: ToolSchemaDiscoveryRunRecord[], toolName?: string, limit = 10): string {
  const filtered = toolName ? records.filter((record) => record.toolName === toolName) : records;
  if (filtered.length === 0) return toolName ? `No tool schema discovery runs for ${toolName}.` : "No tool schema discovery runs.";
  const lines = [toolName ? `Tool schema discovery runs for ${toolName}:` : "Tool schema discovery runs:"];
  for (const record of filtered.slice(0, limit)) {
    const run = record.runExitCode === undefined ? "not-run" : `exit=${record.runExitCode} stdout_events=${record.stdoutEventCount ?? 0}`;
    lines.push(`- ${record.id} tool=${record.toolName} status=${record.status} tools=${record.allowedTools.join(",")} ${run} schema=${record.schemaRecordId ?? "n/a"}: ${record.message}`);
  }
  return lines.join("\n");
}

export async function runToolRequestAgent(
  cwd: string,
  state: ScalerState,
  options: ToolRequestRunOptions = {},
  runner: typeof runTaskAgent = runTaskAgent,
): Promise<ToolRequestRunResult> {
  const request = await selectRunnableToolRequest(cwd, options.requestId);
  if (!request) {
    const message = options.requestId ? `Tool transaction rejected: request ${options.requestId} is not prepared.` : "Tool transaction rejected: no prepared tool request.";
    await appendLogEvent(cwd, createLogEvent(state, { eventType: "tool", summary: message, details: options }));
    return { accepted: false, message };
  }

  const prompt = buildToolAgentPrompt(request, await loadToolSchemaRecords(cwd));
  const agentRequest = {
    taskId: `tool-${request.id}`,
    prompt,
    tools: request.allowedTools,
    cwd,
  };
  const invocation = buildTaskAgentInvocation(agentRequest, options.command ?? "pi");

  if (!options.execute) {
    const transaction = await recordToolTransaction(cwd, request, {
      status: "prepared",
      executed: false,
      invocation,
      message: `Tool transaction prepared: ${request.id}`,
    });
    await appendLogEvent(cwd, createLogEvent(state, { eventType: "tool", summary: transaction.message, taskId: request.taskId, details: { transaction } }));
    return { accepted: true, message: transaction.message, request, prompt, invocation, transaction };
  }

  const runResult = await runner(agentRequest, { timeoutMs: options.timeoutMs, command: options.command } satisfies RunTaskAgentOptions);
  if (runResult.usage) {
    await recordProviderUsageBudget(cwd, state, runResult.usage, {
      source: "tool-agent-run",
      taskId: request.taskId,
      agentId: request.id,
      agentType: "tool",
    });
  }
  const updatedRequest = (await loadToolRequests(cwd)).find((candidate) => candidate.id === request.id) ?? request;
  const resultRecord = (await loadToolResults(cwd)).find((candidate) => candidate.requestId === request.id);
  const status: ToolTransactionStatus = resultRecord && updatedRequest.status !== "prepared" ? updatedRequest.status : "missing_result";
  const transaction = await recordToolTransaction(cwd, updatedRequest, {
    status,
    executed: true,
    invocation,
    runResult,
    resultId: resultRecord?.id,
    message: status === "missing_result"
      ? `Tool transaction missing structured result: ${request.id}`
      : `Tool transaction completed: ${request.id} ${status}`,
  });
  await appendLogEvent(cwd, createLogEvent(state, { eventType: "tool", summary: transaction.message, taskId: request.taskId, details: { transaction, runResult, resultRecord } }));
  return {
    accepted: status !== "missing_result",
    message: transaction.message,
    request: updatedRequest,
    prompt,
    invocation,
    runResult,
    transaction,
    resultRecord,
  };
}

export function formatToolTransactions(records: ToolTransactionRecord[], requestId?: string, limit = 10): string {
  const filtered = requestId ? records.filter((record) => record.requestId === requestId) : records;
  if (filtered.length === 0) return requestId ? `No tool transactions for ${requestId}.` : "No tool transactions.";
  const lines = [requestId ? `Tool transactions for ${requestId}:` : "Tool transactions:"];
  for (const record of filtered.slice(0, limit)) {
    const run = record.runExitCode === undefined ? "not-run" : `exit=${record.runExitCode} stdout_events=${record.stdoutEventCount ?? 0}`;
    const replay = record.replayOfTransactionId ? ` replayOf=${record.replayOfTransactionId}` : "";
    lines.push(`- ${record.id} request=${record.requestId} tool=${record.toolName} status=${record.status}${replay} ${run} result=${record.resultId ?? "n/a"}: ${record.message}`);
  }
  return lines.join("\n");
}

export async function runToolIterationWorkflow(
  cwd: string,
  state: ScalerState,
  options: ToolIterationWorkflowOptions = {},
  runner: typeof runTaskAgent = runTaskAgent,
): Promise<ToolIterationWorkflowResult> {
  const policy = await loadToolIterationPolicy(cwd);
  const maxIterations = clampIterationLimit(options.maxIterations ?? policy.maxIterations);
  const request = await selectRunnableToolRequest(cwd, options.requestId);
  if (!request) {
    const message = options.requestId ? `Tool iteration rejected: request ${options.requestId} is not prepared.` : "Tool iteration rejected: no prepared tool request.";
    const run = await recordToolIterationRun(cwd, {
      status: "rejected",
      executed: Boolean(options.execute),
      maxIterations,
      autoReplay: policy.autoReplay,
      steps: [],
      message,
    });
    await appendLogEvent(cwd, createLogEvent(state, { eventType: "tool", summary: message, details: { options, run } }));
    return { accepted: false, message, run, steps: [] };
  }

  if (!options.execute) {
    const prepared = await runToolRequestAgent(cwd, state, { requestId: request.id, execute: false, timeoutMs: options.timeoutMs, command: options.command }, runner);
    const step = toolIterationStep(1, "run", prepared);
    const run = await recordToolIterationRun(cwd, {
      request,
      status: prepared.accepted ? "prepared" : "rejected",
      executed: false,
      maxIterations,
      autoReplay: policy.autoReplay,
      steps: [step],
      finalRequestStatus: request.status,
      message: prepared.accepted ? `Tool iteration prepared: ${request.id}` : prepared.message,
    });
    await appendLogEvent(cwd, createLogEvent(state, { eventType: "tool", summary: run.message, taskId: request.taskId, details: { run } }));
    return { accepted: prepared.accepted, message: run.message, request, run, steps: [step] };
  }

  const steps: ToolIterationStepRecord[] = [];
  let currentRequest = request;
  let finalStatus: ToolIterationRunStatus = "missing_result";
  let message = `Tool iteration exhausted: ${request.id}`;

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const latestRequest = (await loadToolRequests(cwd)).find((candidate) => candidate.id === request.id);
    if (!latestRequest || latestRequest.status !== "prepared") {
      currentRequest = latestRequest ?? currentRequest;
      finalStatus = mapToolRequestStatusToIterationStatus(latestRequest?.status);
      message = `Tool iteration stopped: request ${request.id} is ${latestRequest?.status ?? "missing"}`;
      break;
    }
    currentRequest = latestRequest;

    const latestMissing = policy.autoReplay ? await latestMissingResultTransaction(cwd, request.id) : undefined;
    const action: ToolIterationStepAction = latestMissing ? "replay" : "run";
    const result = latestMissing
      ? await replayToolTransaction(cwd, state, { transactionId: latestMissing.id, execute: true, timeoutMs: options.timeoutMs, command: options.command }, runner)
      : await runToolRequestAgent(cwd, state, { requestId: request.id, execute: true, timeoutMs: options.timeoutMs, command: options.command }, runner);
    const step = toolIterationStep(iteration, action, result);
    steps.push(step);

    const afterRequest = (await loadToolRequests(cwd)).find((candidate) => candidate.id === request.id) ?? currentRequest;
    currentRequest = afterRequest;
    if (afterRequest.status !== "prepared") {
      finalStatus = mapToolRequestStatusToIterationStatus(afterRequest.status);
      message = `Tool iteration completed: request ${request.id} ${afterRequest.status}`;
      break;
    }
    if (step.transactionStatus !== "missing_result") {
      finalStatus = result.accepted ? "missing_result" : "rejected";
      message = result.message;
      break;
    }
    if (!policy.autoReplay) {
      finalStatus = "missing_result";
      message = `Tool iteration stopped after missing structured result: ${request.id}`;
      break;
    }
  }

  if (currentRequest.status === "prepared" && steps.length >= maxIterations && steps.at(-1)?.transactionStatus === "missing_result") {
    finalStatus = "exhausted";
    message = `Tool iteration exhausted after ${maxIterations} iterations: ${request.id}`;
  }

  const run = await recordToolIterationRun(cwd, {
    request: currentRequest,
    status: finalStatus,
    executed: true,
    maxIterations,
    autoReplay: policy.autoReplay,
    steps,
    finalRequestStatus: currentRequest.status,
    message,
  });
  await appendLogEvent(cwd, createLogEvent(state, { eventType: "tool", summary: run.message, taskId: currentRequest.taskId, details: { run } }));
  return { accepted: finalStatus === "completed" || finalStatus === "failed" || finalStatus === "blocked", message, request: currentRequest, run, steps };
}

export async function replayToolTransaction(
  cwd: string,
  state: ScalerState,
  options: ToolTransactionReplayOptions,
  runner: typeof runTaskAgent = runTaskAgent,
): Promise<ToolTransactionReplayResult> {
  const transactionId = options.transactionId.trim();
  const original = (await loadToolTransactions(cwd)).find((candidate) => candidate.id === transactionId);
  if (!original) {
    const message = `Tool transaction replay rejected: transaction ${transactionId || "<missing>"} not found.`;
    await appendLogEvent(cwd, createLogEvent(state, { eventType: "tool", summary: message, details: options }));
    return { accepted: false, message };
  }

  const request = (await loadToolRequests(cwd)).find((candidate) => candidate.id === original.requestId);
  if (!request) {
    const message = `Tool transaction replay rejected: request ${original.requestId} not found.`;
    await appendLogEvent(cwd, createLogEvent(state, { eventType: "tool", summary: message, details: { original } }));
    return { accepted: false, message, original };
  }

  const replayRequest = reconstructReplayTaskRequest(original, cwd);
  const invocation = buildTaskAgentInvocation(replayRequest, options.command ?? original.invocation.command);

  if (!options.execute) {
    const transaction = await recordToolTransaction(cwd, request, {
      status: "prepared",
      executed: false,
      invocation,
      replayOfTransactionId: original.id,
      message: `Tool transaction replay prepared: ${original.id}`,
    });
    await appendLogEvent(cwd, createLogEvent(state, { eventType: "tool", summary: transaction.message, taskId: request.taskId, details: { transaction, original } }));
    return { accepted: true, message: transaction.message, original, request, prompt: replayRequest.prompt, invocation, transaction };
  }

  if (request.status !== "prepared") {
    const transaction = await recordToolTransaction(cwd, request, {
      status: "rejected",
      executed: false,
      invocation,
      replayOfTransactionId: original.id,
      message: `Tool transaction replay rejected: request ${request.id} is ${request.status}`,
    });
    await appendLogEvent(cwd, createLogEvent(state, { eventType: "tool", summary: transaction.message, taskId: request.taskId, details: { transaction, original, request } }));
    return { accepted: false, message: transaction.message, original, request, prompt: replayRequest.prompt, invocation, transaction };
  }

  const beforeResultIds = new Set((await loadToolResults(cwd)).map((record) => record.id));
  const runResult = await runner(replayRequest, { timeoutMs: options.timeoutMs, command: options.command ?? original.invocation.command } satisfies RunTaskAgentOptions);
  if (runResult.usage) {
    await recordProviderUsageBudget(cwd, state, runResult.usage, {
      source: "tool-replay-run",
      taskId: request.taskId,
      agentId: request.id,
      agentType: "tool-replay",
    });
  }
  const updatedRequest = (await loadToolRequests(cwd)).find((candidate) => candidate.id === request.id) ?? request;
  const resultRecord = (await loadToolResults(cwd)).find((candidate) => candidate.requestId === request.id && !beforeResultIds.has(candidate.id));
  const status: ToolTransactionStatus = resultRecord && updatedRequest.status !== "prepared" ? updatedRequest.status : "missing_result";
  const transaction = await recordToolTransaction(cwd, updatedRequest, {
    status,
    executed: true,
    invocation,
    runResult,
    resultId: resultRecord?.id,
    replayOfTransactionId: original.id,
    message: status === "missing_result"
      ? `Tool transaction replay missing structured result: ${original.id}`
      : `Tool transaction replay completed: ${original.id} ${status}`,
  });
  await appendLogEvent(cwd, createLogEvent(state, { eventType: "tool", summary: transaction.message, taskId: request.taskId, details: { transaction, original, runResult, resultRecord } }));
  return {
    accepted: status !== "missing_result",
    message: transaction.message,
    original,
    request: updatedRequest,
    prompt: replayRequest.prompt,
    invocation,
    runResult,
    transaction,
    resultRecord,
  };
}

export async function recordToolResult(cwd: string, state: ScalerState, input: ToolResultInput, now = new Date()): Promise<ToolResultRecord> {
  const requests = await loadToolRequests(cwd);
  const request = requests.find((candidate) => candidate.id === input.requestId.trim());
  if (!request) throw new Error(`Tool result rejected: request ${input.requestId.trim() || "<missing>"} not found.`);

  const status = normalizeToolResultStatus(input.status);
  const summary = input.summary.trim();
  if (!summary) throw new Error("Tool result rejected: summary is required.");
  const evidenceRefs = uniqueNonEmpty(input.evidenceRefs ?? []);
  const validationPerformed = uniqueNonEmpty(input.validationPerformed ?? []);
  const errors = uniqueNonEmpty(input.errors ?? []);
  const recommendations = uniqueNonEmpty(input.recommendations ?? []);
  if (status === "completed" && input.outputs === undefined && evidenceRefs.length === 0 && validationPerformed.length === 0) {
    throw new Error("Tool result rejected: completed results require outputs, evidenceRefs, or validationPerformed.");
  }
  if ((status === "failed" || status === "blocked") && errors.length === 0 && recommendations.length === 0) {
    throw new Error("Tool result rejected: failed/blocked results require errors or recommendations.");
  }

  const record: ToolResultRecord = {
    id: randomUUID(),
    requestId: request.id,
    taskId: request.taskId,
    toolName: request.toolName,
    status,
    summary,
    outputs: input.outputs,
    evidenceRefs: evidenceRefs.length > 0 ? evidenceRefs : undefined,
    validationPerformed: validationPerformed.length > 0 ? validationPerformed : undefined,
    errors: errors.length > 0 ? errors : undefined,
    recommendations: recommendations.length > 0 ? recommendations : undefined,
    createdAt: now.toISOString(),
  };

  const updatedRequests = requests.map((candidate) => candidate.id === request.id ? { ...candidate, status, updatedAt: record.createdAt } : candidate);
  const results = await loadToolResults(cwd);
  await writeToolRequestIndex(cwd, updatedRequests);
  await writeToolResultIndex(cwd, [record, ...results]);
  await appendLogEvent(
    cwd,
    createLogEvent(state, {
      eventType: "tool",
      summary: `Tool result recorded: ${record.toolName} ${record.status}`,
      taskId: record.taskId,
      outputRefs: [record.id, record.requestId],
      details: { record },
    }),
  );
  return record;
}

export async function prepareToolRequest(
  cwd: string,
  state: ScalerState,
  input: ToolRequestInput,
  now = new Date(),
): Promise<ToolRequestPrepareResult> {
  if (!input.toolName.trim()) {
    return rejectToolRequest(cwd, state, input, "Tool request rejected: toolName is required");
  }
  if (!input.request.trim()) {
    return rejectToolRequest(cwd, state, input, "Tool request rejected: request is required");
  }

  const record: ToolRequestRecord = {
    id: randomUUID(),
    taskId: input.taskId,
    requesterAgentId: input.requesterAgentId?.trim() || undefined,
    toolName: input.toolName.trim(),
    request: input.request.trim(),
    contextSummary: input.contextSummary?.trim() || undefined,
    expectedOutput: input.expectedOutput?.trim() || undefined,
    requiredFormat: input.requiredFormat?.trim() || undefined,
    riskLevel: normalizeToolRiskLevel(input.riskLevel),
    permissionRequirement: input.permissionRequirement?.trim() || undefined,
    safetyNotes: input.safetyNotes?.trim() || undefined,
    allowedTools: uniqueNonEmpty([input.toolName, ...(input.allowedTools ?? [])]),
    status: "prepared",
    createdAt: now.toISOString(),
  };
  const prompt = buildToolAgentPrompt(record, await loadToolSchemaRecords(cwd));
  const invocation = buildTaskAgentInvocation({
    taskId: `tool-${record.id}`,
    prompt,
    tools: record.allowedTools,
    cwd,
  });

  const requests = await loadToolRequests(cwd);
  await writeToolRequestIndex(cwd, [...requests, record]);
  await appendLogEvent(
    cwd,
    createLogEvent(state, {
      eventType: "tool",
      summary: `Tool request prepared: ${record.toolName}`,
      taskId: record.taskId,
      details: { record, invocation },
    }),
  );

  return {
    accepted: true,
    message: `Tool request prepared: ${record.id}`,
    record,
    prompt,
    invocation,
  };
}

export function buildToolSchemaDiscoveryPrompt(toolName: string, discoveredRecords: ToolSchemaRecord[] = [], explicitlyGrantedTools: string[] = []): string {
  const allowedTools = uniqueNonEmpty(["scaler_tool_schema", ...explicitlyGrantedTools]);
  const existing = formatDiscoveredToolCatalog([toolName], discoveredRecords);
  return [
    "You are an isolated SCALER Tool/MCP schema discovery agent.",
    "Your job is to discover concise docs/schema metadata for exactly one target tool.",
    "Do not assume the target tool or any external MCP/browser/internet tool is available unless it appears in Allowed tools below.",
    "Use only explicitly allowed tools. If only scaler_tool_schema is allowed, record known local metadata or mark uncertainty in notes without probing external systems.",
    "Complete by calling the structured `scaler_tool_schema` tool exactly once with toolName, source, description/risk/docs/schema refs, notes, evidence refs, and discoveredByAgentId when known.",
    "Do not rely on free-form prose as the completion signal; SCALER ingests only structured schema records.",
    `Target tool/MCP: ${toolName}`,
    `Allowed tools: ${allowedTools.join(", ")}`,
    existing,
  ].join("\n");
}

export function buildToolAgentPrompt(record: ToolRequestRecord, discoveredRecords: ToolSchemaRecord[] = []): string {
  const context = record.contextSummary ? `\nContext summary:\n${record.contextSummary}\n` : "";
  const metadata = [
    record.requesterAgentId ? `Requester agent id: ${record.requesterAgentId}` : undefined,
    record.expectedOutput ? `Expected output: ${record.expectedOutput}` : undefined,
    record.requiredFormat ? `Required format: ${record.requiredFormat}` : undefined,
    `Risk level: ${record.riskLevel}`,
    record.permissionRequirement ? `Permission requirement: ${record.permissionRequirement}` : undefined,
    record.safetyNotes ? `Safety notes: ${record.safetyNotes}` : undefined,
  ].filter((line): line is string => Boolean(line));
  return [
    "You are an isolated SCALER tool agent.",
    "Use only the explicitly allowed tool(s) for this request.",
    "Do not assume access to unrelated tools or MCP servers.",
    "If tool usage is uncertain, inspect available schema/help first.",
    "Prefer dry-run/read-only behavior for risky actions when possible.",
    "Complete the request by calling the structured `scaler_tool_result` tool exactly once with requestId, status, summary, outputs/evidence, validation performed, and any errors.",
    "Do not rely on free-form prose as the completion signal; SCALER ingests only structured tool results.",
    `Tool request id: ${record.id}`,
    `Requested tool/MCP: ${record.toolName}`,
    `Allowed tools: ${record.allowedTools.join(", ")}`,
    formatToolCatalog(getToolCatalogEntries(record.allowedTools, discoveredRecords)),
    metadata.join("\n"),
    context.trimEnd(),
    `Request:\n${record.request}`,
  ]
    .filter((part) => part.length > 0)
    .join("\n\n");
}

async function rejectToolRequest(
  cwd: string,
  state: ScalerState,
  input: ToolRequestInput,
  message: string,
): Promise<ToolRequestPrepareResult> {
  await appendLogEvent(
    cwd,
    createLogEvent(state, {
      eventType: "tool",
      summary: message,
      taskId: input.taskId,
      details: input,
    }),
  );
  return { accepted: false, message };
}

async function writeToolRequestIndex(cwd: string, requests: ToolRequestRecord[]): Promise<void> {
  const path = getToolRequestsIndexPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ version: 1, requests } satisfies ToolRequestIndex, null, 2)}\n`, "utf8");
}

async function writeToolResultIndex(cwd: string, results: ToolResultRecord[]): Promise<void> {
  const path = getToolResultsPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  const sorted = [...results].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  await writeFile(path, `${JSON.stringify({ version: 1, results: sorted } satisfies ToolResultIndex, null, 2)}\n`, "utf8");
}

async function writeToolTransactionIndex(cwd: string, transactions: ToolTransactionRecord[]): Promise<void> {
  const path = getToolTransactionsPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  const sorted = [...transactions].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  await writeFile(path, `${JSON.stringify({ version: 1, transactions: sorted } satisfies ToolTransactionIndex, null, 2)}\n`, "utf8");
}

async function writeToolSchemaIndex(cwd: string, records: ToolSchemaRecord[]): Promise<void> {
  const path = getToolCatalogPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  const sorted = [...records].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  await writeFile(path, `${JSON.stringify({ version: 1, records: sorted } satisfies ToolSchemaIndex, null, 2)}\n`, "utf8");
}

async function writeToolSchemaDiscoveryRunIndex(cwd: string, runs: ToolSchemaDiscoveryRunRecord[]): Promise<void> {
  const path = getToolSchemaDiscoveryRunsPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  const sorted = [...runs].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  await writeFile(path, `${JSON.stringify({ version: 1, runs: sorted } satisfies ToolSchemaDiscoveryRunIndex, null, 2)}\n`, "utf8");
}

async function writeToolIterationRunIndex(cwd: string, runs: ToolIterationRunRecord[]): Promise<void> {
  const path = getToolIterationRunsPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  const sorted = [...runs].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  await writeFile(path, `${JSON.stringify({ version: 1, runs: sorted } satisfies ToolIterationRunIndex, null, 2)}\n`, "utf8");
}

async function recordToolSchemaDiscoveryRun(
  cwd: string,
  input: {
    toolName: string;
    status: ToolSchemaDiscoveryRunStatus;
    executed: boolean;
    allowedTools: string[];
    invocation: TaskAgentInvocation;
    runResult?: TaskAgentRunResult;
    schemaRecordId?: string;
    message: string;
  },
  now = new Date(),
): Promise<ToolSchemaDiscoveryRunRecord> {
  const timestamp = now.toISOString();
  const record: ToolSchemaDiscoveryRunRecord = {
    id: randomUUID(),
    toolName: input.toolName,
    status: input.status,
    executed: input.executed,
    allowedTools: input.allowedTools,
    invocation: input.invocation,
    runExitCode: input.runResult?.exitCode,
    stdoutEventCount: input.runResult?.stdoutEvents.length,
    stderrSummary: input.runResult ? summarizeOutput(input.runResult.stderr) : undefined,
    schemaRecordId: input.schemaRecordId,
    usage: input.runResult?.usage,
    message: input.message,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await writeToolSchemaDiscoveryRunIndex(cwd, [record, ...(await loadToolSchemaDiscoveryRuns(cwd))]);
  return record;
}

async function recordToolIterationRun(
  cwd: string,
  input: {
    request?: ToolRequestRecord;
    status: ToolIterationRunStatus;
    executed: boolean;
    maxIterations: number;
    autoReplay: boolean;
    steps: ToolIterationStepRecord[];
    finalRequestStatus?: ToolRequestStatus;
    message: string;
  },
  now = new Date(),
): Promise<ToolIterationRunRecord> {
  const timestamp = now.toISOString();
  const record: ToolIterationRunRecord = {
    id: randomUUID(),
    requestId: input.request?.id,
    taskId: input.request?.taskId,
    toolName: input.request?.toolName,
    status: input.status,
    executed: input.executed,
    maxIterations: input.maxIterations,
    autoReplay: input.autoReplay,
    steps: input.steps,
    finalRequestStatus: input.finalRequestStatus,
    message: input.message,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await writeToolIterationRunIndex(cwd, [record, ...(await loadToolIterationRuns(cwd))]);
  return record;
}

function latestToolSchemaRecords(records: ToolSchemaRecord[]): Map<string, ToolSchemaRecord> {
  const sorted = [...records].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const latest = new Map<string, ToolSchemaRecord>();
  for (const record of sorted) {
    if (!latest.has(record.toolName)) latest.set(record.toolName, record);
  }
  return latest;
}

async function selectRunnableToolRequest(cwd: string, requestId?: string): Promise<ToolRequestRecord | undefined> {
  const requests = await loadToolRequests(cwd);
  const prepared = requests.filter((request) => request.status === "prepared");
  if (requestId) return prepared.find((request) => request.id === requestId.trim());
  return prepared.sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0];
}

async function recordToolTransaction(
  cwd: string,
  request: ToolRequestRecord,
  input: {
    status: ToolTransactionStatus;
    executed: boolean;
    invocation: TaskAgentInvocation;
    runResult?: TaskAgentRunResult;
    resultId?: string;
    replayOfTransactionId?: string;
    message: string;
  },
  now = new Date(),
): Promise<ToolTransactionRecord> {
  const timestamp = now.toISOString();
  const record: ToolTransactionRecord = {
    id: randomUUID(),
    requestId: request.id,
    taskId: request.taskId,
    toolName: request.toolName,
    status: input.status,
    executed: input.executed,
    invocation: input.invocation,
    runExitCode: input.runResult?.exitCode,
    stdoutEventCount: input.runResult?.stdoutEvents.length,
    stderrSummary: input.runResult ? summarizeOutput(input.runResult.stderr) : undefined,
    resultId: input.resultId,
    usage: input.runResult?.usage,
    replayOfTransactionId: input.replayOfTransactionId,
    message: input.message,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await writeToolTransactionIndex(cwd, [record, ...(await loadToolTransactions(cwd))]);
  return record;
}

function reconstructReplayTaskRequest(transaction: ToolTransactionRecord, cwd: string): { taskId: string; prompt: string; tools: string[]; cwd: string } {
  const prompt = transaction.invocation.args[transaction.invocation.args.length - 1] ?? "";
  const toolsArgIndex = transaction.invocation.args.indexOf("--tools");
  const tools = toolsArgIndex >= 0 ? uniqueNonEmpty((transaction.invocation.args[toolsArgIndex + 1] ?? "").split(",")) : [];
  return {
    taskId: `tool-${transaction.requestId}`,
    prompt,
    tools,
    cwd: transaction.invocation.cwd ?? cwd,
  };
}

function normalizeToolResultStatus(value: unknown): ToolResultStatus {
  if (typeof value !== "string") throw new Error("Tool result rejected: status is required.");
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!toolResultStatuses.has(normalized as ToolResultStatus)) throw new Error(`Tool result rejected: invalid status ${value}.`);
  return normalized as ToolResultStatus;
}

function normalizeToolIterationPolicy(value: Partial<ToolIterationPolicy>): ToolIterationPolicy {
  return {
    version: 1,
    maxIterations: clampIterationLimit(value.maxIterations),
    autoReplay: typeof value.autoReplay === "boolean" ? value.autoReplay : true,
    updatedAt: value.updatedAt,
  };
}

function clampIterationLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 3;
  return Math.min(10, Math.max(1, Math.trunc(value)));
}

async function latestMissingResultTransaction(cwd: string, requestId: string): Promise<ToolTransactionRecord | undefined> {
  return (await loadToolTransactions(cwd))
    .filter((transaction) => transaction.requestId === requestId && transaction.status === "missing_result")
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
}

function toolIterationStep(
  iteration: number,
  action: ToolIterationStepAction,
  result: ToolRequestRunResult | ToolTransactionReplayResult,
): ToolIterationStepRecord {
  return {
    iteration,
    action,
    accepted: result.accepted,
    transactionId: result.transaction?.id,
    transactionStatus: result.transaction?.status,
    resultId: result.resultRecord?.id,
    message: result.message,
  };
}

function mapToolRequestStatusToIterationStatus(status: ToolRequestStatus | undefined): ToolIterationRunStatus {
  if (status === "completed" || status === "failed" || status === "blocked") return status;
  return status === "prepared" ? "missing_result" : "rejected";
}

function uniqueNonEmpty(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

function summarizeOutput(output: string, limit = 2_000): string {
  const normalized = output.trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit)}\n...[truncated ${normalized.length - limit} chars]`;
}

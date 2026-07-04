import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { appendLogEvent, createLogEvent } from "./logging.js";
import { getToolRequestsIndexPath, getToolResultsPath } from "./paths.js";
import { buildTaskAgentInvocation, type TaskAgentInvocation } from "./subagents.js";
import type { ScalerState } from "./types.js";

export type ToolRiskLevel = "low" | "medium" | "high" | "destructive" | "external" | "secret" | "unknown";

export interface ToolCatalogEntry {
  name: string;
  description: string;
  riskLevel: ToolRiskLevel;
  docsAvailable: boolean;
  schemaAvailable: boolean;
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

export interface ToolRequestPrepareResult {
  accepted: boolean;
  message: string;
  record?: ToolRequestRecord;
  prompt?: string;
  invocation?: TaskAgentInvocation;
}

interface ToolRequestIndex {
  version: 1;
  requests: ToolRequestRecord[];
}

interface ToolResultIndex {
  version: 1;
  results: ToolResultRecord[];
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

export function getToolCatalogEntries(toolNames: string[]): ToolCatalogEntry[] {
  const catalog = getDefaultToolCatalog();
  const requested = uniqueNonEmpty(toolNames);
  return requested.map((name) => catalog.find((entry) => entry.name === name) ?? {
    name,
    description: "Requested tool/MCP; full docs/schema may be inspected by the isolated tool agent if available.",
    riskLevel: "unknown",
    docsAvailable: false,
    schemaAvailable: false,
  });
}

export function formatToolCatalog(entries: ToolCatalogEntry[]): string {
  if (entries.length === 0) return "Tool catalog: none";
  return [
    "Tool catalog:",
    ...entries.map((entry) => `- ${entry.name}: ${entry.description} risk=${entry.riskLevel} docs=${entry.docsAvailable ? "yes" : "no"} schema=${entry.schemaAvailable ? "yes" : "no"}`),
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
  const prompt = buildToolAgentPrompt(record);
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

export function buildToolAgentPrompt(record: ToolRequestRecord): string {
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
    formatToolCatalog(getToolCatalogEntries(record.allowedTools)),
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

function normalizeToolResultStatus(value: unknown): ToolResultStatus {
  if (typeof value !== "string") throw new Error("Tool result rejected: status is required.");
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!toolResultStatuses.has(normalized as ToolResultStatus)) throw new Error(`Tool result rejected: invalid status ${value}.`);
  return normalized as ToolResultStatus;
}

function uniqueNonEmpty(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { appendLogEvent, createLogEvent } from "./logging.js";
import { getToolRequestsIndexPath } from "./paths.js";
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
  status: "prepared";
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

const toolRiskLevels = new Set<ToolRiskLevel>(["low", "medium", "high", "destructive", "external", "secret", "unknown"]);

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
    "Return a concise report with exact tool request, result, validation performed, and any failure.",
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

function uniqueNonEmpty(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

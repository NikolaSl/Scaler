import type { ScalerState } from "./types.js";

export interface ParsedTaskCreateArgs {
  taskId: string;
  title?: string;
  allowedPathPrefixes?: string[];
  dependsOn?: string[];
  prdRefs?: string[];
}

export interface ParsedTaskUpdateArgs {
  taskId: string;
  title?: string;
  status?: string;
  allowedPathPrefixes?: string[];
  dependsOn?: string[];
  prdRefs?: string[];
}

export interface ParsedTaskRetryArgs {
  taskId?: string;
  reason?: string;
}

export interface ParsedValidationAddArgs {
  taskId: string;
  id: string;
  command: string;
  description?: string;
  required?: boolean;
  gate?: string;
  expectedResult?: string;
  evidenceRefs?: string[];
}

export interface ParsedValidateLoopArgs {
  taskId?: string;
  execute: boolean;
  maxSteps?: number;
}

export interface ParsedBudgetSetArgs {
  key: string;
  soft?: number;
  hard?: number;
}

export interface ParsedStorageMaintainArgs {
  execute: boolean;
  compress: boolean;
  deleteCache: boolean;
  minAgeDays?: number;
  minSizeBytes?: number;
}

export interface ParsedPrdLinkArgs {
  taskId: string;
  prdRefs: string[];
}

export interface ParsedCommitArgs {
  taskId?: string;
  allowedPathPrefixes?: string[];
}

export interface ParsedReplanRequestArgs {
  reason: string;
  taskId?: string;
  evidenceRefs?: string[];
  requirementRefs?: string[];
}

export interface ParsedReplanRunArgs {
  execute: boolean;
}

export interface ParsedResearchRequestArgs {
  question: string;
  reason?: string;
  taskId?: string;
  requirementRefs?: string[];
  scope?: string;
}

export interface ParsedResearchRunArgs {
  requestId?: string;
  execute: boolean;
  allowInternet: boolean;
  tools?: string[];
}

export interface ParsedToolRunArgs {
  requestId?: string;
  execute: boolean;
}

export interface ParsedToolCatalogArgs {
  toolName?: string;
}

export interface ParsedToolDiscoverArgs {
  toolName?: string;
  execute: boolean;
  tools?: string[];
}

export interface ParsedDebugRunArgs {
  taskId?: string;
  execute: boolean;
}

export interface ParsedDebugRetryArgs {
  taskId?: string;
  execute: boolean;
}

export interface ParsedDebugLoopArgs {
  taskId?: string;
  execute: boolean;
  maxSteps?: number;
}

export interface ParsedResearchReportArgs {
  question: string;
  conclusion: string;
  confidence?: string;
  sourceId?: string;
  sourceTitle?: string;
  sourceQuality?: string;
  sourceRef?: string;
  requestId?: string;
  taskId?: string;
  requirementRefs?: string[];
}

export interface ParsedContextTaskArgs {
  taskId?: string;
}

export interface ParsedStageRecordArgs {
  stage: string;
  status?: string;
  title?: string;
  path?: string;
  summary?: string;
  evidenceRefs?: string[];
  requirementRefs?: string[];
  taskRefs?: string[];
}

export interface ParsedStageRunArgs {
  stage?: string;
  execute: boolean;
}

export interface ParsedStageLoopArgs {
  execute: boolean;
  maxSteps?: number;
}

export function parseTaskCreateArgs(args: string | undefined): ParsedTaskCreateArgs | undefined {
  const parts = splitPipeArgs(args);
  const taskId = parts[0]?.trim();
  if (!taskId) return undefined;

  return {
    taskId,
    title: parts[1]?.trim() || undefined,
    allowedPathPrefixes: parseCommaList(parts[2]),
    dependsOn: parseCommaList(parts[3]),
    prdRefs: parseCommaList(parts[4]),
  };
}

export function parseTaskUpdateArgs(args: string | undefined): ParsedTaskUpdateArgs | undefined {
  const parts = splitPipeArgs(args);
  const taskId = parts[0]?.trim();
  if (!taskId) return undefined;
  return {
    taskId,
    title: parts[1]?.trim() || undefined,
    status: parts[2]?.trim() || undefined,
    allowedPathPrefixes: parseCommaList(parts[3]),
    dependsOn: parseCommaList(parts[4]),
    prdRefs: parseCommaList(parts[5]),
  };
}

export function parseTaskRetryArgs(args: string | undefined): ParsedTaskRetryArgs {
  const parts = splitPipeArgs(args);
  return {
    taskId: parts[0]?.trim() || undefined,
    reason: parts[1]?.trim() || undefined,
  };
}

export function parseValidationAddArgs(args: string | undefined): ParsedValidationAddArgs | undefined {
  const parts = splitPipeArgs(args);
  const taskId = parts[0]?.trim();
  const id = parts[1]?.trim();
  const command = parts[2]?.trim();
  if (!taskId || !id || !command) return undefined;
  return {
    taskId,
    id,
    command,
    description: parts[3]?.trim() || undefined,
    required: parseOptionalBoolean(parts[4]),
    gate: parts[5]?.trim() || undefined,
    expectedResult: parts[6]?.trim() || undefined,
    evidenceRefs: parseCommaList(parts[7]),
  };
}

export function parseValidateLoopArgs(args: string | undefined): ParsedValidateLoopArgs {
  const parts = (args ?? "").trim().split(/\s+/).filter(Boolean);
  const maxPart = parts.find((part) => /^max=\d+$/i.test(part));
  const maxSteps = maxPart ? Number.parseInt(maxPart.split("=")[1] ?? "", 10) : undefined;
  return {
    taskId: parts.find((part) => part.toLowerCase() !== "execute" && !/^max=/i.test(part)),
    execute: parts.some((part) => part.toLowerCase() === "execute"),
    maxSteps: maxSteps === undefined || !Number.isFinite(maxSteps) ? undefined : maxSteps,
  };
}

export function parseBudgetSetArgs(args: string | undefined): ParsedBudgetSetArgs | undefined {
  const parts = splitPipeArgs(args);
  const key = parts[0]?.trim();
  if (!key) return undefined;
  return {
    key,
    soft: parseOptionalNumber(parts[1]),
    hard: parseOptionalNumber(parts[2]),
  };
}

export function parseStorageMaintainArgs(args: string | undefined): ParsedStorageMaintainArgs {
  const parts = (args ?? "").trim().split(/\s+/).filter(Boolean);
  const minAgePart = parts.find((part) => /^min-age-days=\d+$/i.test(part));
  const minSizePart = parts.find((part) => /^min-size=\d+$/i.test(part));
  const minAgeDays = minAgePart ? Number.parseInt(minAgePart.split("=")[1] ?? "", 10) : undefined;
  const minSizeBytes = minSizePart ? Number.parseInt(minSizePart.split("=")[1] ?? "", 10) : undefined;
  return {
    execute: parts.some((part) => part.toLowerCase() === "execute"),
    compress: !parts.some((part) => part.toLowerCase() === "no-compress"),
    deleteCache: parts.some((part) => part.toLowerCase() === "delete-cache"),
    minAgeDays: minAgeDays === undefined || !Number.isFinite(minAgeDays) ? undefined : minAgeDays,
    minSizeBytes: minSizeBytes === undefined || !Number.isFinite(minSizeBytes) ? undefined : minSizeBytes,
  };
}

export function parsePrdLinkArgs(args: string | undefined): ParsedPrdLinkArgs | undefined {
  const parts = splitPipeArgs(args);
  const taskId = parts[0]?.trim();
  const prdRefs = parseCommaList(parts[1]);
  if (!taskId || !prdRefs) return undefined;
  return { taskId, prdRefs };
}

export function parseCommitArgs(args: string | undefined): ParsedCommitArgs {
  const parts = splitPipeArgs(args);
  const taskId = parts[0]?.trim() || undefined;
  return {
    taskId,
    allowedPathPrefixes: parseCommaList(parts[1]),
  };
}

export function parseReplanRequestArgs(args: string | undefined): ParsedReplanRequestArgs | undefined {
  const parts = splitPipeArgs(args);
  const reason = parts[0]?.trim();
  if (!reason) return undefined;
  return {
    reason,
    taskId: parts[1]?.trim() || undefined,
    evidenceRefs: parseCommaList(parts[2]),
    requirementRefs: parseCommaList(parts[3]),
  };
}

export function parseReplanRunArgs(args: string | undefined): ParsedReplanRunArgs {
  const parts = (args ?? "").trim().split(/\s+/).filter(Boolean);
  return { execute: parts.some((part) => part.toLowerCase() === "execute") };
}

export function parseResearchRunArgs(args: string | undefined): ParsedResearchRunArgs {
  const parts = (args ?? "").trim().split(/\s+/).filter(Boolean);
  const optionParts = new Set(parts.filter((part) => part.toLowerCase() === "execute" || part.toLowerCase() === "internet" || /^tools=/i.test(part)));
  const toolsPart = parts.find((part) => /^tools=/i.test(part));
  return {
    requestId: parts.find((part) => !optionParts.has(part)),
    execute: parts.some((part) => part.toLowerCase() === "execute"),
    allowInternet: parts.some((part) => part.toLowerCase() === "internet"),
    tools: parseCommaList(toolsPart?.slice(toolsPart.indexOf("=") + 1)),
  };
}

export function parseToolRunArgs(args: string | undefined): ParsedToolRunArgs {
  const parts = (args ?? "").trim().split(/\s+/).filter(Boolean);
  return {
    requestId: parts.find((part) => part.toLowerCase() !== "execute"),
    execute: parts.some((part) => part.toLowerCase() === "execute"),
  };
}

export function parseToolCatalogArgs(args: string | undefined): ParsedToolCatalogArgs {
  return { toolName: args?.trim() || undefined };
}

export function parseToolDiscoverArgs(args: string | undefined): ParsedToolDiscoverArgs {
  const parts = (args ?? "").trim().split(/\s+/).filter(Boolean);
  const toolsPart = parts.find((part) => /^tools=/i.test(part));
  return {
    toolName: parts.find((part) => part.toLowerCase() !== "execute" && !/^tools=/i.test(part)),
    execute: parts.some((part) => part.toLowerCase() === "execute"),
    tools: parseCommaList(toolsPart?.slice(toolsPart.indexOf("=") + 1)),
  };
}

export function parseDebugRunArgs(args: string | undefined): ParsedDebugRunArgs {
  const parts = (args ?? "").trim().split(/\s+/).filter(Boolean);
  return {
    taskId: parts.find((part) => part.toLowerCase() !== "execute"),
    execute: parts.some((part) => part.toLowerCase() === "execute"),
  };
}

export function parseDebugRetryArgs(args: string | undefined): ParsedDebugRetryArgs {
  const parts = (args ?? "").trim().split(/\s+/).filter(Boolean);
  return {
    taskId: parts.find((part) => part.toLowerCase() !== "execute"),
    execute: parts.some((part) => part.toLowerCase() === "execute"),
  };
}

export function parseDebugLoopArgs(args: string | undefined): ParsedDebugLoopArgs {
  const parts = (args ?? "").trim().split(/\s+/).filter(Boolean);
  const maxPart = parts.find((part) => /^max=\d+$/i.test(part));
  const maxSteps = maxPart ? Number.parseInt(maxPart.split("=")[1] ?? "", 10) : undefined;
  return {
    taskId: parts.find((part) => part.toLowerCase() !== "execute" && !/^max=/i.test(part)),
    execute: parts.some((part) => part.toLowerCase() === "execute"),
    maxSteps: maxSteps === undefined || !Number.isFinite(maxSteps) ? undefined : maxSteps,
  };
}

export function parseResearchRequestArgs(args: string | undefined): ParsedResearchRequestArgs | undefined {
  const parts = splitPipeArgs(args);
  const question = parts[0]?.trim();
  if (!question) return undefined;
  return {
    question,
    reason: parts[1]?.trim() || undefined,
    taskId: parts[2]?.trim() || undefined,
    requirementRefs: parseCommaList(parts[3]),
    scope: parts[4]?.trim() || undefined,
  };
}

export function parseResearchReportArgs(args: string | undefined): ParsedResearchReportArgs | undefined {
  const parts = splitPipeArgs(args);
  const question = parts[0]?.trim();
  const conclusion = parts[1]?.trim();
  if (!question || !conclusion) return undefined;
  return {
    question,
    conclusion,
    confidence: parts[2]?.trim() || undefined,
    sourceId: parts[3]?.trim() || undefined,
    sourceTitle: parts[4]?.trim() || undefined,
    sourceQuality: parts[5]?.trim() || undefined,
    sourceRef: parts[6]?.trim() || undefined,
    requestId: parts[7]?.trim() || undefined,
    taskId: parts[8]?.trim() || undefined,
    requirementRefs: parseCommaList(parts[9]),
  };
}

export function parseContextTaskArgs(args: string | undefined): ParsedContextTaskArgs {
  return { taskId: args?.trim() || undefined };
}

export function parseStageRunArgs(args: string | undefined): ParsedStageRunArgs {
  const parts = (args ?? "").trim().split(/\s+/).filter(Boolean);
  return {
    stage: parts[0],
    execute: parts.slice(1).some((part) => part.toLowerCase() === "execute"),
  };
}

export function parseStageLoopArgs(args: string | undefined): ParsedStageLoopArgs {
  const parts = (args ?? "").trim().split(/\s+/).filter(Boolean);
  const maxPart = parts.find((part) => /^max=\d+$/i.test(part));
  const maxSteps = maxPart ? Number.parseInt(maxPart.split("=")[1] ?? "", 10) : undefined;
  return {
    execute: parts.some((part) => part.toLowerCase() === "execute"),
    maxSteps: maxSteps === undefined || !Number.isFinite(maxSteps) ? undefined : maxSteps,
  };
}

export function parseStageRecordArgs(args: string | undefined): ParsedStageRecordArgs | undefined {
  const parts = splitPipeArgs(args);
  const stage = parts[0]?.trim();
  if (!stage) return undefined;
  return {
    stage,
    status: parts[1]?.trim() || undefined,
    title: parts[2]?.trim() || undefined,
    path: parts[3]?.trim() || undefined,
    summary: parts[4]?.trim() || undefined,
    evidenceRefs: parseCommaList(parts[5]),
    requirementRefs: parseCommaList(parts[6]),
    taskRefs: parseCommaList(parts[7]),
  };
}

export function selectTaskForCommit(state: ScalerState, requestedTaskId?: string): string | undefined {
  if (requestedTaskId) return requestedTaskId;
  if (state.currentTaskId && state.tasks.some((task) => task.id === state.currentTaskId && task.status === "validated")) {
    return state.currentTaskId;
  }
  return state.tasks.find((task) => task.status === "validated")?.id;
}

export function resolveCommitAllowedPaths(state: ScalerState, taskId: string, explicitPaths?: string[]): string[] {
  if (explicitPaths && explicitPaths.length > 0) return explicitPaths;
  return state.tasks.find((task) => task.id === taskId)?.allowedPathPrefixes ?? [];
}

export function parseCommaList(value: string | undefined): string[] | undefined {
  const items = (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return items.length > 0 ? items : undefined;
}

function splitPipeArgs(args: string | undefined): string[] {
  return (args ?? "").split("|").map((part) => part.trim());
}

function parseOptionalBoolean(value: string | undefined): boolean | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (["true", "yes", "required", "1"].includes(normalized)) return true;
  if (["false", "no", "optional", "0"].includes(normalized)) return false;
  return undefined;
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  const normalized = value?.trim();
  if (!normalized || normalized === "-") return undefined;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

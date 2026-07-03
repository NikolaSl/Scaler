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

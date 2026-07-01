import type { ScalerState } from "./types.js";

export interface ParsedTaskCreateArgs {
  taskId: string;
  title?: string;
  allowedPathPrefixes?: string[];
  dependsOn?: string[];
}

export interface ParsedTaskUpdateArgs {
  taskId: string;
  title?: string;
  status?: string;
  allowedPathPrefixes?: string[];
  dependsOn?: string[];
}

export interface ParsedValidationAddArgs {
  taskId: string;
  id: string;
  command: string;
  description?: string;
  required?: boolean;
}

export interface ParsedCommitArgs {
  taskId?: string;
  allowedPathPrefixes?: string[];
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

export function parseCommitArgs(args: string | undefined): ParsedCommitArgs {
  const parts = splitPipeArgs(args);
  const taskId = parts[0]?.trim() || undefined;
  return {
    taskId,
    allowedPathPrefixes: parseCommaList(parts[1]),
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

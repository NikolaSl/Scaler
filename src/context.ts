import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { getTaskContextManifestPath } from "./paths.js";
import type { ScalerState } from "./types.js";

export type ContextItemType = "prd" | "knowledge" | "memory" | "file" | "task_report" | "validation" | "tool" | "decision";
export type ContextPriority = "required" | "useful" | "optional";
export type ContextScope = "full" | "section" | "snippet" | "summary" | "reference-only";

export interface ContextItem {
  id: string;
  type: ContextItemType;
  reason: string;
  content: string;
  priority: ContextPriority;
  scope: ContextScope;
  estimatedTokens?: number;
}

export interface ContextResolverInput {
  state: ScalerState;
  taskId?: string;
  taskGoal?: string;
  definitionOfDone?: string;
  items: ContextItem[];
  tokenBudget?: number;
}

export interface ResolvedContext {
  text: string;
  included: ContextItem[];
  omitted: ContextItem[];
  estimatedTokens: number;
}

export type ContextManifestSource = "inline" | "file" | "memory" | "state" | "task" | "prd_refs" | "validation_manifest";

export interface TaskContextManifestItem {
  id: string;
  type: ContextItemType;
  reason: string;
  priority: ContextPriority;
  scope: ContextScope;
  source: ContextManifestSource;
  content?: string;
  path?: string;
  memoryId?: string;
  taskId?: string;
}

export interface TaskContextManifest {
  version: 1;
  taskId: string;
  tokenBudget?: number;
  items: TaskContextManifestItem[];
  createdAt: string;
  updatedAt: string;
}

const priorityOrder: Record<ContextPriority, number> = {
  required: 0,
  useful: 1,
  optional: 2,
};

const contextItemTypes = new Set<ContextItemType>(["prd", "knowledge", "memory", "file", "task_report", "validation", "tool", "decision"]);
const contextPriorities = new Set<ContextPriority>(["required", "useful", "optional"]);
const contextScopes = new Set<ContextScope>(["full", "section", "snippet", "summary", "reference-only"]);
const contextManifestSources = new Set<ContextManifestSource>(["inline", "file", "memory", "state", "task", "prd_refs", "validation_manifest"]);

export function createDefaultTaskContextManifest(state: ScalerState, taskId: string, now = new Date()): TaskContextManifest {
  const timestamp = now.toISOString();
  const task = state.tasks.find((candidate) => candidate.id === taskId);
  const items: TaskContextManifestItem[] = [
    {
      id: "state-summary",
      type: "decision",
      reason: "Current supervisor state and task status are required for safe execution.",
      priority: "required",
      scope: "summary",
      source: "state",
    },
    {
      id: "task-metadata",
      type: "task_report",
      reason: "Task metadata defines scope, dependencies, allowed paths, and PRD links.",
      priority: "required",
      scope: "summary",
      source: "task",
      taskId,
    },
    {
      id: "validation-manifest",
      type: "validation",
      reason: "Validation requirements guide the task definition of done.",
      priority: "useful",
      scope: "summary",
      source: "validation_manifest",
      taskId,
    },
  ];

  if (task?.prdRefs && task.prdRefs.length > 0) {
    items.push({
      id: "runtime-prd-refs",
      type: "prd",
      reason: "Runtime PRD requirement ids link the task to validated product requirements.",
      priority: "useful",
      scope: "reference-only",
      source: "prd_refs",
      taskId,
    });
  }

  for (const memoryId of state.memoryRefs) {
    items.push({
      id: `memory-${memoryId}`,
      type: "memory",
      reason: "Supervisor memory reference may contain relevant prior context.",
      priority: "optional",
      scope: "summary",
      source: "memory",
      memoryId,
    });
  }

  return { version: 1, taskId, tokenBudget: 8_000, items, createdAt: timestamp, updatedAt: timestamp };
}

export async function loadTaskContextManifest(cwd: string, taskId: string): Promise<TaskContextManifest | undefined> {
  try {
    const raw = await readFile(getTaskContextManifestPath(cwd, taskId), "utf8");
    const manifest = JSON.parse(raw) as TaskContextManifest;
    validateTaskContextManifest(manifest);
    return manifest;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function saveTaskContextManifest(cwd: string, manifest: TaskContextManifest, now = new Date()): Promise<TaskContextManifest> {
  const normalized: TaskContextManifest = {
    ...manifest,
    updatedAt: now.toISOString(),
    items: manifest.items.map((item) => ({
      ...item,
      id: item.id.trim(),
      reason: item.reason.trim(),
      content: item.content?.trim() || undefined,
      path: item.path?.trim() || undefined,
      memoryId: item.memoryId?.trim() || undefined,
      taskId: item.taskId?.trim() || undefined,
    })),
  };
  validateTaskContextManifest(normalized);
  const path = getTaskContextManifestPath(cwd, normalized.taskId);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return normalized;
}

export async function ensureTaskContextManifest(cwd: string, state: ScalerState, taskId: string): Promise<TaskContextManifest> {
  const existing = await loadTaskContextManifest(cwd, taskId);
  if (existing) return existing;
  return await saveTaskContextManifest(cwd, createDefaultTaskContextManifest(state, taskId));
}

export function validateTaskContextManifest(manifest: TaskContextManifest): void {
  if (manifest.version !== 1) throw new Error(`Unsupported task context manifest version: ${String(manifest.version)}`);
  if (!manifest.taskId.trim()) throw new Error("Task context manifest taskId is required.");
  const ids = new Set<string>();
  for (const item of manifest.items) validateTaskContextManifestItem(item, ids);
}

export function formatTaskContextManifest(manifest: TaskContextManifest): string {
  validateTaskContextManifest(manifest);
  const lines = [`Task context manifest: ${manifest.taskId} items=${manifest.items.length} tokenBudget=${manifest.tokenBudget ?? "default"}`];
  for (const item of manifest.items) {
    lines.push(`- ${item.id}: ${item.source}/${item.type} ${item.priority} ${item.scope} reason=${item.reason}`);
  }
  return lines.join("\n");
}

function validateTaskContextManifestItem(item: TaskContextManifestItem, ids: Set<string>): void {
  if (!item.id.trim()) throw new Error("Task context item id is required.");
  if (ids.has(item.id)) throw new Error(`Duplicate task context item id: ${item.id}`);
  ids.add(item.id);
  if (!contextItemTypes.has(item.type)) throw new Error(`Invalid task context item type: ${String(item.type)}`);
  if (!contextPriorities.has(item.priority)) throw new Error(`Invalid task context item priority: ${String(item.priority)}`);
  if (!contextScopes.has(item.scope)) throw new Error(`Invalid task context item scope: ${String(item.scope)}`);
  if (!contextManifestSources.has(item.source)) throw new Error(`Invalid task context item source: ${String(item.source)}`);
  if (!item.reason.trim()) throw new Error(`Task context item ${item.id} reason is required.`);
  if (item.source === "inline" && !item.content?.trim()) throw new Error(`Task context item ${item.id} inline content is required.`);
  if (item.source === "file" && !item.path?.trim()) throw new Error(`Task context item ${item.id} file path is required.`);
  if (item.source === "memory" && !item.memoryId?.trim()) throw new Error(`Task context item ${item.id} memoryId is required.`);
}

export function resolveContext(input: ContextResolverInput): ResolvedContext {
  const budget = input.tokenBudget ?? 8_000;
  const sorted = [...input.items].sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
  const included: ContextItem[] = [];
  const omitted: ContextItem[] = [];
  let used = estimateTokens(buildHeader(input));

  for (const item of sorted) {
    const itemTokens = getEstimatedTokens(item);
    if (item.priority !== "required" && used + itemTokens > budget) {
      omitted.push(item);
      continue;
    }
    included.push(item);
    used += itemTokens;
  }

  const sections = [buildHeader(input), ...included.map(formatContextItem)];
  if (omitted.length > 0) {
    const omittedSummary = formatOmittedContextSummary(omitted);
    sections.push(omittedSummary);
    used += estimateTokens(omittedSummary);
  }

  const text = sections.join("\n\n");
  return { text, included, omitted, estimatedTokens: used };
}

export function formatContextItem(item: ContextItem): string {
  return [
    `## Context: ${item.id}`,
    `Type: ${item.type}`,
    `Priority: ${item.priority}`,
    `Scope: ${item.scope}`,
    `Reason: ${item.reason}`,
    "",
    item.content,
  ].join("\n");
}

export function formatOmittedContextSummary(items: ContextItem[]): string {
  return [
    "## Omitted Context",
    "The following context items were omitted due to the token budget. Request them explicitly if needed.",
    ...items.map((item) => `- ${item.id}: ${item.reason} (${item.type}, ${item.priority}, ${item.scope})`),
  ].join("\n");
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function buildHeader(input: ContextResolverInput): string {
  const lines = [
    "# SCALER Resolved Task Context",
    `Stage: ${input.state.stage}`,
    `Validated tasks: ${input.state.validatedTaskIds.length}/${input.state.tasks.length}`,
  ];

  if (input.taskId) lines.push(`Task: ${input.taskId}`);
  if (input.taskGoal) lines.push(`Goal: ${input.taskGoal}`);
  if (input.definitionOfDone) lines.push(`Definition of Done: ${input.definitionOfDone}`);

  return lines.join("\n");
}

function getEstimatedTokens(item: ContextItem): number {
  return item.estimatedTokens ?? estimateTokens(formatContextItem(item));
}

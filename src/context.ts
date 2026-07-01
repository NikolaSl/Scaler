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

const priorityOrder: Record<ContextPriority, number> = {
  required: 0,
  useful: 1,
  optional: 2,
};

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

  const text = [buildHeader(input), ...included.map(formatContextItem)].join("\n\n");
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

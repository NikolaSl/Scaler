import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";
import { getGitChangedPaths } from "./git.js";
import { loadMemoryIndex, retrieveMemory, type MemoryEntry } from "./memory.js";
import { loadExecutionPlan, type ExecutionPlanTask } from "./plans.js";
import { getTaskContextManifestPath } from "./paths.js";
import { computePrdCoverageSummary, loadPrdCoverage, loadPrdRequirements } from "./prd.js";
import { getValidationManifestForTask, loadValidationRuns, type ValidationRunRecord } from "./validation.js";
import type { ScalerState, ScalerTaskState } from "./types.js";

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

export async function createDiscoveredTaskContextManifest(
  cwd: string,
  state: ScalerState,
  taskId: string,
  now = new Date(),
): Promise<TaskContextManifest> {
  const base = createDefaultTaskContextManifest(state, taskId, now);
  const existingIds = new Set(base.items.map((item) => item.id));
  const existingMemoryIds = new Set(base.items.map((item) => item.memoryId).filter((id): id is string => Boolean(id)));
  const discovered = await discoverTaskContextItems(cwd, state, taskId, existingIds, existingMemoryIds);
  const manifest = { ...base, items: [...base.items, ...discovered] };
  validateTaskContextManifest(manifest);
  return manifest;
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
  return await saveTaskContextManifest(cwd, await createDiscoveredTaskContextManifest(cwd, state, taskId));
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

export async function resolveTaskContextManifest(
  cwd: string,
  state: ScalerState,
  manifest: TaskContextManifest,
): Promise<ContextItem[]> {
  validateTaskContextManifest(manifest);
  const items: ContextItem[] = [];
  for (const entry of manifest.items) {
    items.push(await resolveManifestItem(cwd, state, manifest, entry));
  }
  return items;
}

async function resolveManifestItem(
  cwd: string,
  state: ScalerState,
  manifest: TaskContextManifest,
  entry: TaskContextManifestItem,
): Promise<ContextItem> {
  try {
    return {
      id: entry.id,
      type: entry.type,
      reason: entry.reason,
      priority: entry.priority,
      scope: entry.scope,
      content: await resolveManifestItemContent(cwd, state, manifest, entry),
    };
  } catch (error) {
    return {
      id: entry.id,
      type: entry.type,
      reason: `${entry.reason} (missing: ${(error as Error).message})`,
      priority: entry.priority === "required" ? "required" : "optional",
      scope: "reference-only",
      content: `MISSING CONTEXT: ${entry.id}\nSource: ${entry.source}\nReason: ${(error as Error).message}`,
    };
  }
}

async function resolveManifestItemContent(
  cwd: string,
  state: ScalerState,
  manifest: TaskContextManifest,
  entry: TaskContextManifestItem,
): Promise<string> {
  if (entry.source === "inline") return entry.content ?? "";
  if (entry.source === "file") return await readFile(resolveContextPath(cwd, entry.path!), "utf8");
  if (entry.source === "memory") return (await retrieveMemory(cwd, entry.memoryId!)).content;
  if (entry.source === "state") return formatStateContext(state);
  if (entry.source === "task") return formatTaskContext(state, entry.taskId ?? manifest.taskId);
  if (entry.source === "prd_refs") return formatPrdRefsContext(state, entry.taskId ?? manifest.taskId);
  if (entry.source === "validation_manifest") {
    const validationManifest = await getValidationManifestForTask(cwd, entry.taskId ?? manifest.taskId);
    return JSON.stringify(validationManifest, null, 2);
  }
  return "";
}

function resolveContextPath(cwd: string, path: string): string {
  return isAbsolute(path) ? path : join(cwd, path);
}

function formatStateContext(state: ScalerState): string {
  return JSON.stringify({
    runId: state.runId,
    stage: state.stage,
    currentTaskId: state.currentTaskId,
    taskCount: state.tasks.length,
    validatedTaskIds: state.validatedTaskIds,
    blockers: state.blockers,
    memoryRefs: state.memoryRefs,
  }, null, 2);
}

function formatTaskContext(state: ScalerState, taskId: string): string {
  const task = state.tasks.find((candidate) => candidate.id === taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  return JSON.stringify(task, null, 2);
}

function formatPrdRefsContext(state: ScalerState, taskId: string): string {
  const task = state.tasks.find((candidate) => candidate.id === taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  const refs = task.prdRefs ?? [];
  return refs.length > 0 ? `Runtime PRD refs for ${taskId}: ${refs.join(", ")}` : `Runtime PRD refs for ${taskId}: none`;
}

async function discoverTaskContextItems(
  cwd: string,
  state: ScalerState,
  taskId: string,
  existingIds: Set<string>,
  existingMemoryIds: Set<string>,
): Promise<TaskContextManifestItem[]> {
  const task = state.tasks.find((candidate) => candidate.id === taskId);
  const items: TaskContextManifestItem[] = [];
  const add = (item: TaskContextManifestItem): void => {
    if (existingIds.has(item.id)) return;
    existingIds.add(item.id);
    items.push(item);
  };

  for (const item of await discoverChangedFileItems(cwd, task)) add(item);
  const planItem = await discoverExecutionPlanItem(cwd, taskId);
  if (planItem) add(planItem);
  const prdItem = await discoverPrdCoverageItem(cwd, state, task);
  if (prdItem) add(prdItem);
  const validationItem = await discoverValidationHistoryItem(cwd, taskId);
  if (validationItem) add(validationItem);
  for (const item of await discoverMemoryItems(cwd, task, existingMemoryIds)) add(item);

  return items;
}

async function discoverChangedFileItems(cwd: string, task: ScalerTaskState | undefined): Promise<TaskContextManifestItem[]> {
  const changedPaths = (await getGitChangedPaths(cwd)).filter((path) => !isRuntimePath(path));
  if (changedPaths.length === 0) return [];

  const allowed = changedPaths.filter((path) => taskPathMatches(path, task?.allowedPathPrefixes ?? []));
  const candidates = [...allowed, ...changedPaths.filter((path) => !allowed.includes(path))];
  const items: TaskContextManifestItem[] = [
    {
      id: "git-changed-files",
      type: "decision",
      reason: "Git changed paths are relevant for avoiding stale or unrelated task context.",
      priority: allowed.length > 0 ? "useful" : "optional",
      scope: "summary",
      source: "inline",
      content: `Changed paths:\n${changedPaths.map((path) => `- ${path}`).join("\n")}`,
    },
  ];

  for (const path of candidates.slice(0, 5)) {
    if (!(await isReadableFile(cwd, path))) continue;
    const matchesAllowedPath = taskPathMatches(path, task?.allowedPathPrefixes ?? []);
    items.push({
      id: `changed-file-${slugify(path)}`,
      type: "file",
      reason: matchesAllowedPath
        ? "Changed file matches this task's allowed path prefixes."
        : "Changed file may affect the current task and is included with lower priority.",
      priority: matchesAllowedPath ? "useful" : "optional",
      scope: "snippet",
      source: "file",
      path,
    });
  }

  return items;
}

async function discoverExecutionPlanItem(cwd: string, taskId: string): Promise<TaskContextManifestItem | undefined> {
  const plan = await loadExecutionPlan(cwd);
  const planTask = plan.tasks.find((candidate) => candidate.id === taskId);
  if (!planTask) return undefined;
  return {
    id: "execution-plan-task",
    type: "task_report",
    reason: "Current execution plan entry provides planner intent, dependencies, PRD refs, allowed paths, and validation refs.",
    priority: "useful",
    scope: "summary",
    source: "inline",
    content: JSON.stringify(formatPlanTaskContext(planTask, plan.planVersion), null, 2),
  };
}

async function discoverPrdCoverageItem(
  cwd: string,
  state: ScalerState,
  task: ScalerTaskState | undefined,
): Promise<TaskContextManifestItem | undefined> {
  const prdRefs = task?.prdRefs ?? [];
  if (prdRefs.length === 0) return undefined;
  const requirements = await loadPrdRequirements(cwd);
  if (requirements.requirements.length === 0) return undefined;
  const coverage = await loadPrdCoverage(cwd);
  const summary = computePrdCoverageSummary(requirements, coverage, state);
  const content = {
    taskId: task?.id,
    requirementRefs: prdRefs,
    requirements: requirements.requirements.filter((requirement) => prdRefs.includes(requirement.id)),
    coverage: summary.entries.filter((entry) => prdRefs.includes(entry.requirementId)),
  };
  return {
    id: "runtime-prd-coverage",
    type: "prd",
    reason: "Runtime PRD coverage links this task to current requirement status and evidence.",
    priority: "useful",
    scope: "summary",
    source: "inline",
    content: JSON.stringify(content, null, 2),
  };
}

async function discoverValidationHistoryItem(cwd: string, taskId: string): Promise<TaskContextManifestItem | undefined> {
  const runs = (await loadValidationRuns(cwd))
    .filter((run) => run.taskId === taskId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 3);
  if (runs.length === 0) return undefined;
  return {
    id: "validation-history",
    type: "validation",
    reason: "Recent validation history helps avoid repeating known failures and confirms latest checks.",
    priority: "useful",
    scope: "summary",
    source: "inline",
    content: JSON.stringify(runs.map(formatValidationRunContext), null, 2),
  };
}

async function discoverMemoryItems(
  cwd: string,
  task: ScalerTaskState | undefined,
  existingMemoryIds: Set<string>,
): Promise<TaskContextManifestItem[]> {
  if (!task) return [];
  const terms = buildTaskSearchTerms(task);
  if (terms.length === 0) return [];
  const index = await loadMemoryIndex(cwd);
  return index.entries
    .map((entry) => ({ entry, score: scoreMemoryEntry(entry, task, terms) }))
    .filter(({ entry, score }) => score > 0 && entry.validity !== "obsolete" && !existingMemoryIds.has(entry.id))
    .sort((a, b) => b.score - a.score || b.entry.updatedAt.localeCompare(a.entry.updatedAt) || a.entry.id.localeCompare(b.entry.id))
    .slice(0, 3)
    .map(({ entry, score }) => ({
      id: `memory-search-${entry.id}`,
      type: "memory",
      reason: `Memory matched task relevance terms with score ${score}.`,
      priority: score >= 4 ? "useful" : "optional",
      scope: "summary",
      source: "memory",
      memoryId: entry.id,
    }));
}

function formatPlanTaskContext(task: ExecutionPlanTask, planVersion: number): Record<string, unknown> {
  return { planVersion, task };
}

function formatValidationRunContext(run: ValidationRunRecord): Record<string, unknown> {
  return {
    id: run.id,
    taskId: run.taskId,
    status: run.status,
    createdAt: run.createdAt,
    commandRuns: run.commandRuns.map((command) => ({
      commandId: command.commandId,
      command: command.command,
      status: command.status,
      exitCode: command.exitCode,
      stdoutSummary: command.stdoutSummary,
      stderrSummary: command.stderrSummary,
    })),
  };
}

function buildTaskSearchTerms(task: ScalerTaskState): string[] {
  return unique([
    task.id,
    ...(task.title?.split(/\W+/) ?? []),
    ...(task.prdRefs ?? []),
    ...(task.allowedPathPrefixes ?? []).flatMap((path) => path.split(/[^a-zA-Z0-9]+/)),
  ].map((term) => term.toLowerCase()).filter((term) => term.length >= 3));
}

function scoreMemoryEntry(entry: MemoryEntry, task: ScalerTaskState, terms: string[]): number {
  const haystack = [entry.id, entry.title, entry.summary, entry.source, entry.path, entry.taskId].filter(Boolean).join(" ").toLowerCase();
  let score = entry.taskId === task.id ? 5 : 0;
  for (const term of terms) {
    if (haystack.includes(term)) score += 1;
  }
  if (entry.validity === "active") score += 1;
  if (entry.validity === "stale") score -= 1;
  return score;
}

async function isReadableFile(cwd: string, path: string): Promise<boolean> {
  try {
    return (await stat(resolveContextPath(cwd, path))).isFile();
  } catch {
    return false;
  }
}

function taskPathMatches(path: string, allowedPathPrefixes: string[]): boolean {
  return allowedPathPrefixes.some((prefix) => {
    const normalized = prefix.replace(/^\.\//, "").replace(/\/$/, "");
    return path === normalized || path.startsWith(`${normalized}/`);
  });
}

function isRuntimePath(path: string): boolean {
  return path === ".scaler" || path.startsWith(".scaler/");
}

function slugify(value: string): string {
  return (basename(value) || value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "item";
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
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

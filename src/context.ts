/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";
import { getGitChangedPaths } from "./git.js";
import { loadMemoryIndex, retrieveMemory, type MemoryEntry } from "./memory.js";
import { loadExecutionPlan, type ExecutionPlanTask } from "./plans.js";
import { getTaskContextManifestPath } from "./paths.js";
import { computePrdCoverageSummary, loadPrdCoverage, loadPrdRequirements } from "./prd.js";
import { getValidationManifestForTask, loadValidationRuns, type ValidationRunRecord } from "./validation.js";
import { normalizeExactness, type ContextExactness } from "./compression.js";
import type { ScalerState, ScalerTaskState } from "./types.js";

export type { ContextExactness };

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
  exactness?: ContextExactness;
  estimatedTokens?: number;
  available?: boolean;
  diagnostic?: string;
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

export interface MarkdownHeadingSelector {
  kind: "markdown-heading";
  heading: string;
  maxChars?: number;
}

export interface TaskContextManifestItem {
  id: string;
  type: ContextItemType;
  reason: string;
  priority: ContextPriority;
  scope: ContextScope;
  exactness?: ContextExactness;
  source: ContextManifestSource;
  content?: string;
  path?: string;
  memoryId?: string;
  taskId?: string;
  selector?: MarkdownHeadingSelector;
}

export interface TaskContextManifest {
  version: 1;
  taskId: string;
  tokenBudget?: number;
  items: TaskContextManifestItem[];
  createdAt: string;
  updatedAt: string;
}

export type ContextCandidateSource = "memory" | "file" | "changed_file" | "manifest" | "prd";

export interface ContextCandidate {
  id: string;
  taskId: string;
  source: ContextCandidateSource;
  type: ContextItemType;
  reason: string;
  score: number;
  priority: ContextPriority;
  scope: ContextScope;
  exactness: ContextExactness;
  content?: string;
  path?: string;
  memoryId?: string;
  selector?: MarkdownHeadingSelector;
}

export interface ContextCandidateSearchOptions {
  query?: string;
  limit?: number;
}

export interface ContextCandidateSelectionResult {
  candidate: ContextCandidate;
  manifest: TaskContextManifest;
  added: boolean;
}

const priorityOrder: Record<ContextPriority, number> = {
  required: 0,
  useful: 1,
  optional: 2,
};

const contextItemTypes = new Set<ContextItemType>(["prd", "knowledge", "memory", "file", "task_report", "validation", "tool", "decision"]);
const contextPriorities = new Set<ContextPriority>(["required", "useful", "optional"]);
const contextScopes = new Set<ContextScope>(["full", "section", "snippet", "summary", "reference-only"]);
const contextExactnessValues = new Set<ContextExactness>(["exact", "summary-ok", "reference-only"]);
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
      exactness: "exact",
      source: "state",
    },
    {
      id: "task-metadata",
      type: "task_report",
      reason: "Task metadata defines scope, dependencies, allowed paths, and PRD links.",
      priority: "required",
      scope: "summary",
      exactness: "exact",
      source: "task",
      taskId,
    },
    {
      id: "validation-manifest",
      type: "validation",
      reason: "Validation requirements guide the task definition of done.",
      priority: "useful",
      scope: "summary",
      exactness: "exact",
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
      exactness: "reference-only",
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
      exactness: "summary-ok",
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
      exactness: normalizeExactness(item.exactness, item.scope),
      content: item.content?.trim() || undefined,
      path: item.path?.trim() || undefined,
      memoryId: item.memoryId?.trim() || undefined,
      taskId: item.taskId?.trim() || undefined,
      selector: item.selector ? {
        ...item.selector,
        heading: item.selector.heading.trim(),
      } : undefined,
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
  if (manifest.tokenBudget !== undefined && (!Number.isSafeInteger(manifest.tokenBudget) || manifest.tokenBudget <= 0)) {
    throw new Error("Task context manifest tokenBudget must be a positive finite integer.");
  }
  const ids = new Set<string>();
  for (const item of manifest.items) validateTaskContextManifestItem(item, ids);
}

export function formatTaskContextManifest(manifest: TaskContextManifest): string {
  validateTaskContextManifest(manifest);
  const lines = [`Task context manifest: ${manifest.taskId} items=${manifest.items.length} tokenBudget=${manifest.tokenBudget ?? "default"}`];
  for (const item of manifest.items) {
    const selector = item.selector ? ` selector=${item.selector.kind}:${item.selector.heading}` : "";
    lines.push(`- ${item.id}: ${item.source}/${item.type} ${item.priority} ${item.scope} exactness=${normalizeExactness(item.exactness, item.scope)}${selector} reason=${item.reason}`);
  }
  return lines.join("\n");
}

export async function discoverSemanticContextCandidates(
  cwd: string,
  state: ScalerState,
  taskId: string,
  options: ContextCandidateSearchOptions = {},
): Promise<ContextCandidate[]> {
  const task = state.tasks.find((candidate) => candidate.id === taskId);
  if (!task) return [];
  const queryTerms = options.query?.toLowerCase().split(/\W+/).filter((term) => term.length >= 3) ?? [];
  const terms = unique([...buildTaskSearchTerms(task), ...queryTerms]);
  const candidates: ContextCandidate[] = [];

  const existingManifest = await loadTaskContextManifest(cwd, taskId);
  for (const item of existingManifest?.items ?? []) {
    const score = scoreText([item.id, item.reason, item.content, item.path, item.memoryId].filter(Boolean).join(" "), terms) + 2;
    if (score <= 0) continue;
    candidates.push({
      id: `candidate-manifest-${item.id}`,
      taskId,
      source: "manifest",
      type: item.type,
      reason: `Existing approved manifest item matches task/query terms with score ${score}.`,
      score,
      priority: item.priority,
      scope: item.scope === "full" ? "summary" : item.scope,
      exactness: normalizeExactness(item.exactness, item.scope),
      content: item.content,
      path: item.path,
      memoryId: item.memoryId,
      selector: item.selector,
    });
  }

  const memoryIndex = await loadMemoryIndex(cwd);
  for (const entry of memoryIndex.entries) {
    if (entry.validity === "obsolete") continue;
    const score = scoreMemoryEntry(entry, task, terms) + scoreText([entry.title, entry.summary, entry.source, entry.path, ...(entry.tags ?? [])].filter(Boolean).join(" "), queryTerms);
    if (score <= 0) continue;
    candidates.push({
      id: `candidate-memory-${entry.id}`,
      taskId,
      source: "memory",
      type: "memory",
      reason: `Memory ${entry.id} matched task/query terms with score ${score}; approve only if this task needs the summary.`,
      score,
      priority: score >= 4 ? "useful" : "optional",
      scope: "summary",
      exactness: "summary-ok",
      memoryId: entry.id,
    });
  }

  const changedPaths = await getGitChangedPaths(cwd);
  for (const path of await discoverCandidateFilePaths(cwd, task, changedPaths)) {
    const snippet = await readContextFileSnippet(cwd, path);
    const score = scoreText([path, snippet].join("\n"), terms) + (taskPathMatches(path, task.allowedPathPrefixes ?? []) ? 2 : 0);
    if (score <= 0) continue;
    const source: ContextCandidateSource = changedPaths.includes(path) ? "changed_file" : "file";
    candidates.push({
      id: `candidate-${source}-${slugify(path)}`,
      taskId,
      source,
      type: "file",
      reason: `${source === "changed_file" ? "Changed file" : "Allowed-path file"} matched task/query terms with score ${score}; approve to add a compact snippet/reference to the manifest.`,
      score,
      priority: source === "changed_file" || taskPathMatches(path, task.allowedPathPrefixes ?? []) ? "useful" : "optional",
      scope: "snippet",
      exactness: "exact",
      path,
    });
  }

  for (const ref of task.prdRefs ?? []) {
    const score = scoreText(ref, terms) + 2;
    if (score <= 0) continue;
    candidates.push({
      id: `candidate-prd-${slugify(ref)}`,
      taskId,
      source: "prd",
      type: "prd",
      reason: `Task PRD reference ${ref} is relevant and remains reference-only unless explicitly resolved.`,
      score,
      priority: "useful",
      scope: "reference-only",
      exactness: "reference-only",
      content: `Runtime PRD reference for ${taskId}: ${ref}`,
    });
  }

  return dedupeContextCandidates(candidates)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, options.limit ?? 10);
}

export function formatContextCandidates(candidates: ContextCandidate[]): string {
  if (candidates.length === 0) return "No context candidates found.";
  return [
    `Context candidates: ${candidates.length}`,
    ...candidates.map((candidate) => {
      const location = candidate.memoryId ? ` memory=${candidate.memoryId}` : candidate.path ? ` path=${candidate.path}` : "";
      return `- ${candidate.id}: score=${candidate.score} ${candidate.source}/${candidate.type} ${candidate.priority} ${candidate.scope} exactness=${candidate.exactness}${location}\n  reason=${candidate.reason}`;
    }),
  ].join("\n");
}

export async function approveContextCandidate(
  cwd: string,
  state: ScalerState,
  taskId: string,
  candidateId: string,
  options: ContextCandidateSearchOptions = {},
): Promise<ContextCandidateSelectionResult> {
  const candidates = await discoverSemanticContextCandidates(cwd, state, taskId, { ...options, limit: Math.max(options.limit ?? 50, 50) });
  const candidate = candidates.find((item) => item.id === candidateId);
  if (!candidate) throw new Error(`Context candidate not found for ${taskId}: ${candidateId}`);
  const manifest = await ensureTaskContextManifest(cwd, state, taskId);
  const item = contextCandidateToManifestItem(candidate);
  const existing = manifest.items.find((manifestItem) => contextManifestItemMatchesCandidate(manifestItem, candidate) || manifestItem.id === item.id);
  if (existing) return { candidate, manifest, added: false };
  const saved = await saveTaskContextManifest(cwd, { ...manifest, items: [...manifest.items, item] });
  return { candidate, manifest: saved, added: true };
}

export async function buildContextHookInjection(cwd: string, state: ScalerState, taskId = state.currentTaskId, tokenBudget = 1_200): Promise<string | undefined> {
  if (!taskId) return undefined;
  const task = state.tasks.find((candidate) => candidate.id === taskId);
  if (!task) return undefined;
  const manifest = await loadTaskContextManifest(cwd, taskId);
  if (!manifest) return undefined;
  const resolvedItems = await resolveTaskContextManifest(cwd, state, manifest);
  const hookItems = resolvedItems.filter((item) =>
    item.priority !== "optional" &&
    (item.scope === "summary" || item.scope === "snippet" || item.scope === "reference-only")
  );
  if (hookItems.length === 0) return undefined;
  const resolved = resolveContext({
    state,
    taskId,
    taskGoal: task.title,
    definitionOfDone: Array.isArray(task.definitionOfDone) ? task.definitionOfDone.join("; ") : task.definitionOfDone,
    items: hookItems,
    tokenBudget,
  });
  if (resolved.included.length === 0) return undefined;
  return [
    "# SCALER Selected Context Injection",
    "The following compact context comes from the approved task context manifest. It excludes optional/full items unless explicitly approved and budgeted.",
    resolved.text,
  ].join("\n\n");
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
      exactness: normalizeExactness(entry.exactness, entry.scope),
      available: true,
      content: await resolveManifestItemContent(cwd, state, manifest, entry),
    };
  } catch (error) {
    return {
      id: entry.id,
      type: entry.type,
      reason: `${entry.reason} (missing: ${(error as Error).message})`,
      priority: entry.priority === "required" ? "required" : "optional",
      scope: "reference-only",
      exactness: "reference-only",
      available: false,
      diagnostic: (error as Error).message,
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
  if (entry.source === "file") return await resolveFileContextContent(cwd, entry.path!, entry.scope, entry.selector);
  if (entry.source === "memory") return (await retrieveMemory(cwd, entry.memoryId!, { scope: entry.scope })).content;
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

async function resolveFileContextContent(
  cwd: string,
  path: string,
  scope: ContextScope,
  selector?: MarkdownHeadingSelector,
): Promise<string> {
  const content = await readFile(resolveContextPath(cwd, path), "utf8");
  if (scope === "full") return content;
  if (scope === "reference-only") return `File reference: ${path}`;
  if (scope === "section") {
    if (!selector) throw new Error(`File section selector is required for ${path}.`);
    return extractMarkdownHeadingSection(content, path, selector);
  }
  const maxChars = scope === "snippet" ? 2_400 : 3_200;
  if (content.length <= maxChars) return content;
  return [`File ${scope}: ${path}`, content.slice(0, maxChars), `... [truncated ${content.length - maxChars} chars; request full file if needed]`].join("\n");
}

function extractMarkdownHeadingSection(content: string, path: string, selector: MarkdownHeadingSelector): string {
  const headings: Array<{ level: number; text: string; start: number }> = [];
  let fence: { marker: "`" | "~"; length: number; minIndent: number; maxIndent: number } | undefined;
  let offset = 0;
  while (offset < content.length) {
    const newline = content.indexOf("\n", offset);
    const end = newline === -1 ? content.length : newline + 1;
    const sourceLine = content.slice(offset, end);
    const line = sourceLine.replace(/\r?\n$/, "");
    const directFenceMatch = line.match(/^( {0,3})(`{3,}|~{3,})(.*)$/);
    const listFenceMatch = line.match(/^( {0,3}(?:[-+*]|\d{1,9}[.)]) {1,4})(`{3,}|~{3,})(.*)$/);
    if (fence) {
      const leadingSpaces = line.match(/^ */)![0].length;
      if (fence.minIndent === 0 || line.trim() === "" || leadingSpaces >= fence.minIndent) {
        const closing = new RegExp(`^ {${fence.minIndent},${fence.maxIndent}}${fence.marker === "`" ? "`" : "~"}{${fence.length},}[ \\t]*$`);
        if (closing.test(line)) fence = undefined;
        offset = end;
        continue;
      }
      fence = undefined;
    }
    const fenceMarker = directFenceMatch?.[2] ?? listFenceMatch?.[2];
    const fenceInfo = directFenceMatch?.[3] ?? listFenceMatch?.[3];
    const marker = fenceMarker?.[0] as "`" | "~" | undefined;
    const validFenceOpener = fenceMarker !== undefined
      && !(marker === "`" && fenceInfo!.includes("`"));
    if (validFenceOpener) {
      const containerIndent = listFenceMatch?.[1].length ?? 0;
      fence = {
        marker: marker!,
        length: fenceMarker!.length,
        minIndent: containerIndent,
        maxIndent: containerIndent + 3,
      };
      offset = end;
      continue;
    }
    const match = line.match(/^ {0,3}(#{1,6})(?:[ \t]+(.*?)|[ \t]*)$/);
    if (match) {
      const text = (match[2] ?? "").replace(/[ \t]+#+[ \t]*$/, "").trim();
      headings.push({ level: match[1]!.length, text, start: offset });
    }
    offset = end;
  }

  const matches = headings.filter((heading) => heading.text === selector.heading);
  if (matches.length === 0) throw new Error(`Markdown heading not found in ${path}: ${selector.heading}`);
  if (matches.length > 1) throw new Error(`Markdown heading is ambiguous in ${path}: ${selector.heading}`);
  const selected = matches[0]!;
  const following = headings.find((heading) => heading.start > selected.start && heading.level <= selected.level);
  const section = content.slice(selected.start, following?.start ?? content.length);
  const maxChars = selector.maxChars ?? 3_200;
  if (section.length > maxChars) {
    throw new Error(`Markdown section ${selector.heading} in ${path} is oversized: ${section.length}/${maxChars} characters.`);
  }
  return section;
}

async function discoverCandidateFilePaths(cwd: string, task: ScalerTaskState, changedPaths: string[]): Promise<string[]> {
  const paths: string[] = changedPaths.filter((path) => !isRuntimePath(path));
  for (const prefix of task.allowedPathPrefixes ?? []) {
    for (const path of await collectCandidateFiles(cwd, normalizeRelativePath(prefix), 2, 8)) paths.push(path);
  }
  return unique(paths).filter((path) => isProbablyTextPath(path)).slice(0, 25);
}

async function collectCandidateFiles(cwd: string, path: string, depth: number, limit: number): Promise<string[]> {
  if (limit <= 0 || !path || isRuntimePath(path) || isIgnoredContextDirectory(path)) return [];
  try {
    const fileStat = await stat(resolveContextPath(cwd, path));
    if (fileStat.isFile()) return [path];
    if (!fileStat.isDirectory() || depth < 0) return [];
    const children = await readdir(resolveContextPath(cwd, path), { withFileTypes: true });
    const results: string[] = [];
    for (const child of children.sort((a, b) => a.name.localeCompare(b.name))) {
      if (results.length >= limit) break;
      const childPath = `${path.replace(/\/$/, "")}/${child.name}`;
      if (isRuntimePath(childPath) || isIgnoredContextDirectory(childPath)) continue;
      if (child.isFile() && isProbablyTextPath(childPath)) results.push(childPath);
      else if (child.isDirectory() && depth > 0) results.push(...(await collectCandidateFiles(cwd, childPath, depth - 1, limit - results.length)));
    }
    return results;
  } catch {
    return [];
  }
}

async function readContextFileSnippet(cwd: string, path: string): Promise<string> {
  try {
    return (await resolveFileContextContent(cwd, path, "snippet")).slice(0, 4_000);
  } catch {
    return "";
  }
}

function contextCandidateToManifestItem(candidate: ContextCandidate): TaskContextManifestItem {
  const id = `approved-${candidate.id.replace(/^candidate-/, "")}`.slice(0, 80);
  const base = {
    id,
    type: candidate.type,
    reason: candidate.reason,
    priority: candidate.priority,
    scope: candidate.scope,
    exactness: candidate.exactness,
    selector: candidate.selector,
  } satisfies Omit<TaskContextManifestItem, "source">;
  if (candidate.memoryId) return { ...base, source: "memory", memoryId: candidate.memoryId };
  if (candidate.path) return { ...base, source: "file", path: candidate.path };
  return { ...base, source: "inline", content: candidate.content ?? candidate.reason };
}

function contextManifestItemMatchesCandidate(item: TaskContextManifestItem, candidate: ContextCandidate): boolean {
  if (candidate.memoryId && item.memoryId === candidate.memoryId) return true;
  if (candidate.path && item.path === candidate.path
      && JSON.stringify(item.selector ?? null) === JSON.stringify(candidate.selector ?? null)) return true;
  return Boolean(candidate.content && item.content === candidate.content);
}

function dedupeContextCandidates(candidates: ContextCandidate[]): ContextCandidate[] {
  const byKey = new Map<string, ContextCandidate>();
  for (const candidate of candidates) {
    const key = candidate.memoryId ? `memory:${candidate.memoryId}`
      : candidate.path ? `path:${candidate.path}:selector:${JSON.stringify(candidate.selector ?? null)}`
      : candidate.content ? `content:${candidate.content}` : candidate.id;
    const existing = byKey.get(key);
    if (!existing || candidate.score > existing.score) byKey.set(key, candidate);
  }
  return [...byKey.values()];
}

function scoreText(text: string, terms: string[]): number {
  const haystack = text.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (haystack.includes(term)) score += 1;
  }
  return score;
}

function normalizeRelativePath(path: string): string {
  return path.replace(/^\.\//, "").replace(/\/$/, "");
}

function isIgnoredContextDirectory(path: string): boolean {
  const parts = path.split("/");
  return parts.some((part) => [".git", "node_modules", "dist", "coverage", "build", ".next", ".turbo"].includes(part));
}

function isProbablyTextPath(path: string): boolean {
  return !/\.(png|jpe?g|gif|webp|bmp|ico|pdf|zip|tar|gz|tgz|mp4|mov|woff2?|ttf|eot)$/i.test(path);
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
      exactness: "exact",
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
      exactness: "exact",
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
    exactness: "exact",
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
    exactness: "exact",
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
    exactness: "exact",
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
      exactness: "summary-ok",
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
  const haystack = [entry.id, entry.title, entry.summary, entry.source, entry.path, entry.taskId, ...(entry.tags ?? [])].filter(Boolean).join(" ").toLowerCase();
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
  if (item.exactness !== undefined && !contextExactnessValues.has(item.exactness)) throw new Error(`Invalid task context item exactness: ${String(item.exactness)}`);
  if (!contextManifestSources.has(item.source)) throw new Error(`Invalid task context item source: ${String(item.source)}`);
  if (!item.reason.trim()) throw new Error(`Task context item ${item.id} reason is required.`);
  if (item.source === "inline" && !item.content?.trim()) throw new Error(`Task context item ${item.id} inline content is required.`);
  if (item.source === "file" && !item.path?.trim()) throw new Error(`Task context item ${item.id} file path is required.`);
  if (item.selector !== undefined) {
    if (item.source !== "file" || item.scope !== "section") {
      throw new Error(`Task context item ${item.id} selector requires file section scope.`);
    }
    if (item.selector.kind !== "markdown-heading" || !item.selector.heading?.trim()) {
      throw new Error(`Task context item ${item.id} Markdown heading selector is invalid.`);
    }
    if (item.selector.maxChars !== undefined
        && (!Number.isSafeInteger(item.selector.maxChars) || item.selector.maxChars <= 0)) {
      throw new Error(`Task context item ${item.id} selector maxChars must be a positive finite integer.`);
    }
  }
  if (item.source === "memory" && !item.memoryId?.trim()) throw new Error(`Task context item ${item.id} memoryId is required.`);
}

export function getRequiredContextDiagnostics(items: ContextItem[]): string[] {
  return items
    .filter((item) => item.priority === "required" && item.available === false)
    .map((item) => `Required context ${item.id} is unavailable: ${item.diagnostic ?? "unknown retrieval error"}`);
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
    `Exactness: ${normalizeExactness(item.exactness, item.scope)}`,
    `Reason: ${item.reason}`,
    "",
    item.content,
  ].join("\n");
}

export function formatOmittedContextSummary(items: ContextItem[]): string {
  return [
    "## Omitted Context",
    "The following context items were omitted due to the token budget. Request them explicitly if needed.",
    ...items.map((item) => `- ${item.id}: ${item.reason} (${item.type}, ${item.priority}, ${item.scope}, exactness=${normalizeExactness(item.exactness, item.scope)})`),
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

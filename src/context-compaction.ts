/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createCompressionPolicy } from "./compression.js";
import { ensureTaskContextManifest, resolveTaskContextManifest, type ContextItem } from "./context.js";
import { loadContextSplitRecords, type ContextSplitRecord, type ExternalizedContextRef } from "./context-splits.js";
import { appendLogEvent, createLogEvent } from "./logging.js";
import { loadMemoryIndex } from "./memory.js";
import { loadExecutionPlan, summarizeExecutionPlan } from "./plans.js";
import {
  getContextCompactionsPath,
  getContextHandoffPromptsDir,
  getContextHandoffsPath,
} from "./paths.js";
import { computePrdCoverageSummary, loadPrdCoverage, loadPrdRequirements } from "./prd.js";
import { buildTaskAgentInvocation, runTaskAgent, type TaskAgentInvocation, type TaskAgentRunResult } from "./subagents.js";
import type { ScalerState, ScalerTaskState } from "./types.js";

export interface ScalerCompactionPreparationLike {
  firstKeptEntryId: string;
  tokensBefore: number;
  previousSummary?: string;
  messagesToSummarize?: unknown[];
  turnPrefixMessages?: unknown[];
  fileOps?: {
    readFiles?: string[];
    modifiedFiles?: string[];
    read?: Set<string>;
    written?: Set<string>;
    edited?: Set<string>;
  };
}

export interface ScalerCompactionResult<TDetails = ScalerCompactionDetails> {
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  estimatedTokensAfter?: number;
  details?: TDetails;
}

export interface ScalerCompactionDetails {
  version: 1;
  recordId: string;
  reason: string;
  willRetry: boolean;
  activeContextLimitTokens: number;
  estimatedTokensAfter: number;
  shrinkTargetPassed: boolean;
  currentTaskId?: string;
  validatedTaskIds: string[];
  memoryRefs: string[];
  contextSplitRefs: string[];
  handoffRecommendation?: string;
}

export interface ScalerCompactionRecord extends ScalerCompactionDetails {
  summaryPath: string;
  tokensBefore: number;
  firstKeptEntryId: string;
  createdAt: string;
}

interface ScalerCompactionIndex {
  version: 1;
  compactions: ScalerCompactionRecord[];
}

export interface ContextUsageLike {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
}

export interface CompactionTriggerDecision {
  trigger: boolean;
  reason: string;
  usage?: ContextUsageLike;
  activeContextLimitTokens?: number;
  overByTokens?: number;
}

export interface FreshContextHandoffInput {
  splitId?: string;
  taskId?: string;
  execute?: boolean;
  tools?: string[];
  model?: string;
  timeoutMs?: number;
  now?: Date;
}

export interface FreshContextHandoffRecord {
  id: string;
  splitId: string;
  taskId: string;
  status: "prepared" | "executed" | "failed" | "blocked";
  promptPath: string;
  estimatedTokens: number;
  previousEstimatedTokens: number;
  activeContextLimitTokens: number;
  shrinkTargetPassed: boolean;
  externalizedMemoryRefs: ExternalizedContextRef[];
  invocation?: TaskAgentInvocation;
  exitCode?: number;
  diagnostics: string[];
  createdAt: string;
}

interface FreshContextHandoffIndex {
  version: 1;
  handoffs: FreshContextHandoffRecord[];
}

export type FreshContextHandoffRunner = typeof runTaskAgent;

export interface FreshContextHandoffResult {
  accepted: boolean;
  message: string;
  record: FreshContextHandoffRecord;
  prompt: string;
  runResult?: TaskAgentRunResult;
}

export async function buildScalerCompactionResult(
  cwd: string,
  state: ScalerState,
  preparation: ScalerCompactionPreparationLike,
  input: { reason?: string; willRetry?: boolean; customInstructions?: string; now?: Date } = {},
): Promise<ScalerCompactionResult> {
  const now = input.now ?? new Date();
  const timestamp = now.toISOString();
  const recordId = `COMPACT-${now.getTime()}`;
  const policy = createCompressionPolicy(inferContextWindow(preparation.tokensBefore));
  const summary = await buildScalerCompactionSummary(cwd, state, preparation, {
    reason: input.reason ?? "manual",
    willRetry: input.willRetry ?? false,
    customInstructions: input.customInstructions,
    activeContextLimitTokens: policy.activeContextLimitTokens,
  });
  const estimatedTokensAfter = estimateTextTokens(summary);
  const shrinkTargetPassed = estimatedTokensAfter <= policy.activeContextLimitTokens;
  const splits = await loadContextSplitRecords(cwd);
  const memoryRefs = [...new Set([...(state.memoryRefs ?? []), ...(await loadMemoryIndex(cwd)).entries.slice(0, 10).map((entry) => entry.id)])];
  const details: ScalerCompactionDetails = {
    version: 1,
    recordId,
    reason: input.reason ?? "manual",
    willRetry: input.willRetry ?? false,
    activeContextLimitTokens: policy.activeContextLimitTokens,
    estimatedTokensAfter,
    shrinkTargetPassed,
    currentTaskId: state.currentTaskId ?? undefined,
    validatedTaskIds: [...state.validatedTaskIds],
    memoryRefs,
    contextSplitRefs: splits.slice(0, 10).map((split) => split.id),
    handoffRecommendation: splits[0] ? `Use /scaler-context-handoff ${splits[0].id} for a fresh minimal-context continuation if active context remains high.` : undefined,
  };

  const summaryPath = join(".scaler", "context", "compactions", `${recordId}.md`);
  await mkdir(dirname(join(cwd, summaryPath)), { recursive: true });
  await writeFile(join(cwd, summaryPath), `${summary}\n`, "utf8");
  const record: ScalerCompactionRecord = {
    ...details,
    summaryPath,
    tokensBefore: preparation.tokensBefore,
    firstKeptEntryId: preparation.firstKeptEntryId,
    createdAt: timestamp,
  };
  await writeScalerCompactionRecords(cwd, [record, ...(await loadScalerCompactionRecords(cwd))]);
  await appendLogEvent(cwd, createLogEvent(state, {
    eventType: "system",
    summary: `SCALER-aware compaction prepared: ${recordId}`,
    outputRefs: [recordId, summaryPath],
    details: record,
  }, now));

  return {
    summary,
    firstKeptEntryId: preparation.firstKeptEntryId,
    tokensBefore: preparation.tokensBefore,
    estimatedTokensAfter,
    details,
  };
}

export async function loadScalerCompactionRecords(cwd: string): Promise<ScalerCompactionRecord[]> {
  try {
    const raw = await readFile(getContextCompactionsPath(cwd), "utf8");
    return (JSON.parse(raw) as ScalerCompactionIndex).compactions ?? [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export function formatScalerCompactionRecords(records: ScalerCompactionRecord[], limit = 20): string {
  if (records.length === 0) return "No SCALER compaction records.";
  const lines = ["SCALER compaction records:"];
  for (const record of records.slice(0, limit)) {
    lines.push(`- ${record.recordId}: reason=${record.reason} before=${record.tokensBefore} after=${record.estimatedTokensAfter} target=${record.activeContextLimitTokens} shrink=${record.shrinkTargetPassed}`);
    lines.push(`  summary=${record.summaryPath}`);
    if (record.contextSplitRefs.length > 0) lines.push(`  splits=${record.contextSplitRefs.join(",")}`);
  }
  return lines.join("\n");
}

export function shouldTriggerScalerCompaction(usage: ContextUsageLike | undefined, targetRatio = 0.75): CompactionTriggerDecision {
  if (!usage || usage.tokens === null || !Number.isFinite(usage.contextWindow) || usage.contextWindow <= 0) {
    return { trigger: false, reason: "Context usage unavailable." };
  }
  const policy = createCompressionPolicy(usage.contextWindow, targetRatio);
  const overByTokens = Math.max(0, usage.tokens - policy.activeContextLimitTokens);
  if (overByTokens <= 0) {
    return { trigger: false, reason: `Context within SCALER target ${usage.tokens}/${policy.activeContextLimitTokens}.`, usage, activeContextLimitTokens: policy.activeContextLimitTokens, overByTokens };
  }
  return {
    trigger: true,
    reason: `Context exceeds SCALER target by ${overByTokens} tokens (${usage.tokens}/${policy.activeContextLimitTokens}).`,
    usage,
    activeContextLimitTokens: policy.activeContextLimitTokens,
    overByTokens,
  };
}

export function buildScalerCompactionInstructions(state: ScalerState, decision?: CompactionTriggerDecision): string {
  const task = state.currentTaskId ? state.tasks.find((candidate) => candidate.id === state.currentTaskId) : undefined;
  return [
    "Create a SCALER-aware compaction, not a generic chat summary.",
    "Preserve the current goal, supervisor state, current task, validated progress, blockers, memory refs, failure/attempt stack summary, and exact next action.",
    "Do not paraphrase exact code, commands, requirement ids, validation evidence, paths, or API signatures; keep references to externalized memory/files instead.",
    `Run=${state.runId} stage=${state.stage} complexity=${state.complexityLevel}`,
    `Current task=${task ? `${task.id}:${task.status}:${task.title ?? "untitled"}` : state.currentTaskId ?? "none"}`,
    `Validated tasks=${state.validatedTaskIds.join(",") || "none"}`,
    `Blockers=${state.blockers.join(" | ") || "none"}`,
    decision?.reason ? `Trigger=${decision.reason}` : undefined,
  ].filter(Boolean).join("\n");
}

export async function prepareFreshContextHandoff(
  cwd: string,
  state: ScalerState,
  input: FreshContextHandoffInput = {},
  runner: FreshContextHandoffRunner = runTaskAgent,
): Promise<FreshContextHandoffResult> {
  const now = input.now ?? new Date();
  const split = await selectContextSplit(cwd, input);
  if (!split) {
    const record = buildBlockedHandoffRecord("none", input.taskId ?? state.currentTaskId ?? "unknown", "No matching context split record found.", now);
    await writeFreshContextHandoffRecords(cwd, [record, ...(await loadFreshContextHandoffRecords(cwd))]);
    return { accepted: false, message: record.diagnostics[0] ?? "No matching context split record found.", record, prompt: "" };
  }

  const task = state.tasks.find((candidate) => candidate.id === split.taskId);
  const prompt = await buildFreshContextHandoffPrompt(cwd, state, split, task);
  const estimatedTokens = estimateTextTokens(prompt);
  const shrinkTargetPassed = estimatedTokens <= split.activeContextLimitTokens && estimatedTokens < split.estimatedTokens;
  const diagnostics = shrinkTargetPassed
    ? [`Fresh handoff prompt shrank from ${split.estimatedTokens} to ${estimatedTokens} tokens (target ${split.activeContextLimitTokens}).`]
    : [`Fresh handoff prompt estimate ${estimatedTokens} does not satisfy shrink target ${split.activeContextLimitTokens} from previous ${split.estimatedTokens}.`];
  const id = `HANDOFF-${now.getTime()}`;
  const promptPath = join(".scaler", "context", "handoffs", `${id}.md`);
  await mkdir(getContextHandoffPromptsDir(cwd), { recursive: true });
  await writeFile(join(cwd, promptPath), `${prompt}\n`, "utf8");

  const invocation = buildTaskAgentInvocation({ cwd, taskId: split.taskId, prompt, tools: input.tools, model: input.model });
  let runResult: TaskAgentRunResult | undefined;
  if (input.execute && shrinkTargetPassed) {
    runResult = await runner({ cwd, taskId: split.taskId, prompt, tools: input.tools, model: input.model }, { timeoutMs: input.timeoutMs });
  }

  const status: FreshContextHandoffRecord["status"] = input.execute
    ? !shrinkTargetPassed
      ? "blocked"
      : runResult?.exitCode === 0
        ? "executed"
        : "failed"
    : shrinkTargetPassed
      ? "prepared"
      : "blocked";
  const record: FreshContextHandoffRecord = {
    id,
    splitId: split.id,
    taskId: split.taskId,
    status,
    promptPath,
    estimatedTokens,
    previousEstimatedTokens: split.estimatedTokens,
    activeContextLimitTokens: split.activeContextLimitTokens,
    shrinkTargetPassed,
    externalizedMemoryRefs: split.externalizedMemoryRefs ?? [],
    invocation,
    exitCode: runResult?.exitCode,
    diagnostics,
    createdAt: now.toISOString(),
  };
  await writeFreshContextHandoffRecords(cwd, [record, ...(await loadFreshContextHandoffRecords(cwd))]);
  await appendLogEvent(cwd, createLogEvent(state, {
    eventType: "agent",
    summary: `${input.execute ? "Executed" : "Prepared"} fresh context handoff for ${split.taskId}`,
    taskId: split.taskId,
    agentId: id,
    agentType: "task-fresh-context",
    inputRefs: [split.id, ...record.externalizedMemoryRefs.map((ref) => ref.memoryId)],
    outputRefs: [id, promptPath],
    details: record,
  }, now));

  return {
    accepted: status === "prepared" || status === "executed",
    message: `${status === "blocked" ? "Blocked" : input.execute ? "Executed" : "Prepared"} fresh context handoff ${id} for ${split.taskId}`,
    record,
    prompt,
    runResult,
  };
}

export async function loadFreshContextHandoffRecords(cwd: string): Promise<FreshContextHandoffRecord[]> {
  try {
    const raw = await readFile(getContextHandoffsPath(cwd), "utf8");
    return (JSON.parse(raw) as FreshContextHandoffIndex).handoffs ?? [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export function formatFreshContextHandoffs(records: FreshContextHandoffRecord[], taskId?: string, limit = 20): string {
  const filtered = taskId ? records.filter((record) => record.taskId === taskId || record.splitId === taskId || record.id === taskId) : records;
  if (filtered.length === 0) return taskId ? `No fresh context handoffs for ${taskId}.` : "No fresh context handoffs.";
  const lines = [taskId ? `Fresh context handoffs for ${taskId}:` : "Fresh context handoffs:"];
  for (const record of filtered.slice(0, limit)) {
    lines.push(`- ${record.id}: task=${record.taskId} split=${record.splitId} status=${record.status} estimated=${record.estimatedTokens} target=${record.activeContextLimitTokens} shrink=${record.shrinkTargetPassed}`);
    lines.push(`  prompt=${record.promptPath}`);
    if (record.externalizedMemoryRefs.length > 0) lines.push(`  memory=${record.externalizedMemoryRefs.map((ref) => `${ref.itemId}->${ref.memoryId}`).join(",")}`);
  }
  return lines.join("\n");
}

async function buildScalerCompactionSummary(
  cwd: string,
  state: ScalerState,
  preparation: ScalerCompactionPreparationLike,
  input: { reason: string; willRetry: boolean; customInstructions?: string; activeContextLimitTokens: number },
): Promise<string> {
  const requirements = await loadPrdRequirements(cwd);
  const coverage = await loadPrdCoverage(cwd);
  const coverageSummary = computePrdCoverageSummary(requirements, coverage, state);
  const planSummary = summarizeExecutionPlan(await loadExecutionPlan(cwd), requirements, state);
  const splits = await loadContextSplitRecords(cwd);
  const memory = await loadMemoryIndex(cwd);
  const task = state.currentTaskId ? state.tasks.find((candidate) => candidate.id === state.currentTaskId) : undefined;
  const conversationSnippets = summarizeMessages(preparation.messagesToSummarize ?? [], input.activeContextLimitTokens);
  const prefixSnippets = summarizeMessages(preparation.turnPrefixMessages ?? [], Math.floor(input.activeContextLimitTokens / 4));

  const lines = [
    "# SCALER-Aware Compaction Summary",
    "",
    "## Non-negotiable continuation invariants",
    "- Keep active context focused on the current task and exact next action.",
    "- Treat `.scaler/` ledgers and memory refs as source of truth; do not rely on compressed prose for exact facts.",
    "- Preserve validated progress, task states, requirement ids, paths, commands, validation evidence, and safety approvals exactly by reference.",
    "- Retrieve externalized memory/files only when needed for the next task; otherwise cite refs.",
    "",
    "## Supervisor state",
    `- runId: ${state.runId}`,
    `- stage: ${state.stage}`,
    `- previousStage: ${state.previousStage ?? "none"}`,
    `- complexityLevel: ${state.complexityLevel}`,
    `- currentTaskId: ${state.currentTaskId ?? "none"}`,
    `- blockers: ${state.blockers.join(" | ") || "none"}`,
    `- failedTaskId: ${state.failedTaskId ?? "none"}`,
    `- validatedTaskIds: ${state.validatedTaskIds.join(", ") || "none"}`,
    `- completedTaskIds: ${state.completedTaskIds.join(", ") || "none"}`,
    "",
    "## Current task",
    task ? formatTaskSummary(task) : "No current task selected.",
    "",
    "## Task ledger snapshot",
    ...state.tasks.slice(0, 25).map((candidate) => `- ${candidate.id}: ${candidate.status}${candidate.title ? ` — ${candidate.title}` : ""}${candidate.prdRefs?.length ? ` prd=${candidate.prdRefs.join(",")}` : ""}`),
    state.tasks.length > 25 ? `- ... ${state.tasks.length - 25} additional tasks omitted; inspect .scaler/state.json.` : undefined,
    "",
    "## PRD coverage summary",
    `- pending=${coverageSummary.countsByStatus.pending} in_progress=${coverageSummary.countsByStatus.in_progress} implemented=${coverageSummary.countsByStatus.implemented} validated=${coverageSummary.countsByStatus.validated} blocked=${coverageSummary.countsByStatus.blocked} needs_replan=${coverageSummary.countsByStatus.needs_replan}`,
    `- unlinkedRequirements=${coverageSummary.unlinkedRequirementIds.join(", ") || "none"}`,
    "",
    "## Execution plan summary",
    `- planVersion=${planSummary.planVersion} status=${planSummary.status} planned=${planSummary.plannedTaskCount} validated=${planSummary.validatedPlannedTaskCount}`,
    `- missingTaskIds=${planSummary.missingTaskIds.join(", ") || "none"}`,
    `- planUnlinkedTaskIds=${planSummary.planUnlinkedTaskIds.join(", ") || "none"}`,
    "",
    "## Memory and externalized context refs",
    ...(state.memoryRefs.length > 0 ? state.memoryRefs.map((ref) => `- state.memoryRef: ${ref}`) : ["- state.memoryRef: none"]),
    ...memory.entries.slice(0, 15).map((entry) => `- memory ${entry.id}: ${entry.summary} (${entry.path})`),
    ...(splits.slice(0, 10).flatMap((split) => formatSplitSummary(split))),
    "",
    "## Compaction trigger",
    `- reason: ${input.reason}`,
    `- willRetry: ${input.willRetry}`,
    `- tokensBefore: ${preparation.tokensBefore}`,
    `- firstKeptEntryId: ${preparation.firstKeptEntryId}`,
    preparation.previousSummary ? `- previousSummary: ${trimForSummary(preparation.previousSummary, 800)}` : undefined,
    input.customInstructions ? `- customInstructions: ${trimForSummary(input.customInstructions, 800)}` : undefined,
    getReadFiles(preparation.fileOps).length ? `- readFiles: ${getReadFiles(preparation.fileOps).join(", ")}` : undefined,
    getModifiedFiles(preparation.fileOps).length ? `- modifiedFiles: ${getModifiedFiles(preparation.fileOps).join(", ")}` : undefined,
    "",
    "## Conversation fragments summarized deterministically",
    ...(conversationSnippets.length > 0 ? conversationSnippets : ["- No discarded message snippets were available to summarize."]),
    ...(prefixSnippets.length > 0 ? ["", "## Split-turn prefix fragments", ...prefixSnippets] : []),
    "",
    "## Exact next action",
    nextAction(state, task, splits[0]),
  ].filter((line): line is string => typeof line === "string");

  return clampSummaryToTarget(lines.join("\n"), input.activeContextLimitTokens);
}

async function buildFreshContextHandoffPrompt(
  cwd: string,
  state: ScalerState,
  split: ContextSplitRecord,
  task: ScalerTaskState | undefined,
): Promise<string> {
  const manifest = await ensureTaskContextManifest(cwd, state, split.taskId);
  const resolvedItems = await resolveTaskContextManifest(cwd, state, manifest);
  const itemMap = new Map(resolvedItems.map((item) => [item.id, item]));
  const minimalItems = split.minimalContextItemIds.map((id) => itemMap.get(id)).filter((item): item is ContextItem => Boolean(item));
  const externalized = new Map((split.externalizedMemoryRefs ?? []).map((ref) => [ref.itemId, ref]));
  const lines = [
    "# SCALER Fresh Minimal-Context Continuation",
    "",
    "You are a fresh task agent spawned after SCALER detected active-context overage.",
    "Use only this minimal context plus explicit retrieval/tool requests. Do not infer missing exact data from memory.",
    "Submit a structured `scaler_task_report` before claiming completion.",
    "",
    "## Task",
    `- id: ${split.taskId}`,
    `- status: ${task?.status ?? "unknown"}`,
    `- title: ${task?.title ?? "untitled"}`,
    task?.definitionOfDone?.length ? `- definitionOfDone: ${task.definitionOfDone.join("; ")}` : "- definitionOfDone: not declared",
    task?.allowedPathPrefixes?.length ? `- allowedPathPrefixes: ${task.allowedPathPrefixes.join(", ")}` : "- allowedPathPrefixes: none declared",
    task?.prdRefs?.length ? `- prdRefs: ${task.prdRefs.join(", ")}` : "- prdRefs: none declared",
    "",
    "## Context split",
    `- splitId: ${split.id}`,
    `- previousEstimatedTokens: ${split.estimatedTokens}`,
    `- activeContextLimitTokens: ${split.activeContextLimitTokens}`,
    `- overByTokens: ${split.overByTokens}`,
    "",
    "## Externalized exact/summary refs",
    ...(split.externalizedMemoryRefs?.length
      ? split.externalizedMemoryRefs.map((ref) => `- ${ref.itemId}: memory=${ref.memoryId} path=${ref.path} exactness=${ref.exactness} sha256=${ref.sha256}`)
      : ["- none"]),
    "",
    "## Minimal active context",
    ...minimalItems.flatMap((item) => formatMinimalContextItem(item, externalized.get(item.id))),
    minimalItems.length === 0 ? "- No resolved minimal items matched the current manifest; use task metadata and externalized refs above." : undefined,
    "",
    "## Omitted context policy",
    "- Full discarded context is not available in this fresh handoff.",
    "- Retrieve memory/file refs only if needed for this task's DoD or validation.",
    "- If required data is missing, report `needs_data` with precise requested source/action.",
  ].filter((line): line is string => typeof line === "string");
  return lines.join("\n");
}

async function selectContextSplit(cwd: string, input: FreshContextHandoffInput): Promise<ContextSplitRecord | undefined> {
  const splits = await loadContextSplitRecords(cwd);
  if (input.splitId) {
    const byId = splits.find((split) => split.id === input.splitId);
    if (byId) return byId;
  }
  const taskId = input.taskId ?? input.splitId;
  if (taskId) return splits.find((split) => split.taskId === taskId);
  return splits[0];
}

function formatMinimalContextItem(item: ContextItem, externalized?: ExternalizedContextRef): string[] {
  if (externalized) {
    return [`- ${item.id}: externalized to memory ${externalized.memoryId} (${externalized.path}); reason=${item.reason}`];
  }
  const header = `- ${item.id}: type=${item.type} priority=${item.priority} scope=${item.scope} exactness=${item.exactness ?? "exact"}; reason=${item.reason}`;
  if (item.scope === "reference-only" || item.exactness === "reference-only") return [header, `  reference=${trimForSummary(item.content, 240)}`];
  return [header, `  content=${trimForSummary(item.content, 1200)}`];
}

function formatTaskSummary(task: ScalerTaskState): string {
  return [
    `- id: ${task.id}`,
    `- status: ${task.status}`,
    `- title: ${task.title ?? "untitled"}`,
    `- allowedPathPrefixes: ${task.allowedPathPrefixes?.join(", ") || "none"}`,
    `- dependsOn: ${task.dependsOn?.join(", ") || "none"}`,
    `- prdRefs: ${task.prdRefs?.join(", ") || "none"}`,
    `- definitionOfDone: ${task.definitionOfDone?.join("; ") || "none"}`,
  ].join("\n");
}

function formatSplitSummary(split: ContextSplitRecord): string[] {
  const lines = [`- contextSplit ${split.id}: task=${split.taskId} estimated=${split.estimatedTokens} target=${split.activeContextLimitTokens} over=${split.overByTokens}`];
  for (const ref of split.externalizedMemoryRefs ?? []) {
    lines.push(`  - externalized ${ref.itemId}: memory=${ref.memoryId} path=${ref.path} sha256=${ref.sha256}`);
  }
  return lines;
}

function summarizeMessages(messages: unknown[], tokenBudget: number): string[] {
  const charBudget = Math.max(800, Math.min(tokenBudget * 4, 8_000));
  const snippets: string[] = [];
  let used = 0;
  for (const [index, message] of messages.entries()) {
    const text = trimForSummary(messageToText(message), 600);
    if (!text) continue;
    const line = `- message[${index}]: ${text}`;
    if (used + line.length > charBudget) {
      snippets.push(`- ... ${messages.length - index} additional discarded messages omitted; inspect original session if needed.`);
      break;
    }
    snippets.push(line);
    used += line.length;
  }
  return snippets;
}

function messageToText(message: unknown): string {
  if (typeof message === "string") return message;
  if (!message || typeof message !== "object") return String(message ?? "");
  const candidate = message as { role?: unknown; content?: unknown; customType?: unknown; details?: unknown };
  const role = typeof candidate.role === "string" ? candidate.role : typeof candidate.customType === "string" ? candidate.customType : "message";
  return `${role}: ${contentToText(candidate.content ?? candidate.details ?? message)}`;
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(contentToText).join(" ");
  if (content && typeof content === "object") {
    const maybeText = content as { text?: unknown; type?: unknown };
    if (typeof maybeText.text === "string") return maybeText.text;
    return JSON.stringify(content);
  }
  return String(content ?? "");
}

function getReadFiles(fileOps: ScalerCompactionPreparationLike["fileOps"]): string[] {
  if (!fileOps) return [];
  if (fileOps.readFiles) return fileOps.readFiles;
  const modified = new Set([...(fileOps.written ?? []), ...(fileOps.edited ?? [])]);
  return [...(fileOps.read ?? [])].filter((path) => !modified.has(path));
}

function getModifiedFiles(fileOps: ScalerCompactionPreparationLike["fileOps"]): string[] {
  if (!fileOps) return [];
  if (fileOps.modifiedFiles) return fileOps.modifiedFiles;
  return [...new Set([...(fileOps.written ?? []), ...(fileOps.edited ?? [])])];
}

function nextAction(state: ScalerState, task: ScalerTaskState | undefined, split: ContextSplitRecord | undefined): string {
  if (split) return `If context pressure persists, run /scaler-context-handoff ${split.id} to continue task ${split.taskId} in a fresh minimal-context agent.`;
  if (task) return `Continue task ${task.id} from status ${task.status}, using task-specific validation and report gates.`;
  if (state.stage === "planning") return "Continue Stage III planning from runtime PRD and execution plan ledgers.";
  if (state.stage === "execution") return "Select the next ready task with /scaler-step or refresh missing context/replans first.";
  return `Continue SCALER stage ${state.stage} using .scaler ledgers as source of truth.`;
}

function clampSummaryToTarget(summary: string, activeContextLimitTokens: number): string {
  const maxChars = Math.max(1_000, activeContextLimitTokens * 4);
  if (summary.length <= maxChars) return summary;
  return `${summary.slice(0, maxChars - 250)}\n\n[SCALER compaction summary truncated to target; inspect .scaler ledgers for exact details.]`;
}

function trimForSummary(value: string | undefined, maxChars: number): string {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 3)}...`;
}

function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function inferContextWindow(tokensBefore: number): number {
  if (!Number.isFinite(tokensBefore) || tokensBefore <= 0) return 8_000;
  return Math.max(8_000, Math.ceil(tokensBefore / 0.75));
}

function buildBlockedHandoffRecord(splitId: string, taskId: string, diagnostic: string, now: Date): FreshContextHandoffRecord {
  return {
    id: `HANDOFF-${now.getTime()}`,
    splitId,
    taskId,
    status: "blocked",
    promptPath: "",
    estimatedTokens: 0,
    previousEstimatedTokens: 0,
    activeContextLimitTokens: 0,
    shrinkTargetPassed: false,
    externalizedMemoryRefs: [],
    diagnostics: [diagnostic],
    createdAt: now.toISOString(),
  };
}

async function writeScalerCompactionRecords(cwd: string, compactions: ScalerCompactionRecord[]): Promise<void> {
  const path = getContextCompactionsPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ version: 1, compactions } satisfies ScalerCompactionIndex, null, 2)}\n`, "utf8");
}

async function writeFreshContextHandoffRecords(cwd: string, handoffs: FreshContextHandoffRecord[]): Promise<void> {
  const path = getContextHandoffsPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ version: 1, handoffs } satisfies FreshContextHandoffIndex, null, 2)}\n`, "utf8");
}

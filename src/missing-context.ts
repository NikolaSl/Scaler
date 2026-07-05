/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { appendLogEvent, createLogEvent } from "./logging.js";
import { searchMemory } from "./memory.js";
import { getMissingContextRequestsPath } from "./paths.js";
import { loadResearchReports, upsertResearchRequest } from "./research.js";
import { saveState } from "./state.js";
import { transitionTask } from "./supervisor.js";
import type { TaskAgentReportRecord } from "./task-reports.js";
import type { ScalerState } from "./types.js";

export const missingContextStatuses = ["open", "in_progress", "resolved", "blocked", "superseded"] as const;
export type MissingContextStatus = (typeof missingContextStatuses)[number];

export const missingContextKinds = ["memory", "file", "local_research", "internet_research", "user", "tool"] as const;
export type MissingContextKind = (typeof missingContextKinds)[number];

export interface MissingContextRequest {
  id: string;
  status: MissingContextStatus;
  kind: MissingContextKind;
  taskId: string;
  query: string;
  reason: string;
  reportId?: string;
  sourceHint?: string;
  requirementRefs?: string[];
  evidenceRefs?: string[];
  resultSummary?: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
}

export interface MissingContextRequestInput {
  id?: string;
  status?: MissingContextStatus | string;
  kind?: MissingContextKind | string;
  taskId: string;
  query: string;
  reason: string;
  reportId?: string;
  sourceHint?: string;
  requirementRefs?: string[];
  evidenceRefs?: string[];
  resultSummary?: string;
}

export interface MissingContextRequestIndex {
  version: 1;
  requests: MissingContextRequest[];
}

export interface MissingContextCreationResult {
  created: MissingContextRequest[];
  existing: MissingContextRequest[];
}

export interface MissingContextDispatchOptions {
  execute?: boolean;
  allowInternet?: boolean;
}

export interface MissingContextDispatchResult {
  accepted: boolean;
  request?: MissingContextRequest;
  message: string;
  action: "planned" | "resolved" | "blocked" | "research_requested" | "not_found";
}

export interface MissingContextManualResolutionInput {
  requestId: string;
  summary: string;
  evidenceRefs?: string[];
}

export interface MissingContextRefreshResult {
  requests: MissingContextRequest[];
  resolvedRequestIds: string[];
}

export interface MissingContextUnblockResult {
  state: ScalerState;
  unblockedTaskIds: string[];
}

export async function loadMissingContextRequests(cwd: string): Promise<MissingContextRequest[]> {
  try {
    const raw = await readFile(getMissingContextRequestsPath(cwd), "utf8");
    const index = JSON.parse(raw) as MissingContextRequestIndex;
    if (index.version !== 1) throw new Error(`Unsupported missing-context index version: ${String(index.version)}`);
    for (const request of index.requests) validateMissingContextRequest(request);
    return sortMissingContextRequests(index.requests);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function saveMissingContextRequests(cwd: string, requests: MissingContextRequest[]): Promise<MissingContextRequest[]> {
  for (const request of requests) validateMissingContextRequest(request);
  const sorted = sortMissingContextRequests(requests);
  const path = getMissingContextRequestsPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ version: 1, requests: sorted } satisfies MissingContextRequestIndex, null, 2)}\n`, "utf8");
  return sorted;
}

export async function upsertMissingContextRequest(cwd: string, input: MissingContextRequestInput, now = new Date()): Promise<MissingContextRequest> {
  const timestamp = now.toISOString();
  const requests = await loadMissingContextRequests(cwd);
  const existing = input.id ? requests.find((request) => request.id === input.id) : undefined;
  const status = normalizeStatus(input.status ?? existing?.status ?? "open");
  const request: MissingContextRequest = {
    id: input.id?.trim() || existing?.id || `MCTX-${safeId(input.taskId)}-${shortHash(input.query)}`,
    status,
    kind: normalizeKind(input.kind ?? existing?.kind ?? inferMissingContextKind(input.query)),
    taskId: cleanRequired(input.taskId, "Missing-context taskId is required."),
    query: cleanRequired(input.query, "Missing-context query is required."),
    reason: cleanRequired(input.reason, "Missing-context reason is required."),
    reportId: clean(input.reportId) ?? existing?.reportId,
    sourceHint: clean(input.sourceHint) ?? existing?.sourceHint ?? inferSourceHint(input.query),
    requirementRefs: normalizeList(input.requirementRefs ?? existing?.requirementRefs),
    evidenceRefs: normalizeList(input.evidenceRefs ?? existing?.evidenceRefs),
    resultSummary: clean(input.resultSummary) ?? existing?.resultSummary,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
    resolvedAt: status === "resolved" ? (existing?.resolvedAt ?? timestamp) : existing?.resolvedAt,
  };
  await saveMissingContextRequests(cwd, [...requests.filter((candidate) => candidate.id !== request.id), request]);
  return request;
}

export async function createMissingContextRequestsFromTaskReport(
  cwd: string,
  state: ScalerState,
  report: TaskAgentReportRecord,
  now = new Date(),
): Promise<MissingContextCreationResult> {
  const task = state.tasks.find((candidate) => candidate.id === report.taskId);
  const missingItems = unique([
    ...report.missingData,
    ...(report.status === "needs_data" || report.status === "blocked" ? report.blockers : []),
  ]);
  const created: MissingContextRequest[] = [];
  const existing: MissingContextRequest[] = [];
  if (missingItems.length === 0) return { created, existing };

  const current = await loadMissingContextRequests(cwd);
  for (const item of missingItems) {
    const duplicate = current.find((request) => request.taskId === report.taskId && normalizeDedupeKey(request.query) === normalizeDedupeKey(item) && request.status !== "superseded");
    if (duplicate) {
      existing.push(duplicate);
      continue;
    }
    const request = await upsertMissingContextRequest(cwd, {
      id: `MCTX-${safeId(report.taskId)}-${shortHash(`${report.id}:${item}`)}`,
      taskId: report.taskId,
      reportId: report.id,
      query: item,
      reason: `Task-agent report ${report.id} requested missing context before validation.`,
      kind: inferMissingContextKind(item),
      sourceHint: inferSourceHint(item),
      requirementRefs: task?.prdRefs,
    }, now);
    created.push(request);
  }

  if (created.length > 0) {
    await appendLogEvent(cwd, createLogEvent(state, {
      eventType: "system",
      summary: `Missing-context requests created: ${created.map((request) => request.id).join(", ")}`,
      taskId: report.taskId,
      details: { reportId: report.id, created },
    }));
  }
  return { created, existing };
}

export async function dispatchMissingContextRequest(
  cwd: string,
  state: ScalerState,
  requestId: string | undefined,
  options: MissingContextDispatchOptions = {},
  now = new Date(),
): Promise<MissingContextDispatchResult> {
  const requests = await loadMissingContextRequests(cwd);
  const request = selectMissingContextRequest(requests, requestId);
  if (!request) return { accepted: false, action: "not_found", message: requestId ? `No open missing-context request found for ${requestId}.` : "No open missing-context request found." };
  if (request.status === "resolved" || request.status === "superseded") {
    return { accepted: true, action: "resolved", request, message: `Missing-context request ${request.id} is already ${request.status}.` };
  }

  let result: MissingContextDispatchResult;
  switch (request.kind) {
    case "memory":
      result = await dispatchMemoryRequest(cwd, request, options, now);
      break;
    case "file":
      result = await dispatchFileRequest(cwd, request, options, now);
      break;
    case "local_research":
    case "internet_research":
      result = await dispatchResearchRequest(cwd, request, options, now);
      break;
    case "user":
      result = await markMissingContextBlocked(cwd, request, "User clarification is required.", now);
      break;
    case "tool":
      result = await markMissingContextBlocked(cwd, request, "Tool/MCP retrieval requires an explicit tool request.", now);
      break;
  }

  await appendLogEvent(cwd, createLogEvent(state, {
    eventType: "system",
    summary: result.message,
    taskId: request.taskId,
    details: { request: result.request ?? request, action: result.action, execute: Boolean(options.execute) },
  }));
  return result;
}

export async function resolveMissingContextRequest(
  cwd: string,
  state: ScalerState,
  input: MissingContextManualResolutionInput,
  now = new Date(),
): Promise<MissingContextDispatchResult> {
  const requests = await loadMissingContextRequests(cwd);
  const request = requests.find((candidate) => candidate.id === input.requestId);
  if (!request) return { accepted: false, action: "not_found", message: `No missing-context request found for ${input.requestId}.` };
  const resolved = await upsertMissingContextRequest(cwd, {
    ...request,
    status: "resolved",
    resultSummary: input.summary,
    evidenceRefs: normalizeList([...(request.evidenceRefs ?? []), ...(input.evidenceRefs ?? [])]),
  }, now);
  await appendLogEvent(cwd, createLogEvent(state, {
    eventType: "system",
    summary: `Missing-context request resolved: ${resolved.id}`,
    taskId: resolved.taskId,
    details: { request: resolved },
  }));
  return { accepted: true, action: "resolved", request: resolved, message: `Missing-context request resolved: ${resolved.id}` };
}

export async function refreshMissingContextResolutions(cwd: string, state: ScalerState, now = new Date()): Promise<MissingContextRefreshResult> {
  const requests = await loadMissingContextRequests(cwd);
  const reports = await loadResearchReports(cwd);
  const resolvedRequestIds: string[] = [];
  let nextRequests = requests;

  for (const request of requests) {
    if ((request.kind !== "local_research" && request.kind !== "internet_research") || request.status === "resolved" || request.status === "superseded") continue;
    const matchingReport = reports.find((report) => (report.status === "complete" || report.status === "partial") && (request.evidenceRefs ?? []).includes(report.requestId ?? ""));
    if (!matchingReport) continue;
    const resolved: MissingContextRequest = {
      ...request,
      status: "resolved",
      resultSummary: `Research report ${matchingReport.id} resolved missing context: ${matchingReport.conclusions.map((conclusion) => conclusion.summary).join(" ")}`.trim(),
      evidenceRefs: unique([...(request.evidenceRefs ?? []), matchingReport.id, ...(matchingReport.memoryRefs ?? [])]),
      updatedAt: now.toISOString(),
      resolvedAt: now.toISOString(),
    };
    nextRequests = [...nextRequests.filter((candidate) => candidate.id !== request.id), resolved];
    resolvedRequestIds.push(request.id);
  }

  if (resolvedRequestIds.length > 0) {
    await saveMissingContextRequests(cwd, nextRequests);
    await appendLogEvent(cwd, createLogEvent(state, {
      eventType: "system",
      summary: `Missing-context research resolutions refreshed: ${resolvedRequestIds.join(", ")}`,
      details: { resolvedRequestIds },
    }));
  }
  return { requests: sortMissingContextRequests(nextRequests), resolvedRequestIds };
}

export async function unblockTasksWithResolvedMissingContext(cwd: string, state: ScalerState, now = new Date()): Promise<MissingContextUnblockResult> {
  const requests = await loadMissingContextRequests(cwd);
  let nextState = state;
  const unblockedTaskIds: string[] = [];
  for (const task of state.tasks) {
    if (task.status !== "blocked") continue;
    const related = requests.filter((request) => request.taskId === task.id && request.status !== "superseded");
    if (related.length === 0) continue;
    if (!related.every((request) => request.status === "resolved")) continue;
    nextState = transitionTask(nextState, task.id, "ready", { reason: "All missing-context requests are resolved.", now });
    if (nextState.tasks.find((candidate) => candidate.id === task.id)?.status === "ready") unblockedTaskIds.push(task.id);
  }
  if (unblockedTaskIds.length > 0) {
    await saveState(cwd, nextState);
    await appendLogEvent(cwd, createLogEvent(nextState, {
      eventType: "state",
      summary: `Tasks unblocked after missing-context resolution: ${unblockedTaskIds.join(", ")}`,
      details: { unblockedTaskIds },
    }));
  }
  return { state: nextState, unblockedTaskIds };
}

export async function refreshAndUnblockMissingContext(cwd: string, state: ScalerState): Promise<MissingContextUnblockResult> {
  await refreshMissingContextResolutions(cwd, state);
  return await unblockTasksWithResolvedMissingContext(cwd, state);
}

export function formatMissingContextRequests(requests: MissingContextRequest[], taskId?: string, limit = 20): string {
  const filtered = taskId ? requests.filter((request) => request.taskId === taskId) : requests;
  if (filtered.length === 0) return taskId ? `No missing-context requests for ${taskId}.` : "No missing-context requests.";
  const lines = [taskId ? `Missing-context requests for ${taskId}:` : "Missing-context requests:"];
  for (const request of filtered.slice(0, limit)) {
    const source = request.sourceHint ? ` source=${request.sourceHint}` : "";
    const result = request.resultSummary ? ` result=${request.resultSummary}` : "";
    lines.push(`- ${request.id}: ${request.status} kind=${request.kind} task=${request.taskId}${source} query=${request.query}${result}`);
  }
  return lines.join("\n");
}

function selectMissingContextRequest(requests: MissingContextRequest[], requestId: string | undefined): MissingContextRequest | undefined {
  if (requestId) return requests.find((request) => request.id === requestId);
  return requests.find((request) => request.status === "open" || request.status === "in_progress" || request.status === "blocked");
}

async function dispatchMemoryRequest(cwd: string, request: MissingContextRequest, options: MissingContextDispatchOptions, now: Date): Promise<MissingContextDispatchResult> {
  const results = await searchMemory(cwd, { query: request.query, limit: 5 });
  if (!options.execute) return { accepted: true, action: "planned", request, message: `Missing-context memory retrieval planned: ${request.id} candidates=${results.length}` };
  if (results.length === 0) return await markMissingContextBlocked(cwd, request, "No memory candidates matched the missing context query.", now);
  const evidenceRefs = results.map((result) => result.entry.id);
  const resolved = await upsertMissingContextRequest(cwd, {
    ...request,
    status: "resolved",
    evidenceRefs: unique([...(request.evidenceRefs ?? []), ...evidenceRefs]),
    resultSummary: `Resolved from memory candidates: ${evidenceRefs.join(", ")}`,
  }, now);
  return { accepted: true, action: "resolved", request: resolved, message: `Missing-context memory request resolved: ${request.id}` };
}

async function dispatchFileRequest(cwd: string, request: MissingContextRequest, options: MissingContextDispatchOptions, now: Date): Promise<MissingContextDispatchResult> {
  const source = request.sourceHint;
  if (!source) return await markMissingContextBlocked(cwd, request, "No file path was supplied or inferred.", now);
  if (!options.execute) return { accepted: true, action: "planned", request, message: `Missing-context file retrieval planned: ${request.id} source=${source}` };
  const path = isAbsolute(source) ? source : join(cwd, source);
  try {
    const fileStat = await stat(path);
    if (!fileStat.isFile()) return await markMissingContextBlocked(cwd, request, `Source is not a file: ${source}`, now);
    const content = await readFile(path, "utf8");
    const resolved = await upsertMissingContextRequest(cwd, {
      ...request,
      status: "resolved",
      evidenceRefs: unique([...(request.evidenceRefs ?? []), source]),
      resultSummary: `Resolved from file ${source} (${content.length} chars).`,
    }, now);
    return { accepted: true, action: "resolved", request: resolved, message: `Missing-context file request resolved: ${request.id}` };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return await markMissingContextBlocked(cwd, request, `File not found: ${source}`, now);
    throw error;
  }
}

async function dispatchResearchRequest(cwd: string, request: MissingContextRequest, options: MissingContextDispatchOptions, now: Date): Promise<MissingContextDispatchResult> {
  if (request.kind === "internet_research" && !options.allowInternet) {
    return await markMissingContextBlocked(cwd, request, "Internet research requires an explicit internet grant.", now);
  }
  const scope = request.kind === "internet_research" ? "internet" : "local";
  const research = await upsertResearchRequest(cwd, {
    id: `RESEARCH-${safeId(request.id)}`,
    question: request.query,
    reason: `Missing-context investigation for ${request.id}.`,
    taskId: request.taskId,
    requirementRefs: request.requirementRefs,
    scope,
  }, now);
  const nextStatus = options.execute ? "in_progress" : "open";
  const updated = await upsertMissingContextRequest(cwd, {
    ...request,
    status: nextStatus,
    evidenceRefs: unique([...(request.evidenceRefs ?? []), research.id]),
    resultSummary: options.execute ? `Research request dispatched: ${research.id}` : `Research request planned: ${research.id}`,
  }, now);
  return { accepted: true, action: "research_requested", request: updated, message: `Missing-context research request ${options.execute ? "dispatched" : "planned"}: ${research.id}` };
}

async function markMissingContextBlocked(cwd: string, request: MissingContextRequest, reason: string, now: Date): Promise<MissingContextDispatchResult> {
  const blocked = await upsertMissingContextRequest(cwd, { ...request, status: "blocked", resultSummary: reason }, now);
  return { accepted: false, action: "blocked", request: blocked, message: `Missing-context request blocked: ${request.id} ${reason}` };
}

function validateMissingContextRequest(request: MissingContextRequest): void {
  if (!request.id.trim()) throw new Error("Missing-context request id is required.");
  if (!missingContextStatuses.includes(request.status)) throw new Error(`Invalid missing-context status: ${String(request.status)}`);
  if (!missingContextKinds.includes(request.kind)) throw new Error(`Invalid missing-context kind: ${String(request.kind)}`);
  if (!request.taskId.trim()) throw new Error(`Missing-context request ${request.id} taskId is required.`);
  if (!request.query.trim()) throw new Error(`Missing-context request ${request.id} query is required.`);
  if (!request.reason.trim()) throw new Error(`Missing-context request ${request.id} reason is required.`);
  if (!request.createdAt.trim()) throw new Error(`Missing-context request ${request.id} createdAt is required.`);
  if (!request.updatedAt.trim()) throw new Error(`Missing-context request ${request.id} updatedAt is required.`);
}

export function inferMissingContextKind(query: string): MissingContextKind {
  const normalized = query.toLowerCase();
  if (/\b(user|clarification|ask)\b/.test(normalized)) return "user";
  if (/\b(internet|web|online|external|official docs|browser)\b|https?:\/\//.test(normalized)) return "internet_research";
  if (/\b(memory|remember|prior finding|previous note)\b/.test(normalized)) return "memory";
  if (inferSourceHint(query)) return "file";
  if (/\b(tool|mcp|schema)\b/.test(normalized)) return "tool";
  return "local_research";
}

function inferSourceHint(query: string): string | undefined {
  const backtick = /`([^`]+)`/.exec(query)?.[1];
  if (backtick && looksLikePath(backtick)) return cleanPath(backtick);
  const token = query.split(/\s+/).find((part) => looksLikePath(part.replace(/[,:;.)]+$/g, "")));
  return token ? cleanPath(token.replace(/[,:;.)]+$/g, "")) : undefined;
}

function looksLikePath(value: string): boolean {
  return /^(\.\/|\.\.|[A-Za-z0-9_.-]+\/)/.test(value) || /\.(ts|tsx|js|jsx|mjs|cjs|json|md|yml|yaml|toml|txt|py|go|rs|java|kt|rb|php|cs|cpp|c|h)$/i.test(value);
}

function cleanPath(value: string): string {
  return value.trim().replace(/^\.\//, "");
}

function normalizeStatus(value: MissingContextStatus | string): MissingContextStatus {
  const normalized = value.trim().toLowerCase();
  if (missingContextStatuses.includes(normalized as MissingContextStatus)) return normalized as MissingContextStatus;
  throw new Error(`Invalid missing-context status: ${value}`);
}

function normalizeKind(value: MissingContextKind | string): MissingContextKind {
  const normalized = value.trim().toLowerCase();
  if (missingContextKinds.includes(normalized as MissingContextKind)) return normalized as MissingContextKind;
  throw new Error(`Invalid missing-context kind: ${value}`);
}

function sortMissingContextRequests(requests: MissingContextRequest[]): MissingContextRequest[] {
  return [...requests].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
}

function cleanRequired(value: string | undefined, message: string): string {
  const cleaned = clean(value);
  if (!cleaned) throw new Error(message);
  return cleaned;
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function normalizeList(values: string[] | undefined): string[] | undefined {
  const normalized = (values ?? []).map((value) => value.trim()).filter(Boolean);
  return normalized.length > 0 ? unique(normalized) : undefined;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

function safeId(value: string): string {
  return value.replace(/[^A-Za-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "REQUEST";
}

function shortHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function normalizeDedupeKey(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

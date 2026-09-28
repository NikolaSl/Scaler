/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import { lstat, mkdir, readFile, rmdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { ensureTaskContextManifest, normalizeTaskScopedContextPath, resolveTaskContextManifest, saveTaskContextManifest, trimMarkdownHeadingWhitespace, type FileContextSelector, type TaskContextManifestItem } from "./context.js";
import { appendLogEvent, createLogEvent } from "./logging.js";
import { searchMemory } from "./memory.js";
import { getMissingContextRequestsPath, getTaskContextManifestPath } from "./paths.js";
import { loadResearchReports, upsertResearchRequest } from "./research.js";
import { loadState, saveState } from "./state.js";
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
  state: ScalerState;
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
  if (request.kind === "file") return { accepted: false, action: "blocked", request, message: `Exact file context requires scoped file dispatch: ${request.id}` };
  const summary = typeof input.summary === "string" ? input.summary.trim() : "";
  if (!summary || summary.length > 16_384) return { accepted: false, action: "blocked", request, message: `Manual answer is empty or exceeds the bounded context: ${request.id}` };
  const liveState = await loadState(cwd);
  if (!liveState.tasks.some((task) => task.id === request.taskId)) return { accepted: false, action: "blocked", request, message: `Missing-context task is unavailable: ${request.taskId}` };
  const evidenceRefs = normalizeList([...(request.evidenceRefs ?? []), ...(input.evidenceRefs ?? [])]);
  const content = `Manual answer (operator-provided claim): ${JSON.stringify({ requestId: request.id, summary, evidenceRefs })}`;
  if (content.length > 16_384) return { accepted: false, action: "blocked", request, message: `Manual answer exceeds the bounded context: ${request.id}` };
  const manifest = await ensureTaskContextManifest(cwd, liveState, request.taskId);
  const id = `missing-manual-${request.id}`;
  const existing = manifest.items.find((item) => item.id === id);
  if (existing && (existing.source !== "inline" || existing.priority !== "required" || existing.content !== content)) {
    return { accepted: false, action: "blocked", request, message: `Manual answer conflicts with required context: ${request.id}` };
  }
  if (!existing) await saveTaskContextManifest(cwd, { ...manifest, items: [...manifest.items, {
    id, type: "knowledge", source: "inline", priority: "required", scope: "full", exactness: "exact",
    reason: `Attributed manual answer for missing-context request ${request.id}; claims may require source verification.`,
    content,
  }] });
  const resolved = await upsertMissingContextRequest(cwd, {
    ...request,
    status: "resolved",
    resultSummary: summary,
    evidenceRefs,
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
  const blockedRequestIds: string[] = [];
  let nextRequests = requests;
  let nextState = state;

  const blockRequest = (request: MissingContextRequest, reason: string): void => {
    const task = nextState.tasks.find((candidate) => candidate.id === request.taskId);
    if (task && ["ready", "running", "validating", "debugging"].includes(task.status)) {
      nextState = transitionTask(nextState, task.id, "blocked", { reason, now });
    }
    if (request.status === "blocked" && request.resultSummary === reason) return;
    const blocked: MissingContextRequest = {
      ...request,
      status: "blocked",
      resultSummary: reason,
      updatedAt: now.toISOString(),
    };
    nextRequests = [...nextRequests.filter((candidate) => candidate.id !== request.id), blocked];
    blockedRequestIds.push(request.id);
  };

  for (const request of requests) {
    if ((request.kind !== "local_research" && request.kind !== "internet_research") || request.status === "superseded") continue;
    if (request.status === "resolved" && request.kind !== "local_research") continue;
    const task = state.tasks.find((candidate) => candidate.id === request.taskId);
    if (!task) continue;
    const matchingReport = reports.find((report) => report.status === "complete"
      && report.taskId === request.taskId
      && report.question === request.query
      && (request.evidenceRefs ?? []).includes(report.requestId ?? "")
      && report.conclusions.length > 0
      && (report.unresolvedUnknowns ?? []).length === 0
      && !(report.contradictions ?? []).some((contradiction) => contradiction.status === "unresolved"));
    if (!matchingReport) continue;
    const referencedSourceIds = new Set(matchingReport.conclusions.flatMap((conclusion) => conclusion.sourceRefs));
    const referencedSources = matchingReport.sources.filter((source) => referencedSourceIds.has(source.id));
    const fileSources = referencedSources.filter((source) => source.path);
    const manifest = await ensureTaskContextManifest(cwd, state, request.taskId);
    const sourceItems: TaskContextManifestItem[] = [];
    if (request.kind === "local_research") {
      let invalidSource: string | undefined;
      if (referencedSources.length === 0 || referencedSources.some((source) => !source.path)) {
        invalidSource = "Local research conclusions require cited task-scoped file sources.";
      }
      for (const [index, source] of fileSources.entries()) {
        if (invalidSource) break;
        const path = normalizeTaskScopedContextPath(cwd, source.path!, task);
        if (!path) {
          invalidSource = `Research source is outside the task's direct workspace scope: ${source.path}`;
          break;
        }
        if (!source.contentFingerprint) {
          invalidSource = `Research source has no stable recorded content version: ${source.path}`;
          break;
        }
        const item: TaskContextManifestItem = {
          id: `missing-research-source-${request.id}-${index}`,
          type: "file",
          source: "file",
          path,
          sourceFingerprint: source.contentFingerprint,
          priority: "required",
          scope: "reference-only",
          exactness: "reference-only",
          reason: `Stable source binding for missing-context research request ${request.id}.`,
        };
        const existingSource = manifest.items.find((candidate) => candidate.id === item.id);
        if (existingSource && (existingSource.source !== item.source || existingSource.path !== item.path
          || existingSource.sourceFingerprint !== item.sourceFingerprint || existingSource.priority !== item.priority
          || existingSource.scope !== item.scope)) {
          invalidSource = `Research source conflicts with the existing manifest: ${item.id}`;
          break;
        }
        sourceItems.push(existingSource ?? item);
      }
      if (invalidSource) {
        await removeResearchContextItems(cwd, manifest, request.id);
        blockRequest(request, invalidSource);
        continue;
      }
    }
    const content = `Research answer (reported claim, not verified source bytes): ${JSON.stringify({
      reportId: matchingReport.id,
      sources: referencedSources.map((source) => ({ id: source.id, title: source.title, path: source.path, url: source.url, version: source.version, contentFingerprint: source.contentFingerprint, summary: source.summary })),
      conclusions: matchingReport.conclusions.map((conclusion) => ({ summary: conclusion.summary, confidence: conclusion.confidence, sourceRefs: conclusion.sourceRefs })),
    })}`;
    if (content.length > 16_384) continue;
    const id = `missing-research-${request.id}`;
    const existing = manifest.items.find((item) => item.id === id);
    if (existing && (existing.source !== "inline" || existing.priority !== "required" || existing.content !== content)) {
      if (request.kind === "local_research") {
        await removeResearchContextItems(cwd, manifest, request.id);
        blockRequest(request, `Research answer conflicts with the existing manifest: ${id}`);
      }
      continue;
    }
    const answer: TaskContextManifestItem = existing ?? {
      id, type: "knowledge", source: "inline", priority: "required", scope: "full", exactness: "exact",
      reason: `Attributed research answer for missing-context request ${request.id}; source bytes may still need a separate request.`,
      content,
    };
    const additions = [...sourceItems.filter((item) => !manifest.items.some((candidate) => candidate.id === item.id)), ...(existing ? [] : [answer])];
    const candidate = { ...manifest, items: [...manifest.items, ...additions] };
    if (sourceItems.length > 0) {
      const resolvedItems = await resolveTaskContextManifest(cwd, state, candidate);
      const unavailable = sourceItems.find((item) => !resolvedItems.find((resolved) => resolved.id === item.id)?.available);
      if (unavailable) {
        await removeResearchContextItems(cwd, manifest, request.id);
        blockRequest(request, `Research source changed or is unavailable: ${unavailable.path}`);
        continue;
      }
    }
    if (additions.length > 0) await saveTaskContextManifest(cwd, candidate);
    if (request.status === "resolved") continue;
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

  if (resolvedRequestIds.length > 0 || blockedRequestIds.length > 0) {
    await saveMissingContextRequests(cwd, nextRequests);
    await appendLogEvent(cwd, createLogEvent(state, {
      eventType: "system",
      summary: `Missing-context research refresh completed: resolved=${resolvedRequestIds.join(", ") || "none"} blocked=${blockedRequestIds.join(", ") || "none"}`,
      details: { resolvedRequestIds, blockedRequestIds },
    }));
  }
  if (nextState !== state) await saveState(cwd, nextState);
  return { requests: sortMissingContextRequests(nextRequests), resolvedRequestIds, state: nextState };
}

async function removeResearchContextItems(cwd: string, manifest: Awaited<ReturnType<typeof ensureTaskContextManifest>>, requestId: string): Promise<void> {
  const answerId = `missing-research-${requestId}`;
  const sourcePrefix = `missing-research-source-${requestId}-`;
  const items = manifest.items.filter((item) => item.id !== answerId && !item.id.startsWith(sourcePrefix));
  if (items.length !== manifest.items.length) await saveTaskContextManifest(cwd, { ...manifest, items });
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
  const refreshed = await refreshMissingContextResolutions(cwd, state);
  return await unblockTasksWithResolvedMissingContext(cwd, refreshed.state);
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
  return await withTaskContextManifestLock(cwd, request.taskId, async () => {
    const state = await loadState(cwd);
    if (!state.tasks.some((task) => task.id === request.taskId)) {
      return await markMissingContextBlocked(cwd, request, `Missing-context task is unavailable: ${request.taskId}`, now);
    }
    const manifest = await ensureTaskContextManifest(cwd, state, request.taskId);
    const items: TaskContextManifestItem[] = [];
    for (const { entry } of results) {
      const existing = manifest.items.find((candidate) => candidate.memoryId === entry.id);
      const id = existing?.id ?? `missing-memory-${safeId(request.id)}-${shortHash(entry.id)}`;
      const idOwner = manifest.items.find((candidate) => candidate.id === id);
      if ((existing && (existing.source !== "memory" || existing.scope !== "summary" || existing.exactness !== "summary-ok"))
        || (idOwner && idOwner !== existing)) {
        return await markMissingContextBlocked(cwd, request, `Memory candidate conflicts with the existing manifest: ${id}`, now);
      }
      items.push({
        id,
        type: "memory",
        source: "memory",
        memoryId: entry.id,
        priority: "required",
        scope: "summary",
        exactness: "summary-ok",
        reason: `Bounded memory candidate for missing-context request ${request.id}; candidate validity remains visible to the worker.`,
      });
    }
    const candidate = {
      ...manifest,
      items: [
        ...manifest.items.filter((existing) => !items.some((item) => item.id === existing.id)),
        ...items,
      ],
    };
    const resolvedItems = await resolveTaskContextManifest(cwd, state, candidate);
    const supplied = items.map((item) => resolvedItems.find((resolved) => resolved.id === item.id));
    if (supplied.some((item) => !item?.available)) {
      return await markMissingContextBlocked(cwd, request, "A matched memory candidate is unavailable.", now);
    }
    if (supplied.reduce((total, item) => total + (item?.content.length ?? 0), 0) > 16_384) {
      return await markMissingContextBlocked(cwd, request, "Matched memory candidate summaries exceed the bounded context; narrow the request.", now);
    }
    if (JSON.stringify(candidate.items) !== JSON.stringify(manifest.items)) await saveTaskContextManifest(cwd, candidate);
    const evidenceRefs = results.map((result) => result.entry.id);
    const resolved = await upsertMissingContextRequest(cwd, {
      ...request,
      status: "resolved",
      evidenceRefs: unique([...(request.evidenceRefs ?? []), ...evidenceRefs]),
      resultSummary: `Supplied bounded memory candidate summaries: ${evidenceRefs.join(", ")}`,
    }, now);
    return { accepted: true, action: "resolved", request: resolved, message: `Missing-context memory request resolved: ${request.id}` };
  });
}

async function dispatchFileRequest(cwd: string, request: MissingContextRequest, options: MissingContextDispatchOptions, now: Date): Promise<MissingContextDispatchResult> {
  const source = request.sourceHint;
  if (!source) return await markMissingContextBlocked(cwd, request, "No file path was supplied or inferred.", now);
  const parsedSelector = parseRequestedFileSelector(request.query, source);
  if (parsedSelector.requested && !parsedSelector.selector) {
    return await markMissingContextBlocked(cwd, request, "The exact file-section selector is malformed or ambiguous.", now);
  }
  if (!options.execute) return { accepted: true, action: "planned", request, message: `Missing-context file retrieval planned: ${request.id} source=${source}` };
  const state = await loadState(cwd);
  const currentTask = state.tasks.find((candidate) => candidate.id === request.taskId);
  const path = normalizeTaskScopedContextPath(cwd, source, currentTask);
  if (!path) return await markMissingContextBlocked(cwd, request, "File source is outside the task's direct workspace scope.", now);
  const parts = path.split("/");
  try {
    for (let depth = 1; depth <= parts.length; depth++) {
      const observed = await lstat(join(cwd, ...parts.slice(0, depth)));
      if (observed.isSymbolicLink() || (depth < parts.length ? !observed.isDirectory() : !observed.isFile())) {
        return await markMissingContextBlocked(cwd, request, `Source is not a direct regular file: ${source}`, now);
      }
      if (depth === parts.length && observed.size > 1024 * 1024) {
        return await markMissingContextBlocked(cwd, request, `Source exceeds the bounded file request; ask for an exact section: ${source}`, now);
      }
    }
    const manifest = await ensureTaskContextManifest(cwd, state, request.taskId);
    const id = `missing-context-${request.id}`;
    const existing = manifest.items.find((item) => item.id === id);
    const scope = parsedSelector.selector ? "section" : "full";
    if (existing && (existing.source !== "file" || existing.path !== path || existing.priority !== "required"
      || existing.scope !== scope || !sameFileSelector(existing.selector, parsedSelector.selector))) {
      return await markMissingContextBlocked(cwd, request, `Requested context item conflicts with the existing manifest: ${id}`, now);
    }
    const item: TaskContextManifestItem = existing ?? {
      id, type: "file", source: "file", path, scope, exactness: "exact", priority: "required",
      ...(parsedSelector.selector ? { selector: parsedSelector.selector } : {}),
      reason: `Missing-context request ${request.id} requires this exact source before retry.`,
    };
    const candidate = { ...manifest, items: existing ? manifest.items : [...manifest.items, item] };
    const resolvedItems = await resolveTaskContextManifest(cwd, state, candidate);
    const resolvedItem = resolvedItems.find((entry) => entry.id === id);
    if (!resolvedItem?.available || !resolvedItem.fileSource?.outputExemptible) {
      return await markMissingContextBlocked(cwd, request, `Requested source is unavailable as a stable direct file: ${source}`, now);
    }
    if (!existing) await saveTaskContextManifest(cwd, candidate);
    const resolved = await upsertMissingContextRequest(cwd, {
      ...request,
      status: "resolved",
      evidenceRefs: unique([...(request.evidenceRefs ?? []), path]),
      resultSummary: `Required exact file ${scope === "section" ? "section" : "context"} ${path} (${resolvedItem.content.length} chars) is available in the task manifest.`,
    }, now);
    return { accepted: true, action: "resolved", request: resolved, message: `Missing-context file request resolved: ${request.id}` };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return await markMissingContextBlocked(cwd, request, `File not found: ${source}`, now);
    if (parsedSelector.requested) {
      const message = error instanceof Error ? error.message : String(error);
      return await markMissingContextBlocked(cwd, request, `Exact file section is unavailable: ${message}`, now);
    }
    throw error;
  }
}

function parseRequestedFileSelector(query: string, source: string): { requested: boolean; selector?: FileContextSelector } {
  const quoted = [...query.matchAll(/`([^`\r\n]*)`/g)].map((match) => match[1] ?? "");
  const quotedSourceMatches = looksLikePath(quoted[0] ?? "") && cleanPath(quoted[0] ?? "") === source;
  const directiveIndexes = quoted
    .map((value, index) => index > 0 && (value.startsWith("heading:") || value.startsWith("function:")) ? index : -1)
    .filter((index) => index >= 0);
  if (directiveIndexes.length === 0) {
    const detachedFirstDirective = !quotedSourceMatches
      && (quoted[0]?.startsWith("heading:") || quoted[0]?.startsWith("function:"));
    return { requested: Boolean(detachedFirstDirective) };
  }
  if (directiveIndexes.length !== 1 || directiveIndexes[0] !== 1
    || !quotedSourceMatches) return { requested: true };
  const directive = quoted[1]!;
  if (directive.startsWith("heading:")) {
    const heading = trimMarkdownHeadingWhitespace(directive.slice("heading:".length));
    return heading ? { requested: true, selector: { kind: "markdown-heading", heading } } : { requested: true };
  }
  const name = directive.slice("function:".length);
  return name && name === name.trim() && !/\s/.test(name)
    ? { requested: true, selector: { kind: "typescript-function", name } }
    : { requested: true };
}

function sameFileSelector(first: FileContextSelector | undefined, second: FileContextSelector | undefined): boolean {
  if (!first || !second) return first === second;
  return first.kind === second.kind && (first.kind === "markdown-heading"
    ? first.heading === (second as typeof first).heading
    : first.name === (second as typeof first).name);
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

async function withTaskContextManifestLock<T>(cwd: string, taskId: string, fn: () => Promise<T>): Promise<T> {
  const lockPath = `${getTaskContextManifestPath(cwd, taskId)}.lock`;
  await mkdir(dirname(lockPath), { recursive: true });
  let acquired = false;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      await mkdir(lockPath);
      acquired = true;
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await delay(10);
    }
  }
  if (!acquired) throw new Error(`Task context manifest is locked by another active operation: ${taskId}`);
  try {
    return await fn();
  } finally {
    await rmdir(lockPath);
  }
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

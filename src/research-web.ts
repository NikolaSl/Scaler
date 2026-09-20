/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { appendLogEvent, createLogEvent } from "./logging.js";
import { getResearchTransactionsPath } from "./paths.js";
import type { ProviderAdmissionModel } from "./provider-admission.js";
import { loadResearchRequests, type ResearchRequest, type ResearchReport, type ResearchSource } from "./research.js";
import { runResearchAgentStep, type ResearchAgentRunner, type ResearchAgentStepResult } from "./research-agent.js";
import { loadToolSchemaRecords, type ToolSchemaRecord } from "./tool-requests.js";
import type { ScalerState } from "./types.js";

export type ResearchWebTransactionKind = "tool_discovery" | "query" | "source_review";
export type ResearchWebTransactionStatus = "planned" | "completed" | "blocked" | "failed";
export type ResearchSourceFreshnessStatus = "project_local" | "versioned" | "recently_checked" | "stale_check" | "unknown";

export interface ResearchToolCandidate {
  name: string;
  source: string;
  riskLevel: string;
  docsRef?: string;
  schemaRef?: string;
  notes?: string;
}

export interface ResearchWebTransactionRecord {
  version: 1;
  id: string;
  requestId: string;
  kind: ResearchWebTransactionKind;
  status: ResearchWebTransactionStatus;
  query?: string;
  tools?: string[];
  reportId?: string;
  sourceId?: string;
  sourceTitle?: string;
  sourceUrl?: string;
  sourceVersion?: string;
  freshnessStatus?: ResearchSourceFreshnessStatus;
  message: string;
  createdAt: string;
  updatedAt: string;
}

export interface ResearchWebRunOptions {
  requestId?: string;
  execute?: boolean;
  allowInternet?: boolean;
  tools?: string[];
  maxQueries?: number;
  timeoutMs?: number;
  command?: string;
  model?: string;
  providerAdmissionModel?: ProviderAdmissionModel;
}

export interface ResearchWebRunResult {
  accepted: boolean;
  executed: boolean;
  message: string;
  request?: ResearchRequest;
  tools: string[];
  queries: string[];
  transactions: ResearchWebTransactionRecord[];
  researchAgent?: ResearchAgentStepResult;
}

interface ResearchWebTransactionIndex {
  version: 1;
  transactions: ResearchWebTransactionRecord[];
}

export async function loadResearchWebTransactions(cwd: string): Promise<ResearchWebTransactionRecord[]> {
  try {
    const parsed = JSON.parse(await readFile(getResearchTransactionsPath(cwd), "utf8")) as ResearchWebTransactionIndex;
    if (parsed.version !== 1 || !Array.isArray(parsed.transactions)) return [];
    return parsed.transactions.map(normalizeTransaction).filter((record): record is ResearchWebTransactionRecord => Boolean(record));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function saveResearchWebTransactions(cwd: string, records: ResearchWebTransactionRecord[]): Promise<ResearchWebTransactionRecord[]> {
  const sorted = [...records].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  const path = getResearchTransactionsPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ version: 1, transactions: sorted } satisfies ResearchWebTransactionIndex, null, 2)}\n`, "utf8");
  return sorted;
}

export async function appendResearchWebTransactions(cwd: string, records: ResearchWebTransactionRecord[]): Promise<ResearchWebTransactionRecord[]> {
  return saveResearchWebTransactions(cwd, [...(await loadResearchWebTransactions(cwd)), ...records]);
}

export async function discoverResearchToolCandidates(cwd: string): Promise<ResearchToolCandidate[]> {
  const records = await loadToolSchemaRecords(cwd);
  const latest = latestSchemaByTool(records).filter((record) => isResearchToolName(record.toolName));
  return latest.map((record) => ({
    name: record.toolName,
    source: record.source,
    riskLevel: record.riskLevel,
    docsRef: record.docsRef,
    schemaRef: record.schemaRef,
    notes: record.notes,
  }));
}

export function buildResearchQueryPlan(question: string, maxQueries = 3): string[] {
  const clean = question.trim().replace(/\s+/g, " ");
  if (!clean) return [];
  const candidates = [
    clean,
    `${clean} official documentation`,
    `${clean} version compatibility release notes`,
  ];
  return uniqueNonEmpty(candidates).slice(0, normalizeMaxQueries(maxQueries));
}

export function assessResearchSourceFreshness(source: ResearchSource, now = new Date()): ResearchSourceFreshnessStatus {
  if (source.path && !source.url) return "project_local";
  if (source.version?.trim()) return "versioned";
  const checked = Date.parse(source.checkedAt);
  if (!Number.isFinite(checked)) return "unknown";
  const ageDays = (now.getTime() - checked) / 86_400_000;
  if (ageDays <= 180) return "recently_checked";
  if (ageDays > 365) return "stale_check";
  return "unknown";
}

export async function runResearchWebWorkflow(
  cwd: string,
  state: ScalerState,
  options: ResearchWebRunOptions = {},
  runner?: ResearchAgentRunner,
): Promise<ResearchWebRunResult> {
  const request = await selectWebResearchRequest(cwd, options.requestId);
  if (!request) {
    const message = options.requestId ? `Web research rejected: no internet/mixed research request ${options.requestId}.` : "Web research rejected: no open internet/mixed research request.";
    await appendLogEvent(cwd, createLogEvent(state, { eventType: "research", summary: message, details: options }));
    return { accepted: false, executed: options.execute === true, message, tools: [], queries: [], transactions: [] };
  }

  const discovered = await discoverResearchToolCandidates(cwd);
  const tools = uniqueNonEmpty([...(options.tools ?? []), ...(options.tools?.length ? [] : discovered.map((candidate) => candidate.name))]);
  const queries = buildResearchQueryPlan(request.question, options.maxQueries);
  const now = new Date();
  const plannedTransactions = [
    createTransaction(request.id, "tool_discovery", tools.length > 0 ? "completed" : "blocked", {
      tools,
      message: tools.length > 0
        ? `Discovered/granted research tools: ${tools.join(", ")}`
        : "No browser/search/MCP research tools discovered or explicitly granted.",
      now,
    }),
    ...queries.map((query) => createTransaction(request.id, "query", "planned", {
      query,
      tools,
      message: `Planned web research query: ${query}`,
      now,
    })),
  ];
  await appendResearchWebTransactions(cwd, plannedTransactions);

  if (!options.execute) {
    const message = `Web research planned: request=${request.id} queries=${queries.length} tools=${tools.length}`;
    await appendLogEvent(cwd, createLogEvent(state, { eventType: "research", summary: message, taskId: request.taskId, details: { request, tools, queries, plannedTransactions } }));
    return { accepted: true, executed: false, message, request, tools, queries, transactions: plannedTransactions };
  }

  if (!options.allowInternet) {
    const blocked = queries.map((query) => createTransaction(request.id, "query", "blocked", {
      query,
      tools,
      message: "Internet execution was not explicitly granted.",
    }));
    await appendResearchWebTransactions(cwd, blocked);
    const message = `Web research blocked: internet grant required for ${request.id}.`;
    await appendLogEvent(cwd, createLogEvent(state, { eventType: "research", summary: message, taskId: request.taskId, details: { request, tools, queries, blocked } }));
    return { accepted: false, executed: true, message, request, tools, queries, transactions: [...plannedTransactions, ...blocked] };
  }

  if (tools.length === 0) {
    const blocked = queries.map((query) => createTransaction(request.id, "query", "blocked", {
      query,
      tools,
      message: "No discovered or explicit browser/search/MCP tools are available for execution.",
    }));
    await appendResearchWebTransactions(cwd, blocked);
    const message = `Web research blocked: no research tools available for ${request.id}.`;
    await appendLogEvent(cwd, createLogEvent(state, { eventType: "research", summary: message, taskId: request.taskId, details: { request, tools, queries, blocked } }));
    return { accepted: false, executed: true, message, request, tools, queries, transactions: [...plannedTransactions, ...blocked] };
  }

  const extraInstructions = buildWebResearchExtraInstructions(queries, tools);
  const researchAgent = await runResearchAgentStep(cwd, state, {
    requestId: request.id,
    execute: true,
    allowInternet: true,
    tools,
    timeoutMs: options.timeoutMs,
    command: options.command,
    model: options.model,
    providerAdmissionModel: options.providerAdmissionModel,
    extraInstructions,
  }, runner);

  const report = researchAgent.ingestion?.report;
  const completedQueries = queries.map((query) => createTransaction(request.id, "query", researchAgent.accepted && report ? "completed" : "failed", {
    query,
    tools,
    reportId: report?.id,
    message: report ? `Research query covered by report ${report.id}.` : `Research query did not produce an ingested report: ${researchAgent.message}`,
  }));
  const sourceReviews = report ? buildSourceReviewTransactions(request.id, report) : [];
  await appendResearchWebTransactions(cwd, [...completedQueries, ...sourceReviews]);

  const accepted = Boolean(researchAgent.accepted && report);
  const message = accepted
    ? `Web research executed: request=${request.id} report=${report?.id} sources=${report?.sources.length ?? 0}`
    : `Web research failed: request=${request.id} ${researchAgent.message}`;
  await appendLogEvent(cwd, createLogEvent(state, { eventType: "research", summary: message, taskId: request.taskId, details: { request, tools, queries, researchAgent, completedQueries, sourceReviews } }));
  return { accepted, executed: true, message, request, tools, queries, transactions: [...plannedTransactions, ...completedQueries, ...sourceReviews], researchAgent };
}

export function formatResearchWebTransactions(records: ResearchWebTransactionRecord[], requestId?: string, limit = 20): string {
  const filtered = requestId ? records.filter((record) => record.requestId === requestId) : records;
  if (filtered.length === 0) return requestId ? `No research web transactions for ${requestId}.` : "No research web transactions.";
  const lines = [requestId ? `Research web transactions for ${requestId}:` : "Research web transactions:"];
  for (const record of filtered.slice(0, limit)) {
    const detail = record.query ? ` query=${record.query}` : record.sourceId ? ` source=${record.sourceId}` : "";
    const freshness = record.freshnessStatus ? ` freshness=${record.freshnessStatus}` : "";
    lines.push(`- ${record.id} ${record.kind} status=${record.status}${detail}${freshness}: ${record.message}`);
  }
  return lines.join("\n");
}

export function formatResearchWebRunResult(result: ResearchWebRunResult): string {
  const lines = [`Web research: accepted=${result.accepted} executed=${result.executed} request=${result.request?.id ?? "n/a"} queries=${result.queries.length} tools=${result.tools.length}`];
  lines.push(result.message);
  for (const transaction of result.transactions.slice(0, 10)) {
    lines.push(`- ${transaction.kind} ${transaction.status}: ${transaction.query ?? transaction.sourceId ?? transaction.message}`);
  }
  return lines.join("\n");
}

function buildWebResearchExtraInstructions(queries: string[], tools: string[]): string {
  return [
    "Execute this as a multi-step web research transaction.",
    "Use the explicitly granted browser/search/MCP tools only.",
    `Granted web research tools: ${tools.join(", ")}`,
    "Run or inspect these queries in order, stopping when enough high-quality evidence is collected:",
    ...queries.map((query, index) => `${index + 1}. ${query}`),
    "Prefer official, primary, version-matched, and recently checked sources.",
    "For every web source, include url, checkedAt, version when available, and a concise summary.",
    "Store long raw excerpts in rawEvidence so SCALER can externalize them to memory.",
  ].join("\n");
}

function buildSourceReviewTransactions(requestId: string, report: ResearchReport): ResearchWebTransactionRecord[] {
  return report.sources.map((source) => createTransaction(requestId, "source_review", "completed", {
    reportId: report.id,
    sourceId: source.id,
    sourceTitle: source.title,
    sourceUrl: source.url,
    sourceVersion: source.version,
    freshnessStatus: assessResearchSourceFreshness(source),
    message: `Reviewed source ${source.id} quality=${source.quality}.`,
  }));
}

function createTransaction(
  requestId: string,
  kind: ResearchWebTransactionKind,
  status: ResearchWebTransactionStatus,
  input: Partial<ResearchWebTransactionRecord> & { now?: Date },
): ResearchWebTransactionRecord {
  const timestamp = (input.now ?? new Date()).toISOString();
  return {
    version: 1,
    id: `RESEARCH-TXN-${timestamp.replace(/[^0-9]/g, "")}-${kind}-${Math.random().toString(36).slice(2, 8)}`,
    requestId,
    kind,
    status,
    query: input.query,
    tools: input.tools,
    reportId: input.reportId,
    sourceId: input.sourceId,
    sourceTitle: input.sourceTitle,
    sourceUrl: input.sourceUrl,
    sourceVersion: input.sourceVersion,
    freshnessStatus: input.freshnessStatus,
    message: input.message ?? `${kind} ${status}`,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

async function selectWebResearchRequest(cwd: string, requestId?: string): Promise<ResearchRequest | undefined> {
  const requests = await loadResearchRequests(cwd);
  const candidates = requests.filter((request) => (request.status === "open" || request.status === "in_progress") && (request.scope === "internet" || request.scope === "mixed"));
  if (requestId) return candidates.find((request) => request.id === requestId.trim());
  return candidates.sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
}

function latestSchemaByTool(records: ToolSchemaRecord[]): ToolSchemaRecord[] {
  const sorted = [...records].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const seen = new Set<string>();
  const latest: ToolSchemaRecord[] = [];
  for (const record of sorted) {
    if (seen.has(record.toolName)) continue;
    seen.add(record.toolName);
    latest.push(record);
  }
  return latest;
}

function isResearchToolName(name: string): boolean {
  return /(?:browser|brave|search|web|docs|documentation|mcp)/i.test(name);
}

function normalizeMaxQueries(maxQueries: number | undefined): number {
  if (maxQueries === undefined || !Number.isFinite(maxQueries)) return 3;
  return Math.min(Math.max(Math.trunc(maxQueries), 1), 5);
}

function uniqueNonEmpty(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizeTransaction(value: unknown): ResearchWebTransactionRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" && record.id.trim() ? record.id.trim() : undefined;
  const requestId = typeof record.requestId === "string" && record.requestId.trim() ? record.requestId.trim() : undefined;
  const kind = record.kind === "tool_discovery" || record.kind === "query" || record.kind === "source_review" ? record.kind : undefined;
  const status = record.status === "planned" || record.status === "completed" || record.status === "blocked" || record.status === "failed" ? record.status : undefined;
  const createdAt = typeof record.createdAt === "string" ? record.createdAt : undefined;
  const updatedAt = typeof record.updatedAt === "string" ? record.updatedAt : undefined;
  if (!id || !requestId || !kind || !status || !createdAt || !updatedAt) return undefined;
  const freshnessStatus = record.freshnessStatus === "project_local" || record.freshnessStatus === "versioned" || record.freshnessStatus === "recently_checked" || record.freshnessStatus === "stale_check" || record.freshnessStatus === "unknown" ? record.freshnessStatus : undefined;
  return {
    version: 1,
    id,
    requestId,
    kind,
    status,
    query: stringField(record.query),
    tools: Array.isArray(record.tools) ? record.tools.filter((tool): tool is string => typeof tool === "string") : undefined,
    reportId: stringField(record.reportId),
    sourceId: stringField(record.sourceId),
    sourceTitle: stringField(record.sourceTitle),
    sourceUrl: stringField(record.sourceUrl),
    sourceVersion: stringField(record.sourceVersion),
    freshnessStatus,
    message: stringField(record.message) ?? "",
    createdAt,
    updatedAt,
  };
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

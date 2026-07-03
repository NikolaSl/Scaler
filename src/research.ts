import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { getResearchReportsPath, getResearchRequestsPath } from "./paths.js";
import { writeMemory } from "./memory.js";

export const researchRequestStatuses = ["open", "in_progress", "resolved", "blocked", "superseded"] as const;
export type ResearchRequestStatus = (typeof researchRequestStatuses)[number];

export const researchScopes = ["local", "internet", "mixed"] as const;
export type ResearchScope = (typeof researchScopes)[number];

export const researchReportStatuses = ["complete", "partial", "blocked"] as const;
export type ResearchReportStatus = (typeof researchReportStatuses)[number];

export const researchSourceQualities = ["project", "official", "primary", "trusted", "reputable", "weak", "unknown"] as const;
export type ResearchSourceQuality = (typeof researchSourceQualities)[number];

export const researchConfidenceLevels = ["high", "medium", "low", "unknown"] as const;
export type ResearchConfidence = (typeof researchConfidenceLevels)[number];

export const researchContradictionStatuses = ["resolved", "unresolved"] as const;
export type ResearchContradictionStatus = (typeof researchContradictionStatuses)[number];

export interface ResearchRequest {
  id: string;
  status: ResearchRequestStatus;
  question: string;
  reason: string;
  scope: ResearchScope;
  taskId?: string;
  requirementRefs?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ResearchRequestInput {
  id?: string;
  status?: ResearchRequestStatus | string;
  question: string;
  reason: string;
  scope?: ResearchScope | string;
  taskId?: string;
  requirementRefs?: string[];
}

export interface ResearchSource {
  id: string;
  title: string;
  quality: ResearchSourceQuality;
  checkedAt: string;
  url?: string;
  path?: string;
  version?: string;
  summary?: string;
}

export interface ResearchConclusion {
  summary: string;
  confidence: ResearchConfidence;
  sourceRefs: string[];
  evidenceRefs?: string[];
}

export interface ResearchContradiction {
  summary: string;
  status: ResearchContradictionStatus;
  sourceRefs: string[];
  resolution?: string;
}

export interface ResearchRawEvidenceInput {
  title: string;
  content: string;
  sourceId?: string;
  summary?: string;
}

export interface ResearchSourceInput {
  id: string;
  title: string;
  quality: ResearchSourceQuality | string;
  checkedAt?: string;
  url?: string;
  path?: string;
  version?: string;
  summary?: string;
}

export interface ResearchConclusionInput {
  summary: string;
  confidence: ResearchConfidence | string;
  sourceRefs: string[];
  evidenceRefs?: string[];
}

export interface ResearchContradictionInput {
  summary: string;
  status: ResearchContradictionStatus | string;
  sourceRefs: string[];
  resolution?: string;
}

export interface ResearchReport {
  id: string;
  status: ResearchReportStatus;
  question: string;
  requestId?: string;
  taskId?: string;
  requirementRefs?: string[];
  sources: ResearchSource[];
  conclusions: ResearchConclusion[];
  contradictions?: ResearchContradiction[];
  unresolvedUnknowns?: string[];
  recommendations?: string[];
  memoryRefs?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ResearchReportInput {
  id?: string;
  status?: ResearchReportStatus | string;
  question: string;
  requestId?: string;
  taskId?: string;
  requirementRefs?: string[];
  sources?: ResearchSourceInput[];
  conclusions?: ResearchConclusionInput[];
  contradictions?: ResearchContradictionInput[];
  unresolvedUnknowns?: string[];
  recommendations?: string[];
  memoryRefs?: string[];
  rawEvidence?: ResearchRawEvidenceInput[];
}

interface ResearchRequestIndex {
  version: 1;
  requests: ResearchRequest[];
}

interface ResearchReportIndex {
  version: 1;
  reports: ResearchReport[];
}

const sourceQualityRank: Record<ResearchSourceQuality, number> = {
  project: 1,
  official: 2,
  primary: 3,
  trusted: 4,
  reputable: 5,
  weak: 6,
  unknown: 7,
};

export function rankResearchSourceQuality(quality: ResearchSourceQuality | string): number {
  if (!researchSourceQualities.includes(quality as ResearchSourceQuality)) return sourceQualityRank.unknown;
  return sourceQualityRank[quality as ResearchSourceQuality];
}

export async function loadResearchRequests(cwd: string): Promise<ResearchRequest[]> {
  try {
    const raw = await readFile(getResearchRequestsPath(cwd), "utf8");
    const index = JSON.parse(raw) as ResearchRequestIndex;
    if (index.version !== 1) throw new Error(`Unsupported research request index version: ${String(index.version)}`);
    for (const request of index.requests) validateResearchRequest(request);
    return sortResearchRequests(index.requests);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function saveResearchRequests(cwd: string, requests: ResearchRequest[]): Promise<ResearchRequest[]> {
  for (const request of requests) validateResearchRequest(request);
  const sorted = sortResearchRequests(requests);
  const path = getResearchRequestsPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ version: 1, requests: sorted }, null, 2)}\n`, "utf8");
  return sorted;
}

export async function upsertResearchRequest(cwd: string, input: ResearchRequestInput, now = new Date()): Promise<ResearchRequest> {
  const timestamp = now.toISOString();
  const existingRequests = await loadResearchRequests(cwd);
  const existing = input.id ? existingRequests.find((request) => request.id === input.id) : undefined;
  const request: ResearchRequest = {
    id: input.id?.trim() || existing?.id || `RESEARCH-${timestamp.replace(/[^0-9]/g, "")}`,
    status: normalizeRequestStatus(input.status ?? existing?.status ?? "open"),
    question: cleanRequired(input.question, "Research question is required."),
    reason: cleanRequired(input.reason, "Research reason is required."),
    scope: normalizeScope(input.scope ?? existing?.scope ?? "local"),
    taskId: clean(input.taskId) ?? existing?.taskId,
    requirementRefs: normalizeList(input.requirementRefs ?? existing?.requirementRefs),
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
  await saveResearchRequests(cwd, [...existingRequests.filter((candidate) => candidate.id !== request.id), request]);
  return request;
}

export async function loadResearchReports(cwd: string): Promise<ResearchReport[]> {
  try {
    const raw = await readFile(getResearchReportsPath(cwd), "utf8");
    const index = JSON.parse(raw) as ResearchReportIndex;
    if (index.version !== 1) throw new Error(`Unsupported research report index version: ${String(index.version)}`);
    for (const report of index.reports) validateResearchReport(report);
    return sortResearchReports(index.reports);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function saveResearchReports(cwd: string, reports: ResearchReport[]): Promise<ResearchReport[]> {
  for (const report of reports) validateResearchReport(report);
  const sorted = sortResearchReports(reports);
  const path = getResearchReportsPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ version: 1, reports: sorted }, null, 2)}\n`, "utf8");
  return sorted;
}

export async function recordResearchReport(cwd: string, input: ResearchReportInput, now = new Date()): Promise<ResearchReport> {
  const timestamp = now.toISOString();
  const reports = await loadResearchReports(cwd);
  const existing = input.id ? reports.find((report) => report.id === input.id) : undefined;
  const memoryRefs = [...(input.memoryRefs ?? existing?.memoryRefs ?? [])];
  for (const evidence of input.rawEvidence ?? []) {
    const memory = await writeMemory(cwd, {
      title: evidence.title,
      content: evidence.content,
      source: evidence.sourceId ? `research:${evidence.sourceId}` : "research",
      taskId: input.taskId,
      summary: evidence.summary,
      now,
    });
    memoryRefs.push(memory.id);
  }

  const report: ResearchReport = {
    id: input.id?.trim() || existing?.id || `RPT-RESEARCH-${timestamp.replace(/[^0-9]/g, "")}`,
    status: normalizeReportStatus(input.status ?? existing?.status ?? "partial"),
    question: cleanRequired(input.question, "Research report question is required."),
    requestId: clean(input.requestId) ?? existing?.requestId,
    taskId: clean(input.taskId) ?? existing?.taskId,
    requirementRefs: normalizeList(input.requirementRefs ?? existing?.requirementRefs),
    sources: normalizeSources(input.sources ?? existing?.sources ?? [], timestamp),
    conclusions: normalizeConclusions(input.conclusions ?? existing?.conclusions ?? []),
    contradictions: normalizeContradictions(input.contradictions ?? existing?.contradictions),
    unresolvedUnknowns: normalizeList(input.unresolvedUnknowns ?? existing?.unresolvedUnknowns),
    recommendations: normalizeList(input.recommendations ?? existing?.recommendations),
    memoryRefs: normalizeList(memoryRefs),
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
  validateResearchReport(report);
  await saveResearchReports(cwd, [...reports.filter((candidate) => candidate.id !== report.id), report]);
  if (report.requestId && report.status === "complete") await markResearchRequestResolved(cwd, report.requestId, now);
  return report;
}

export function formatResearchSummary(requests: ResearchRequest[], reports: ResearchReport[]): string {
  const open = requests.filter((request) => request.status === "open" || request.status === "in_progress");
  const blocked = requests.filter((request) => request.status === "blocked");
  const lines = [`Research: requests=${requests.length} open=${open.length} reports=${reports.length} blocked=${blocked.length}`];
  for (const request of open.slice(0, 10)) {
    const refs = request.requirementRefs?.length ? ` reqs=${request.requirementRefs.join(",")}` : "";
    const task = request.taskId ? ` task=${request.taskId}` : "";
    lines.push(`- request ${request.id}: ${request.status} scope=${request.scope}${task}${refs} question=${request.question}`);
  }
  for (const report of reports.slice(0, 10)) {
    const confidence = highestConfidence(report.conclusions);
    const memories = report.memoryRefs?.length ?? 0;
    lines.push(`- report ${report.id}: ${report.status} sources=${report.sources.length} conclusions=${report.conclusions.length} confidence=${confidence} memory_refs=${memories}`);
  }
  return lines.join("\n");
}

export function validateResearchRequest(request: ResearchRequest): void {
  if (!request.id.trim()) throw new Error("Research request id is required.");
  if (!researchRequestStatuses.includes(request.status)) throw new Error(`Invalid research request status: ${String(request.status)}`);
  if (!request.question.trim()) throw new Error(`Research request ${request.id} question is required.`);
  if (!request.reason.trim()) throw new Error(`Research request ${request.id} reason is required.`);
  if (!researchScopes.includes(request.scope)) throw new Error(`Invalid research request scope: ${String(request.scope)}`);
  if (!request.createdAt.trim()) throw new Error(`Research request ${request.id} createdAt is required.`);
  if (!request.updatedAt.trim()) throw new Error(`Research request ${request.id} updatedAt is required.`);
}

export function validateResearchReport(report: ResearchReport): void {
  if (!report.id.trim()) throw new Error("Research report id is required.");
  if (!researchReportStatuses.includes(report.status)) throw new Error(`Invalid research report status: ${String(report.status)}`);
  if (!report.question.trim()) throw new Error(`Research report ${report.id} question is required.`);
  if (report.sources.length === 0) throw new Error(`Research report ${report.id} requires at least one source.`);
  if (report.conclusions.length === 0 && report.status !== "blocked") throw new Error(`Research report ${report.id} requires conclusions unless blocked.`);
  const sourceIds = new Set<string>();
  for (const source of report.sources) validateResearchSource(source, sourceIds, report.id);
  for (const conclusion of report.conclusions) validateResearchConclusion(conclusion, sourceIds, report.id);
  for (const contradiction of report.contradictions ?? []) validateResearchContradiction(contradiction, sourceIds, report.id);
  if (!report.createdAt.trim()) throw new Error(`Research report ${report.id} createdAt is required.`);
  if (!report.updatedAt.trim()) throw new Error(`Research report ${report.id} updatedAt is required.`);
}

async function markResearchRequestResolved(cwd: string, requestId: string, now: Date): Promise<void> {
  const requests = await loadResearchRequests(cwd);
  const request = requests.find((candidate) => candidate.id === requestId);
  if (!request) return;
  await saveResearchRequests(cwd, requests.map((candidate) => candidate.id === requestId
    ? { ...candidate, status: "resolved", updatedAt: now.toISOString() }
    : candidate));
}

function validateResearchSource(source: ResearchSource, sourceIds: Set<string>, reportId: string): void {
  if (!source.id.trim()) throw new Error(`Research report ${reportId} source id is required.`);
  if (sourceIds.has(source.id)) throw new Error(`Duplicate research source id: ${source.id}`);
  sourceIds.add(source.id);
  if (!source.title.trim()) throw new Error(`Research source ${source.id} title is required.`);
  if (!researchSourceQualities.includes(source.quality)) throw new Error(`Invalid research source quality: ${String(source.quality)}`);
  if (!source.checkedAt.trim()) throw new Error(`Research source ${source.id} checkedAt is required.`);
  if (!source.url && !source.path && !source.summary) throw new Error(`Research source ${source.id} requires url, path, or summary.`);
}

function validateResearchConclusion(conclusion: ResearchConclusion, sourceIds: Set<string>, reportId: string): void {
  if (!conclusion.summary.trim()) throw new Error(`Research report ${reportId} conclusion summary is required.`);
  if (!researchConfidenceLevels.includes(conclusion.confidence)) throw new Error(`Invalid research confidence: ${String(conclusion.confidence)}`);
  if (conclusion.sourceRefs.length === 0) throw new Error(`Research report ${reportId} conclusion requires source refs.`);
  const missing = conclusion.sourceRefs.filter((ref) => !sourceIds.has(ref));
  if (missing.length > 0) throw new Error(`Research report ${reportId} conclusion references unknown sources: ${missing.join(", ")}`);
}

function validateResearchContradiction(contradiction: ResearchContradiction, sourceIds: Set<string>, reportId: string): void {
  if (!contradiction.summary.trim()) throw new Error(`Research report ${reportId} contradiction summary is required.`);
  if (!researchContradictionStatuses.includes(contradiction.status)) throw new Error(`Invalid research contradiction status: ${String(contradiction.status)}`);
  if (contradiction.sourceRefs.length < 2) throw new Error(`Research report ${reportId} contradiction requires at least two source refs.`);
  const missing = contradiction.sourceRefs.filter((ref) => !sourceIds.has(ref));
  if (missing.length > 0) throw new Error(`Research report ${reportId} contradiction references unknown sources: ${missing.join(", ")}`);
  if (contradiction.status === "resolved" && !contradiction.resolution?.trim()) {
    throw new Error(`Research report ${reportId} resolved contradiction requires a resolution.`);
  }
}

function normalizeSources(sources: ResearchSourceInput[], timestamp: string): ResearchSource[] {
  return sources.map((source) => ({
    id: cleanRequired(source.id, "Research source id is required."),
    title: cleanRequired(source.title, "Research source title is required."),
    quality: normalizeSourceQuality(source.quality),
    checkedAt: clean(source.checkedAt) ?? timestamp,
    url: clean(source.url),
    path: clean(source.path),
    version: clean(source.version),
    summary: clean(source.summary),
  })).sort((a, b) => rankResearchSourceQuality(a.quality) - rankResearchSourceQuality(b.quality) || a.id.localeCompare(b.id));
}

function normalizeConclusions(conclusions: ResearchConclusionInput[]): ResearchConclusion[] {
  return conclusions.map((conclusion) => ({
    summary: cleanRequired(conclusion.summary, "Research conclusion summary is required."),
    confidence: normalizeConfidence(conclusion.confidence),
    sourceRefs: normalizeList(conclusion.sourceRefs) ?? [],
    evidenceRefs: normalizeList(conclusion.evidenceRefs),
  }));
}

function normalizeContradictions(contradictions: ResearchContradictionInput[] | undefined): ResearchContradiction[] | undefined {
  const normalized = contradictions?.map((contradiction) => ({
    summary: cleanRequired(contradiction.summary, "Research contradiction summary is required."),
    status: normalizeContradictionStatus(contradiction.status),
    sourceRefs: normalizeList(contradiction.sourceRefs) ?? [],
    resolution: clean(contradiction.resolution),
  }));
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function normalizeRequestStatus(value: ResearchRequestStatus | string): ResearchRequestStatus {
  const normalized = value.trim() as ResearchRequestStatus;
  if (!researchRequestStatuses.includes(normalized)) throw new Error(`Invalid research request status: ${String(value)}`);
  return normalized;
}

function normalizeScope(value: ResearchScope | string): ResearchScope {
  const normalized = value.trim() as ResearchScope;
  if (!researchScopes.includes(normalized)) throw new Error(`Invalid research scope: ${String(value)}`);
  return normalized;
}

function normalizeReportStatus(value: ResearchReportStatus | string): ResearchReportStatus {
  const normalized = value.trim() as ResearchReportStatus;
  if (!researchReportStatuses.includes(normalized)) throw new Error(`Invalid research report status: ${String(value)}`);
  return normalized;
}

function normalizeSourceQuality(value: ResearchSourceQuality | string): ResearchSourceQuality {
  const normalized = value.trim() as ResearchSourceQuality;
  if (!researchSourceQualities.includes(normalized)) throw new Error(`Invalid research source quality: ${String(value)}`);
  return normalized;
}

function normalizeConfidence(value: ResearchConfidence | string): ResearchConfidence {
  const normalized = value.trim() as ResearchConfidence;
  if (!researchConfidenceLevels.includes(normalized)) throw new Error(`Invalid research confidence: ${String(value)}`);
  return normalized;
}

function normalizeContradictionStatus(value: ResearchContradictionStatus | string): ResearchContradictionStatus {
  const normalized = value.trim() as ResearchContradictionStatus;
  if (!researchContradictionStatuses.includes(normalized)) throw new Error(`Invalid research contradiction status: ${String(value)}`);
  return normalized;
}

function highestConfidence(conclusions: ResearchConclusion[]): ResearchConfidence {
  const order: ResearchConfidence[] = ["high", "medium", "low", "unknown"];
  return conclusions.map((conclusion) => conclusion.confidence).sort((a, b) => order.indexOf(a) - order.indexOf(b))[0] ?? "unknown";
}

function sortResearchRequests(requests: ResearchRequest[]): ResearchRequest[] {
  return [...requests].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
}

function sortResearchReports(reports: ResearchReport[]): ResearchReport[] {
  return [...reports].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function cleanRequired(value: string, message: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(message);
  return trimmed;
}

function normalizeList(values: string[] | undefined): string[] | undefined {
  const normalized = Array.from(new Set((values ?? []).map((value) => value.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  return normalized.length > 0 ? normalized : undefined;
}

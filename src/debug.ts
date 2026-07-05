/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { appendLogEvent, createLogEvent } from "./logging.js";
import { getDebugAttemptsPath, getDebugFailuresPath, getDebugReportsPath, getDebugRetriesPath } from "./paths.js";
import { loadReplanDecisions, loadReplanRequests } from "./plans.js";
import { requestReplan } from "./replanning.js";
import { upsertResearchRequest, type ResearchScope } from "./research.js";
import { transitionTask } from "./supervisor.js";
import type { ScalerState } from "./types.js";

export type DebugAttemptResult = "fixed" | "same_failure" | "new_failure" | "partial" | "no_effect" | "worse" | "blocked";

export interface DebugFailureRecord {
  id: string;
  taskId: string;
  fingerprint: string;
  summary?: string;
  validationCommand?: string;
  expectedResult?: string;
  actualResult?: string;
  outputRefs?: string[];
  firstSeenAt: string;
  lastSeenAt: string;
  attemptCount: number;
}

export interface DebugAttemptRecord {
  id: string;
  taskId: string;
  failureId: string;
  hypothesis: string;
  actionSummary: string;
  result: DebugAttemptResult;
  attemptSignature: string;
  failureFingerprint?: string;
  resultingFailureFingerprint?: string;
  changedFiles?: string[];
  commands?: string[];
  evidence?: string[];
  validationRun?: string;
  logRefs?: string[];
  newEvidence?: string;
  cycleDetected?: string;
  timestamp: string;
}

export interface DebugAttemptInput {
  taskId: string;
  failureId: string;
  hypothesis: string;
  actionSummary: string;
  result: DebugAttemptResult | string;
  failureFingerprint?: string;
  resultingFailureFingerprint?: string;
  attemptSignature?: string;
  changedFiles?: string[];
  commands?: string[];
  evidence?: string[];
  validationRun?: string;
  logRefs?: string[];
  newEvidence?: string;
  failureSummary?: string;
  validationCommand?: string;
  expectedResult?: string;
  actualResult?: string;
  outputRefs?: string[];
}

export const debugReportStatuses = ["next_approach", "needs_research", "needs_replan", "blocked"] as const;
export type DebugReportStatus = (typeof debugReportStatuses)[number];

export interface DebugCycleSummary {
  fingerprints: string[];
  attemptIds: string[];
  lastSeenAt: string;
  summary: string;
}

export interface DebugReportRecord {
  id: string;
  taskId: string;
  status: DebugReportStatus;
  summary: string;
  failureId?: string;
  failureFingerprint?: string;
  cycleSummary?: string;
  attemptedApproaches?: string[];
  investigationSummary?: string;
  rootCause?: string;
  nextApproach?: string;
  evidenceRefs?: string[];
  researchQuestions?: string[];
  researchScope?: ResearchScope;
  replanReason?: string;
  exhaustedReason?: string;
  researchRequestIds?: string[];
  replanRequestId?: string;
  createdAt: string;
  updatedAt: string;
}

export type DebugNextApproachRetryStatus = "prepared" | "task_agent_failed" | "exact_validation_passed" | "exact_validation_failed" | "rejected";

export interface DebugNextApproachRetryRecord {
  id: string;
  taskId: string;
  debugReportId: string;
  nextApproach: string;
  previousValidationRunId: string;
  exactCommandIds: string[];
  executed: boolean;
  status: DebugNextApproachRetryStatus;
  taskAgentRunId?: string;
  validationRunId?: string;
  debugAttemptId?: string;
  message: string;
  createdAt: string;
  updatedAt: string;
}

export interface DebugReportInput {
  id?: string;
  taskId: string;
  status: DebugReportStatus | string;
  summary: string;
  failureId?: string;
  failureFingerprint?: string;
  cycleSummary?: string;
  attemptedApproaches?: string[];
  investigationSummary?: string;
  rootCause?: string;
  nextApproach?: string;
  evidenceRefs?: string[];
  researchQuestions?: string[];
  researchScope?: ResearchScope | string;
  replanReason?: string;
  exhaustedReason?: string;
}

export interface DebugReportApplyResult {
  accepted: boolean;
  message: string;
  report?: DebugReportRecord;
  researchRequestIds: string[];
  replanRequestId?: string;
}

export interface DebugAttemptApplyResult {
  accepted: boolean;
  message: string;
  attempt?: DebugAttemptRecord;
  duplicateAttemptId?: string;
  cycleDetected?: string;
  replanRequestId?: string;
}

export interface DebugRetryGateResult {
  allowed: boolean;
  taskId: string;
  reason: string;
  blockingAttemptId?: string;
  failureId?: string;
  replanRequestIds: string[];
  acceptedReplanDecisionIds: string[];
}

interface DebugFailureIndex {
  version: 1;
  failures: DebugFailureRecord[];
}

interface DebugAttemptIndex {
  version: 1;
  attempts: DebugAttemptRecord[];
}

interface DebugReportIndex {
  version: 1;
  reports: DebugReportRecord[];
}

interface DebugRetryIndex {
  version: 1;
  retries: DebugNextApproachRetryRecord[];
}

const debugAttemptResults = new Set<DebugAttemptResult>([
  "fixed",
  "same_failure",
  "new_failure",
  "partial",
  "no_effect",
  "worse",
  "blocked",
]);

export function isDebugAttemptResult(value: unknown): value is DebugAttemptResult {
  return typeof value === "string" && debugAttemptResults.has(value as DebugAttemptResult);
}

export async function loadDebugFailures(cwd: string): Promise<DebugFailureRecord[]> {
  return (await readJsonFile<DebugFailureIndex>(getDebugFailuresPath(cwd), { version: 1, failures: [] })).failures;
}

export async function loadDebugAttempts(cwd: string): Promise<DebugAttemptRecord[]> {
  return (await readJsonFile<DebugAttemptIndex>(getDebugAttemptsPath(cwd), { version: 1, attempts: [] })).attempts;
}

export async function loadDebugReports(cwd: string): Promise<DebugReportRecord[]> {
  return (await readJsonFile<DebugReportIndex>(getDebugReportsPath(cwd), { version: 1, reports: [] })).reports;
}

export async function loadDebugRetries(cwd: string): Promise<DebugNextApproachRetryRecord[]> {
  return (await readJsonFile<DebugRetryIndex>(getDebugRetriesPath(cwd), { version: 1, retries: [] })).retries;
}

export async function saveDebugRetries(cwd: string, retries: DebugNextApproachRetryRecord[]): Promise<DebugNextApproachRetryRecord[]> {
  for (const retry of retries) validateDebugRetry(retry);
  const sorted = [...retries].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  await writeJsonFile(getDebugRetriesPath(cwd), { version: 1, retries: sorted } satisfies DebugRetryIndex);
  return sorted;
}

export async function saveDebugReports(cwd: string, reports: DebugReportRecord[]): Promise<DebugReportRecord[]> {
  for (const report of reports) validateDebugReport(report);
  const sorted = [...reports].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  await writeJsonFile(getDebugReportsPath(cwd), { version: 1, reports: sorted } satisfies DebugReportIndex);
  return sorted;
}

export function formatDebugReportSummary(reports: DebugReportRecord[], limit = 10): string {
  if (reports.length === 0) return "No debug reports.";
  const lines = ["Debug reports:"];
  for (const report of reports.slice(0, limit)) {
    const followUps = [
      report.nextApproach && "next_approach",
      report.researchRequestIds?.length ? `research=${report.researchRequestIds.join(",")}` : undefined,
      report.replanRequestId && `replan=${report.replanRequestId}`,
    ].filter(Boolean).join(" ");
    lines.push(`- ${report.id} task=${report.taskId} status=${report.status} failure=${report.failureId ?? "n/a"}${followUps ? ` ${followUps}` : ""}: ${report.summary}`);
  }
  return lines.join("\n");
}

export async function recordDebugReport(
  cwd: string,
  state: ScalerState,
  input: DebugReportInput,
  now = new Date(),
): Promise<DebugReportApplyResult> {
  const timestamp = now.toISOString();
  const existing = input.id ? (await loadDebugReports(cwd)).find((report) => report.id === input.id) : undefined;
  const report: DebugReportRecord = {
    id: clean(input.id) ?? existing?.id ?? `RPT-DEBUG-${timestamp.replace(/[^0-9]/g, "")}`,
    taskId: cleanRequired(input.taskId, "Debug report taskId is required."),
    status: normalizeDebugReportStatus(input.status),
    summary: cleanRequired(input.summary, "Debug report summary is required."),
    failureId: clean(input.failureId) ?? existing?.failureId,
    failureFingerprint: normalizeFingerprint(input.failureFingerprint ?? existing?.failureFingerprint) || undefined,
    cycleSummary: clean(input.cycleSummary) ?? existing?.cycleSummary,
    attemptedApproaches: normalizeList(input.attemptedApproaches ?? existing?.attemptedApproaches),
    investigationSummary: clean(input.investigationSummary) ?? existing?.investigationSummary,
    rootCause: clean(input.rootCause) ?? existing?.rootCause,
    nextApproach: clean(input.nextApproach) ?? existing?.nextApproach,
    evidenceRefs: normalizeList(input.evidenceRefs ?? existing?.evidenceRefs),
    researchQuestions: normalizeList(input.researchQuestions ?? existing?.researchQuestions),
    researchScope: normalizeResearchScope(input.researchScope ?? existing?.researchScope ?? "local"),
    replanReason: clean(input.replanReason) ?? existing?.replanReason,
    exhaustedReason: clean(input.exhaustedReason) ?? existing?.exhaustedReason,
    researchRequestIds: existing?.researchRequestIds,
    replanRequestId: existing?.replanRequestId,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };

  try {
    validateDebugReport(report);
  } catch (error) {
    const message = `Debug report rejected: ${(error as Error).message}`;
    await appendLogEvent(cwd, createLogEvent(state, { eventType: "debug", summary: message, taskId: input.taskId, details: input }));
    return { accepted: false, message, researchRequestIds: [] };
  }

  const task = state.tasks.find((candidate) => candidate.id === report.taskId);
  const researchRequestIds: string[] = [];
  if (report.status === "needs_research") {
    for (const question of report.researchQuestions ?? []) {
      const request = await upsertResearchRequest(cwd, {
        question,
        reason: `Debug report ${report.id}: ${report.summary}`,
        scope: report.researchScope,
        taskId: report.taskId,
        requirementRefs: task?.prdRefs,
      }, now);
      researchRequestIds.push(request.id);
    }
  }

  let replanRequestId: string | undefined = existing?.replanRequestId;
  let finalState = state;
  if (report.status === "needs_replan" || report.status === "blocked") {
    const reason = report.replanReason ?? report.exhaustedReason ?? report.summary;
    const result = await requestReplan(cwd, state, {
      trigger: "debug_blocked",
      reason,
      taskId: report.taskId,
      evidenceRefs: report.evidenceRefs,
      requirementRefs: task?.prdRefs,
    }, now);
    finalState = result.state;
    replanRequestId = result.request.id;
  }

  const storedReport: DebugReportRecord = {
    ...report,
    researchRequestIds: researchRequestIds.length > 0 ? researchRequestIds : report.researchRequestIds,
    replanRequestId,
  };
  const reports = await loadDebugReports(cwd);
  await saveDebugReports(cwd, [...reports.filter((candidate) => candidate.id !== storedReport.id), storedReport]);
  const message = `Debug report recorded: ${storedReport.id}`;
  await appendLogEvent(cwd, createLogEvent(finalState, {
    eventType: "debug",
    summary: message,
    taskId: storedReport.taskId,
    details: { report: storedReport },
  }));
  return { accepted: true, message, report: storedReport, researchRequestIds, replanRequestId };
}

export async function assessDebugRetryGate(cwd: string, taskId: string): Promise<DebugRetryGateResult> {
  const attempts = (await loadDebugAttempts(cwd))
    .filter((attempt) => attempt.taskId === taskId && attempt.result !== "fixed")
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  if (attempts.length === 0) {
    return { allowed: true, taskId, reason: `No debug retry gate for ${taskId}.`, replanRequestIds: [], acceptedReplanDecisionIds: [] };
  }

  const failures = await loadDebugFailures(cwd);
  const blockingAttempt = attempts.find((attempt) => isBlockingDebugAttempt(attempt, failures));
  if (!blockingAttempt) {
    return { allowed: true, taskId, reason: `No repeated failed debug fingerprint for ${taskId}.`, replanRequestIds: [], acceptedReplanDecisionIds: [] };
  }

  if (attempts.some((attempt) => attempt.timestamp >= blockingAttempt.timestamp && Boolean(attempt.newEvidence?.trim()))) {
    return {
      allowed: true,
      taskId,
      reason: `Debug retry gate cleared by new evidence for ${taskId}.`,
      blockingAttemptId: blockingAttempt.id,
      failureId: blockingAttempt.failureId,
      replanRequestIds: [],
      acceptedReplanDecisionIds: [],
    };
  }

  const replanRequests = (await loadReplanRequests(cwd)).filter((request) =>
    request.taskId === taskId &&
    (request.trigger === "debug_cycle" || request.trigger === "debug_blocked") &&
    request.createdAt >= blockingAttempt.timestamp,
  );
  const acceptedOrResolvedRequests = replanRequests.filter((request) => request.status === "accepted" || request.status === "resolved");
  const acceptedDecisions = (await loadReplanDecisions(cwd)).filter((decision) =>
    decision.status === "accepted" &&
    decision.createdAt >= blockingAttempt.timestamp &&
    decision.requestIds.some((requestId) => replanRequests.some((request) => request.id === requestId)),
  );

  if (acceptedOrResolvedRequests.length > 0 || acceptedDecisions.length > 0) {
    return {
      allowed: true,
      taskId,
      reason: `Debug retry gate cleared by accepted replan for ${taskId}.`,
      blockingAttemptId: blockingAttempt.id,
      failureId: blockingAttempt.failureId,
      replanRequestIds: acceptedOrResolvedRequests.map((request) => request.id),
      acceptedReplanDecisionIds: acceptedDecisions.map((decision) => decision.id),
    };
  }

  return {
    allowed: false,
    taskId,
    reason: `Debug retry blocked for ${taskId}: repeated failed fingerprint requires new evidence or an accepted replan request.`,
    blockingAttemptId: blockingAttempt.id,
    failureId: blockingAttempt.failureId,
    replanRequestIds: replanRequests.map((request) => request.id),
    acceptedReplanDecisionIds: [],
  };
}

export async function recordDebugAttempt(
  cwd: string,
  state: ScalerState,
  input: DebugAttemptInput,
  now = new Date(),
): Promise<DebugAttemptApplyResult> {
  if (!isDebugAttemptResult(input.result)) {
    const message = `Debug attempt rejected: invalid result ${String(input.result)}`;
    await appendLogEvent(cwd, createLogEvent(state, { eventType: "debug", summary: message, taskId: input.taskId, details: input }));
    return { accepted: false, message };
  }

  const attempts = await loadDebugAttempts(cwd);
  const attemptSignature = normalizeSignature(input.attemptSignature ?? `${input.hypothesis} ${input.actionSummary}`);
  const failureFingerprint = normalizeFingerprint(input.failureFingerprint);
  const resultingFailureFingerprint = normalizeFingerprint(input.resultingFailureFingerprint ?? input.failureFingerprint);
  const duplicate = findDuplicateAttempt(attempts, {
    taskId: input.taskId,
    failureId: input.failureId,
    attemptSignature,
    resultingFailureFingerprint,
  });

  if (duplicate && !input.newEvidence?.trim()) {
    const message = `Debug attempt rejected: repeated attempt ${duplicate.id} without new evidence`;
    await appendLogEvent(
      cwd,
      createLogEvent(state, {
        eventType: "debug",
        summary: message,
        taskId: input.taskId,
        details: { input, duplicateAttemptId: duplicate.id },
      }),
    );
    return { accepted: false, message, duplicateAttemptId: duplicate.id };
  }

  const timestamp = now.toISOString();
  const attempt: DebugAttemptRecord = {
    id: randomUUID(),
    taskId: input.taskId,
    failureId: input.failureId,
    hypothesis: input.hypothesis,
    actionSummary: input.actionSummary,
    result: input.result,
    attemptSignature,
    failureFingerprint: failureFingerprint || undefined,
    resultingFailureFingerprint: resultingFailureFingerprint || undefined,
    changedFiles: input.changedFiles,
    commands: input.commands,
    evidence: input.evidence,
    validationRun: input.validationRun,
    logRefs: input.logRefs,
    newEvidence: input.newEvidence,
    timestamp,
  };

  const cycleDetected = detectFingerprintCycle(attempts, attempt);
  if (cycleDetected) attempt.cycleDetected = cycleDetected;

  const failures = upsertFailure(await loadDebugFailures(cwd), input, timestamp, failureFingerprint || resultingFailureFingerprint || "unknown");
  await writeJsonFile(getDebugFailuresPath(cwd), { version: 1, failures } satisfies DebugFailureIndex);
  await writeJsonFile(getDebugAttemptsPath(cwd), { version: 1, attempts: [...attempts, attempt] } satisfies DebugAttemptIndex);

  let finalState = state;
  let replanRequestId: string | undefined;
  if (cycleDetected || input.result === "blocked") {
    const task = state.tasks.find((candidate) => candidate.id === input.taskId);
    if (task?.status === "debugging") {
      finalState = transitionTask(state, input.taskId, "needs_replan", {
        reason: cycleDetected ?? input.failureSummary ?? "Debug attempt blocked; replanning required.",
        now,
      });
    }
    const replan = await requestReplan(cwd, finalState, {
      trigger: cycleDetected ? "debug_cycle" : "debug_blocked",
      reason: cycleDetected ?? input.failureSummary ?? "Debug attempt blocked; replanning required.",
      taskId: input.taskId,
      evidenceRefs: input.evidence,
      requirementRefs: task?.prdRefs,
    }, now);
    finalState = replan.state;
    replanRequestId = replan.request.id;
  }

  const message = cycleDetected
    ? `Debug attempt recorded with cycle detected: ${attempt.id}`
    : `Debug attempt recorded: ${attempt.id}`;
  await appendLogEvent(
    cwd,
    createLogEvent(finalState, {
      eventType: "debug",
      summary: message,
      taskId: input.taskId,
      details: { attempt, replanRequestId },
    }),
  );

  return { accepted: true, message, attempt, cycleDetected, replanRequestId };
}

function isBlockingDebugAttempt(attempt: DebugAttemptRecord, failures: DebugFailureRecord[]): boolean {
  if (attempt.result === "fixed") return false;
  if (attempt.cycleDetected) return true;
  if (attempt.result === "blocked") return true;
  const failure = failures.find((candidate) => candidate.taskId === attempt.taskId && candidate.id === attempt.failureId);
  const failedResult = attempt.result === "same_failure" || attempt.result === "new_failure" || attempt.result === "partial" || attempt.result === "no_effect" || attempt.result === "worse";
  return failedResult && (failure?.attemptCount ?? 0) >= 2;
}

function findDuplicateAttempt(
  attempts: DebugAttemptRecord[],
  candidate: Pick<DebugAttemptRecord, "taskId" | "failureId" | "attemptSignature"> & { resultingFailureFingerprint: string },
): DebugAttemptRecord | undefined {
  return attempts.find((attempt) => {
    if (attempt.result === "fixed") return false;
    const previousResulting = normalizeFingerprint(attempt.resultingFailureFingerprint ?? attempt.failureFingerprint);
    return (
      attempt.taskId === candidate.taskId &&
      attempt.failureId === candidate.failureId &&
      attempt.attemptSignature === candidate.attemptSignature &&
      previousResulting === candidate.resultingFailureFingerprint
    );
  });
}

export function findDebugFingerprintCycles(attempts: DebugAttemptRecord[], taskId?: string): DebugCycleSummary[] {
  type Edge = { to: string; attemptId: string };
  const graph = new Map<string, Edge[]>();
  const cycles: DebugCycleSummary[] = [];
  const seen = new Set<string>();
  const ordered = attempts
    .filter((attempt) => !taskId || attempt.taskId === taskId)
    .filter((attempt) => attempt.result !== "fixed")
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id));

  for (const attempt of ordered) {
    const from = normalizeFingerprint(attempt.failureFingerprint);
    const to = normalizeFingerprint(attempt.resultingFailureFingerprint ?? attempt.failureFingerprint);
    if (!from || !to || from === to) continue;

    const path = findGraphPath(graph, to, from);
    if (path) {
      const fingerprints = path.nodes.concat(to);
      const attemptIds = [...path.attemptIds, attempt.id];
      const signature = fingerprints.join(" -> ");
      if (!seen.has(signature)) {
        seen.add(signature);
        cycles.push({
          fingerprints,
          attemptIds,
          lastSeenAt: attempt.timestamp,
          summary: `Failure fingerprints cycled ${signature}.`,
        });
      }
    }

    graph.set(from, [...(graph.get(from) ?? []), { to, attemptId: attempt.id }]);
  }

  return cycles;
}

function detectFingerprintCycle(attempts: DebugAttemptRecord[], nextAttempt: DebugAttemptRecord): string | undefined {
  const cycles = findDebugFingerprintCycles([...attempts, nextAttempt], nextAttempt.taskId)
    .filter((cycle) => cycle.attemptIds.includes(nextAttempt.id));
  return cycles.at(-1)?.summary;
}

function findGraphPath(
  graph: Map<string, Array<{ to: string; attemptId: string }>>,
  from: string,
  target: string,
): { nodes: string[]; attemptIds: string[] } | undefined {
  const visited = new Set<string>();
  const search = (node: string, nodes: string[], attemptIds: string[]): { nodes: string[]; attemptIds: string[] } | undefined => {
    if (node === target) return { nodes, attemptIds };
    if (visited.has(node)) return undefined;
    visited.add(node);
    for (const edge of graph.get(node) ?? []) {
      const found = search(edge.to, [...nodes, edge.to], [...attemptIds, edge.attemptId]);
      if (found) return found;
    }
    return undefined;
  };
  return search(from, [from], []);
}

function upsertFailure(
  failures: DebugFailureRecord[],
  input: DebugAttemptInput,
  timestamp: string,
  fingerprint: string,
): DebugFailureRecord[] {
  const existing = failures.find((failure) => failure.id === input.failureId && failure.taskId === input.taskId);
  if (!existing) {
    return [
      ...failures,
      {
        id: input.failureId,
        taskId: input.taskId,
        fingerprint,
        summary: input.failureSummary,
        validationCommand: input.validationCommand,
        expectedResult: input.expectedResult,
        actualResult: input.actualResult,
        outputRefs: input.outputRefs,
        firstSeenAt: timestamp,
        lastSeenAt: timestamp,
        attemptCount: 1,
      },
    ];
  }

  return failures.map((failure) =>
    failure === existing
      ? {
          ...failure,
          fingerprint,
          summary: input.failureSummary ?? failure.summary,
          validationCommand: input.validationCommand ?? failure.validationCommand,
          expectedResult: input.expectedResult ?? failure.expectedResult,
          actualResult: input.actualResult ?? failure.actualResult,
          outputRefs: input.outputRefs ?? failure.outputRefs,
          lastSeenAt: timestamp,
          attemptCount: failure.attemptCount + 1,
        }
      : failure,
  );
}

function normalizeDebugReportStatus(value: DebugReportStatus | string): DebugReportStatus {
  if (debugReportStatuses.includes(value as DebugReportStatus)) return value as DebugReportStatus;
  throw new Error(`Invalid debug report status: ${String(value)}`);
}

function normalizeResearchScope(value: ResearchScope | string): ResearchScope {
  return value === "internet" || value === "mixed" ? value : "local";
}

function validateDebugRetry(retry: DebugNextApproachRetryRecord): void {
  cleanRequired(retry.id, "Debug retry id is required.");
  cleanRequired(retry.taskId, "Debug retry taskId is required.");
  cleanRequired(retry.debugReportId, "Debug retry debugReportId is required.");
  cleanRequired(retry.previousValidationRunId, "Debug retry previousValidationRunId is required.");
  if (!["prepared", "task_agent_failed", "exact_validation_passed", "exact_validation_failed", "rejected"].includes(retry.status)) {
    throw new Error(`Invalid debug retry status: ${String(retry.status)}`);
  }
  if (!Array.isArray(retry.exactCommandIds) || retry.exactCommandIds.length === 0) {
    throw new Error("Debug retry exactCommandIds are required.");
  }
}

function validateDebugReport(report: DebugReportRecord): void {
  cleanRequired(report.id, "Debug report id is required.");
  cleanRequired(report.taskId, "Debug report taskId is required.");
  cleanRequired(report.summary, "Debug report summary is required.");
  normalizeDebugReportStatus(report.status);
  if (report.status === "next_approach" && !report.nextApproach?.trim()) {
    throw new Error("next_approach debug reports require nextApproach.");
  }
  if (report.status === "needs_research" && (report.researchQuestions ?? []).length === 0) {
    throw new Error("needs_research debug reports require researchQuestions.");
  }
  if ((report.status === "needs_replan" || report.status === "blocked") && !report.replanReason?.trim() && !report.exhaustedReason?.trim()) {
    throw new Error(`${report.status} debug reports require replanReason or exhaustedReason.`);
  }
}

function normalizeList(values: string[] | undefined): string[] | undefined {
  const normalized = (values ?? []).map((value) => value.trim()).filter(Boolean);
  return normalized.length > 0 ? Array.from(new Set(normalized)).sort((a, b) => a.localeCompare(b)) : undefined;
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function cleanRequired(value: string | undefined, message: string): string {
  const trimmed = clean(value);
  if (!trimmed) throw new Error(message);
  return trimmed;
}

function normalizeSignature(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeFingerprint(value: string | undefined): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\/tmp\/[^\s]+/g, "/tmp/*")
    .replace(/line \d+/g, "line *")
    .replace(/:\d+:\d+/g, ":*:*")
    .replace(/\s+/g, " ");
}

async function readJsonFile<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getBudgetState, setBudgetLimits, setScopedBudgetPolicy, type BudgetLimit, type BudgetScopeKind, type BudgetUsageKey, type ScopedBudgetPolicy } from "./budgets.js";
import { assessGitStatusSafety, type GitStatusSafetyDecision } from "./git.js";
import { appendLogEvent, createLogEvent } from "./logging.js";
import { loadMemoryIndex } from "./memory.js";
import { loadReplanRequests } from "./plans.js";
import {
  getCheckpointsDir,
  getEventLogPath,
  getResumeChecksPath,
  getStatePath,
  getWatchdogCleanupPath,
  getWatchdogEventsPath,
  getWatchdogHeartbeatsPath,
} from "./paths.js";
import { saveState } from "./state.js";
import { transitionStage } from "./supervisor.js";
import type { ScalerState } from "./types.js";

export type WatchdogScopeKind = "run" | "stage" | "task" | "agent" | "tool" | "validation" | "debug" | "replan";
export type WatchdogHeartbeatStatus = "running" | "progress" | "completed" | "failed" | "timeout" | "aborted";
export type WatchdogSeverity = "info" | "warning" | "hard";
export type WatchdogRecommendedAction = "continue" | "pause" | "debug" | "replan" | "cleanup" | "approve_budget";
export type WatchdogEventKind = "no_progress" | "repeated_replanning" | "subprocess_cleanup" | "budget_policy_approval" | "resume_verification";

export interface WatchdogHeartbeatRecord {
  id: string;
  scopeKind: WatchdogScopeKind;
  scopeId: string;
  status: WatchdogHeartbeatStatus;
  action: string;
  taskId?: string;
  agentId?: string;
  details?: unknown;
  timestamp: string;
  lastProgressAt: string;
}

export interface WatchdogHeartbeatInput {
  scopeKind?: WatchdogScopeKind;
  scopeId: string;
  status?: WatchdogHeartbeatStatus;
  action: string;
  taskId?: string;
  agentId?: string;
  details?: unknown;
  now?: Date;
}

interface WatchdogHeartbeatIndex {
  version: 1;
  heartbeats: WatchdogHeartbeatRecord[];
}

export interface WatchdogPolicy {
  noProgressTimeoutMs: number;
  repeatedReplanLimit: number;
  pauseOnHardTrigger: boolean;
  complexityApprovalLevel: number;
}

export interface WatchdogEventRecord {
  id: string;
  kind: WatchdogEventKind;
  severity: WatchdogSeverity;
  scopeKind: WatchdogScopeKind;
  scopeId: string;
  reason: string;
  recommendedAction: WatchdogRecommendedAction;
  triggered: boolean;
  evidenceRefs: string[];
  details?: unknown;
  createdAt: string;
}

interface WatchdogEventIndex {
  version: 1;
  events: WatchdogEventRecord[];
}

export interface WatchdogCleanupRecord {
  id: string;
  scopeKind: WatchdogScopeKind;
  scopeId: string;
  taskId?: string;
  agentId?: string;
  reason: "timeout" | "abort" | "manual" | "shutdown";
  signal?: string;
  status: "requested" | "completed" | "failed";
  message: string;
  createdAt: string;
}

interface WatchdogCleanupIndex {
  version: 1;
  cleanup: WatchdogCleanupRecord[];
}

export interface ResumeVerificationFinding {
  check: "state" | "git" | "logs" | "memory_index" | "checkpoints" | "budget";
  status: "ok" | "warning" | "failed";
  message: string;
  evidenceRef?: string;
}

export interface ResumeVerificationRecord {
  id: string;
  status: "ok" | "warning" | "failed";
  targetStage: ScalerState["stage"];
  findings: ResumeVerificationFinding[];
  git?: GitStatusSafetyDecision;
  checkpointPath?: string;
  createdAt: string;
}

interface ResumeVerificationIndex {
  version: 1;
  checks: ResumeVerificationRecord[];
}

export interface WatchdogAssessmentResult {
  state: ScalerState;
  events: WatchdogEventRecord[];
  paused: boolean;
  checkpointPath?: string;
  message: string;
}

export interface ComplexityBudgetPolicyResult {
  accepted: boolean;
  requiresApproval: boolean;
  message: string;
  state: ScalerState;
  policies: ScopedBudgetPolicy[];
  approvalId?: string;
}

export const defaultWatchdogPolicy: WatchdogPolicy = {
  noProgressTimeoutMs: 30 * 60 * 1000,
  repeatedReplanLimit: 3,
  pauseOnHardTrigger: true,
  complexityApprovalLevel: 4,
};

export async function recordWatchdogHeartbeat(cwd: string, input: WatchdogHeartbeatInput): Promise<WatchdogHeartbeatRecord> {
  const now = input.now ?? new Date();
  const timestamp = now.toISOString();
  const scopeKind = input.scopeKind ?? "run";
  const status = input.status ?? "progress";
  const id = `${scopeKind}-${input.scopeId}-${now.getTime()}`.replace(/[^a-zA-Z0-9._-]/g, "-");
  const record: WatchdogHeartbeatRecord = {
    id,
    scopeKind,
    scopeId: input.scopeId,
    status,
    action: input.action,
    taskId: input.taskId,
    agentId: input.agentId,
    details: input.details,
    timestamp,
    lastProgressAt: status === "running" || status === "progress" ? timestamp : timestamp,
  };
  await writeWatchdogHeartbeats(cwd, [record, ...(await loadWatchdogHeartbeats(cwd))].slice(0, 500));
  return record;
}

export async function loadWatchdogHeartbeats(cwd: string): Promise<WatchdogHeartbeatRecord[]> {
  try {
    const raw = await readFile(getWatchdogHeartbeatsPath(cwd), "utf8");
    return (JSON.parse(raw) as WatchdogHeartbeatIndex).heartbeats ?? [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export function formatWatchdogHeartbeats(records: WatchdogHeartbeatRecord[], scopeId?: string, limit = 20): string {
  const filtered = scopeId ? records.filter((record) => record.scopeId === scopeId || record.taskId === scopeId || record.agentId === scopeId) : records;
  if (filtered.length === 0) return scopeId ? `No watchdog heartbeats for ${scopeId}.` : "No watchdog heartbeats.";
  const lines = [scopeId ? `Watchdog heartbeats for ${scopeId}:` : "Watchdog heartbeats:"];
  for (const record of filtered.slice(0, limit)) {
    lines.push(`- ${record.id}: ${record.scopeKind}/${record.scopeId} status=${record.status} action=${record.action} at=${record.timestamp}`);
  }
  return lines.join("\n");
}

export async function recordWatchdogCleanup(cwd: string, input: Omit<WatchdogCleanupRecord, "id" | "createdAt"> & { now?: Date }): Promise<WatchdogCleanupRecord> {
  const now = input.now ?? new Date();
  const record: WatchdogCleanupRecord = {
    id: `CLEANUP-${now.getTime()}`,
    scopeKind: input.scopeKind,
    scopeId: input.scopeId,
    taskId: input.taskId,
    agentId: input.agentId,
    reason: input.reason,
    signal: input.signal,
    status: input.status,
    message: input.message,
    createdAt: now.toISOString(),
  };
  await writeWatchdogCleanup(cwd, [record, ...(await loadWatchdogCleanupRecords(cwd))].slice(0, 500));
  return record;
}

export async function loadWatchdogCleanupRecords(cwd: string): Promise<WatchdogCleanupRecord[]> {
  try {
    const raw = await readFile(getWatchdogCleanupPath(cwd), "utf8");
    return (JSON.parse(raw) as WatchdogCleanupIndex).cleanup ?? [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export function formatWatchdogCleanupRecords(records: WatchdogCleanupRecord[], limit = 20): string {
  if (records.length === 0) return "No watchdog cleanup records.";
  const lines = ["Watchdog cleanup records:"];
  for (const record of records.slice(0, limit)) {
    lines.push(`- ${record.id}: ${record.scopeKind}/${record.scopeId} reason=${record.reason} status=${record.status} message=${record.message}`);
  }
  return lines.join("\n");
}

export async function runWatchdogAssessment(
  cwd: string,
  state: ScalerState,
  input: { execute?: boolean; policy?: Partial<WatchdogPolicy>; now?: Date } = {},
): Promise<WatchdogAssessmentResult> {
  const policy = { ...defaultWatchdogPolicy, ...(input.policy ?? {}) };
  const now = input.now ?? new Date();
  const events = await assessWatchdogEvents(cwd, state, policy, now);
  if (events.length > 0) await writeWatchdogEvents(cwd, [...events, ...(await loadWatchdogEvents(cwd))].slice(0, 500));

  const hardTriggered = events.some((event) => event.triggered && event.severity === "hard");
  let nextState = state;
  let checkpointPath: string | undefined;
  if (input.execute && hardTriggered && policy.pauseOnHardTrigger) {
    nextState = transitionStage(state, "paused", { reason: "Watchdog hard trigger requires pause.", now });
    await saveState(cwd, nextState);
    checkpointPath = await writeWatchdogPauseCheckpoint(cwd, nextState, now);
  }

  for (const event of events) {
    await appendLogEvent(cwd, createLogEvent(nextState, {
      eventType: "budget",
      summary: `Watchdog ${event.kind}: ${event.reason}`,
      details: event,
      outputRefs: event.evidenceRefs,
    }, now));
  }

  const message = events.length === 0
    ? "Watchdog assessment: no triggers."
    : `Watchdog assessment: events=${events.length} hard=${events.filter((event) => event.severity === "hard").length} paused=${Boolean(checkpointPath)}.`;
  return { state: nextState, events, paused: Boolean(checkpointPath), checkpointPath, message };
}

export async function loadWatchdogEvents(cwd: string): Promise<WatchdogEventRecord[]> {
  try {
    const raw = await readFile(getWatchdogEventsPath(cwd), "utf8");
    return (JSON.parse(raw) as WatchdogEventIndex).events ?? [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export function formatWatchdogEvents(records: WatchdogEventRecord[], limit = 20): string {
  if (records.length === 0) return "No watchdog events.";
  const lines = ["Watchdog events:"];
  for (const record of records.slice(0, limit)) {
    lines.push(`- ${record.id}: kind=${record.kind} severity=${record.severity} triggered=${record.triggered} action=${record.recommendedAction}`);
    lines.push(`  ${record.reason}`);
  }
  return lines.join("\n");
}

export async function verifyResumeReadiness(cwd: string, state: ScalerState, now = new Date()): Promise<ResumeVerificationRecord> {
  const findings: ResumeVerificationFinding[] = [];
  const timestamp = now.toISOString();
  const targetStage = state.previousStage ?? "idle";

  await checkFile(getStatePath(cwd), "state", findings, "Supervisor state file is readable.");
  const git = await assessGitStatusSafety(cwd, state.currentTaskId ? state.tasks.find((task) => task.id === state.currentTaskId)?.allowedPathPrefixes ?? [] : []);
  findings.push({ check: "git", status: git.status === "unrelated" ? "warning" : "ok", message: git.reason, evidenceRef: git.changedPaths.join(",") || undefined });
  await checkFile(getEventLogPath(cwd), "logs", findings, "Audit event log is readable.", true);

  try {
    const memory = await loadMemoryIndex(cwd);
    findings.push({ check: "memory_index", status: "ok", message: `Memory index readable entries=${memory.entries.length}.` });
  } catch (error) {
    findings.push({ check: "memory_index", status: "failed", message: `Memory index unreadable: ${error instanceof Error ? error.message : String(error)}` });
  }

  const checkpointPath = await findLatestCheckpoint(cwd);
  findings.push(checkpointPath
    ? { check: "checkpoints", status: "ok", message: "Latest checkpoint found.", evidenceRef: checkpointPath }
    : { check: "checkpoints", status: "warning", message: "No checkpoint files found; resume can continue from state only." });

  const budgets = getBudgetState(state, now);
  findings.push({ check: "budget", status: "ok", message: `Budget state readable scopedPolicies=${budgets.scopedPolicies.length} checkpoints=${budgets.checkpoints.length}.` });

  const status = findings.some((finding) => finding.status === "failed") ? "failed" : findings.some((finding) => finding.status === "warning") ? "warning" : "ok";
  const record: ResumeVerificationRecord = {
    id: `RESUME-${now.getTime()}`,
    status,
    targetStage,
    findings,
    git,
    checkpointPath,
    createdAt: timestamp,
  };
  await writeResumeVerificationRecords(cwd, [record, ...(await loadResumeVerificationRecords(cwd))].slice(0, 200));
  await appendLogEvent(cwd, createLogEvent(state, {
    eventType: "system",
    summary: `Resume verification ${status}: target=${targetStage}`,
    details: record,
    outputRefs: checkpointPath ? [checkpointPath] : undefined,
  }, now));
  return record;
}

export async function loadResumeVerificationRecords(cwd: string): Promise<ResumeVerificationRecord[]> {
  try {
    const raw = await readFile(getResumeChecksPath(cwd), "utf8");
    return (JSON.parse(raw) as ResumeVerificationIndex).checks ?? [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export function formatResumeVerificationRecords(records: ResumeVerificationRecord[], limit = 20): string {
  if (records.length === 0) return "No resume verification records.";
  const lines = ["Resume verification records:"];
  for (const record of records.slice(0, limit)) {
    lines.push(`- ${record.id}: status=${record.status} target=${record.targetStage} checkpoint=${record.checkpointPath ?? "none"}`);
    for (const finding of record.findings) lines.push(`  - ${finding.check}: ${finding.status} ${finding.message}`);
  }
  return lines.join("\n");
}

export function buildComplexityBudgetPolicy(level: number, now = new Date()): ScopedBudgetPolicy[] {
  const normalized = Math.max(0, Math.min(5, Math.floor(level)));
  const timestamp = now.toISOString();
  const runLimits = complexityLimits(normalized);
  return [
    {
      id: `complexity-${normalized}-run`,
      scopeKind: "run",
      scopeId: "run",
      limits: runLimits,
      requiresApproval: normalized >= defaultWatchdogPolicy.complexityApprovalLevel,
      reason: `Default run budget policy for complexity level ${normalized}.`,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: `complexity-${normalized}-task-agent`,
      scopeKind: "task_agent",
      scopeId: "*",
      limits: {
        spawnedAgents: { hard: normalized <= 1 ? 1 : normalized <= 3 ? 8 : 16 },
        contextTokens: { soft: normalized <= 2 ? 6_000 : 24_000, hard: normalized <= 2 ? 8_000 : 48_000 },
      },
      requiresApproval: normalized >= defaultWatchdogPolicy.complexityApprovalLevel,
      reason: `Default task-agent budget policy for complexity level ${normalized}.`,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ];
}

export function applyComplexityBudgetPolicy(state: ScalerState, input: { level?: number; approved?: boolean; approvalId?: string; now?: Date } = {}): ComplexityBudgetPolicyResult {
  const now = input.now ?? new Date();
  const level = input.level ?? state.complexityLevel;
  const policies = buildComplexityBudgetPolicy(level, now).map((policy) => ({
    ...policy,
    approvalId: input.approved ? input.approvalId ?? `budget-approval-${now.getTime()}` : policy.approvalId,
  }));
  const requiresApproval = policies.some((policy) => policy.requiresApproval && !policy.approvalId);
  if (requiresApproval) {
    return {
      accepted: false,
      requiresApproval: true,
      message: `Complexity level ${level} budget expansion requires explicit approval. Re-run with approve.` ,
      state,
      policies,
    };
  }

  let nextState = state;
  for (const policy of policies) nextState = setScopedBudgetPolicy(nextState, policy, now);
  nextState = setBudgetLimits(nextState, mergePolicyLimits(policies), now);
  return {
    accepted: true,
    requiresApproval: false,
    message: `Applied complexity level ${level} budget policy (${policies.length} scoped policies).`,
    state: nextState,
    policies,
    approvalId: policies.find((policy) => policy.approvalId)?.approvalId,
  };
}

export function formatComplexityBudgetPolicies(policies: ScopedBudgetPolicy[]): string {
  if (policies.length === 0) return "No scoped budget policies.";
  const lines = ["Scoped budget policies:"];
  for (const policy of policies) {
    lines.push(`- ${policy.id}: ${policy.scopeKind}/${policy.scopeId} approval=${policy.requiresApproval ? policy.approvalId ?? "required" : "not_required"}`);
    for (const [key, limit] of Object.entries(policy.limits) as [BudgetUsageKey, BudgetLimit][]) {
      lines.push(`  - ${key}: soft=${limit.soft ?? "-"} hard=${limit.hard ?? "-"}`);
    }
  }
  return lines.join("\n");
}

async function assessWatchdogEvents(cwd: string, state: ScalerState, policy: WatchdogPolicy, now: Date): Promise<WatchdogEventRecord[]> {
  const events: WatchdogEventRecord[] = [];
  const heartbeats = await loadWatchdogHeartbeats(cwd);
  const stale = findStaleHeartbeat(heartbeats, policy.noProgressTimeoutMs, now);
  if (stale) {
    events.push(buildWatchdogEvent("no_progress", "hard", stale.scopeKind, stale.scopeId, `No progress heartbeat for ${now.getTime() - Date.parse(stale.lastProgressAt)}ms; timeout=${policy.noProgressTimeoutMs}ms.`, "pause", [stale.id], { heartbeat: stale }, now));
  }

  const replanRequests = await loadReplanRequests(cwd);
  const replanCount = replanRequests.filter((request) => request.status === "open" || request.status === "accepted").length;
  if (replanCount >= policy.repeatedReplanLimit && state.validatedTaskIds.length === 0) {
    events.push(buildWatchdogEvent("repeated_replanning", "hard", "replan", "run", `Repeated replanning detected without validated progress (${replanCount}/${policy.repeatedReplanLimit}).`, "pause", replanRequests.slice(0, replanCount).map((request) => request.id), { replanCount, validatedTaskIds: state.validatedTaskIds }, now));
  }

  const budgets = getBudgetState(state, now);
  if (state.complexityLevel >= policy.complexityApprovalLevel && budgets.scopedPolicies.every((candidate) => !candidate.approvalId)) {
    events.push(buildWatchdogEvent("budget_policy_approval", "warning", "run", "budget", `Complexity level ${state.complexityLevel} requires approved scoped budget policy.`, "approve_budget", [], { complexityLevel: state.complexityLevel }, now));
  }

  return events;
}

function findStaleHeartbeat(records: WatchdogHeartbeatRecord[], timeoutMs: number, now: Date): WatchdogHeartbeatRecord | undefined {
  const active = records
    .filter((record) => record.status === "running" || record.status === "progress")
    .sort((a, b) => b.lastProgressAt.localeCompare(a.lastProgressAt))[0];
  if (!active) return undefined;
  return now.getTime() - Date.parse(active.lastProgressAt) > timeoutMs ? active : undefined;
}

function buildWatchdogEvent(
  kind: WatchdogEventKind,
  severity: WatchdogSeverity,
  scopeKind: WatchdogScopeKind,
  scopeId: string,
  reason: string,
  recommendedAction: WatchdogRecommendedAction,
  evidenceRefs: string[],
  details: unknown,
  now: Date,
): WatchdogEventRecord {
  return {
    id: `WATCHDOG-${kind}-${now.getTime()}`,
    kind,
    severity,
    scopeKind,
    scopeId,
    reason,
    recommendedAction,
    triggered: severity === "hard" || severity === "warning",
    evidenceRefs,
    details,
    createdAt: now.toISOString(),
  };
}

async function checkFile(path: string, check: ResumeVerificationFinding["check"], findings: ResumeVerificationFinding[], okMessage: string, optional = false): Promise<void> {
  try {
    await stat(path);
    findings.push({ check, status: "ok", message: okMessage, evidenceRef: path });
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    findings.push({ check, status: optional && missing ? "warning" : "failed", message: `${check} ${missing ? "missing" : "unreadable"}: ${path}`, evidenceRef: path });
  }
}

async function writeWatchdogPauseCheckpoint(cwd: string, state: ScalerState, now: Date): Promise<string> {
  const path = join(getCheckpointsDir(cwd), `${now.toISOString().replace(/[:.]/g, "-")}-watchdog-pause.json`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ version: 1, scope: "watchdog-pause", timestamp: now.toISOString(), state }, null, 2)}\n`, "utf8");
  return path;
}

async function findLatestCheckpoint(cwd: string): Promise<string | undefined> {
  try {
    const entries = await readdir(getCheckpointsDir(cwd));
    const json = entries.filter((entry) => entry.endsWith(".json")).sort((a, b) => b.localeCompare(a))[0];
    return json ? join(getCheckpointsDir(cwd), json) : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function complexityLimits(level: number): Partial<Record<BudgetUsageKey, BudgetLimit>> {
  if (level <= 1) return { spawnedAgents: { hard: 1 }, toolCalls: { soft: 5, hard: 10 }, contextTokens: { soft: 4_000, hard: 8_000 }, estimatedCostMicros: { soft: 50_000, hard: 100_000 } };
  if (level === 2) return { spawnedAgents: { soft: 2, hard: 4 }, toolCalls: { soft: 20, hard: 40 }, contextTokens: { soft: 8_000, hard: 16_000 }, estimatedCostMicros: { soft: 250_000, hard: 500_000 } };
  if (level === 3) return { spawnedAgents: { soft: 6, hard: 12 }, toolCalls: { soft: 60, hard: 120 }, contextTokens: { soft: 32_000, hard: 64_000 }, estimatedCostMicros: { soft: 1_000_000, hard: 2_000_000 } };
  return { spawnedAgents: { soft: 12, hard: 24 }, toolCalls: { soft: 120, hard: 240 }, contextTokens: { soft: 64_000, hard: 128_000 }, estimatedCostMicros: { soft: 2_500_000, hard: 5_000_000 } };
}

function mergePolicyLimits(policies: ScopedBudgetPolicy[]): Partial<Record<BudgetUsageKey, BudgetLimit>> {
  const merged: Partial<Record<BudgetUsageKey, BudgetLimit>> = {};
  for (const policy of policies.filter((candidate) => candidate.scopeKind === "run")) {
    for (const [key, limit] of Object.entries(policy.limits) as [BudgetUsageKey, BudgetLimit][]) {
      merged[key] = { ...merged[key], ...limit };
    }
  }
  return merged;
}

async function writeWatchdogHeartbeats(cwd: string, heartbeats: WatchdogHeartbeatRecord[]): Promise<void> {
  const path = getWatchdogHeartbeatsPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ version: 1, heartbeats } satisfies WatchdogHeartbeatIndex, null, 2)}\n`, "utf8");
}

async function writeWatchdogEvents(cwd: string, events: WatchdogEventRecord[]): Promise<void> {
  const path = getWatchdogEventsPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ version: 1, events } satisfies WatchdogEventIndex, null, 2)}\n`, "utf8");
}

async function writeWatchdogCleanup(cwd: string, cleanup: WatchdogCleanupRecord[]): Promise<void> {
  const path = getWatchdogCleanupPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ version: 1, cleanup } satisfies WatchdogCleanupIndex, null, 2)}\n`, "utf8");
}

async function writeResumeVerificationRecords(cwd: string, checks: ResumeVerificationRecord[]): Promise<void> {
  const path = getResumeChecksPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ version: 1, checks } satisfies ResumeVerificationIndex, null, 2)}\n`, "utf8");
}

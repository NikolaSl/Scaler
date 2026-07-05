/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { appendLogEvent, createLogEvent } from "./logging.js";
import { getScalerDir } from "./paths.js";
import { saveState } from "./state.js";
import { transitionStage } from "./supervisor.js";
import type { ScalerState } from "./types.js";

export type BudgetUsageKey =
  | "toolCalls"
  | "spawnedAgents"
  | "debugAttempts"
  | "wallClockMs"
  | "checkpoints"
  | "contextTokens"
  | "validationLoops"
  | "storageBytes"
  | "researchReports"
  | "estimatedCostMicros";
export type BudgetDecisionStatus = "ok" | "soft_limit" | "hard_limit";
export type BudgetRecommendedAction = "continue" | "reduce_scope" | "pause";
export type BudgetScopeKind = "run" | "stage" | "plan" | "task" | "task_agent" | "research_agent" | "tool_agent" | "debug_loop" | "validation_loop";

export interface BudgetLimit {
  soft?: number;
  hard?: number;
}

export interface BudgetCheckpoint {
  id: string;
  scope: string;
  timestamp: string;
  wallClockMs: number;
  summary?: string;
}

export interface ScopedBudgetPolicy {
  id: string;
  scopeKind: BudgetScopeKind;
  scopeId: string;
  limits: Partial<Record<BudgetUsageKey, BudgetLimit>>;
  requiresApproval?: boolean;
  approvalId?: string;
  reason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ScalerBudgetState {
  [key: string]: unknown;
  version: 1;
  startedAt: string;
  updatedAt: string;
  usage: Partial<Record<BudgetUsageKey, number>>;
  limits: Partial<Record<BudgetUsageKey, BudgetLimit>>;
  scopedPolicies: ScopedBudgetPolicy[];
  checkpoints: BudgetCheckpoint[];
}

export interface BudgetDecision {
  status: BudgetDecisionStatus;
  key: BudgetUsageKey;
  usage: number;
  softLimit?: number;
  hardLimit?: number;
  reason: string;
  recommendedAction: BudgetRecommendedAction;
}

export interface BudgetUsageUpdate {
  key: BudgetUsageKey;
  amount: number;
  mode?: "increment" | "set";
}

export interface BudgetUpdateResult {
  state: ScalerState;
  decisions: BudgetDecision[];
  decision: BudgetDecision;
}

export const budgetUsageKeys: BudgetUsageKey[] = [
  "toolCalls",
  "spawnedAgents",
  "debugAttempts",
  "wallClockMs",
  "checkpoints",
  "contextTokens",
  "validationLoops",
  "storageBytes",
  "researchReports",
  "estimatedCostMicros",
];

export function isBudgetUsageKey(value: string): value is BudgetUsageKey {
  return budgetUsageKeys.includes(value as BudgetUsageKey);
}

export function getBudgetState(state: ScalerState, now = new Date()): ScalerBudgetState {
  const raw = state.budgets as Partial<ScalerBudgetState> | undefined;
  const timestamp = now.toISOString();
  const usage = normalizeUsage(raw?.usage);

  return {
    version: 1,
    startedAt: typeof raw?.startedAt === "string" ? raw.startedAt : state.createdAt,
    updatedAt: typeof raw?.updatedAt === "string" ? raw.updatedAt : timestamp,
    usage,
    limits: normalizeLimits(raw?.limits),
    scopedPolicies: normalizeScopedBudgetPolicies(raw?.scopedPolicies),
    checkpoints: Array.isArray(raw?.checkpoints) ? raw.checkpoints : [],
  };
}

export function setBudgetLimits(
  state: ScalerState,
  limits: Partial<Record<BudgetUsageKey, BudgetLimit>>,
  now = new Date(),
): ScalerState {
  const budgetState = getBudgetState(state, now);
  const nextBudgetState: ScalerBudgetState = {
    ...budgetState,
    limits: { ...budgetState.limits, ...limits },
    updatedAt: now.toISOString(),
  };
  return { ...state, budgets: nextBudgetState, updatedAt: now.toISOString() };
}

export function setScopedBudgetPolicy(
  state: ScalerState,
  policy: Omit<ScopedBudgetPolicy, "createdAt" | "updatedAt"> & Partial<Pick<ScopedBudgetPolicy, "createdAt" | "updatedAt">>,
  now = new Date(),
): ScalerState {
  const budgetState = getBudgetState(state, now);
  const timestamp = now.toISOString();
  const normalized: ScopedBudgetPolicy = {
    ...policy,
    limits: normalizeLimits(policy.limits),
    createdAt: policy.createdAt ?? timestamp,
    updatedAt: policy.updatedAt ?? timestamp,
  };
  const scopedPolicies = [
    normalized,
    ...budgetState.scopedPolicies.filter((candidate) => candidate.id !== normalized.id),
  ];
  const nextBudgetState: ScalerBudgetState = {
    ...budgetState,
    scopedPolicies,
    updatedAt: timestamp,
  };
  return { ...state, budgets: nextBudgetState, updatedAt: timestamp };
}

export function getScopedBudgetPolicies(state: ScalerState, scopeKind?: BudgetScopeKind, scopeId?: string): ScopedBudgetPolicy[] {
  return getBudgetState(state).scopedPolicies.filter((policy) => {
    if (scopeKind && policy.scopeKind !== scopeKind) return false;
    if (scopeId && policy.scopeId !== scopeId) return false;
    return true;
  });
}

export function incrementBudgetUsage(
  state: ScalerState,
  key: BudgetUsageKey,
  amount = 1,
  now = new Date(),
): { state: ScalerState; decision: BudgetDecision } {
  const result = applyBudgetUsageUpdates(state, [{ key, amount, mode: "increment" }], now);
  return { state: result.state, decision: result.decision };
}

export function setBudgetUsage(
  state: ScalerState,
  key: BudgetUsageKey,
  value: number,
  now = new Date(),
): { state: ScalerState; decision: BudgetDecision } {
  const result = applyBudgetUsageUpdates(state, [{ key, amount: value, mode: "set" }], now);
  return { state: result.state, decision: result.decision };
}

export function applyBudgetUsageUpdates(
  state: ScalerState,
  updates: BudgetUsageUpdate[],
  now = new Date(),
): BudgetUpdateResult {
  if (updates.length === 0) {
    const decision = evaluateBudgetUsage("toolCalls", getBudgetState(state, now).usage.toolCalls ?? 0);
    return { state, decisions: [decision], decision };
  }

  const timestamp = now.toISOString();
  const budgetState = getBudgetState(state, now);
  const usage = { ...budgetState.usage };
  const decisions: BudgetDecision[] = [];

  for (const update of updates) {
    const normalizedAmount = Number.isFinite(update.amount) ? update.amount : 0;
    const nextUsage = update.mode === "set"
      ? Math.max(0, normalizedAmount)
      : Math.max(0, (usage[update.key] ?? 0) + normalizedAmount);
    usage[update.key] = nextUsage;
    decisions.push(evaluateBudgetUsage(update.key, nextUsage, budgetState.limits[update.key]));
  }

  const nextBudgetState: ScalerBudgetState = {
    ...budgetState,
    usage,
    updatedAt: timestamp,
  };
  const decision = getStrongestBudgetDecision(decisions);
  return { state: { ...state, budgets: nextBudgetState, updatedAt: timestamp }, decisions, decision };
}

export function recordBudgetCheckpoint(
  state: ScalerState,
  scope: string,
  summary?: string,
  now = new Date(),
): { state: ScalerState; decision: BudgetDecision; checkpoint: BudgetCheckpoint } {
  const budgetState = getBudgetState(state, now);
  const wallClockMs = Math.max(0, now.getTime() - Date.parse(budgetState.startedAt));
  const checkpoint: BudgetCheckpoint = {
    id: `${budgetState.checkpoints.length + 1}`.padStart(4, "0"),
    scope,
    timestamp: now.toISOString(),
    wallClockMs,
    summary,
  };
  const checkpointCount = (budgetState.usage.checkpoints ?? 0) + 1;
  const nextBudgetState: ScalerBudgetState = {
    ...budgetState,
    usage: {
      ...budgetState.usage,
      checkpoints: checkpointCount,
      wallClockMs,
    },
    checkpoints: [...budgetState.checkpoints, checkpoint],
    updatedAt: now.toISOString(),
  };
  const checkpointDecision = evaluateBudgetUsage("checkpoints", checkpointCount, nextBudgetState.limits.checkpoints);
  const wallClockDecision = evaluateBudgetUsage("wallClockMs", wallClockMs, nextBudgetState.limits.wallClockMs);
  const decision = strongerDecision(checkpointDecision, wallClockDecision);
  return { state: { ...state, budgets: nextBudgetState, updatedAt: now.toISOString() }, decision, checkpoint };
}

export async function recordStorageBudgetUsage(
  cwd: string,
  state: ScalerState,
  now = new Date(),
): Promise<{ state: ScalerState; decision: BudgetDecision; storageBytes: number }> {
  const storageBytes = await scanScalerStorageBytes(cwd);
  const { state: nextState, decision } = setBudgetUsage(state, "storageBytes", storageBytes, now);
  return { state: nextState, decision, storageBytes };
}

export async function scanScalerStorageBytes(cwd: string): Promise<number> {
  return await scanPathBytes(getScalerDir(cwd));
}

export function formatBudgetStatus(state: ScalerState, now = new Date()): string {
  const budgets = getBudgetState(state, now);
  const decisions = budgetUsageKeys.map((key) => evaluateBudgetUsage(key, budgets.usage[key] ?? 0, budgets.limits[key]));
  const strongest = getStrongestBudgetDecision(decisions);
  const lines = [
    `Budgets: strongest=${strongest.status} key=${strongest.key} action=${strongest.recommendedAction}`,
    `Started: ${budgets.startedAt} Updated: ${budgets.updatedAt} checkpoints=${budgets.checkpoints.length} scopedPolicies=${budgets.scopedPolicies.length}`,
    "Usage:",
  ];
  for (const key of budgetUsageKeys) {
    const usage = budgets.usage[key] ?? 0;
    const limit = budgets.limits[key];
    const decision = evaluateBudgetUsage(key, usage, limit);
    const soft = limit?.soft === undefined ? "-" : String(limit.soft);
    const hard = limit?.hard === undefined ? "-" : String(limit.hard);
    lines.push(`- ${key}: usage=${usage} soft=${soft} hard=${hard} status=${decision.status}`);
  }
  for (const policy of budgets.scopedPolicies.slice(0, 10)) {
    const limitKeys = Object.keys(policy.limits).sort().join(",") || "none";
    lines.push(`- scoped ${policy.id}: ${policy.scopeKind}/${policy.scopeId} limits=${limitKeys} approval=${policy.requiresApproval ? policy.approvalId ?? "required" : "not_required"}`);
  }
  return lines.join("\n");
}

export function evaluateBudgetUsage(key: BudgetUsageKey, usage: number, limit?: BudgetLimit): BudgetDecision {
  if (limit?.hard !== undefined && usage >= limit.hard) {
    return {
      status: "hard_limit",
      key,
      usage,
      softLimit: limit.soft,
      hardLimit: limit.hard,
      reason: `${key} hard limit reached (${usage}/${limit.hard}).`,
      recommendedAction: "pause",
    };
  }

  if (limit?.soft !== undefined && usage >= limit.soft) {
    return {
      status: "soft_limit",
      key,
      usage,
      softLimit: limit.soft,
      hardLimit: limit?.hard,
      reason: `${key} soft limit reached (${usage}/${limit.soft}).`,
      recommendedAction: "reduce_scope",
    };
  }

  return {
    status: "ok",
    key,
    usage,
    softLimit: limit?.soft,
    hardLimit: limit?.hard,
    reason: `${key} within budget (${usage}).`,
    recommendedAction: "continue",
  };
}

export async function persistBudgetDecision(
  cwd: string,
  state: ScalerState,
  decision: BudgetDecision,
): Promise<ScalerState> {
  let nextState = state;
  if (decision.status === "hard_limit") {
    nextState = transitionStage(state, "paused", { reason: decision.reason });
  }

  await saveState(cwd, nextState);

  if (decision.status !== "ok") {
    await appendLogEvent(
      cwd,
      createLogEvent(nextState, {
        eventType: "budget",
        summary: decision.reason,
        details: decision,
      }),
    );
  }

  return nextState;
}

export function getStrongestBudgetDecision(decisions: BudgetDecision[]): BudgetDecision {
  if (decisions.length === 0) return evaluateBudgetUsage("toolCalls", 0);
  return decisions.reduce((strongest, candidate) => strongerDecision(strongest, candidate));
}

function strongerDecision(first: BudgetDecision, second: BudgetDecision): BudgetDecision {
  const rank: Record<BudgetDecisionStatus, number> = { ok: 0, soft_limit: 1, hard_limit: 2 };
  return rank[second.status] > rank[first.status] ? second : first;
}

function normalizeUsage(value: unknown): Partial<Record<BudgetUsageKey, number>> {
  const source = isRecord(value) ? value : {};
  const usage: Partial<Record<BudgetUsageKey, number>> = {};
  for (const key of budgetUsageKeys) {
    const raw = source[key];
    if (typeof raw === "number" && Number.isFinite(raw)) usage[key] = raw;
  }
  return usage;
}

function normalizeLimits(value: unknown): Partial<Record<BudgetUsageKey, BudgetLimit>> {
  const source = isRecord(value) ? value : {};
  const limits: Partial<Record<BudgetUsageKey, BudgetLimit>> = {};
  for (const key of budgetUsageKeys) {
    const raw = source[key];
    if (!isRecord(raw)) continue;
    limits[key] = {
      soft: typeof raw.soft === "number" && Number.isFinite(raw.soft) ? raw.soft : undefined,
      hard: typeof raw.hard === "number" && Number.isFinite(raw.hard) ? raw.hard : undefined,
    };
  }
  return limits;
}

function normalizeScopedBudgetPolicies(value: unknown): ScopedBudgetPolicy[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((raw) => {
      const scopeKind = normalizeScopeKind(raw.scopeKind);
      const scopeId = typeof raw.scopeId === "string" && raw.scopeId.trim() ? raw.scopeId.trim() : "run";
      const createdAt = typeof raw.createdAt === "string" ? raw.createdAt : new Date(0).toISOString();
      return {
        id: typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : `${scopeKind}-${scopeId}`,
        scopeKind,
        scopeId,
        limits: normalizeLimits(raw.limits),
        requiresApproval: raw.requiresApproval === true,
        approvalId: typeof raw.approvalId === "string" ? raw.approvalId : undefined,
        reason: typeof raw.reason === "string" ? raw.reason : undefined,
        createdAt,
        updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : createdAt,
      } satisfies ScopedBudgetPolicy;
    });
}

function normalizeScopeKind(value: unknown): BudgetScopeKind {
  const normalized = typeof value === "string" ? value : "run";
  const allowed: BudgetScopeKind[] = ["run", "stage", "plan", "task", "task_agent", "research_agent", "tool_agent", "debug_loop", "validation_loop"];
  return allowed.includes(normalized as BudgetScopeKind) ? normalized as BudgetScopeKind : "run";
}

async function scanPathBytes(path: string): Promise<number> {
  try {
    const info = await stat(path);
    if (info.isFile()) return info.size;
    if (!info.isDirectory()) return 0;
    const entries = await readdir(path);
    const sizes = await Promise.all(entries.map((entry) => scanPathBytes(join(path, entry))));
    return sizes.reduce((total, size) => total + size, 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

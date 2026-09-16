/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import { link, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { getStatePath } from "./paths.js";
import type { ScalerState } from "./types.js";

export function createDefaultState(now = new Date()): ScalerState {
  const timestamp = now.toISOString();
  return {
    version: 1,
    runId: randomUUID(),
    complexityLevel: 0,
    stage: "idle",
    previousStage: null,
    currentTaskId: null,
    tasks: [],
    completedTaskIds: [],
    validatedTaskIds: [],
    failedTaskId: null,
    blockers: [],
    memoryRefs: [],
    rejectedTransitions: [],
    budgets: {},
    orchestrationReason: "not started",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export async function loadState(cwd: string): Promise<ScalerState> {
  const statePath = getStatePath(cwd);
  try {
    const raw = await readFile(statePath, "utf8");
    return JSON.parse(raw) as ScalerState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return createDefaultState();
    }
    throw error;
  }
}

export async function saveState(cwd: string, state: ScalerState): Promise<void> {
  await publishState(cwd, state, false);
}

// Publish a complete snapshot on the same filesystem. This prevents torn reads;
// it is not a compare-and-swap transaction and does not serialize state writers.
async function publishState(cwd: string, state: ScalerState, createOnly: boolean): Promise<void> {
  const statePath = getStatePath(cwd);
  await mkdir(dirname(statePath), { recursive: true });
  const nextState = { ...state, updatedAt: new Date().toISOString() } satisfies ScalerState;
  const temporaryPath = `${statePath}.${randomUUID()}.tmp`;
  try {
    const file = await open(temporaryPath, "wx", 0o600);
    try {
      await file.writeFile(`${JSON.stringify(nextState, null, 2)}\n`, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    // Initialization links the completed snapshot only if statePath is absent
    // (EEXIST preserves any existing state). Normal saves replace it via rename.
    if (createOnly) await link(temporaryPath, statePath);
    else await rename(temporaryPath, statePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export async function ensureState(cwd: string): Promise<ScalerState> {
  try {
    return JSON.parse(await readFile(getStatePath(cwd), "utf8")) as ScalerState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  try {
    await publishState(cwd, createDefaultState(), true);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  return loadState(cwd);
}

export interface StateStatusDetails {
  memoryCount?: number;
  debugFailureCount?: number;
  debugAttemptCount?: number;
  budgetUsage?: Record<string, number | undefined>;
  logPath?: string;
}

export function formatStateStatus(state: ScalerState): string {
  const taskPart = state.currentTaskId ? ` task=${state.currentTaskId}` : "";
  return `SCALER stage=${state.stage} level=${state.complexityLevel}${taskPart} validated=${state.validatedTaskIds.length}/${state.tasks.length}`;
}

export function formatDetailedStateStatus(state: ScalerState, details: StateStatusDetails = {}): string {
  const parts = [
    formatStateStatus(state),
    `tasks=${formatTaskStatusCounts(state)}`,
    `rejected=${state.rejectedTransitions.length}`,
  ];

  if (details.memoryCount !== undefined) parts.push(`memories=${details.memoryCount}`);
  if (details.debugFailureCount !== undefined || details.debugAttemptCount !== undefined) {
    parts.push(`debug=failures:${details.debugFailureCount ?? 0},attempts:${details.debugAttemptCount ?? 0}`);
  }
  if (details.budgetUsage) parts.push(`budgets=${formatBudgetUsage(details.budgetUsage)}`);
  if (details.logPath) parts.push(`log=${details.logPath}`);

  return parts.join(" ");
}

export function getTaskStatusCounts(state: ScalerState): Record<string, number> {
  return state.tasks.reduce<Record<string, number>>((counts, task) => {
    counts[task.status] = (counts[task.status] ?? 0) + 1;
    return counts;
  }, {});
}

function formatTaskStatusCounts(state: ScalerState): string {
  const counts = getTaskStatusCounts(state);
  const entries = Object.entries(counts).sort(([a], [b]) => a.localeCompare(b));
  return entries.length === 0 ? "none" : entries.map(([status, count]) => `${status}:${count}`).join(",");
}

function formatBudgetUsage(usage: Record<string, number | undefined>): string {
  const entries = Object.entries(usage)
    .filter(([, value]) => typeof value === "number")
    .sort(([a], [b]) => a.localeCompare(b));
  return entries.length === 0 ? "none" : entries.map(([key, value]) => `${key}:${value}`).join(",");
}

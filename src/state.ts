import { mkdir, readFile, writeFile } from "node:fs/promises";
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
  const statePath = getStatePath(cwd);
  await mkdir(dirname(statePath), { recursive: true });
  const nextState = { ...state, updatedAt: new Date().toISOString() } satisfies ScalerState;
  await writeFile(statePath, `${JSON.stringify(nextState, null, 2)}\n`, "utf8");
}

export async function ensureState(cwd: string): Promise<ScalerState> {
  const state = await loadState(cwd);
  await saveState(cwd, state);
  return loadState(cwd);
}

export interface StateStatusDetails {
  memoryCount?: number;
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

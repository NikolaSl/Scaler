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
    currentTaskId: null,
    tasks: [],
    completedTaskIds: [],
    validatedTaskIds: [],
    failedTaskId: null,
    blockers: [],
    memoryRefs: [],
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

export function formatStateStatus(state: ScalerState): string {
  const taskPart = state.currentTaskId ? ` task=${state.currentTaskId}` : "";
  return `SCALER stage=${state.stage} level=${state.complexityLevel}${taskPart} validated=${state.validatedTaskIds.length}/${state.tasks.length}`;
}

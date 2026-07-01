import type { ScalerStage, ScalerState, ScalerTaskState, ScalerTaskStatus } from "./types.js";

export interface TransitionResult {
  ok: boolean;
  reason?: string;
}

export interface StageTransitionOptions {
  reason: string;
  now?: Date;
}

export interface TaskTransitionOptions {
  reason: string;
  now?: Date;
}

const activeStages = new Set<ScalerStage>([
  "idle",
  "prd",
  "knowledge",
  "planning",
  "execution",
  "debugging",
  "replanning",
]);

const finalStages = new Set<ScalerStage>(["completed", "failed"]);

const stageTransitions: Record<ScalerStage, ReadonlySet<ScalerStage>> = {
  idle: new Set(["prd", "knowledge", "planning", "execution", "paused", "failed"]),
  prd: new Set(["knowledge", "paused", "failed"]),
  knowledge: new Set(["planning", "paused", "failed"]),
  planning: new Set(["execution", "paused", "failed"]),
  execution: new Set(["debugging", "replanning", "completed", "paused", "failed"]),
  debugging: new Set(["execution", "replanning", "paused", "failed"]),
  replanning: new Set(["execution", "paused", "failed"]),
  paused: new Set(["idle", "prd", "knowledge", "planning", "execution", "debugging", "replanning", "failed"]),
  completed: new Set([]),
  failed: new Set([]),
};

const taskTransitions: Record<ScalerTaskStatus, ReadonlySet<ScalerTaskStatus>> = {
  pending: new Set(["ready", "failed"]),
  ready: new Set(["running", "failed"]),
  running: new Set(["validating", "blocked", "failed"]),
  validating: new Set(["validated", "debugging", "blocked", "failed"]),
  debugging: new Set(["running", "validated", "needs_replan", "failed"]),
  blocked: new Set(["ready", "failed"]),
  needs_replan: new Set(["ready", "failed"]),
  validated: new Set([]),
  failed: new Set([]),
};

export function canTransitionStage(state: ScalerState, to: ScalerStage): TransitionResult {
  if (finalStages.has(state.stage)) {
    return { ok: false, reason: `Cannot transition from final stage ${state.stage}.` };
  }

  if (state.stage === to) {
    return { ok: true };
  }

  if (to === "completed" && state.tasks.length > 0 && state.validatedTaskIds.length !== state.tasks.length) {
    return { ok: false, reason: "Cannot complete run before all tasks are validated." };
  }

  if (to === "paused" && !activeStages.has(state.stage)) {
    return { ok: false, reason: `Cannot pause from stage ${state.stage}.` };
  }

  if (state.stage === "paused" && to !== "failed") {
    const previous = state.previousStage;
    if (previous && to !== previous) {
      return { ok: false, reason: `Paused run can only resume to previous stage ${previous}.` };
    }
  }

  if (!stageTransitions[state.stage].has(to)) {
    return { ok: false, reason: `Invalid stage transition ${state.stage} -> ${to}.` };
  }

  return { ok: true };
}

export function transitionStage(state: ScalerState, to: ScalerStage, options: StageTransitionOptions): ScalerState {
  const result = canTransitionStage(state, to);
  const timestamp = (options.now ?? new Date()).toISOString();

  if (!result.ok) {
    return recordRejectedTransition(state, "stage", state.stage, to, result.reason ?? "Rejected.", timestamp);
  }

  return {
    ...state,
    stage: to,
    previousStage: to === "paused" ? state.stage : to === "failed" ? state.previousStage : null,
    orchestrationReason: options.reason,
    updatedAt: timestamp,
  };
}

export function canTransitionTask(task: ScalerTaskState, to: ScalerTaskStatus): TransitionResult {
  if (task.status === to) {
    return { ok: true };
  }

  if (!taskTransitions[task.status].has(to)) {
    return { ok: false, reason: `Invalid task transition ${task.status} -> ${to}.` };
  }

  return { ok: true };
}

export function transitionTask(
  state: ScalerState,
  taskId: string,
  to: ScalerTaskStatus,
  options: TaskTransitionOptions,
): ScalerState {
  const task = state.tasks.find((candidate) => candidate.id === taskId);
  const timestamp = (options.now ?? new Date()).toISOString();

  if (!task) {
    return recordRejectedTransition(state, "task", "missing", to, `Task ${taskId} does not exist.`, timestamp);
  }

  const result = canTransitionTask(task, to);
  if (!result.ok) {
    return recordRejectedTransition(state, "task", task.status, to, result.reason ?? "Rejected.", timestamp);
  }

  const tasks = state.tasks.map((candidate) =>
    candidate.id === taskId ? { ...candidate, status: to, updatedAt: timestamp } : candidate,
  );

  return {
    ...state,
    tasks,
    currentTaskId: to === "running" || to === "validating" || to === "debugging" ? taskId : state.currentTaskId,
    completedTaskIds: addUniqueWhen(state.completedTaskIds, taskId, to === "validated"),
    validatedTaskIds: addUniqueWhen(state.validatedTaskIds, taskId, to === "validated"),
    failedTaskId: to === "failed" ? taskId : state.failedTaskId,
    orchestrationReason: options.reason,
    updatedAt: timestamp,
  };
}

export function addTask(state: ScalerState, task: Omit<ScalerTaskState, "updatedAt">, now = new Date()): ScalerState {
  if (state.tasks.some((candidate) => candidate.id === task.id)) {
    return recordRejectedTransition(
      state,
      "task",
      "missing",
      task.status,
      `Task ${task.id} already exists.`,
      now.toISOString(),
    );
  }

  const timestamp = now.toISOString();
  return {
    ...state,
    tasks: [...state.tasks, { ...task, updatedAt: timestamp }],
    updatedAt: timestamp,
  };
}

function addUniqueWhen(values: string[], value: string, condition: boolean): string[] {
  if (!condition || values.includes(value)) return values;
  return [...values, value];
}

function recordRejectedTransition(
  state: ScalerState,
  kind: "stage" | "task",
  from: string,
  to: string,
  reason: string,
  timestamp: string,
): ScalerState {
  return {
    ...state,
    rejectedTransitions: [
      ...state.rejectedTransitions,
      { kind, from, to, reason, timestamp },
    ],
    updatedAt: timestamp,
  };
}

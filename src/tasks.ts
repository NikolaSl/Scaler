import { appendLogEvent, createLogEvent } from "./logging.js";
import { isScalerTaskStatus } from "./reports.js";
import { saveState } from "./state.js";
import { addTask, transitionTask } from "./supervisor.js";
import type { ScalerState, ScalerTaskStatus } from "./types.js";

export interface CreateTaskInput {
  id: string;
  title?: string;
  status?: ScalerTaskStatus | string;
  allowedPathPrefixes?: string[];
  dependsOn?: string[];
}

export interface CreateTaskResult {
  state: ScalerState;
  accepted: boolean;
  message: string;
}

export interface UpdateTaskInput {
  id: string;
  title?: string;
  status?: ScalerTaskStatus | string;
  allowedPathPrefixes?: string[];
  dependsOn?: string[];
}

export interface UpdateTaskResult {
  state: ScalerState;
  accepted: boolean;
  message: string;
}

export interface RetryTaskResult {
  state: ScalerState;
  accepted: boolean;
  message: string;
}

export function formatTaskList(state: ScalerState): string {
  if (state.tasks.length === 0) return "No Scaler tasks.";

  const lines = ["Scaler tasks:"];
  for (const task of state.tasks) {
    const current = task.id === state.currentTaskId ? " *current*" : "";
    const title = task.title ? ` - ${task.title}` : "";
    const paths = task.allowedPathPrefixes && task.allowedPathPrefixes.length > 0 ? ` [paths: ${task.allowedPathPrefixes.join(", ")}]` : "";
    const deps = task.dependsOn && task.dependsOn.length > 0 ? ` [depends: ${task.dependsOn.join(", ")}]` : "";
    lines.push(`- ${task.id}: ${task.status}${current}${title}${paths}${deps}`);
  }
  return lines.join("\n");
}

export async function retryTask(cwd: string, state: ScalerState, taskId: string, reason = "Task retry requested."): Promise<RetryTaskResult> {
  const task = state.tasks.find((candidate) => candidate.id === taskId);
  if (!task) {
    const message = `Task retry rejected: ${taskId} does not exist`;
    await appendLogEvent(cwd, createLogEvent(state, { eventType: "state", summary: message, taskId, details: { reason } }));
    return { state, accepted: false, message };
  }

  const targetStatus = getRetryTargetStatus(task.status);
  if (!targetStatus) {
    const message = `Task retry rejected: ${taskId} cannot retry from ${task.status}`;
    await appendLogEvent(cwd, createLogEvent(state, { eventType: "state", summary: message, taskId, details: { reason } }));
    return { state, accepted: false, message };
  }

  const beforeRejected = state.rejectedTransitions.length;
  const nextState = transitionTask(state, taskId, targetStatus, { reason });
  const accepted = nextState.rejectedTransitions.length === beforeRejected;
  await saveState(cwd, nextState);
  const message = accepted ? `Task retry accepted: ${taskId} -> ${targetStatus}` : `Task retry rejected: ${taskId}`;
  await appendLogEvent(cwd, createLogEvent(nextState, { eventType: "state", summary: message, taskId, details: { reason, targetStatus } }));
  return { state: nextState, accepted, message };
}

export async function updateTask(cwd: string, state: ScalerState, input: UpdateTaskInput): Promise<UpdateTaskResult> {
  const existing = state.tasks.find((task) => task.id === input.id);
  if (!existing) {
    const message = `Task update rejected: ${input.id} does not exist`;
    await appendLogEvent(cwd, createLogEvent(state, { eventType: "state", summary: message, taskId: input.id, details: input }));
    return { state, accepted: false, message };
  }

  let nextState = state;
  if (input.status !== undefined) {
    if (!isScalerTaskStatus(input.status)) {
      const message = `Task update rejected: invalid status ${String(input.status)}`;
      await appendLogEvent(cwd, createLogEvent(state, { eventType: "state", summary: message, taskId: input.id, details: input }));
      return { state, accepted: false, message };
    }

    const beforeRejected = nextState.rejectedTransitions.length;
    nextState = transitionTask(nextState, input.id, input.status, { reason: "Task metadata update requested." });
    if (nextState.rejectedTransitions.length !== beforeRejected) {
      await saveState(cwd, nextState);
      const message = `Task update rejected: invalid transition ${existing.status} -> ${input.status}`;
      await appendLogEvent(cwd, createLogEvent(nextState, { eventType: "state", summary: message, taskId: input.id, details: input }));
      return { state: nextState, accepted: false, message };
    }
  }

  const timestamp = new Date().toISOString();
  nextState = {
    ...nextState,
    tasks: nextState.tasks.map((task) =>
      task.id === input.id
        ? {
            ...task,
            title: input.title ?? task.title,
            allowedPathPrefixes: input.allowedPathPrefixes ? normalizeAllowedPaths(input.allowedPathPrefixes) : task.allowedPathPrefixes,
            dependsOn: input.dependsOn ? normalizeIdList(input.dependsOn) : task.dependsOn,
            updatedAt: timestamp,
          }
        : task,
    ),
    updatedAt: timestamp,
  };

  await saveState(cwd, nextState);
  await appendLogEvent(
    cwd,
    createLogEvent(nextState, { eventType: "state", summary: `Task updated: ${input.id}`, taskId: input.id, details: input }),
  );
  return { state: nextState, accepted: true, message: `Task updated: ${input.id}` };
}

export async function createTask(cwd: string, state: ScalerState, input: CreateTaskInput): Promise<CreateTaskResult> {
  const status = input.status ?? "pending";
  if (!isScalerTaskStatus(status)) {
    await appendLogEvent(
      cwd,
      createLogEvent(state, {
        eventType: "state",
        summary: `Task create rejected: invalid status ${String(status)}`,
        taskId: input.id,
        details: input,
      }),
    );
    return {
      state,
      accepted: false,
      message: `Task create rejected: invalid status ${String(status)}`,
    };
  }

  const beforeRejected = state.rejectedTransitions.length;
  const nextState = addTask(state, {
    id: input.id,
    title: input.title,
    status,
    allowedPathPrefixes: normalizeAllowedPaths(input.allowedPathPrefixes),
    dependsOn: normalizeIdList(input.dependsOn),
  });
  const accepted = nextState.rejectedTransitions.length === beforeRejected;

  await saveState(cwd, nextState);
  await appendLogEvent(
    cwd,
    createLogEvent(nextState, {
      eventType: "state",
      summary: accepted ? `Task created: ${input.id}` : `Task create rejected: ${input.id}`,
      taskId: input.id,
      details: input,
    }),
  );

  return {
    state: nextState,
    accepted,
    message: accepted ? `Task created: ${input.id}` : `Task create rejected: ${input.id}`,
  };
}

function getRetryTargetStatus(status: ScalerTaskStatus): ScalerTaskStatus | undefined {
  if (status === "debugging") return "running";
  if (status === "blocked" || status === "needs_replan") return "ready";
  return undefined;
}

function normalizeAllowedPaths(paths: string[] | undefined): string[] | undefined {
  const normalized = (paths ?? [])
    .map((path) => path.trim().replace(/^\.\//, "").replace(/\/$/, ""))
    .filter((path) => path.length > 0);
  return normalized.length > 0 ? [...new Set(normalized)] : undefined;
}

function normalizeIdList(ids: string[] | undefined): string[] | undefined {
  const normalized = (ids ?? []).map((id) => id.trim()).filter((id) => id.length > 0);
  return normalized.length > 0 ? [...new Set(normalized)] : undefined;
}

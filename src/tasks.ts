import { appendLogEvent, createLogEvent } from "./logging.js";
import { isScalerTaskStatus } from "./reports.js";
import { saveState } from "./state.js";
import { addTask } from "./supervisor.js";
import type { ScalerState, ScalerTaskStatus } from "./types.js";

export interface CreateTaskInput {
  id: string;
  title?: string;
  status?: ScalerTaskStatus | string;
  allowedPathPrefixes?: string[];
}

export interface CreateTaskResult {
  state: ScalerState;
  accepted: boolean;
  message: string;
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

function normalizeAllowedPaths(paths: string[] | undefined): string[] | undefined {
  const normalized = (paths ?? [])
    .map((path) => path.trim().replace(/^\.\//, "").replace(/\/$/, ""))
    .filter((path) => path.length > 0);
  return normalized.length > 0 ? [...new Set(normalized)] : undefined;
}

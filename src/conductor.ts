import { resolveContext, type ContextItem, type ResolvedContext } from "./context.js";
import type { ScalerState, ScalerTaskState } from "./types.js";

export interface NextTaskSelection {
  task?: ScalerTaskState;
  promotePending: boolean;
  reason: string;
}

const ignoredTaskStatuses = new Set(["running", "validating", "debugging", "validated", "blocked", "needs_replan", "failed"]);

export interface TaskPromptInput {
  state: ScalerState;
  task: ScalerTaskState;
  contextItems?: ContextItem[];
  tokenBudget?: number;
}

export interface TaskPromptResult {
  prompt: string;
  resolvedContext: ResolvedContext;
}

export function selectNextTask(state: ScalerState): NextTaskSelection {
  const ready = state.tasks.find((task) => task.status === "ready");
  if (ready) {
    return { task: ready, promotePending: false, reason: `Selected ready task ${ready.id}.` };
  }

  const pending = state.tasks.find((task) => task.status === "pending");
  if (pending) {
    return { task: pending, promotePending: true, reason: `Selected pending task ${pending.id} for promotion.` };
  }

  if (state.tasks.length === 0) {
    return { promotePending: false, reason: "No tasks exist." };
  }

  const ignoredSummary = state.tasks
    .filter((task) => ignoredTaskStatuses.has(task.status))
    .map((task) => `${task.id}:${task.status}`)
    .join(", ");

  return {
    promotePending: false,
    reason: ignoredSummary ? `No runnable tasks. Ignored ${ignoredSummary}.` : "No runnable tasks.",
  };
}

export function buildTaskAgentPrompt(input: TaskPromptInput): TaskPromptResult {
  const resolvedContext = resolveContext({
    state: input.state,
    taskId: input.task.id,
    taskGoal: input.task.title,
    items: input.contextItems ?? [],
    tokenBudget: input.tokenBudget,
  });

  const prompt = [
    "# SCALER Task Agent Request",
    `Task ID: ${input.task.id}`,
    `Task title: ${input.task.title ?? "Untitled"}`,
    `Current task status: ${input.task.status}`,
    `Supervisor stage: ${input.state.stage}`,
    "",
    "## Operating rules",
    "- Work only on this task's scope.",
    "- Do not guess if required context is missing; report missing context instead.",
    "- Keep changes minimal and focused.",
    "- Run the strongest practical validation for this task.",
    "- Finish by submitting structured Scaler reports/tools where available.",
    "",
    "## Required final report",
    "Report task result, files changed, validation run, validation outcome, blockers, and memory references.",
    "If implementation is complete, request task transition to validating or submit a validation report.",
    "",
    resolvedContext.text,
  ].join("\n");

  return { prompt, resolvedContext };
}

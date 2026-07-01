import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { writeCheckpoint } from "./checkpoints.js";
import { resolveContext, type ContextItem, type ResolvedContext } from "./context.js";
import { appendLogEvent, createLogEvent } from "./logging.js";
import { getValidationHandoffsPath } from "./paths.js";
import { saveState } from "./state.js";
import { buildTaskAgentInvocation, runTaskAgent, type TaskAgentInvocation, type TaskAgentRunResult } from "./subagents.js";
import { transitionTask } from "./supervisor.js";
import type { ScalerState, ScalerTaskState } from "./types.js";

export interface NextTaskSelection {
  task?: ScalerTaskState;
  promotePending: boolean;
  reason: string;
}

const ignoredTaskStatuses = new Set(["running", "validating", "debugging", "validated", "blocked", "needs_replan", "failed"]);

export interface ConductorStepOptions {
  execute?: boolean;
  contextItems?: ContextItem[];
  tokenBudget?: number;
  tools?: string[];
  model?: string;
  timeoutMs?: number;
}

export interface ValidationHandoffRecord {
  taskId: string;
  status: "validation_required" | "task_agent_failed";
  runExitCode: number;
  summary: string;
  createdAt: string;
}

export interface ValidationHandoffIndex {
  version: 1;
  handoffs: ValidationHandoffRecord[];
}

export interface ConductorStepResult {
  accepted: boolean;
  message: string;
  state: ScalerState;
  task?: ScalerTaskState;
  prompt?: string;
  invocation?: TaskAgentInvocation;
  runResult?: TaskAgentRunResult;
  checkpointPath?: string;
  validationHandoff?: ValidationHandoffRecord;
}

export type TaskAgentRunner = typeof runTaskAgent;

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

export async function runConductorStep(
  cwd: string,
  state: ScalerState,
  options: ConductorStepOptions = {},
  runner: TaskAgentRunner = runTaskAgent,
): Promise<ConductorStepResult> {
  const selection = selectNextTask(state);
  if (!selection.task) {
    await appendLogEvent(cwd, createLogEvent(state, { eventType: "system", summary: selection.reason }));
    return { accepted: false, message: selection.reason, state };
  }

  let nextState = state;
  if (selection.promotePending) {
    nextState = transitionTask(nextState, selection.task.id, "ready", { reason: "Conductor selected pending task." });
  }
  nextState = transitionTask(nextState, selection.task.id, "running", { reason: "Conductor started task." });
  await saveState(cwd, nextState);

  const runningTask = nextState.tasks.find((task) => task.id === selection.task!.id)!;
  const { prompt } = buildTaskAgentPrompt({
    state: nextState,
    task: runningTask,
    contextItems: options.contextItems,
    tokenBudget: options.tokenBudget,
  });
  const request = {
    taskId: runningTask.id,
    prompt,
    tools: options.tools,
    model: options.model,
    cwd,
  };
  const invocation = buildTaskAgentInvocation(request);
  const runResult = options.execute ? await runner(request, { timeoutMs: options.timeoutMs }) : undefined;
  const handoff = runResult ? await applyTaskRunHandoff(cwd, nextState, runningTask.id, runResult) : undefined;
  const finalState = handoff?.state ?? nextState;

  await appendLogEvent(
    cwd,
    createLogEvent(finalState, {
      eventType: "agent",
      summary: `${options.execute ? "Executed" : "Prepared"} conductor task step: ${runningTask.id}`,
      taskId: runningTask.id,
      details: { selection, invocation, runResult, validationHandoff: handoff?.record },
    }),
  );
  const checkpoint = await writeCheckpoint(cwd, finalState, `conductor-step-${runningTask.id}`, selection.reason);

  return {
    accepted: true,
    message: `${options.execute ? "Executed" : "Prepared"} task ${runningTask.id}`,
    state: checkpoint.state,
    task: runningTask,
    prompt,
    invocation,
    runResult,
    checkpointPath: checkpoint.path,
    validationHandoff: handoff?.record,
  };
}

export async function loadValidationHandoffs(cwd: string): Promise<ValidationHandoffRecord[]> {
  try {
    const raw = await readFile(getValidationHandoffsPath(cwd), "utf8");
    return (JSON.parse(raw) as ValidationHandoffIndex).handoffs;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function applyTaskRunHandoff(
  cwd: string,
  state: ScalerState,
  taskId: string,
  runResult: TaskAgentRunResult,
  now = new Date(),
): Promise<{ state: ScalerState; record: ValidationHandoffRecord }> {
  const passedAgentRun = runResult.exitCode === 0;
  const targetStatus = passedAgentRun ? "validating" : "failed";
  const nextState = transitionTask(state, taskId, targetStatus, {
    reason: passedAgentRun ? "Task agent completed; validation required." : "Task agent failed before validation.",
    now,
  });
  await saveState(cwd, nextState);

  const record: ValidationHandoffRecord = {
    taskId,
    status: passedAgentRun ? "validation_required" : "task_agent_failed",
    runExitCode: runResult.exitCode,
    summary: passedAgentRun
      ? `Task ${taskId} is ready for validation.`
      : `Task ${taskId} task-agent run failed before validation.`,
    createdAt: now.toISOString(),
  };
  const handoffs = await loadValidationHandoffs(cwd);
  await writeValidationHandoffs(cwd, [...handoffs, record]);
  await appendLogEvent(
    cwd,
    createLogEvent(nextState, {
      eventType: "validation",
      summary: record.summary,
      taskId,
      details: { record, runResult },
    }),
  );
  return { state: nextState, record };
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

async function writeValidationHandoffs(cwd: string, handoffs: ValidationHandoffRecord[]): Promise<void> {
  const path = getValidationHandoffsPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ version: 1, handoffs } satisfies ValidationHandoffIndex, null, 2)}\n`, "utf8");
}

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { writeCheckpoint } from "./checkpoints.js";
import {
  ensureTaskContextManifest,
  resolveContext,
  resolveTaskContextManifest,
  type ContextItem,
  type ResolvedContext,
} from "./context.js";
import { acquireExecutionLock, releaseExecutionLock } from "./locks.js";
import { appendLogEvent, createLogEvent, logAgentPromptAudit } from "./logging.js";
import { getTaskAgentRunsPath, getValidationHandoffsPath } from "./paths.js";
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

export interface TaskAgentRunRecord {
  id: string;
  taskId: string;
  status: "passed" | "failed";
  exitCode: number;
  stdoutEventCount: number;
  stderrSummary: string;
  timedOut: boolean;
  aborted: boolean;
  createdAt: string;
}

export interface TaskAgentRunIndex {
  version: 1;
  runs: TaskAgentRunRecord[];
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
  const ready = state.tasks.find((task) => task.status === "ready" && dependenciesSatisfied(state, task));
  if (ready) {
    return { task: ready, promotePending: false, reason: `Selected ready task ${ready.id}.` };
  }

  const pending = state.tasks.find((task) => task.status === "pending" && dependenciesSatisfied(state, task));
  if (pending) {
    return { task: pending, promotePending: true, reason: `Selected pending task ${pending.id} for promotion.` };
  }

  if (state.tasks.length === 0) {
    return { promotePending: false, reason: "No tasks exist." };
  }

  const blockedByDependencies = state.tasks
    .filter((task) => (task.status === "ready" || task.status === "pending") && !dependenciesSatisfied(state, task))
    .map((task) => `${task.id}:waiting-for:${missingDependencies(state, task).join("+")}`)
    .join(", ");
  const ignoredSummary = state.tasks
    .filter((task) => ignoredTaskStatuses.has(task.status))
    .map((task) => `${task.id}:${task.status}`)
    .join(", ");
  const details = [blockedByDependencies && `Blocked by dependencies ${blockedByDependencies}`, ignoredSummary && `Ignored ${ignoredSummary}`]
    .filter(Boolean)
    .join(". ");

  return {
    promotePending: false,
    reason: details ? `No runnable tasks. ${details}.` : "No runnable tasks.",
  };
}

export function dependenciesSatisfied(state: ScalerState, task: ScalerTaskState): boolean {
  return missingDependencies(state, task).length === 0;
}

export function missingDependencies(state: ScalerState, task: ScalerTaskState): string[] {
  return (task.dependsOn ?? []).filter((dependencyId) => !state.validatedTaskIds.includes(dependencyId));
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

  const lock = await acquireExecutionLock(cwd, {
    operation: options.execute ? "conductor_execute" : "conductor_prepare",
    taskId: selection.task.id,
    reason: selection.reason,
  });
  if (!lock.acquired) {
    await appendLogEvent(cwd, createLogEvent(state, { eventType: "system", summary: lock.message, taskId: selection.task.id }));
    return { accepted: false, message: lock.message, state };
  }

  try {
    let nextState = state;
    if (selection.promotePending) {
    nextState = transitionTask(nextState, selection.task.id, "ready", { reason: "Conductor selected pending task." });
  }
    nextState = transitionTask(nextState, selection.task.id, "running", { reason: "Conductor started task." });
  await saveState(cwd, nextState);

  const runningTask = nextState.tasks.find((task) => task.id === selection.task!.id)!;
  const contextManifest = options.contextItems ? undefined : await ensureTaskContextManifest(cwd, nextState, runningTask.id);
  const contextItems = options.contextItems ?? (await resolveTaskContextManifest(cwd, nextState, contextManifest!));
  const { prompt } = buildTaskAgentPrompt({
    state: nextState,
    task: runningTask,
    contextItems,
    tokenBudget: options.tokenBudget ?? contextManifest?.tokenBudget,
  });
  await logAgentPromptAudit(cwd, nextState, {
    agentType: "task",
    agentId: runningTask.id,
    taskId: runningTask.id,
    prompt,
    inputRefs: contextItems.map((item) => item.id),
    details: { tokenBudget: options.tokenBudget ?? contextManifest?.tokenBudget },
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
  const runRecord = runResult ? await recordTaskAgentRun(cwd, runResult) : undefined;
  const handoff = runResult ? await applyTaskRunHandoff(cwd, nextState, runningTask.id, runResult) : undefined;
  const finalState = handoff?.state ?? nextState;

  await appendLogEvent(
    cwd,
    createLogEvent(finalState, {
      eventType: "agent",
      summary: `${options.execute ? "Executed" : "Prepared"} conductor task step: ${runningTask.id}`,
      taskId: runningTask.id,
      details: { selection, invocation, runResult, taskAgentRunRecord: runRecord, validationHandoff: handoff?.record },
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
  } finally {
    await releaseExecutionLock(cwd, lock.lock.id);
  }
}

export function formatTaskAgentRunList(records: TaskAgentRunRecord[], taskId?: string, limit = 10): string {
  const filtered = taskId ? records.filter((record) => record.taskId === taskId) : records;
  if (filtered.length === 0) return taskId ? `No task-agent runs for ${taskId}.` : "No task-agent runs.";

  const lines = [taskId ? `Task-agent runs for ${taskId}:` : "Task-agent runs:"];
  for (const record of filtered.slice(0, limit)) {
    const flags = [record.timedOut && "timed_out", record.aborted && "aborted"].filter(Boolean).join(",") || "none";
    const stderr = record.stderrSummary ? ` stderr=${record.stderrSummary}` : "";
    lines.push(`- ${record.taskId}: ${record.status} exit=${record.exitCode} flags=${flags} stdout_events=${record.stdoutEventCount}${stderr}`);
  }
  return lines.join("\n");
}

export async function loadTaskAgentRunRecords(cwd: string): Promise<TaskAgentRunRecord[]> {
  try {
    const raw = await readFile(getTaskAgentRunsPath(cwd), "utf8");
    return (JSON.parse(raw) as TaskAgentRunIndex).runs;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function recordTaskAgentRun(cwd: string, runResult: TaskAgentRunResult, now = new Date()): Promise<TaskAgentRunRecord> {
  const record: TaskAgentRunRecord = {
    id: `${runResult.taskId}-${now.getTime()}`,
    taskId: runResult.taskId,
    status: runResult.exitCode === 0 ? "passed" : "failed",
    exitCode: runResult.exitCode,
    stdoutEventCount: runResult.stdoutEvents.length,
    stderrSummary: summarizeOutput(runResult.stderr),
    timedOut: runResult.timedOut,
    aborted: runResult.aborted,
    createdAt: now.toISOString(),
  };
  await writeTaskAgentRuns(cwd, [record, ...(await loadTaskAgentRunRecords(cwd))]);
  return record;
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
    `Allowed paths: ${input.task.allowedPathPrefixes?.join(", ") || "not specified"}`,
    `Dependencies: ${input.task.dependsOn?.join(", ") || "none"}`,
    "",
    "## Operating rules",
    "- Work only on this task's scope.",
    "- Do not guess if required context is missing; report missing context instead.",
    "- Keep changes minimal and focused.",
    "- Run the strongest practical validation for this task.",
    "- Finish by submitting structured Scaler reports/tools where available.",
    "",
    "## Safety and scope",
    "- If allowed paths are specified, read/write/edit only files under those paths unless explicitly told otherwise by the supervisor.",
    "- Do not read or modify protected paths such as .env, .git/, .ssh/, .aws/, *.pem, *.key, or *.p12.",
    "- Do not run destructive commands such as rm -rf, git reset --hard, git clean -f, sudo, docker system prune, or kubectl delete.",
    "",
    "## Required final report",
    "Report task result, files changed, validation run, validation outcome, blockers, and memory references.",
    "If implementation is complete, request task transition to validating or submit a validation report.",
    "",
    resolvedContext.text,
  ].join("\n");

  return { prompt, resolvedContext };
}

async function writeTaskAgentRuns(cwd: string, runs: TaskAgentRunRecord[]): Promise<void> {
  const path = getTaskAgentRunsPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ version: 1, runs } satisfies TaskAgentRunIndex, null, 2)}\n`, "utf8");
}

function summarizeOutput(output: string, limit = 1_000): string {
  const normalized = output.trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit)}\n...[truncated ${normalized.length - limit} chars]`;
}

async function writeValidationHandoffs(cwd: string, handoffs: ValidationHandoffRecord[]): Promise<void> {
  const path = getValidationHandoffsPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ version: 1, handoffs } satisfies ValidationHandoffIndex, null, 2)}\n`, "utf8");
}

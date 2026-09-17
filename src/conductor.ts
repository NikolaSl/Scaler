/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { applyBudgetUsageUpdates, persistBudgetDecision } from "./budgets.js";
import { captureValidationContext } from "./attempt-evidence.js";
import { verifyTaskDependenciesAccepted } from "./accepted-evidence.js";
import { admitTaskExecution, startTaskExecution, checkTaskExecutionResult, interruptTaskExecution, reconcileInterruptedTaskAttempt, TaskDependencyAdmissionError } from "./attempt-execution.js";
import { writeCheckpoint } from "./checkpoints.js";
import { assessCompression, formatCompressionGuidance, type CompressionAssessment } from "./compression.js";
import { assessDebugRetryGate } from "./debug.js";
import { assessGitStatusSafety } from "./git.js";
import {
  ensureTaskContextManifest,
  resolveContext,
  resolveTaskContextManifest,
  type ContextItem,
  type ResolvedContext,
} from "./context.js";
import { recordContextSplitIfNeeded, type ContextSplitRecord } from "./context-splits.js";
import { acquireExecutionLock, releaseExecutionLock } from "./locks.js";
import { appendLogEvent, createLogEvent, logAgentPromptAudit } from "./logging.js";
import { createMissingContextRequestsFromTaskReport, refreshAndUnblockMissingContext } from "./missing-context.js";
import { getTaskAgentRunsPath, getValidationHandoffsPath } from "./paths.js";
import { recordProviderUsageBudget, type ProviderUsage } from "./provider-usage.js";
import { saveState } from "./state.js";
import { buildTaskAgentInvocation, runTaskAgent, type TaskAgentInvocation, type TaskAgentRunResult } from "./subagents.js";
import {
  completeTaskAttempt,
  taskAttemptBinding,
  type TaskAttemptBinding,
  type TaskAttemptRecord,
} from "./task-attempts.js";
import { ingestTaskAgentReportFromRun, type TaskAgentReportIngestionResult } from "./task-reports.js";
import { transitionStage, transitionTask } from "./supervisor.js";
import type { ScalerState, ScalerTaskState } from "./types.js";

export interface NextTaskSelection {
  task?: ScalerTaskState;
  promotePending: boolean;
  reason: string;
}

const ignoredTaskStatuses = new Set(["running", "validating", "debugging", "validated", "blocked", "needs_replan", "failed"]);
const defaultTaskTools = ["read", "bash", "edit", "write", "scaler_task_report"];

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
  status:
    | "validation_required"
    | "task_agent_failed"
    | "task_agent_report_missing"
    | "task_agent_report_invalid"
    | "task_agent_report_blocked"
    | "task_agent_report_failed";
  runExitCode: number;
  summary: string;
  reportId?: string;
  reportStatus?: string;
  diagnostics?: string[];
  attempt?: TaskAttemptBinding;
  outputFingerprint?: string;
  createdAt: string;
}

export interface ValidationHandoffIndex {
  version: 1;
  handoffs: ValidationHandoffRecord[];
}

export type TaskAgentRunReportStatus = "accepted" | "missing" | "invalid" | "not_required";

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
  usage?: ProviderUsage;
  reportStatus?: TaskAgentRunReportStatus;
  reportId?: string;
  reportDiagnostics?: string[];
  attempt?: TaskAttemptBinding;
  outputFingerprint?: string;
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
  contextSplit?: ContextSplitRecord;
}

export type TaskAgentRunner = typeof runTaskAgent;

export interface TaskPromptInput {
  state: ScalerState;
  task: ScalerTaskState;
  contextItems?: ContextItem[];
  tokenBudget?: number;
  attempt?: TaskAttemptBinding;
}

export interface TaskPromptResult {
  prompt: string;
  resolvedContext: ResolvedContext;
  compressionAssessment: CompressionAssessment;
}

export function defaultTaskAgentTools(extraTools: string[] = []): string[] {
  return Array.from(new Set([...defaultTaskTools, ...extraTools].map((tool) => tool.trim()).filter(Boolean)));
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
  const recovery = await reconcileInterruptedTaskAttempt(cwd, state);
  if (recovery) return recovery;
  state = (await refreshAndUnblockMissingContext(cwd, state)).state;
  const selection = selectNextTask(state);
  if (!selection.task) {
    await appendLogEvent(cwd, createLogEvent(state, { eventType: "system", summary: selection.reason }));
    return { accepted: false, message: selection.reason, state };
  }

  const debugGate = await assessDebugRetryGate(cwd, selection.task.id);
  if (!debugGate.allowed) {
    await appendLogEvent(cwd, createLogEvent(state, { eventType: "debug", summary: debugGate.reason, taskId: selection.task.id, details: debugGate }));
    return { accepted: false, message: debugGate.reason, state, task: selection.task };
  }

  const gitSafety = await assessGitStatusSafety(cwd, selection.task.allowedPathPrefixes ?? []);
  if (gitSafety.status === "unrelated") {
    const reason = `Pre-task git dirty-tree blocker for ${selection.task.id}: ${gitSafety.reason}`;
    const paused = transitionStage(state, "paused", { reason });
    const checkpoint = await writeCheckpoint(cwd, paused, "pre-task-dirty-tree", reason);
    await appendLogEvent(cwd, createLogEvent(checkpoint.state, {
      eventType: "git",
      summary: reason,
      taskId: selection.task.id,
      details: { gitSafety, checkpointPath: checkpoint.path },
      detailsPath: checkpoint.path,
    }));
    return { accepted: false, message: reason, state: checkpoint.state, task: selection.task, checkpointPath: checkpoint.path };
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

  let activeAttempt: TaskAttemptRecord | undefined;
  let attemptTerminal = false;
  try {
    const dependencyDiagnostics = await verifyTaskDependenciesAccepted(cwd, state, selection.task);
    if (dependencyDiagnostics.length > 0) {
      const message = dependencyDiagnostics.join(" ");
      await appendLogEvent(cwd, createLogEvent(state, { eventType: "rejected_transition", summary: message, taskId: selection.task.id }));
      return { accepted: false, message, state, task: selection.task };
    }
    let nextState = state;
    if (options.execute && selection.promotePending) {
      nextState = transitionTask(nextState, selection.task.id, "ready", { reason: "Conductor selected pending task." });
    }

    const runningTask = nextState.tasks.find((task) => task.id === selection.task!.id)!;
    const contextManifest = options.contextItems ? undefined : await ensureTaskContextManifest(cwd, nextState, runningTask.id);
    const contextItems = options.contextItems ?? (await resolveTaskContextManifest(cwd, nextState, contextManifest!));
    let { prompt, resolvedContext, compressionAssessment } = buildTaskAgentPrompt({
      state: nextState,
      task: runningTask,
      contextItems,
      tokenBudget: options.tokenBudget ?? contextManifest?.tokenBudget,
    });
    const contextSplit = await recordContextSplitIfNeeded(cwd, nextState, runningTask.id, resolvedContext, compressionAssessment);
    const budgetUpdates = [
      { key: "contextTokens" as const, amount: resolvedContext.estimatedTokens, mode: "set" as const },
      ...(options.execute ? [{ key: "spawnedAgents" as const, amount: 1, mode: "increment" as const }] : []),
    ];
    const budgetResult = applyBudgetUsageUpdates(nextState, budgetUpdates);
    // A refused dispatch has not spawned an agent. Keep its decision/checkpoint,
    // but do not consume the projected spawn or claim that the task is running.
    if (budgetResult.decision.status === "hard_limit") {
      const refusedBudgetState = applyBudgetUsageUpdates(nextState, budgetUpdates.filter((update) => update.key !== "spawnedAgents")).state;
      nextState = await persistBudgetDecision(cwd, refusedBudgetState, budgetResult.decision);
      return {
        accepted: false,
        message: `Budget hard limit refused task ${runningTask.id}: ${budgetResult.decision.reason}`,
        state: nextState,
        task: runningTask,
        prompt,
        contextSplit,
      };
    }
    const tools = options.tools ?? defaultTaskAgentTools();
    let attemptBinding: TaskAttemptBinding | undefined;
    if (options.execute) {
      try {
        // Admission performs the final dependency-evidence check. Publish the
        // projected spawn only after that check succeeds so a late rejection
        // cannot consume agent budget for work that never started.
        activeAttempt = await admitTaskExecution(cwd, lock.lock.id, state, runningTask, resolvedContext, options.model, tools);
      } catch (error) {
        if (!(error instanceof TaskDependencyAdmissionError)) throw error;
        const message = error.message;
        await appendLogEvent(cwd, createLogEvent(state, {
          eventType: "rejected_transition", summary: message, taskId: runningTask.id,
          details: { diagnostics: error.diagnostics, admission: "dependency_evidence" },
        }));
        return { accepted: false, message, state, task: runningTask, prompt, contextSplit };
      }
      attemptBinding = taskAttemptBinding(activeAttempt);
    }
    nextState = await persistBudgetDecision(cwd, budgetResult.state, budgetResult.decision);
    if (activeAttempt) {
      ({ prompt, resolvedContext, compressionAssessment } = buildTaskAgentPrompt({
        state: nextState,
        task: runningTask,
        contextItems,
        tokenBudget: options.tokenBudget ?? contextManifest?.tokenBudget,
        attempt: attemptBinding,
      }));
    }
    await logAgentPromptAudit(cwd, nextState, {
      agentType: "task",
      agentId: runningTask.id,
      taskId: runningTask.id,
      prompt,
      inputRefs: contextItems.map((item) => item.id),
      details: { tokenBudget: options.tokenBudget ?? contextManifest?.tokenBudget, attempt: attemptBinding },
    });
    const request = {
      taskId: runningTask.id,
      prompt,
      tools,
      model: options.model,
      cwd,
      attempt: attemptBinding,
    };
    const invocation = buildTaskAgentInvocation(request);
    if (options.execute) {
      const started = await startTaskExecution(cwd, lock.lock.id, nextState, activeAttempt!);
      nextState = started.state;
      activeAttempt = started.attempt;
    }
    const runResult = options.execute ? await runner(request, { timeoutMs: options.timeoutMs }) : undefined;
    if (runResult) {
      // Child extension hooks may have persisted usage, memory or lifecycle changes.
      // Never save the pre-dispatch snapshot over those updates during handoff.
      const checked = await checkTaskExecutionResult(cwd, activeAttempt!, runResult.taskId);
      if (checked.diagnostics.length > 0) {
        const message = checked.diagnostics.join(" ");
        const durableState = await interruptTaskExecution(cwd, lock.lock.id, activeAttempt!.id, checked.diagnostics);
        attemptTerminal = true;
        await recordTaskAgentRun(cwd, runResult, new Date(), { reportStatus: "invalid", reportDiagnostics: checked.diagnostics }, { attempt: attemptBinding });
        await appendLogEvent(cwd, createLogEvent(durableState, { eventType: "rejected_transition", summary: message, taskId: runningTask.id }));
        return { accepted: false, message, state: durableState, task: checked.task, runResult, prompt, invocation, contextSplit };
      }
      nextState = checked.state;
    }
    if (runResult?.usage) {
      nextState = (await recordProviderUsageBudget(cwd, nextState, runResult.usage, {
        source: "task-agent-run",
        taskId: runningTask.id,
        agentId: runningTask.id,
        agentType: "task",
      })).state;
    }
    const reportIngestion = runResult?.exitCode === 0
      ? await ingestTaskAgentReportFromRun(cwd, nextState, runningTask.id, runResult, attemptBinding!)
      : undefined;
    const outputFingerprint = reportIngestion?.report?.outputFingerprint;
    const validationContextFingerprint = runResult ? await captureValidationContext(cwd, nextState, runningTask.id) : undefined;
    const runRecord = runResult ? await recordTaskAgentRun(cwd, runResult, new Date(), summarizeTaskAgentReportIngestion(reportIngestion, runResult), { attempt: attemptBinding, outputFingerprint }) : undefined;
    const handoff = runResult ? await applyTaskRunHandoff(cwd, nextState, runningTask.id, runResult, reportIngestion, new Date(), { attempt: attemptBinding, outputFingerprint }) : undefined;
    if (runResult && activeAttempt) {
      const acceptedReport = reportIngestion?.report;
      const succeeded = runResult.exitCode === 0 && acceptedReport?.status === "completed";
      await completeTaskAttempt(cwd, lock.lock.id, activeAttempt.id, {
        status: succeeded ? "completed" : "failed",
        outcome: succeeded ? "succeeded" : "failed",
        outputFingerprint: acceptedReport?.outputFingerprint,
        validationContextFingerprint,
        reportId: acceptedReport?.id,
        diagnostics: reportIngestion?.diagnostics,
      });
      attemptTerminal = true;
    }
    const finalState = handoff?.state ?? nextState;

    await appendLogEvent(
      cwd,
      createLogEvent(finalState, {
        eventType: "agent",
        summary: `${options.execute ? "Executed" : "Prepared"} conductor task step: ${runningTask.id}`,
        taskId: runningTask.id,
        details: { selection, invocation, runResult, taskAgentRunRecord: runRecord, taskAgentReportIngestion: reportIngestion, validationHandoff: handoff?.record, contextSplit },
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
      contextSplit,
    };
  } catch (error) {
    if (activeAttempt && !attemptTerminal) {
      const diagnostics = [`Task attempt stopped by supervisor error: ${error instanceof Error ? error.message : String(error)}`];
      await interruptTaskExecution(cwd, lock.lock.id, activeAttempt.id, diagnostics);
    }
    throw error;
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
    const report = record.reportStatus ? ` report=${record.reportStatus}${record.reportId ? `:${record.reportId}` : ""}` : "";
    lines.push(`- ${record.taskId}: ${record.status} exit=${record.exitCode} flags=${flags} stdout_events=${record.stdoutEventCount}${report}${stderr}`);
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

export async function recordTaskAgentRun(
  cwd: string,
  runResult: TaskAgentRunResult,
  now = new Date(),
  report?: Pick<TaskAgentRunRecord, "reportStatus" | "reportId" | "reportDiagnostics">,
  identity?: Pick<TaskAgentRunRecord, "attempt" | "outputFingerprint">,
): Promise<TaskAgentRunRecord> {
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
    usage: runResult.usage,
    reportStatus: report?.reportStatus,
    reportId: report?.reportId,
    reportDiagnostics: report?.reportDiagnostics,
    attempt: identity?.attempt,
    outputFingerprint: identity?.outputFingerprint,
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
  reportIngestion?: TaskAgentReportIngestionResult,
  now = new Date(),
  identity?: Pick<ValidationHandoffRecord, "attempt" | "outputFingerprint">,
): Promise<{ state: ScalerState; record: ValidationHandoffRecord }> {
  const handoffDecision = selectTaskRunHandoff(runResult, reportIngestion);
  const nextState = transitionTask(state, taskId, handoffDecision.targetTaskStatus, {
    reason: handoffDecision.reason,
    now,
  });
  await saveState(cwd, nextState);
  const missingContext = reportIngestion?.report && (reportIngestion.report.missingData.length > 0 || reportIngestion.report.status === "needs_data" || reportIngestion.report.status === "blocked")
    ? await createMissingContextRequestsFromTaskReport(cwd, nextState, reportIngestion.report, now)
    : undefined;

  const record: ValidationHandoffRecord = {
    taskId,
    status: handoffDecision.status,
    runExitCode: runResult.exitCode,
    summary: handoffDecision.summary(taskId),
    reportId: reportIngestion?.report?.id,
    reportStatus: reportIngestion?.report?.status,
    diagnostics: reportIngestion?.diagnostics,
    attempt: identity?.attempt,
    outputFingerprint: identity?.outputFingerprint,
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
      details: { record, runResult, missingContext },
    }),
  );
  return { state: nextState, record };
}

function selectTaskRunHandoff(
  runResult: TaskAgentRunResult,
  reportIngestion: TaskAgentReportIngestionResult | undefined,
): {
  targetTaskStatus: "validating" | "blocked" | "failed";
  status: ValidationHandoffRecord["status"];
  reason: string;
  summary: (taskId: string) => string;
} {
  if (runResult.exitCode !== 0) {
    return {
      targetTaskStatus: "failed",
      status: "task_agent_failed",
      reason: "Task agent failed before validation.",
      summary: (taskId) => `Task ${taskId} task-agent run failed before validation.`,
    };
  }

  if (!reportIngestion?.accepted) {
    const status = reportIngestion?.status === "invalid" ? "task_agent_report_invalid" : "task_agent_report_missing";
    return {
      targetTaskStatus: "blocked",
      status,
      reason: "Task agent did not provide a valid structured scaler_task_report before validation.",
      summary: (taskId) => `Task ${taskId} is blocked before validation: ${reportIngestion?.diagnostics.join(" ") ?? "missing scaler_task_report"}`,
    };
  }

  const report = reportIngestion.report;
  if (!report) {
    return {
      targetTaskStatus: "blocked",
      status: "task_agent_report_invalid",
      reason: "Task agent report ingestion was accepted without a persisted report.",
      summary: (taskId) => `Task ${taskId} is blocked before validation: accepted report was not persisted.`,
    };
  }

  switch (report.status) {
    case "completed":
      return {
        targetTaskStatus: "validating",
        status: "validation_required",
        reason: "Task agent completed with structured report; validation required.",
        summary: (taskId) => `Task ${taskId} is ready for validation after structured task-agent report ${report.id}.`,
      };
    case "failed":
      return {
        targetTaskStatus: "failed",
        status: "task_agent_report_failed",
        reason: "Task agent reported failure before validation.",
        summary: (taskId) => `Task ${taskId} task-agent report marked the task failed before validation.`,
      };
    case "blocked":
    case "needs_data":
    case "needs_replan":
      return {
        targetTaskStatus: "blocked",
        status: "task_agent_report_blocked",
        reason: `Task agent reported ${report.status}; validation is blocked.`,
        summary: (taskId) => `Task ${taskId} validation blocked by task-agent report status ${report.status}.`,
      };
  }
}

export function summarizeTaskAgentReportIngestion(
  reportIngestion: TaskAgentReportIngestionResult | undefined,
  runResult: TaskAgentRunResult,
): Pick<TaskAgentRunRecord, "reportStatus" | "reportId" | "reportDiagnostics"> {
  if (runResult.exitCode !== 0) return { reportStatus: "not_required" };
  if (!reportIngestion) return { reportStatus: "missing", reportDiagnostics: ["Report ingestion did not run."] };
  return {
    reportStatus: reportIngestion.status,
    reportId: reportIngestion.report?.id,
    reportDiagnostics: reportIngestion.diagnostics,
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

  const compressionAssessment = assessCompression({
    items: resolvedContext.included,
    estimatedTokens: resolvedContext.estimatedTokens,
    contextWindowTokens: input.tokenBudget,
  });
  const compressionGuidance = formatCompressionGuidance(compressionAssessment);
  const reportIdentity = input.attempt ? {
    runId: input.attempt.runId,
    attemptId: input.attempt.attemptId,
    taskFingerprint: input.attempt.taskFingerprint,
    inputFingerprint: input.attempt.inputFingerprint,
    routeFingerprint: input.attempt.routeFingerprint,
    validationPolicyFingerprint: input.attempt.validationPolicyFingerprint,
  } : undefined;

  const prompt = [
    "# SCALER Task Agent Request",
    `Task ID: ${input.task.id}`,
    `Task title: ${input.task.title ?? "Untitled"}`,
    `Current task status: ${input.task.status}`,
    `Supervisor stage: ${input.state.stage}`,
    `Allowed paths: ${input.task.allowedPathPrefixes?.join(", ") || "not specified"}`,
    `Dependencies: ${input.task.dependsOn?.join(", ") || "none"}`,
    ...(input.attempt ? [
      `Run ID: ${input.attempt.runId}`,
      `Attempt ID: ${input.attempt.attemptId}`,
      `Task fingerprint: ${input.attempt.taskFingerprint}`,
      `Input fingerprint: ${input.attempt.inputFingerprint}`,
      `Route fingerprint: ${input.attempt.routeFingerprint}`,
      `Validation-policy fingerprint: ${input.attempt.validationPolicyFingerprint}`,
    ] : ["Attempt identity: preview only; no execution attempt admitted."]),
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
    "Finish with exactly one structured task-agent report. A successful subprocess run is not eligible for validation until SCALER ingests this report.",
    "Emit either a direct JSON event or an exact assistant JSON object with this shape:",
    JSON.stringify({
      type: "scaler_task_report",
      taskId: input.task.id,
      ...(reportIdentity ?? {}),
      status: "completed|needs_data|blocked|failed|needs_replan",
      summary: "...",
      changedFiles: ["path"],
      memoryRefs: [],
      validations: [{ command: "npm test", status: "passed|failed|skipped", summary: "..." }],
      validationRefs: [],
      evidenceRefs: [],
      blockers: [],
      missingData: [],
      recommendedNextAction: "validate",
    }),
    "Use status=completed only when implementation is ready for supervisor validation. Use blockers/missingData for blocked or needs_data outcomes.",
    "",
    compressionGuidance,
    "",
    resolvedContext.text,
  ].join("\n");

  return { prompt, resolvedContext, compressionAssessment };
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

import { applyBudgetUsageUpdates, persistBudgetDecision } from "./budgets.js";
import {
  applyTaskRunHandoff,
  buildTaskAgentPrompt,
  recordTaskAgentRun,
  type TaskAgentRunner,
} from "./conductor.js";
import { ensureTaskContextManifest, resolveTaskContextManifest, type ContextItem } from "./context.js";
import {
  loadDebugReports,
  loadDebugRetries,
  recordDebugAttempt,
  saveDebugRetries,
  type DebugNextApproachRetryRecord,
} from "./debug.js";
import { acquireExecutionLock, releaseExecutionLock } from "./locks.js";
import { appendLogEvent, createLogEvent, logAgentPromptAudit, logValidationSummaryAudit } from "./logging.js";
import { recordProviderUsageBudget } from "./provider-usage.js";
import { saveState } from "./state.js";
import { buildTaskAgentInvocation, runTaskAgent, type TaskAgentInvocation, type TaskAgentRunResult } from "./subagents.js";
import { transitionTask } from "./supervisor.js";
import type { ScalerState, ScalerTaskState } from "./types.js";
import {
  applyValidationReport,
  loadValidationRuns,
  runValidationCommandSet,
  type ValidationCommandManifest,
  type ValidationCommandRunRecord,
  type ValidationRunRecord,
} from "./validation.js";

export type DebugRetryStatus = "prepared" | "task_agent_failed" | "exact_validation_passed" | "exact_validation_failed" | "rejected";

export interface DebugNextApproachRetryOptions {
  taskId?: string;
  execute?: boolean;
  tokenBudget?: number;
  tools?: string[];
  model?: string;
  timeoutMs?: number;
}

export interface DebugNextApproachRetryResult {
  accepted: boolean;
  message: string;
  status: DebugRetryStatus;
  state: ScalerState;
  task?: ScalerTaskState;
  retry?: DebugNextApproachRetryRecord;
  prompt?: string;
  invocation?: TaskAgentInvocation;
  runResult?: TaskAgentRunResult;
  exactValidationRun?: ValidationRunRecord;
}

export interface DebugRetrySelection {
  task: ScalerTaskState;
  report: NonNullable<Awaited<ReturnType<typeof selectLatestNextApproachReport>>>;
  failedValidationRun: ValidationRunRecord;
  exactCommands: ValidationCommandManifest[];
}

export async function runDebugNextApproachRetry(
  cwd: string,
  state: ScalerState,
  options: DebugNextApproachRetryOptions = {},
  runner: TaskAgentRunner = runTaskAgent,
): Promise<DebugNextApproachRetryResult> {
  const selection = await selectDebugRetryWork(cwd, state, options.taskId);
  if (!selection) {
    const message = options.taskId ? `Debug retry rejected: no next approach retry work for ${options.taskId}.` : "Debug retry rejected: no next approach retry work.";
    await appendLogEvent(cwd, createLogEvent(state, { eventType: "debug", summary: message, taskId: options.taskId }));
    return { accepted: false, message, status: "rejected", state };
  }

  const operation = options.execute ? "debug_retry_execute" : "debug_retry_prepare";
  const lock = await acquireExecutionLock(cwd, { operation, taskId: selection.task.id, reason: "Debug next-approach retry requested." });
  if (!lock.acquired) {
    await appendLogEvent(cwd, createLogEvent(state, { eventType: "debug", summary: lock.message, taskId: selection.task.id }));
    return { accepted: false, message: lock.message, status: "rejected", state, task: selection.task };
  }

  try {
    let workingState = state;
    if (options.execute) {
      workingState = transitionTask(workingState, selection.task.id, "running", { reason: `Debug next approach retry: ${selection.report.id}` });
      await saveState(cwd, workingState);
    }

    const runningTask = workingState.tasks.find((task) => task.id === selection.task.id) ?? selection.task;
    const manifest = await ensureTaskContextManifest(cwd, workingState, runningTask.id);
    const baseContext = await resolveTaskContextManifest(cwd, workingState, manifest);
    const retryContext = buildNextApproachContextItem(selection);
    const { prompt, resolvedContext } = buildTaskAgentPrompt({
      state: workingState,
      task: runningTask,
      contextItems: [...baseContext, retryContext],
      tokenBudget: options.tokenBudget ?? manifest.tokenBudget,
    });

    const budgetResult = applyBudgetUsageUpdates(workingState, [
      { key: "contextTokens", amount: resolvedContext.estimatedTokens, mode: "set" },
      ...(options.execute ? [{ key: "spawnedAgents" as const, amount: 1, mode: "increment" as const }] : []),
    ]);
    workingState = await persistBudgetDecision(cwd, budgetResult.state, budgetResult.decision);
    if (budgetResult.decision.status === "hard_limit") {
      const retry = await upsertRetryRecord(cwd, buildRetryRecord(selection, "rejected", false, `Budget hard limit refused debug retry: ${budgetResult.decision.reason}`));
      return {
        accepted: false,
        message: retry.message,
        status: "rejected",
        state: workingState,
        task: runningTask,
        retry,
        prompt,
      };
    }

    await logAgentPromptAudit(cwd, workingState, {
      agentType: "debug-retry-task",
      agentId: runningTask.id,
      taskId: runningTask.id,
      prompt,
      inputRefs: [...baseContext.map((item) => item.id), retryContext.id],
      details: { debugReportId: selection.report.id, exactCommandIds: selection.exactCommands.map((command) => command.id) },
    });

    const request = { taskId: runningTask.id, prompt, tools: options.tools, model: options.model, cwd };
    const invocation = buildTaskAgentInvocation(request);

    if (!options.execute) {
      const retry = await upsertRetryRecord(cwd, buildRetryRecord(selection, "prepared", false, `Prepared debug retry for ${runningTask.id}.`));
      await appendLogEvent(cwd, createLogEvent(workingState, {
        eventType: "debug",
        summary: retry.message,
        taskId: runningTask.id,
        details: { retry, invocation },
      }));
      return { accepted: true, message: retry.message, status: "prepared", state: workingState, task: runningTask, retry, prompt, invocation };
    }

    const runResult = await runner(request, { timeoutMs: options.timeoutMs });
    if (runResult.usage) {
      workingState = (await recordProviderUsageBudget(cwd, workingState, runResult.usage, {
        source: "debug-retry-task-agent-run",
        taskId: runningTask.id,
        agentId: runningTask.id,
        agentType: "debug-retry-task",
      })).state;
    }
    const runRecord = await recordTaskAgentRun(cwd, runResult);
    if (runResult.exitCode !== 0) {
      const handoff = await applyTaskRunHandoff(cwd, workingState, runningTask.id, runResult);
      const attempt = await recordDebugAttempt(cwd, handoff.state, {
        taskId: runningTask.id,
        failureId: selection.report.failureId ?? selection.failedValidationRun.id,
        hypothesis: selection.report.rootCause ?? selection.report.summary,
        actionSummary: `Task-agent retry for debug report ${selection.report.id} failed before exact validation.`,
        result: "blocked",
        failureFingerprint: selection.report.failureFingerprint,
        resultingFailureFingerprint: selection.report.failureFingerprint,
        attemptSignature: `debug-retry ${selection.report.id}`,
        commands: selection.exactCommands.map((command) => command.command),
        evidence: selection.report.evidenceRefs,
        logRefs: [runRecord.id],
        failureSummary: selection.report.summary,
      });
      const retry = await upsertRetryRecord(cwd, buildRetryRecord(selection, "task_agent_failed", true, `Debug retry task agent failed: ${runningTask.id}.`, {
        taskAgentRunId: runRecord.id,
        debugAttemptId: attempt.attempt?.id,
      }));
      return { accepted: false, message: retry.message, status: "task_agent_failed", state: handoff.state, task: runningTask, retry, prompt, invocation, runResult };
    }

    const handoff = await applyTaskRunHandoff(cwd, workingState, runningTask.id, runResult);
    const exactValidationRun = await runValidationCommandSet(cwd, runningTask.id, selection.exactCommands, "debug-retry-exact");
    await logValidationSummaryAudit(cwd, handoff.state, {
      taskId: runningTask.id,
      runId: exactValidationRun.id,
      status: exactValidationRun.status,
      commandCount: exactValidationRun.commandRuns.length,
      failedCommandIds: exactValidationRun.commandRuns.filter((run) => run.status !== "passed").map((run) => run.commandId),
      gates: exactValidationRun.commandRuns.map((run) => ({ commandId: run.commandId, gate: run.gate, required: run.required, status: run.status })),
      details: { retry: true, exactValidationRun },
    });

    if (exactValidationRun.status === "passed") {
      const attempt = await recordDebugAttempt(cwd, handoff.state, {
        taskId: runningTask.id,
        failureId: selection.report.failureId ?? selection.failedValidationRun.id,
        hypothesis: selection.report.rootCause ?? selection.report.summary,
        actionSummary: `Executed next approach from debug report ${selection.report.id}; exact failing validation passed.`,
        result: "fixed",
        failureFingerprint: selection.report.failureFingerprint,
        resultingFailureFingerprint: selection.report.failureFingerprint,
        attemptSignature: `debug-retry ${selection.report.id}`,
        commands: selection.exactCommands.map((command) => command.command),
        evidence: selection.report.evidenceRefs,
        validationRun: exactValidationRun.id,
        logRefs: [runRecord.id],
        failureSummary: selection.report.summary,
      });
      const retry = await upsertRetryRecord(cwd, buildRetryRecord(selection, "exact_validation_passed", true, `Debug retry exact validation passed: ${runningTask.id}. Run full validation next.`, {
        taskAgentRunId: runRecord.id,
        validationRunId: exactValidationRun.id,
        debugAttemptId: attempt.attempt?.id,
      }));
      await appendLogEvent(cwd, createLogEvent(handoff.state, { eventType: "debug", summary: retry.message, taskId: runningTask.id, details: { retry } }));
      return { accepted: true, message: retry.message, status: "exact_validation_passed", state: handoff.state, task: runningTask, retry, prompt, invocation, runResult, exactValidationRun };
    }

    const failedState = (await applyValidationReport(cwd, handoff.state, {
      taskId: runningTask.id,
      status: "failed",
      summary: `Exact debug retry validation failed: ${runningTask.id}`,
      details: { runId: exactValidationRun.id, commandRuns: exactValidationRun.commandRuns, evidenceRefs: [exactValidationRun.id] },
    })).state;
    const attempt = await recordDebugAttempt(cwd, failedState, {
      taskId: runningTask.id,
      failureId: selection.report.failureId ?? selection.failedValidationRun.id,
      hypothesis: selection.report.rootCause ?? selection.report.summary,
      actionSummary: `Executed next approach from debug report ${selection.report.id}; exact failing validation still failed.`,
      result: "same_failure",
      failureFingerprint: selection.report.failureFingerprint,
      resultingFailureFingerprint: buildResultingFingerprint(selection.report.failureFingerprint, exactValidationRun.commandRuns),
      attemptSignature: `debug-retry ${selection.report.id}`,
      commands: selection.exactCommands.map((command) => command.command),
      evidence: selection.report.evidenceRefs,
      validationRun: exactValidationRun.id,
      logRefs: [runRecord.id],
      failureSummary: selection.report.summary,
      actualResult: summarizeFailedCommands(exactValidationRun.commandRuns),
    });
    const retry = await upsertRetryRecord(cwd, buildRetryRecord(selection, "exact_validation_failed", true, `Debug retry exact validation failed: ${runningTask.id}.`, {
      taskAgentRunId: runRecord.id,
      validationRunId: exactValidationRun.id,
      debugAttemptId: attempt.attempt?.id,
    }));
    await appendLogEvent(cwd, createLogEvent(failedState, { eventType: "debug", summary: retry.message, taskId: runningTask.id, details: { retry } }));
    return { accepted: false, message: retry.message, status: "exact_validation_failed", state: failedState, task: runningTask, retry, prompt, invocation, runResult, exactValidationRun };
  } finally {
    await releaseExecutionLock(cwd, lock.lock.id);
  }
}

export async function selectDebugRetryWork(cwd: string, state: ScalerState, taskId?: string): Promise<DebugRetrySelection | undefined> {
  const task = selectDebugRetryTask(state, taskId);
  if (!task) return undefined;
  const report = await selectLatestNextApproachReport(cwd, task.id);
  if (!report) return undefined;
  const failedValidationRun = await selectLatestFailedValidationRun(cwd, task.id);
  if (!failedValidationRun) return undefined;
  const exactCommands = selectExactFailedValidationCommands(failedValidationRun);
  if (exactCommands.length === 0) return undefined;
  return { task, report, failedValidationRun, exactCommands };
}

export function selectDebugRetryTask(state: ScalerState, taskId?: string): ScalerTaskState | undefined {
  if (taskId) return state.tasks.find((task) => task.id === taskId && task.status === "debugging");
  if (state.currentTaskId) {
    const current = state.tasks.find((task) => task.id === state.currentTaskId && task.status === "debugging");
    if (current) return current;
  }
  return state.tasks.find((task) => task.status === "debugging");
}

export async function selectLatestNextApproachReport(cwd: string, taskId: string) {
  return (await loadDebugReports(cwd))
    .filter((report) => report.taskId === taskId && report.status === "next_approach")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))[0];
}

export async function selectLatestFailedValidationRun(cwd: string, taskId: string): Promise<ValidationRunRecord | undefined> {
  return (await loadValidationRuns(cwd))
    .filter((run) => run.taskId === taskId && run.status === "failed")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))[0];
}

export function selectExactFailedValidationCommands(run: ValidationRunRecord): ValidationCommandManifest[] {
  const failedRequired = run.commandRuns.filter((command) => command.required && command.status !== "passed");
  const failed = failedRequired.length > 0 ? failedRequired : run.commandRuns.filter((command) => command.status !== "passed");
  return failed.map((command) => ({
    id: command.commandId,
    command: command.command,
    description: command.description,
    timeoutMs: undefined,
    required: command.required,
    gate: command.gate,
    expectedResult: command.expectedResult,
    evidenceRefs: command.evidenceRefs,
  }));
}

export function buildNextApproachContextItem(selection: DebugRetrySelection): ContextItem {
  const lines = [
    `Debug next approach report: ${selection.report.id}`,
    `Summary: ${selection.report.summary}`,
    selection.report.failureId ? `Failure id: ${selection.report.failureId}` : undefined,
    selection.report.failureFingerprint ? `Failure fingerprint: ${selection.report.failureFingerprint}` : undefined,
    selection.report.rootCause ? `Root cause: ${selection.report.rootCause}` : undefined,
    `Next approach: ${selection.report.nextApproach}`,
    selection.report.investigationSummary ? `Investigation: ${selection.report.investigationSummary}` : undefined,
    selection.report.evidenceRefs?.length ? `Evidence refs: ${selection.report.evidenceRefs.join(", ")}` : undefined,
    `Previous failed validation run: ${selection.failedValidationRun.id}`,
    "Exact validation commands to rerun after the retry:",
    ...selection.exactCommands.map((command) => `- ${command.id}: ${command.command}`),
    "Do not pursue unrelated changes. Implement the next approach with the smallest useful patch, then stop for validation.",
  ].filter((line): line is string => Boolean(line));
  return {
    id: `debug-next-approach-${selection.report.id}`,
    type: "decision",
    reason: "Latest accepted debug next_approach report and exact failing validation target for supervised retry.",
    content: lines.join("\n"),
    priority: "required",
    scope: "summary",
    exactness: "exact",
  };
}

export function formatDebugRetrySummary(records: DebugNextApproachRetryRecord[], limit = 10): string {
  if (records.length === 0) return "No debug retry records.";
  const lines = ["Debug retry records:"];
  for (const record of records.slice(0, limit)) {
    lines.push(`- ${record.id} task=${record.taskId} status=${record.status} report=${record.debugReportId} validation=${record.validationRunId ?? "n/a"}: ${record.message}`);
  }
  return lines.join("\n");
}

async function upsertRetryRecord(cwd: string, record: DebugNextApproachRetryRecord): Promise<DebugNextApproachRetryRecord> {
  const existing = await loadDebugRetries(cwd);
  const stored = await saveDebugRetries(cwd, [record, ...existing.filter((candidate) => candidate.id !== record.id)]);
  return stored.find((candidate) => candidate.id === record.id) ?? record;
}

function buildRetryRecord(
  selection: DebugRetrySelection,
  status: DebugRetryStatus,
  executed: boolean,
  message: string,
  extras: Partial<DebugNextApproachRetryRecord> = {},
): DebugNextApproachRetryRecord {
  const timestamp = new Date().toISOString();
  return {
    id: extras.id ?? `DEBUG-RETRY-${timestamp.replace(/[^0-9]/g, "")}`,
    taskId: selection.task.id,
    debugReportId: selection.report.id,
    nextApproach: selection.report.nextApproach ?? "",
    previousValidationRunId: selection.failedValidationRun.id,
    exactCommandIds: selection.exactCommands.map((command) => command.id),
    executed,
    status,
    taskAgentRunId: extras.taskAgentRunId,
    validationRunId: extras.validationRunId,
    debugAttemptId: extras.debugAttemptId,
    message,
    createdAt: extras.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
}

function buildResultingFingerprint(reportFingerprint: string | undefined, commandRuns: ValidationCommandRunRecord[]): string {
  const failed = commandRuns.find((run) => run.status !== "passed");
  return reportFingerprint ?? `${failed?.commandId ?? "validation"} ${failed?.stderrSummary || failed?.stdoutSummary || failed?.status || "failed"}`;
}

function summarizeFailedCommands(commandRuns: ValidationCommandRunRecord[]): string {
  return commandRuns
    .filter((run) => run.status !== "passed")
    .map((run) => `${run.commandId}:${run.status}:${run.stderrSummary || run.stdoutSummary}`)
    .join("\n");
}

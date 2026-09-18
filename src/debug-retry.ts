/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { applyBudgetUsageUpdates, persistBudgetDecision } from "./budgets.js";
import { captureValidationContext, checkAttemptEvidence } from "./attempt-evidence.js";
import { verifyTaskDependenciesAccepted } from "./accepted-evidence.js";
import { admitTaskExecution, startTaskExecution, checkTaskExecutionResult, interruptTaskExecution, reconcileInterruptedTaskAttempt, TaskContractAdmissionError, TaskDependencyAdmissionError, verifyTaskExecutionContract } from "./attempt-execution.js";
import { completeTaskAttempt, taskAttemptBinding, type TaskAttemptRecord } from "./task-attempts.js";
import {
  applyTaskRunHandoff,
  buildTaskAgentPrompt,
  recordTaskAgentRun,
  summarizeTaskAgentReportIngestion,
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
import { commitWithExecutionLock, runValidationWithExecutionLock, type LockedOperationResult } from "./operations.js";
import { getDebugRetryApprovalsPath, getDebugRetryPolicyPath } from "./paths.js";
import { recordProviderUsageBudget } from "./provider-usage.js";
import { assessTaskPromptAdmission, createPromptSizingAttemptBinding, resolveTaskPromptTokenBudget, type TaskPromptAdmissionDecision } from "./prompt-admission.js";
import { loadState } from "./state.js";
import { buildTaskAgentInvocation, runTaskAgent, type TaskAgentInvocation, type TaskAgentRunResult } from "./subagents.js";
import { ingestTaskAgentReportFromRun } from "./task-reports.js";
import type { ScalerState, ScalerTaskState } from "./types.js";
import {
  applyValidationReport,
  loadValidationRuns,
  runValidationCommandSet,
  type ValidationCommandManifest,
  type ValidationCommandRunRecord,
  type ValidationRunRecord,
} from "./validation.js";
import type { GitCommitTaskResult } from "./git.js";

export type DebugRetryStatus = "prepared" | "task_agent_failed" | "exact_validation_passed" | "exact_validation_failed" | "rejected";
export type DebugRetryPostExactPassAction = "stop" | "full_validation" | "full_validation_commit";
export type DebugRetryApprovalStatus = "active" | "used" | "revoked";

export interface DebugRetryPolicy {
  version: 1;
  autoStart: boolean;
  requireApproval: boolean;
  postExactPass: DebugRetryPostExactPassAction;
  updatedAt: string;
}

export interface DebugRetryPolicyUpdate {
  autoStart?: boolean;
  requireApproval?: boolean;
  postExactPass?: string;
  now?: Date;
}

export interface DebugRetryApprovalRecord {
  version: 1;
  id: string;
  taskId?: string;
  debugReportId: string;
  reason: string;
  status: DebugRetryApprovalStatus;
  createdAt: string;
  usedAt?: string;
  usedByRetryId?: string;
  revokedAt?: string;
  revokedReason?: string;
}

export interface DebugRetryApprovalInput {
  debugReportId: string;
  taskId?: string;
  reason?: string;
  now?: Date;
}

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
  promptAdmission?: TaskPromptAdmissionDecision;
}

export interface DebugRetryPolicyWorkflowResult extends DebugNextApproachRetryResult {
  policy: DebugRetryPolicy;
  approval?: DebugRetryApprovalRecord;
  postValidation?: LockedOperationResult<ValidationRunRecord>;
  postCommit?: LockedOperationResult<GitCommitTaskResult>;
}

export interface DebugRetrySelection {
  task: ScalerTaskState;
  report: NonNullable<Awaited<ReturnType<typeof selectLatestNextApproachReport>>>;
  failedValidationRun: ValidationRunRecord;
  exactCommands: ValidationCommandManifest[];
}

export async function loadDebugRetryPolicy(cwd: string): Promise<DebugRetryPolicy> {
  try {
    return normalizeDebugRetryPolicy(JSON.parse(await readFile(getDebugRetryPolicyPath(cwd), "utf8")) as Partial<DebugRetryPolicy>);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return createDefaultDebugRetryPolicy();
    throw error;
  }
}

export async function saveDebugRetryPolicy(cwd: string, update: DebugRetryPolicyUpdate): Promise<DebugRetryPolicy> {
  const current = await loadDebugRetryPolicy(cwd);
  const next: DebugRetryPolicy = {
    version: 1,
    autoStart: update.autoStart ?? current.autoStart,
    requireApproval: update.requireApproval ?? current.requireApproval,
    postExactPass: normalizePostExactPassAction(update.postExactPass) ?? current.postExactPass,
    updatedAt: (update.now ?? new Date()).toISOString(),
  };
  const path = getDebugRetryPolicyPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

export function formatDebugRetryPolicy(policy: DebugRetryPolicy): string {
  return `Debug retry policy: autoStart=${policy.autoStart} requireApproval=${policy.requireApproval} postExactPass=${policy.postExactPass} updatedAt=${policy.updatedAt}`;
}

export async function loadDebugRetryApprovals(cwd: string): Promise<DebugRetryApprovalRecord[]> {
  try {
    const parsed = JSON.parse(await readFile(getDebugRetryApprovalsPath(cwd), "utf8")) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeDebugRetryApproval).filter((approval): approval is DebugRetryApprovalRecord => Boolean(approval));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function saveDebugRetryApprovals(cwd: string, approvals: DebugRetryApprovalRecord[]): Promise<void> {
  const path = getDebugRetryApprovalsPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(approvals, null, 2)}\n`, "utf8");
}

export async function approveDebugRetry(cwd: string, input: DebugRetryApprovalInput): Promise<DebugRetryApprovalRecord> {
  const debugReportId = input.debugReportId.trim();
  if (!debugReportId) throw new Error("Debug retry approval rejected: debugReportId is required.");
  const now = input.now ?? new Date();
  const approval: DebugRetryApprovalRecord = {
    version: 1,
    id: `DEBUG-RETRY-APPROVAL-${now.toISOString().replace(/[^0-9]/g, "")}`,
    taskId: input.taskId?.trim() || undefined,
    debugReportId,
    reason: input.reason?.trim() || "Manual debug retry approval.",
    status: "active",
    createdAt: now.toISOString(),
  };
  const approvals = await loadDebugRetryApprovals(cwd);
  await saveDebugRetryApprovals(cwd, [approval, ...approvals]);
  return approval;
}

export function formatDebugRetryApprovals(approvals: DebugRetryApprovalRecord[], limit = 10): string {
  if (approvals.length === 0) return "No debug retry approvals.";
  const lines = ["Debug retry approvals:"];
  for (const approval of approvals.slice(0, limit)) {
    lines.push(`- ${approval.id} status=${approval.status} task=${approval.taskId ?? "*"} report=${approval.debugReportId} retry=${approval.usedByRetryId ?? "n/a"}: ${approval.reason}`);
  }
  return lines.join("\n");
}

export async function runDebugRetryPolicyWorkflow(
  cwd: string,
  state: ScalerState,
  options: DebugNextApproachRetryOptions = {},
  runner: TaskAgentRunner = runTaskAgent,
): Promise<DebugRetryPolicyWorkflowResult> {
  const policy = await loadDebugRetryPolicy(cwd);
  const selection = await selectDebugRetryWork(cwd, state, options.taskId);
  if (!selection) {
    const retry = await runDebugNextApproachRetry(cwd, state, options, runner);
    return { ...retry, policy };
  }

  let approval: DebugRetryApprovalRecord | undefined;
  if (options.execute && policy.requireApproval) {
    approval = await consumeDebugRetryApproval(cwd, selection);
    if (!approval) {
      const message = `Debug retry rejected: approval required for report ${selection.report.id}.`;
      await appendLogEvent(cwd, createLogEvent(state, { eventType: "debug", summary: message, taskId: selection.task.id }));
      return { accepted: false, message, status: "rejected", state, task: selection.task, policy };
    }
  }

  const retry = await runDebugNextApproachRetry(cwd, state, options, runner);
  let postValidation: LockedOperationResult<ValidationRunRecord> | undefined;
  let postCommit: LockedOperationResult<GitCommitTaskResult> | undefined;

  if (approval && retry.retry) {
    await markDebugRetryApprovalUsed(cwd, approval.id, retry.retry.id);
    approval = (await loadDebugRetryApprovals(cwd)).find((candidate) => candidate.id === approval?.id) ?? approval;
  }

  if (retry.accepted && retry.status === "exact_validation_passed" && retry.task && policy.postExactPass !== "stop") {
    const validationState = await loadState(cwd);
    postValidation = await runValidationWithExecutionLock(cwd, validationState, retry.task.id);
    if (policy.postExactPass === "full_validation_commit" && postValidation.accepted && postValidation.result?.status === "passed") {
      const latestState = await loadState(cwd);
      const task = latestState.tasks.find((candidate) => candidate.id === retry.task?.id);
      postCommit = await commitWithExecutionLock(cwd, latestState, retry.task.id, task?.allowedPathPrefixes ?? []);
    }
  }

  const messageParts = [retry.message];
  if (postValidation) messageParts.push(`postValidation=${postValidation.result?.status ?? (postValidation.accepted ? "accepted" : "rejected")}`);
  if (postCommit) messageParts.push(`postCommit=${postCommit.accepted ? "accepted" : "rejected"}`);
  return { ...retry, message: messageParts.join(" "), policy, approval, postValidation, postCommit };
}

export async function runDebugNextApproachRetry(
  cwd: string,
  state: ScalerState,
  options: DebugNextApproachRetryOptions = {},
  runner: TaskAgentRunner = runTaskAgent,
): Promise<DebugNextApproachRetryResult> {
  const recovery = await reconcileInterruptedTaskAttempt(cwd, state);
  if (recovery) return { ...recovery, status: "rejected" };
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

  let activeAttempt: TaskAttemptRecord | undefined;
  let attemptTerminal = false;
  try {
    const contractDiagnostics = options.execute ? await verifyTaskExecutionContract(cwd, selection.task) : [];
    if (contractDiagnostics.length > 0) {
      const message = new TaskContractAdmissionError(selection.task.id, contractDiagnostics).message;
      const retry = await upsertRetryRecord(cwd, buildRetryRecord(selection, "rejected", false, message));
      await appendLogEvent(cwd, createLogEvent(state, {
        eventType: "rejected_transition", summary: message, taskId: selection.task.id,
        details: { diagnostics: contractDiagnostics, admission: "task_contract" },
      }));
      return { accepted: false, message, status: "rejected", state, task: selection.task, retry };
    }
    const dependencyDiagnostics = await verifyTaskDependenciesAccepted(cwd, state, selection.task);
    if (dependencyDiagnostics.length > 0) {
      const message = dependencyDiagnostics.join(" ");
      const retry = await upsertRetryRecord(cwd, buildRetryRecord(selection, "rejected", false, message));
      await appendLogEvent(cwd, createLogEvent(state, { eventType: "rejected_transition", summary: message, taskId: selection.task.id }));
      return { accepted: false, message, status: "rejected", state, task: selection.task, retry };
    }
    let workingState = state;

    const runningTask = workingState.tasks.find((task) => task.id === selection.task.id) ?? selection.task;
    const manifest = await ensureTaskContextManifest(cwd, workingState, runningTask.id);
    const baseContext = await resolveTaskContextManifest(cwd, workingState, manifest);
    const retryContext = buildNextApproachContextItem(selection);
    const promptTokenBudget = resolveTaskPromptTokenBudget(options.tokenBudget, manifest.tokenBudget);
    let { prompt, resolvedContext } = buildTaskAgentPrompt({
      state: workingState,
      task: runningTask,
      contextItems: [...baseContext, retryContext],
      tokenBudget: promptTokenBudget,
    });

    if (options.execute) {
      const sizedPrompt = buildTaskAgentPrompt({
        state: workingState,
        task: runningTask,
        contextItems: [...baseContext, retryContext],
        tokenBudget: promptTokenBudget,
        attempt: createPromptSizingAttemptBinding(workingState.runId),
      }).prompt;
      const promptAdmission = assessTaskPromptAdmission(sizedPrompt, promptTokenBudget);
      if (!promptAdmission.accepted) {
        const retry = await upsertRetryRecord(cwd, buildRetryRecord(selection, "rejected", false, promptAdmission.message));
        await appendLogEvent(cwd, createLogEvent(workingState, {
          eventType: "rejected_transition",
          summary: promptAdmission.message,
          taskId: runningTask.id,
          details: { admission: "final_prompt", promptAdmission },
        }));
        return { accepted: false, message: promptAdmission.message, status: "rejected", state: workingState, task: runningTask, retry, prompt, promptAdmission };
      }
    }

    const budgetUpdates = [
      { key: "contextTokens", amount: resolvedContext.estimatedTokens, mode: "set" },
      ...(options.execute ? [{ key: "spawnedAgents" as const, amount: 1, mode: "increment" as const }] : []),
    ] as Parameters<typeof applyBudgetUsageUpdates>[1];
    const budgetResult = applyBudgetUsageUpdates(workingState, budgetUpdates);
    if (budgetResult.decision.status === "hard_limit") {
      const refusedBudgetState = applyBudgetUsageUpdates(workingState, budgetUpdates.filter((update) => update.key !== "spawnedAgents")).state;
      workingState = await persistBudgetDecision(cwd, refusedBudgetState, budgetResult.decision);
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

    if (options.execute) {
      try {
        activeAttempt = await admitTaskExecution(cwd, lock.lock.id, workingState, runningTask, resolvedContext, options.model, options.tools ?? []);
      } catch (error) {
        if (!(error instanceof TaskDependencyAdmissionError) && !(error instanceof TaskContractAdmissionError)) throw error;
        const message = error.message;
        const retry = await upsertRetryRecord(cwd, buildRetryRecord(selection, "rejected", false, message));
        await appendLogEvent(cwd, createLogEvent(workingState, {
          eventType: "rejected_transition", summary: message, taskId: runningTask.id,
          details: { diagnostics: error.diagnostics, admission: error instanceof TaskContractAdmissionError ? "task_contract" : "dependency_evidence" },
        }));
        return { accepted: false, message, status: "rejected", state: workingState, task: runningTask, retry, prompt };
      }
    }
    workingState = await persistBudgetDecision(cwd, budgetResult.state, budgetResult.decision);
    if (activeAttempt) {
      ({ prompt, resolvedContext } = buildTaskAgentPrompt({
        state: workingState, task: runningTask,
        contextItems: [...baseContext, retryContext],
        tokenBudget: promptTokenBudget,
        attempt: taskAttemptBinding(activeAttempt),
      }));
    }
    const binding = activeAttempt ? taskAttemptBinding(activeAttempt) : undefined;
    await logAgentPromptAudit(cwd, workingState, {
      agentType: "debug-retry-task",
      agentId: runningTask.id,
      taskId: runningTask.id,
      prompt,
      inputRefs: [...baseContext.map((item) => item.id), retryContext.id],
      details: { debugReportId: selection.report.id, exactCommandIds: selection.exactCommands.map((command) => command.id) },
    });

    const request = { taskId: runningTask.id, prompt, tools: options.tools, model: options.model, cwd, attempt: binding };
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

    const started = await startTaskExecution(cwd, lock.lock.id, workingState, activeAttempt!);
    workingState = started.state;
    activeAttempt = started.attempt;
    const runResult = await runner(request, { timeoutMs: options.timeoutMs });
    const checked = await checkTaskExecutionResult(cwd, activeAttempt, runResult.taskId);
    if (checked.diagnostics.length > 0) {
      const message = checked.diagnostics.join(" ");
      workingState = await interruptTaskExecution(cwd, lock.lock.id, activeAttempt.id, checked.diagnostics);
      attemptTerminal = true;
      await recordTaskAgentRun(cwd, runResult, new Date(), { reportStatus: "invalid", reportDiagnostics: checked.diagnostics }, { attempt: binding });
      await appendLogEvent(cwd, createLogEvent(workingState, { eventType: "rejected_transition", taskId: runningTask.id, summary: message }));
      return { accepted: false, message, status: "rejected", state: workingState, task: checked.task, prompt, invocation, runResult };
    }
    workingState = checked.state;
    if (runResult.usage) {
      workingState = (await recordProviderUsageBudget(cwd, workingState, runResult.usage, {
        source: "debug-retry-task-agent-run",
        taskId: runningTask.id,
        agentId: runningTask.id,
        agentType: "debug-retry-task",
      })).state;
    }
    const reportIngestion = runResult.exitCode === 0
      ? await ingestTaskAgentReportFromRun(cwd, workingState, runningTask.id, runResult, binding!)
      : undefined;
    const identity = { attempt: binding, outputFingerprint: reportIngestion?.report?.outputFingerprint };
    const validationContextFingerprint = await captureValidationContext(cwd, workingState, runningTask.id);
    const runRecord = await recordTaskAgentRun(cwd, runResult, new Date(), summarizeTaskAgentReportIngestion(reportIngestion, runResult), identity);
    const handoff = await applyTaskRunHandoff(cwd, workingState, runningTask.id, runResult, reportIngestion, new Date(), identity);
    const succeeded = runResult.exitCode === 0 && reportIngestion?.report?.status === "completed";
    await completeTaskAttempt(cwd, lock.lock.id, activeAttempt.id, {
      status: succeeded ? "completed" : "failed", outcome: succeeded ? "succeeded" : "failed",
      outputFingerprint: identity.outputFingerprint, reportId: reportIngestion?.report?.id,
      validationContextFingerprint,
      diagnostics: reportIngestion?.diagnostics,
    });
    attemptTerminal = true;
    if (runResult.exitCode !== 0) {
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

    if (handoff.record.status !== "validation_required") {
      const attempt = await recordDebugAttempt(cwd, handoff.state, {
        taskId: runningTask.id,
        failureId: selection.report.failureId ?? selection.failedValidationRun.id,
        hypothesis: selection.report.rootCause ?? selection.report.summary,
        actionSummary: `Task-agent retry for debug report ${selection.report.id} did not provide a completed structured task report before exact validation.`,
        result: "blocked",
        failureFingerprint: selection.report.failureFingerprint,
        resultingFailureFingerprint: selection.report.failureFingerprint,
        attemptSignature: `debug-retry-report ${selection.report.id}`,
        commands: selection.exactCommands.map((command) => command.command),
        evidence: selection.report.evidenceRefs,
        logRefs: [runRecord.id, ...(handoff.record.reportId ? [handoff.record.reportId] : [])],
        failureSummary: handoff.record.summary,
      });
      const retry = await upsertRetryRecord(cwd, buildRetryRecord(selection, "task_agent_failed", true, `Debug retry task-agent report blocked validation: ${runningTask.id}.`, {
        taskAgentRunId: runRecord.id,
        debugAttemptId: attempt.attempt?.id,
      }));
      return { accepted: false, message: retry.message, status: "task_agent_failed", state: handoff.state, task: runningTask, retry, prompt, invocation, runResult };
    }

    const freshness = await checkAttemptEvidence(cwd, handoff.state, runningTask.id);
    if (freshness.length > 0) {
      return { accepted: false, message: freshness.join(" "), status: "rejected", state: handoff.state, task: runningTask, prompt, invocation, runResult };
    }
    const exactValidationRun = await runValidationCommandSet(cwd, runningTask.id, selection.exactCommands, "debug-retry-exact");
    const finalFreshness = await checkAttemptEvidence(cwd, handoff.state, runningTask.id);
    if (finalFreshness.length > 0) {
      return { accepted: false, message: finalFreshness.join(" "), status: "rejected", state: handoff.state, task: runningTask, prompt, invocation, runResult, exactValidationRun };
    }
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
  } catch (error) {
    if (activeAttempt && !attemptTerminal) {
      await interruptTaskExecution(cwd, lock.lock.id, activeAttempt.id, [
        `Task attempt stopped by supervisor error: ${error instanceof Error ? error.message : String(error)}`,
      ]);
    }
    throw error;
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

function createDefaultDebugRetryPolicy(): DebugRetryPolicy {
  return { version: 1, autoStart: false, requireApproval: false, postExactPass: "stop", updatedAt: "" };
}

function normalizeDebugRetryPolicy(value: Partial<DebugRetryPolicy>): DebugRetryPolicy {
  return {
    version: 1,
    autoStart: value.autoStart === true,
    requireApproval: value.requireApproval === true,
    postExactPass: normalizePostExactPassAction(value.postExactPass) ?? "stop",
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "",
  };
}

function normalizePostExactPassAction(value: unknown): DebugRetryPostExactPassAction | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "stop" || normalized === "none") return "stop";
  if (normalized === "validate" || normalized === "full_validation" || normalized === "full_validate") return "full_validation";
  if (normalized === "validate_commit" || normalized === "full_validation_commit" || normalized === "full_validate_commit") return "full_validation_commit";
  return undefined;
}

function normalizeDebugRetryApproval(value: unknown): DebugRetryApprovalRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" && record.id.trim() ? record.id.trim() : undefined;
  const debugReportId = typeof record.debugReportId === "string" && record.debugReportId.trim() ? record.debugReportId.trim() : undefined;
  const createdAt = typeof record.createdAt === "string" ? record.createdAt : undefined;
  if (!id || !debugReportId || !createdAt) return undefined;
  const status = record.status === "used" || record.status === "revoked" ? record.status : "active";
  return {
    version: 1,
    id,
    taskId: typeof record.taskId === "string" && record.taskId.trim() ? record.taskId.trim() : undefined,
    debugReportId,
    reason: typeof record.reason === "string" && record.reason.trim() ? record.reason.trim() : "Manual debug retry approval.",
    status,
    createdAt,
    usedAt: typeof record.usedAt === "string" ? record.usedAt : undefined,
    usedByRetryId: typeof record.usedByRetryId === "string" ? record.usedByRetryId : undefined,
    revokedAt: typeof record.revokedAt === "string" ? record.revokedAt : undefined,
    revokedReason: typeof record.revokedReason === "string" ? record.revokedReason : undefined,
  };
}

async function consumeDebugRetryApproval(cwd: string, selection: DebugRetrySelection): Promise<DebugRetryApprovalRecord | undefined> {
  return (await loadDebugRetryApprovals(cwd)).find((approval) =>
    approval.status === "active" &&
    approval.debugReportId === selection.report.id &&
    (!approval.taskId || approval.taskId === selection.task.id),
  );
}

async function markDebugRetryApprovalUsed(cwd: string, approvalId: string, retryId: string): Promise<void> {
  const approvals = await loadDebugRetryApprovals(cwd);
  const now = new Date().toISOString();
  await saveDebugRetryApprovals(cwd, approvals.map((approval) => approval.id === approvalId
    ? { ...approval, status: "used", usedAt: now, usedByRetryId: retryId }
    : approval));
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

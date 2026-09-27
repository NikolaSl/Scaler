/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import { classifyAutomationStopReason } from "./conformance.js";
import { defaultTaskAgentTools, runConductorStep, type ConductorStepResult, type TaskAgentRunner } from "./conductor.js";
import {
  runDebugConductorLoop,
  type DebugConductorLoopResult,
  type DebugConductorRunners,
} from "./debug-conductor.js";
import { runDebugRetryPolicyWorkflow, type DebugRetryPolicyWorkflowResult } from "./debug-retry.js";
import { commitWithExecutionLock, runValidationWithExecutionLock, type LockedOperationResult } from "./operations.js";
import { appendLogEvent, createLogEvent } from "./logging.js";
import {
  dispatchMissingContextRequest,
  loadMissingContextRequests,
  refreshAndUnblockMissingContext,
  type MissingContextDispatchResult,
} from "./missing-context.js";
import { loadState, saveState } from "./state.js";
import { runResearchAgentStep, type ResearchAgentStepResult } from "./research-agent.js";
import {
  runAutonomousStageWorkflow,
  type StageWorkflowResult,
  type StageWorkflowRunners,
} from "./stage-workflow.js";
import { completeRunWithEvidence } from "./run-completion.js";
import type { ScalerState, ScalerTaskState } from "./types.js";
import type { GitCommitTaskResult } from "./git.js";
import type { ValidationRunRecord } from "./validation.js";
import type { ProviderAdmissionModel } from "./provider-admission.js";

export type ScalerAutomationAction = "stage_workflow" | "task_agent" | "missing_context" | "validation" | "debug" | "debug_retry" | "commit" | "complete" | "blocked";

export type ScalerAutomationStopReason =
  | "completed"
  | "max_steps"
  | "stage_workflow_rejected"
  | "task_agent_rejected"
  | "validation_rejected"
  | "commit_rejected"
  | "debug_rejected"
  | "blocked"
  | "paused"
  | "failed"
  | "idle"
  | "no_progress";

export interface ScalerAutomationOptions {
  maxSteps?: number;
  maxStageSteps?: number;
  maxResearchRequests?: number;
  maxResearchAgents?: number;
  allowInternet?: boolean;
  tools?: string[];
  stageTools?: string[];
  researchTools?: string[];
  replanTools?: string[];
  taskTools?: string[];
  autoAcceptReplan?: boolean;
  timeoutMs?: number;
  maxDebugSteps?: number;
  model?: string;
  providerAdmissionModel?: ProviderAdmissionModel;
}

export interface ScalerAutomationRunners extends StageWorkflowRunners, Pick<DebugConductorRunners, "debug"> {
  task?: TaskAgentRunner;
}

export interface ScalerAutomationStep {
  action: ScalerAutomationAction;
  accepted: boolean;
  message: string;
  stage: ScalerState["stage"];
  taskId?: string;
  stageWorkflow?: StageWorkflowResult;
  taskAgent?: ConductorStepResult;
  missingContext?: MissingContextDispatchResult;
  researchAgent?: ResearchAgentStepResult;
  validation?: LockedOperationResult<ValidationRunRecord>;
  commit?: LockedOperationResult<GitCommitTaskResult>;
  debug?: DebugConductorLoopResult;
  debugRetry?: DebugRetryPolicyWorkflowResult;
}

export interface ScalerAutomationResult {
  accepted: boolean;
  completed: boolean;
  stopReason: ScalerAutomationStopReason;
  steps: ScalerAutomationStep[];
  finalState: ScalerState;
  message: string;
}

export async function runScalerAutomation(
  cwd: string,
  state: ScalerState,
  options: ScalerAutomationOptions = {},
  runners: ScalerAutomationRunners = {},
): Promise<ScalerAutomationResult> {
  const steps: ScalerAutomationStep[] = [];
  const maxSteps = normalizeMax(options.maxSteps, 50, 1, 500);
  const maxStageSteps = normalizeMax(options.maxStageSteps, 20, 1, 100);
  let currentState = state;
  let stopReason: ScalerAutomationStopReason = "max_steps";
  await saveState(cwd, currentState);

  for (let index = 0; index < maxSteps; index += 1) {
    currentState = await loadState(cwd);

    if (currentState.stage === "completed") {
      stopReason = "completed";
      break;
    }
    if (currentState.stage === "failed") {
      stopReason = "failed";
      steps.push(blockedStep(currentState, "Run is in failed stage."));
      break;
    }
    if (currentState.stage === "paused") {
      stopReason = "paused";
      steps.push(blockedStep(currentState, "Run is paused; resolve the pause reason before autonomous execution can continue."));
      break;
    }
    if (currentState.stage === "idle") {
      stopReason = "idle";
      steps.push(blockedStep(currentState, "Run is idle; provide a request so SCALER can select an execution stage."));
      break;
    }

    if (isStageWorkflowStage(currentState.stage)) {
      const workflow = await runAutonomousStageWorkflow(cwd, currentState, {
        execute: true,
        maxSteps: maxStageSteps,
        maxResearchAgents: options.maxResearchAgents,
        maxResearchRequests: options.maxResearchRequests,
        allowInternet: options.allowInternet,
        tools: options.stageTools ?? options.tools,
        researchTools: options.researchTools,
        replanTools: options.replanTools,
        autoAcceptReplan: options.autoAcceptReplan,
        timeoutMs: options.timeoutMs,
        model: options.model,
        providerAdmissionModel: options.providerAdmissionModel,
      }, runners);
      currentState = await loadState(cwd);
      steps.push({
        action: "stage_workflow",
        accepted: workflow.accepted,
        message: workflow.message,
        stage: currentState.stage,
        stageWorkflow: workflow,
      });
      if (!workflow.accepted) {
        stopReason = "stage_workflow_rejected";
        break;
      }
      continue;
    }

    if (currentState.stage === "execution" && currentState.tasks.length > 0
      && currentState.tasks.every((task) => task.status === "validated")) {
      const completion = await completeRunWithEvidence(cwd, currentState);
      if (!completion.accepted) {
        stopReason = "blocked";
        steps.push(blockedStep(currentState, completion.message));
        break;
      }
      currentState = completion.state;
      steps.push({
        action: "complete",
        accepted: true,
        message: completion.message,
        stage: currentState.stage,
      });
      stopReason = "completed";
      break;
    }

    const validatingTask = currentState.tasks.find((task) => task.status === "validating");
    if (validatingTask) {
      const validation = await runValidationWithExecutionLock(cwd, currentState, validatingTask.id);
      currentState = await loadState(cwd);
      steps.push({
        action: "validation",
        accepted: validation.accepted,
        message: validation.message,
        stage: currentState.stage,
        taskId: validatingTask.id,
        validation,
      });

      if (validation.result?.status === "passed" && currentState.tasks.find((task) => task.id === validatingTask.id)?.status === "validating") {
        const latestTask = currentState.tasks.find((task) => task.id === validatingTask.id) ?? validatingTask;
        const commit = await commitWithExecutionLock(cwd, currentState, latestTask.id, latestTask.allowedPathPrefixes ?? []);
        currentState = await loadState(cwd);
        steps.push({
          action: "commit",
          accepted: commit.accepted,
          message: commit.message,
          stage: currentState.stage,
          taskId: latestTask.id,
          commit,
        });
        if (!commit.accepted) {
          stopReason = "commit_rejected";
          break;
        }
        continue;
      }

      if (!validation.accepted) {
        stopReason = "validation_rejected";
        break;
      }
      continue;
    }

    const debuggingTask = currentState.tasks.find((task) => task.status === "debugging");
    if (debuggingTask) {
      const debug = await runDebugConductorLoop(cwd, currentState, {
        taskId: debuggingTask.id,
        execute: true,
        maxSteps: normalizeMax(options.maxDebugSteps, 5, 1, 50),
        tools: ["read", "bash"],
        timeoutMs: options.timeoutMs,
        model: options.model,
        providerAdmissionModel: options.providerAdmissionModel,
      }, {
        debug: runners.debug,
        research: runners.research,
        replan: runners.replan,
        retry: runners.task,
      });
      currentState = await loadState(cwd);
      steps.push({
        action: "debug",
        accepted: debug.accepted,
        message: debug.message,
        stage: currentState.stage,
        taskId: debuggingTask.id,
        debug,
      });
      if (!debug.accepted) {
        stopReason = "debug_rejected";
        break;
      }

      if (debug.stopReason === "next_approach") {
        const retry = await runDebugRetryPolicyWorkflow(cwd, currentState, {
          taskId: debuggingTask.id,
          execute: true,
          timeoutMs: options.timeoutMs,
          tools: options.taskTools ? defaultTaskAgentTools(options.taskTools) : undefined,
          model: options.model,
          providerAdmissionModel: options.providerAdmissionModel,
        }, runners.task);
        currentState = await loadState(cwd);
        steps.push({
          action: "debug_retry",
          accepted: retry.accepted,
          message: retry.message,
          stage: currentState.stage,
          taskId: debuggingTask.id,
          debugRetry: retry,
        });
        if (!retry.accepted) {
          stopReason = "debug_rejected";
          break;
        }
      } else if (["max_steps", "step_rejected", "ingestion_rejected", "retry_exact_validation_failed", "retry_rejected"].includes(debug.stopReason)) {
        stopReason = "debug_rejected";
        break;
      }
      continue;
    }

    const runnableTask = currentState.tasks.find((task) => task.status === "ready" || task.status === "pending");
    if (runnableTask) {
      const taskAgent = await runConductorStep(cwd, currentState, {
        execute: true,
        tools: options.taskTools ? defaultTaskAgentTools(options.taskTools) : undefined,
        timeoutMs: options.timeoutMs,
        model: options.model,
        providerAdmissionModel: options.providerAdmissionModel,
      }, runners.task);
      currentState = await loadState(cwd);
      steps.push({
        action: "task_agent",
        accepted: taskAgent.accepted,
        message: taskAgent.message,
        stage: currentState.stage,
        taskId: taskAgent.task?.id ?? runnableTask.id,
        taskAgent,
      });
      if (!taskAgent.accepted) {
        stopReason = "task_agent_rejected";
        break;
      }
      continue;
    }

    const blocked = firstBlockedTask(currentState);
    if (blocked) {
      const continuation = blocked.status === "blocked"
        ? await continueMissingContext(cwd, currentState, blocked.id, options, runners)
        : undefined;
      if (continuation) {
        currentState = await loadState(cwd);
        steps.push({
          action: "missing_context",
          accepted: continuation.accepted,
          message: continuation.message,
          stage: currentState.stage,
          taskId: blocked.id,
          missingContext: continuation.dispatch,
          researchAgent: continuation.researchAgent,
        });
        if (!continuation.accepted) {
          stopReason = "blocked";
          break;
        }
        continue;
      }
      stopReason = "blocked";
      steps.push(blockedStep(currentState, `Task ${blocked.id} is ${blocked.status}; automation stopped until the blocker is resolved.`, blocked.id));
      break;
    }

    if (currentState.tasks.length === 0) {
      stopReason = "blocked";
      steps.push(blockedStep(currentState, "No tasks exist after staged planning; automation cannot execute Stage IV."));
      break;
    }

    stopReason = "no_progress";
    steps.push(blockedStep(currentState, "No runnable, validating, blocked, or completable task state was found."));
    break;
  }

  currentState = await loadState(cwd);
  if (currentState.stage === "completed") {
    // Includes loaded legacy completed states and the last-iteration path.
    const completion = await completeRunWithEvidence(cwd, currentState);
    stopReason = completion.accepted ? "completed" : "blocked";
    if (!completion.accepted) steps.push(blockedStep(currentState, completion.message));
  }
  const stopClassification = classifyAutomationStopReason(stopReason);
  const accepted = steps.every((step) => step.accepted) && stopClassification.accepted;
  const result: ScalerAutomationResult = {
    accepted,
    completed: currentState.stage === "completed" && stopReason === "completed",
    stopReason,
    steps,
    finalState: currentState,
    message: formatAutomationMessage(steps, currentState, stopReason),
  };
  await appendLogEvent(cwd, createLogEvent(currentState, {
    eventType: "system",
    summary: `Scaler automation stopped: ${stopReason} steps=${steps.length}`,
    details: { stopReason, steps: steps.map((step) => ({ action: step.action, accepted: step.accepted, taskId: step.taskId, message: firstLine(step.message) })) },
  }));
  return result;
}

interface MissingContextContinuationResult {
  accepted: boolean;
  message: string;
  dispatch?: MissingContextDispatchResult;
  researchAgent?: ResearchAgentStepResult;
}

async function continueMissingContext(
  cwd: string,
  state: ScalerState,
  taskId: string,
  options: ScalerAutomationOptions,
  runners: ScalerAutomationRunners,
): Promise<MissingContextContinuationResult | undefined> {
  const request = (await loadMissingContextRequests(cwd)).find((candidate) => candidate.taskId === taskId
    && (candidate.status === "open" || candidate.status === "in_progress"));
  if (!request) return undefined;

  let dispatch: MissingContextDispatchResult | undefined;
  let currentRequest = request;
  if (request.status === "open") {
    dispatch = await dispatchMissingContextRequest(cwd, state, request.id, {
      execute: true,
      allowInternet: options.allowInternet,
    });
    currentRequest = dispatch.request ?? request;
    if (!dispatch.accepted) return { accepted: false, message: dispatch.message, dispatch };
  }

  if (currentRequest.kind !== "local_research" && currentRequest.kind !== "internet_research") {
    await refreshAndUnblockMissingContext(cwd, await loadState(cwd));
    const resolved = (await loadMissingContextRequests(cwd)).find((candidate) => candidate.id === currentRequest.id);
    return resolved?.status === "resolved"
      ? { accepted: true, message: `Missing-context request resolved: ${currentRequest.id}`, dispatch }
      : { accepted: false, message: `Missing-context request remains ${resolved?.status ?? "unavailable"}: ${currentRequest.id}`, dispatch };
  }

  if (currentRequest.kind === "internet_research" && !options.allowInternet) {
    return { accepted: false, message: `Internet research requires an explicit internet grant: ${currentRequest.id}`, dispatch };
  }
  const researchRequestId = currentRequest.evidenceRefs?.find((reference) => reference.startsWith("RESEARCH-"));
  if (!researchRequestId) {
    return { accepted: false, message: `Missing-context research request has no durable research identity: ${currentRequest.id}`, dispatch };
  }

  const researchAgent = await runResearchAgentStep(cwd, await loadState(cwd), {
    requestId: researchRequestId,
    execute: true,
    allowInternet: options.allowInternet,
    tools: options.researchTools ?? options.tools,
    timeoutMs: options.timeoutMs,
    model: options.model,
    providerAdmissionModel: options.providerAdmissionModel,
  }, runners.research);
  if (!researchAgent.accepted || researchAgent.runRecord?.status !== "passed" || researchAgent.ingestion?.ingested !== true) {
    return {
      accepted: false,
      message: researchAgent.ingestion?.reason ?? researchAgent.message,
      dispatch,
      researchAgent,
    };
  }

  await refreshAndUnblockMissingContext(cwd, await loadState(cwd));
  const resolved = (await loadMissingContextRequests(cwd)).find((candidate) => candidate.id === currentRequest.id);
  if (resolved?.status !== "resolved") {
    return {
      accepted: false,
      message: `Research evidence did not resolve missing-context request ${currentRequest.id}.`,
      dispatch,
      researchAgent,
    };
  }
  return {
    accepted: true,
    message: `Research resolved missing-context request ${currentRequest.id}.`,
    dispatch,
    researchAgent,
  };
}

function isStageWorkflowStage(stage: ScalerState["stage"]): boolean {
  return stage === "prd" || stage === "knowledge" || stage === "planning" || stage === "replanning";
}

function firstBlockedTask(state: ScalerState): ScalerTaskState | undefined {
  return state.tasks.find((task) => task.status === "blocked" || task.status === "needs_replan" || task.status === "failed");
}

function blockedStep(state: ScalerState, message: string, taskId?: string): ScalerAutomationStep {
  return { action: "blocked", accepted: false, message, stage: state.stage, taskId };
}

function formatAutomationMessage(steps: ScalerAutomationStep[], state: ScalerState, stopReason: ScalerAutomationStopReason): string {
  const lines = [`SCALER automation stop=${stopReason} stage=${state.stage} validated=${state.validatedTaskIds.length}/${state.tasks.length} steps=${steps.length}`];
  for (const [index, step] of steps.entries()) {
    lines.push(`- ${index + 1}. ${step.action}${step.taskId ? ` ${step.taskId}` : ""}: ${firstLine(step.message)}`);
  }
  return lines.join("\n");
}

function firstLine(value: string): string {
  return value.split("\n")[0] ?? value;
}

function normalizeMax(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), min), max);
}

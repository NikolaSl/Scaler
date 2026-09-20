/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import { runDebugAgentStep, type DebugAgentRunner, type DebugAgentStepResult, type RunDebugAgentOptions } from "./debug-agent.js";
import { loadDebugRetryPolicy, runDebugRetryPolicyWorkflow, type DebugRetryPolicyWorkflowResult } from "./debug-retry.js";
import { appendLogEvent, createLogEvent } from "./logging.js";
import { loadReplanRequests } from "./plans.js";
import { loadState } from "./state.js";
import { runReplanAgentStep, type ReplanAgentRunner, type ReplanAgentStepResult, type RunReplanAgentOptions } from "./replan-agent.js";
import { loadResearchRequests } from "./research.js";
import { runResearchAgentStep, type ResearchAgentRunner, type ResearchAgentStepResult, type RunResearchAgentOptions } from "./research-agent.js";
import type { TaskAgentRunner } from "./conductor.js";
import type { ProviderAdmissionModel } from "./provider-admission.js";
import type { ScalerState, ScalerTaskState } from "./types.js";

export type DebugConductorAction = "run_debug_agent" | "run_research_agent" | "run_replan_agent" | "run_debug_retry" | "no_debug_task" | "no_action";
export type DebugConductorLoopStopReason =
  | "max_steps"
  | "no_debug_task"
  | "no_action"
  | "prepared_debug_agent"
  | "prepared_research_agent"
  | "prepared_replan_agent"
  | "step_rejected"
  | "ingestion_rejected"
  | "next_approach"
  | "retry_prepared"
  | "retry_exact_validation_passed"
  | "retry_exact_validation_failed"
  | "retry_rejected"
  | "research_requested"
  | "research_resolved"
  | "replan_requested"
  | "proposed_replan";

export interface DebugConductorStepOptions {
  taskId?: string;
  execute?: boolean;
  timeoutMs?: number;
  tools?: string[];
  model?: string;
  providerAdmissionModel?: ProviderAdmissionModel;
  appendSystemPromptPath?: string;
  extensionPaths?: string[];
  command?: string;
  debugExtraInstructions?: string;
  researchExtraInstructions?: string;
  replanExtraInstructions?: string;
}

export interface DebugConductorLoopOptions extends DebugConductorStepOptions {
  maxSteps?: number;
}

export interface DebugConductorRunners {
  debug?: DebugAgentRunner;
  research?: ResearchAgentRunner;
  replan?: ReplanAgentRunner;
  retry?: TaskAgentRunner;
}

export interface DebugConductorStepResult {
  accepted: boolean;
  action: DebugConductorAction;
  message: string;
  task?: ScalerTaskState;
  state: ScalerState;
  debugAgent?: DebugAgentStepResult;
  researchAgent?: ResearchAgentStepResult;
  replanAgent?: ReplanAgentStepResult;
  debugRetry?: DebugRetryPolicyWorkflowResult;
  researchRequestId?: string;
  replanRequestIds?: string[];
}

export interface DebugConductorLoopResult {
  accepted: boolean;
  completed: boolean;
  stopReason: DebugConductorLoopStopReason;
  steps: DebugConductorStepResult[];
  finalState: ScalerState;
  message: string;
}

export async function runDebugConductorStep(
  cwd: string,
  state: ScalerState,
  options: DebugConductorStepOptions = {},
  runners: DebugConductorRunners = {},
): Promise<DebugConductorStepResult> {
  const task = selectDebugConductorTask(state, options.taskId);
  if (!task) {
    const message = options.taskId ? `No debugging task found for ${options.taskId}.` : "No debugging task found.";
    await appendLogEvent(cwd, createLogEvent(state, { eventType: "debug", summary: message, taskId: options.taskId }));
    return { accepted: false, action: "no_debug_task", message, state };
  }

  const openReplanRequests = (await loadReplanRequests(cwd)).filter((request) =>
    request.status === "open" &&
    request.taskId === task.id &&
    (request.trigger === "debug_cycle" || request.trigger === "debug_blocked"),
  );
  if (openReplanRequests.length > 0) {
    const replanOptions: RunReplanAgentOptions = {
      execute: options.execute,
      timeoutMs: options.timeoutMs,
      tools: options.tools,
      model: options.model,
      providerAdmissionModel: options.providerAdmissionModel,
      appendSystemPromptPath: options.appendSystemPromptPath,
      extensionPaths: options.extensionPaths,
      command: options.command,
      extraInstructions: options.replanExtraInstructions,
    };
    const replanAgent = await runReplanAgentStep(cwd, state, replanOptions, runners.replan);
    const nextState = await loadState(cwd);
    const message = formatDebugConductorStepMessage("run_replan_agent", replanAgent.message, {
      ingestionAttempted: replanAgent.ingestion?.attempted,
      ingestionAccepted: replanAgent.ingestion?.ingested,
      artifact: replanAgent.ingestion?.plan ? `proposed_plan=${replanAgent.ingestion.plan.planVersion}` : undefined,
    });
    await appendLogEvent(cwd, createLogEvent(nextState, {
      eventType: "debug",
      summary: message,
      taskId: task.id,
      details: { action: "run_replan_agent", requestIds: openReplanRequests.map((request) => request.id), replanAgent },
    }));
    return {
      accepted: replanAgent.accepted,
      action: "run_replan_agent",
      message,
      task,
      state: nextState,
      replanAgent,
      replanRequestIds: openReplanRequests.map((request) => request.id),
    };
  }

  const openResearchRequest = (await loadResearchRequests(cwd)).find((request) =>
    (request.status === "open" || request.status === "in_progress") && request.taskId === task.id,
  );
  if (openResearchRequest) {
    const researchOptions: RunResearchAgentOptions = {
      requestId: openResearchRequest.id,
      execute: options.execute,
      timeoutMs: options.timeoutMs,
      tools: options.tools,
      model: options.model,
      providerAdmissionModel: options.providerAdmissionModel,
      appendSystemPromptPath: options.appendSystemPromptPath,
      extensionPaths: options.extensionPaths,
      command: options.command,
      extraInstructions: options.researchExtraInstructions,
    };
    const researchAgent = await runResearchAgentStep(cwd, state, researchOptions, runners.research);
    const nextState = await loadState(cwd);
    const message = formatDebugConductorStepMessage("run_research_agent", researchAgent.message, {
      ingestionAttempted: researchAgent.ingestion?.attempted,
      ingestionAccepted: researchAgent.ingestion?.ingested,
      artifact: researchAgent.ingestion?.report ? `report=${researchAgent.ingestion.report.id}` : undefined,
    });
    await appendLogEvent(cwd, createLogEvent(nextState, {
      eventType: "debug",
      summary: message,
      taskId: task.id,
      details: { action: "run_research_agent", requestId: openResearchRequest.id, researchAgent },
    }));
    return {
      accepted: researchAgent.accepted,
      action: "run_research_agent",
      message,
      task,
      state: nextState,
      researchAgent,
      researchRequestId: openResearchRequest.id,
    };
  }

  const debugOptions: RunDebugAgentOptions = {
    taskId: task.id,
    execute: options.execute,
    timeoutMs: options.timeoutMs,
    tools: options.tools,
    model: options.model,
    providerAdmissionModel: options.providerAdmissionModel,
    appendSystemPromptPath: options.appendSystemPromptPath,
    extensionPaths: options.extensionPaths,
    command: options.command,
    extraInstructions: options.debugExtraInstructions,
  };
  const debugAgent = await runDebugAgentStep(cwd, state, debugOptions, runners.debug);
  const nextState = await loadState(cwd);
  const message = formatDebugConductorStepMessage("run_debug_agent", debugAgent.message, {
    ingestionAttempted: debugAgent.ingestion?.attempted,
    ingestionAccepted: debugAgent.ingestion?.ingested,
    artifact: debugAgent.ingestion?.report ? `report=${debugAgent.ingestion.report.id} status=${debugAgent.ingestion.report.status}` : undefined,
  });
  await appendLogEvent(cwd, createLogEvent(nextState, {
    eventType: "debug",
    summary: message,
    taskId: task.id,
    details: { action: "run_debug_agent", debugAgent },
  }));
  return {
    accepted: debugAgent.accepted,
    action: "run_debug_agent",
    message,
    task,
    state: nextState,
    debugAgent,
  };
}

export async function runDebugConductorLoop(
  cwd: string,
  state: ScalerState,
  options: DebugConductorLoopOptions = {},
  runners: DebugConductorRunners = {},
): Promise<DebugConductorLoopResult> {
  const maxSteps = normalizeLoopMaxSteps(options.maxSteps);
  const steps: DebugConductorStepResult[] = [];
  let currentState = state;
  let stopReason: DebugConductorLoopStopReason = "max_steps";

  for (let index = 0; index < maxSteps; index += 1) {
    const step = await runDebugConductorStep(cwd, currentState, options, runners);
    steps.push(step);
    currentState = step.state;
    stopReason = classifyLoopStopReason(step, Boolean(options.execute));

    if (stopReason === "next_approach") {
      const policy = await loadDebugRetryPolicy(cwd);
      if (policy.autoStart && step.task) {
        const retry = await runDebugRetryPolicyWorkflow(
          cwd,
          currentState,
          {
            taskId: step.task.id,
            execute: options.execute,
            timeoutMs: options.timeoutMs,
            tools: options.tools,
            model: options.model,
            providerAdmissionModel: options.providerAdmissionModel,
          },
          runners.retry,
        );
        currentState = await loadState(cwd);
        const retryStep: DebugConductorStepResult = {
          accepted: retry.accepted,
          action: "run_debug_retry",
          message: `Debug conductor run_debug_retry: ${retry.message}`,
          task: step.task,
          state: currentState,
          debugRetry: retry,
        };
        steps.push(retryStep);
        stopReason = classifyLoopStopReason(retryStep, Boolean(options.execute));
      }
    }
    if (stopReason === "research_requested" || stopReason === "research_resolved") continue;
    if (stopReason === "replan_requested") continue;
    if (stopReason === "max_steps") continue;
    break;
  }

  if (steps.length >= maxSteps && ["research_requested", "research_resolved", "replan_requested", "max_steps"].includes(stopReason)) {
    stopReason = "max_steps";
  }

  const message = formatDebugConductorLoopMessage(steps, currentState, stopReason);
  await appendLogEvent(cwd, createLogEvent(currentState, {
    eventType: "debug",
    summary: message.split("\n")[0] ?? message,
    taskId: options.taskId ?? steps[0]?.task?.id,
    details: { stopReason, steps: steps.map(summarizeStepForLog) },
  }));
  return {
    accepted: steps.length > 0 && steps.every((step) => step.accepted),
    completed: stopReason === "next_approach" || stopReason === "retry_prepared" || stopReason === "retry_exact_validation_passed" || stopReason === "proposed_replan" || stopReason === "no_action",
    stopReason,
    steps,
    finalState: currentState,
    message,
  };
}

export function selectDebugConductorTask(state: ScalerState, taskId?: string): ScalerTaskState | undefined {
  if (taskId) return state.tasks.find((task) => task.id === taskId && task.status === "debugging");
  if (state.currentTaskId) {
    const current = state.tasks.find((task) => task.id === state.currentTaskId && task.status === "debugging");
    if (current) return current;
  }
  return state.tasks.find((task) => task.status === "debugging");
}

function classifyLoopStopReason(step: DebugConductorStepResult, executed: boolean): DebugConductorLoopStopReason {
  if (step.action === "no_debug_task") return "no_debug_task";
  if (!step.accepted) return "step_rejected";
  if (!executed) {
    if (step.action === "run_debug_agent") return "prepared_debug_agent";
    if (step.action === "run_research_agent") return "prepared_research_agent";
    if (step.action === "run_replan_agent") return "prepared_replan_agent";
    return "no_action";
  }

  if (step.action === "run_debug_agent") {
    if (step.debugAgent?.ingestion?.attempted && !step.debugAgent.ingestion.ingested) return "ingestion_rejected";
    const status = step.debugAgent?.ingestion?.report?.status;
    if (status === "next_approach") return "next_approach";
    if (status === "needs_research") return "research_requested";
    if (status === "needs_replan" || status === "blocked") return "replan_requested";
    return "no_action";
  }

  if (step.action === "run_research_agent") {
    if (step.researchAgent?.ingestion?.attempted && !step.researchAgent.ingestion.ingested) return "ingestion_rejected";
    return "research_resolved";
  }

  if (step.action === "run_replan_agent") {
    if (step.replanAgent?.ingestion?.attempted && !step.replanAgent.ingestion.ingested) return "ingestion_rejected";
    if (step.replanAgent?.ingestion?.plan) return "proposed_replan";
    return "no_action";
  }

  if (step.action === "run_debug_retry") {
    if (!step.accepted) return "retry_rejected";
    if (!executed) return "retry_prepared";
    if (step.debugRetry?.status === "exact_validation_passed") return "retry_exact_validation_passed";
    if (step.debugRetry?.status === "exact_validation_failed" || step.debugRetry?.status === "task_agent_failed") return "retry_exact_validation_failed";
    return "retry_rejected";
  }

  return "no_action";
}

function formatDebugConductorStepMessage(
  action: DebugConductorAction,
  childMessage: string,
  detail: { ingestionAttempted?: boolean; ingestionAccepted?: boolean; artifact?: string },
): string {
  const ingestion = detail.ingestionAttempted
    ? ` ingestion=${detail.ingestionAccepted ? "ingested" : "rejected"}`
    : "";
  const artifact = detail.artifact ? ` ${detail.artifact}` : "";
  return `Debug conductor ${action}: ${childMessage}${ingestion}${artifact}`;
}

function formatDebugConductorLoopMessage(
  steps: DebugConductorStepResult[],
  finalState: ScalerState,
  stopReason: DebugConductorLoopStopReason,
): string {
  const lines = [`Debug conductor loop: steps=${steps.length} stop=${stopReason} final_stage=${finalState.stage}`];
  for (const [index, step] of steps.entries()) {
    lines.push(`- ${index + 1}. ${step.action}: ${step.message}`);
  }
  return lines.join("\n");
}

function normalizeLoopMaxSteps(maxSteps: number | undefined): number {
  if (maxSteps === undefined || !Number.isFinite(maxSteps)) return 5;
  return Math.min(Math.max(Math.trunc(maxSteps), 1), 20);
}

function summarizeStepForLog(step: DebugConductorStepResult): Record<string, unknown> {
  return {
    action: step.action,
    accepted: step.accepted,
    taskId: step.task?.id,
    researchRequestId: step.researchRequestId,
    replanRequestIds: step.replanRequestIds,
    debugReportId: step.debugAgent?.ingestion?.report?.id,
    debugReportStatus: step.debugAgent?.ingestion?.report?.status,
    researchReportId: step.researchAgent?.ingestion?.report?.id,
    proposedPlanVersion: step.replanAgent?.ingestion?.plan?.planVersion,
    debugRetryStatus: step.debugRetry?.status,
    debugRetryId: step.debugRetry?.retry?.id,
  };
}

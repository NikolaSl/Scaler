/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import { advanceStageAfterReadyArtifact, type StageAdvancementResult } from "./stage-advancement.js";
import {
  runStageAgentStep,
  type RunStageAgentOptions,
  type StageAgentRunner,
  type StageAgentStepResult,
} from "./stage-agents.js";
import {
  formatStageArtifactReadiness,
  loadStageArtifacts,
  normalizeStageArtifactStage,
  stageArtifactStages,
  validateStageArtifactReadiness,
  type StageArtifactReadinessValidation,
  type StageArtifactStage,
} from "./stages.js";
import type { ScalerState } from "./types.js";
import { completeRunWithEvidence } from "./run-completion.js";

export type StageConductorAction = "advance" | "run_stage_agent" | "unsupported_stage";
export type StageConductorLoopStopReason =
  | "completed"
  | "max_steps"
  | "unsupported_stage"
  | "step_rejected"
  | "prepared_stage_agent"
  | "stage_agent_without_advancement";

export interface StageConductorStepOptions extends RunStageAgentOptions {}

export interface StageConductorLoopOptions extends StageConductorStepOptions {
  maxSteps?: number;
}

export interface StageConductorStepResult {
  accepted: boolean;
  action: StageConductorAction;
  message: string;
  stage?: StageArtifactStage;
  readiness?: StageArtifactReadinessValidation;
  advancement?: StageAdvancementResult;
  stageAgent?: StageAgentStepResult;
}

export interface StageConductorLoopResult {
  accepted: boolean;
  completed: boolean;
  stopReason: StageConductorLoopStopReason;
  steps: StageConductorStepResult[];
  finalState: ScalerState;
  message: string;
}

export async function runStageConductorStep(
  cwd: string,
  state: ScalerState,
  options: StageConductorStepOptions = {},
  runner?: StageAgentRunner,
): Promise<StageConductorStepResult> {
  if (!isStageArtifactStage(state.stage)) {
    return {
      accepted: false,
      action: "unsupported_stage",
      message: `Stage conductor cannot run for supervisor stage ${state.stage}.`,
    };
  }

  const stage = normalizeStageArtifactStage(state.stage);
  const artifacts = await loadStageArtifacts(cwd);
  const readiness = await validateStageArtifactReadiness(cwd, artifacts, stage);

  if (readiness.ok) {
    const advancement = await advanceStageAfterReadyArtifact(cwd, state, stage);
    return {
      accepted: advancement.accepted,
      action: "advance",
      message: advancement.message,
      stage,
      readiness,
      advancement,
    };
  }

  const stageAgent = await runStageAgentStep(cwd, state, stage, options, runner);
  const advancement = options.execute && stageAgent.runRecord?.status === "passed"
    ? await advanceStageAfterReadyArtifact(cwd, state, stage)
    : undefined;

  return {
    accepted: stageAgent.accepted && (advancement?.accepted ?? true),
    action: "run_stage_agent",
    message: formatStageConductorMessage(readiness, stageAgent, advancement, Boolean(options.execute)),
    stage,
    readiness,
    stageAgent,
    advancement,
  };
}

export async function runStageConductorLoop(
  cwd: string,
  state: ScalerState,
  options: StageConductorLoopOptions = {},
  runner?: StageAgentRunner,
): Promise<StageConductorLoopResult> {
  const maxSteps = normalizeLoopMaxSteps(options.maxSteps);
  const steps: StageConductorStepResult[] = [];
  let currentState = state;
  let stopReason: StageConductorLoopStopReason = "max_steps";

  for (let index = 0; index < maxSteps; index += 1) {
    const step = await runStageConductorStep(cwd, currentState, options, runner);
    steps.push(step);
    if (step.advancement?.state) currentState = step.advancement.state;

    if (currentState.stage === "completed") {
      stopReason = "completed";
      break;
    }

    if (step.action === "unsupported_stage") {
      stopReason = "unsupported_stage";
      break;
    }

    if (!step.accepted) {
      stopReason = "step_rejected";
      break;
    }

    if (step.advancement?.advanced) continue;

    if (step.action === "run_stage_agent") {
      stopReason = options.execute ? "stage_agent_without_advancement" : "prepared_stage_agent";
      break;
    }

    stopReason = "step_rejected";
    break;
  }

  let completionMessage = "";
  if (currentState.stage === "completed") {
    const completion = await completeRunWithEvidence(cwd, currentState);
    stopReason = completion.accepted ? "completed" : "step_rejected";
    completionMessage = `\n${completion.message}`;
  }
  return {
    accepted: stopReason !== "step_rejected" && steps.length > 0 && steps.every((step) => step.accepted),
    completed: currentState.stage === "completed" && stopReason === "completed",
    stopReason,
    steps,
    finalState: currentState,
    message: formatStageConductorLoopMessage(steps, currentState, stopReason) + completionMessage,
  };
}

function formatStageConductorLoopMessage(
  steps: StageConductorStepResult[],
  finalState: ScalerState,
  stopReason: StageConductorLoopStopReason,
): string {
  const lines = [`Stage conductor loop: steps=${steps.length} stop=${stopReason} final_stage=${finalState.stage}`];
  for (const [index, step] of steps.entries()) {
    const stage = step.stage ?? "n/a";
    const summary = step.message.split("\n")[0] ?? step.message;
    lines.push(`- ${index + 1}. ${stage} ${step.action}: ${summary}`);
  }
  return lines.join("\n");
}

function normalizeLoopMaxSteps(maxSteps: number | undefined): number {
  if (maxSteps === undefined || !Number.isFinite(maxSteps)) return 5;
  return Math.min(Math.max(Math.trunc(maxSteps), 1), 20);
}

function formatStageConductorMessage(
  readiness: StageArtifactReadinessValidation,
  stageAgent: StageAgentStepResult,
  advancement: StageAdvancementResult | undefined,
  executed: boolean,
): string {
  const lines = [formatStageArtifactReadiness(readiness)];
  const runId = stageAgent.runRecord?.id ?? "n/a";
  lines.push(stageAgent.accepted ? `${stageAgent.message} run=${runId}` : stageAgent.message);

  if (executed && stageAgent.ingestion?.attempted) {
    lines.push(stageAgent.ingestion.ingested
      ? `Ingested stage artifact ${stageAgent.ingestion.artifact?.id ?? "unknown"}.`
      : `No stage artifact ingested: ${stageAgent.ingestion.reason ?? "unknown reason"}`);
  }

  if (advancement) lines.push(advancement.message);
  return lines.join("\n");
}

function isStageArtifactStage(stage: string): stage is StageArtifactStage {
  return stageArtifactStages.includes(stage as StageArtifactStage);
}

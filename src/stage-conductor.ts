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

export type StageConductorAction = "advance" | "run_stage_agent" | "unsupported_stage";

export interface StageConductorStepOptions extends RunStageAgentOptions {}

export interface StageConductorStepResult {
  accepted: boolean;
  action: StageConductorAction;
  message: string;
  stage?: StageArtifactStage;
  readiness?: StageArtifactReadinessValidation;
  advancement?: StageAdvancementResult;
  stageAgent?: StageAgentStepResult;
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
    accepted: stageAgent.accepted,
    action: "run_stage_agent",
    message: formatStageConductorMessage(readiness, stageAgent, advancement, Boolean(options.execute)),
    stage,
    readiness,
    stageAgent,
    advancement,
  };
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

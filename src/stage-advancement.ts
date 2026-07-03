import { saveState } from "./state.js";
import {
  formatStageArtifactReadiness,
  loadStageArtifacts,
  normalizeStageArtifactStage,
  validateStageArtifactReadiness,
  type StageArtifactReadinessValidation,
  type StageArtifactStage,
} from "./stages.js";
import { transitionStage } from "./supervisor.js";
import type { ScalerStage, ScalerState } from "./types.js";

export interface StageAdvancementResult {
  accepted: boolean;
  advanced: boolean;
  message: string;
  stage: StageArtifactStage;
  targetStage?: ScalerStage;
  state: ScalerState;
  validation?: StageArtifactReadinessValidation;
}

export async function advanceStageAfterReadyArtifact(
  cwd: string,
  state: ScalerState,
  stageInput: StageArtifactStage | string,
  now = new Date(),
): Promise<StageAdvancementResult> {
  const stage = normalizeStageArtifactStage(stageInput);
  const targetStage = nextStageForArtifact(stage);
  const artifacts = await loadStageArtifacts(cwd);
  const validation = await validateStageArtifactReadiness(cwd, artifacts, stage);

  if (!validation.ok) {
    return {
      accepted: false,
      advanced: false,
      message: formatStageArtifactReadiness(validation),
      stage,
      targetStage,
      state,
      validation,
    };
  }

  if (!targetStage) {
    return {
      accepted: false,
      advanced: false,
      message: `No deterministic advancement target for stage ${stage}.`,
      stage,
      state,
      validation,
    };
  }

  if (state.stage !== stage) {
    return {
      accepted: false,
      advanced: false,
      message: `Cannot advance ${stage} artifact while supervisor stage is ${state.stage}.`,
      stage,
      targetStage,
      state,
      validation,
    };
  }

  const nextState = transitionStage(state, targetStage, {
    reason: `Ready ${stage} stage artifact accepted: ${validation.artifact?.id ?? "unknown"}`,
    now,
  });
  await saveState(cwd, nextState);
  const advanced = nextState.stage === targetStage;
  return {
    accepted: advanced,
    advanced,
    message: advanced
      ? `Advanced stage ${stage} -> ${targetStage} using artifact ${validation.artifact?.id ?? "unknown"}.`
      : `Stage ${stage} artifact was ready, but supervisor rejected transition to ${targetStage}.`,
    stage,
    targetStage,
    state: nextState,
    validation,
  };
}

export function nextStageForArtifact(stage: StageArtifactStage): ScalerStage | undefined {
  switch (stage) {
    case "prd": return "knowledge";
    case "knowledge": return "planning";
    case "planning": return "execution";
    case "replanning": return "execution";
    case "execution": return "completed";
  }
}

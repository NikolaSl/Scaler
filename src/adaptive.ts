import { transitionStage } from "./supervisor.js";
import type { ScalerStage, ScalerState } from "./types.js";

export interface ComplexityDecision {
  level: number;
  stage: ScalerStage;
  reason: string;
}

const highRiskPattern = /\b(production|deploy|publish|security|auth|permission|crypto|secret|kubernetes|minikube|docker|ci\/cd|compliance)\b/i;
const complexPattern = /\b(architecture|multi[- ]?stage|orchestrat|migration|refactor|integration|research|investigate|plan)\b/i;
const implementationPattern = /\b(implement|build|fix|test|change|modify|add|update)\b/i;

export function selectComplexity(request: string): ComplexityDecision {
  const trimmed = request.trim();
  if (!trimmed) {
    return { level: 0, stage: "idle", reason: "Empty request." };
  }

  if (highRiskPattern.test(trimmed)) {
    return { level: 4, stage: "prd", reason: "High-risk or environment-sensitive request needs full Scaler workflow." };
  }

  if (complexPattern.test(trimmed) || trimmed.length > 500) {
    return { level: 3, stage: "prd", reason: "Complex request needs staged PRD, knowledge, planning, and execution." };
  }

  if (implementationPattern.test(trimmed)) {
    return { level: 2, stage: "planning", reason: "Implementation request needs lightweight planning before execution." };
  }

  return { level: 1, stage: "execution", reason: "Simple request can use lightweight execution." };
}

export function startScalerRun(state: ScalerState, request: string, now = new Date()): ScalerState {
  const decision = selectComplexity(request);
  const staged = transitionStage(
    {
      ...state,
      complexityLevel: decision.level,
      orchestrationReason: decision.reason,
    },
    decision.stage,
    { reason: decision.reason, now },
  );

  return {
    ...staged,
    orchestrationReason: decision.reason,
    updatedAt: now.toISOString(),
  };
}

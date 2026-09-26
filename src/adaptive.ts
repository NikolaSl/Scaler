/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import { budgetUsageKeys, evaluateBudgetUsage, getBudgetState, getStrongestBudgetDecision, type BudgetDecision } from "./budgets.js";
import { canTransitionStage, transitionStage } from "./supervisor.js";
import type { ScalerStage, ScalerState } from "./types.js";

export interface ComplexityDecision {
  level: number;
  stage: ScalerStage;
  reason: string;
}

export type AdaptiveOrchestrationAction = "stay" | "escalate" | "deescalate" | "pause";

export interface AdaptiveSignals {
  debuggingTasks: number;
  failedTasks: number;
  blockedTasks: number;
  needsReplanTasks: number;
  runnableTasks: number;
  validatedTasks: number;
  validationFailures: number;
  blockers: number;
  rejectedTransitions: number;
  budgetStatus: BudgetDecision["status"];
  budgetKey: BudgetDecision["key"];
}

export interface AdaptiveAssessment {
  action: AdaptiveOrchestrationAction;
  currentStage: ScalerStage;
  targetStage: ScalerStage;
  currentLevel: number;
  targetLevel: number;
  stageTransitionAvailable: boolean;
  reasons: string[];
  signals: AdaptiveSignals;
  budgetDecision: BudgetDecision;
  recommendedCommand: string;
}

export interface AdaptiveAssessmentOptions {
  validationFailureThreshold?: number;
  rejectedTransitionThreshold?: number;
}

export interface AdaptiveApplyResult {
  state: ScalerState;
  assessment: AdaptiveAssessment;
  stageTransitionApplied: boolean;
  complexityChanged: boolean;
}

const informationRequestPattern = /^(?:(?:please|моля)[\s,:-]+)*(?:(?:what|why|how|explain|describe|compare|summarize|define|tell|find|list|read|show)\b|(?:какво|как|защо|обясни|опиши|сравни|обобщи|дефинирай|кажи|намери|изброй|прочети|покажи)(?:\s|$))/iu;
const externalEffectPattern = /\b(deploy|publish|release|ship|send|submit|purchase|pay|grant|revoke|rotate)\b|(?:^|[\s\p{P}])(?:разгърн|публикува|изпрат|подад|закуп|плат|предостав|отнем|завърт)\p{L}*(?=$|[\s\p{P}])/iu;
const complexWorkPattern = /\b(architecture|multi[- ]?stage|orchestrat|migration|migrate|refactor|integration|integrate|research|investigate|plan)\b|(?:^|[\s\p{P}])(?:архитектур|многоетап|оркестрира|миграци|мигрира|рефактор|интегрира|проуч|изследва|планира|планирай)\p{L}*(?=$|[\s\p{P}])/iu;
const workspaceEffectPattern = /\b(implement|build|fix|test|change|modify|add|update|remove|delete)\b|(?:^|[\s\p{P}])(?:реализира|внедри|изгради|поправи|тествай|промени|добави|обнови|актуализира|премах|изтри)\p{L}*(?=$|[\s\p{P}])/iu;

export function selectComplexity(request: string): ComplexityDecision {
  const trimmed = request.trim();
  if (!trimmed) {
    return { level: 0, stage: "idle", reason: "Empty request." };
  }

  if (informationRequestPattern.test(trimmed)) {
    return { level: 1, stage: "execution", reason: "Information request can use lightweight execution without inferring effects from domain vocabulary." };
  }

  if (externalEffectPattern.test(trimmed)) {
    return { level: 4, stage: "prd", reason: "Requested external effect needs the full Scaler workflow before execution." };
  }

  if (complexWorkPattern.test(trimmed)) {
    return { level: 3, stage: "prd", reason: "Multi-workstream or investigative change needs staged planning and execution." };
  }

  if (workspaceEffectPattern.test(trimmed)) {
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

export function assessAdaptiveOrchestration(
  state: ScalerState,
  options: AdaptiveAssessmentOptions = {},
): AdaptiveAssessment {
  const validationFailureThreshold = Math.max(1, options.validationFailureThreshold ?? 1);
  const rejectedTransitionThreshold = Math.max(1, options.rejectedTransitionThreshold ?? 2);
  const budgetDecision = getCurrentBudgetDecision(state);
  const signals = collectAdaptiveSignals(state, budgetDecision);

  let action: AdaptiveOrchestrationAction = "stay";
  let targetStage = state.stage;
  let targetLevel = state.complexityLevel;
  const reasons: string[] = [];

  if (budgetDecision.status === "hard_limit") {
    action = "pause";
    targetStage = "paused";
    reasons.push(`Budget hard limit requires pause: ${budgetDecision.reason}`);
  } else if (signals.needsReplanTasks > 0 || signals.blockedTasks > 0 || signals.blockers > 0) {
    action = "escalate";
    targetStage = selectableStage(state, "replanning");
    targetLevel = Math.max(state.complexityLevel, 3);
    reasons.push(`Blocked/replan signal detected (${signals.blockedTasks} blocked, ${signals.needsReplanTasks} needs_replan, ${signals.blockers} run blockers).`);
  } else if (signals.validationFailures >= validationFailureThreshold) {
    action = "escalate";

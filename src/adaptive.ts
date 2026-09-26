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
const requestedExternalEffectPattern = /^(?:(?:please|моля)[\s,:-]+)*(?:(?:(?:can|could|would)\s+you(?:\s+please)?|(?:можеш|може|бихте)\s+ли(?:\s*,?\s*моля)?(?:\s*,?\s*да)?)\s+)?(?:deploy|publish|release|ship|send|submit|purchase|pay|grant|revoke|rotate)\b|^(?:(?:please|моля)[\s,:-]+)*(?:(?:(?:можеш|може|бихте)\s+ли(?:\s*,?\s*моля)?(?:\s*,?\s*да)?)\s+)?(?:разгърн|публикува|изпрат|подад|закуп|плат|предостав|отнем|завърт)\p{L}*(?=$|[\s\p{P}])|(?:\b(?:and(?:\s+then)?|then)\b|(?:^|[\s\p{P}])(?:и\s+после|после)(?=$|[\s\p{P}])|[,;]\s*(?:then|после)?)[\s,:-]*(?:(?:please|моля)\s+)?(?:(?:it|them|го|я|ги)\s+)?(?:(?:deploy|publish|release|ship|send|submit|purchase|pay|grant|revoke|rotate)\b|(?:разгърн|публикува|изпрат|подад|закуп|плат|предостав|отнем|завърт)\p{L}*(?=$|[\s\p{P}]))/iu;
const requestedComplexWorkPattern = /^(?:(?:please|моля)[\s,:-]+)*(?:(?:(?:can|could|would)\s+you(?:\s+please)?|(?:можеш|може|бихте)\s+ли(?:\s*,?\s*моля)?(?:\s*,?\s*да)?)\s+)?(?:plan|migrate|refactor|integrate|research|investigate|orchestrate)\b|^(?:(?:please|моля)[\s,:-]+)*(?:(?:(?:можеш|може|бихте)\s+ли(?:\s*,?\s*моля)?(?:\s*,?\s*да)?)\s+)?(?:планира|планирай|мигрира|рефактор|интегрира|проуч|изследва|оркестрира)\p{L}*(?=$|[\s\p{P}])/iu;
const workspaceEffectPattern = /\b(implement|build|fix|test|change|modify|add|update|remove|delete)\b|(?:^|[\s\p{P}])(?:реализира|внедри|изгради|поправи|тествай|промени|добави|обнови|актуализира|премах|изтри)\p{L}*(?=$|[\s\p{P}])/iu;
const followOnComplexWorkPattern = /(?:\b(?:and(?:\s+then)?|then)\b|(?:^|[\s\p{P}])(?:и\s+после|после)(?=$|[\s\p{P}])|[,;]\s*(?:then|после)?)[\s,:-]*(?:(?:please|моля)\s+)?(?:(?:plan|migrate|refactor|integrate|research|investigate|orchestrate)\b|(?:планира|планирай|мигрира|рефактор|интегрира|проуч|изследва|оркестрира)\p{L}*(?=$|[\s\p{P}]))/iu;
const followOnWorkspaceEffectPattern = /(?:\b(?:and(?:\s+then)?|then)\b|(?:^|[\s\p{P}])(?:и\s+после|после)(?=$|[\s\p{P}])|[,;]\s*(?:then|после)?)[\s,:-]*(?:(?:please|моля)\s+)?(?:(?:it|them|го|я|ги)\s+)?(?:(?:implement|build|fix|test|change|modify|add|update|remove|delete)\b|(?:реализира|внедри|изгради|поправи|тествай|промени|добави|обнови|актуализира|премах|изтри)\p{L}*(?=$|[\s\p{P}]))/iu;

export function selectComplexity(request: string): ComplexityDecision {
  const trimmed = request.trim();
  if (!trimmed) {
    return { level: 0, stage: "idle", reason: "Empty request." };
  }

  if (requestedExternalEffectPattern.test(trimmed)) {
    return { level: 4, stage: "prd", reason: "Requested external effect needs the full Scaler workflow before execution." };
  }

  if (followOnComplexWorkPattern.test(trimmed)) {
    return { level: 3, stage: "prd", reason: "Explicit follow-on multi-workstream change needs staged planning and execution." };
  }

  if (followOnWorkspaceEffectPattern.test(trimmed)) {
    return { level: 2, stage: "planning", reason: "Explicit follow-on implementation needs lightweight planning before execution." };
  }

  if (informationRequestPattern.test(trimmed)) {
    return { level: 1, stage: "execution", reason: "Information request can use lightweight execution without inferring effects from domain vocabulary." };
  }

  if (requestedComplexWorkPattern.test(trimmed)) {
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
    targetStage = selectableStage(state, "debugging");
    targetLevel = Math.max(state.complexityLevel, 3);
    reasons.push(`Validation/debug failure threshold reached (${signals.validationFailures}/${validationFailureThreshold}).`);
  } else if (signals.rejectedTransitions >= rejectedTransitionThreshold) {
    action = "escalate";
    targetStage = selectableStage(state, state.stage === "execution" || state.stage === "debugging" ? "replanning" : "planning");
    targetLevel = Math.max(state.complexityLevel, 3);
    reasons.push(`Rejected-transition uncertainty threshold reached (${signals.rejectedTransitions}/${rejectedTransitionThreshold}).`);
  } else if (budgetDecision.status === "soft_limit") {
    action = "deescalate";
    targetLevel = Math.max(1, state.complexityLevel - 1);
    reasons.push(`Budget soft limit recommends reduced scope: ${budgetDecision.reason}`);
  } else if (shouldDeescalateClearRun(state, signals)) {
    action = "deescalate";
    targetLevel = Math.max(1, state.complexityLevel - 1);
    reasons.push("Run is low-risk and clear: no blocked/debugging/failed tasks, no rejection uncertainty, and budget is healthy.");
  } else {
    reasons.push("No adaptive escalation or de-escalation trigger is active.");
  }

  const stageTransitionAvailable = targetStage === state.stage || canTransitionStage(state, targetStage).ok;

  return {
    action,
    currentStage: state.stage,
    targetStage,
    currentLevel: state.complexityLevel,
    targetLevel,
    stageTransitionAvailable,
    reasons,
    signals,
    budgetDecision,
    recommendedCommand: action === "stay" ? "/scaler-status" : "/scaler-adapt apply",
  };
}

export function applyAdaptiveOrchestration(
  state: ScalerState,
  assessment = assessAdaptiveOrchestration(state),
  now = new Date(),

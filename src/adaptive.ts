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
const initialRequestedActionPrefix = String.raw`^(?:(?:please|моля)[\s,:-]+)*(?:(?:(?:can|could|would)\s+you(?:\s+please)?|(?:можеш|може|бихте)\s+ли(?:\s*,?\s*моля)?(?:\s*,?\s*да)?)\s+)?`;
const sequentialActionPrefix = String.raw`(?:\b(?:and\s+then|then)\b|(?:^|[\s\p{P}])(?:и\s+после|после)(?=$|[\s\p{P}])|[,;]\s*(?:then|после)\b)[\s,:-]*(?:(?:please|моля)\s+)?(?:(?:it|them|го|я|ги)\s+)?`;
const informationConjunctionPrefix = String.raw`(?:\band\b|(?:^|[\s\p{P}])и(?=$|[\s\p{P}]))[\s,:-]*(?:(?:please|моля)\s+)?(?:(?:it|them|го|я|ги)\s+)?`;

interface RequestedActionPatterns {
  requested: RegExp;
  informationalFollowOn: RegExp;
}

function createRequestedActionPatterns(actionPattern: string): RequestedActionPatterns {
  return {
    requested: new RegExp(`${initialRequestedActionPrefix}(?:${actionPattern})|${sequentialActionPrefix}(?:${actionPattern})`, "iu"),
    informationalFollowOn: new RegExp(`${informationConjunctionPrefix}(?:${actionPattern})`, "iu"),
  };
}

const externalActionPattern = String.raw`(?:deploy|publish|ship|submit|purchase|pay|grant|revoke|rotate)\b|release\b(?!\s+notes?\b)|send\b(?=\s+(?:(?:me|us|him|her|them)\s+)?(?:(?:a|an|the)\s+)?(?:email|message|notification|request|form|file|data|payment)\b)|(?:(?:разгърн|публикува|изпрат|подад|закуп|предостав|отнем|завърт)|плат(?:и|ете|я|им|иш|ят))\p{L}*(?=$|[\s\p{P}])`;
const complexActionPattern = String.raw`(?:plan|migrate|refactor|integrate|research|investigate|orchestrate)\b|(?:планира|планирай|мигрира|рефактор|интегрира|проуч|изследва|оркестрира)\p{L}*(?=$|[\s\p{P}])`;
const workspaceActionPattern = String.raw`(?:implement|build|fix|test|change|modify|add|update|remove|delete|create|edit|write|rename|move|copy)\b|(?:реализира|внедри|изгради|поправи|тествай|промени|добави|обнови|актуализира|премах|изтри|създа|редактира|напиш|преименува|премести|копира)\p{L}*(?=$|[\s\p{P}])`;
const externalEffectPatterns = createRequestedActionPatterns(externalActionPattern);
const complexWorkPatterns = createRequestedActionPatterns(complexActionPattern);
const workspaceEffectPatterns = createRequestedActionPatterns(workspaceActionPattern);

export function selectComplexity(request: string): ComplexityDecision {
  const trimmed = request.trim();
  if (!trimmed) {
    return { level: 0, stage: "idle", reason: "Empty request." };
  }

  const informationRequest = informationRequestPattern.test(trimmed);

  if (externalEffectPatterns.requested.test(trimmed) || (informationRequest && externalEffectPatterns.informationalFollowOn.test(trimmed))) {
    return { level: 4, stage: "prd", reason: "Requested external effect needs the full Scaler workflow before execution." };
  }

  if (complexWorkPatterns.requested.test(trimmed) || (informationRequest && complexWorkPatterns.informationalFollowOn.test(trimmed))) {
    return { level: 3, stage: "prd", reason: "Requested multi-workstream or investigative change needs staged planning and execution." };
  }

  if (workspaceEffectPatterns.requested.test(trimmed) || (informationRequest && workspaceEffectPatterns.informationalFollowOn.test(trimmed))) {
    return { level: 2, stage: "planning", reason: "Implementation request needs lightweight planning before execution." };
  }

  if (informationRequest) {
    return { level: 1, stage: "execution", reason: "Information request can use lightweight execution without inferring effects from domain vocabulary." };
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
): AdaptiveApplyResult {
  let nextState = state;
  let stageTransitionApplied = false;

  if (assessment.targetStage !== state.stage && canTransitionStage(state, assessment.targetStage).ok) {
    nextState = transitionStage(state, assessment.targetStage, {
      reason: formatAdaptiveReason(assessment),
      now,
    });
    stageTransitionApplied = nextState.stage === assessment.targetStage;
  }

  const complexityChanged = nextState.complexityLevel !== assessment.targetLevel;
  nextState = {
    ...nextState,
    complexityLevel: assessment.targetLevel,
    orchestrationReason: formatAdaptiveReason(assessment),
    updatedAt: now.toISOString(),
  };

  return {
    state: nextState,
    assessment,
    stageTransitionApplied,
    complexityChanged,
  };
}

export function formatAdaptiveAssessment(assessment: AdaptiveAssessment): string {
  const lines = [
    `Adaptive orchestration: action=${assessment.action} stage=${assessment.currentStage}->${assessment.targetStage} level=${assessment.currentLevel}->${assessment.targetLevel}`,
    `Stage transition: ${assessment.stageTransitionAvailable ? "available" : "not available from current stage"}`,
    `Budget: ${assessment.budgetDecision.status} ${assessment.budgetDecision.key} action=${assessment.budgetDecision.recommendedAction}`,
    `Signals: validationFailures=${assessment.signals.validationFailures} blocked=${assessment.signals.blockedTasks} needsReplan=${assessment.signals.needsReplanTasks} rejected=${assessment.signals.rejectedTransitions}`,
    `Recommendation: ${assessment.recommendedCommand}`,
    "Reasons:",
  ];
  lines.push(...assessment.reasons.map((reason) => `- ${reason}`));
  return lines.join("\n");
}

function getCurrentBudgetDecision(state: ScalerState): BudgetDecision {
  const budgets = getBudgetState(state);
  return getStrongestBudgetDecision(
    budgetUsageKeys.map((key) => evaluateBudgetUsage(key, budgets.usage[key] ?? 0, budgets.limits[key])),
  );
}

function collectAdaptiveSignals(state: ScalerState, budgetDecision: BudgetDecision): AdaptiveSignals {
  const debuggingTasks = state.tasks.filter((task) => task.status === "debugging").length;
  const failedTasks = state.tasks.filter((task) => task.status === "failed").length;
  const blockedTasks = state.tasks.filter((task) => task.status === "blocked").length;
  const needsReplanTasks = state.tasks.filter((task) => task.status === "needs_replan").length;
  const runnableTasks = state.tasks.filter((task) => task.status === "ready" || task.status === "pending").length;
  const validatedTasks = state.tasks.filter((task) => task.status === "validated").length;

  return {
    debuggingTasks,
    failedTasks,
    blockedTasks,
    needsReplanTasks,
    runnableTasks,
    validatedTasks,
    validationFailures: debuggingTasks + failedTasks + (state.failedTaskId ? 1 : 0),
    blockers: state.blockers.length,
    rejectedTransitions: state.rejectedTransitions.length,
    budgetStatus: budgetDecision.status,
    budgetKey: budgetDecision.key,
  };
}

function selectableStage(state: ScalerState, desired: ScalerStage): ScalerStage {
  if (state.stage === desired || canTransitionStage(state, desired).ok) return desired;
  return state.stage;
}

function shouldDeescalateClearRun(state: ScalerState, signals: AdaptiveSignals): boolean {
  if (state.complexityLevel < 3) return false;
  if (signals.budgetStatus !== "ok") return false;
  if (signals.debuggingTasks > 0 || signals.failedTasks > 0 || signals.blockedTasks > 0 || signals.needsReplanTasks > 0) return false;
  if (signals.blockers > 0 || signals.rejectedTransitions > 0) return false;
  if (state.stage !== "execution" && state.stage !== "planning") return false;
  return state.tasks.length <= 1 || (state.tasks.length > 0 && signals.validatedTasks === state.tasks.length);
}

function formatAdaptiveReason(assessment: AdaptiveAssessment): string {
  return `Adaptive ${assessment.action}: ${assessment.reasons.join(" ")}`;
}

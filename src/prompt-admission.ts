/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import { estimateTokens } from "./context.js";
import type { TaskAttemptBinding } from "./task-attempts.js";

export const DEFAULT_TASK_PROMPT_TOKEN_BUDGET = 8_000;

export interface TaskPromptAdmissionDecision {
  accepted: boolean;
  estimatedTokens: number;
  tokenBudget: number;
  message: string;
}

const sizingFingerprint = `sha256:${"0".repeat(64)}`;

export function resolveTaskPromptTokenBudget(explicit?: number, manifest?: number): number {
  return explicit ?? manifest ?? DEFAULT_TASK_PROMPT_TOKEN_BUDGET;
}

export function createPromptSizingAttemptBinding(runId: string): TaskAttemptBinding {
  return {
    runId,
    attemptId: "00000000-0000-4000-8000-000000000000",
    taskFingerprint: sizingFingerprint,
    inputFingerprint: sizingFingerprint,
    routeFingerprint: sizingFingerprint,
    validationPolicyFingerprint: sizingFingerprint,
  };
}

export function assessTaskPromptAdmission(prompt: string, tokenBudget: number): TaskPromptAdmissionDecision {
  const estimatedTokens = estimateTokens(prompt);
  if (!Number.isSafeInteger(tokenBudget) || tokenBudget <= 0) {
    return {
      accepted: false,
      estimatedTokens,
      tokenBudget,
      message: `Final SCALER prompt refused: token allowance must be a positive finite integer; received ${String(tokenBudget)}.`,
    };
  }
  const accepted = estimatedTokens <= tokenBudget;
  return {
    accepted,
    estimatedTokens,
    tokenBudget,
    message: accepted
      ? `Final SCALER prompt admitted: estimated ${estimatedTokens}/${tokenBudget} tokens.`
      : `Final SCALER prompt refused: estimated ${estimatedTokens} tokens exceeds allowance ${tokenBudget}. Required context was preserved; split or enlarge the declared allowance before execution.`,
  };
}

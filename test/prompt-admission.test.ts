/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  requireTaskPromptAdmission,
  TaskPromptAdmissionError,
} from "../src/prompt-admission.js";

test("requireTaskPromptAdmission admits the exact final-prompt boundary", () => {
  const prompt = `Required context\n${"exact-source\n".repeat(1_000)}`;
  const baseline = requireTaskPromptAdmission(prompt);
  const exact = requireTaskPromptAdmission(prompt, baseline.estimatedTokens);

  assert.equal(exact.accepted, true);
  assert.equal(exact.estimatedTokens, exact.tokenBudget);
});

test("requireTaskPromptAdmission rejects one token under and malformed allowances", () => {
  const prompt = `Required context\n${"exact-source\n".repeat(1_000)}`;
  const baseline = requireTaskPromptAdmission(prompt);

  for (const tokenBudget of [baseline.estimatedTokens - 1, 0, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => requireTaskPromptAdmission(prompt, tokenBudget),
      (error: unknown) => error instanceof TaskPromptAdmissionError
        && error.decision.accepted === false
        && error.decision.tokenBudget === tokenBudget,
    );
  }
});

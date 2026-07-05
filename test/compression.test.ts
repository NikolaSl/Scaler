/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { assessCompression, createCompressionPolicy, formatCompressionGuidance, normalizeExactness } from "../src/compression.js";

test("createCompressionPolicy normalizes active context limit", () => {
  assert.deepEqual(createCompressionPolicy(10_000, 0.75, 500), {
    contextWindowTokens: 10_000,
    targetRatio: 0.75,
    activeContextLimitTokens: 7_500,
    largeItemThresholdTokens: 500,
  });
  assert.equal(createCompressionPolicy(-1, 2).activeContextLimitTokens, 6_000);
});

test("normalizeExactness derives exactness from explicit value and scope", () => {
  assert.equal(normalizeExactness("exact", "summary"), "exact");
  assert.equal(normalizeExactness(undefined, "reference-only"), "reference-only");
  assert.equal(normalizeExactness(undefined, "summary"), "summary-ok");
  assert.equal(normalizeExactness(undefined, "snippet"), "exact");
});

test("assessCompression classifies refs and recommends split/externalization", () => {
  const assessment = assessCompression({
    contextWindowTokens: 1_000,
    estimatedTokens: 900,
    largeItemThresholdTokens: 100,
    items: [
      { id: "api-signature", exactness: "exact", estimatedTokens: 250 },
      { id: "research-summary", exactness: "summary-ok", estimatedTokens: 50 },
      { id: "memory-ref", exactness: "reference-only", estimatedTokens: 10 },
    ],
  });

  assert.equal(assessment.overTarget, true);
  assert.equal(assessment.splitRecommended, true);
  assert.deepEqual(assessment.exactRefs, ["api-signature"]);
  assert.deepEqual(assessment.externalizeRefs, ["api-signature"]);
  assert.deepEqual(assessment.summaryOkRefs, ["research-summary"]);
  assert.deepEqual(assessment.referenceOnlyRefs, ["memory-ref"]);
  assert.match(assessment.recommendations.join("\n"), /split the work/);
});

test("formatCompressionGuidance renders deterministic policy text", () => {
  const guidance = formatCompressionGuidance(assessCompression({
    contextWindowTokens: 2_000,
    estimatedTokens: 1_000,
    items: [{ id: "REQ-001", exactness: "exact", estimatedTokens: 1 }],
  }));

  assert.match(guidance, /Compression and Exact-Preservation Policy/);
  assert.match(guidance, /Active context target: <= 1500 tokens/);
  assert.match(guidance, /Exact refs: REQ-001/);
});

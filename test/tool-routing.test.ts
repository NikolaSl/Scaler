/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { RuntimeToolEnvelopeProfile } from "../src/tool-requests.js";
import { assessToolRoute, type ToolRouteAssessmentInput, type ToolRouteModelCandidateInput } from "../src/tool-routing.js";

const model8k = { api: "openai-completions", provider: "openai", id: "route-8k", contextWindow: 8_000 };
const model32k = { ...model8k, id: "route-32k", contextWindow: 32_000 };
const policy = { requestTokenAllowance: 32_000, outputReserveTokens: 32, safetyMarginTokens: 16 };

function payload(characters: number) {
  return {
    model: "synthetic",
    messages: [{ role: "system", content: "fixed" }, { role: "user", content: "x".repeat(characters) }],
    tools: [{ type: "function", function: { name: "docs_search", description: "Search docs", parameters: { type: "object" } } }],
    max_completion_tokens: 64,
  };
}

const profile: RuntimeToolEnvelopeProfile = {
  version: 1,
  footprint: "selected",
  toolNames: ["docs_search"],
  byteSize: 512,
  fingerprint: "a".repeat(64),
};

function candidate(
  requestPayload: unknown,
  model = model32k,
  additionalContextBytes: number | null = 0,
  repeatCount = 1,
): ToolRouteModelCandidateInput {
  return {
    available: true,
    legs: [{ id: "request", payload: requestPayload, model, policy, additionalContextBytes, repeatCount }],
  };
}

function baseInput(overrides: Partial<ToolRouteAssessmentInput> = {}): ToolRouteAssessmentInput {
  return {
    request: {
      requestId: "REQ-1",
      taskId: "T-1",
      attemptId: "ATTEMPT-1",
      toolNames: ["docs_search"],
      content: { request: "Find the exact API docs.", arguments: { query: "routing" } },
    },
    profile,
    authority: "allowed",
    direct: { exactArgumentsAvailable: false, argumentsValidated: false },
    currentAgent: candidate(payload(100)),
    isolated: candidate(payload(500)),
    ...overrides,
  };
}

test("route assessment recommends a supported exact direct operation without authorizing execution", () => {
  const result = assessToolRoute(baseInput({
    direct: {
      exactArgumentsAvailable: true,
      argumentsValidated: true,
      adapterId: "builtin:validated-read-v1",
    },
  }));

  assert.equal(result.route, "direct");
  assert.equal(result.executionAuthorized, false);
  assert.equal(result.direct.feasible, true);
  assert.equal(result.direct.modelCallCount, 0);
  assert.equal(result.selectedEstimatedOverheadUpperBound, 0);
});

test("route assessment excludes direct execution without validated arguments or an adapter", () => {
  const result = assessToolRoute(baseInput({
    direct: { exactArgumentsAvailable: true, argumentsValidated: false },
  }));

  assert.equal(result.route, "current-agent");
  assert.equal(result.direct.feasible, false);
  assert.ok(result.direct.reasonCodes.includes("arguments-not-validated"));
  assert.ok(result.direct.reasonCodes.includes("direct-adapter-unavailable"));
});

test("complete provider payload changes current-agent feasibility between 8k and 32k windows", () => {
  const largePayload = payload(9_000);
  const blocked = assessToolRoute(baseInput({
    currentAgent: candidate(largePayload, model8k),
    isolated: { available: false, legs: [] },
  }));
  const admitted = assessToolRoute(baseInput({
    currentAgent: candidate(largePayload, model32k),
    isolated: { available: false, legs: [] },
  }));

  assert.equal(blocked.route, "blocked");
  assert.equal(blocked.currentAgent.feasible, false);
  assert.equal(admitted.route, "current-agent");
  assert.equal(admitted.currentAgent.feasible, true);
  assert.notEqual(blocked.evidenceFingerprint, admitted.evidenceFingerprint);
});

test("route assessment measures the actual payload instead of profile metadata bytes", () => {
  const compact = assessToolRoute(baseInput({
    profile: { ...profile, byteSize: 100_000 },
    currentAgent: candidate(payload(100)),
    isolated: { available: false, legs: [] },
  }));
  const wholeCatalogPayload = assessToolRoute(baseInput({
    profile: { ...profile, footprint: "whole-catalog", byteSize: 1 },
    currentAgent: candidate(payload(33_000)),
    isolated: { available: false, legs: [] },
  }));

  assert.equal(compact.route, "current-agent", "canonical profile bytes are not provider wire bytes");
  assert.equal(wholeCatalogPayload.route, "blocked", "the actual injected catalog payload must determine fit");
});

test("isolated route requires every worker and caller-continuation leg to fit", () => {
  const isolated: ToolRouteModelCandidateInput = {
    available: true,
    legs: [
      { id: "worker", payload: payload(100), model: model8k, policy, additionalContextBytes: 0, repeatCount: 1 },
      { id: "caller-continuation", payload: payload(7_900), model: model8k, policy, additionalContextBytes: 200, repeatCount: 1 },
    ],
  };
  const result = assessToolRoute(baseInput({
    currentAgent: { available: false, legs: [] },
    isolated,
  }));

  assert.equal(result.route, "blocked");
  assert.equal(result.isolated.feasible, false);
  assert.ok(result.isolated.reasonCodes.some((reason) => reason.includes("caller-continuation")));
});

test("least measured overhead wins and ties prefer the current agent", () => {
  const currentWins = assessToolRoute(baseInput({
    currentAgent: candidate(payload(100)),
    isolated: candidate(payload(1_000)),
  }));
  const isolatedWins = assessToolRoute(baseInput({
    currentAgent: candidate(payload(1_000)),
    isolated: candidate(payload(100)),
  }));
  const tie = assessToolRoute(baseInput({
    currentAgent: candidate(payload(100)),
    isolated: candidate(payload(100)),
  }));

  assert.equal(currentWins.route, "current-agent");
  assert.equal(isolatedWins.route, "isolated");
  assert.equal(tie.route, "current-agent");
});

test("a documented isolation requirement excludes a cheaper current-agent route", () => {
  const result = assessToolRoute(baseInput({
    isolationRequirement: "evidence-independence",
    currentAgent: candidate(payload(100)),
    isolated: candidate(payload(1_000)),
  }));

  assert.equal(result.route, "isolated");
  assert.equal(result.reasonCode, "isolation-required");
});

test("unknown bounds stay distinct from known zero and malformed arithmetic fails closed", () => {
  const unknown = assessToolRoute(baseInput({
    currentAgent: candidate(payload(100), model32k, null),
    isolated: { available: false, legs: [] },
  }));
  const zero = assessToolRoute(baseInput({
    currentAgent: candidate(payload(100), model32k, 0),
    isolated: { available: false, legs: [] },
  }));
  const invalid = assessToolRoute(baseInput({
    currentAgent: candidate(payload(100), model32k, -1),
    isolated: { available: false, legs: [] },
  }));
  const overflow = assessToolRoute(baseInput({
    currentAgent: candidate(payload(100), model32k, Number.MAX_SAFE_INTEGER),
    isolated: { available: false, legs: [] },
  }));

  assert.equal(unknown.route, "blocked");
  assert.ok(unknown.currentAgent.reasonCodes.includes("request:additional-context-unknown"));
  assert.equal(zero.route, "current-agent");
  assert.equal(invalid.route, "blocked");
  assert.ok(invalid.currentAgent.reasonCodes.includes("request:invalid-additional-context"));
  assert.equal(overflow.route, "blocked");
  assert.ok(overflow.currentAgent.reasonCodes.includes("request:envelope-overflow"));
});

test("authority and profile evidence fail closed without trying a different route", () => {
  for (const authority of ["denied", "unknown"] as const) {
    const result = assessToolRoute(baseInput({ authority }));
    assert.equal(result.route, "blocked");
    assert.equal(result.reasonCode, `authority-${authority}`);
    assert.equal(result.executionAuthorized, false);
  }
  const unknownProfile = assessToolRoute(baseInput({
    profile: { version: 1, footprint: "unknown", toolNames: ["docs_search"], byteSize: null, fingerprint: null, reason: "selection-apis-unavailable" },
  }));
  assert.equal(unknownProfile.route, "blocked");
  assert.equal(unknownProfile.reasonCode, "tool-profile-unknown");
});

test("assessment binding changes with request profile model policy and bounds", () => {
  const baseline = assessToolRoute(baseInput());
  const variants = [
    assessToolRoute(baseInput({ request: { ...baseInput().request, content: { request: "Different" } } })),
    assessToolRoute(baseInput({ profile: { ...profile, fingerprint: "b".repeat(64) } })),
    assessToolRoute(baseInput({ currentAgent: candidate(payload(100), { ...model32k, id: "other" }) })),
    assessToolRoute(baseInput({ currentAgent: { available: true, legs: [{ ...candidate(payload(100)).legs[0], policy: { ...policy, safetyMarginTokens: 17 } }] } })),
    assessToolRoute(baseInput({ currentAgent: candidate(payload(100), model32k, 1) })),
  ];

  assert.ok(baseline.requestFingerprint);
  assert.ok(baseline.evidenceFingerprint);
  for (const variant of variants) assert.notEqual(variant.evidenceFingerprint, baseline.evidenceFingerprint);
});

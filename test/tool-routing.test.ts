/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { prepareToolRequest, recordToolRouteAssessment, type RuntimeToolEnvelopeProfile } from "../src/tool-requests.js";
import { assessToolRoute, type ToolRouteAssessmentInput, type ToolRouteModelCandidateInput } from "../src/tool-routing.js";
import { createDefaultState } from "../src/state.js";

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

function isolatedCandidate(
  workerPayload: unknown,
  continuationPayload: unknown = payload(50),
  model = model32k,
): ToolRouteModelCandidateInput {
  return {
    available: true,
    legs: [
      { id: "worker", role: "worker", payload: workerPayload, model, policy, additionalContextBytes: 0, repeatCount: 1 },
      { id: "caller-continuation", role: "caller-continuation", payload: continuationPayload, model, policy, additionalContextBytes: 0, repeatCount: 1 },
    ],
  } as unknown as ToolRouteModelCandidateInput;
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
    isolated: isolatedCandidate(payload(500)),
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
      { id: "worker", role: "worker", payload: payload(100), model: model8k, policy, additionalContextBytes: 0, repeatCount: 1 },
      { id: "caller-continuation", role: "caller-continuation", payload: payload(7_900), model: model8k, policy, additionalContextBytes: 200, repeatCount: 1 },
    ],
  } as unknown as ToolRouteModelCandidateInput;
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
    isolated: isolatedCandidate(payload(1_000)),
  }));
  const isolatedWins = assessToolRoute(baseInput({
    currentAgent: candidate(payload(1_000)),
    isolated: isolatedCandidate(payload(100), payload(10)),
  }));
  const tie = assessToolRoute(baseInput({
    currentAgent: candidate(payload(100)),
    isolated: isolatedCandidate(payload(100), payload(10)),
  }));

  assert.equal(currentWins.route, "current-agent");
  assert.equal(isolatedWins.route, "isolated");
  assert.equal(tie.route, "current-agent");
});

test("a documented isolation requirement excludes a cheaper current-agent route", () => {
  const result = assessToolRoute(baseInput({
    isolationRequirement: "evidence-independence",
    currentAgent: candidate(payload(100)),
    isolated: isolatedCandidate(payload(1_000)),
  }));

  assert.equal(result.route, "isolated");
  assert.equal(result.reasonCode, "isolation-required");
});

test("isolated evidence fails closed unless worker and caller-continuation roles are both present", () => {
  const workerOnly = assessToolRoute(baseInput({
    currentAgent: { available: false, legs: [] },
    isolated: {
      available: true,
      legs: [{ id: "worker", role: "worker", payload: payload(100), model: model32k, policy, additionalContextBytes: 0, repeatCount: 1 }],
    } as unknown as ToolRouteModelCandidateInput,
  }));
  const duplicateWorker = assessToolRoute(baseInput({
    currentAgent: { available: false, legs: [] },
    isolated: {
      available: true,
      legs: [
        { id: "worker-1", role: "worker", payload: payload(100), model: model32k, policy, additionalContextBytes: 0, repeatCount: 1 },
        { id: "worker-2", role: "worker", payload: payload(100), model: model32k, policy, additionalContextBytes: 0, repeatCount: 1 },
      ],
    } as unknown as ToolRouteModelCandidateInput,
  }));

  assert.equal(workerOnly.route, "blocked");
  assert.ok(workerOnly.isolated.reasonCodes.includes("caller-continuation-leg-missing"));
  assert.equal(duplicateWorker.route, "blocked");
  assert.ok(duplicateWorker.isolated.reasonCodes.includes("duplicate-leg-role:worker"));
});

test("malformed runtime evidence returns blocked advice instead of throwing or becoming feasible", () => {
  const malformedCandidates = [
    { available: true, legs: [null] },
    { available: true, legs: [{ id: "request", role: "request", payload: payload(100), model: model32k, additionalContextBytes: 0, repeatCount: 1 }] },
    { available: true, legs: [{ role: "request", payload: payload(100), model: model32k, policy, additionalContextBytes: 0, repeatCount: 1 }] },
  ];
  for (const currentAgent of malformedCandidates) {
    const result = assessToolRoute(baseInput({
      currentAgent: currentAgent as unknown as ToolRouteModelCandidateInput,
      isolated: { available: false, legs: [] },
    }));
    assert.equal(result.route, "blocked");
    assert.equal(result.currentAgent.feasible, false);
  }

  const invalidProfile = assessToolRoute(baseInput({
    profile: { ...profile, footprint: "unverified" } as unknown as RuntimeToolEnvelopeProfile,
  }));
  const nonArrayNames = assessToolRoute(baseInput({
    profile: { ...profile, toolNames: "docs_search" } as unknown as RuntimeToolEnvelopeProfile,
  }));
  const invalidIsolation = assessToolRoute(baseInput({
    isolationRequirement: "bad" as ToolRouteAssessmentInput["isolationRequirement"],
  }));
  assert.equal(invalidProfile.reasonCode, "invalid-tool-profile");
  assert.equal(nonArrayNames.reasonCode, "invalid-tool-profile");
  assert.equal(invalidIsolation.reasonCode, "invalid-assessment-evidence");
});

test("assessment output normalizes malformed evidence and never echoes raw objects", () => {
  const result = assessToolRoute(baseInput({
    authority: { rawRequest: "REQUEST_SENTINEL" } as unknown as ToolRouteAssessmentInput["authority"],
    profile: { ...profile, fingerprint: { rawArguments: "ARGUMENTS_SENTINEL" } } as unknown as RuntimeToolEnvelopeProfile,
    currentAgent: {
      available: true,
      legs: [{
        id: "request",
        role: "request",
        payload: payload(100),
        model: model32k,
        policy,
        additionalContextBytes: { rawProviderHistory: "HISTORY_SENTINEL" },
        repeatCount: 1,
      }],
    } as unknown as ToolRouteModelCandidateInput,
  }));

  assert.equal(result.route, "blocked");
  assert.equal(result.authority, "unknown");
  assert.equal(result.profileFingerprint, null);
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /REQUEST_SENTINEL|ARGUMENTS_SENTINEL|HISTORY_SENTINEL/);
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

test("runtime-owned route assessment records compact advice without payloads or execution", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scaler-tool-route-audit-"));
  try {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    const prepared = await prepareToolRequest(dir, state, {
      toolName: "docs_search",
      request: "Find public routing documentation.",
      allowedTools: ["docs_search"],
    }, new Date("2026-01-01T00:00:00.000Z"));
    assert.ok(prepared.record);

    const evidence = baseInput({
      request: {
        requestId: prepared.record!.id,
        toolNames: prepared.record!.allowedTools,
        content: {},
      },
      currentAgent: candidate({
        ...payload(100),
        messages: [{ role: "user", content: "PROVIDER_HISTORY_SENTINEL" }],
      }),
    });
    const recorded = await recordToolRouteAssessment(dir, state, prepared.record!.id, {
      profile: evidence.profile,
      authority: evidence.authority,
      direct: evidence.direct,
      currentAgent: evidence.currentAgent,
      isolated: evidence.isolated,
    });

    assert.equal(recorded.recorded, true);
    assert.equal(recorded.assessment?.executionAuthorized, false);
    const events = await readFile(join(dir, ".scaler", "logs", "events.jsonl"), "utf8");
    const lastEvent = JSON.parse(events.trim().split("\n").at(-1)!) as Record<string, unknown>;
    assert.match(JSON.stringify(lastEvent), /Tool route assessment recorded/);
    assert.doesNotMatch(JSON.stringify(lastEvent), /PROVIDER_HISTORY_SENTINEL/);
    assert.doesNotMatch(JSON.stringify(lastEvent), /Find public routing documentation/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assessModelProfileEligibility,
  type ModelCapabilityProfile,
  type ModelEligibilityRequirement,
} from "../src/model-profile-eligibility.js";

const localProfile: ModelCapabilityProfile = {
  version: 1,
  profileId: "local-core-v1",
  model: {
    api: "openai-completions",
    provider: "local-llama-cpp",
    id: "qwen-local",
    contextWindow: 16_384,
  },
  locality: "local",
  tokenizerEstimator: { id: "qwen-tokenizer-v1", kind: "tokenizer" },
  structuredOutput: "supported",
  tools: "supported",
  limits: { maxInputTokens: 12_000, maxOutputTokens: 2_000 },
  dataLocations: ["host-local"],
  taskSuitability: {
    "bounded-code-edit": {
      status: "observed-supported",
      evidenceRefs: ["evidence:local-core/code-edit-01"],
    },
  },
};

const remoteProfile: ModelCapabilityProfile = {
  ...localProfile,
  profileId: "remote-core-v1",
  model: { ...localProfile.model, provider: "remote-provider", id: "remote-model" },
  locality: "remote",
  dataLocations: ["remote:eu"],
};

const requirement: ModelEligibilityRequirement = {
  version: 1,
  taskClass: "bounded-code-edit",
  localOnly: true,
  allowedDataLocations: ["host-local"],
  requiresStructuredOutput: true,
  requiresTools: true,
  requiredInputTokens: 4_000,
  requiredOutputTokens: 1_000,
};

test("compatible observed local profile is eligible without authorizing execution", () => {
  const result = assessModelProfileEligibility([localProfile], requirement);

  assert.equal(result.code, "eligible-profiles");
  assert.equal(result.eligible, true);
  assert.equal(result.executionAuthorized, false);
  assert.deepEqual(result.eligibleProfileIds, [localProfile.profileId]);
  assert.deepEqual(result.profiles[0]?.reasonCodes, []);
  assert.deepEqual(result.profiles[0]?.model, localProfile.model);
});

test("local-only requirement excludes an otherwise compatible remote profile", () => {
  const result = assessModelProfileEligibility([remoteProfile], {
    ...requirement,
    allowedDataLocations: ["host-local", "remote:eu"],
  });

  assert.equal(result.code, "no-eligible-profiles");
  assert.deepEqual(result.eligibleProfileIds, []);
  assert.deepEqual(result.profiles[0]?.reasonCodes, ["locality-not-local"]);
});

test("unknown and unsupported task suitability are distinct fail-closed reasons", () => {
  const unknown = assessModelProfileEligibility([
    { ...localProfile, taskSuitability: {} },
  ], requirement);
  const unsupported = assessModelProfileEligibility([{
    ...localProfile,
    taskSuitability: {
      "bounded-code-edit": {
        status: "observed-unsupported",
        evidenceRefs: ["evidence:local-core/code-edit-negative-01"],
      },
    },
  }], requirement);

  assert.deepEqual(unknown.profiles[0]?.reasonCodes, ["task-suitability-unknown"]);
  assert.deepEqual(unsupported.profiles[0]?.reasonCodes, ["task-suitability-unsupported"]);
});

test("required structured output and tools must be explicitly supported", () => {
  const result = assessModelProfileEligibility([
    { ...localProfile, profileId: "no-structured", structuredOutput: "unsupported" },
    { ...localProfile, profileId: "no-tools", tools: "unsupported" },
  ], requirement);

  assert.equal(result.eligible, false);
  assert.deepEqual(result.profiles.map((profile) => [profile.profileId, profile.reasonCodes]), [
    ["no-structured", ["structured-output-unsupported"]],
    ["no-tools", ["tools-unsupported"]],
  ]);
});

test("every possible profile data location must be allowed", () => {
  const result = assessModelProfileEligibility([{
    ...localProfile,
    dataLocations: ["host-local", "remote:backup"],
  }], requirement);

  assert.deepEqual(result.profiles[0]?.reasonCodes, ["data-location-not-allowed"]);
});

test("required envelope is checked against configured limits and exact context window", () => {
  const inputTooLarge = assessModelProfileEligibility([localProfile], {
    ...requirement,
    requiredInputTokens: localProfile.limits.maxInputTokens + 1,
  });
  const outputTooLarge = assessModelProfileEligibility([localProfile], {
    ...requirement,
    requiredOutputTokens: localProfile.limits.maxOutputTokens + 1,
  });
  const totalTooLarge = assessModelProfileEligibility([{
    ...localProfile,
    limits: { maxInputTokens: 15_000, maxOutputTokens: 1_384 },
  }], {
    ...requirement,
    requiredInputTokens: 15_000,
    requiredOutputTokens: 1_385,
  });

  assert.deepEqual(inputTooLarge.profiles[0]?.reasonCodes, ["input-limit-exceeded"]);
  assert.deepEqual(outputTooLarge.profiles[0]?.reasonCodes, ["output-limit-exceeded"]);
  assert.ok(totalTooLarge.profiles[0]?.reasonCodes.includes("output-limit-exceeded"));
  assert.ok(totalTooLarge.profiles[0]?.reasonCodes.includes("context-window-exceeded"));
});

test("profile order does not change normalized assessment", () => {
  const secondLocal = {
    ...localProfile,
    profileId: "local-core-v2",
    model: { ...localProfile.model, id: "qwen-local-v2" },
  };

  assert.deepEqual(
    assessModelProfileEligibility([secondLocal, localProfile], requirement),
    assessModelProfileEligibility([localProfile, secondLocal], requirement),
  );
});

test("duplicate or malformed profiles invalidate the whole configuration", () => {
  const duplicate = assessModelProfileEligibility([localProfile, localProfile], requirement);
  const sparseProfiles = Array<ModelCapabilityProfile>(2);
  sparseProfiles[1] = localProfile;
  const sparse = assessModelProfileEligibility(sparseProfiles, requirement);
  const missingEstimator = assessModelProfileEligibility([{
    ...localProfile,
    tokenizerEstimator: undefined,
  } as unknown as ModelCapabilityProfile], requirement);

  for (const result of [duplicate, sparse, missingEstimator]) {
    assert.equal(result.code, "invalid-profiles");
    assert.equal(result.eligible, false);
    assert.deepEqual(result.eligibleProfileIds, []);
    assert.deepEqual(result.profiles, []);
    assert.ok(result.diagnosticCodes.length > 0);
  }
});

test("contradictory configured limits invalidate the whole configuration", () => {
  const result = assessModelProfileEligibility([{
    ...localProfile,
    limits: { maxInputTokens: 15_000, maxOutputTokens: 2_000 },
  }], requirement);

  assert.equal(result.code, "invalid-profiles");
  assert.ok(result.diagnosticCodes.includes("profile-limits-exceed-context-window"));
});

test("malformed requirement fails closed before any profile is considered", () => {
  const result = assessModelProfileEligibility([localProfile], {
    ...requirement,
    requiredInputTokens: Number.NaN,
  });

  assert.equal(result.code, "invalid-requirement");
  assert.equal(result.requirementFingerprint, null);
  assert.deepEqual(result.eligibleProfileIds, []);
  assert.deepEqual(result.profiles, []);
});

test("no eligible profile returns bounded reasons and no fallback identity", () => {
  const result = assessModelProfileEligibility([remoteProfile, {
    ...localProfile,
    profileId: "local-unsupported",
    taskSuitability: {},
  }], requirement);

  assert.equal(result.code, "no-eligible-profiles");
  assert.equal(result.eligible, false);
  assert.deepEqual(result.eligibleProfileIds, []);
  assert.equal(result.selectedProfileId, undefined);
  assert.deepEqual(result.profiles.map((profile) => profile.profileId), ["local-unsupported", "remote-core-v1"]);
});

test("remote profile is eligible only when locality and every data location are allowed", () => {
  const result = assessModelProfileEligibility([remoteProfile], {
    ...requirement,
    localOnly: false,
    allowedDataLocations: ["remote:eu"],
  });

  assert.equal(result.eligible, true);
  assert.deepEqual(result.eligibleProfileIds, [remoteProfile.profileId]);
  assert.equal(result.selectedProfileId, undefined);
});

test("literal unknown capabilities and duplicate evidence are invalid rather than optimistic", () => {
  const unknownSupport = assessModelProfileEligibility([{
    ...localProfile,
    tools: "unknown",
  } as unknown as ModelCapabilityProfile], requirement);
  const duplicateEvidence = assessModelProfileEligibility([{
    ...localProfile,
    taskSuitability: {
      "bounded-code-edit": {
        status: "observed-supported",
        evidenceRefs: ["evidence:same", "evidence:same"],
      },
    },
  }], requirement);

  assert.equal(unknownSupport.code, "invalid-profiles");
  assert.equal(duplicateEvidence.code, "invalid-profiles");
});

test("empty configured set blocks without inventing a configuration error or fallback", () => {
  const result = assessModelProfileEligibility([], requirement);

  assert.equal(result.code, "no-eligible-profiles");
  assert.equal(result.eligible, false);
  assert.match(result.profilesFingerprint ?? "", /^[a-f0-9]{64}$/u);
  assert.deepEqual(result.profiles, []);
  assert.deepEqual(result.eligibleProfileIds, []);
});

test("unsafe integer bounds fail structural validation", () => {
  for (const value of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    const invalidProfile = assessModelProfileEligibility([{
      ...localProfile,
      limits: { ...localProfile.limits, maxInputTokens: value },
    }], requirement);
    const invalidRequirement = assessModelProfileEligibility([localProfile], {
      ...requirement,
      requiredOutputTokens: value,
    });
    assert.equal(invalidProfile.code, "invalid-profiles", `profile value=${String(value)}`);
    assert.equal(invalidRequirement.code, "invalid-requirement", `requirement value=${String(value)}`);
  }
});

test("assessment snapshots exact model identity and is not changed by later input mutation", () => {
  const mutableProfile = structuredClone(localProfile);
  const result = assessModelProfileEligibility([mutableProfile], requirement);
  mutableProfile.model.id = "mutated-after-assessment";
  mutableProfile.dataLocations[0] = "remote:mutated";

  assert.deepEqual(result.profiles[0]?.model, localProfile.model);
  assert.deepEqual(result.eligibleProfileIds, [localProfile.profileId]);
  assert.match(result.requirementFingerprint ?? "", /^[a-f0-9]{64}$/u);
  assert.match(result.profilesFingerprint ?? "", /^[a-f0-9]{64}$/u);
});

/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from "node:crypto";
export type ModelExecutionLocality = "local" | "remote";
export type ModelCapabilitySupport = "supported" | "unsupported";
export type ModelTokenizerEstimatorKind = "tokenizer" | "conservative-estimator";
export type ModelTaskSuitabilityStatus = "observed-supported" | "observed-unsupported";

export interface ModelTaskSuitabilityEvidence {
  status: ModelTaskSuitabilityStatus;
  evidenceRefs: string[];
}

export interface ModelCapabilityIdentity {
  api: string;
  provider: string;
  id: string;
  contextWindow: number;
}

export interface ModelCapabilityProfile {
  version: 1;
  profileId: string;
  model: ModelCapabilityIdentity;
  locality: ModelExecutionLocality;
  tokenizerEstimator: {
    id: string;
    kind: ModelTokenizerEstimatorKind;
  };
  structuredOutput: ModelCapabilitySupport;
  tools: ModelCapabilitySupport;
  limits: {
    maxInputTokens: number;
    maxOutputTokens: number;
  };
  /** Every location the profile may use; all must be allowed by the request. */
  dataLocations: string[];
  taskSuitability: Record<string, ModelTaskSuitabilityEvidence>;
}

export interface ModelEligibilityRequirement {
  version: 1;
  taskClass: string;
  localOnly: boolean;
  allowedDataLocations: string[];
  requiresStructuredOutput: boolean;
  requiresTools: boolean;
  requiredInputTokens: number;
  requiredOutputTokens: number;
}

export type ModelProfileEligibilityReasonCode =
  | "locality-not-local"
  | "data-location-not-allowed"
  | "task-suitability-unknown"
  | "task-suitability-unsupported"
  | "structured-output-unsupported"
  | "tools-unsupported"
  | "input-limit-exceeded"
  | "output-limit-exceeded"
  | "context-window-exceeded";

export interface ModelProfileEligibilityResult {
  profileId: string;
  eligible: boolean;
  reasonCodes: ModelProfileEligibilityReasonCode[];
  model: ModelCapabilityProfile["model"];
}

export type ModelProfileEligibilityCode =
  | "eligible-profiles"
  | "no-eligible-profiles"
  | "invalid-profiles"
  | "invalid-requirement";

export interface ModelProfileEligibilityAssessment {
  version: 1;
  code: ModelProfileEligibilityCode;
  eligible: boolean;
  executionAuthorized: false;
  requirementFingerprint: string | null;
  profilesFingerprint: string | null;
  eligibleProfileIds: string[];
  selectedProfileId?: never;
  profiles: ModelProfileEligibilityResult[];
  diagnosticCodes: string[];
}

interface ValidatedProfiles {
  profiles?: ModelCapabilityProfile[];
  diagnosticCodes: string[];
}

export function assessModelProfileEligibility(
  configuredProfiles: unknown,
  requirement: unknown,
): ModelProfileEligibilityAssessment {
  const normalizedRequirement = normalizeRequirement(requirement);
  if (!normalizedRequirement) {
    return invalidAssessment("invalid-requirement", ["malformed-model-eligibility-requirement"]);
  }

  const validatedProfiles = normalizeProfiles(configuredProfiles);
  if (!validatedProfiles.profiles) {
    return invalidAssessment("invalid-profiles", validatedProfiles.diagnosticCodes, fingerprint(normalizedRequirement));
  }

  const requirementFingerprint = fingerprint(normalizedRequirement);
  const profilesFingerprint = fingerprint(validatedProfiles.profiles);
  const assessments = validatedProfiles.profiles.map((profile) => assessProfile(profile, normalizedRequirement));
  const eligibleProfileIds = assessments
    .filter((assessment) => assessment.eligible)
    .map((assessment) => assessment.profileId);

  return {
    version: 1,
    code: eligibleProfileIds.length > 0 ? "eligible-profiles" : "no-eligible-profiles",
    eligible: eligibleProfileIds.length > 0,
    executionAuthorized: false,
    requirementFingerprint,
    profilesFingerprint,
    eligibleProfileIds,
    profiles: assessments,
    diagnosticCodes: [],
  };
}

function assessProfile(
  profile: ModelCapabilityProfile,
  requirement: ModelEligibilityRequirement,
): ModelProfileEligibilityResult {
  const reasons: ModelProfileEligibilityReasonCode[] = [];
  if (requirement.localOnly && profile.locality !== "local") reasons.push("locality-not-local");
  if (!profile.dataLocations.every((location) => requirement.allowedDataLocations.includes(location))) {
    reasons.push("data-location-not-allowed");
  }

  const suitability = profile.taskSuitability[requirement.taskClass];
  if (!suitability) reasons.push("task-suitability-unknown");
  else if (suitability.status !== "observed-supported") reasons.push("task-suitability-unsupported");

  if (requirement.requiresStructuredOutput && profile.structuredOutput !== "supported") {
    reasons.push("structured-output-unsupported");
  }
  if (requirement.requiresTools && profile.tools !== "supported") reasons.push("tools-unsupported");
  if (requirement.requiredInputTokens > profile.limits.maxInputTokens) reasons.push("input-limit-exceeded");
  if (requirement.requiredOutputTokens > profile.limits.maxOutputTokens) reasons.push("output-limit-exceeded");
  if (requirement.requiredInputTokens + requirement.requiredOutputTokens > profile.model.contextWindow) {
    reasons.push("context-window-exceeded");
  }

  return {
    profileId: profile.profileId,
    eligible: reasons.length === 0,
    reasonCodes: reasons,
    model: { ...profile.model },
  };
}

function normalizeProfiles(value: unknown): ValidatedProfiles {
  if (!isDenseArray(value)) return { diagnosticCodes: ["profiles-not-dense-array"] };

  const normalized: ModelCapabilityProfile[] = [];
  const diagnostics: string[] = [];
  const profileIds = new Set<string>();
  for (const candidate of value) {
    const result = normalizeProfile(candidate);
    if (!result.profile) {
      diagnostics.push(...result.diagnosticCodes);
      continue;
    }
    if (profileIds.has(result.profile.profileId)) diagnostics.push("duplicate-profile-id");
    profileIds.add(result.profile.profileId);
    normalized.push(result.profile);
  }

  if (diagnostics.length > 0) return { diagnosticCodes: [...new Set(diagnostics)].sort() };
  normalized.sort((left, right) => compareCodeUnits(left.profileId, right.profileId));
  return { profiles: normalized, diagnosticCodes: [] };
}

function normalizeProfile(value: unknown): { profile?: ModelCapabilityProfile; diagnosticCodes: string[] } {
  if (!isRecord(value)) return { diagnosticCodes: ["malformed-profile"] };
  const model = value.model;
  const estimator = value.tokenizerEstimator;
  const limits = value.limits;
  if (value.version !== 1
    || !isIdentifier(value.profileId)
    || !isRecord(model)
    || !isIdentifier(model.api)
    || !isIdentifier(model.provider)
    || !isIdentifier(model.id)
    || !isPositiveSafeInteger(model.contextWindow)
    || (value.locality !== "local" && value.locality !== "remote")
    || !isRecord(estimator)
    || !isIdentifier(estimator.id)
    || (estimator.kind !== "tokenizer" && estimator.kind !== "conservative-estimator")
    || (value.structuredOutput !== "supported" && value.structuredOutput !== "unsupported")
    || (value.tools !== "supported" && value.tools !== "unsupported")
    || !isRecord(limits)
    || !isPositiveSafeInteger(limits.maxInputTokens)
    || !isPositiveSafeInteger(limits.maxOutputTokens)
    || !isDenseUniqueStringArray(value.dataLocations, false)
    || !isRecord(value.taskSuitability)) {
    return { diagnosticCodes: ["malformed-profile"] };
  }

  if (limits.maxInputTokens + limits.maxOutputTokens > model.contextWindow) {
    return { diagnosticCodes: ["profile-limits-exceed-context-window"] };
  }

  const taskSuitability: Record<string, ModelTaskSuitabilityEvidence> = {};
  for (const [taskClass, evidence] of Object.entries(value.taskSuitability)) {
    if (!isIdentifier(taskClass)
      || !isRecord(evidence)
      || (evidence.status !== "observed-supported" && evidence.status !== "observed-unsupported")
      || !isDenseUniqueStringArray(evidence.evidenceRefs, false)) {
      return { diagnosticCodes: ["malformed-task-suitability"] };
    }
    taskSuitability[taskClass] = {
      status: evidence.status,
      evidenceRefs: [...evidence.evidenceRefs].sort(),
    };
  }

  return {
    diagnosticCodes: [],
    profile: {
      version: 1,
      profileId: value.profileId,
      model: {
        api: model.api,
        provider: model.provider,
        id: model.id,
        contextWindow: model.contextWindow,
      },
      locality: value.locality,
      tokenizerEstimator: { id: estimator.id, kind: estimator.kind },
      structuredOutput: value.structuredOutput,
      tools: value.tools,
      limits: { maxInputTokens: limits.maxInputTokens, maxOutputTokens: limits.maxOutputTokens },
      dataLocations: [...value.dataLocations].sort(),
      taskSuitability: Object.fromEntries(Object.entries(taskSuitability).sort(([left], [right]) => compareCodeUnits(left, right))),
    },
  };
}

function normalizeRequirement(value: unknown): ModelEligibilityRequirement | undefined {
  if (!isRecord(value)
    || value.version !== 1
    || !isIdentifier(value.taskClass)
    || typeof value.localOnly !== "boolean"
    || !isDenseUniqueStringArray(value.allowedDataLocations, false)
    || typeof value.requiresStructuredOutput !== "boolean"
    || typeof value.requiresTools !== "boolean"
    || !isPositiveSafeInteger(value.requiredInputTokens)
    || !isPositiveSafeInteger(value.requiredOutputTokens)) {
    return undefined;
  }
  return {
    version: 1,
    taskClass: value.taskClass,
    localOnly: value.localOnly,
    allowedDataLocations: [...value.allowedDataLocations].sort(),
    requiresStructuredOutput: value.requiresStructuredOutput,
    requiresTools: value.requiresTools,
    requiredInputTokens: value.requiredInputTokens,
    requiredOutputTokens: value.requiredOutputTokens,
  };
}

function invalidAssessment(
  code: Extract<ModelProfileEligibilityCode, "invalid-profiles" | "invalid-requirement">,
  diagnosticCodes: string[],
  requirementFingerprint: string | null = null,
): ModelProfileEligibilityAssessment {
  return {
    version: 1,
    code,
    eligible: false,
    executionAuthorized: false,
    requirementFingerprint,
    profilesFingerprint: null,
    eligibleProfileIds: [],
    profiles: [],
    diagnosticCodes: [...new Set(diagnosticCodes)].sort(),
  };
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDenseArray(value: unknown): value is unknown[] {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return false;
  }
  return true;
}

function isDenseUniqueStringArray(value: unknown, allowEmpty: boolean): value is string[] {
  if (!isDenseArray(value) || (!allowEmpty && value.length === 0)) return false;
  if (!value.every(isIdentifier)) return false;
  return new Set(value).size === value.length;
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value === value.trim();
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

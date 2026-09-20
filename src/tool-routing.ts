/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from "node:crypto";
import {
  assessProviderRequestAdmission,
  type ProviderAdmissionDecision,
  type ProviderAdmissionModel,
  type ProviderAdmissionPolicy,
} from "./provider-admission.js";
import type { RuntimeToolEnvelopeProfile } from "./tool-requests.js";

export type ToolRoute = "direct" | "current-agent" | "isolated" | "blocked";
export type ToolRouteAuthority = "allowed" | "denied" | "unknown";
export type ToolIsolationRequirement = "capability" | "focus" | "evidence-independence";
export type ToolRouteModelLegRole = "request" | "worker" | "caller-continuation";

export interface ToolRouteRequestBasis {
  requestId: string;
  taskId?: string;
  attemptId?: string;
  toolNames: string[];
  content: unknown;
}

export interface ToolRouteDirectEvidence {
  exactArgumentsAvailable: boolean;
  argumentsValidated: boolean;
  adapterId?: string;
}

export interface ToolRouteModelLegInput {
  id: string;
  role: ToolRouteModelLegRole;
  payload: unknown;
  model: ProviderAdmissionModel;
  policy: ProviderAdmissionPolicy;
  /** Conservative bytes/tokens upper bound not already serialized in payload. Null is unknown. */
  additionalContextBytes: number | null;
  repeatCount: number;
}

export interface ToolRouteModelCandidateInput {
  available: boolean;
  legs: ToolRouteModelLegInput[];
}

export interface ToolRouteAssessmentInput {
  request: ToolRouteRequestBasis;
  profile: RuntimeToolEnvelopeProfile;
  authority: ToolRouteAuthority;
  direct?: ToolRouteDirectEvidence;
  currentAgent?: ToolRouteModelCandidateInput;
  isolated?: ToolRouteModelCandidateInput;
  isolationRequirement?: ToolIsolationRequirement;
}

export interface ToolRouteLegAssessment {
  id: string;
  feasible: boolean;
  reasonCode: string;
  repeatCount: number | null;
  provider: ProviderAdmissionDecision;
  additionalContextBytes: number | null;
  requiredPerCallUpperBound: number | null;
  aggregateUpperBound: number | null;
}

export interface ToolRouteCandidateAssessment {
  feasible: boolean;
  reasonCodes: string[];
  estimatedOverheadUpperBound: number | null;
  modelCallCount: number | null;
  legs: ToolRouteLegAssessment[];
}

export interface ToolRouteDirectAssessment {
  feasible: boolean;
  reasonCodes: string[];
  adapterId?: string;
  estimatedOverheadUpperBound: number | null;
  modelCallCount: 0;
}

export interface ToolRouteAssessment {
  version: 1;
  route: ToolRoute;
  reasonCode: string;
  executionAuthorized: false;
  requestId: string;
  requestFingerprint: string | null;
  evidenceFingerprint: string | null;
  profileFingerprint: string | null;
  authority: ToolRouteAuthority;
  isolationRequirement?: ToolIsolationRequirement;
  selectedEstimatedOverheadUpperBound: number | null;
  direct: ToolRouteDirectAssessment;
  currentAgent: ToolRouteCandidateAssessment;
  isolated: ToolRouteCandidateAssessment;
}

const unavailableCandidate = (reasonCode: string): ToolRouteCandidateAssessment => ({
  feasible: false,
  reasonCodes: [reasonCode],
  estimatedOverheadUpperBound: null,
  modelCallCount: null,
  legs: [],
});

export function assessToolRoute(input: ToolRouteAssessmentInput): ToolRouteAssessment {
  const rawInput: Record<string, unknown> = isRecord(input as unknown)
    ? input as unknown as Record<string, unknown>
    : {};
  const rawRequest = rawInput.request;
  const rawProfile = rawInput.profile;
  const rawAuthority = rawInput.authority;
  const rawIsolationRequirement = rawInput.isolationRequirement;
  const authority = normalizeAuthority(rawAuthority);
  const isolationRequirement = normalizeIsolationRequirement(rawIsolationRequirement);
  const direct = assessDirect(rawInput.direct);
  const currentAgent = assessModelCandidate(rawInput.currentAgent, "current-agent");
  const isolated = assessModelCandidate(rawInput.isolated, "isolated");
  const requestFingerprint = fingerprintValue(rawRequest);
  const evidenceFingerprint = fingerprintValue(input);
  const base = {
    version: 1 as const,
    executionAuthorized: false as const,
    requestId: isRecord(rawRequest) && typeof rawRequest.requestId === "string" ? rawRequest.requestId : "",
    requestFingerprint,
    evidenceFingerprint,
    profileFingerprint: normalizeFingerprint(isRecord(rawProfile) ? rawProfile.fingerprint : undefined),
    authority,
    isolationRequirement,
    direct,
    currentAgent,
    isolated,
  };

  if (!requestFingerprint
    || !evidenceFingerprint
    || !validRequestBasis(rawRequest)
    || !isKnownAuthority(rawAuthority)
    || !isValidIsolationRequirement(rawIsolationRequirement)) {
    return blocked(base, "invalid-assessment-evidence");
  }
  if (authority !== "allowed") return blocked(base, `authority-${authority}`);
  if (!validProfile(rawProfile, rawRequest.toolNames)) {
    return blocked(base, isRecord(rawProfile) && rawProfile.footprint === "unknown" ? "tool-profile-unknown" : "invalid-tool-profile");
  }

  const authorizedDirect = assessDirect(rawInput.direct, true);
  base.direct = authorizedDirect;
  if (authorizedDirect.feasible) {
    return {
      ...base,
      route: "direct",
      reasonCode: "direct-supported",
      selectedEstimatedOverheadUpperBound: 0,
    };
  }

  if (isolationRequirement) {
    return isolated.feasible
      ? {
          ...base,
          direct: authorizedDirect,
          route: "isolated",
          reasonCode: "isolation-required",
          selectedEstimatedOverheadUpperBound: isolated.estimatedOverheadUpperBound,
        }
      : blocked({ ...base, direct: authorizedDirect }, "isolation-required-unavailable");
  }

  if (currentAgent.feasible && isolated.feasible) {
    const currentCost = currentAgent.estimatedOverheadUpperBound as number;
    const isolatedCost = isolated.estimatedOverheadUpperBound as number;
    const route = currentCost <= isolatedCost ? "current-agent" : "isolated";
    return {
      ...base,
      direct: authorizedDirect,
      route,
      reasonCode: route === "current-agent" ? "least-overhead-current-agent" : "least-overhead-isolated",
      selectedEstimatedOverheadUpperBound: route === "current-agent" ? currentCost : isolatedCost,
    };
  }
  if (currentAgent.feasible) {
    return {
      ...base,
      direct: authorizedDirect,
      route: "current-agent",
      reasonCode: "only-current-agent-feasible",
      selectedEstimatedOverheadUpperBound: currentAgent.estimatedOverheadUpperBound,
    };
  }
  if (isolated.feasible) {
    return {
      ...base,
      direct: authorizedDirect,
      route: "isolated",
      reasonCode: "only-isolated-feasible",
      selectedEstimatedOverheadUpperBound: isolated.estimatedOverheadUpperBound,
    };
  }
  return blocked({ ...base, direct: authorizedDirect }, "no-feasible-route");
}

function blocked(
  base: Omit<ToolRouteAssessment, "route" | "reasonCode" | "selectedEstimatedOverheadUpperBound">,
  reasonCode: string,
): ToolRouteAssessment {
  return { ...base, route: "blocked", reasonCode, selectedEstimatedOverheadUpperBound: null };
}

function assessDirect(evidence: unknown, authorityConfirmed = false): ToolRouteDirectAssessment {
  const record = isRecord(evidence) ? evidence : undefined;
  const reasons: string[] = [];
  if (!authorityConfirmed) reasons.push("authority-not-confirmed");
  if (record?.exactArgumentsAvailable !== true) reasons.push("exact-arguments-unavailable");
  if (record?.argumentsValidated !== true) reasons.push("arguments-not-validated");
  const adapterId = typeof record?.adapterId === "string" && record.adapterId.trim().length > 0
    ? record.adapterId.trim()
    : undefined;
  if (!adapterId) reasons.push("direct-adapter-unavailable");
  return {
    feasible: reasons.length === 0,
    reasonCodes: reasons,
    adapterId,
    estimatedOverheadUpperBound: reasons.length === 0 ? 0 : null,
    modelCallCount: 0,
  };
}

function assessModelCandidate(candidate: unknown, route: "current-agent" | "isolated"): ToolRouteCandidateAssessment {
  if (!isRecord(candidate)) return unavailableCandidate("candidate-evidence-missing");
  if (candidate.available !== true) return unavailableCandidate("candidate-capability-unavailable");
  if (!Array.isArray(candidate.legs) || candidate.legs.length === 0) return unavailableCandidate("candidate-legs-missing");

  const reasonCodes: string[] = [];
  const legs: ToolRouteLegAssessment[] = [];
  const seenIds = new Set<string>();
  const seenRoles = new Set<ToolRouteModelLegRole>();
  let total = 0;
  let modelCallCount = 0;
  let aggregateValid = true;

  for (const [index, rawLeg] of candidate.legs.entries()) {
    const leg = isRecord(rawLeg) ? rawLeg : {};
    const id = typeof leg.id === "string" && leg.id.trim().length > 0 ? leg.id.trim() : `invalid-leg-${index + 1}`;
    const role = normalizeLegRole(leg.role);
    let reasonCode = "accepted";
    if (!(typeof leg.id === "string" && leg.id.trim().length > 0)) reasonCode = "invalid-leg-id";
    else if (!role || !roleAllowedForRoute(role, route)) reasonCode = "invalid-leg-role";
    else if (seenIds.has(id)) reasonCode = "duplicate-leg-id";
    else if (seenRoles.has(role)) reasonCode = `duplicate-leg-role:${role}`;
    seenIds.add(id);
    if (role) seenRoles.add(role);
    const provider = safelyAssessProviderRequest(leg.payload, leg.model, leg.policy);
    let requiredPerCall: number | null = null;
    let aggregate: number | null = null;
    const repeatCount = isPositiveSafeInteger(leg.repeatCount) ? leg.repeatCount : null;
    const additionalContextBytes = isNonNegativeSafeInteger(leg.additionalContextBytes) ? leg.additionalContextBytes : null;

    if (reasonCode === "accepted" && leg.additionalContextBytes === null) reasonCode = "additional-context-unknown";
    else if (reasonCode === "accepted" && !isNonNegativeSafeInteger(leg.additionalContextBytes)) reasonCode = "invalid-additional-context";
    else if (reasonCode === "accepted" && repeatCount === null) reasonCode = "invalid-repeat-count";
    else if (reasonCode === "accepted" && !provider.accepted) reasonCode = `provider-${provider.code}`;
    else if (reasonCode === "accepted") {
      requiredPerCall = safeAdd(provider.requiredEnvelopeTokensUpperBound as number, additionalContextBytes as number) ?? null;
      if (requiredPerCall === null) reasonCode = "envelope-overflow";
      else if (requiredPerCall > (provider.effectiveLimitTokens as number)) reasonCode = "additional-context-exceeds-limit";
      else {
        aggregate = safeMultiply(requiredPerCall, repeatCount as number) ?? null;
        if (aggregate === null) reasonCode = "aggregate-overflow";
      }
    }

    const feasible = reasonCode === "accepted";
    if (!feasible) {
      reasonCodes.push(`${id}:${reasonCode}`);
      aggregateValid = false;
    } else {
      const nextTotal = safeAdd(total, aggregate as number);
      const nextCalls = safeAdd(modelCallCount, repeatCount as number);
      if (nextTotal === undefined || nextCalls === undefined) {
        reasonCodes.push(`${id}:candidate-aggregate-overflow`);
        aggregateValid = false;
      } else {
        total = nextTotal;
        modelCallCount = nextCalls;
      }
    }
    legs.push({
      id,
      feasible,
      reasonCode,
      repeatCount,
      provider,
      additionalContextBytes,
      requiredPerCallUpperBound: requiredPerCall,
      aggregateUpperBound: aggregate,
    });
  }

  const requiredRoles: ToolRouteModelLegRole[] = route === "current-agent"
    ? ["request"]
    : ["worker", "caller-continuation"];
  for (const role of requiredRoles) {
    if (!seenRoles.has(role)) {
      reasonCodes.push(`${role}-leg-missing`);
      aggregateValid = false;
    }
  }

  return {
    feasible: aggregateValid && reasonCodes.length === 0,
    reasonCodes,
    estimatedOverheadUpperBound: aggregateValid && reasonCodes.length === 0 ? total : null,
    modelCallCount: aggregateValid && reasonCodes.length === 0 ? modelCallCount : null,
    legs,
  };
}

function validRequestBasis(request: unknown): request is ToolRouteRequestBasis {
  if (!isRecord(request) || typeof request.requestId !== "string" || request.requestId.trim().length === 0) return false;
  if (!Array.isArray(request.toolNames) || request.toolNames.length === 0) return false;
  const normalized = normalizeNames(request.toolNames);
  return normalized !== undefined && normalized.length === request.toolNames.length;
}

function validProfile(profile: unknown, requestedToolNames: string[]): profile is RuntimeToolEnvelopeProfile {
  if (!isRecord(profile)
    || profile.version !== 1
    || (profile.footprint !== "selected" && profile.footprint !== "whole-catalog")) return false;
  if (!isNonNegativeSafeInteger(profile.byteSize) || typeof profile.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(profile.fingerprint)) return false;
  if (!Array.isArray(profile.toolNames)) return false;
  const profileNames = normalizeNames(profile.toolNames);
  const requested = normalizeNames(requestedToolNames);
  if (!profileNames || !requested) return false;
  const available = new Set(profileNames);
  return requested.every((name) => available.has(name));
}

function normalizeNames(values: unknown): string[] | undefined {
  if (!Array.isArray(values)) return undefined;
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string" || value.trim().length === 0) return undefined;
    const name = value.trim();
    if (seen.has(name)) return undefined;
    seen.add(name);
    normalized.push(name);
  }
  return normalized;
}

function normalizeAuthority(value: unknown): ToolRouteAuthority {
  return isKnownAuthority(value) ? value : "unknown";
}

function isKnownAuthority(value: unknown): value is ToolRouteAuthority {
  return value === "allowed" || value === "denied" || value === "unknown";
}

function normalizeIsolationRequirement(value: unknown): ToolIsolationRequirement | undefined {
  return value === "capability" || value === "focus" || value === "evidence-independence" ? value : undefined;
}

function isValidIsolationRequirement(value: unknown): boolean {
  return value === undefined || normalizeIsolationRequirement(value) !== undefined;
}

function normalizeLegRole(value: unknown): ToolRouteModelLegRole | undefined {
  return value === "request" || value === "worker" || value === "caller-continuation" ? value : undefined;
}

function roleAllowedForRoute(role: ToolRouteModelLegRole, route: "current-agent" | "isolated"): boolean {
  return route === "current-agent" ? role === "request" : role === "worker" || role === "caller-continuation";
}

function normalizeFingerprint(value: unknown): string | null {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value) ? value : null;
}

function safelyAssessProviderRequest(payload: unknown, model: unknown, policy: unknown): ProviderAdmissionDecision {
  if (!isRecord(policy)) return invalidProviderDecision("Provider admission policy evidence is missing or malformed.");
  try {
    return assessProviderRequestAdmission({
      payload,
      model: isRecord(model) ? model : undefined,
      policy: policy as unknown as ProviderAdmissionPolicy,
    });
  } catch {
    return invalidProviderDecision("Provider admission evidence could not be assessed safely.");
  }
}

function invalidProviderDecision(message: string): ProviderAdmissionDecision {
  return { accepted: false, code: "invalid_policy", message, estimator: "serialized_utf8_bytes_upper_bound" };
}

function safeAdd(left: number, right: number): number | undefined {
  const sum = left + right;
  return Number.isSafeInteger(sum) ? sum : undefined;
}

function safeMultiply(left: number, right: number): number | undefined {
  const product = left * right;
  return Number.isSafeInteger(product) ? product : undefined;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fingerprintValue(value: unknown): string | null {
  try {
    return createHash("sha256").update(canonicalize(value, new Set<object>()), "utf8").digest("hex");
  } catch {
    return null;
  }
}

function canonicalize(value: unknown, ancestors: Set<object>): string {
  if (value === undefined) return "u:";
  if (value === null) return "l:";
  if (typeof value === "string") return `s:${JSON.stringify(value)}`;
  if (typeof value === "boolean") return `b:${value ? "1" : "0"}`;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non-finite number");
    return `n:${Object.is(value, -0) ? "-0" : String(value)}`;
  }
  if (typeof value === "bigint" || typeof value === "symbol" || typeof value === "function") throw new Error("unsupported value");
  if (typeof value !== "object") throw new Error("unsupported value");
  if (ancestors.has(value)) throw new Error("cyclic value");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const items = Array.from({ length: value.length }, (_, index) => Object.prototype.hasOwnProperty.call(value, index)
        ? canonicalize(value[index], ancestors)
        : "h:");
      return `a:[${items.join(",")}]`;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new Error("non-plain object");
    if (Object.getOwnPropertySymbols(value).length > 0) throw new Error("symbol keys");
    const entries = Object.keys(value as Record<string, unknown>)
      .sort((left, right) => Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")))
      .map((key) => `${JSON.stringify(key)}:${canonicalize((value as Record<string, unknown>)[key], ancestors)}`);
    return `o:{${entries.join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

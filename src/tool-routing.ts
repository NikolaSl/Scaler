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
  const direct = assessDirect(input.direct);
  const currentAgent = assessModelCandidate(input.currentAgent);
  const isolated = assessModelCandidate(input.isolated);
  const requestFingerprint = fingerprintValue(input.request);
  const evidenceFingerprint = fingerprintValue(input);
  const base = {
    version: 1 as const,
    executionAuthorized: false as const,
    requestId: typeof input.request?.requestId === "string" ? input.request.requestId : "",
    requestFingerprint,
    evidenceFingerprint,
    profileFingerprint: input.profile?.fingerprint ?? null,
    authority: input.authority,
    isolationRequirement: input.isolationRequirement,
    direct,
    currentAgent,
    isolated,
  };

  if (!requestFingerprint || !evidenceFingerprint || !validRequestBasis(input.request)) {
    return blocked(base, "invalid-assessment-evidence");
  }
  if (input.authority !== "allowed") return blocked(base, `authority-${input.authority}`);
  if (!validProfile(input.profile, input.request.toolNames)) {
    return blocked(base, input.profile?.footprint === "unknown" ? "tool-profile-unknown" : "invalid-tool-profile");
  }

  const authorizedDirect = assessDirect(input.direct, true);
  base.direct = authorizedDirect;
  if (authorizedDirect.feasible) {
    return {
      ...base,
      route: "direct",
      reasonCode: "direct-supported",
      selectedEstimatedOverheadUpperBound: 0,
    };
  }

  if (input.isolationRequirement) {
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

function assessDirect(evidence: ToolRouteDirectEvidence | undefined, authorityConfirmed = false): ToolRouteDirectAssessment {
  const reasons: string[] = [];
  if (!authorityConfirmed) reasons.push("authority-not-confirmed");
  if (evidence?.exactArgumentsAvailable !== true) reasons.push("exact-arguments-unavailable");
  if (evidence?.argumentsValidated !== true) reasons.push("arguments-not-validated");
  const adapterId = typeof evidence?.adapterId === "string" && evidence.adapterId.trim().length > 0
    ? evidence.adapterId.trim()
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

function assessModelCandidate(candidate: ToolRouteModelCandidateInput | undefined): ToolRouteCandidateAssessment {
  if (!candidate) return unavailableCandidate("candidate-evidence-missing");
  if (candidate.available !== true) return unavailableCandidate("candidate-capability-unavailable");
  if (!Array.isArray(candidate.legs) || candidate.legs.length === 0) return unavailableCandidate("candidate-legs-missing");

  const reasonCodes: string[] = [];
  const legs: ToolRouteLegAssessment[] = [];
  const seenIds = new Set<string>();
  let total = 0;
  let modelCallCount = 0;
  let aggregateValid = true;

  for (const leg of candidate.legs) {
    const id = typeof leg?.id === "string" && leg.id.trim().length > 0 ? leg.id.trim() : "invalid-leg";
    let reasonCode = "accepted";
    if (seenIds.has(id)) reasonCode = "duplicate-leg-id";
    seenIds.add(id);
    const provider = assessProviderRequestAdmission({ payload: leg?.payload, model: leg?.model, policy: leg?.policy });
    let requiredPerCall: number | null = null;
    let aggregate: number | null = null;
    const repeatCount = isPositiveSafeInteger(leg?.repeatCount) ? leg.repeatCount : null;

    if (reasonCode === "accepted" && leg?.additionalContextBytes === null) reasonCode = "additional-context-unknown";
    else if (reasonCode === "accepted" && !isNonNegativeSafeInteger(leg?.additionalContextBytes)) reasonCode = "invalid-additional-context";
    else if (reasonCode === "accepted" && repeatCount === null) reasonCode = "invalid-repeat-count";
    else if (reasonCode === "accepted" && !provider.accepted) reasonCode = `provider-${provider.code}`;
    else if (reasonCode === "accepted") {
      requiredPerCall = safeAdd(provider.requiredEnvelopeTokensUpperBound as number, leg.additionalContextBytes as number) ?? null;
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
      additionalContextBytes: leg?.additionalContextBytes ?? null,
      requiredPerCallUpperBound: requiredPerCall,
      aggregateUpperBound: aggregate,
    });
  }

  return {
    feasible: aggregateValid && reasonCodes.length === 0,
    reasonCodes,
    estimatedOverheadUpperBound: aggregateValid && reasonCodes.length === 0 ? total : null,
    modelCallCount: aggregateValid && reasonCodes.length === 0 ? modelCallCount : null,
    legs,
  };
}

function validRequestBasis(request: ToolRouteRequestBasis): boolean {
  if (!request || typeof request.requestId !== "string" || request.requestId.trim().length === 0) return false;
  if (!Array.isArray(request.toolNames) || request.toolNames.length === 0) return false;
  const normalized = normalizeNames(request.toolNames);
  return normalized !== undefined && normalized.length === request.toolNames.length;
}

function validProfile(profile: RuntimeToolEnvelopeProfile, requestedToolNames: string[]): boolean {
  if (!profile || profile.version !== 1 || profile.footprint === "unknown") return false;
  if (!isNonNegativeSafeInteger(profile.byteSize) || typeof profile.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(profile.fingerprint)) return false;
  const profileNames = normalizeNames(profile.toolNames);
  const requested = normalizeNames(requestedToolNames);
  if (!profileNames || !requested) return false;
  const available = new Set(profileNames);
  return requested.every((name) => available.has(name));
}

function normalizeNames(values: unknown[]): string[] | undefined {
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

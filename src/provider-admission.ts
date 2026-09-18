/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

export const providerAdmissionEnvironmentKeys = [
  "SCALER_PROVIDER_ADMISSION",
  "SCALER_REQUEST_TOKEN_ALLOWANCE",
  "SCALER_OUTPUT_RESERVE_TOKENS",
  "SCALER_REQUEST_MARGIN_TOKENS",
] as const;

export interface ProviderAdmissionPolicy {
  requestTokenAllowance: number;
  outputReserveTokens: number;
  safetyMarginTokens: number;
}

export const defaultProviderOutputReserveTokens = 1_024;
export const defaultProviderSafetyMarginTokens = 1_024;

export function createStrictProviderAdmissionPolicy(requestTokenAllowance: number): ProviderAdmissionPolicy {
  return {
    requestTokenAllowance,
    outputReserveTokens: defaultProviderOutputReserveTokens,
    safetyMarginTokens: defaultProviderSafetyMarginTokens,
  };
}

export interface ProviderAdmissionModel {
  api?: unknown;
  provider?: unknown;
  id?: unknown;
  contextWindow?: unknown;
}

export type ProviderAdmissionCode =
  | "accepted"
  | "invalid_policy"
  | "invalid_model"
  | "unsupported_api"
  | "invalid_payload"
  | "unsupported_content"
  | "invalid_output_limit"
  | "conflicting_output_limits"
  | "insufficient_output_reserve"
  | "envelope_exceeds_limit";

export interface ProviderAdmissionDecision {
  accepted: boolean;
  code: ProviderAdmissionCode;
  message: string;
  estimator: "serialized_utf8_bytes_upper_bound";
  payloadBytes?: number;
  outputLimitTokens?: number;
  outputReserveTokens?: number;
  safetyMarginTokens?: number;
  requiredEnvelopeTokensUpperBound?: number;
  taskAllowanceTokens?: number;
  modelContextWindowTokens?: number;
  effectiveLimitTokens?: number;
  modelId?: string;
  provider?: string;
  api?: string;
}

export interface ProviderAdmissionInput {
  payload: unknown;
  model: ProviderAdmissionModel | undefined;
  policy: ProviderAdmissionPolicy;
}

export interface ProviderAdmissionPolicyParseResult {
  accepted: boolean;
  message: string;
  policy?: ProviderAdmissionPolicy;
}

const estimator = "serialized_utf8_bytes_upper_bound" as const;

export function validateProviderAdmissionPolicy(policy: ProviderAdmissionPolicy): string[] {
  const diagnostics: string[] = [];
  if (!isPositiveSafeInteger(policy.requestTokenAllowance)) diagnostics.push("request token allowance must be a positive safe integer");
  if (!isPositiveSafeInteger(policy.outputReserveTokens)) diagnostics.push("output reserve must be a positive safe integer");
  if (!isNonNegativeSafeInteger(policy.safetyMarginTokens)) diagnostics.push("safety margin must be a non-negative safe integer");
  return diagnostics;
}

export function readProviderAdmissionPolicyFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): ProviderAdmissionPolicyParseResult {
  if (environment.SCALER_PROVIDER_ADMISSION !== "strict") {
    return { accepted: false, message: "Strict provider admission marker is missing or invalid." };
  }
  const policy = {
    requestTokenAllowance: parseStrictInteger(environment.SCALER_REQUEST_TOKEN_ALLOWANCE),
    outputReserveTokens: parseStrictInteger(environment.SCALER_OUTPUT_RESERVE_TOKENS),
    safetyMarginTokens: parseStrictInteger(environment.SCALER_REQUEST_MARGIN_TOKENS),
  };
  const diagnostics = validateProviderAdmissionPolicy(policy);
  return diagnostics.length > 0
    ? { accepted: false, message: `Invalid strict provider admission policy: ${diagnostics.join("; ")}.` }
    : { accepted: true, message: "Strict provider admission policy loaded.", policy };
}

export function assessProviderRequestAdmission(input: ProviderAdmissionInput): ProviderAdmissionDecision {
  const policyDiagnostics = validateProviderAdmissionPolicy(input.policy);
  if (policyDiagnostics.length > 0) {
    return reject("invalid_policy", `Invalid provider admission policy: ${policyDiagnostics.join("; ")}.`);
  }

  const api = typeof input.model?.api === "string" ? input.model.api : undefined;
  const provider = typeof input.model?.provider === "string" ? input.model.provider : undefined;
  const modelId = typeof input.model?.id === "string" ? input.model.id : undefined;
  const contextWindow = input.model?.contextWindow;
  const modelDetails = { api, provider, modelId };
  if (!isPositiveSafeInteger(contextWindow)) {
    return reject("invalid_model", "Provider admission requires a positive safe-integer model context window.", modelDetails);
  }
  if (api !== "openai-completions") {
    return reject("unsupported_api", `Strict provider admission does not support API ${api ?? "unknown"}.`, {
      ...modelDetails,
      modelContextWindowTokens: contextWindow,
    });
  }
  if (!isRecord(input.payload) || !Array.isArray(input.payload.messages) || input.payload.messages.length === 0) {
    return reject("invalid_payload", "Provider payload must contain a non-empty messages array.", modelDetails);
  }
  if (!input.payload.messages.every(isSupportedTextMessage)) {
    return reject("unsupported_content", "Strict provider admission supports text and tool-call messages only.", modelDetails);
  }
  const hasCompletionLimit = Object.hasOwn(input.payload, "max_completion_tokens");
  const hasLegacyLimit = Object.hasOwn(input.payload, "max_tokens");
  if (hasCompletionLimit && hasLegacyLimit) {
    return reject("conflicting_output_limits", "Provider payload contains conflicting output-limit fields.", modelDetails);
  }
  const outputLimit = hasCompletionLimit ? input.payload.max_completion_tokens : input.payload.max_tokens;
  if (!isPositiveSafeInteger(outputLimit)) {
    return reject("invalid_output_limit", "Provider payload output limit must be a positive safe integer.", modelDetails);
  }
  if (outputLimit < input.policy.outputReserveTokens) {
    return reject("insufficient_output_reserve", `Provider reduced output capacity below the required ${input.policy.outputReserveTokens}-token reserve.`, {
      ...modelDetails,
      outputLimitTokens: outputLimit,
      outputReserveTokens: input.policy.outputReserveTokens,
    });
  }

  let serialized: string;
  try {
    serialized = JSON.stringify(input.payload);
  } catch {
    return reject("invalid_payload", "Provider payload could not be serialized deterministically.", modelDetails);
  }
  const payloadBytes = Buffer.byteLength(serialized, "utf8");
  const requiredEnvelope = safeSum(payloadBytes, outputLimit, input.policy.safetyMarginTokens);
  if (requiredEnvelope === undefined) {
    return reject("invalid_payload", "Provider envelope estimate exceeds the safe integer range.", modelDetails);
  }
  const effectiveLimit = Math.min(input.policy.requestTokenAllowance, contextWindow);
  const measurements = {
    ...modelDetails,
    payloadBytes,
    outputLimitTokens: outputLimit,
    outputReserveTokens: input.policy.outputReserveTokens,
    safetyMarginTokens: input.policy.safetyMarginTokens,
    requiredEnvelopeTokensUpperBound: requiredEnvelope,
    taskAllowanceTokens: input.policy.requestTokenAllowance,
    modelContextWindowTokens: contextWindow,
    effectiveLimitTokens: effectiveLimit,
  };
  if (requiredEnvelope > effectiveLimit) {
    return reject("envelope_exceeds_limit", `Provider envelope upper bound ${requiredEnvelope} exceeds effective limit ${effectiveLimit}.`, measurements);
  }
  return {
    accepted: true,
    code: "accepted",
    message: `Provider envelope upper bound ${requiredEnvelope} is within effective limit ${effectiveLimit}.`,
    estimator,
    ...measurements,
  };
}

function reject(
  code: Exclude<ProviderAdmissionCode, "accepted">,
  message: string,
  details: Partial<ProviderAdmissionDecision> = {},
): ProviderAdmissionDecision {
  return { accepted: false, code, message, estimator, ...details };
}

function isSupportedTextMessage(value: unknown): boolean {
  if (!isRecord(value) || typeof value.role !== "string") return false;
  const content = value.content;
  if (typeof content === "string" || content === null) return true;
  if (!Array.isArray(content)) return false;
  return content.every((part) => isRecord(part)
    && (part.type === "text" || part.type === "input_text" || part.type === "output_text")
    && typeof part.text === "string");
}

function safeSum(...values: number[]): number | undefined {
  const result = values.reduce((sum, value) => sum + value, 0);
  return Number.isSafeInteger(result) ? result : undefined;
}

function parseStrictInteger(value: string | undefined): number {
  if (value === undefined || !/^(0|[1-9]\d*)$/.test(value)) return Number.NaN;
  return Number(value);
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

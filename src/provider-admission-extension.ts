/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  assessProviderRequestAdmission,
  providerAdmissionModelMatches,
  readProviderAdmissionModelBindingFromEnvironment,
  readProviderAdmissionPolicyFromEnvironment,
  type ProviderAdmissionDecision,
  type ProviderAdmissionModel,
  type ProviderAdmissionRecord,
} from "./provider-admission.js";

type ProviderAdmissionRecordSink = (record: ProviderAdmissionRecord) => void | Promise<void>;

export default function providerAdmissionExtension(pi: ExtensionAPI): void {
  installProviderAdmissionExtension(pi, writeProviderAdmissionRecord);
}

export function installProviderAdmissionExtension(
  pi: ExtensionAPI,
  recordSink: ProviderAdmissionRecordSink,
): void {
  const configured = readProviderAdmissionPolicyFromEnvironment();
  const expectedModel = readProviderAdmissionModelBindingFromEnvironment();
  // Pi compaction calls the provider stream directly and does not emit
  // before_provider_request. The strict profile must cancel that alternate
  // transport route rather than certify only the ordinary request path.
  pi.on("session_before_compact", () => ({ cancel: true }));
  pi.on("before_provider_request", async (event, ctx) => {
    const decision = !configured.policy
      ? invalidConfigurationDecision(configured.message)
      : !expectedModel.accepted
        ? invalidConfigurationDecision(expectedModel.message)
        : expectedModel.model && !providerAdmissionModelMatches(ctx.model, expectedModel.model)
          ? invalidModelDecision(expectedModel.model, ctx.model)
          : assessProviderRequestAdmission({ payload: event.payload, model: ctx.model, policy: configured.policy });
    if (!decision.accepted) ctx.abort();
    const record: ProviderAdmissionRecord = {
      type: "scaler_provider_admission",
      version: 1,
      timestamp: new Date().toISOString(),
      dispatchId: process.env.SCALER_PROVIDER_ADMISSION_DISPATCH_ID,
      ...decision,
    };
    try {
      await recordSink(record);
    } catch {
      // A strict accepted call without parent-observable evidence cannot be
      // reconciled. Refuse before transport; an existing refusal stays latched.
      ctx.abort();
    }
  });
}

function invalidModelDecision(expected: ProviderAdmissionModel, actual: ProviderAdmissionModel | undefined): ProviderAdmissionDecision {
  return {
    accepted: false,
    code: "invalid_model",
    message: `Provider model identity changed before transport: expected ${String(expected.provider)}/${String(expected.id)} (${String(expected.api)}, ${String(expected.contextWindow)}), received ${String(actual?.provider)}/${String(actual?.id)} (${String(actual?.api)}, ${String(actual?.contextWindow)}).`,
    estimator: "serialized_utf8_bytes_upper_bound",
  };
}

function invalidConfigurationDecision(message: string): ProviderAdmissionDecision {
  return {
    accepted: false,
    code: "invalid_policy",
    message,
    estimator: "serialized_utf8_bytes_upper_bound",
  };
}

function writeProviderAdmissionRecord(record: ProviderAdmissionRecord): void {
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

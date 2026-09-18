/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  assessProviderRequestAdmission,
  readProviderAdmissionPolicyFromEnvironment,
  type ProviderAdmissionDecision,
} from "./provider-admission.js";

export default function providerAdmissionExtension(pi: ExtensionAPI): void {
  const configured = readProviderAdmissionPolicyFromEnvironment();
  // Pi compaction calls the provider stream directly and does not emit
  // before_provider_request. The strict profile must cancel that alternate
  // transport route rather than certify only the ordinary request path.
  pi.on("session_before_compact", () => ({ cancel: true }));
  pi.on("before_provider_request", (event, ctx) => {
    const decision = configured.policy
      ? assessProviderRequestAdmission({ payload: event.payload, model: ctx.model, policy: configured.policy })
      : invalidConfigurationDecision(configured.message);
    if (!decision.accepted) ctx.abort();
    void recordProviderAdmissionDecision(ctx.cwd, decision).catch(() => undefined);
  });
}

function invalidConfigurationDecision(message: string): ProviderAdmissionDecision {
  return {
    accepted: false,
    code: "invalid_policy",
    message,
    estimator: "serialized_utf8_bytes_upper_bound",
  };
}

async function recordProviderAdmissionDecision(cwd: string, decision: ProviderAdmissionDecision): Promise<void> {
  const directory = join(cwd, ".scaler", "reports", "provider-admission");
  await mkdir(directory, { recursive: true });
  const timestamp = new Date().toISOString();
  const record = {
    version: 1,
    timestamp,
    ...decision,
  };
  const filename = `${timestamp.replaceAll(":", "-")}-${process.pid}-${randomUUID()}.json`;
  await writeFile(join(directory, filename), `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
}

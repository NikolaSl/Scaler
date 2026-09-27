/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ProviderAdmissionModel } from "../src/provider-admission.js";

export const testProviderAdmissionModel: ProviderAdmissionModel = Object.freeze({
  api: "openai-completions",
  provider: "synthetic",
  id: "synthetic-8k",
  contextWindow: 8_000,
});

export function withTestProviderAdmissionModel<T extends object>(options: T): T & { providerAdmissionModel: ProviderAdmissionModel } {
  const bound = Object.create(Object.getPrototypeOf(options), Object.getOwnPropertyDescriptors(options)) as T & { providerAdmissionModel: ProviderAdmissionModel };
  Object.defineProperty(bound, "providerAdmissionModel", {
    value: testProviderAdmissionModel,
    enumerable: true,
    configurable: true,
    writable: true,
  });
  return bound;
}

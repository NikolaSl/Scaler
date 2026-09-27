/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { assessProviderRequestAdmission, readProviderAdmissionModelBindingFromEnvironment } from "../src/provider-admission.js";

const model = { api: "openai-completions", provider: "openai", id: "synthetic-window", contextWindow: 8_000 };
const policy = { requestTokenAllowance: 8_000, outputReserveTokens: 32, safetyMarginTokens: 16 };
const payload = () => ({ model: model.id, messages: [{ role: "user", content: "Inspect source." }], stream: true, max_completion_tokens: 32 });
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");

test("strict provider model binding parser refuses missing and partial identities", () => {
  assert.equal(readProviderAdmissionModelBindingFromEnvironment({}).accepted, false);
  assert.equal(readProviderAdmissionModelBindingFromEnvironment({ SCALER_EXPECTED_PROVIDER: "synthetic" }).accepted, false);
  assert.deepEqual(readProviderAdmissionModelBindingFromEnvironment({
    SCALER_EXPECTED_PROVIDER_API: "openai-completions",
    SCALER_EXPECTED_PROVIDER: "synthetic",
    SCALER_EXPECTED_MODEL_ID: "synthetic-8k",
    SCALER_EXPECTED_CONTEXT_WINDOW: "8000",
  }).model, {
    api: "openai-completions",
    provider: "synthetic",
    id: "synthetic-8k",
    contextWindow: 8_000,
  });
});

for (const [name, extra] of [
  ["system instructions", { messages: [{ role: "system", content: "s".repeat(8_000) }, { role: "user", content: "Inspect source." }] }],
  ["tool schemas", { tools: [{ type: "function", function: { name: "inspect", description: "d".repeat(8_000), parameters: { type: "object", properties: {} } } }] }],
  ["prior history", { messages: [{ role: "user", content: "h".repeat(8_000) }, { role: "assistant", content: "Recorded." }, { role: "user", content: "Continue." }] }],
  ["pending tool results", { messages: [{ role: "assistant", content: null, tool_calls: [{ id: "call-1", type: "function", function: { name: "inspect", arguments: "{}" } }] }, { role: "tool", tool_call_id: "call-1", content: "r".repeat(8_000) }] }],
] as const) {
  test(`provider admission counts actual ${name}`, () => {
    const request = { ...payload(), ...extra };
    const result = assessProviderRequestAdmission({ payload: request, model, policy });
    assert.equal(result.accepted, false);
    assert.ok(bytes(request) > model.contextWindow);
  });
}

test("provider admission includes output reserve and margin with an inclusive exact boundary", () => {
  const request = payload();
  const total = bytes(request) + request.max_completion_tokens + policy.safetyMarginTokens;
  assert.equal(assessProviderRequestAdmission({ payload: request, model, policy: { ...policy, requestTokenAllowance: total } }).accepted, true);
  assert.equal(assessProviderRequestAdmission({ payload: request, model, policy: { ...policy, requestTokenAllowance: total - 1 } }).accepted, false);
});

test("provider admission honors the smaller model window as well as task allowance", () => {
  const request = payload();
  const total = bytes(request) + request.max_completion_tokens + policy.safetyMarginTokens;
  assert.equal(assessProviderRequestAdmission({ payload: request, model: { ...model, contextWindow: total - 1 }, policy }).accepted, false);
  assert.equal(assessProviderRequestAdmission({ payload: request, model: { ...model, contextWindow: total }, policy }).accepted, true);
});

test("provider admission counts UTF-8 bytes rather than UTF-16 characters", () => {
  const request = { ...payload(), messages: [{ role: "user", content: "界".repeat(100) }] };
  const characterAllowance = JSON.stringify(request).length + 32 + policy.safetyMarginTokens;
  assert.ok(bytes(request) > JSON.stringify(request).length);
  assert.equal(assessProviderRequestAdmission({ payload: request, model, policy: { ...policy, requestTokenAllowance: characterAllowance } }).accepted, false);
});

test("provider admission accounts for the actual larger output limit", () => {
  const request = { ...payload(), max_completion_tokens: 128 };
  const inadequate = bytes(request) + policy.outputReserveTokens + policy.safetyMarginTokens;
  assert.equal(assessProviderRequestAdmission({ payload: request, model, policy: { ...policy, requestTokenAllowance: inadequate } }).accepted, false);
});

test("provider admission refuses Pi clamping useful output reserve to one token", () => {
  assert.equal(assessProviderRequestAdmission({ payload: { ...payload(), max_completion_tokens: 1 }, model, policy }).accepted, false);
});

test("provider admission supports the alternative max_tokens field", () => {
  const { max_completion_tokens, ...rest } = payload();
  assert.equal(assessProviderRequestAdmission({ payload: { ...rest, max_tokens: max_completion_tokens }, model, policy }).accepted, true);
});

test("provider admission refuses malformed, absent or conflicting output limits", () => {
  const { max_completion_tokens: _ignored, ...request } = payload();
  for (const limit of [undefined, 0, -1, NaN, Infinity, 1.5, "32"]) {
    assert.equal(assessProviderRequestAdmission({ payload: { ...request, max_completion_tokens: limit }, model, policy }).accepted, false, `limit=${String(limit)}`);
  }
  assert.equal(assessProviderRequestAdmission({ payload: { ...payload(), max_tokens: 64 }, model, policy }).accepted, false);
});

test("provider admission fails closed on invalid policy or model limits", () => {
  for (const value of [0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(assessProviderRequestAdmission({ payload: payload(), model: { ...model, contextWindow: value }, policy }).accepted, false);
    assert.equal(assessProviderRequestAdmission({ payload: payload(), model, policy: { ...policy, requestTokenAllowance: value } }).accepted, false);
    assert.equal(assessProviderRequestAdmission({ payload: payload(), model, policy: { ...policy, outputReserveTokens: value } }).accepted, false);
  }
  for (const value of [-1, NaN, Infinity, 1.5]) {
    assert.equal(assessProviderRequestAdmission({ payload: payload(), model, policy: { ...policy, safetyMarginTokens: value } }).accepted, false);
  }
});

test("provider admission refuses unsupported API, opaque payloads and image content", () => {
  assert.equal(assessProviderRequestAdmission({ payload: payload(), model: { ...model, api: "anthropic-messages" }, policy }).accepted, false);
  for (const request of [null, "opaque", {}, { ...payload(), messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }] }] }]) {
    assert.equal(assessProviderRequestAdmission({ payload: request, model, policy }).accepted, false);
  }
});

for (const content of [null, "Audio transcript."]) {
  test(`provider admission refuses assistant audio references with ${content === null ? "null" : "text"} content`, () => {
    const request = {
      ...payload(),
      messages: [{ role: "assistant", content, audio: { id: "audio-reference-not-inline-content" } }],
    };
    assert.equal(assessProviderRequestAdmission({ payload: request, model, policy }).accepted, false);
  });
}

for (const [name, extra] of [
  ["audio configuration", { audio: { voice: "alloy", format: "wav" } }],
  ["audio output modalities", { modalities: ["text", "audio"] }],
] as const) {
  test(`provider admission refuses top-level ${name}`, () => {
    assert.equal(assessProviderRequestAdmission({ payload: { ...payload(), ...extra }, model, policy }).accepted, false);
  });
}

test("provider admission refuses multiple completions rather than counting only one output limit", () => {
  for (const n of [2, 3, 100]) {
    assert.equal(assessProviderRequestAdmission({ payload: { ...payload(), n }, model, policy }).accepted, false, `n=${n}`);
  }
});

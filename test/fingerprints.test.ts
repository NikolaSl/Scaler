/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalJson, fingerprintJson } from "../src/fingerprints.js";

test("canonicalJson sorts object keys while retaining array order", () => {
  assert.equal(canonicalJson({ z: 1, a: { y: 2, b: 3 }, list: ["x", "y"] }), '{"a":{"b":3,"y":2},"list":["x","y"],"z":1}');
  assert.equal(fingerprintJson({ b: 2, a: 1 }), fingerprintJson({ a: 1, b: 2 }));
  assert.notEqual(fingerprintJson(["a", "b"]), fingerprintJson(["b", "a"]));
  assert.match(fingerprintJson({ value: true }), /^sha256:[0-9a-f]{64}$/);
});

test("canonicalJson rejects ambiguous or unsupported identity material", () => {
  assert.throws(() => canonicalJson({ value: undefined }), /undefined at \$\.value/);
  assert.throws(() => canonicalJson({ value: Number.NaN }), /non-finite number/);
  assert.throws(() => canonicalJson(new Date()), /non-plain object/);
  assert.throws(() => canonicalJson([, "value"]), /sparse array entry/);
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  assert.throws(() => canonicalJson(cyclic), /cyclic value/);
});

test("canonicalJson permits repeated non-cyclic references", () => {
  const shared = { value: 1 };
  assert.equal(canonicalJson({ left: shared, right: shared }), '{"left":{"value":1},"right":{"value":1}}');
});

/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from "node:crypto";

type CanonicalJsonValue = null | boolean | number | string | CanonicalJsonValue[] | { [key: string]: CanonicalJsonValue };

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalizeJsonValue(value, "$", new Set<object>()));
}

export function fingerprintJson(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function normalizeJsonValue(value: unknown, path: string, ancestors: Set<object>): CanonicalJsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`Cannot fingerprint non-finite number at ${path}.`);
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== "object") throw new TypeError(`Cannot fingerprint ${typeof value} at ${path}.`);
  if (ancestors.has(value)) throw new TypeError(`Cannot fingerprint cyclic value at ${path}.`);

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const normalized: CanonicalJsonValue[] = [];
      for (let index = 0; index < value.length; index++) {
        if (!(index in value)) throw new TypeError(`Cannot fingerprint sparse array entry at ${path}[${index}].`);
        normalized.push(normalizeJsonValue(value[index], `${path}[${index}]`, ancestors));
      }
      return normalized;
    }

    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`Cannot fingerprint non-plain object at ${path}.`);
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new TypeError(`Cannot fingerprint symbol-keyed property at ${path}.`);
    }
    return Object.fromEntries(
      Object.keys(value)
        .sort((left, right) => left.localeCompare(right))
        .map((key) => [key, normalizeJsonValue((value as Record<string, unknown>)[key], `${path}.${key}`, ancestors)]),
    );
  } finally {
    ancestors.delete(value);
  }
}

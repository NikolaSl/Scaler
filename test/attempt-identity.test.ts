/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fingerprintAdmittedInput,
  fingerprintTaskContract,
  fingerprintTaskReportOutput,
  fingerprintTaskRoute,
  fingerprintValidationPolicy,
} from "../src/attempt-identity.js";

test("attempt fingerprints bind semantic task input route policy and output material", () => {
  const task = { id: "T-001", status: "ready" as const, title: "Implement", updatedAt: "2026-01-01T00:00:00.000Z" };
  const taskFingerprint = fingerprintTaskContract(task);
  assert.equal(taskFingerprint, fingerprintTaskContract({ ...task, status: "running", updatedAt: "2026-02-01T00:00:00.000Z", attemptId: "runtime-only" }));
  assert.notEqual(taskFingerprint, fingerprintTaskContract({ ...task, title: "Changed contract" }));

  const context = {
    included: [{ id: "spec", type: "file" as const, reason: "requirement", content: "one", priority: "required" as const, scope: "full" as const, estimatedTokens: 1 }],
    omitted: [],
    text: "## Context: spec\none",
    estimatedTokens: 1,
  };
  assert.notEqual(
    fingerprintAdmittedInput(taskFingerprint, context),
    fingerprintAdmittedInput(taskFingerprint, { ...context, included: [{ ...context.included[0]!, content: "two" }], text: "## Context: spec\ntwo" }),
  );
  assert.equal(fingerprintTaskRoute(undefined, ["write", "read", "read"]), fingerprintTaskRoute(undefined, ["read", "write"]));

  const manifest = { taskId: "T-001", commands: [{ id: "unit", command: "npm test", required: true }], createdAt: "old", updatedAt: "old" };
  assert.equal(fingerprintValidationPolicy(manifest), fingerprintValidationPolicy({ ...manifest, createdAt: "new", updatedAt: "new" }));
  assert.notEqual(fingerprintValidationPolicy(manifest), fingerprintValidationPolicy({ ...manifest, commands: [{ ...manifest.commands[0]!, command: "npm run test:unit" }] }));

  const report = { taskId: "T-001", status: "completed", summary: "done", changedFiles: ["src/app.ts"] };
  assert.equal(
    fingerprintTaskReportOutput({ ...report, runId: "run-a", attemptId: "attempt-a" }),
    fingerprintTaskReportOutput({ ...report, runId: "run-b", attemptId: "attempt-b" }),
  );
  assert.notEqual(fingerprintTaskReportOutput(report), fingerprintTaskReportOutput({ ...report, changedFiles: ["src/other.ts"] }));
});

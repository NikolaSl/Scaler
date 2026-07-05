/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createDefaultState } from "../src/state.js";
import { createTask } from "../src/tasks.js";
import { buildTaskDefinitionWarnings, formatTaskDefinitionReviews, loadTaskDefinitionReviews, reviewTaskDefinition } from "../src/task-quality.js";
import { upsertValidationManifestCommand } from "../src/validation.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-task-quality-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("reviewTaskDefinition records warnings for missing DoD validation and allowed paths", async () => {
  await withTempDir(async (dir) => {
    const created = await createTask(dir, createDefaultState(), { id: "T-WARN", title: "Loose task" });

    const review = await reviewTaskDefinition(dir, created.state, "T-WARN", new Date("2026-01-01T00:00:00.000Z"));

    assert.equal(review.status, "warnings");
    assert.deepEqual(review.warnings.map((warning) => warning.code).sort(), ["missing_allowed_paths", "missing_atomicity", "missing_dod", "missing_test_first", "missing_validation"]);
    assert.match(formatTaskDefinitionReviews([review]), /missing_dod/);
    assert.equal((await loadTaskDefinitionReviews(dir))[0]?.id, review.id);
  });
});

test("reviewTaskDefinition records strict blocked status and explicit waivers", async () => {
  await withTempDir(async (dir) => {
    const created = await createTask(dir, createDefaultState(), {
      id: "T-WAIVE",
      title: "Waived task",
      taskKind: "software",
      atomicityRationale: "T-WAIVE is independently completable and testable.",
      allowedPathPrefixes: ["src"],
      definitionOfDone: ["Manual acceptance evidence captured"],
      validationRefs: ["manual-review"],
      qualityWaivers: [{ code: "missing_test_first", reason: "Documentation-only correction has no meaningful pre-implementation test." }],
    });

    const review = await reviewTaskDefinition(dir, created.state, "T-WAIVE", new Date("2026-01-01T00:00:00.000Z"), { enforcement: "enforce" });

    assert.equal(review.status, "ok");
    assert.equal(review.waivedWarnings?.[0]?.code, "missing_test_first");
    assert.match(formatTaskDefinitionReviews([review]), /waived missing_test_first/);
  });
});

test("buildTaskDefinitionWarnings passes task with DoD, paths, and validation", async () => {
  await withTempDir(async (dir) => {
    const created = await createTask(dir, createDefaultState(), {
      id: "T-OK",
      title: "Scoped task",
      taskKind: "software",
      atomicityRationale: "T-OK is a focused independently testable task.",
      allowedPathPrefixes: ["src"],
      definitionOfDone: ["Tests pass"],
    });
    await upsertValidationManifestCommand(dir, {
      taskId: "T-OK",
      id: "test-first",
      command: "npm test -- --list",
      required: true,
      gate: "test_first",
    });
    await upsertValidationManifestCommand(dir, {
      taskId: "T-OK",
      id: "test",
      command: "npm test",
      required: true,
      gate: "unit_tests",
    });

    const warnings = await buildTaskDefinitionWarnings(dir, created.state.tasks[0]!);

    assert.deepEqual(warnings, []);
  });
});

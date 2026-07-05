/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  appendPrdChange,
  computePrdCoverageSummary,
  createPrdVersionSnapshot,
  isRuntimePrdRequirementStatus,
  loadCurrentPrd,
  loadPrdChanges,
  loadPrdCoverage,
  loadPrdRequirements,
  saveCurrentPrd,
  savePrdCoverage,
  savePrdRequirements,
} from "../src/prd.js";
import { createDefaultState } from "../src/state.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-prd-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("runtime PRD loaders return missing-file defaults", async () => {
  await withTempDir(async (dir) => {
    assert.equal(await loadCurrentPrd(dir), "");
    assert.deepEqual(await loadPrdRequirements(dir), { version: 1, requirements: [] });
    assert.deepEqual(await loadPrdCoverage(dir), { version: 1, entries: [] });
    assert.deepEqual(await loadPrdChanges(dir), []);
  });
});

test("runtime PRD files save and load round trips", async () => {
  await withTempDir(async (dir) => {
    await saveCurrentPrd(dir, "# Polished PRD");
    await savePrdRequirements(dir, {
      version: 1,
      requirements: [
        {
          id: "REQ-001",
          statement: "User can inspect status.",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    await savePrdCoverage(dir, {
      version: 1,
      entries: [
        {
          requirementId: "REQ-001",
          status: "pending",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    await appendPrdChange(dir, {
      timestamp: "2026-01-01T00:00:00.000Z",
      reason: "initial PRD",
      affectedRequirementIds: ["REQ-001"],
    });

    assert.equal(await loadCurrentPrd(dir), "# Polished PRD\n");
    assert.equal((await loadPrdRequirements(dir)).requirements[0]?.id, "REQ-001");
    assert.equal((await loadPrdCoverage(dir)).entries[0]?.status, "pending");
    assert.equal((await loadPrdChanges(dir))[0]?.reason, "initial PRD");
  });
});

test("runtime PRD status validation rejects invalid coverage statuses", async () => {
  await withTempDir(async (dir) => {
    assert.equal(isRuntimePrdRequirementStatus("validated"), true);
    assert.equal(isRuntimePrdRequirementStatus("done"), false);

    await assert.rejects(
      () =>
        savePrdCoverage(dir, {
          version: 1,
          entries: [
            {
              requirementId: "REQ-001",
              status: "done" as never,
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        }),
      /Invalid runtime PRD requirement status: done/,
    );
  });
});

test("createPrdVersionSnapshot writes incrementing version files", async () => {
  await withTempDir(async (dir) => {
    await saveCurrentPrd(dir, "# Current PRD");

    const first = await createPrdVersionSnapshot(dir, {
      reason: "initial snapshot",
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    const second = await createPrdVersionSnapshot(dir, { content: "# Updated PRD" });

    assert.equal(first, ".scaler/prd/versions/PRD-v001.md");
    assert.equal(second, ".scaler/prd/versions/PRD-v002.md");
    assert.equal(await readFile(join(dir, first), "utf8"), "# Current PRD\n");
    assert.equal(await readFile(join(dir, second), "utf8"), "# Updated PRD\n");
    assert.equal((await loadPrdChanges(dir))[0]?.versionPath, first);
  });
});

test("computePrdCoverageSummary derives coverage from linked validated tasks", () => {
  const state = createDefaultState();
  state.tasks = [
    { id: "T-001", status: "validated", prdRefs: ["REQ-001"], updatedAt: state.createdAt },
    { id: "T-002", status: "running", prdRefs: ["REQ-002"], updatedAt: state.createdAt },
  ];

  const summary = computePrdCoverageSummary(
    {
      version: 1,
      requirements: [
        { id: "REQ-001", statement: "First", createdAt: state.createdAt, updatedAt: state.createdAt },
        { id: "REQ-002", statement: "Second", createdAt: state.createdAt, updatedAt: state.createdAt },
        { id: "REQ-003", statement: "Third", createdAt: state.createdAt, updatedAt: state.createdAt },
      ],
    },
    { version: 1, entries: [] },
    state,
  );

  assert.equal(summary.entries.find((entry) => entry.requirementId === "REQ-001")?.status, "validated");
  assert.equal(summary.entries.find((entry) => entry.requirementId === "REQ-002")?.status, "in_progress");
  assert.equal(summary.entries.find((entry) => entry.requirementId === "REQ-003")?.status, "pending");
  assert.deepEqual(summary.unlinkedRequirementIds, ["REQ-003"]);
  assert.deepEqual(summary.linkedRequirementIds, ["REQ-001", "REQ-002"]);
  assert.equal(summary.countsByStatus.validated, 1);
  assert.equal(summary.countsByStatus.in_progress, 1);
  assert.equal(summary.countsByStatus.pending, 1);
});

test("computePrdCoverageSummary gives blocked and needs_replan explicit statuses precedence", () => {
  const state = createDefaultState();
  state.tasks = [
    { id: "T-001", status: "validated", prdRefs: ["REQ-001", "REQ-002"], updatedAt: state.createdAt },
  ];

  const summary = computePrdCoverageSummary(
    {
      version: 1,
      requirements: [
        { id: "REQ-001", statement: "First", createdAt: state.createdAt, updatedAt: state.createdAt },
        { id: "REQ-002", statement: "Second", createdAt: state.createdAt, updatedAt: state.createdAt },
      ],
    },
    {
      version: 1,
      entries: [
        { requirementId: "REQ-001", status: "blocked", updatedAt: state.createdAt },
        { requirementId: "REQ-002", status: "needs_replan", updatedAt: state.createdAt },
      ],
    },
    state,
  );

  assert.equal(summary.entries.find((entry) => entry.requirementId === "REQ-001")?.status, "blocked");
  assert.equal(summary.entries.find((entry) => entry.requirementId === "REQ-002")?.status, "needs_replan");
});

test("computePrdCoverageSummary includes explicit task ids as links", () => {
  const state = createDefaultState();
  state.tasks = [{ id: "T-001", status: "ready", updatedAt: state.createdAt }];

  const summary = computePrdCoverageSummary(
    { version: 1, requirements: [{ id: "REQ-001", statement: "First", createdAt: state.createdAt, updatedAt: state.createdAt }] },
    { version: 1, entries: [{ requirementId: "REQ-001", status: "implemented", taskIds: ["T-001"], updatedAt: state.createdAt }] },
    state,
  );

  assert.deepEqual(summary.entries[0]?.linkedTaskIds, ["T-001"]);
  assert.deepEqual(summary.unlinkedRequirementIds, []);
  assert.equal(summary.entries[0]?.status, "implemented");
});

/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
  advanceReplannedCoverage,
  advanceReplannedCoverageAndRun,
  amendPrdRequirement,
  applyPrdRequirementUpserts,
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
  upsertPrdRequirement,
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

test("runtime PRD loading rejects duplicate on-disk requirement ids before updates", async () => {
  await withTempDir(async (dir) => {
    await savePrdRequirements(dir, {
      version: 1,
      requirements: [{
        id: "REQ-DUP",
        statement: "Initial requirement.",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }],
    });
    const path = join(dir, ".scaler", "prd", "requirements.json");
    const bytes = `${JSON.stringify({
      version: 1,
      requirements: [
        { id: "REQ-DUP", statement: "First copy.", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
        { id: "REQ-DUP", statement: "Second copy.", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
      ],
    })}\n`;
    await writeFile(path, bytes, "utf8");

    await assert.rejects(loadPrdRequirements(dir), /duplicate id REQ-DUP/i);
    await assert.rejects(
      applyPrdRequirementUpserts(dir, [{ id: "REQ-NEW", statement: "Must not be written." }]),
      /duplicate id REQ-DUP/i,
    );
    assert.equal(await readFile(path, "utf8"), bytes);
  });
});

test("model-route requirement upserts preserve criteria and reject explicit removal", async () => {
  await withTempDir(async (dir) => {
    const acceptanceCriteria = [{
      id: "AC-INTEGRATION",
      statement: "Components work together.",
      validationTaskId: "T-B",
      commandId: "integration",
      participantTaskIds: ["T-B", "T-A", "T-A"],
    }];
    await savePrdRequirements(dir, {
      version: 1,
      requirements: [{
        id: "REQ-ONE", statement: "Initial", acceptanceCriteria,
        createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
      }],
    });
    await upsertPrdRequirement(dir, { id: "REQ-ONE", statement: "Initial" });
    assert.deepEqual((await loadPrdRequirements(dir)).requirements[0]?.acceptanceCriteria?.[0]?.participantTaskIds, ["T-A", "T-B"]);
    const before = await loadPrdRequirements(dir);
    await assert.rejects(
      () => upsertPrdRequirement(dir, { id: "REQ-ONE", statement: "Initial", source: "user", acceptanceCriteria: [] }),
      /amendment authority|required user command/i,
    );
    assert.deepEqual(await loadPrdRequirements(dir), before);
  });
});

test("model-route requirement upserts cannot introduce mandatory criteria", async () => {
  await withTempDir(async (dir) => {
    const acceptanceCriteria = [{
      id: "AC-NEW", statement: "New mandatory gate.", validationTaskId: "T-ONE",
      commandId: "integration", participantTaskIds: ["T-ONE"],
    }];
    await assert.rejects(
      () => upsertPrdRequirement(dir, {
        id: "REQ-NEW", statement: "Agent-normalized requirement", source: "user", acceptanceCriteria,
      }),
      /amendment authority|required user command/i,
    );
    assert.deepEqual((await loadPrdRequirements(dir)).requirements, []);
    assert.deepEqual(await loadPrdChanges(dir), []);
  });
});

test("explicit user amendment records immutable versions and rejects stale bases", async () => {
  await withTempDir(async (dir) => {
    await upsertPrdRequirement(dir, {
      id: "REQ-AMEND", statement: "Original normalized wording", source: "initial-input",
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    const acceptanceCriteria = [{
      id: "AC-END", statement: "Operate end to end.", validationTaskId: "T-END",
      commandId: "integration", participantTaskIds: ["T-A", "T-END"],
    }];
    const amended = await amendPrdRequirement(dir, {
      id: "REQ-AMEND",
      expectedRevision: 1,
      reason: "User explicitly requires the end-to-end gate.",
      changes: { statement: "Authorized amended wording", acceptanceCriteria },
      now: new Date("2026-01-01T00:01:00.000Z"),
    });

    assert.equal(amended.revision, 2);
    assert.deepEqual(amended.versionHistory?.map((version) => version.revision), [1, 2]);
    assert.equal(amended.versionHistory?.[0]?.statement, "Original normalized wording");
    assert.equal(amended.versionHistory?.[0]?.authority.kind, "normalized_input");
    assert.equal(amended.versionHistory?.[1]?.statement, "Authorized amended wording");
    assert.deepEqual(amended.versionHistory?.[1]?.acceptanceCriteria, acceptanceCriteria);
    assert.deepEqual(amended.versionHistory?.[1]?.authority, {
      kind: "user_command", reason: "User explicitly requires the end-to-end gate.",
    });

    const beforeStale = await loadPrdRequirements(dir);
    await assert.rejects(() => amendPrdRequirement(dir, {
      id: "REQ-AMEND", expectedRevision: 1, reason: "Stale overwrite", changes: { acceptanceCriteria: [] },
    }), /stale.*expected revision 1.*current revision 2/i);
    assert.deepEqual(await loadPrdRequirements(dir), beforeStale);
  });
});

test("material requirement amendment invalidates only its current coverage", async () => {
  await withTempDir(async (dir) => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    await upsertPrdRequirement(dir, { id: "REQ-A", statement: "Original A", now });
    await upsertPrdRequirement(dir, { id: "REQ-B", statement: "Original B", now });
    await savePrdCoverage(dir, {
      version: 1,
      entries: [
        {
          requirementId: "REQ-A",
          status: "validated",
          taskIds: ["T-A"],
          evidenceRefs: ["validation:A:v1"],
          notes: "Accepted against revision 1.",
          updatedAt: now.toISOString(),
        },
        {
          requirementId: "REQ-B",
          status: "validated",
          taskIds: ["T-B"],
          evidenceRefs: ["validation:B:v1"],
          updatedAt: now.toISOString(),
        },
      ],
    });

    await amendPrdRequirement(dir, {
      id: "REQ-A",
      expectedRevision: 1,
      reason: "User changed the required behavior.",
      changes: { statement: "Revised A" },
      now: new Date("2026-01-01T00:01:00.000Z"),
    });

    const coverage = await loadPrdCoverage(dir);
    assert.deepEqual(coverage.entries.find((entry) => entry.requirementId === "REQ-A"), {
      requirementId: "REQ-A",
      status: "needs_replan",
      taskIds: ["T-A"],
      evidenceRefs: ["validation:A:v1"],
      notes: "Accepted against revision 1.",
      updatedAt: "2026-01-01T00:01:00.000Z",
    });
    assert.deepEqual(coverage.entries.find((entry) => entry.requirementId === "REQ-B"), {
      requirementId: "REQ-B",
      status: "validated",
      taskIds: ["T-B"],
      evidenceRefs: ["validation:B:v1"],
      updatedAt: now.toISOString(),
    });
  });
});

test("title-only requirement amendment preserves current coverage", async () => {
  await withTempDir(async (dir) => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    await upsertPrdRequirement(dir, { id: "REQ-TITLE", statement: "Stable behavior", title: "Old title", now });
    await savePrdCoverage(dir, {
      version: 1,
      entries: [{
        requirementId: "REQ-TITLE",
        status: "validated",
        taskIds: ["T-TITLE"],
        evidenceRefs: ["validation:title:v1"],
        updatedAt: now.toISOString(),
      }],
    });

    await amendPrdRequirement(dir, {
      id: "REQ-TITLE",
      expectedRevision: 1,
      reason: "User clarified only the display title.",
      changes: { title: "New title" },
      now: new Date("2026-01-01T00:01:00.000Z"),
    });

    assert.deepEqual((await loadPrdCoverage(dir)).entries[0], {
      requirementId: "REQ-TITLE",
      status: "validated",
      taskIds: ["T-TITLE"],
      evidenceRefs: ["validation:title:v1"],
      updatedAt: now.toISOString(),
    });
  });
});

test("material amendment does not manufacture missing coverage", async () => {
  await withTempDir(async (dir) => {
    await upsertPrdRequirement(dir, { id: "REQ-NEW", statement: "Original" });

    await amendPrdRequirement(dir, {
      id: "REQ-NEW",
      expectedRevision: 1,
      reason: "User changed the requirement before coverage existed.",
      changes: { statement: "Revised" },
    });

    assert.deepEqual((await loadPrdCoverage(dir)).entries, []);
  });
});

test("acceptance criteria reject exact duplicate ids hidden by Unicode collation", async () => {
  await withTempDir(async (dir) => {
    await upsertPrdRequirement(dir, { id: "REQ-UNICODE", statement: "Original requirement." });
    const path = join(dir, ".scaler", "prd", "requirements.json");
    const before = await readFile(path, "utf8");
    const criterion = (id: string, statement: string) => ({
      id,
      statement,
      validationTaskId: "T-UNICODE",
      commandId: "integration",
      participantTaskIds: ["T-UNICODE"],
    });

    await assert.rejects(() => amendPrdRequirement(dir, {
      id: "REQ-UNICODE",
      expectedRevision: 1,
      reason: "Exercise exact duplicate detection independently of locale collation.",
      changes: {
        acceptanceCriteria: [
          criterion("é", "First exact id."),
          criterion("e\u0301", "Canonically equivalent but byte-distinct id."),
          criterion("é", "Second exact id."),
        ],
      },
    }), /duplicate id é/i);
    assert.equal(await readFile(path, "utf8"), before);
  });
});

test("serialized unrelated upserts cannot roll back an authorized amendment", async () => {
  await withTempDir(async (dir) => {
    await upsertPrdRequirement(dir, { id: "REQ-AMEND", statement: "Version one" });
    await Promise.all([
      amendPrdRequirement(dir, {
        id: "REQ-AMEND", expectedRevision: 1, reason: "User authorizes version two.",
        changes: { statement: "Version two" },
      }),
      ...Array.from({ length: 12 }, (_, index) => upsertPrdRequirement(dir, {
        id: `REQ-OTHER-${index}`, statement: `Unrelated ${index}`,
      })),
    ]);

    const requirements = await loadPrdRequirements(dir);
    const amended = requirements.requirements.find((requirement) => requirement.id === "REQ-AMEND");
    assert.equal(amended?.statement, "Version two");
    assert.equal(amended?.revision, 2);
    assert.deepEqual(amended?.versionHistory?.map((version) => version.revision), [1, 2]);
    assert.equal(requirements.requirements.length, 13);
  });
});

test("advanceReplannedCoverage merges only matching affected revisions", async () => {
  await withTempDir(async (dir) => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    await upsertPrdRequirement(dir, { id: "REQ-A", statement: "A1", status: "needs_replan", now });
    await upsertPrdRequirement(dir, { id: "REQ-B", statement: "B1", status: "needs_replan", now });
    await amendPrdRequirement(dir, {
      id: "REQ-A",
      expectedRevision: 1,
      reason: "Authorize A2.",
      changes: { statement: "A2" },
      now,
    });

    await advanceReplannedCoverage(dir, {
      affectedRequirementRevisions: { "REQ-A": 2 },
      expectedCoverageEntries: {
        "REQ-A": { requirementId: "REQ-A", status: "needs_replan", updatedAt: now.toISOString() },
      },
      taskIdsByRequirement: { "REQ-A": ["T-A"] },
      updatedAt: "2026-01-01T00:01:00.000Z",
    });
    let coverage = await loadPrdCoverage(dir);
    assert.equal(coverage.entries.find((entry) => entry.requirementId === "REQ-A")?.status, "in_progress");
    assert.equal(coverage.entries.find((entry) => entry.requirementId === "REQ-B")?.status, "needs_replan");

    await amendPrdRequirement(dir, {
      id: "REQ-A",
      expectedRevision: 2,
      reason: "Authorize A3 before stale acceptance completes.",
      changes: { statement: "A3" },
      now: new Date("2026-01-01T00:02:00.000Z"),
    });
    await assert.rejects(() => advanceReplannedCoverage(dir, {
      affectedRequirementRevisions: { "REQ-A": 2 },
      expectedCoverageEntries: {
        "REQ-A": { requirementId: "REQ-A", status: "in_progress", taskIds: ["T-A"], updatedAt: "2026-01-01T00:01:00.000Z" },
      },
      taskIdsByRequirement: { "REQ-A": ["T-A"] },
      updatedAt: "2026-01-01T00:03:00.000Z",
    }), /stale replan coverage update.*expected revision 2.*current revision 3/i);
    coverage = await loadPrdCoverage(dir);
    assert.equal(coverage.entries.find((entry) => entry.requirementId === "REQ-A")?.status, "needs_replan");
    assert.equal(coverage.entries.find((entry) => entry.requirementId === "REQ-B")?.status, "needs_replan");
  });
});

test("advanceReplannedCoverageAndRun holds the requirement fence through publication", async () => {
  await withTempDir(async (dir) => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    await upsertPrdRequirement(dir, { id: "REQ-A", statement: "A1", status: "needs_replan", now });
    await amendPrdRequirement(dir, {
      id: "REQ-A",
      expectedRevision: 1,
      reason: "Authorize A2.",
      changes: { statement: "A2" },
      now,
    });
    const expectedCoverageEntry = (await loadPrdCoverage(dir)).entries[0]!;
    let enterPublication!: () => void;
    const publicationEntered = new Promise<void>((resolve) => { enterPublication = resolve; });
    let releasePublication!: () => void;
    const publicationRelease = new Promise<void>((resolve) => { releasePublication = resolve; });

    const publication = advanceReplannedCoverageAndRun(dir, {
      affectedRequirementRevisions: { "REQ-A": 2 },
      expectedCoverageEntries: { "REQ-A": expectedCoverageEntry },
      taskIdsByRequirement: { "REQ-A": ["T-A"] },
      updatedAt: "2026-01-01T00:01:00.000Z",
    }, async () => {
      enterPublication();
      await publicationRelease;
      return "published";
    });
    await publicationEntered;
    let amendmentFinished = false;
    const amendment = amendPrdRequirement(dir, {
      id: "REQ-A",
      expectedRevision: 2,
      reason: "Concurrent A3.",
      changes: { statement: "A3" },
      now: new Date("2026-01-01T00:02:00.000Z"),
    }).then(() => { amendmentFinished = true; });
    await delay(25);
    assert.equal(amendmentFinished, false);

    releasePublication();
    assert.equal(await publication, "published");
    await amendment;
    assert.equal((await loadPrdRequirements(dir)).requirements[0]?.revision, 3);
    assert.equal((await loadPrdCoverage(dir)).entries[0]?.status, "needs_replan");
  });
});

test("advanceReplannedCoverageAndRun holds the requirement fence without affected rows", async () => {
  await withTempDir(async (dir) => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    await upsertPrdRequirement(dir, { id: "REQ-A", statement: "A1", now });
    let enterPublication!: () => void;
    const publicationEntered = new Promise<void>((resolve) => { enterPublication = resolve; });
    let releasePublication!: () => void;
    const publicationRelease = new Promise<void>((resolve) => { releasePublication = resolve; });

    const publication = advanceReplannedCoverageAndRun(dir, {
      affectedRequirementRevisions: {},
      expectedCoverageEntries: {},
      taskIdsByRequirement: {},
      updatedAt: "2026-01-01T00:01:00.000Z",
    }, async () => {
      enterPublication();
      await publicationRelease;
    });
    await publicationEntered;
    let amendmentFinished = false;
    const amendment = amendPrdRequirement(dir, {
      id: "REQ-A",
      expectedRevision: 1,
      reason: "Concurrent A2.",
      changes: { statement: "A2" },
      now: new Date("2026-01-01T00:02:00.000Z"),
    }).then(() => { amendmentFinished = true; });
    await delay(25);
    assert.equal(amendmentFinished, false);

    releasePublication();
    await publication;
    await amendment;
    assert.equal((await loadPrdRequirements(dir)).requirements[0]?.revision, 2);
  });
});

test("advanceReplannedCoverageAndRun rejects stale full PRD basis without affected rows", async () => {
  await withTempDir(async (dir) => {
    await upsertPrdRequirement(dir, { id: "REQ-A", statement: "A1" });
    const requirements = await loadPrdRequirements(dir);
    const coverage = await loadPrdCoverage(dir);
    await upsertPrdRequirement(dir, { id: "REQ-B", statement: "B1" });

    await assert.rejects(() => advanceReplannedCoverageAndRun(dir, {
      affectedRequirementRevisions: {},
      expectedCoverageEntries: {},
      taskIdsByRequirement: {},
      updatedAt: "2026-01-01T00:01:00.000Z",
      expectedRequirementsFingerprint: createHash("sha256").update(JSON.stringify(requirements)).digest("hex"),
      expectedUnaffectedCoverageFingerprint: createHash("sha256").update(JSON.stringify(coverage.entries)).digest("hex"),
    }, async () => undefined), /stale replan.*requirements changed/i);
  });
});

test("savePrdCoverage rejects duplicate requirement rows", async () => {
  await withTempDir(async (dir) => {
    const updatedAt = "2026-01-01T00:00:00.000Z";
    await assert.rejects(() => savePrdCoverage(dir, {
      version: 1,
      entries: [
        { requirementId: "REQ-A", status: "needs_replan", updatedAt },
        { requirementId: "REQ-A", status: "in_progress", updatedAt },
      ],
    }), /duplicate runtime PRD coverage requirement id: REQ-A/i);
  });
});

test("batch authorization failure publishes no partial requirement or coverage writes", async () => {
  await withTempDir(async (dir) => {
    await upsertPrdRequirement(dir, { id: "REQ-LOCKED", statement: "Original" });
    const beforeRequirements = await loadPrdRequirements(dir);
    const beforeCoverage = await loadPrdCoverage(dir);
    const beforeChanges = await loadPrdChanges(dir);

    await assert.rejects(() => applyPrdRequirementUpserts(dir, [
      { id: "REQ-NEW", statement: "Would otherwise be added", status: "pending" },
      { id: "REQ-LOCKED", statement: "Unauthorized rewrite" },
    ]), /amendment authority|required user command/i);

    assert.deepEqual(await loadPrdRequirements(dir), beforeRequirements);
    assert.deepEqual(await loadPrdCoverage(dir), beforeCoverage);
    assert.deepEqual(await loadPrdChanges(dir), beforeChanges);
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

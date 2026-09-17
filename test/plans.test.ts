/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  appendReplanRequest,
  acceptReplanProposal,
  appendReplanDecision,
  applyExecutionPlanTasks,
  applyPlanningReport,
  checkExecutionPlanPreservation,
  createExecutionPlanSnapshot,
  formatExecutionPlanPreservationCheck,
  formatExecutionPlanSummary,
  formatReplanDecisions,
  formatReplanRequests,
  formatPlanningReports,
  loadExecutionPlan,
  loadPlanningReports,
  loadProposedExecutionPlan,
  loadReplanDecisions,
  loadReplanRequests,
  saveExecutionPlan,
  saveProposedExecutionPlan,
  summarizeExecutionPlan,
  validateExecutionPlan,
  validateReplanRequest,
} from "../src/plans.js";
import { computePrdCoverageSummary, loadPrdChanges, loadPrdCoverage, loadPrdRequirements, upsertPrdRequirement } from "../src/prd.js";
import { createDefaultState } from "../src/state.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-plans-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function validPlanTask(id: string, title: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title,
    taskKind: "software",
    atomicityRationale: `${id} is independently completable and testable for this plan slice.`,
    allowedPathPrefixes: ["src"],
    definitionOfDone: ["Implementation and relevant tests are complete."],
    validationCommands: [
      { id: "test-first", command: "node -e \"process.exit(0)\"", gate: "test_first", required: true },
      { id: "unit", command: "node -e \"process.exit(0)\"", gate: "unit_tests", required: true },
    ],
    ...overrides,
  };
}

test("loadExecutionPlan returns empty default when missing", async () => {
  await withTempDir(async (dir) => {
    const plan = await loadExecutionPlan(dir);

    assert.equal(plan.version, 1);
    assert.equal(plan.status, "draft");
    assert.deepEqual(plan.tasks, []);
  });
});

test("saveExecutionPlan and loadExecutionPlan round trip normalized tasks", async () => {
  await withTempDir(async (dir) => {
    await saveExecutionPlan(dir, {
      version: 1,
      planVersion: 1,
      status: "active",
      title: "Plan",
      tasks: [
        {
          id: "T-001",
          title: "Do work",
          prdRefs: ["REQ-001", "REQ-001"],
          allowedPathPrefixes: ["./src/"],
          dependsOn: ["T-000"],
        },
      ],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const loaded = await loadExecutionPlan(dir);
    assert.equal(loaded.status, "active");
    assert.deepEqual(loaded.tasks[0]?.prdRefs, ["REQ-001"]);
    assert.deepEqual(loaded.tasks[0]?.allowedPathPrefixes, ["src"]);
  });
});

test("saveProposedExecutionPlan and loadProposedExecutionPlan round trip", async () => {
  await withTempDir(async (dir) => {
    assert.equal(await loadProposedExecutionPlan(dir), undefined);
    const saved = await saveProposedExecutionPlan(dir, {
      version: 1,
      planVersion: 2,
      status: "draft",
      tasks: [{ id: "T-001", title: "Do proposed work", allowedPathPrefixes: ["./src/"] }],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }, new Date("2026-01-01T00:00:01.000Z"));

    const loaded = await loadProposedExecutionPlan(dir);
    assert.equal(saved.updatedAt, "2026-01-01T00:00:01.000Z");
    assert.deepEqual(loaded?.tasks[0]?.allowedPathPrefixes, ["src"]);
  });
});

test("validateExecutionPlan rejects duplicate task ids and invalid status", () => {
  assert.throws(
    () => validateExecutionPlan({
      version: 1,
      planVersion: 1,
      status: "draft",
      tasks: [
        { id: "T-001", title: "One" },
        { id: "T-001", title: "Two" },
      ],
      createdAt: "now",
      updatedAt: "now",
    }),
    /Duplicate/,
  );

  assert.throws(
    () => validateExecutionPlan({
      version: 1,
      planVersion: 1,
      status: "bad" as never,
      tasks: [],
      createdAt: "now",
      updatedAt: "now",
    }),
    /Invalid execution plan status/,
  );
});

test("applyExecutionPlanTasks creates missing tasks and preserves existing tasks", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    state.tasks = [{ id: "T-001", title: "Existing", status: "ready", updatedAt: state.createdAt }];
    const result = await applyExecutionPlanTasks(dir, state, {
      version: 1,
      planVersion: 1,
      status: "active",
      tasks: [
        { id: "T-001", title: "Existing changed" },
        validPlanTask("T-002", "New task", { prdRefs: ["REQ-001"], allowedPathPrefixes: ["src"], dependsOn: ["T-001"] }),
      ],
      createdAt: state.createdAt,
      updatedAt: state.createdAt,
    });

    assert.deepEqual(result.existingTaskIds, ["T-001"]);
    assert.deepEqual(result.createdTaskIds, ["T-002"]);
    assert.equal(result.state.tasks.find((task) => task.id === "T-001")?.title, "Existing");
    const created = result.state.tasks.find((task) => task.id === "T-002");
    assert.equal(created?.status, "pending");
    assert.deepEqual(created?.prdRefs, ["REQ-001"]);
    assert.deepEqual(created?.allowedPathPrefixes, ["src"]);
    assert.deepEqual(created?.dependsOn, ["T-001"]);
  });
});

test("applyPlanningReport syncs requirements plan tasks prd refs and coverage diagnostics", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    state.tasks = [{ id: "T-EXIST", title: "Existing", status: "ready", updatedAt: state.createdAt }];

    const result = await applyPlanningReport(dir, state, {
      id: "PLAN-RPT-1",
      reason: "Initial planner output",
      source: "unit-test",
      requirements: [
        { id: "REQ-1", statement: "Do one" },
        { id: "REQ-2", statement: "Do two" },
      ],
      plan: {
        planVersion: 7,
        status: "active",
        tasks: [
          validPlanTask("T-EXIST", "Existing updated", { prdRefs: ["REQ-1"], allowedPathPrefixes: ["src"] }),
          validPlanTask("T-NEW", "New", { prdRefs: ["REQ-2"], allowedPathPrefixes: ["test"] }),
        ],
      },
    }, new Date("2026-01-01T00:00:01.000Z"));

    const requirements = await loadPrdRequirements(dir);
    const coverage = await loadPrdCoverage(dir);
    const summary = computePrdCoverageSummary(requirements, coverage, result.state);

    assert.equal(result.accepted, true);
    assert.deepEqual(result.report.updatedTaskIds, ["T-EXIST"]);
    assert.deepEqual(result.report.createdTaskIds, ["T-NEW"]);
    assert.deepEqual(result.state.tasks.find((task) => task.id === "T-EXIST")?.prdRefs, ["REQ-1"]);
    assert.deepEqual(requirements.requirements.map((requirement) => requirement.id).sort(), ["REQ-1", "REQ-2"]);
    assert.deepEqual(summary.unlinkedRequirementIds, []);
    assert.equal((await loadExecutionPlan(dir)).planVersion, 7);
    assert.match(formatPlanningReports(await loadPlanningReports(dir)), /PLAN-RPT-1/);
  });
});

test("applyPlanningReport reports coverage warnings for unlinked and unknown refs", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    const result = await applyPlanningReport(dir, state, {
      requirements: [{ id: "REQ-KNOWN", statement: "Known" }],
      plan: {
        planVersion: 1,
        status: "active",
        tasks: [
          validPlanTask("T-LINK", "Unknown ref", { prdRefs: ["REQ-UNKNOWN"] }),
          validPlanTask("T-NOREF", "No ref"),
        ],
      },
    });

    assert.equal(result.accepted, false);
    assert.deepEqual(result.report.diagnostics.unlinkedRequirementIds, ["REQ-KNOWN"]);
    assert.deepEqual(result.report.diagnostics.unknownPlanRequirementIds, ["REQ-UNKNOWN"]);
    assert.deepEqual(result.report.diagnostics.planUnlinkedTaskIds, ["T-NOREF"]);
  });
});

test("planning report rejects requirement amendments before plan or task writes", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    await upsertPrdRequirement(dir, { id: "REQ-LOCKED", statement: "Original user scope" });
    const before = await loadPrdRequirements(dir);

    await assert.rejects(() => applyPlanningReport(dir, state, {
      id: "PLAN-UNAUTHORIZED",
      source: "user",
      requirements: [{ id: "REQ-LOCKED", statement: "Planner-expanded scope", source: "user" }],
      plan: {
        planVersion: 1,
        status: "active",
        tasks: [validPlanTask("T-UNAUTHORIZED", "Unauthorized task", { prdRefs: ["REQ-LOCKED"] })],
      },
    }), /amendment authority.*explicit user command/i);

    assert.deepEqual(await loadPrdRequirements(dir), before);
    assert.deepEqual((await loadExecutionPlan(dir)).tasks, []);
    assert.equal(state.tasks.length, 0);
  });
});

test("planning report rejects an invalid plan before requirement ledger writes", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));

    await assert.rejects(() => applyPlanningReport(dir, state, {
      id: "PLAN-DUPLICATE",
      requirements: [{ id: "REQ-NOT-WRITTEN", statement: "Must remain absent", status: "pending" }],
      plan: {
        planVersion: 1,
        status: "active",
        tasks: [validPlanTask("T-DUP", "First"), validPlanTask("T-DUP", "Duplicate")],
      },
    }), /duplicate execution plan task id/i);

    assert.deepEqual((await loadPrdRequirements(dir)).requirements, []);
    assert.deepEqual((await loadPrdCoverage(dir)).entries, []);
    assert.deepEqual(await loadPrdChanges(dir), []);
    assert.deepEqual((await loadExecutionPlan(dir)).tasks, []);
    assert.deepEqual(state.tasks, []);
  });
});

test("summarizeExecutionPlan reports task and requirement coverage", () => {
  const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
  state.tasks = [
    { id: "T-001", status: "validated", prdRefs: ["REQ-001"], updatedAt: state.createdAt },
    { id: "T-003", status: "ready", updatedAt: state.createdAt },
  ];
  const summary = summarizeExecutionPlan(
    {
      version: 1,
      planVersion: 2,
      status: "active",
      tasks: [
        { id: "T-001", title: "One", prdRefs: ["REQ-001"] },
        { id: "T-002", title: "Two", prdRefs: ["REQ-002"] },
        { id: "T-003", title: "Three" },
      ],
      createdAt: state.createdAt,
      updatedAt: state.createdAt,
    },
    { version: 1, requirements: [
      { id: "REQ-001", statement: "One", createdAt: state.createdAt, updatedAt: state.createdAt },
      { id: "REQ-002", statement: "Two", createdAt: state.createdAt, updatedAt: state.createdAt },
      { id: "REQ-003", statement: "Three", createdAt: state.createdAt, updatedAt: state.createdAt },
    ] },
    state,
  );

  assert.equal(summary.plannedTaskCount, 3);
  assert.equal(summary.createdTaskCount, 2);
  assert.deepEqual(summary.missingTaskIds, ["T-002"]);
  assert.equal(summary.validatedPlannedTaskCount, 1);
  assert.deepEqual(summary.linkedRequirementIds, ["REQ-001", "REQ-002"]);
  assert.deepEqual(summary.unlinkedRequirementIds, ["REQ-003"]);
  assert.deepEqual(summary.planUnlinkedTaskIds, ["T-003"]);
  assert.match(formatExecutionPlanSummary(summary), /missing=1/);
});

test("checkExecutionPlanPreservation reports dropped validated tasks and coverage", () => {
  const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
  state.tasks = [
    { id: "T-001", status: "validated", prdRefs: ["REQ-001"], updatedAt: state.createdAt },
    { id: "T-002", status: "ready", prdRefs: ["REQ-002"], updatedAt: state.createdAt },
  ];
  const currentPlan = {
    version: 1 as const,
    planVersion: 1,
    status: "active" as const,
    tasks: [
      { id: "T-001", title: "One", prdRefs: ["REQ-001"] },
      { id: "T-002", title: "Two", prdRefs: ["REQ-002"] },
    ],
    createdAt: state.createdAt,
    updatedAt: state.createdAt,
  };
  const nextPlan = {
    version: 1 as const,
    planVersion: 2,
    status: "active" as const,
    tasks: [
      { id: "T-002", title: "Two", prdRefs: ["REQ-002"] },
      { id: "T-003", title: "Three" },
    ],
    createdAt: state.createdAt,
    updatedAt: state.createdAt,
  };

  const check = checkExecutionPlanPreservation(currentPlan, nextPlan, {
    version: 1,
    requirements: [
      { id: "REQ-001", statement: "One", createdAt: state.createdAt, updatedAt: state.createdAt },
      { id: "REQ-002", statement: "Two", createdAt: state.createdAt, updatedAt: state.createdAt },
      { id: "REQ-003", statement: "Three", createdAt: state.createdAt, updatedAt: state.createdAt },
    ],
  }, state);

  assert.equal(check.ok, false);
  assert.deepEqual(check.droppedValidatedTaskIds, ["T-001"]);
  assert.deepEqual(check.droppedValidatedRequirementIds, ["REQ-001"]);
  assert.deepEqual(check.unlinkedRequirementIds, ["REQ-001", "REQ-003"]);
  assert.deepEqual(check.planUnlinkedTaskIds, ["T-003"]);
  assert.match(formatExecutionPlanPreservationCheck(check), /Plan preservation: blocked/);
});

test("checkExecutionPlanPreservation passes when validated tasks and requirements remain linked", () => {
  const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
  state.tasks = [{ id: "T-001", status: "validated", prdRefs: ["REQ-001"], updatedAt: state.createdAt }];
  const currentPlan = {
    version: 1 as const,
    planVersion: 1,
    status: "active" as const,
    tasks: [{ id: "T-001", title: "One", prdRefs: ["REQ-001"] }],
    createdAt: state.createdAt,
    updatedAt: state.createdAt,
  };
  const nextPlan = { ...currentPlan, planVersion: 2 };

  const check = checkExecutionPlanPreservation(currentPlan, nextPlan, {
    version: 1,
    requirements: [{ id: "REQ-001", statement: "One", createdAt: state.createdAt, updatedAt: state.createdAt }],
  }, state);

  assert.equal(check.ok, true);
  assert.deepEqual(check.preservedValidatedTaskIds, ["T-001"]);
  assert.deepEqual(check.preservedValidatedRequirementIds, ["REQ-001"]);
});

test("loadReplanRequests returns empty default when missing", async () => {
  await withTempDir(async (dir) => {
    assert.deepEqual(await loadReplanRequests(dir), []);
    assert.equal(formatReplanRequests([]), "No replan requests.");
  });
});

test("appendReplanRequest stores normalized newest-first requests", async () => {
  await withTempDir(async (dir) => {
    await appendReplanRequest(dir, {
      id: "REPLAN-001",
      trigger: "manual",
      reason: "Need a safer plan",
      taskId: "T-001",
      evidenceRefs: [" evidence-1 ", "evidence-1", ""],
      requirementRefs: ["REQ-001"],
      planVersion: 3,
    }, new Date("2026-01-01T00:00:00.000Z"));
    await appendReplanRequest(dir, {
      id: "REPLAN-002",
      trigger: "validation_blocked",
      reason: "Blocked validation",
    }, new Date("2026-01-01T00:00:01.000Z"));

    const requests = await loadReplanRequests(dir);
    assert.deepEqual(requests.map((request) => request.id), ["REPLAN-002", "REPLAN-001"]);
    assert.deepEqual(requests[1]?.evidenceRefs, ["evidence-1"]);
    assert.match(formatReplanRequests(requests), /REPLAN-001: open trigger=manual task=T-001 reqs=REQ-001 evidence=evidence-1/);
  });
});

test("validateReplanRequest rejects invalid status, trigger, and reason", () => {
  const valid = {
    id: "REPLAN-001",
    status: "open" as const,
    trigger: "manual" as const,
    reason: "Need replan",
    createdAt: "now",
    updatedAt: "now",
  };

  assert.throws(() => validateReplanRequest({ ...valid, status: "bad" as never }), /Invalid replan request status/);
  assert.throws(() => validateReplanRequest({ ...valid, trigger: "bad" as never }), /Invalid replan request trigger/);
  assert.throws(() => validateReplanRequest({ ...valid, reason: " " }), /reason is required/);
});

test("acceptReplanProposal snapshots, saves proposed plan, applies tasks, resolves requests, and records decision", async () => {
  await withTempDir(async (dir) => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const state = createDefaultState(now);
    state.tasks = [{ id: "T-001", status: "validated", prdRefs: ["REQ-001"], updatedAt: state.createdAt }];
    state.validatedTaskIds = ["T-001"];
    const currentPlan = await saveExecutionPlan(dir, {
      version: 1,
      planVersion: 1,
      status: "active",
      tasks: [{ id: "T-001", title: "Validated", prdRefs: ["REQ-001"] }],
      createdAt: state.createdAt,
      updatedAt: state.createdAt,
    }, now);
    await saveProposedExecutionPlan(dir, {
      version: 1,
      planVersion: 2,
      status: "draft",
      tasks: [
        { id: "T-001", title: "Validated", prdRefs: ["REQ-001"] },
        validPlanTask("T-002", "New work", { prdRefs: ["REQ-002"], allowedPathPrefixes: ["src"] }),
      ],
      createdAt: state.createdAt,
      updatedAt: state.createdAt,
    }, now);
    await appendReplanRequest(dir, { id: "REPLAN-001", trigger: "manual", reason: "Need new task" }, now);

    const result = await acceptReplanProposal(dir, state, {
      version: 1,
      requirements: [
        { id: "REQ-001", statement: "One", createdAt: state.createdAt, updatedAt: state.createdAt },
        { id: "REQ-002", statement: "Two", createdAt: state.createdAt, updatedAt: state.createdAt },
      ],
    }, { currentPlan, now: new Date("2026-01-01T00:00:01.000Z") });

    assert.equal(result.accepted, true);
    assert.equal(result.savedPlan?.status, "active");
    assert.equal(result.savedPlan?.planVersion, 2);
    assert.equal(result.snapshotPath, ".scaler/plans/versions/PLAN-v001.json");
    assert.deepEqual(result.applyResult?.createdTaskIds, ["T-002"]);
    assert.equal(result.state.tasks.find((task) => task.id === "T-002")?.status, "pending");
    assert.equal((await loadReplanRequests(dir))[0]?.status, "resolved");
    assert.equal((await loadReplanDecisions(dir))[0]?.status, "accepted");
    assert.equal((await loadExecutionPlan(dir)).tasks.length, 2);
  });
});

test("acceptReplanProposal rejects unsafe proposals and records decision", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    state.tasks = [{ id: "T-001", status: "validated", prdRefs: ["REQ-001"], updatedAt: state.createdAt }];
    const currentPlan = {
      version: 1 as const,
      planVersion: 1,
      status: "active" as const,
      tasks: [{ id: "T-001", title: "Validated", prdRefs: ["REQ-001"] }],
      createdAt: state.createdAt,
      updatedAt: state.createdAt,
    };
    const proposedPlan = {
      version: 1 as const,
      planVersion: 2,
      status: "draft" as const,
      tasks: [{ id: "T-002", title: "Drops validated", prdRefs: ["REQ-002"] }],
      createdAt: state.createdAt,
      updatedAt: state.createdAt,
    };

    const result = await acceptReplanProposal(dir, state, {
      version: 1,
      requirements: [{ id: "REQ-001", statement: "One", createdAt: state.createdAt, updatedAt: state.createdAt }],
    }, { currentPlan, proposedPlan, now: new Date("2026-01-01T00:00:01.000Z") });

    assert.equal(result.accepted, false);
    assert.match(result.message, /failed preservation/);
    assert.deepEqual(result.decision.preservation.droppedValidatedTaskIds, ["T-001"]);
    assert.equal((await loadReplanDecisions(dir))[0]?.status, "rejected");
    assert.equal((await loadExecutionPlan(dir)).tasks.length, 0);
  });
});

test("appendReplanDecision stores newest-first decisions and formats them", async () => {
  await withTempDir(async (dir) => {
    const preservation = {
      ok: true,
      preservedValidatedTaskIds: [],
      droppedValidatedTaskIds: [],
      preservedValidatedRequirementIds: [],
      droppedValidatedRequirementIds: [],
      unlinkedRequirementIds: [],
      planUnlinkedTaskIds: [],
    };
    await appendReplanDecision(dir, {
      id: "DECISION-001",
      status: "accepted",
      summary: "Accepted proposal",
      requestIds: ["REPLAN-001"],
      previousPlanVersion: 1,
      proposedPlanVersion: 2,
      snapshotPath: ".scaler/plans/versions/PLAN-v001.json",
      preservation,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    await appendReplanDecision(dir, {
      id: "DECISION-002",
      status: "rejected",
      summary: "Rejected proposal",
      requestIds: [],
      previousPlanVersion: 1,
      proposedPlanVersion: 3,
      preservation,
      createdAt: "2026-01-01T00:00:01.000Z",
    });

    const decisions = await loadReplanDecisions(dir);
    assert.deepEqual(decisions.map((decision) => decision.id), ["DECISION-002", "DECISION-001"]);
    assert.match(formatReplanDecisions(decisions), /DECISION-001: accepted previous=1 proposed=2 snapshot=.scaler\/plans\/versions\/PLAN-v001.json/);
  });
});

test("createExecutionPlanSnapshot writes incrementing version files", async () => {
  await withTempDir(async (dir) => {
    const plan = await saveExecutionPlan(dir, {
      version: 1,
      planVersion: 1,
      status: "active",
      tasks: [{ id: "T-001", title: "Do work" }],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    assert.equal(await createExecutionPlanSnapshot(dir, { plan }), ".scaler/plans/versions/PLAN-v001.json");
    assert.equal(await createExecutionPlanSnapshot(dir, { plan }), ".scaler/plans/versions/PLAN-v002.json");
  });
});

/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  type ExecutionPlanArtifact,
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
  saveReplanRequests,
  summarizeExecutionPlan,
  validateExecutionPlan,
  validateReplanRequest,
} from "../src/plans.js";
import { amendPrdRequirement, computePrdCoverageSummary, loadPrdChanges, loadPrdCoverage, loadPrdRequirements, savePrdCoverage, savePrdRequirements, upsertPrdRequirement } from "../src/prd.js";
import { createDefaultState, loadState, saveState } from "../src/state.js";
import { saveValidationManifest } from "../src/validation.js";

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
          id: "T-000",
          title: "Prepare work",
        },
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
    const task = loaded.tasks.find((candidate) => candidate.id === "T-001");
    assert.deepEqual(task?.prdRefs, ["REQ-001"]);
    assert.deepEqual(task?.allowedPathPrefixes, ["src"]);
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

test("validateExecutionPlan rejects unknown dependencies and dependency cycles", () => {
  const plan = (tasks: ExecutionPlanArtifact["tasks"]): ExecutionPlanArtifact => ({
    version: 1,
    planVersion: 1,
    status: "draft",
    tasks,
    createdAt: "now",
    updatedAt: "now",
  });

  assert.throws(
    () => validateExecutionPlan(plan([{ id: "T-001", title: "One", dependsOn: ["T-MISSING"] }])),
    /unknown dependency T-MISSING.*T-001/i,
  );
  assert.throws(
    () => validateExecutionPlan(plan([{ id: "T-SELF", title: "Self", dependsOn: ["T-SELF"] }])),
    /dependency cycle.*T-SELF.*T-SELF/i,
  );
  assert.throws(
    () => validateExecutionPlan(plan([
      { id: "T-A", title: "A", dependsOn: ["T-B"] },
      { id: "T-B", title: "B", dependsOn: ["T-C"] },
      { id: "T-C", title: "C", dependsOn: ["T-A"] },
    ])),
    /dependency cycle.*T-A.*T-B.*T-C.*T-A/i,
  );

  assert.doesNotThrow(() => validateExecutionPlan(plan([
    { id: "T-A", title: "A", dependsOn: ["T-B"] },
    { id: "T-B", title: "B" },
  ])));
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

test("applyPlanningReport rejects structural coverage gaps before publication", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));

    await assert.rejects(() => applyPlanningReport(dir, state, {
      requirements: [{ id: "REQ-KNOWN", statement: "Known" }],
      plan: {
        planVersion: 1,
        status: "active",
        tasks: [
          validPlanTask("T-LINK", "Unknown ref", { prdRefs: ["REQ-UNKNOWN"] }),
          validPlanTask("T-NOREF", "No ref"),
        ],
      },
    }), /coverage preflight.*unlinked=REQ-KNOWN.*unknown=REQ-UNKNOWN.*tasksWithoutPrdRefs=T-NOREF/i);

    assert.deepEqual((await loadPrdRequirements(dir)).requirements, []);
    assert.deepEqual((await loadPrdCoverage(dir)).entries, []);
    assert.deepEqual(await loadPrdChanges(dir), []);
    assert.deepEqual((await loadExecutionPlan(dir)).tasks, []);
    assert.deepEqual(await loadPlanningReports(dir), []);
    assert.deepEqual(state.tasks, []);
  });
});

test("applyPlanningReport preserves an uncovered persisted requirement without partial publication", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    await upsertPrdRequirement(dir, { id: "REQ-PERSISTED", statement: "Persisted scope" });
    const beforeRequirements = await loadPrdRequirements(dir);
    const beforeCoverage = await loadPrdCoverage(dir);
    const beforeChanges = await loadPrdChanges(dir);

    await assert.rejects(() => applyPlanningReport(dir, state, {
      requirements: [{ id: "REQ-NEW", statement: "New scope" }],
      plan: {
        planVersion: 1,
        status: "active",
        tasks: [validPlanTask("T-NEW", "New task", { prdRefs: ["REQ-NEW"] })],
      },
    }), /coverage preflight.*unlinked=REQ-PERSISTED/i);

    assert.deepEqual(await loadPrdRequirements(dir), beforeRequirements);
    assert.deepEqual(await loadPrdCoverage(dir), beforeCoverage);
    assert.deepEqual(await loadPrdChanges(dir), beforeChanges);
    assert.deepEqual((await loadExecutionPlan(dir)).tasks, []);
    assert.deepEqual(await loadPlanningReports(dir), []);
    assert.deepEqual(state.tasks, []);
  });
});

test("applyPlanningReport accepts a compact one-task one-requirement plan", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    const result = await applyPlanningReport(dir, state, {
      requirements: [{ id: "REQ-COMPACT", statement: "One bounded outcome" }],
      plan: {
        planVersion: 1,
        status: "active",
        tasks: [validPlanTask("T-COMPACT", "One bounded task", { prdRefs: ["REQ-COMPACT"] })],
      },
    });

    assert.equal(result.accepted, true);
    assert.deepEqual(result.state.tasks.map((task) => task.id), ["T-COMPACT"]);
  });
});

test("applyPlanningReport rejects an incomplete covered task before publication", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));

    await assert.rejects(() => applyPlanningReport(dir, state, {
      requirements: [{ id: "REQ-CONTRACT", statement: "One covered outcome" }],
      plan: {
        planVersion: 1,
        status: "active",
        tasks: [{ id: "T-COARSE", title: "Coarse future work", prdRefs: ["REQ-CONTRACT"] }],
      },
    }), /task contract preflight.*T-COARSE.*missing_dod.*missing_allowed_paths.*missing_atomicity.*missing_validation.*missing_test_first/i);

    assert.deepEqual((await loadPrdRequirements(dir)).requirements, []);
    assert.deepEqual((await loadPrdCoverage(dir)).entries, []);
    assert.deepEqual(await loadPrdChanges(dir), []);
    assert.deepEqual((await loadExecutionPlan(dir)).tasks, []);
    assert.deepEqual(await loadPlanningReports(dir), []);
    assert.deepEqual(state.tasks, []);
  });
});

test("applyPlanningReport honors an explicit task-quality waiver during preflight", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    const task = validPlanTask("T-WAIVED", "Waived path scope", {
      prdRefs: ["REQ-WAIVED"],
      allowedPathPrefixes: undefined,
      qualityWaivers: [{ code: "missing_allowed_paths", reason: "This bounded non-filesystem check has no project path." }],
    });

    const result = await applyPlanningReport(dir, state, {
      requirements: [{ id: "REQ-WAIVED", statement: "Perform the bounded non-filesystem check" }],
      plan: { planVersion: 1, status: "active", tasks: [task] },
    });

    assert.equal(result.accepted, true);
    assert.deepEqual(result.state.tasks[0]?.qualityWaivers?.map((waiver) => waiver.code), ["missing_allowed_paths"]);
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

test("planning report rejects an unknown dependency before any publication", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));

    await assert.rejects(() => applyPlanningReport(dir, state, {
      id: "PLAN-UNKNOWN-DEPENDENCY",
      requirements: [{ id: "REQ-NOT-WRITTEN", statement: "Must remain absent", status: "pending" }],
      plan: {
        planVersion: 1,
        status: "active",
        tasks: [validPlanTask("T-BLOCKED", "Blocked task", {
          prdRefs: ["REQ-NOT-WRITTEN"],
          dependsOn: ["T-MISSING"],
        })],
      },
    }), /unknown dependency T-MISSING.*T-BLOCKED/i);

    assert.deepEqual((await loadPrdRequirements(dir)).requirements, []);
    assert.deepEqual((await loadPrdCoverage(dir)).entries, []);
    assert.deepEqual(await loadPrdChanges(dir), []);
    assert.deepEqual((await loadExecutionPlan(dir)).tasks, []);
    assert.deepEqual(await loadPlanningReports(dir), []);
    assert.deepEqual(state.tasks, []);
  });
});

test("planning report rejects a duplicate persisted catalog before publishing an empty-requirements plan", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    await saveState(dir, state);
    await upsertPrdRequirement(dir, { id: "REQ-DUP", statement: "Initial requirement." });
    await writeFile(join(dir, ".scaler", "prd", "requirements.json"), `${JSON.stringify({
      version: 1,
      requirements: [
        { id: "REQ-DUP", statement: "First copy.", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
        { id: "REQ-DUP", statement: "Second copy.", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
      ],
    })}\n`, "utf8");

    await assert.rejects(() => applyPlanningReport(dir, state, {
      id: "PLAN-CORRUPT-CATALOG",
      requirements: [],
      plan: {
        planVersion: 1,
        status: "active",
        tasks: [validPlanTask("T-MUST-NOT-PUBLISH", "Must not publish")],
      },
    }), /duplicate id REQ-DUP/i);

    assert.deepEqual((await loadExecutionPlan(dir)).tasks, []);
    assert.deepEqual(await loadPlanningReports(dir), []);
    assert.deepEqual((await loadState(dir)).tasks, []);
  });
});

test("planning report rejects unreadable validation inputs before any publication", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));

    await assert.rejects(() => applyPlanningReport(dir, state, {
      id: "PLAN-MISSING-VALIDATOR",
      requirements: [{ id: "REQ-MISSING-VALIDATOR", statement: "Validation basis must be readable." }],
      plan: {
        planVersion: 1,
        status: "active",
        tasks: [validPlanTask("T-MISSING-VALIDATOR", "Missing validator", {
          prdRefs: ["REQ-MISSING-VALIDATOR"],
          validationInputPaths: ["missing.cjs"],
        })],
      },
    }), /rejected before publication.*validation input.*missing\.cjs/i);

    assert.deepEqual((await loadPrdRequirements(dir)).requirements, []);
    assert.deepEqual((await loadPrdCoverage(dir)).entries, []);
    assert.deepEqual(await loadPrdChanges(dir), []);
    assert.deepEqual((await loadExecutionPlan(dir)).tasks, []);
    assert.deepEqual((await loadPlanningReports(dir)), []);
    assert.deepEqual(state.tasks, []);
  });
});

test("planning report preflights inherited validation inputs before any publication", async () => {
  await withTempDir(async (dir) => {
    await writeFile(join(dir, "check.cjs"), "process.exit(0);\n");
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    state.tasks = [{
      id: "T-INHERITED-VALIDATOR",
      title: "Original task",
      status: "pending",
      taskKind: "software",
      atomicityRationale: "One independently testable result.",
      allowedPathPrefixes: ["src"],
      definitionOfDone: ["Original requirement remains intact."],
      updatedAt: state.updatedAt,
    }];
    await saveState(dir, state);
    await saveValidationManifest(dir, {
      taskId: "T-INHERITED-VALIDATOR",
      validationInputPaths: ["check.cjs"],
      definitionOfDone: state.tasks[0]!.definitionOfDone,
      commands: [
        { id: "test-first", command: "node check.cjs", gate: "test_first", required: true },
        { id: "unit", command: "node check.cjs", gate: "unit_tests", required: true },
      ],
      createdAt: "",
      updatedAt: "",
    });
    await unlink(join(dir, "check.cjs"));

    await assert.rejects(async () => applyPlanningReport(dir, await loadState(dir), {
      id: "PLAN-INHERITED-VALIDATOR",
      requirements: [{ id: "REQ-NOT-WRITTEN", statement: "Must remain absent" }],
      plan: {
        planVersion: 2,
        status: "active",
        tasks: [validPlanTask("T-INHERITED-VALIDATOR", "Updated task", {
          prdRefs: ["REQ-NOT-WRITTEN"],
        })],
      },
    }), /rejected before publication.*validation input.*check\.cjs/i);

    assert.deepEqual((await loadPrdRequirements(dir)).requirements, []);
    assert.deepEqual((await loadPrdCoverage(dir)).entries, []);
    assert.deepEqual(await loadPrdChanges(dir), []);
    assert.deepEqual((await loadExecutionPlan(dir)).tasks, []);
    assert.deepEqual(await loadPlanningReports(dir), []);
    assert.equal((await loadState(dir)).tasks[0]?.title, "Original task");
  });
});

test("planning report preflights a manifest configured before task creation", async () => {
  await withTempDir(async (dir) => {
    await writeFile(join(dir, "check.cjs"), "process.exit(0);\n");
    await saveValidationManifest(dir, {
      taskId: "T-PRECONFIGURED-VALIDATOR",
      validationInputPaths: ["check.cjs"],
      definitionOfDone: ["Planned task remains unpublished on refusal."],
      commands: [
        { id: "test-first", command: "node check.cjs", gate: "test_first", required: true },
        { id: "unit", command: "node check.cjs", gate: "unit_tests", required: true },
      ],
      createdAt: "",
      updatedAt: "",
    });
    await unlink(join(dir, "check.cjs"));
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));

    await assert.rejects(() => applyPlanningReport(dir, state, {
      id: "PLAN-PRECONFIGURED-VALIDATOR",
      requirements: [{ id: "REQ-NOT-WRITTEN", statement: "Must remain absent" }],
      plan: {
        planVersion: 1,
        status: "active",
        tasks: [validPlanTask("T-PRECONFIGURED-VALIDATOR", "New task", {
          prdRefs: ["REQ-NOT-WRITTEN"],
        })],
      },
    }), /rejected before publication.*validation input.*check\.cjs/i);

    assert.deepEqual((await loadPrdRequirements(dir)).requirements, []);
    assert.deepEqual((await loadPrdCoverage(dir)).entries, []);
    assert.deepEqual(await loadPrdChanges(dir), []);
    assert.deepEqual((await loadExecutionPlan(dir)).tasks, []);
    assert.deepEqual(await loadPlanningReports(dir), []);
    assert.deepEqual((await loadState(dir)).tasks, []);
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

test("acceptReplanProposal reopens only validated tasks linked to needs_replan coverage", async () => {
  await withTempDir(async (dir) => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const state = createDefaultState(now);
    state.stage = "replanning";
    state.tasks = [
      { id: "T-AFFECTED", title: "Old affected work", status: "validated", prdRefs: ["REQ-AFFECTED"], updatedAt: state.createdAt },
      { id: "T-KEEP", title: "Keep accepted work", status: "validated", prdRefs: ["REQ-KEEP"], updatedAt: state.createdAt },
    ];
    state.validatedTaskIds = ["T-AFFECTED", "T-KEEP"];
    state.completedTaskIds = ["T-AFFECTED", "T-KEEP"];
    await saveState(dir, state);
    await savePrdCoverage(dir, {
      version: 1,
      entries: [
        {
          requirementId: "REQ-AFFECTED",
          status: "needs_replan",
          taskIds: ["T-AFFECTED"],
          evidenceRefs: ["validation:affected:v1"],
          notes: "Historical acceptance before the requirement changed.",
          updatedAt: now.toISOString(),
        },
        {
          requirementId: "REQ-KEEP",
          status: "validated",
          taskIds: ["T-KEEP"],
          evidenceRefs: ["validation:keep:v1"],
          updatedAt: now.toISOString(),
        },
      ],
    });
    const currentPlan = await saveExecutionPlan(dir, {
      version: 1,
      planVersion: 1,
      status: "active",
      tasks: [
        validPlanTask("T-AFFECTED", "Old affected work", { prdRefs: ["REQ-AFFECTED"] }),
        validPlanTask("T-KEEP", "Keep accepted work", { prdRefs: ["REQ-KEEP"] }),
      ],
      createdAt: state.createdAt,
      updatedAt: state.createdAt,
    }, now);
    const proposedPlan: ExecutionPlanArtifact = {
      version: 1,
      planVersion: 2,
      status: "draft",
      tasks: [
        validPlanTask("T-AFFECTED", "Old affected work", { prdRefs: ["REQ-AFFECTED"] }),
        validPlanTask("T-KEEP", "Keep accepted work", { prdRefs: ["REQ-KEEP"] }),
      ],
      createdAt: state.createdAt,
      updatedAt: state.createdAt,
    };
    const requirements = {
      version: 1 as const,
      requirements: [
        { id: "REQ-AFFECTED", statement: "Changed", createdAt: state.createdAt, updatedAt: state.createdAt },
        { id: "REQ-KEEP", statement: "Stable", createdAt: state.createdAt, updatedAt: state.createdAt },
      ],
    };
    await savePrdRequirements(dir, requirements);

    const result = await acceptReplanProposal(dir, state, requirements, {
      currentPlan,
      proposedPlan,
      now: new Date("2026-01-01T00:01:00.000Z"),
    });

    assert.equal(result.accepted, true, result.message);
    assert.equal(result.state.tasks.find((task) => task.id === "T-AFFECTED")?.status, "ready");
    assert.equal(result.state.tasks.find((task) => task.id === "T-KEEP")?.status, "validated");
    assert.deepEqual(result.state.validatedTaskIds, ["T-KEEP"]);
    assert.deepEqual(result.state.completedTaskIds, ["T-KEEP"]);
    assert.deepEqual(result.decision.reopenedTaskIds, ["T-AFFECTED"]);
    assert.deepEqual((await loadPrdCoverage(dir)).entries, [
      {
        requirementId: "REQ-AFFECTED",
        status: "in_progress",
        taskIds: ["T-AFFECTED"],
        evidenceRefs: ["validation:affected:v1"],
        notes: "Historical acceptance before the requirement changed.",
        updatedAt: "2026-01-01T00:01:00.000Z",
      },
      {
        requirementId: "REQ-KEEP",
        status: "validated",
        taskIds: ["T-KEEP"],
        evidenceRefs: ["validation:keep:v1"],
        updatedAt: now.toISOString(),
      },
    ]);
  });
});

test("acceptReplanProposal resumes an applying decision without losing audit or unrelated invalidation", async () => {
  await withTempDir(async (dir) => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const state = createDefaultState(now);
    state.stage = "replanning";
    state.tasks = [
      { id: "T-AFFECTED", title: "Affected", status: "ready", prdRefs: ["REQ-AFFECTED"], updatedAt: state.createdAt },
      { id: "T-KEEP", title: "Keep", status: "validated", prdRefs: ["REQ-KEEP"], updatedAt: state.createdAt },
    ];
    state.validatedTaskIds = ["T-KEEP"];
    state.completedTaskIds = ["T-KEEP"];
    await saveState(dir, state);
    await savePrdCoverage(dir, {
      version: 1,
      entries: [
        { requirementId: "REQ-AFFECTED", status: "in_progress", taskIds: ["T-AFFECTED"], updatedAt: now.toISOString() },
        { requirementId: "REQ-KEEP", status: "validated", taskIds: ["T-KEEP"], updatedAt: now.toISOString() },
        { requirementId: "REQ-CONCURRENT", status: "needs_replan", updatedAt: "2026-01-01T00:00:30.000Z" },
      ],
    });
    const currentPlan: ExecutionPlanArtifact = {
      version: 1,
      planVersion: 2,
      status: "active",
      tasks: [
        validPlanTask("T-AFFECTED", "Affected", { prdRefs: ["REQ-AFFECTED"] }),
        validPlanTask("T-KEEP", "Keep", { prdRefs: ["REQ-KEEP"] }),
        validPlanTask("T-CONCURRENT", "Concurrent invalidation", { prdRefs: ["REQ-CONCURRENT"] }),
      ],
      createdAt: state.createdAt,
      updatedAt: state.createdAt,
    };
    await saveExecutionPlan(dir, currentPlan, now);
    const proposedPlan: ExecutionPlanArtifact = { ...currentPlan, status: "draft" };
    const proposalFingerprint = createHash("sha256").update(JSON.stringify(proposedPlan)).digest("hex");
    await saveReplanRequests(dir, [{
      id: "REPLAN-AFFECTED",
      status: "resolved",
      trigger: "plan_replacement",
      reason: "Requirement changed.",
      requirementRefs: ["REQ-AFFECTED"],
      planVersion: 2,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    }]);
    await appendReplanDecision(dir, {
      id: "DECISION-APPLYING",
      status: "applying" as never,
      summary: "Applying proposed execution plan version 2.",
      requestIds: ["REPLAN-AFFECTED"],
      previousPlanVersion: 1,
      proposedPlanVersion: 2,
      snapshotPath: ".scaler/plans/versions/PLAN-v001.json",
      reopenedTaskIds: ["T-AFFECTED"],
      proposalFingerprint,
      affectedRequirementRevisions: { "REQ-AFFECTED": 2 },
      preservation: {
        ok: true,
        preservedValidatedTaskIds: ["T-KEEP"],
        droppedValidatedTaskIds: [],
        preservedValidatedRequirementIds: ["REQ-KEEP"],
        droppedValidatedRequirementIds: [],
        unlinkedRequirementIds: [],
        planUnlinkedTaskIds: [],
      },
      createdAt: now.toISOString(),
    } as never);
    await upsertPrdRequirement(dir, { id: "REQ-AFFECTED", statement: "Original", now });
    await upsertPrdRequirement(dir, { id: "REQ-KEEP", statement: "Stable", now });
    await upsertPrdRequirement(dir, { id: "REQ-CONCURRENT", statement: "Original later", now });
    await amendPrdRequirement(dir, {
      id: "REQ-AFFECTED",
      expectedRevision: 1,
      reason: "Changed for recovery scenario.",
      changes: { statement: "Changed" },
      now,
    });
    await amendPrdRequirement(dir, {
      id: "REQ-CONCURRENT",
      expectedRevision: 1,
      reason: "Changed concurrently.",
      changes: { statement: "Changed later" },
      now,
    });
    const requirements = await loadPrdRequirements(dir);
    await savePrdCoverage(dir, {
      version: 1,
      entries: [
        { requirementId: "REQ-AFFECTED", status: "in_progress", taskIds: ["T-AFFECTED"], updatedAt: now.toISOString() },
        { requirementId: "REQ-KEEP", status: "validated", taskIds: ["T-KEEP"], updatedAt: now.toISOString() },
        { requirementId: "REQ-CONCURRENT", status: "needs_replan", updatedAt: "2026-01-01T00:00:30.000Z" },
      ],
    });

    const result = await acceptReplanProposal(dir, state, requirements, {
      currentPlan,
      proposedPlan,
      now: new Date("2026-01-01T00:01:00.000Z"),
    });

    assert.equal(result.accepted, true, result.message);
    assert.equal(result.savedPlan?.planVersion, 2);
    assert.equal(result.decision.id, "DECISION-APPLYING");
    assert.equal(result.decision.status, "accepted");
    assert.deepEqual(result.decision.reopenedTaskIds, ["T-AFFECTED"]);
    assert.deepEqual(result.decision.requestIds, ["REPLAN-AFFECTED"]);
    assert.equal((await loadReplanDecisions(dir)).length, 1);
    const coverage = await loadPrdCoverage(dir);
    assert.equal(coverage.entries.find((entry) => entry.requirementId === "REQ-AFFECTED")?.status, "in_progress");
    assert.equal(coverage.entries.find((entry) => entry.requirementId === "REQ-CONCURRENT")?.status, "needs_replan");

    const retried = await acceptReplanProposal(dir, result.state, requirements, {
      currentPlan: result.savedPlan,
      proposedPlan,
      now: new Date("2026-01-01T00:02:00.000Z"),
    });
    assert.equal(retried.accepted, true, retried.message);
    assert.equal(retried.savedPlan?.planVersion, 2);
    assert.equal(retried.decision.id, "DECISION-APPLYING");
    assert.equal((await loadReplanDecisions(dir)).length, 1);

    await amendPrdRequirement(dir, {
      id: "REQ-AFFECTED",
      expectedRevision: 2,
      reason: "Invalidate the completed acceptance.",
      changes: { statement: "Changed again" },
      now: new Date("2026-01-01T00:03:00.000Z"),
    });
    const amendedRequirements = await loadPrdRequirements(dir);
    await assert.rejects(() => acceptReplanProposal(dir, retried.state, amendedRequirements, {
      currentPlan: retried.savedPlan,
      proposedPlan,
      now: new Date("2026-01-01T00:04:00.000Z"),
    }), /accepted replan decision.*stale.*expected revision 2.*current revision 3/i);
  });
});

test("acceptReplanProposal rejects stale applying coverage before durable plan or task changes", async () => {
  for (const drift of ["coverage", "revision"] as const) {
    await withTempDir(async (dir) => {
      const now = new Date("2026-01-01T00:00:00.000Z");
      const state = createDefaultState(now);
      state.stage = "replanning";
      state.tasks = [{
        id: "T-AFFECTED",
        title: "Affected",
        status: "validated",
        prdRefs: ["REQ-AFFECTED"],
        updatedAt: state.createdAt,
      }];
      state.validatedTaskIds = ["T-AFFECTED"];
      state.completedTaskIds = ["T-AFFECTED"];
      await saveState(dir, state);
      await upsertPrdRequirement(dir, {
        id: "REQ-AFFECTED",
        statement: "Original",
        status: "needs_replan",
        taskIds: ["T-AFFECTED"],
        now,
      });
      await amendPrdRequirement(dir, {
        id: "REQ-AFFECTED",
        expectedRevision: 1,
        reason: "Create the journaled revision.",
        changes: { statement: "Changed" },
        now,
      });
      const currentPlan = await saveExecutionPlan(dir, {
        version: 1,
        planVersion: 1,
        status: "active",
        tasks: [validPlanTask("T-AFFECTED", "Affected", { prdRefs: ["REQ-AFFECTED"] })],
        createdAt: state.createdAt,
        updatedAt: state.createdAt,
      }, now);
      const proposedPlan: ExecutionPlanArtifact = { ...currentPlan, planVersion: 2, status: "draft" };
      const proposalFingerprint = createHash("sha256").update(JSON.stringify(proposedPlan)).digest("hex");
      await appendReplanDecision(dir, {
        id: `DECISION-${drift.toUpperCase()}`,
        status: "applying",
        summary: "Applying proposed execution plan version 2.",
        requestIds: [],
        previousPlanVersion: 1,
        proposedPlanVersion: 2,
        snapshotPath: ".scaler/plans/versions/PLAN-v001.json",
        reopenedTaskIds: ["T-AFFECTED"],
        proposalFingerprint,
        affectedRequirementRevisions: { "REQ-AFFECTED": 2 },
        affectedCoverageUpdatedAts: { "REQ-AFFECTED": now.toISOString() },
        preservation: {
          ok: true,
          preservedValidatedTaskIds: [],
          droppedValidatedTaskIds: [],
          preservedValidatedRequirementIds: [],
          droppedValidatedRequirementIds: [],
          unlinkedRequirementIds: [],
          planUnlinkedTaskIds: [],
        },
        createdAt: now.toISOString(),
      } as never);

      if (drift === "coverage") {
        await upsertPrdRequirement(dir, {
          id: "REQ-AFFECTED",
          statement: "Changed",
          status: "needs_replan",
          taskIds: ["T-AFFECTED"],
          now: new Date("2026-01-01T00:00:30.000Z"),
        });
      } else {
        await amendPrdRequirement(dir, {
          id: "REQ-AFFECTED",
          expectedRevision: 2,
          reason: "Invalidate the applying decision.",
          changes: { statement: "Changed again" },
          now: new Date("2026-01-01T00:00:30.000Z"),
        });
      }

      const requirements = await loadPrdRequirements(dir);
      await assert.rejects(() => acceptReplanProposal(dir, state, requirements, {
        currentPlan,
        proposedPlan,
        now: new Date("2026-01-01T00:01:00.000Z"),
      }), /stale replan|replan coverage.*changed/i);

      assert.equal((await loadExecutionPlan(dir)).planVersion, 1);
      assert.equal((await loadState(dir)).tasks[0]?.status, "validated");
      assert.deepEqual((await loadState(dir)).validatedTaskIds, ["T-AFFECTED"]);
      assert.equal((await loadPrdCoverage(dir)).entries[0]?.status, "needs_replan");
      assert.equal((await loadReplanDecisions(dir))[0]?.status, "applying");
    });
  }
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

test("acceptReplanProposal rejects an incomplete new task before publishing the plan", async () => {
  await withTempDir(async (dir) => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const state = createDefaultState(now);
    state.tasks = [{ id: "T-001", title: "Validated", status: "validated", prdRefs: ["REQ-001"], updatedAt: state.createdAt }];
    state.validatedTaskIds = ["T-001"];
    const currentPlan = await saveExecutionPlan(dir, {
      version: 1,
      planVersion: 1,
      status: "active",
      tasks: [{ id: "T-001", title: "Validated", prdRefs: ["REQ-001"] }],
      createdAt: state.createdAt,
      updatedAt: state.createdAt,
    }, now);
    const proposedPlan: ExecutionPlanArtifact = {
      version: 1,
      planVersion: 2,
      status: "draft",
      tasks: [
        { id: "T-001", title: "Validated", prdRefs: ["REQ-001"] },
        { id: "T-NEW", title: "Coarse new work", prdRefs: ["REQ-001"] },
      ],
      createdAt: state.createdAt,
      updatedAt: state.createdAt,
    };

    await assert.rejects(() => acceptReplanProposal(dir, state, {
      version: 1,
      requirements: [{ id: "REQ-001", statement: "One", createdAt: state.createdAt, updatedAt: state.createdAt }],
    }, { currentPlan, proposedPlan, now: new Date("2026-01-01T00:00:01.000Z") }), /task contract preflight.*T-NEW.*missing_dod.*missing_allowed_paths.*missing_atomicity.*missing_validation/i);

    assert.equal((await loadExecutionPlan(dir)).planVersion, 1);
    assert.deepEqual((await loadExecutionPlan(dir)).tasks.map((task) => task.id), ["T-001"]);
    assert.deepEqual(await loadReplanDecisions(dir), []);
    assert.deepEqual(state.tasks.map((task) => task.id), ["T-001"]);
  });
});

test("acceptReplanProposal rejects unknown requirement refs before publishing the plan", async () => {
  await withTempDir(async (dir) => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const state = createDefaultState(now);
    state.tasks = [{ id: "T-001", title: "Validated", status: "validated", prdRefs: ["REQ-001"], updatedAt: state.createdAt }];
    state.validatedTaskIds = ["T-001"];
    const currentPlan = await saveExecutionPlan(dir, {
      version: 1,
      planVersion: 1,
      status: "active",
      tasks: [{ id: "T-001", title: "Validated", prdRefs: ["REQ-001"] }],
      createdAt: state.createdAt,
      updatedAt: state.createdAt,
    }, now);
    const proposedPlan: ExecutionPlanArtifact = {
      version: 1,
      planVersion: 2,
      status: "draft",
      tasks: [
        { id: "T-001", title: "Validated", prdRefs: ["REQ-001"] },
        validPlanTask("T-UNKNOWN", "Unknown requirement", { prdRefs: ["REQ-UNKNOWN"] }),
      ],
      createdAt: state.createdAt,
      updatedAt: state.createdAt,
    };

    await assert.rejects(() => acceptReplanProposal(dir, state, {
      version: 1,
      requirements: [{ id: "REQ-001", statement: "One", createdAt: state.createdAt, updatedAt: state.createdAt }],
    }, { currentPlan, proposedPlan, now: new Date("2026-01-01T00:00:01.000Z") }), /coverage preflight.*unknown=REQ-UNKNOWN/i);

    assert.equal((await loadExecutionPlan(dir)).planVersion, 1);
    assert.deepEqual((await loadExecutionPlan(dir)).tasks.map((task) => task.id), ["T-001"]);
    assert.deepEqual(await loadReplanDecisions(dir), []);
    assert.deepEqual(state.tasks.map((task) => task.id), ["T-001"]);
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

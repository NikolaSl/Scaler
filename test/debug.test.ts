/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  assessDebugRetryGate,
  findDebugFingerprintCycles,
  loadDebugAttempts,
  loadDebugFailures,
  loadDebugReports,
  recordDebugAttempt,
  recordDebugReport,
} from "../src/debug.js";
import { loadReplanRequests, saveReplanRequests } from "../src/plans.js";
import { loadResearchRequests } from "../src/research.js";
import { createDefaultState, loadState, saveState } from "../src/state.js";
import { incrementBudgetUsage } from "../src/budgets.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-debug-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("recordDebugAttempt stores accepted attempt and failure", async () => {
  await withTempDir(async (dir) => {
    const result = await recordDebugAttempt(dir, createDefaultState(), {
      taskId: "T-001",
      failureId: "F-001",
      hypothesis: "Wrong import path",
      actionSummary: "Changed import",
      result: "same_failure",
      failureFingerprint: "ERR_MODULE_NOT_FOUND line 12",
      validationCommand: "npm test",
    });

    const attempts = await loadDebugAttempts(dir);
    const failures = await loadDebugFailures(dir);

    assert.equal(result.accepted, true);
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0]?.attemptSignature, "wrong import path changed import");
    assert.equal(attempts[0]?.failureFingerprint, "err_module_not_found line *");
    assert.equal(failures.length, 1);
    assert.equal(failures[0]?.attemptCount, 1);
  });
});

test("recordDebugAttempt rejects invalid result", async () => {
  await withTempDir(async (dir) => {
    const result = await recordDebugAttempt(dir, createDefaultState(), {
      taskId: "T-001",
      failureId: "F-001",
      hypothesis: "Try something",
      actionSummary: "Changed code",
      result: "unknown",
    });

    assert.equal(result.accepted, false);
    assert.match(result.message, /invalid result/);
    assert.deepEqual(await loadDebugAttempts(dir), []);
  });
});

test("recordDebugAttempt rejects duplicate failed attempt without new evidence", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState();
    const first = await recordDebugAttempt(dir, state, {
      taskId: "T-001",
      failureId: "F-001",
      hypothesis: "Config is wrong",
      actionSummary: "Edit tsconfig",
      result: "no_effect",
      failureFingerprint: "TS2307: cannot find module",
    });
    const second = await recordDebugAttempt(dir, state, {
      taskId: "T-001",
      failureId: "F-001",
      hypothesis: "Config is wrong",
      actionSummary: "Edit tsconfig",
      result: "no_effect",
      failureFingerprint: "TS2307: cannot find module",
    });

    assert.equal(first.accepted, true);
    assert.equal(second.accepted, false);
    assert.equal(second.duplicateAttemptId, first.attempt?.id);
    assert.equal((await loadDebugAttempts(dir)).length, 1);
  });
});

test("recordDebugAttempt rejects duplicate when new evidence has no fresh reference", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState();
    await recordDebugAttempt(dir, state, {
      taskId: "T-001",
      failureId: "F-001",
      hypothesis: "Config is wrong",
      actionSummary: "Edit tsconfig",
      result: "no_effect",
      failureFingerprint: "TS2307: cannot find module",
      evidence: ["debug-log:initial"],
    });
    const proseOnly = await recordDebugAttempt(dir, state, {
      taskId: "T-001",
      failureId: "F-001",
      hypothesis: "Config is wrong",
      actionSummary: "Edit tsconfig",
      result: "partial",
      failureFingerprint: "TS2307: cannot find module",
      newEvidence: "Trace resolution points at paths baseUrl.",
    });
    const reusedReference = await recordDebugAttempt(dir, state, {
      taskId: "T-001",
      failureId: "F-001",
      hypothesis: "Config is wrong",
      actionSummary: "Edit tsconfig",
      result: "partial",
      failureFingerprint: "TS2307: cannot find module",
      evidence: [" debug-log:initial "],
      newEvidence: "Re-read the same trace.",
    });

    assert.equal(proseOnly.accepted, false);
    assert.equal(reusedReference.accepted, false);
    assert.equal((await loadDebugAttempts(dir)).length, 1);
  });
});

test("recordDebugAttempt accepts duplicate with explanation and fresh evidence reference", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState();
    await recordDebugAttempt(dir, state, {
      taskId: "T-001",
      failureId: "F-001",
      hypothesis: "Config is wrong",
      actionSummary: "Edit tsconfig",
      result: "no_effect",
      failureFingerprint: "TS2307: cannot find module",
      evidence: ["debug-log:initial"],
    });
    const second = await recordDebugAttempt(dir, state, {
      taskId: "T-001",
      failureId: "F-001",
      hypothesis: "Config is wrong",
      actionSummary: "Edit tsconfig",
      result: "partial",
      failureFingerprint: "TS2307: cannot find module",
      evidence: ["debug-log:initial", "debug-log:resolution-trace"],
      newEvidence: "Trace resolution points at paths baseUrl.",
    });

    assert.equal(second.accepted, true);
    assert.equal((await loadDebugAttempts(dir)).length, 2);
  });
});

test("recordDebugAttempt serializes concurrent claims for one fresh evidence reference", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState();
    await recordDebugAttempt(dir, state, {
      taskId: "T-001",
      failureId: "F-001",
      hypothesis: "Config is wrong",
      actionSummary: "Edit tsconfig",
      result: "no_effect",
      failureFingerprint: "TS2307: cannot find module",
      evidence: ["debug-log:initial"],
    });
    const repeated = {
      taskId: "T-001",
      failureId: "F-001",
      hypothesis: "Config is wrong",
      actionSummary: "Edit tsconfig",
      result: "partial" as const,
      failureFingerprint: "TS2307: cannot find module",
      evidence: ["debug-log:initial", "debug-log:resolution-trace"],
      newEvidence: "Trace resolution points at paths baseUrl.",
    };

    const results = await Promise.all([
      recordDebugAttempt(dir, state, repeated),
      recordDebugAttempt(dir, state, repeated),
    ]);

    assert.deepEqual(results.map((result) => result.accepted).sort(), [false, true]);
    assert.equal((await loadDebugAttempts(dir)).length, 2);
  });
});

test("recordDebugAttempt cycle requests replanning and marks debugging task", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    state.stage = "debugging";
    state.tasks = [{ id: "T-001", status: "debugging", prdRefs: ["REQ-001"], updatedAt: state.createdAt }];
    await recordDebugAttempt(dir, state, {
      taskId: "T-001",
      failureId: "F-001",
      hypothesis: "Fix A",
      actionSummary: "Change A",
      result: "new_failure",
      failureFingerprint: "failure-a",
      resultingFailureFingerprint: "failure-b",
    }, new Date("2026-01-01T00:00:01.000Z"));
    const second = await recordDebugAttempt(dir, state, {
      taskId: "T-001",
      failureId: "F-001",
      hypothesis: "Fix B",
      actionSummary: "Change B",
      result: "new_failure",
      failureFingerprint: "failure-b",
      resultingFailureFingerprint: "failure-a",
      evidence: ["debug-log-1"],
    }, new Date("2026-01-01T00:00:02.000Z"));

    const requests = await loadReplanRequests(dir);
    const persisted = await loadState(dir);
    assert.equal(second.accepted, true);
    assert.equal(second.replanRequestId, "REPLAN-1767225602000");
    assert.equal(requests[0]?.trigger, "debug_cycle");
    assert.deepEqual(requests[0]?.evidenceRefs, ["debug-log-1"]);
    assert.deepEqual(requests[0]?.requirementRefs, ["REQ-001"]);
    assert.equal(persisted.stage, "replanning");
    assert.equal(persisted.tasks[0]?.status, "needs_replan");
  });
});

test("recordDebugAttempt reports fingerprint cycles", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState();
    await recordDebugAttempt(dir, state, {
      taskId: "T-001",
      failureId: "F-001",
      hypothesis: "Fix A",
      actionSummary: "Change A",
      result: "new_failure",
      failureFingerprint: "failure-a",
      resultingFailureFingerprint: "failure-b",
    });
    const second = await recordDebugAttempt(dir, state, {
      taskId: "T-001",
      failureId: "F-001",
      hypothesis: "Fix B",
      actionSummary: "Change B",
      result: "new_failure",
      failureFingerprint: "failure-b",
      resultingFailureFingerprint: "failure-a",
    });

    assert.equal(second.accepted, true);
    assert.match(second.cycleDetected ?? "", /cycled failure-a -> failure-b -> failure-a/);
  });
});

test("assessDebugRetryGate blocks unresolved debug fingerprint cycles", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    state.stage = "debugging";
    state.tasks = [{ id: "T-001", status: "debugging", updatedAt: state.createdAt }];
    await recordDebugAttempt(dir, state, {
      taskId: "T-001",
      failureId: "F-001",
      hypothesis: "Fix A",
      actionSummary: "Change A",
      result: "new_failure",
      failureFingerprint: "failure-a",
      resultingFailureFingerprint: "failure-b",
    }, new Date("2026-01-01T00:00:01.000Z"));
    await recordDebugAttempt(dir, state, {
      taskId: "T-001",
      failureId: "F-001",
      hypothesis: "Fix B",
      actionSummary: "Change B",
      result: "new_failure",
      failureFingerprint: "failure-b",
      resultingFailureFingerprint: "failure-a",
    }, new Date("2026-01-01T00:00:02.000Z"));

    const gate = await assessDebugRetryGate(dir, "T-001");

    assert.equal(gate.allowed, false);
    assert.equal(gate.failureId, "F-001");
    assert.match(gate.reason, /requires new evidence or an accepted replan request/);
    assert.deepEqual(gate.replanRequestIds, ["REPLAN-1767225602000"]);
  });
});

test("assessDebugRetryGate requires a fresh evidence reference to clear a cycle", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    await recordDebugAttempt(dir, state, {
      taskId: "T-001",
      failureId: "F-000",
      hypothesis: "Fix earlier failure",
      actionSummary: "Capture earlier result",
      result: "fixed",
      evidence: ["debug-log:historical-fix"],
    }, new Date("2026-01-01T00:00:00.500Z"));
    await recordDebugAttempt(dir, state, {
      taskId: "T-001",
      failureId: "F-001",
      hypothesis: "Fix A",
      actionSummary: "Change A",
      result: "new_failure",
      failureFingerprint: "failure-a",
      resultingFailureFingerprint: "failure-b",
      evidence: ["debug-log:initial"],
    }, new Date("2026-01-01T00:00:01.000Z"));
    await recordDebugAttempt(dir, state, {
      taskId: "T-001",
      failureId: "F-001",
      hypothesis: "Fix B",
      actionSummary: "Change B",
      result: "new_failure",
      failureFingerprint: "failure-b",
      resultingFailureFingerprint: "failure-a",
      evidence: ["debug-log:initial", "debug-log:cycle"],
      newEvidence: "The inverse change restored the original failure.",
    }, new Date("2026-01-01T00:00:02.000Z"));
    const selfCleared = await assessDebugRetryGate(dir, "T-001");
    await recordDebugAttempt(dir, state, {
      taskId: "T-001",
      failureId: "F-001",
      hypothesis: "Investigate logs",
      actionSummary: "Found new stack trace",
      result: "partial",
      failureFingerprint: "failure-a",
      resultingFailureFingerprint: "failure-a",
      evidence: ["debug-log:initial"],
      newEvidence: "Stack trace points at generated config.",
    }, new Date("2026-01-01T00:00:03.000Z"));

    const blocked = await assessDebugRetryGate(dir, "T-001");
    await recordDebugAttempt(dir, state, {
      taskId: "T-001",
      failureId: "F-001",
      hypothesis: "Revisit old fix",
      actionSummary: "Reuse historical trace",
      result: "partial",
      failureFingerprint: "failure-a",
      resultingFailureFingerprint: "failure-a",
      evidence: ["debug-log:historical-fix"],
      newEvidence: "The prior fixed attempt already recorded this trace.",
    }, new Date("2026-01-01T00:00:03.500Z"));
    const historicalReuse = await assessDebugRetryGate(dir, "T-001");
    await recordDebugAttempt(dir, state, {
      taskId: "T-001",
      failureId: "F-001",
      hypothesis: "Inspect generated config",
      actionSummary: "Captured generated config trace",
      result: "partial",
      failureFingerprint: "failure-a",
      resultingFailureFingerprint: "failure-a",
      evidence: ["debug-log:initial", "debug-log:generated-config"],
      newEvidence: "Generated config omits the mapped path.",
    }, new Date("2026-01-01T00:00:04.000Z"));
    const cleared = await assessDebugRetryGate(dir, "T-001");

    assert.equal(selfCleared.allowed, false);
    assert.equal(blocked.allowed, false);
    assert.equal(historicalReuse.allowed, false);
    assert.equal(cleared.allowed, true);
    assert.match(cleared.reason, /cleared by new evidence/);

    await recordDebugAttempt(dir, state, {
      taskId: "T-001",
      failureId: "F-001",
      hypothesis: "Try generated config fix",
      actionSummary: "Change generated config",
      result: "new_failure",
      failureFingerprint: "failure-a",
      resultingFailureFingerprint: "failure-c",
    }, new Date("2026-01-01T00:00:05.000Z"));
    const currentState = await loadState(dir);
    await recordDebugAttempt(dir, currentState, {
      taskId: "T-001",
      failureId: "F-001",
      hypothesis: "Undo generated config fix",
      actionSummary: "Restore generated config",
      result: "new_failure",
      failureFingerprint: "failure-c",
      resultingFailureFingerprint: "failure-a",
    }, new Date("2026-01-01T00:00:06.000Z"));

    const laterCycle = await assessDebugRetryGate(dir, "T-001");
    assert.equal(laterCycle.allowed, false);
    assert.match(laterCycle.reason, /requires new evidence/);
  });
});

test("assessDebugRetryGate rejects malformed persisted evidence values and containers", async () => {
  await withTempDir(async (dir) => {
    const debugDir = join(dir, ".scaler", "debug");
    await mkdir(debugDir, { recursive: true });
    await writeFile(join(debugDir, "attempts.json"), `${JSON.stringify({
      version: 1,
      attempts: [
        {
          id: "attempt-a",
          taskId: "T-001",
          failureId: "F-001",
          hypothesis: "Fix A",
          actionSummary: "Change A",
          result: "new_failure",
          attemptSignature: "fix a change a",
          failureFingerprint: "failure-a",
          resultingFailureFingerprint: "failure-b",
          timestamp: "2026-01-01T00:00:01.000Z",
        },
        {
          id: "attempt-b",
          taskId: "T-001",
          failureId: "F-001",
          hypothesis: "Fix B",
          actionSummary: "Change B",
          result: "new_failure",
          attemptSignature: "fix b change b",
          failureFingerprint: "failure-b",
          resultingFailureFingerprint: "failure-a",
          cycleDetected: "cycled failure-a -> failure-b -> failure-a",
          timestamp: "2026-01-01T00:00:02.000Z",
        },
        {
          id: "attempt-c",
          taskId: "T-001",
          failureId: "F-001",
          hypothesis: "Inspect logs",
          actionSummary: "Read malformed record",
          result: "partial",
          attemptSignature: "inspect logs read malformed record",
          failureFingerprint: "failure-a",
          resultingFailureFingerprint: "failure-a",
          evidence: { id: "not-an-array" },
          newEvidence: "A malformed legacy reference must not grant admission.",
          timestamp: "2026-01-01T00:00:03.000Z",
        },
        {
          id: "attempt-d",
          taskId: "T-001",
          failureId: "F-001",
          hypothesis: "Inspect more logs",
          actionSummary: "Read malformed string record",
          result: "partial",
          attemptSignature: "inspect more logs read malformed string record",
          failureFingerprint: "failure-a",
          resultingFailureFingerprint: "failure-a",
          logRefs: "not-an-array",
          newEvidence: { claim: "Malformed prose must not reach string operations." },
          timestamp: "2026-01-01T00:00:04.000Z",
        },
      ],
    }, null, 2)}\n`, "utf8");

    const gate = await assessDebugRetryGate(dir, "T-001");

    assert.equal(gate.allowed, false);
    assert.equal(gate.blockingAttemptId, "attempt-b");
  });
});

test("findDebugFingerprintCycles detects longer hidden cycles", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState();
    await recordDebugAttempt(dir, state, {
      taskId: "T-001",
      failureId: "F-001",
      hypothesis: "Fix A",
      actionSummary: "Change A",
      result: "new_failure",
      failureFingerprint: "failure-a",
      resultingFailureFingerprint: "failure-b",
    }, new Date("2026-01-01T00:00:01.000Z"));
    await recordDebugAttempt(dir, state, {
      taskId: "T-001",
      failureId: "F-001",
      hypothesis: "Fix B",
      actionSummary: "Change B",
      result: "new_failure",
      failureFingerprint: "failure-b",
      resultingFailureFingerprint: "failure-c",
    }, new Date("2026-01-01T00:00:02.000Z"));
    const third = await recordDebugAttempt(dir, state, {
      taskId: "T-001",
      failureId: "F-001",
      hypothesis: "Fix C",
      actionSummary: "Change C",
      result: "new_failure",
      failureFingerprint: "failure-c",
      resultingFailureFingerprint: "failure-a",
    }, new Date("2026-01-01T00:00:03.000Z"));

    const cycles = findDebugFingerprintCycles(await loadDebugAttempts(dir), "T-001");

    assert.match(third.cycleDetected ?? "", /failure-a -> failure-b -> failure-c -> failure-a/);
    assert.equal(cycles.length, 1);
    assert.deepEqual(cycles[0]?.fingerprints, ["failure-a", "failure-b", "failure-c", "failure-a"]);
  });
});

test("debug tactic limit survives reload and task replacement without charging replay", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState();
    state.budgets = { version: 1, limits: { tacticChanges: { hard: 1 } } };
    await saveState(dir, state);
    const proposal = {
      id: "RPT-TACTIC-1", taskId: "T-001", status: "next_approach",
      summary: "Inspect module resolution", nextApproach: "Run the resolution trace.",
      evidenceRefs: ["validation:missing-module"],
    };
    const first = await recordDebugReport(dir, await loadState(dir), proposal);
    const replay = await recordDebugReport(dir, await loadState(dir), proposal);
    assert.equal(first.accepted, true);
    assert.equal(replay.accepted, true);
    assert.equal((await loadDebugReports(dir)).length, 1);
    const replacement = await recordDebugReport(dir, await loadState(dir), {
      ...proposal, id: "RPT-TACTIC-2", taskId: "T-REPLACEMENT",
      summary: "Inspect generated config", nextApproach: "Capture generated configuration.",
      evidenceRefs: ["validation:generated-config"],
    });
    assert.equal(replacement.accepted, false);
    assert.match(replacement.message, /tactic.*limit/i);
    assert.deepEqual((await loadDebugReports(dir)).map((report) => report.id), [proposal.id]);
  });
});

test("tactic history survives replay, edits and concurrent admissions", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState();
    state.budgets = { limits: { tacticChanges: { hard: 2 } } };
    await saveState(dir, state);
    const current = await loadState(dir);
    const proposal = { id: "A", taskId: "T", status: "next_approach", summary: "Trace", nextApproach: "Trace imports", evidenceRefs: ["log:1"] };
    const first = await recordDebugReport(dir, current, proposal);
    const replay = await recordDebugReport(dir, current, proposal);
    assert.deepEqual(replay.report, JSON.parse(JSON.stringify(first.report)));
    for (const edit of [{ nextApproach: "Rewrite config" }, { status: "needs_research", researchQuestions: ["Why?"] }, { taskId: "T2" }, { evidenceRefs: ["log:2"] }]) {
      assert.equal((await recordDebugReport(dir, current, { ...proposal, ...edit })).accepted, false);
    }
    const outcomes = await Promise.all(["B", "C"].map((id) => recordDebugReport(dir, current, { ...proposal, id, taskId: id })));
    assert.deepEqual(outcomes.map((result) => result.accepted).sort(), [false, true]);
    const reports = await loadDebugReports(dir);
    assert.equal(reports.length, 2);
    assert.deepEqual(reports.find((report) => report.id === "A")?.evidenceRefs, ["log:1"]);
    assert.equal(reports.every((report) => report.runId === current.runId), true);
  });
});

test("malformed tactic limits and stale policy refuse admission", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState();
    await saveState(dir, state);
    const proposal = { id: "A", taskId: "T", status: "next_approach", summary: "Trace", nextApproach: "Trace imports" };
    for (const hard of [-1, 1.5, "2", null]) {
      const current = await loadState(dir);
      current.budgets = { limits: { tacticChanges: { hard } } };
      await saveState(dir, current);
      const result = await recordDebugReport(dir, await loadState(dir), proposal);
      assert.equal(result.accepted, false);
      assert.match(result.message, /tactic limit/);
    }
    const stale = await loadState(dir);
    stale.budgets = { limits: { tacticChanges: { hard: 2 } } };
    await saveState(dir, structuredClone(stale));
    assert.equal((await recordDebugReport(dir, stale, proposal)).accepted, false);
    assert.deepEqual(await loadDebugReports(dir), []);
  });
});

test("legacy run-less approaches consume configured allowance conservatively", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, ".scaler", "debug"), { recursive: true });
    await writeFile(join(dir, ".scaler", "debug", "reports.json"), JSON.stringify({ version: 1, reports: [{ id: "old", taskId: "old-task", status: "next_approach", summary: "Old", nextApproach: "Old approach", createdAt: "2026-01-01", updatedAt: "2026-01-01" }] }));
    const state = createDefaultState();
    state.budgets = { limits: { tacticChanges: { hard: 1 } } };
    await saveState(dir, state);
    const result = await recordDebugReport(dir, await loadState(dir), { id: "new", taskId: "new-task", status: "next_approach", summary: "New", nextApproach: "New approach" });
    assert.equal(result.accepted, false);
    assert.match(result.message, /tactic limit exhausted/);
    assert.equal((await loadDebugReports(dir))[0]?.id, "old");
  });
});

test("generated report IDs cannot overwrite charged history in the same millisecond", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState();
    state.budgets = { limits: { tacticChanges: { hard: 2 } } };
    await saveState(dir, state);
    const current = await loadState(dir);
    const now = new Date("2026-01-01T00:00:00Z");
    const results = [];
    for (const taskId of ["A", "B", "C"]) results.push(await recordDebugReport(dir, current, { taskId, status: "next_approach", summary: taskId, nextApproach: taskId }, now));
    assert.deepEqual(results.map((result) => result.accepted), [true, true, false]);
    assert.equal(new Set((await loadDebugReports(dir)).map((report) => report.id)).size, 2);
  });
});

test("unrelated budget accounting cannot erase a malformed tactic cap", async () => {
  await withTempDir(async (dir) => {
    let state = createDefaultState();
    state.budgets = { limits: { tacticChanges: null } };
    state = incrementBudgetUsage(state, "toolCalls").state;
    await saveState(dir, state);
    const result = await recordDebugReport(dir, await loadState(dir), { taskId: "T", status: "next_approach", summary: "Trace", nextApproach: "Trace imports" });
    assert.equal(result.accepted, false);
    assert.match(result.message, /tactic limit/);
  });
});

test("stale uncapped state cannot bypass a newly configured cap", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState();
    await saveState(dir, state);
    const current = structuredClone(state);
    current.budgets = { limits: { tacticChanges: { hard: 0 } } };
    await saveState(dir, current);
    const result = await recordDebugReport(dir, state, { taskId: "T", status: "next_approach", summary: "Trace", nextApproach: "Trace imports" });
    assert.equal(result.accepted, false);
    assert.match(result.message, /Stale state/);
  });
});

test("recordDebugReport records next approach reports", async () => {
  await withTempDir(async (dir) => {
    const result = await recordDebugReport(dir, createDefaultState(), {
      taskId: "T-001",
      status: "next_approach",
      summary: "Try root cause fix",
      failureId: "F-001",
      failureFingerprint: "Failure A line 12",
      nextApproach: "Replace the compatibility shim instead of toggling imports.",
      evidenceRefs: ["debug-log-1"],
    }, new Date("2026-01-01T00:00:01.000Z"));

    const reports = await loadDebugReports(dir);
    assert.equal(result.accepted, true);
    assert.equal(reports.length, 1);
    assert.equal(reports[0]?.status, "next_approach");
    assert.equal(reports[0]?.failureFingerprint, "failure a line *");
  });
});

test("recordDebugReport creates research requests for unresolved debug questions", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    state.tasks = [{ id: "T-001", status: "debugging", prdRefs: ["REQ-001"], updatedAt: state.createdAt }];
    const result = await recordDebugReport(dir, state, {
      taskId: "T-001",
      status: "needs_research",
      summary: "Local evidence is insufficient for version-specific API behavior.",
      researchScope: "mixed",
      researchQuestions: ["What changed in library X v2.1 error handling?"],
      evidenceRefs: ["debug-log-1"],
    }, new Date("2026-01-01T00:00:01.000Z"));

    const requests = await loadResearchRequests(dir);
    assert.equal(result.accepted, true);
    assert.deepEqual(result.researchRequestIds, ["RESEARCH-20260101000001000"]);
    assert.equal(requests[0]?.taskId, "T-001");
    assert.equal(requests[0]?.scope, "mixed");
    assert.deepEqual(requests[0]?.requirementRefs, ["REQ-001"]);
  });
});

test("recordDebugReport creates replan request after exhausted debug research", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    state.stage = "debugging";
    state.tasks = [{ id: "T-001", status: "debugging", prdRefs: ["REQ-001"], updatedAt: state.createdAt }];
    const result = await recordDebugReport(dir, state, {
      taskId: "T-001",
      status: "needs_replan",
      summary: "All realistic fixes are exhausted.",
      exhaustedReason: "Official docs and local tests show the planned API cannot satisfy the task.",
      evidenceRefs: ["RPT-RESEARCH-1", "debug-log-1"],
    }, new Date("2026-01-01T00:00:01.000Z"));

    const requests = await loadReplanRequests(dir);
    assert.equal(result.accepted, true);
    assert.equal(result.replanRequestId, "REPLAN-1767225601000");
    assert.equal(requests[0]?.trigger, "debug_blocked");
    assert.deepEqual(requests[0]?.evidenceRefs, ["debug-log-1", "RPT-RESEARCH-1"]);
  });
});

test("recordDebugReport rejects invalid escalation reports", async () => {
  await withTempDir(async (dir) => {
    const result = await recordDebugReport(dir, createDefaultState(), {
      taskId: "T-001",
      status: "needs_research",
      summary: "Need more information.",
    });

    assert.equal(result.accepted, false);
    assert.match(result.message, /researchQuestions/);
    assert.deepEqual(await loadDebugReports(dir), []);
  });
});

test("assessDebugRetryGate allows retries after accepted resolved replan", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    await recordDebugAttempt(dir, state, {
      taskId: "T-001",
      failureId: "F-001",
      hypothesis: "Fix A",
      actionSummary: "Change A",
      result: "new_failure",
      failureFingerprint: "failure-a",
      resultingFailureFingerprint: "failure-b",
    }, new Date("2026-01-01T00:00:01.000Z"));
    await recordDebugAttempt(dir, state, {
      taskId: "T-001",
      failureId: "F-001",
      hypothesis: "Fix B",
      actionSummary: "Change B",
      result: "new_failure",
      failureFingerprint: "failure-b",
      resultingFailureFingerprint: "failure-a",
    }, new Date("2026-01-01T00:00:02.000Z"));
    const requests = await loadReplanRequests(dir);
    await saveReplanRequests(dir, requests.map((request) => ({
      ...request,
      status: request.id === "REPLAN-1767225602000" ? "resolved" : request.status,
      updatedAt: "2026-01-01T00:00:04.000Z",
    })));

    const gate = await assessDebugRetryGate(dir, "T-001");

    assert.equal(gate.allowed, true);
    assert.match(gate.reason, /cleared by accepted replan/);
    assert.deepEqual(gate.replanRequestIds, ["REPLAN-1767225602000"]);
  });
});

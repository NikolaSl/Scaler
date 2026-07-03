import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
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
import { createDefaultState, loadState } from "../src/state.js";

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

test("recordDebugAttempt accepts duplicate when new evidence is supplied", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState();
    await recordDebugAttempt(dir, state, {
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
      result: "partial",
      failureFingerprint: "TS2307: cannot find module",
      newEvidence: "Trace resolution points at paths baseUrl.",
    });

    assert.equal(second.accepted, true);
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

test("assessDebugRetryGate allows retries after new evidence", async () => {
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
    await recordDebugAttempt(dir, state, {
      taskId: "T-001",
      failureId: "F-001",
      hypothesis: "Investigate logs",
      actionSummary: "Found new stack trace",
      result: "partial",
      failureFingerprint: "failure-a",
      resultingFailureFingerprint: "failure-a",
      newEvidence: "Stack trace points at generated config.",
    }, new Date("2026-01-01T00:00:03.000Z"));

    const gate = await assessDebugRetryGate(dir, "T-001");

    assert.equal(gate.allowed, true);
    assert.match(gate.reason, /cleared by new evidence/);
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

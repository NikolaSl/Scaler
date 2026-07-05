import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { getBudgetState } from "../src/budgets.js";
import { writeCheckpoint } from "../src/checkpoints.js";
import { appendReplanRequest } from "../src/plans.js";
import { createDefaultState, saveState } from "../src/state.js";
import {
  applyComplexityBudgetPolicy,
  formatResumeVerificationRecords,
  formatWatchdogCleanupRecords,
  formatWatchdogEvents,
  formatWatchdogHeartbeats,
  loadResumeVerificationRecords,
  loadWatchdogCleanupRecords,
  loadWatchdogEvents,
  loadWatchdogHeartbeats,
  recordWatchdogCleanup,
  recordWatchdogHeartbeat,
  runWatchdogAssessment,
  verifyResumeReadiness,
} from "../src/watchdogs.js";

const execFileAsync = promisify(execFile);

async function withTempDir<T>(fn: (dir: string) => Promise<T>, git = false): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-watchdogs-test-"));
  try {
    if (git) await execFileAsync("git", ["init"], { cwd: dir });
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("watchdog heartbeats persist and stale progress pauses execution", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    state.stage = "execution";
    await saveState(dir, state);
    const heartbeat = await recordWatchdogHeartbeat(dir, {
      scopeKind: "agent",
      scopeId: "agent-1",
      action: "working",
      status: "running",
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    const result = await runWatchdogAssessment(dir, state, {
      execute: true,
      policy: { noProgressTimeoutMs: 1_000 },
      now: new Date("2026-01-01T00:00:02.500Z"),
    });

    assert.equal(result.paused, true);
    assert.equal(result.state.stage, "paused");
    assert.equal(result.events[0]?.kind, "no_progress");
    assert.ok(result.checkpointPath);
    assert.equal((await loadWatchdogHeartbeats(dir))[0]?.id, heartbeat.id);
    assert.match(formatWatchdogHeartbeats(await loadWatchdogHeartbeats(dir)), /agent-1/);
    assert.match(formatWatchdogEvents(await loadWatchdogEvents(dir)), /no_progress/);
  });
});

test("watchdog detects repeated replanning without validated progress", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    state.stage = "replanning";
    await saveState(dir, state);
    for (let index = 0; index < 3; index += 1) {
      await appendReplanRequest(dir, {
        id: `REPLAN-${index}`,
        status: "open",
        trigger: "coverage_gap",
        reason: `Gap ${index}`,
      }, new Date(`2026-01-01T00:00:0${index}.000Z`));
    }

    const result = await runWatchdogAssessment(dir, state, { policy: { repeatedReplanLimit: 3 }, now: new Date("2026-01-01T00:00:05.000Z") });

    assert.equal(result.paused, false);
    assert.equal(result.events.some((event) => event.kind === "repeated_replanning"), true);
    assert.match(result.events.find((event) => event.kind === "repeated_replanning")?.reason ?? "", /without validated progress/);
  });
});

test("resume verification records git log memory checkpoint and budget findings", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    state.stage = "paused";
    state.previousStage = "execution";
    await saveState(dir, state);
    await writeCheckpoint(dir, state, "before-resume", "test checkpoint", new Date("2026-01-01T00:00:01.000Z"));

    const record = await verifyResumeReadiness(dir, state, new Date("2026-01-01T00:00:02.000Z"));

    assert.notEqual(record.status, "failed");
    assert.equal(record.targetStage, "execution");
    assert.ok(record.findings.some((finding) => finding.check === "checkpoints" && finding.status === "ok"));
    assert.equal((await loadResumeVerificationRecords(dir))[0]?.id, record.id);
    assert.match(formatResumeVerificationRecords(await loadResumeVerificationRecords(dir)), /Resume verification records/);
  }, true);
});

test("complexity budget policy requires approval for high complexity and applies scoped limits", () => {
  const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
  state.complexityLevel = 4;

  const blocked = applyComplexityBudgetPolicy(state, { level: 4, now: new Date("2026-01-01T00:00:01.000Z") });
  assert.equal(blocked.accepted, false);
  assert.equal(blocked.requiresApproval, true);

  const approved = applyComplexityBudgetPolicy(state, { level: 4, approved: true, approvalId: "APPROVED-BUDGET", now: new Date("2026-01-01T00:00:02.000Z") });
  assert.equal(approved.accepted, true);
  const budgets = getBudgetState(approved.state);
  assert.equal(budgets.scopedPolicies.length, 2);
  assert.equal(budgets.scopedPolicies.every((policy) => policy.approvalId === "APPROVED-BUDGET"), true);
  assert.ok(budgets.limits.spawnedAgents?.hard);
});

test("cleanup records persist subprocess timeout/abort evidence", async () => {
  await withTempDir(async (dir) => {
    await recordWatchdogCleanup(dir, {
      scopeKind: "agent",
      scopeId: "T-CLEAN",
      taskId: "T-CLEAN",
      agentId: "agent-clean",
      reason: "timeout",
      signal: "SIGTERM/SIGKILL",
      status: "completed",
      message: "Terminated timed-out subprocess.",
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    const records = await loadWatchdogCleanupRecords(dir);
    assert.equal(records[0]?.reason, "timeout");
    assert.match(formatWatchdogCleanupRecords(records), /Terminated timed-out subprocess/);
  });
});

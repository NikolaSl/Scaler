/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createDefaultState, loadState, saveState } from "../../../src/state.js";
import { loadWatchdogHeartbeats, recordWatchdogHeartbeat, runWatchdogAssessment } from "../../../src/watchdogs.js";

test("run no-progress clock survives completed worker replacement and reload", async () => {
  for (const observedProgress of [false, true]) {
    const dir = await mkdtemp(join(tmpdir(), "scaler-run-progress-resume-"));
    try {
      const at = (ms: number) => new Date(Date.parse("2026-01-01T00:00:00Z") + ms);
      let state = createDefaultState(at(0));
      state.stage = "execution";
      await saveState(dir, state);
      const initial = await recordWatchdogHeartbeat(dir, {
        scopeKind: "run", scopeId: state.runId, status: "running", action: "turn_end",
        taskId: "task-A", agentId: "worker-A", now: at(0),
      });
      await recordWatchdogHeartbeat(dir, {
        scopeKind: "agent", scopeId: "worker-A", status: "running", action: "worker_started", now: at(0),
      });
      await recordWatchdogHeartbeat(dir, {
        scopeKind: "agent", scopeId: "worker-A", status: "completed", action: "worker_finished",
        taskId: "task-A", now: at(500),
      });
      state = await loadState(dir);
      assert.equal(state.runId, initial.scopeId);
      if (observedProgress) await recordWatchdogHeartbeat(dir, {
        scopeKind: "run", scopeId: state.runId, status: "progress", action: "diagnostic_observation",
        progress: { kind: "ruled_out_hypothesis", summary: "Probe ruled out a consequential API-version hypothesis.", evidenceRefs: ["probe:version-contract"] },
        now: at(1_500),
      });
      await recordWatchdogHeartbeat(dir, {
        scopeKind: "agent", scopeId: "worker-B", status: "running", action: "replacement_started",
        taskId: "task-B", now: at(1_800),
      });
      const resumed = await recordWatchdogHeartbeat(dir, {
        scopeKind: "run", scopeId: state.runId, status: "running", action: "turn_end",
        taskId: "task-B", agentId: "worker-B", now: at(1_800),
      });
      assert.equal(resumed.lastProgressAt, at(observedProgress ? 1_500 : 0).toISOString());
      const result = await runWatchdogAssessment(dir, state, {
        execute: true, policy: { noProgressTimeoutMs: 1_000 }, now: at(2_000),
      });
      assert.equal(result.paused, !observedProgress);
      assert.equal((await loadState(dir)).stage, observedProgress ? "execution" : "paused");
      if (!observedProgress) {
        assert.equal(result.events[0]?.scopeKind, "run");
        assert.equal(result.events[0]?.scopeId, state.runId);
        assert.equal(result.events[0]?.kind, "no_progress");
        assert.ok(result.checkpointPath);
      } else assert.equal(result.events.some((event) => event.kind === "no_progress"), false);
      assert.ok((await loadWatchdogHeartbeats(dir)).some((record) => record.id === initial.id));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

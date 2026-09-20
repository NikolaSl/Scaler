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
  buildDebugAgentPrompt,
  extractDebugReport,
  formatDebugAgentRunList,
  ingestDebugReport,
  loadDebugAgentRunRecords,
  prepareDebugAgentInvocation,
  recordDebugAgentRun,
  runDebugAgentStep,
} from "../src/debug-agent.js";
import { loadDebugReports, recordDebugAttempt } from "../src/debug.js";
import { readLogEvents } from "../src/logging.js";
import { loadResearchRequests } from "../src/research.js";
import { createDefaultState } from "../src/state.js";
import type { TaskAgentRequest, TaskAgentRunResult } from "../src/subagents.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-debug-agent-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function debugState() {
  const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
  state.stage = "debugging";
  state.currentTaskId = "T-001";
  state.tasks = [{ id: "T-001", status: "debugging", title: "Fix failing test", prdRefs: ["REQ-001"], updatedAt: state.createdAt }];
  return state;
}

test("buildDebugAgentPrompt includes task, attempts, cycles, and report contract", async () => {
  await withTempDir(async (dir) => {
    const state = debugState();
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

    const reports = await loadDebugReports(dir);
    const prompt = buildDebugAgentPrompt({
      state,
      task: state.tasks[0]!,
      failures: [],
      attempts: [],
      reports,
      researchSummary: "No research.",
      replanRequests: [],
    });

    assert.match(prompt, /focused SCALER debug agent/);
    assert.match(prompt, /scaler_debug_report/);
    assert.match(prompt, /next_approach/);
    assert.match(prompt, /needs_research/);
    assert.match(prompt, /needs_replan/);
  });
});

test("prepareDebugAgentInvocation builds isolated Pi invocation", () => {
  const state = debugState();
  const preparation = prepareDebugAgentInvocation("/repo", {
    state,
    task: state.tasks[0]!,
    failures: [],
    attempts: [],
    reports: [],
    researchSummary: "No research.",
    replanRequests: [],
  }, { tools: ["read"], model: "m", command: "pi-test" });

  assert.equal(preparation.task.id, "T-001");
  assert.equal(preparation.request.taskId, "debug-agent-T-001");
  assert.equal(preparation.invocation.command, "pi-test");
  assert.ok(preparation.invocation.args.includes("--tools"));
  assert.deepEqual(preparation.request.providerAdmission, {
    requestTokenAllowance: 8_000,
    outputReserveTokens: 1_024,
    safetyMarginTokens: 1_024,
  });
});

test("extractDebugReport validates latest structured debug report candidate", () => {
  const result = extractDebugReport([
    { type: "scaler_debug_report", error: "old" },
    {
      payload: {
        type: "scaler_debug_report",
        taskId: "T-001",
        status: "next_approach",
        summary: "Try root cause",
        nextApproach: "Change shared adapter",
        evidenceRefs: ["debug-log-1"],
      },
    },
    {
      type: "message_end",
      message: {
        role: "assistant",
        content: [{
          type: "text",
          text: JSON.stringify({
            type: "scaler_debug_report",
            taskId: "T-PI",
            status: "next_approach",
            summary: "Pi wrapped report",
            nextApproach: "Parse exact assistant JSON text.",
            evidenceRefs: ["pi-event"],
          }),
        }],
      },
    },
  ]);

  assert.equal(result.ok, true);
  assert.equal(result.input?.taskId, "T-PI");
  assert.equal(result.input?.status, "next_approach");
  assert.deepEqual(result.input?.evidenceRefs, ["pi-event"]);
});

test("extractDebugReport reports missing and error outputs", () => {
  assert.deepEqual(extractDebugReport([]), {
    ok: false,
    reason: "No scaler_debug_report report found in debug-agent output.",
  });
  assert.deepEqual(extractDebugReport([{ type: "scaler_debug_report", error: "blocked" }]), {
    ok: false,
    reason: "Debug agent reported no report: blocked",
  });
});

test("ingestDebugReport records debug report and creates research request", async () => {
  await withTempDir(async (dir) => {
    const state = debugState();
    const ingestion = await ingestDebugReport(dir, state, [{
      type: "scaler_debug_report",
      taskId: "T-001",
      status: "needs_research",
      summary: "Need version-specific behavior.",
      researchScope: "mixed",
      researchQuestions: ["How does library X v2 handle this failure?"],
      evidenceRefs: ["debug-log-1"],
    }], new Date("2026-01-01T00:00:01.000Z"));

    assert.equal(ingestion.ingested, true);
    assert.equal(ingestion.report?.status, "needs_research");
    assert.deepEqual(ingestion.researchRequestIds, ["RESEARCH-20260101000001000"]);
    assert.equal((await loadResearchRequests(dir)).length, 1);
  });
});

test("debug agent run records round trip and format", async () => {
  await withTempDir(async (dir) => {
    const run: TaskAgentRunResult = {
      taskId: "debug-agent-T-001",
      exitCode: 0,
      stdoutEvents: [{ type: "scaler_debug_report" }],
      stderr: "",
      timedOut: false,
      aborted: false,
    };
    const record = await recordDebugAgentRun(dir, "T-001", run, { attempted: true, ingested: true, report: { id: "RPT-1" } as never }, undefined, new Date("2026-01-01T00:00:01.000Z"));
    const records = await loadDebugAgentRunRecords(dir);
    const formatted = formatDebugAgentRunList(records, "T-001");

    assert.equal(record.status, "passed");
    assert.equal(records.length, 1);
    assert.match(formatted, /ingestion=ingested/);
    assert.match(formatted, /report=RPT-1/);
  });
});

test("runDebugAgentStep prepares selected debugging task", async () => {
  await withTempDir(async (dir) => {
    const state = debugState();
    const result = await runDebugAgentStep(dir, state, { taskId: "T-001" });

    assert.equal(result.accepted, true);
    assert.equal(result.task?.id, "T-001");
    assert.match(result.prompt ?? "", /Selected task/);
    assert.equal(result.runRecord?.status, "prepared");
  });
});

test("runDebugAgentStep executes and ingests report", async () => {
  await withTempDir(async (dir) => {
    const state = debugState();
    const runner = async (request: TaskAgentRequest): Promise<TaskAgentRunResult> => ({
      taskId: request.taskId,
      exitCode: 0,
      stdoutEvents: [{
        type: "scaler_debug_report",
        taskId: "T-001",
        status: "next_approach",
        summary: "Try root cause adapter fix.",
        nextApproach: "Patch shared adapter instead of toggling individual call sites.",
        evidenceRefs: ["debug-log-1"],
      }],
      stderr: "",
      timedOut: false,
      aborted: false,
    });

    const result = await runDebugAgentStep(dir, state, { taskId: "T-001", execute: true }, runner);

    assert.equal(result.accepted, true);
    assert.equal(result.ingestion?.ingested, true);
    assert.equal((await loadDebugReports(dir))[0]?.status, "next_approach");
  });
});

test("runDebugAgentStep refuses an oversized final prompt before audit, runner, or run publication", async () => {
  await withTempDir(async (dir) => {
    const state = debugState();
    let runnerCalled = false;
    const result = await runDebugAgentStep(dir, state, {
      taskId: "T-001",
      execute: true,
      tokenBudget: 1,
      extraInstructions: "EXACT-SOURCE\n".repeat(4_000),
    } as never, async () => {
      runnerCalled = true;
      throw new Error("runner must not be called");
    });

    assert.equal(result.accepted, false);
    assert.equal(runnerCalled, false);
    assert.match(result.message, /final SCALER prompt refused/i);
    assert.deepEqual(await loadDebugAgentRunRecords(dir), []);
    assert.deepEqual(await readLogEvents(dir), []);
  });
});

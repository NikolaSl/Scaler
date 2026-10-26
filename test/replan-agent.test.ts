/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { getStatePath } from "../src/paths.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  buildReplanAgentPrompt,
  extractReplanProposalReport,
  formatReplanAgentRunList,
  ingestReplanProposalReport,
  loadReplanAgentRunRecords,
  prepareReplanAgentInvocation as prepareReplanAgentInvocationImpl,
  recordReplanAgentRun,
  runReplanAgentStep as runReplanAgentStepImpl,
} from "../src/replan-agent.js";
import { readLogEvents } from "../src/logging.js";
import { appendReplanRequest, loadProposedExecutionPlan, loadReplanRequests, saveExecutionPlan } from "../src/plans.js";
import { computePrdCoverageSummary, loadPrdCoverage, loadPrdRequirements, upsertPrdRequirement } from "../src/prd.js";
import { createDefaultState, loadState, saveState } from "../src/state.js";
import { getBudgetState } from "../src/budgets.js";
import { testProviderAdmissionModel } from "./provider-model-fixture.js";

const prepareReplanAgentInvocation: typeof prepareReplanAgentInvocationImpl = (cwd, input, options = {}) =>
  prepareReplanAgentInvocationImpl(cwd, input, { ...options, providerAdmissionModel: testProviderAdmissionModel });
const runReplanAgentStep: typeof runReplanAgentStepImpl = (cwd, state, options = {}, runner) =>
  runReplanAgentStepImpl(cwd, state, { ...options, providerAdmissionModel: testProviderAdmissionModel }, runner);

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-replan-agent-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("replanner charges persisted launch before a failed child and refuses after reload", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState();
    state.budgets = { limits: { spawnedAgents: { hard: 2 } } };
    await saveState(dir, state);
    let calls = 0;
    const runner: Parameters<typeof runReplanAgentStep>[3] = async (request) => {
      calls++;
      const child = await loadState(dir);
      assert.equal(getBudgetState(child).usage.spawnedAgents, 1);
      child.orchestrationReason = "Child evidence retained";
      await saveState(dir, child);
      return { taskId: request.taskId, exitCode: 1, stdoutEvents: [], stderr: "fixture",
        timedOut: false, aborted: false, usage: { totalTokens: 11, sources: ["fixture"] } };
    };
    assert.equal((await runReplanAgentStep(dir, state, {}, runner)).accepted, true);
    assert.equal(getBudgetState(await loadState(dir)).usage.spawnedAgents, undefined);
    const first = await runReplanAgentStep(dir, state, { execute: true }, runner);
    assert.equal(first.runRecord?.status, "failed");
    const resumed = await loadState(dir);
    assert.equal(resumed.orchestrationReason, "Child evidence retained");
    assert.equal(getBudgetState(resumed).usage.contextTokens, 11);
    const refused = await runReplanAgentStep(dir, resumed, { execute: true }, runner);
    assert.equal(refused.accepted, false);
    assert.match(refused.message, /budget.*spawnedAgents/i);
    assert.equal(calls, 1);
    assert.equal((await loadState(dir)).stage, "paused");
    assert.equal(getBudgetState(await loadState(dir)).usage.spawnedAgents, 1);
    assert.equal((await loadReplanAgentRunRecords(dir)).filter(r => r.status !== "prepared").length, 1);
  });
});

for (const reason of ["paused", "stale"] as const) {
  test(`replanner refuses ${reason} dispatch without child effects`, async () => {
    await withTempDir(async (dir) => {
      const state = createDefaultState();
      if (reason === "paused") state.stage = "paused";
      await saveState(dir, state);
      if (reason === "stale") await saveState(dir, await loadState(dir));
      const before = await loadState(dir);
      const result = await runReplanAgentStep(dir, state, { execute: true }, async () => {
        throw new Error("must not launch");
      });
      assert.equal(result.accepted, false);
      assert.match(result.message, reason === "paused" ? /paused/i : /stale state snapshot/i);
      assert.deepEqual(await loadState(dir), before);
      assert.deepEqual(await loadReplanAgentRunRecords(dir), []);
      assert.equal(await loadProposedExecutionPlan(dir), undefined);
    });
  });
}

test("replanner uncertain launch retains pre-dispatch usage", async () => {
  await withTempDir(async (dir) => {
    await assert.rejects(runReplanAgentStep(dir, createDefaultState(), { execute: true }, async () => {
      throw new Error("uncertain launch");
    }), /uncertain launch/);
    assert.equal(getBudgetState(await loadState(dir)).usage.spawnedAgents, 1);
  });
});

test("replanner changed-run handoff cannot account or ingest into replacement run", async () => {
  await withTempDir(async (dir) => {
    const replacement = createDefaultState();
    replacement.revision = 1;
    await assert.rejects(runReplanAgentStep(dir, createDefaultState(), { execute: true }, async (request) => {
      await writeFile(getStatePath(dir), JSON.stringify(replacement), "utf8");
      return { taskId: request.taskId, exitCode: 0, stderr: "", timedOut: false, aborted: false,
        usage: { totalTokens: 11, sources: ["fixture"] },
        stdoutEvents: [{ type: "scaler_replan_proposal", plan: { planVersion: 1, tasks: [] } }] };
    }), /run identity changed/i);
    assert.deepEqual(await loadState(dir), replacement);
    assert.equal(await loadProposedExecutionPlan(dir), undefined);
    assert.deepEqual(await loadReplanAgentRunRecords(dir), []);
  });
});

test("buildReplanAgentPrompt includes replan requests, PRD coverage, current plan, and report contract", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    state.stage = "replanning";
    state.tasks = [{ id: "T-001", status: "validated", title: "Done", prdRefs: ["REQ-001"], updatedAt: state.createdAt }];
    const currentPlan = await saveExecutionPlan(dir, {
      version: 1,
      planVersion: 1,
      status: "active",
      tasks: [{ id: "T-001", title: "Done", prdRefs: ["REQ-001"] }],
      createdAt: state.createdAt,
      updatedAt: state.createdAt,
    });
    await upsertPrdRequirement(dir, { id: "REQ-001", statement: "Keep done work", status: "validated", taskIds: ["T-001"] });
    await appendReplanRequest(dir, { id: "REPLAN-001", trigger: "manual", reason: "Need safer next task", requirementRefs: ["REQ-001"] });
    const requirements = await loadPrdRequirements(dir);
    const coverage = await loadPrdCoverage(dir);
    state.originalRequest = "  CSV export само локално.\nБез Excel, scheduler или plugin framework.  ";
    const input = {
      state,
      currentPlan,
      requirements,
      coverageSummary: computePrdCoverageSummary(requirements, coverage, state),
      replanRequests: await loadReplanRequests(dir),
      extraInstructions: "Prefer small tasks.",
    };
    const prompt = buildReplanAgentPrompt(input);
    assert.ok(prompt.includes(JSON.stringify(state.originalRequest)));
    assert.doesNotMatch(prompt, /If (task )?necessity is assessed/i);
    assert.match(prompt, /initial planning, every decomposition and every replan/i);
    assert.match(prompt, /every requested outcome.*sufficient planned path to acceptance/i);
    assert.match(prompt, /criterion that would fail without.*simpler sufficient approach/i);
    assert.match(prompt, /existing task description or plan summary/i);
    assert.match(prompt, /minimal one-task plan.*necessary technical steps.*without additional user confirmation/i);
    assert.match(prompt, /optional work and optional review suggestions outside executable work.*blocking gates/i);
    assert.match(prompt, /necessity-unresolved work.*investigate.*clarify.*affected plan blocked/i);
    state.originalRequest = "EXACT-CONSTRAINT ".repeat(10_000);
    assert.throws(() => prepareReplanAgentInvocation(dir, input), /final SCALER prompt refused/i);
    delete state.originalRequest;
    assert.match(buildReplanAgentPrompt(input), /Original user wording.*unavailable/i);

    assert.match(prompt, /focused SCALER replanner agent/);
    assert.match(prompt, /REPLAN-001/);
    assert.match(prompt, /REQ-001/);
    assert.match(prompt, /Current execution plan JSON/);
    assert.match(prompt, /scaler_replan_proposal/);
    assert.match(prompt, /Prefer small tasks/);
  });
});

test("prepareReplanAgentInvocation builds isolated Pi invocation", async () => {
  const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
  const preparation = prepareReplanAgentInvocation("/repo", {
    state,
    currentPlan: { version: 1, planVersion: 0, status: "draft", tasks: [], createdAt: state.createdAt, updatedAt: state.createdAt },
    requirements: { version: 1, requirements: [] },
    coverageSummary: { entries: [], countsByStatus: { pending: 0, in_progress: 0, implemented: 0, validated: 0, blocked: 0, needs_replan: 0 }, unlinkedRequirementIds: [], linkedRequirementIds: [] },
    replanRequests: [],
  }, { command: "pi-test", model: "synthetic-8k", tools: ["read", "write"] });

  assert.equal(preparation.request.taskId, "replan-agent");
  assert.equal(preparation.invocation.command, "pi-test");
  assert.equal(preparation.invocation.cwd, "/repo");
  assert.ok(preparation.invocation.args.includes("--model"));
  assert.ok(preparation.invocation.args.includes("synthetic-8k"));
  assert.deepEqual(preparation.request.providerAdmission, {
    requestTokenAllowance: 8_000,
    outputReserveTokens: 1_024,
    safetyMarginTokens: 1_024,
  });
  assert.match(preparation.prompt, /Required preservation rules/);
});

test("extractReplanProposalReport validates latest structured proposal", () => {
  const result = extractReplanProposalReport([
    { type: "message", text: "working" },
    { payload: { type: "scaler_replan_proposal", plan: { tasks: [{ id: "OLD", title: "Old" }] } } },
    {
      type: "scaler_replan_proposal",
      plan: {
        version: 1,
        planVersion: 3,
        status: "draft",
        tasks: [{ id: "T-001", title: "Preserve", prdRefs: ["REQ-001"] }],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    },
    {
      type: "message_end",
      message: {
        role: "assistant",
        content: [{
          type: "text",
          text: JSON.stringify({
            type: "scaler_replan_proposal",
            plan: {
              version: 1,
              planVersion: 4,
              status: "draft",
              tasks: [{ id: "T-PI", title: "Pi wrapped proposal", prdRefs: ["REQ-002"] }],
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          }),
        }],
      },
    },
  ], 2, new Date("2026-01-01T00:00:00.000Z"));

  assert.equal(result.ok, true);
  assert.equal(result.plan?.planVersion, 4);
  assert.equal(result.plan?.tasks[0]?.id, "T-PI");
});

test("extractReplanProposalReport reports missing, error, and invalid proposals", () => {
  assert.deepEqual(extractReplanProposalReport([]), {
    ok: false,
    reason: "No scaler_replan_proposal report found in replanner output.",
  });
  assert.deepEqual(extractReplanProposalReport([{ type: "scaler_replan_proposal", error: "blocked" }]), {
    ok: false,
    reason: "Replanner reported no proposal: blocked",
  });
  assert.deepEqual(extractReplanProposalReport([{ type: "scaler_replan_proposal", plan: { tasks: [{ id: "T-001", title: " " }] } }]), {
    ok: false,
    reason: "Execution plan task T-001 title is required.",
  });
});

test("ingestReplanProposalReport saves proposed plan and returns preservation details", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    state.tasks = [{ id: "T-001", status: "validated", prdRefs: ["REQ-001"], updatedAt: state.createdAt }];
    await saveExecutionPlan(dir, {
      version: 1,
      planVersion: 1,
      status: "active",
      tasks: [{ id: "T-001", title: "Preserved", prdRefs: ["REQ-001"] }],
      createdAt: state.createdAt,
      updatedAt: state.createdAt,
    });
    await upsertPrdRequirement(dir, { id: "REQ-001", statement: "One", status: "validated", taskIds: ["T-001"] });
    await upsertPrdRequirement(dir, { id: "REQ-002", statement: "Two", status: "pending" });

    const ingestion = await ingestReplanProposalReport(dir, [{
      type: "scaler_replan_proposal",
      plan: {
        version: 1,
        status: "draft",
        tasks: [
          { id: "T-001", title: "Preserved", prdRefs: ["REQ-001"] },
          { id: "T-002", title: "Next", prdRefs: ["REQ-002"], allowedPathPrefixes: ["src"] },
        ],
      },
    }], state, new Date("2026-01-01T00:00:01.000Z"));

    assert.equal(ingestion.attempted, true);
    assert.equal(ingestion.ingested, true);
    assert.equal(ingestion.plan?.planVersion, 2);
    assert.equal(ingestion.preservation?.ok, true);
    assert.deepEqual((await loadProposedExecutionPlan(dir))?.tasks.map((task) => task.id), ["T-001", "T-002"]);
  });
});

test("replan agent run records round trip and format", async () => {
  await withTempDir(async (dir) => {
    assert.deepEqual(await loadReplanAgentRunRecords(dir), []);

    await recordReplanAgentRun(dir, undefined, undefined, "prepared", new Date("2026-01-01T00:00:00.000Z"));
    await recordReplanAgentRun(dir, {
      taskId: "replan-agent",
      exitCode: 1,
      stdoutEvents: [{ type: "message" }],
      stderr: "failed with details",
      timedOut: false,
      aborted: false,
    }, { attempted: true, ingested: false, reason: "missing" }, undefined, new Date("2026-01-01T01:00:00.000Z"));

    const records = await loadReplanAgentRunRecords(dir);
    assert.deepEqual(records.map((record) => record.status), ["failed", "prepared"]);
    assert.equal(
      formatReplanAgentRunList(records),
      "Replan-agent runs:\n- failed exit=1 flags=none stdout_events=1 ingestion=rejected proposed_plan=n/a stderr=failed with details\n- prepared exit=n/a flags=none stdout_events=0 ingestion=not_attempted proposed_plan=n/a",
    );
  });
});

test("runReplanAgentStep prepares and executes with proposal ingestion", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    state.stage = "replanning";
    state.tasks = [{ id: "T-001", status: "validated", prdRefs: ["REQ-001"], updatedAt: state.createdAt }];
    await saveExecutionPlan(dir, {
      version: 1,
      planVersion: 1,
      status: "active",
      tasks: [{ id: "T-001", title: "Preserved", prdRefs: ["REQ-001"] }],
      createdAt: state.createdAt,
      updatedAt: state.createdAt,
    });
    await upsertPrdRequirement(dir, { id: "REQ-001", statement: "One", status: "validated", taskIds: ["T-001"] });

    const prepared = await runReplanAgentStep(dir, state, { command: "pi-test" });
    assert.equal(prepared.accepted, true);
    assert.equal(prepared.runRecord?.status, "prepared");
    assert.match(prepared.prompt ?? "", /Open replan requests/);

    const executed = await runReplanAgentStep(dir, state, { execute: true }, async (request) => ({
      taskId: request.taskId,
      exitCode: 0,
      stdoutEvents: [{
        type: "scaler_replan_proposal",
        plan: { version: 1, status: "draft", tasks: [{ id: "T-001", title: "Preserved", prdRefs: ["REQ-001"] }] },
      }],
      stderr: "",
      timedOut: false,
      aborted: false,
    }));

    assert.equal(executed.accepted, true);
    assert.equal(executed.runRecord?.status, "passed");
    assert.equal(executed.ingestion?.ingested, true);
    assert.equal((await loadProposedExecutionPlan(dir))?.planVersion, 2);
  });
});

test("runReplanAgentStep refuses an oversized final prompt before audit, runner, or run publication", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    state.stage = "replanning";
    await saveExecutionPlan(dir, {
      version: 1,
      planVersion: 1,
      status: "active",
      tasks: [],
      createdAt: state.createdAt,
      updatedAt: state.createdAt,
    });
    let runnerCalled = false;
    const result = await runReplanAgentStep(dir, state, {
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
    assert.deepEqual(await loadReplanAgentRunRecords(dir), []);
    assert.equal(await loadProposedExecutionPlan(dir), undefined);
    assert.deepEqual(await readLogEvents(dir), []);
  });
});

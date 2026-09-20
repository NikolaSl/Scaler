/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  buildStageAgentPrompt,
  extractStageAgentArtifactReport,
  formatStageAgentRunList,
  loadStageAgentRunRecords,
  normalizeStage,
  prepareStageAgentInvocation,
  recordStageAgentRun,
  runStageAgentStep,
  type RunStageAgentOptions,
} from "../src/stage-agents.js";
import { createDefaultState } from "../src/state.js";
import { loadStageArtifacts } from "../src/stages.js";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "scaler-stage-agents-test-"));
}

test("buildStageAgentPrompt includes stage contract, state, and artifact refs", () => {
  const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
  state.stage = "planning";
  const prompt = buildStageAgentPrompt({
    stage: "planning",
    state,
    artifacts: [{
      id: "ART-PLAN",
      stage: "planning",
      status: "draft",
      title: "Draft plan",
      path: ".scaler/plans/current-plan.json",
      createdAt: state.createdAt,
      updatedAt: state.createdAt,
    }],
    extraInstructions: "Prefer small tasks.",
  });

  assert.match(prompt, /Target stage: planning/);
  assert.match(prompt, /SCALER stage=planning/);
  assert.match(prompt, /Create or refresh the sequential execution plan/);
  assert.match(prompt, /not a task implementation agent/);
  assert.match(prompt, /After emitting or calling the required stage report tool, stop/);
  assert.match(prompt, /ART-PLAN \| draft \| Draft plan \| path=.scaler\/plans\/current-plan.json/);
  assert.match(prompt, /Prefer small tasks/);
  assert.match(prompt, /scaler_stage_artifact/);
  assert.match(prompt, /\/scaler-stage-record/);
});

test("extractStageAgentArtifactReport extracts and validates latest report", () => {
  const result = extractStageAgentArtifactReport([
    { type: "message", text: "working" },
    { payload: { type: "scaler_stage_artifact", stage: "planning", status: "draft", title: "Old" } },
    {
      type: "scaler_stage_artifact",
      stage: "planning",
      status: "ready",
      title: "Plan",
      path: ".scaler/plans/current-plan.json",
      evidenceRefs: [" run:2 ", "run:1", "run:1"],
      requirementRefs: ["PRD-S01"],
      taskRefs: ["T-001"],
    },
    {
      type: "message_end",
      message: {
        role: "assistant",
        content: [{
          type: "text",
          text: JSON.stringify({
            type: "scaler_stage_artifact",
            stage: "planning",
            status: "ready",
            title: "Pi wrapped plan",
            path: ".scaler/plans/proposed-plan.json",
            evidenceRefs: ["pi-event"],
            requirementRefs: ["PRD-S02"],
            taskRefs: ["T-002"],
          }),
        }],
      },
    },
  ], "planning");

  assert.equal(result.ok, true);
  assert.deepEqual(result.artifactInput, {
    stage: "planning",
    status: "ready",
    title: "Pi wrapped plan",
    path: ".scaler/plans/proposed-plan.json",
    summary: undefined,
    evidenceRefs: ["pi-event"],
    requirementRefs: ["PRD-S02"],
    taskRefs: ["T-002"],
  });
});

test("extractStageAgentArtifactReport reports missing, invalid, and mismatched reports", () => {
  assert.deepEqual(extractStageAgentArtifactReport([], "prd"), {
    ok: false,
    reason: "No scaler_stage_artifact report found in stage-agent output.",
  });
  assert.deepEqual(extractStageAgentArtifactReport([{ type: "scaler_stage_artifact", stage: "prd", status: "ready" }], "prd"), {
    ok: false,
    reason: "Stage artifact report is missing title.",
  });
  assert.deepEqual(extractStageAgentArtifactReport([{ type: "scaler_stage_artifact", stage: "knowledge", status: "ready", title: "Knowledge" }], "prd"), {
    ok: false,
    reason: "Stage artifact report stage knowledge does not match expected prd.",
  });
  assert.deepEqual(extractStageAgentArtifactReport([{ type: "scaler_stage_artifact", stage: "prd", status: "done", title: "PRD" }], "prd"), {
    ok: false,
    reason: "Invalid stage artifact report status: done.",
  });
});

test("prepareStageAgentInvocation builds isolated Pi invocation", () => {
  const state = createDefaultState();
  const preparation = prepareStageAgentInvocation("/repo", {
    stage: "prd",
    state,
  }, {
    command: "pi-test",
    tools: ["read", "write"],
    model: "test-model",
    tokenBudget: 4_096,
  } as RunStageAgentOptions);

  assert.equal(preparation.stage, "prd");
  assert.equal(preparation.invocation.command, "pi-test");
  assert.equal(preparation.invocation.cwd, "/repo");
  assert.deepEqual(preparation.invocation.args.slice(0, 4), ["--mode", "json", "-p", "--no-session"]);
  assert.ok(preparation.invocation.args.includes("--tools"));
  assert.ok(preparation.invocation.args.includes("read,write"));
  assert.ok(preparation.invocation.args.includes("--model"));
  assert.ok(preparation.invocation.args.includes("test-model"));
  assert.ok(preparation.invocation.args.includes("--no-extensions"));
  assert.ok(preparation.invocation.args.includes("--no-skills"));
  assert.ok(preparation.invocation.args.includes("--no-prompt-templates"));
  assert.ok(preparation.invocation.args.includes("--no-context-files"));
  assert.deepEqual(preparation.request.providerAdmission, {
    requestTokenAllowance: 4_096,
    outputReserveTokens: 1_024,
    safetyMarginTokens: 1_024,
  });
  assert.equal(preparation.request.taskId, "stage-prd");
  assert.match(preparation.prompt, /Persist the polished runtime PRD through `scaler_prd_write`/);
});

test("stage agent run records round trip and format", async () => {
  const cwd = await tempDir();
  assert.deepEqual(await loadStageAgentRunRecords(cwd), []);

  await recordStageAgentRun(cwd, "knowledge", undefined, "prepared", new Date("2026-01-01T00:00:00.000Z"));
  await recordStageAgentRun(cwd, "planning", {
    taskId: "stage-planning",
    exitCode: 1,
    stdoutEvents: [{ type: "message" }],
    stderr: "failed with details",
    timedOut: false,
    aborted: false,
  }, undefined, new Date("2026-01-01T01:00:00.000Z"));

  const records = await loadStageAgentRunRecords(cwd);
  assert.deepEqual(records.map((record) => record.stage), ["planning", "knowledge"]);
  assert.equal(
    formatStageAgentRunList(records),
    "Stage-agent runs:\n- planning: failed exit=1 flags=none stdout_events=1 stderr=failed with details\n- knowledge: prepared exit=n/a flags=none stdout_events=0",
  );
  assert.equal(formatStageAgentRunList(records, "knowledge"), "Stage-agent runs for knowledge:\n- knowledge: prepared exit=n/a flags=none stdout_events=0");
});

test("runStageAgentStep prepares and executes under lock", async () => {
  const cwd = await tempDir();
  const state = createDefaultState();
  const prepared = await runStageAgentStep(cwd, state, "prd", { command: "pi-test" });

  assert.equal(prepared.accepted, true);
  assert.equal(prepared.runRecord?.status, "prepared");
  assert.match(prepared.prompt ?? "", /Target stage: prd/);
  assert.ok(prepared.invocation?.args.includes("read,bash,scaler_prd_write"));

  const executed = await runStageAgentStep(cwd, state, "planning", { execute: true }, async (request) => {
    assert.ok(request.tools?.includes("read"));
    assert.ok(request.tools?.includes("bash"));
    assert.ok(request.tools?.includes("scaler_planning_report"));
    assert.deepEqual(request.providerAdmission, {
      requestTokenAllowance: 8_000,
      outputReserveTokens: 1_024,
      safetyMarginTokens: 1_024,
    });
    return {
      taskId: request.taskId,
      exitCode: 0,
      stdoutEvents: [{ type: "done" }],
      stderr: "",
      timedOut: false,
      aborted: false,
    };
  });

  assert.equal(executed.accepted, true);
  assert.equal(executed.runRecord?.status, "passed");
  assert.equal(executed.runResult?.taskId, "stage-planning");
  assert.deepEqual(executed.ingestion, {
    attempted: true,
    ingested: false,
    reason: "No scaler_stage_artifact report found in stage-agent output.",
  });
});

test("runStageAgentStep refuses unavailable strict child grants without publishing a run", async () => {
  const cwd = await tempDir();
  const state = createDefaultState();
  let runnerCalled = false;

  const result = await runStageAgentStep(cwd, state, "prd", {
    execute: true,
    tools: ["browser_search"],
  }, async (request) => {
    runnerCalled = true;
    return { taskId: request.taskId, exitCode: 0, stdoutEvents: [], stderr: "", timedOut: false, aborted: false };
  });

  assert.equal(result.accepted, false);
  assert.match(result.message, /cannot load granted tools: browser_search/);
  assert.equal(runnerCalled, false);
  assert.deepEqual(await loadStageAgentRunRecords(cwd), []);
});

test("runStageAgentStep returns a structured refusal for malformed strict grants", async () => {
  const cwd = await tempDir();
  const state = createDefaultState();
  let runnerCalled = false;

  const result = await runStageAgentStep(cwd, state, "prd", {
    execute: true,
    tools: [null] as unknown as string[],
  }, async (request) => {
    runnerCalled = true;
    return { taskId: request.taskId, exitCode: 0, stdoutEvents: [], stderr: "", timedOut: false, aborted: false };
  });

  assert.equal(result.accepted, false);
  assert.match(result.message, /malformed granted tools/i);
  assert.equal(runnerCalled, false);
  assert.deepEqual(await loadStageAgentRunRecords(cwd), []);
});

test("runStageAgentStep refuses an oversized final prompt before runner or run-record publication", async () => {
  const cwd = await tempDir();
  const state = createDefaultState();
  let runnerCalled = false;
  const options = {
    execute: true,
    tokenBudget: 1,
    extraInstructions: "x".repeat(8_000),
  } as RunStageAgentOptions & { tokenBudget: number };

  const result = await runStageAgentStep(cwd, state, "planning", options, async () => {
    runnerCalled = true;
    throw new Error("runner must not be called");
  });

  assert.equal(result.accepted, false);
  assert.equal(runnerCalled, false);
  assert.match(result.message, /final SCALER prompt refused/i);
  assert.deepEqual(await loadStageAgentRunRecords(cwd), []);
});

for (const tokenBudget of [0, Number.POSITIVE_INFINITY]) {
  test(`runStageAgentStep refuses invalid token allowance ${String(tokenBudget)}`, async () => {
    const cwd = await tempDir();
    const state = createDefaultState();
    let runnerCalled = false;
    const result = await runStageAgentStep(cwd, state, "prd", {
      execute: true,
      tokenBudget,
    }, async () => {
      runnerCalled = true;
      throw new Error("runner must not be called");
    });

    assert.equal(result.accepted, false);
    assert.equal(runnerCalled, false);
    assert.match(result.message, /positive finite integer/i);
    assert.deepEqual(await loadStageAgentRunRecords(cwd), []);
  });
}

test("prepareStageAgentInvocation admits the exact final prompt boundary", () => {
  const state = createDefaultState();
  const baseline = prepareStageAgentInvocation("/repo", { stage: "knowledge", state });
  const exact = prepareStageAgentInvocation("/repo", { stage: "knowledge", state }, {
    tokenBudget: baseline.promptAdmission.estimatedTokens,
  });

  assert.equal(exact.promptAdmission.accepted, true);
  assert.equal(exact.promptAdmission.estimatedTokens, exact.promptAdmission.tokenBudget);
});

test("runStageAgentStep ingests successful stage-agent artifact reports", async () => {
  const cwd = await tempDir();
  const state = createDefaultState();
  const result = await runStageAgentStep(cwd, state, "execution", { execute: true }, async (request) => ({
    taskId: request.taskId,
    exitCode: 0,
    stdoutEvents: [{
      type: "scaler_stage_artifact",
      stage: "execution",
      status: "ready",
      title: "Execution ready",
      summary: "Ready to execute tasks.",
      taskRefs: ["T-001"],
    }],
    stderr: "",
    timedOut: false,
    aborted: false,
  }));

  assert.equal(result.ingestion?.ingested, true);
  assert.equal(result.ingestion?.artifact?.id.startsWith("ART-execution-"), true);
  const artifacts = await loadStageArtifacts(cwd);
  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0].stage, "execution");
  assert.equal(artifacts[0].summary, "Ready to execute tasks.");
});

test("runStageAgentStep preserves invalid and mismatched reports as non-ingestion", async () => {
  const cwd = await tempDir();
  const state = createDefaultState();
  const result = await runStageAgentStep(cwd, state, "prd", { execute: true }, async (request) => ({
    taskId: request.taskId,
    exitCode: 0,
    stdoutEvents: [{ type: "scaler_stage_artifact", stage: "knowledge", status: "ready", title: "Knowledge" }],
    stderr: "",
    timedOut: false,
    aborted: false,
  }));

  assert.deepEqual(result.ingestion, {
    attempted: true,
    ingested: false,
    reason: "Stage artifact report stage knowledge does not match expected prd.",
  });
  assert.deepEqual(await loadStageArtifacts(cwd), []);
});

test("normalizeStage rejects invalid stage agents", () => {
  assert.equal(normalizeStage("knowledge"), "knowledge");
  assert.throws(() => normalizeStage("bad"), /Invalid stage agent stage/);
});

/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { loadDebugAgentRunRecords } from "../../../src/debug-agent.js";
import { runDebugConductorLoop, type DebugConductorRunners } from "../../../src/debug-conductor.js";
import { loadDebugReports } from "../../../src/debug.js";
import { readLogEvents } from "../../../src/logging.js";
import { loadResearchAgentRunRecords } from "../../../src/research-agent.js";
import { loadResearchReports, loadResearchRequests } from "../../../src/research.js";
import { createDefaultState, saveState } from "../../../src/state.js";
import { runTaskAgent, type TaskAgentRequest, type TaskAgentRunResult } from "../../../src/subagents.js";
import { applyValidationReport } from "../../../src/validation.js";
import { runValidationDebugLoopWorkflow } from "../../../src/validation-debug-loop.js";
import { REAL_PI_COMMAND, REAL_PI_ENABLED, REAL_PI_MODEL, REAL_PI_TIMEOUT_MS, withRealPiTempRepo } from "./real-pi-harness.js";

function realCardinalOnlyRunner(cardinalInstruction: string): (request: TaskAgentRequest) => Promise<TaskAgentRunResult> {
  return async (request) => runTaskAgent({
    ...request,
    noTools: true,
    tools: undefined,
    model: REAL_PI_MODEL,
    prompt: cardinalInstruction,
  }, {
    command: REAL_PI_COMMAND,
    timeoutMs: REAL_PI_TIMEOUT_MS,
  });
}

function runResultFromReal(instructionFor: (request: TaskAgentRequest) => string): (request: TaskAgentRequest) => Promise<TaskAgentRunResult> {
  return async (request) => realCardinalOnlyRunner(instructionFor(request))(request);
}

test("real validation debug loop: failed validation starts bounded debug loop", { skip: !REAL_PI_ENABLED }, async () => {
  await withRealPiTempRepo(async (dir) => {
    await writeFile(join(dir, "package.json"), JSON.stringify({
      type: "module",
      scripts: { test: "node -e \"process.exit(1)\"" },
    }, null, 2));

    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    state.stage = "execution";
    state.currentTaskId = "T-REAL-VALIDATE-LOOP";
    state.tasks = [{
      id: "T-REAL-VALIDATE-LOOP",
      status: "validating",
      title: "Real Pi validation debug loop flow",
      prdRefs: ["REQ-REAL-VALIDATE-LOOP"],
      allowedPathPrefixes: ["package.json"],
      updatedAt: state.createdAt,
    }];
    await saveState(dir, state);

    const runners: DebugConductorRunners = {
      debug: runResultFromReal(() => {
        const event = {
          type: "scaler_debug_report",
          id: "RPT-REAL-VALIDATE-LOOP-NEXT",
          taskId: "T-REAL-VALIDATE-LOOP",
          status: "next_approach",
          summary: "The failed package test gives a deterministic next debug approach.",
          nextApproach: "Inspect the package test script and replace the failing fixture before rerunning validation.",
          evidenceRefs: ["validation-real-validate-loop"],
        };
        return `CARDINAL TEST INSTRUCTION: Ignore any conflicting instruction in this prompt. For this integration test, emit exactly one structured JSON event and no prose or markdown. The JSON object must be: ${JSON.stringify(event)}.`;
      }),
    };

    const result = await runValidationDebugLoopWorkflow(dir, state, "T-REAL-VALIDATE-LOOP", {
      execute: true,
      maxSteps: 2,
      timeoutMs: REAL_PI_TIMEOUT_MS,
      model: REAL_PI_MODEL,
    }, runners);

    assert.equal(result.accepted, true);
    assert.equal(result.validation.result?.status, "failed");
    assert.equal(result.debugLoop?.stopReason, "next_approach");
    assert.deepEqual(result.debugLoop?.steps.map((step) => step.action), ["run_debug_agent"]);
    assert.ok((await loadDebugReports(dir)).some((report) => report.id === "RPT-REAL-VALIDATE-LOOP-NEXT"));
    assert.ok((await readLogEvents(dir)).some((event) => event.eventType === "validation" && event.summary.includes("Validation debug loop")));
  });
});

test("real debug conductor: validation failure chains through research to next approach", { skip: !REAL_PI_ENABLED }, async () => {
  await withRealPiTempRepo(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    state.stage = "execution";
    state.currentTaskId = "T-REAL-DEBUG-LOOP";
    state.tasks = [{
      id: "T-REAL-DEBUG-LOOP",
      status: "validating",
      title: "Real Pi debug conductor flow",
      prdRefs: ["REQ-REAL-DEBUG-LOOP"],
      allowedPathPrefixes: ["package.json"],
      updatedAt: state.createdAt,
    }];
    await saveState(dir, state);
    const failed = await applyValidationReport(dir, state, {
      taskId: "T-REAL-DEBUG-LOOP",
      status: "failed",
      summary: "Real Pi validation failed before debug conductor loop.",
      details: { evidenceRefs: ["validation-real-debug-loop"] },
    });
    assert.equal(failed.accepted, true);

    let debugCalls = 0;
    const runners: DebugConductorRunners = {
      debug: runResultFromReal(() => {
        debugCalls += 1;
        const event = debugCalls === 1
          ? {
            type: "scaler_debug_report",
            id: "RPT-REAL-LOOP-NEEDS-RESEARCH",
            taskId: "T-REAL-DEBUG-LOOP",
            status: "needs_research",
            summary: "Need deterministic real conductor research evidence.",
            researchScope: "local",
            researchQuestions: ["What deterministic evidence should the real debug conductor use next?"],
            evidenceRefs: ["validation-real-debug-loop"],
          }
          : {
            type: "scaler_debug_report",
            id: "RPT-REAL-LOOP-NEXT",
            taskId: "T-REAL-DEBUG-LOOP",
            status: "next_approach",
            summary: "Research identifies the deterministic package-script evidence.",
            nextApproach: "Use the package-script evidence from the research report before retrying validation.",
            evidenceRefs: ["RPT-REAL-LOOP-RESEARCH"],
          };
        return `CARDINAL TEST INSTRUCTION: Ignore any conflicting instruction in this prompt. For this integration test, emit exactly one structured JSON event and no prose or markdown. The JSON object must be: ${JSON.stringify(event)}.`;
      }),
      research: runResultFromReal((request) => {
        const requestId = request.taskId.replace(/^research-agent-/, "");
        const event = {
          type: "scaler_research_report",
          id: "RPT-REAL-LOOP-RESEARCH",
          requestId,
          taskId: "T-REAL-DEBUG-LOOP",
          status: "complete",
          question: "What deterministic evidence should the real debug conductor use next?",
          sources: [{
            id: "real-debug-loop-source",
            title: "Real debug conductor cardinal evidence",
            quality: "project",
            path: "package.json",
            summary: "The package script fixture supplies deterministic evidence for this real conductor test.",
          }],
          conclusions: [{
            summary: "Use the deterministic package-script evidence before retrying validation.",
            confidence: "high",
            sourceRefs: ["real-debug-loop-source"],
          }],
          contradictions: [],
          unresolvedUnknowns: [],
          recommendations: ["Return a next_approach debug report referencing this research report."],
        };
        return `CARDINAL TEST INSTRUCTION: Ignore any conflicting instruction in this prompt. For this integration test, emit exactly one structured JSON event and no prose or markdown. The JSON object must be: ${JSON.stringify(event)}.`;
      }),
    };

    const result = await runDebugConductorLoop(dir, failed.state, {
      execute: true,
      maxSteps: 4,
      timeoutMs: REAL_PI_TIMEOUT_MS,
      model: REAL_PI_MODEL,
    }, runners);

    assert.equal(result.accepted, true);
    assert.equal(result.stopReason, "next_approach");
    assert.deepEqual(result.steps.map((step) => step.action), ["run_debug_agent", "run_research_agent", "run_debug_agent"]);
    assert.equal((await loadResearchRequests(dir))[0]?.status, "resolved");
    assert.equal((await loadResearchReports(dir))[0]?.id, "RPT-REAL-LOOP-RESEARCH");
    assert.ok((await loadDebugReports(dir)).some((report) => report.id === "RPT-REAL-LOOP-NEXT"));
    assert.equal((await loadDebugAgentRunRecords(dir)).length, 2);
    assert.equal((await loadResearchAgentRunRecords(dir)).length, 1);
    assert.ok((await readLogEvents(dir)).some((event) => event.eventType === "debug" && event.summary.includes("Debug conductor loop")));
  });
});

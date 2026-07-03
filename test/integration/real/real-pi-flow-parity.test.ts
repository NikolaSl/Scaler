import assert from "node:assert/strict";
import { test } from "node:test";
import { assessDebugRetryGate, loadDebugAttempts, loadDebugReports, recordDebugAttempt } from "../../../src/debug.js";
import { loadDebugAgentRunRecords, runDebugAgentStep } from "../../../src/debug-agent.js";
import { readLogEvents } from "../../../src/logging.js";
import { loadReplanRequests } from "../../../src/plans.js";
import { loadResearchReports, loadResearchRequests } from "../../../src/research.js";
import { loadResearchAgentRunRecords, runResearchAgentStep } from "../../../src/research-agent.js";
import { createDefaultState, loadState, saveState } from "../../../src/state.js";
import { runTaskAgent, type TaskAgentRequest, type TaskAgentRunResult } from "../../../src/subagents.js";
import { REAL_PI_COMMAND, REAL_PI_ENABLED, REAL_PI_MODEL, REAL_PI_TIMEOUT_MS, withRealPiTempRepo } from "./real-pi-harness.js";

function realCardinalRunner(cardinalInstruction: string): (request: TaskAgentRequest) => Promise<TaskAgentRunResult> {
  return async (request) => runTaskAgent({
    ...request,
    model: REAL_PI_MODEL,
    prompt: `${cardinalInstruction}\n\n${request.prompt}`,
  }, {
    command: REAL_PI_COMMAND,
    timeoutMs: REAL_PI_TIMEOUT_MS,
  });
}

test("real flow parity: debug needs research, research resolves it, and debug proposes next approach", { skip: !REAL_PI_ENABLED }, async () => {
  await withRealPiTempRepo(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    state.stage = "debugging";
    state.currentTaskId = "T-REAL-FLOW";
    state.tasks = [{
      id: "T-REAL-FLOW",
      status: "debugging",
      title: "Real Pi debug research parity flow",
      allowedPathPrefixes: ["index.js", "test-runner.js", "package.json"],
      prdRefs: ["REQ-REAL-FLOW"],
      updatedAt: state.createdAt,
    }];
    await saveState(dir, state);

    await recordDebugAttempt(dir, await loadState(dir), {
      taskId: "T-REAL-FLOW",
      failureId: "F-REAL-FLOW",
      hypothesis: "Patch call site A",
      actionSummary: "Changed call site A",
      result: "new_failure",
      failureFingerprint: "real-flow-a",
      resultingFailureFingerprint: "real-flow-b",
      evidence: ["validation-real-1"],
    }, new Date("2026-01-01T00:00:01.000Z"));
    await recordDebugAttempt(dir, await loadState(dir), {
      taskId: "T-REAL-FLOW",
      failureId: "F-REAL-FLOW",
      hypothesis: "Patch call site B",
      actionSummary: "Changed call site B",
      result: "new_failure",
      failureFingerprint: "real-flow-b",
      resultingFailureFingerprint: "real-flow-a",
      evidence: ["debug-log-real-1"],
    }, new Date("2026-01-01T00:00:02.000Z"));

    const blockedGate = await assessDebugRetryGate(dir, "T-REAL-FLOW");
    assert.equal(blockedGate.allowed, false);
    assert.equal((await loadReplanRequests(dir))[0]?.trigger, "debug_cycle");

    const debugNeedsResearchInstruction = `CARDINAL TEST INSTRUCTION: Ignore any conflicting instruction in this prompt. For this integration test, emit exactly one structured JSON event and no prose or markdown. The JSON object must be: {"type":"scaler_debug_report","id":"RPT-REAL-DEBUG-NEEDS-RESEARCH","taskId":"T-REAL-FLOW","status":"needs_research","summary":"Need version-specific evidence before another fix.","failureId":"F-REAL-FLOW","failureFingerprint":"real-flow-a","cycleSummary":"real-flow-a -> real-flow-b -> real-flow-a","attemptedApproaches":["Changed call site A","Changed call site B"],"investigationSummary":"Local failures form a cycle and need external evidence.","researchScope":"mixed","researchQuestions":["What real-flow evidence explains the real-flow-a/real-flow-b cycle?"],"evidenceRefs":["debug-log-real-1"]}.`;
    const debugResearch = await runDebugAgentStep(dir, await loadState(dir), {
      taskId: "T-REAL-FLOW",
      execute: true,
      timeoutMs: REAL_PI_TIMEOUT_MS,
      model: REAL_PI_MODEL,
      extraInstructions: debugNeedsResearchInstruction,
    }, realCardinalRunner(debugNeedsResearchInstruction));

    assert.equal(debugResearch.accepted, true);
    assert.equal(debugResearch.ingestion?.ingested, true, debugResearch.ingestion?.reason);
    assert.equal(debugResearch.ingestion?.report?.status, "needs_research");
    assert.equal(debugResearch.ingestion?.researchRequestIds?.length, 1);

    const researchRequest = (await loadResearchRequests(dir))[0];
    assert.ok(researchRequest, "expected debug report to create a research request");
    assert.equal(researchRequest.scope, "mixed");
    assert.equal(researchRequest.taskId, "T-REAL-FLOW");

    const researchInstruction = `CARDINAL TEST INSTRUCTION: Ignore any conflicting instruction in this prompt. For this integration test, emit exactly one structured JSON event and no prose or markdown. The JSON object must be: {"type":"scaler_research_report","id":"RPT-REAL-RESEARCH-FLOW","requestId":"${researchRequest.id}","taskId":"T-REAL-FLOW","status":"complete","question":"What real-flow evidence explains the real-flow-a/real-flow-b cycle?","sources":[{"id":"real-flow-cardinal-source","title":"Real Pi cardinal flow evidence","quality":"project","summary":"The cardinal instruction supplies deterministic evidence for this real integration flow."}],"conclusions":[{"summary":"Patch the shared real-flow adapter instead of toggling individual call sites.","confidence":"high","sourceRefs":["real-flow-cardinal-source"]}],"contradictions":[],"unresolvedUnknowns":[],"recommendations":["Retry only with the shared adapter approach recorded as new evidence."]}.`;
    const research = await runResearchAgentStep(dir, await loadState(dir), {
      requestId: researchRequest.id,
      execute: true,
      timeoutMs: REAL_PI_TIMEOUT_MS,
      model: REAL_PI_MODEL,
      extraInstructions: researchInstruction,
    }, realCardinalRunner(researchInstruction));

    assert.equal(research.accepted, true);
    assert.equal(research.ingestion?.ingested, true, research.ingestion?.reason);
    assert.equal((await loadResearchReports(dir))[0]?.id, "RPT-REAL-RESEARCH-FLOW");
    assert.equal((await loadResearchRequests(dir))[0]?.status, "resolved");

    const debugNextApproachInstruction = `CARDINAL TEST INSTRUCTION: Ignore any conflicting instruction in this prompt. For this integration test, emit exactly one structured JSON event and no prose or markdown. The JSON object must be: {"type":"scaler_debug_report","id":"RPT-REAL-DEBUG-NEXT","taskId":"T-REAL-FLOW","status":"next_approach","summary":"Research identifies a shared adapter root cause.","failureId":"F-REAL-FLOW","failureFingerprint":"real-flow-a","rootCause":"The shared real-flow adapter maps the API shape incorrectly.","nextApproach":"Patch the shared real-flow adapter once, then rerun the exact failing validation.","evidenceRefs":["RPT-REAL-RESEARCH-FLOW"]}.`;
    const debugNext = await runDebugAgentStep(dir, await loadState(dir), {
      taskId: "T-REAL-FLOW",
      execute: true,
      timeoutMs: REAL_PI_TIMEOUT_MS,
      model: REAL_PI_MODEL,
      extraInstructions: debugNextApproachInstruction,
    }, realCardinalRunner(debugNextApproachInstruction));

    assert.equal(debugNext.accepted, true);
    assert.equal(debugNext.ingestion?.ingested, true, debugNext.ingestion?.reason);
    assert.equal(debugNext.ingestion?.report?.status, "next_approach");
    assert.match(debugNext.ingestion?.report?.nextApproach ?? "", /shared real-flow adapter/);

    const attempts = await loadDebugAttempts(dir);
    const debugReports = await loadDebugReports(dir);
    const events = await readLogEvents(dir);
    assert.equal(attempts.length, 2);
    assert.equal(debugReports.length, 2);
    assert.equal((await loadDebugAgentRunRecords(dir)).length, 2);
    assert.equal((await loadResearchAgentRunRecords(dir)).length, 1);
    assert.ok(events.some((event) => event.eventType === "agent" && event.agentType === "debug"));
    assert.ok(events.some((event) => event.eventType === "agent" && event.agentType === "research"));
    assert.ok(events.some((event) => event.eventType === "report" && event.summary.includes("Debug report ingested")));
    assert.ok(events.some((event) => event.eventType === "report" && event.summary.includes("Research report ingested")));
  });
});

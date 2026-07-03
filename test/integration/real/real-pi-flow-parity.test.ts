import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { ensureTaskContextManifest } from "../../../src/context.js";
import { assessDebugRetryGate, loadDebugAttempts, loadDebugReports, recordDebugAttempt } from "../../../src/debug.js";
import { loadDebugAgentRunRecords, runDebugAgentStep } from "../../../src/debug-agent.js";
import { readLogEvents } from "../../../src/logging.js";
import { loadMemoryIndex } from "../../../src/memory.js";
import {
  acceptReplanProposal,
  appendReplanRequest,
  loadExecutionPlan,
  loadProposedExecutionPlan,
  loadReplanDecisions,
  loadReplanRequests,
  saveExecutionPlan,
} from "../../../src/plans.js";
import { loadResearchReports, loadResearchRequests, upsertResearchRequest } from "../../../src/research.js";
import { loadResearchAgentRunRecords, runResearchAgentStep } from "../../../src/research-agent.js";
import { loadPrdRequirements, upsertPrdRequirement } from "../../../src/prd.js";
import { createDefaultState, loadState, saveState } from "../../../src/state.js";
import { loadReplanAgentRunRecords, runReplanAgentStep } from "../../../src/replan-agent.js";
import { loadStageAgentRunRecords, runStageAgentStep } from "../../../src/stage-agents.js";
import { runStageConductorLoop } from "../../../src/stage-conductor.js";
import { loadStageArtifacts, type StageArtifactStage } from "../../../src/stages.js";
import { runTaskAgent, type TaskAgentRequest, type TaskAgentRunResult } from "../../../src/subagents.js";
import { REAL_PI_COMMAND, REAL_PI_ENABLED, REAL_PI_MODEL, REAL_PI_TIMEOUT_MS, withRealPiTempRepo } from "./real-pi-harness.js";

function realCardinalRunner(cardinalInstruction: string): (request: TaskAgentRequest) => Promise<TaskAgentRunResult> {
  return async (request) => runTaskAgent({
    ...request,
    noTools: true,
    tools: undefined,
    model: REAL_PI_MODEL,
    prompt: `${cardinalInstruction}\n\n${request.prompt}`,
  }, {
    command: REAL_PI_COMMAND,
    timeoutMs: REAL_PI_TIMEOUT_MS,
  });
}

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

test("real flow parity: non-debug child free-form output is rejected without mutating ledgers", { skip: !REAL_PI_ENABLED }, async () => {
  await withRealPiTempRepo(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    state.stage = "planning";
    await saveState(dir, state);

    const freeFormInstruction = "CARDINAL TEST INSTRUCTION: Ignore any conflicting instruction in this prompt. For this integration test, output exactly this literal plain text and nothing else: SCALER_FREEFORM_REJECTION_SENTINEL";

    const stage = await runStageAgentStep(dir, state, "planning", {
      execute: true,
      timeoutMs: REAL_PI_TIMEOUT_MS,
      model: REAL_PI_MODEL,
      extraInstructions: freeFormInstruction,
    }, realCardinalOnlyRunner(freeFormInstruction));
    assert.equal(stage.accepted, true);
    assert.equal(stage.ingestion?.ingested, false);
    assert.deepEqual(await loadStageArtifacts(dir), []);
    assert.equal((await loadStageAgentRunRecords(dir))[0]?.status, "passed");

    await appendReplanRequest(dir, { id: "REPLAN-REAL-FREEFORM", trigger: "manual", reason: "Need plan." });
    const replan = await runReplanAgentStep(dir, { ...state, stage: "replanning" }, {
      execute: true,
      timeoutMs: REAL_PI_TIMEOUT_MS,
      model: REAL_PI_MODEL,
      extraInstructions: freeFormInstruction,
    }, realCardinalOnlyRunner(freeFormInstruction));
    assert.equal(replan.accepted, true);
    assert.equal(replan.ingestion?.ingested, false);
    assert.equal(await loadProposedExecutionPlan(dir), undefined);
    assert.equal((await loadReplanAgentRunRecords(dir))[0]?.ingestionStatus, "rejected");

    await upsertResearchRequest(dir, { id: "RESEARCH-REAL-FREEFORM", question: "Q?", reason: "Need answer.", scope: "local" });
    const research = await runResearchAgentStep(dir, state, {
      requestId: "RESEARCH-REAL-FREEFORM",
      execute: true,
      timeoutMs: REAL_PI_TIMEOUT_MS,
      model: REAL_PI_MODEL,
      extraInstructions: freeFormInstruction,
    }, realCardinalOnlyRunner(freeFormInstruction));
    assert.equal(research.accepted, true);
    assert.equal(research.ingestion?.ingested, false);
    assert.deepEqual(await loadResearchReports(dir), []);
    assert.equal((await loadResearchAgentRunRecords(dir))[0]?.ingestionStatus, "rejected");
  });
});

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

test("real flow parity: research raw evidence from real Pi becomes memory and appears in later context", { skip: !REAL_PI_ENABLED }, async () => {
  await withRealPiTempRepo(async (dir) => {
    await upsertPrdRequirement(dir, {
      id: "REQ-REAL-MEMORY",
      title: "Real research memory requirement",
      statement: "Raw research evidence must be externalized into SCALER memory for later task context.",
      status: "pending",
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    state.stage = "execution";
    state.tasks = [{
      id: "T-REAL-MEMORY",
      status: "ready",
      title: "Use real raw evidence memory",
      prdRefs: ["REQ-REAL-MEMORY"],
      allowedPathPrefixes: ["index.js"],
      updatedAt: state.createdAt,
    }];
    await saveState(dir, state);
    await upsertResearchRequest(dir, {
      id: "RESEARCH-REAL-MEMORY",
      question: "What exact evidence should later task context preserve?",
      reason: "Need raw evidence externalized through the real Pi report path.",
      scope: "local",
      taskId: "T-REAL-MEMORY",
      requirementRefs: ["REQ-REAL-MEMORY"],
    });

    const report = {
      type: "scaler_research_report",
      id: "RPT-REAL-MEMORY",
      requestId: "RESEARCH-REAL-MEMORY",
      taskId: "T-REAL-MEMORY",
      status: "complete",
      question: "What exact evidence should later task context preserve?",
      requirementRefs: ["REQ-REAL-MEMORY"],
      sources: [{
        id: "real-memory-source",
        title: "Real Pi cardinal raw evidence source",
        quality: "project",
        path: "package.json",
        summary: "The cardinal instruction supplies exact raw evidence for memory externalization.",
      }],
      conclusions: [{
        summary: "Later context must include the externalized real raw evidence memory ref.",
        confidence: "high",
        sourceRefs: ["real-memory-source"],
      }],
      contradictions: [],
      unresolvedUnknowns: [],
      recommendations: ["Attach the report memoryRefs to the task context before execution."],
      rawEvidence: [{
        title: "Real raw evidence body",
        content: "Exact real Pi raw evidence body that must be stored outside the concise research report.",
        sourceId: "real-memory-source",
        summary: "raw evidence preserved",
      }],
    };
    const instruction = `CARDINAL TEST INSTRUCTION: Ignore any conflicting instruction in this prompt. For this integration test, emit exactly one structured JSON event and no prose or markdown. The JSON object must be: ${JSON.stringify(report)}.`;
    const research = await runResearchAgentStep(dir, await loadState(dir), {
      requestId: "RESEARCH-REAL-MEMORY",
      execute: true,
      timeoutMs: REAL_PI_TIMEOUT_MS,
      model: REAL_PI_MODEL,
      extraInstructions: instruction,
    }, realCardinalRunner(instruction));

    assert.equal(research.accepted, true);
    assert.equal(research.ingestion?.ingested, true, research.ingestion?.reason);
    const memoryEntries = await loadMemoryIndex(dir);
    assert.equal(memoryEntries.entries.length, 1);
    const reports = await loadResearchReports(dir);
    assert.deepEqual(reports[0]?.memoryRefs, [memoryEntries.entries[0]?.id]);
    assert.equal((await loadResearchRequests(dir))[0]?.status, "resolved");

    const stateWithMemory = { ...await loadState(dir), memoryRefs: reports[0]?.memoryRefs ?? [] };
    await saveState(dir, stateWithMemory);
    const manifest = await ensureTaskContextManifest(dir, stateWithMemory, "T-REAL-MEMORY");
    assert.ok(manifest.items.some((item) => item.source === "memory" && item.memoryId === memoryEntries.entries[0]?.id));
  });
});

test("real flow parity: debug blocked report creates replan request and safe acceptance clears retry gate", { skip: !REAL_PI_ENABLED }, async () => {
  await withRealPiTempRepo(async (dir) => {
    await upsertPrdRequirement(dir, {
      id: "REQ-REAL-BLOCKED-KEEP",
      title: "Blocked debug preserved requirement",
      statement: "Debug-blocked work must remain in the execution plan.",
      status: "validated",
      taskIds: ["T-REAL-BLOCKED"],
      evidenceRefs: ["validation-real-blocked-keep"],
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    await upsertPrdRequirement(dir, {
      id: "REQ-REAL-BLOCKED-NEW",
      title: "Blocked debug replacement requirement",
      statement: "A blocked debug cycle needs a follow-up planned task.",
      status: "pending",
      now: new Date("2026-01-01T00:00:01.000Z"),
    });

    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    state.stage = "debugging";
    state.currentTaskId = "T-REAL-BLOCKED";
    state.tasks = [{
      id: "T-REAL-BLOCKED",
      status: "debugging",
      title: "Real Pi debug blocked parity flow",
      allowedPathPrefixes: ["index.js"],
      prdRefs: ["REQ-REAL-BLOCKED-KEEP"],
      updatedAt: state.createdAt,
    }];
    state.validatedTaskIds = ["T-REAL-BLOCKED"];
    state.completedTaskIds = ["T-REAL-BLOCKED"];
    await saveState(dir, state);
    await saveExecutionPlan(dir, {
      version: 1,
      planVersion: 1,
      status: "active",
      title: "Real blocked debug current plan",
      tasks: [{ id: "T-REAL-BLOCKED", title: "Real Pi debug blocked parity flow", prdRefs: ["REQ-REAL-BLOCKED-KEEP"], allowedPathPrefixes: ["index.js"] }],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    await recordDebugAttempt(dir, await loadState(dir), {
      taskId: "T-REAL-BLOCKED",
      failureId: "F-REAL-BLOCKED",
      hypothesis: "Patch local branch A",
      actionSummary: "Changed branch A",
      result: "new_failure",
      failureFingerprint: "real-blocked-a",
      resultingFailureFingerprint: "real-blocked-b",
      evidence: ["blocked-e1"],
    }, new Date("2026-01-01T00:00:01.000Z"));
    await recordDebugAttempt(dir, await loadState(dir), {
      taskId: "T-REAL-BLOCKED",
      failureId: "F-REAL-BLOCKED",
      hypothesis: "Patch local branch B",
      actionSummary: "Changed branch B",
      result: "new_failure",
      failureFingerprint: "real-blocked-b",
      resultingFailureFingerprint: "real-blocked-a",
      evidence: ["blocked-e2"],
    }, new Date("2026-01-01T00:00:02.000Z"));

    const blockedGate = await assessDebugRetryGate(dir, "T-REAL-BLOCKED");
    assert.equal(blockedGate.allowed, false);
    assert.ok((await loadReplanRequests(dir)).some((request) => request.trigger === "debug_cycle"));

    const debugBlockedReport = {
      type: "scaler_debug_report",
      id: "RPT-REAL-DEBUG-BLOCKED",
      taskId: "T-REAL-BLOCKED",
      status: "needs_replan",
      summary: "Local debug is exhausted and needs a replacement plan.",
      failureId: "F-REAL-BLOCKED",
      failureFingerprint: "real-blocked-a",
      cycleSummary: "real-blocked-a -> real-blocked-b -> real-blocked-a",
      attemptedApproaches: ["Changed branch A", "Changed branch B"],
      investigationSummary: "No safe local-only fix remains.",
      replanReason: "Add a follow-up task that preserves the blocked work and isolates the replacement path.",
      evidenceRefs: ["blocked-e1", "blocked-e2"],
    };
    const debugInstruction = `CARDINAL TEST INSTRUCTION: Ignore any conflicting instruction in this prompt. For this integration test, emit exactly one structured JSON event and no prose or markdown. The JSON object must be: ${JSON.stringify(debugBlockedReport)}.`;
    const debug = await runDebugAgentStep(dir, await loadState(dir), {
      taskId: "T-REAL-BLOCKED",
      execute: true,
      timeoutMs: REAL_PI_TIMEOUT_MS,
      model: REAL_PI_MODEL,
      extraInstructions: debugInstruction,
    }, realCardinalRunner(debugInstruction));
    assert.equal(debug.accepted, true);
    assert.equal(debug.ingestion?.ingested, true, debug.ingestion?.reason);
    assert.ok((await loadReplanRequests(dir)).some((request) => request.trigger === "debug_blocked"));

    const safeProposal = {
      type: "scaler_replan_proposal",
      plan: {
        version: 1,
        planVersion: 2,
        status: "draft",
        title: "Real blocked debug safe replan",
        source: "real-pi-cardinal-debug-blocked-flow",
        tasks: [
          { id: "T-REAL-BLOCKED", title: "Real Pi debug blocked parity flow", prdRefs: ["REQ-REAL-BLOCKED-KEEP"], allowedPathPrefixes: ["index.js"], validationRefs: ["validation-real-blocked-keep"] },
          { id: "T-REAL-BLOCKED-NEW", title: "Isolate blocked debug replacement", prdRefs: ["REQ-REAL-BLOCKED-NEW"], allowedPathPrefixes: ["blocked-replacement.js"], dependsOn: ["T-REAL-BLOCKED"] },
        ],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    };
    const replanInstruction = `CARDINAL TEST INSTRUCTION: Ignore any conflicting instruction in this prompt. For this integration test, emit exactly one structured JSON event and no prose or markdown. The JSON object must be: ${JSON.stringify(safeProposal)}.`;
    const replan = await runReplanAgentStep(dir, await loadState(dir), {
      execute: true,
      timeoutMs: REAL_PI_TIMEOUT_MS,
      model: REAL_PI_MODEL,
      extraInstructions: replanInstruction,
    }, realCardinalRunner(replanInstruction));
    assert.equal(replan.accepted, true);
    assert.equal(replan.ingestion?.ingested, true, replan.ingestion?.reason);
    assert.equal(replan.ingestion?.preservation?.ok, true, replan.ingestion?.reason);

    const accepted = await acceptReplanProposal(dir, await loadState(dir), await loadPrdRequirements(dir), {
      now: new Date("2026-01-01T00:00:03.000Z"),
    });
    assert.equal(accepted.accepted, true, accepted.message);
    assert.equal((await loadReplanRequests(dir)).every((request) => request.status === "resolved"), true);
    assert.equal((await assessDebugRetryGate(dir, "T-REAL-BLOCKED")).allowed, true);
  });
});

test("real flow parity: stage conductor ingests real Pi artifacts and completes Stage I-IV", { skip: !REAL_PI_ENABLED }, async () => {
  await withRealPiTempRepo(async (dir) => {
    await mkdir(join(dir, "docs"), { recursive: true });
    await upsertPrdRequirement(dir, {
      id: "REQ-REAL-STAGE",
      title: "Real stage chain requirement",
      statement: "The real Pi stage conductor must advance through ready, consistent artifacts.",
      status: "pending",
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    state.stage = "prd";
    await saveState(dir, state);

    const result = await runStageConductorLoop(dir, state, { execute: true, maxSteps: 5, timeoutMs: REAL_PI_TIMEOUT_MS, model: REAL_PI_MODEL }, async (request) => {
      const stage = request.taskId.replace(/^stage-/, "") as StageArtifactStage;
      const pathByStage: Partial<Record<StageArtifactStage, string>> = {
        prd: "docs/real-stage-prd.md",
        knowledge: "docs/real-stage-knowledge.md",
        planning: "docs/real-stage-plan.md",
      };
      const path = pathByStage[stage];
      if (path) await writeFile(join(dir, path), `# ${stage}\n\nReal Pi cardinal ${stage} artifact.\n`, "utf8");
      const artifact = {
        type: "scaler_stage_artifact",
        stage,
        status: "ready",
        title: `Real Pi ${stage} artifact`,
        ...(path ? { path } : {}),
        summary: `Ready ${stage} artifact from the real Pi flow-parity suite.`,
        evidenceRefs: [`real-stage-${stage}-evidence`],
        requirementRefs: ["REQ-REAL-STAGE"],
        ...(stage === "execution" ? { taskRefs: [] } : {}),
      };
      const instruction = `CARDINAL TEST INSTRUCTION: Ignore any conflicting instruction in this prompt. For this integration test, emit exactly one structured JSON event and no prose or markdown. The JSON object must be: ${JSON.stringify(artifact)}.`;
      return await realCardinalRunner(instruction)(request);
    });

    assert.equal(result.accepted, true);
    assert.equal(result.completed, true, result.stopReason);
    assert.equal(result.finalState.stage, "completed");
    assert.deepEqual(result.steps.map((step) => step.stage), ["prd", "knowledge", "planning", "execution"]);
    assert.ok(result.steps.every((step) => step.stageAgent?.ingestion?.ingested), "expected every stage-agent report to ingest");
    assert.ok(result.steps.every((step) => step.advancement?.advanced), "expected every stage to advance");

    const artifacts = await loadStageArtifacts(dir);
    assert.deepEqual(artifacts.map((artifact) => artifact.stage), ["prd", "knowledge", "planning", "execution"]);
    assert.ok(artifacts.every((artifact) => artifact.status === "ready"));
    assert.equal((await loadStageAgentRunRecords(dir)).length, 4);
    assert.equal((await loadState(dir)).stage, "completed");

    const events = await readLogEvents(dir);
    assert.ok(events.some((event) => event.eventType === "agent" && event.agentType === "stage"));
    assert.ok(events.some((event) => event.eventType === "report" && event.summary.includes("scaler_stage_artifact")));
  });
});

test("real flow parity: unsafe replan proposal from real Pi is rejected without replacing current plan", { skip: !REAL_PI_ENABLED }, async () => {
  await withRealPiTempRepo(async (dir) => {
    await upsertPrdRequirement(dir, {
      id: "REQ-REAL-UNSAFE-KEEP",
      title: "Preserved unsafe-parity requirement",
      statement: "Validated work must not be dropped by unsafe proposals.",
      status: "validated",
      taskIds: ["T-REAL-UNSAFE-KEEP"],
      evidenceRefs: ["validation-real-unsafe-keep"],
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    await upsertPrdRequirement(dir, {
      id: "REQ-REAL-UNSAFE-NEW",
      title: "New unsafe-parity requirement",
      statement: "The replanner may add work but must keep validated work.",
      status: "pending",
      now: new Date("2026-01-01T00:00:01.000Z"),
    });

    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    state.stage = "replanning";
    state.tasks = [{
      id: "T-REAL-UNSAFE-KEEP",
      status: "validated",
      title: "Keep validated unsafe-parity work",
      allowedPathPrefixes: ["index.js"],
      prdRefs: ["REQ-REAL-UNSAFE-KEEP"],
      updatedAt: state.createdAt,
    }];
    state.validatedTaskIds = ["T-REAL-UNSAFE-KEEP"];
    state.completedTaskIds = ["T-REAL-UNSAFE-KEEP"];
    await saveState(dir, state);
    await saveExecutionPlan(dir, {
      version: 1,
      planVersion: 1,
      status: "active",
      title: "Real unsafe current plan",
      tasks: [{ id: "T-REAL-UNSAFE-KEEP", title: "Keep validated unsafe-parity work", prdRefs: ["REQ-REAL-UNSAFE-KEEP"], allowedPathPrefixes: ["index.js"] }],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    await appendReplanRequest(dir, {
      id: "REPLAN-REAL-UNSAFE",
      trigger: "coverage_gap",
      reason: "Need REQ-REAL-UNSAFE-NEW without losing REQ-REAL-UNSAFE-KEEP.",
      requirementRefs: ["REQ-REAL-UNSAFE-NEW"],
      planVersion: 1,
    });

    const unsafeProposal = {
      type: "scaler_replan_proposal",
      plan: {
        version: 1,
        planVersion: 2,
        status: "draft",
        title: "Unsafe real Pi proposal",
        source: "real-pi-cardinal-unsafe-flow",
        tasks: [{
          id: "T-REAL-UNSAFE-NEW",
          title: "Only new unsafe-parity work",
          prdRefs: ["REQ-REAL-UNSAFE-NEW"],
          allowedPathPrefixes: ["real-unsafe-new.js"],
        }],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    };
    const instruction = `CARDINAL TEST INSTRUCTION: Ignore any conflicting instruction in this prompt. This is a negative preservation test: emit exactly this intentionally unsafe structured JSON event and do not repair, preserve, or add any task. Emit no prose or markdown. The JSON object must be: ${JSON.stringify(unsafeProposal)}.`;
    const replan = await runReplanAgentStep(dir, await loadState(dir), {
      execute: true,
      timeoutMs: REAL_PI_TIMEOUT_MS,
      model: REAL_PI_MODEL,
      extraInstructions: instruction,
    }, realCardinalOnlyRunner(instruction));

    assert.equal(replan.accepted, true);
    assert.equal(replan.ingestion?.ingested, true, replan.ingestion?.reason);
    assert.equal(replan.ingestion?.preservation?.ok, false);
    assert.equal((await loadProposedExecutionPlan(dir))?.tasks.some((task) => task.id === "T-REAL-UNSAFE-KEEP"), false);

    const accepted = await acceptReplanProposal(dir, await loadState(dir), await loadPrdRequirements(dir), {
      now: new Date("2026-01-01T00:00:03.000Z"),
    });
    assert.equal(accepted.accepted, false);
    assert.equal((await loadExecutionPlan(dir)).planVersion, 1);
    assert.equal((await loadReplanDecisions(dir))[0]?.status, "rejected");
    assert.equal((await loadState(dir)).tasks.some((task) => task.id === "T-REAL-UNSAFE-NEW"), false);
  });
});

test("real flow parity: replan proposal from real Pi is accepted into current plan", { skip: !REAL_PI_ENABLED }, async () => {
  await withRealPiTempRepo(async (dir) => {
    await upsertPrdRequirement(dir, {
      id: "REQ-REAL-KEEP",
      title: "Preserved real requirement",
      statement: "Validated real-flow work must remain planned.",
      status: "validated",
      taskIds: ["T-REAL-KEEP"],
      evidenceRefs: ["validation-real-keep"],
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    await upsertPrdRequirement(dir, {
      id: "REQ-REAL-NEW",
      title: "New real requirement",
      statement: "A real-flow coverage gap must become a planned task.",
      status: "pending",
      now: new Date("2026-01-01T00:00:01.000Z"),
    });

    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    state.stage = "replanning";
    state.tasks = [{
      id: "T-REAL-KEEP",
      status: "validated",
      title: "Keep validated real work",
      allowedPathPrefixes: ["index.js"],
      prdRefs: ["REQ-REAL-KEEP"],
      updatedAt: state.createdAt,
    }];
    state.validatedTaskIds = ["T-REAL-KEEP"];
    state.completedTaskIds = ["T-REAL-KEEP"];
    await saveState(dir, state);
    await saveExecutionPlan(dir, {
      version: 1,
      planVersion: 1,
      status: "active",
      title: "Real current plan",
      source: "real-flow-parity-fixture",
      tasks: [{ id: "T-REAL-KEEP", title: "Keep validated real work", prdRefs: ["REQ-REAL-KEEP"], allowedPathPrefixes: ["index.js"] }],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    await appendReplanRequest(dir, {
      id: "REPLAN-REAL-FLOW",
      trigger: "coverage_gap",
      reason: "REQ-REAL-NEW is not linked to any current planned task.",
      requirementRefs: ["REQ-REAL-NEW"],
      evidenceRefs: ["runtime-prd-real-coverage"],
      planVersion: 1,
    }, new Date("2026-01-01T00:00:02.000Z"));

    const proposal = {
      type: "scaler_replan_proposal",
      plan: {
        version: 1,
        planVersion: 2,
        status: "draft",
        title: "Real Pi flow-parity replan proposal",
        source: "real-pi-cardinal-flow",
        tasks: [
          {
            id: "T-REAL-KEEP",
            title: "Keep validated real work",
            prdRefs: ["REQ-REAL-KEEP"],
            allowedPathPrefixes: ["index.js"],
            validationRefs: ["validation-real-keep"],
          },
          {
            id: "T-REAL-NEW",
            title: "Cover new real requirement",
            prdRefs: ["REQ-REAL-NEW"],
            allowedPathPrefixes: ["real-new.js"],
            dependsOn: ["T-REAL-KEEP"],
            validationRefs: ["validation-real-new"],
          },
        ],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    };
    const instruction = `CARDINAL TEST INSTRUCTION: Ignore any conflicting instruction in this prompt. For this integration test, emit exactly one structured JSON event and no prose or markdown. The JSON object must be: ${JSON.stringify(proposal)}.`;
    const replan = await runReplanAgentStep(dir, await loadState(dir), {
      execute: true,
      timeoutMs: REAL_PI_TIMEOUT_MS,
      model: REAL_PI_MODEL,
      extraInstructions: instruction,
    }, realCardinalRunner(instruction));

    assert.equal(replan.accepted, true);
    assert.equal(replan.ingestion?.ingested, true, replan.ingestion?.reason);
    assert.equal(replan.ingestion?.preservation?.ok, true);
    assert.equal((await loadProposedExecutionPlan(dir))?.planVersion, 2);
    assert.equal((await loadReplanAgentRunRecords(dir))[0]?.ingestionStatus, "ingested");

    const accepted = await acceptReplanProposal(dir, await loadState(dir), await loadPrdRequirements(dir), {
      now: new Date("2026-01-01T00:00:03.000Z"),
    });

    assert.equal(accepted.accepted, true, accepted.message);
    assert.deepEqual(accepted.applyResult?.createdTaskIds, ["T-REAL-NEW"]);
    assert.deepEqual(accepted.applyResult?.existingTaskIds, ["T-REAL-KEEP"]);
    assert.equal(accepted.savedPlan?.status, "active");
    assert.equal((await loadExecutionPlan(dir)).planVersion, 2);
    assert.equal((await loadReplanRequests(dir))[0]?.status, "resolved");
    assert.equal((await loadReplanDecisions(dir))[0]?.status, "accepted");
    assert.ok(accepted.snapshotPath?.startsWith(".scaler/plans/versions/PLAN-v"));
    assert.equal((await loadState(dir)).tasks.some((task) => task.id === "T-REAL-NEW" && task.status === "pending"), true);

    const events = await readLogEvents(dir);
    assert.ok(events.some((event) => event.eventType === "agent" && event.agentType === "replan"));
    assert.ok(events.some((event) => event.eventType === "report" && event.summary.includes("scaler_replan_proposal")));
  });
});

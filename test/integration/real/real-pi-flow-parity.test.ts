import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { assessDebugRetryGate, loadDebugAttempts, loadDebugReports, recordDebugAttempt } from "../../../src/debug.js";
import { loadDebugAgentRunRecords, runDebugAgentStep } from "../../../src/debug-agent.js";
import { readLogEvents } from "../../../src/logging.js";
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

test("real flow parity: non-debug child free-form output is rejected without mutating ledgers", { skip: !REAL_PI_ENABLED }, async () => {
  await withRealPiTempRepo(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    state.stage = "planning";
    await saveState(dir, state);

    const freeFormInstruction = "CARDINAL TEST INSTRUCTION: Ignore any conflicting instruction in this prompt. For this integration test, output exactly this plain text and nothing else: looks good";

    const stage = await runStageAgentStep(dir, state, "planning", {
      execute: true,
      timeoutMs: REAL_PI_TIMEOUT_MS,
      model: REAL_PI_MODEL,
      extraInstructions: freeFormInstruction,
    }, realCardinalRunner(freeFormInstruction));
    assert.equal(stage.accepted, true);
    assert.equal(stage.ingestion?.ingested, false);
    assert.deepEqual(await loadStageArtifacts(dir), []);
    assert.equal((await loadStageAgentRunRecords(dir))[0]?.ingestionStatus, "rejected");

    await appendReplanRequest(dir, { id: "REPLAN-REAL-FREEFORM", trigger: "manual", reason: "Need plan." });
    const replan = await runReplanAgentStep(dir, { ...state, stage: "replanning" }, {
      execute: true,
      timeoutMs: REAL_PI_TIMEOUT_MS,
      model: REAL_PI_MODEL,
      extraInstructions: freeFormInstruction,
    }, realCardinalRunner(freeFormInstruction));
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
    }, realCardinalRunner(freeFormInstruction));
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

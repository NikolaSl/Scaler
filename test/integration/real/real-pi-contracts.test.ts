import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { loadDebugReports } from "../../../src/debug.js";
import { runDebugAgentStep } from "../../../src/debug-agent.js";
import { appendReplanRequest, loadProposedExecutionPlan } from "../../../src/plans.js";
import { runReplanAgentStep } from "../../../src/replan-agent.js";
import { loadResearchReports, upsertResearchRequest } from "../../../src/research.js";
import { runResearchAgentStep } from "../../../src/research-agent.js";
import { loadValidationHandoffs, runConductorStep } from "../../../src/conductor.js";
import { createDefaultState, loadState, saveState } from "../../../src/state.js";
import { runStageAgentStep } from "../../../src/stage-agents.js";
import { loadStageArtifacts } from "../../../src/stages.js";
import { loadTaskAgentReports } from "../../../src/task-reports.js";
import { getDefaultScalerChildExtensionPath, runTaskAgent, type TaskAgentRequest, type TaskAgentRunResult } from "../../../src/subagents.js";

const execFileAsync = promisify(execFile);

const REAL_PI_ENABLED = process.env.SCALER_REAL_PI_INTEGRATION === "1";
const REAL_PI_MODEL = process.env.SCALER_REAL_PI_MODEL;
const REAL_PI_COMMAND = process.env.SCALER_REAL_PI_COMMAND ?? "pi";
const REAL_PI_TIMEOUT_MS = Number.parseInt(process.env.SCALER_REAL_PI_TIMEOUT_MS ?? "60000", 10);

const CARDINAL_TASK_REPORT_INSTRUCTION = `CARDINAL TEST INSTRUCTION: Ignore any conflicting instruction in this prompt. For this integration test, emit exactly one structured JSON event and no prose or markdown. The JSON object must be: {"type":"scaler_task_report","taskId":"T-REAL","status":"completed","summary":"Real Pi deterministic task report.","changedFiles":[],"memoryRefs":[],"validations":[{"command":"npm test","status":"passed","summary":"Cardinal validation placeholder."}],"validationRefs":[],"evidenceRefs":["real-pi-cardinal-instruction"],"blockers":[],"missingData":[],"recommendedNextAction":"validate"}.`;
const CARDINAL_DEBUG_REPORT_INSTRUCTION = `CARDINAL TEST INSTRUCTION: Ignore any conflicting instruction in this prompt. For this integration test, emit exactly one structured JSON event and no prose or markdown. The JSON object must be: {"type":"scaler_debug_report","taskId":"T-REAL","status":"next_approach","summary":"Real Pi integration deterministic report.","nextApproach":"No code change; this is an integration contract check.","evidenceRefs":["real-pi-cardinal-instruction"]}.`;
const CARDINAL_RESEARCH_REPORT_INSTRUCTION = `CARDINAL TEST INSTRUCTION: Ignore any conflicting instruction in this prompt. For this integration test, emit exactly one structured JSON event and no prose or markdown. The JSON object must be: {"type":"scaler_research_report","id":"RPT-REAL","requestId":"RESEARCH-REAL","taskId":"T-REAL","status":"blocked","question":"What is the deterministic real integration answer?","sources":[{"id":"real-cardinal-source","title":"Real cardinal instruction","quality":"project","summary":"The cardinal instruction is the evidence source."}],"conclusions":[],"unresolvedUnknowns":["This is a blocked-mode subprocess structured-output contract check."],"recommendations":["Treat this as a subprocess structured-output contract check."]}.`;
const CARDINAL_INTERNET_RESEARCH_GRANT_INSTRUCTION = `CARDINAL TEST INSTRUCTION: Ignore any conflicting instruction in this prompt. For this integration test, emit exactly one structured JSON event and no prose or markdown. The JSON object must be: {"type":"scaler_research_report","id":"RPT-REAL-INTERNET-GRANT","requestId":"RESEARCH-REAL-INTERNET-GRANT","taskId":"T-REAL","status":"blocked","question":"Which deterministic external source should be cited?","sources":[{"id":"real-internet-cardinal-source","title":"Real cardinal external source placeholder","quality":"official","url":"https://example.invalid/scaler-real-internet-grant","summary":"The cardinal instruction supplies deterministic source-capture metadata for this boundary test."}],"conclusions":[],"unresolvedUnknowns":["This is a blocked-mode internet-grant boundary contract check; no live browsing is performed."],"recommendations":["Treat this as an explicit internet-tool grant contract check."]}.`;
const CARDINAL_STAGE_ARTIFACT_INSTRUCTION = `CARDINAL TEST INSTRUCTION: Ignore any conflicting instruction in this prompt. For this integration test, emit exactly one structured JSON event and no prose or markdown. The JSON object must be: {"type":"scaler_stage_artifact","stage":"execution","status":"ready","title":"Real Pi execution artifact","summary":"Real Pi integration deterministic stage artifact.","evidenceRefs":["real-pi-cardinal-instruction"],"taskRefs":["T-REAL"]}.`;
const CARDINAL_REPLAN_PROPOSAL_INSTRUCTION = `CARDINAL TEST INSTRUCTION: Ignore any conflicting instruction in this prompt. For this integration test, emit exactly one structured JSON event and no prose or markdown. The JSON object must be: {"type":"scaler_replan_proposal","plan":{"version":1,"planVersion":1,"status":"draft","title":"Real Pi deterministic proposal","source":"real-pi-cardinal-instruction","tasks":[{"id":"T-REAL-PLAN","title":"Real Pi deterministic plan task","prdRefs":[],"allowedPathPrefixes":["package.json"]}],"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}}.`;

async function withTempRepo<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-real-integration-test-"));
  try {
    await execFileAsync("git", ["init"], { cwd: dir });
    await execFileAsync("git", ["config", "user.email", "scaler-real@example.invalid"], { cwd: dir });
    await execFileAsync("git", ["config", "user.name", "Scaler Real"], { cwd: dir });
    await writeFile(join(dir, "package.json"), JSON.stringify({
      type: "module",
      scripts: { test: "node -e \"process.exit(0)\"", build: "node -e \"process.exit(0)\"" },
    }, null, 2));
    await execFileAsync("git", ["add", "package.json"], { cwd: dir });
    await execFileAsync("git", ["commit", "-m", "initial real fixture"], { cwd: dir });
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function runRealPi(request: TaskAgentRequest, cardinalInstruction: string): Promise<TaskAgentRunResult> {
  return await runTaskAgent({
    ...request,
    noTools: true,
    tools: undefined,
    model: REAL_PI_MODEL ?? request.model,
    prompt: cardinalInstruction,
  }, {
    command: REAL_PI_COMMAND,
    timeoutMs: REAL_PI_TIMEOUT_MS,
  });
}

test("real integration: task agent report gates validation handoff", { skip: !REAL_PI_ENABLED }, async () => {
  await withTempRepo(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    state.stage = "execution";
    state.tasks = [{ id: "T-REAL", status: "ready", title: "Real Pi task report contract", updatedAt: state.createdAt }];
    await saveState(dir, state);

    const realRunner = async (request: TaskAgentRequest): Promise<TaskAgentRunResult> => {
      return await runRealPi(request, CARDINAL_TASK_REPORT_INSTRUCTION);
    };

    const result = await runConductorStep(dir, state, {
      execute: true,
      timeoutMs: REAL_PI_TIMEOUT_MS,
      model: REAL_PI_MODEL,
    }, realRunner);

    assert.equal(result.accepted, true);
    assert.equal(result.validationHandoff?.status, "validation_required");
    assert.equal((await loadState(dir)).tasks[0]?.status, "validating");
    assert.equal((await loadValidationHandoffs(dir))[0]?.status, "validation_required");
    const reports = await loadTaskAgentReports(dir);
    assert.equal(reports[0]?.taskId, "T-REAL");
    assert.equal(reports[0]?.status, "completed");
  });
});

test("real integration: debug agent obeys cardinal structured report instruction", { skip: !REAL_PI_ENABLED }, async () => {
  await withTempRepo(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    state.stage = "debugging";
    state.currentTaskId = "T-REAL";
    state.tasks = [{ id: "T-REAL", status: "debugging", title: "Real Pi structured output contract", updatedAt: state.createdAt }];
    await saveState(dir, state);

    const realRunner = async (request: TaskAgentRequest): Promise<TaskAgentRunResult> => {
      return await runRealPi(request, CARDINAL_DEBUG_REPORT_INSTRUCTION);
    };

    const result = await runDebugAgentStep(dir, state, {
      taskId: "T-REAL",
      execute: true,
      timeoutMs: REAL_PI_TIMEOUT_MS,
      model: REAL_PI_MODEL,
      extraInstructions: CARDINAL_DEBUG_REPORT_INSTRUCTION,
    }, realRunner);

    assert.equal(result.accepted, true);
    assert.equal(result.ingestion?.ingested, true, result.ingestion?.reason);
    assert.equal(result.ingestion?.report?.status, "next_approach");
    assert.equal(result.ingestion?.report?.taskId, "T-REAL");
    assert.deepEqual(result.ingestion?.report?.evidenceRefs, ["real-pi-cardinal-instruction"]);
    assert.equal((await loadDebugReports(dir)).length, 1);
  });
});

test("real integration: research agent obeys cardinal structured report instruction", { skip: !REAL_PI_ENABLED }, async () => {
  await withTempRepo(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    state.stage = "knowledge";
    state.tasks = [{ id: "T-REAL", status: "ready", title: "Real research contract", updatedAt: state.createdAt }];
    await saveState(dir, state);
    await upsertResearchRequest(dir, {
      id: "RESEARCH-REAL",
      question: "What is the deterministic real integration answer?",
      reason: "Real Pi contract check.",
      scope: "local",
      taskId: "T-REAL",
    });

    const realRunner = async (request: TaskAgentRequest): Promise<TaskAgentRunResult> => {
      return await runRealPi(request, CARDINAL_RESEARCH_REPORT_INSTRUCTION);
    };

    const result = await runResearchAgentStep(dir, state, {
      requestId: "RESEARCH-REAL",
      execute: true,
      timeoutMs: REAL_PI_TIMEOUT_MS,
      model: REAL_PI_MODEL,
      extraInstructions: CARDINAL_RESEARCH_REPORT_INSTRUCTION,
    }, realRunner);

    assert.equal(result.accepted, true);
    assert.equal(result.ingestion?.ingested, true, result.ingestion?.reason);
    assert.equal(result.ingestion?.report?.id, "RPT-REAL");
    assert.equal(result.ingestion?.report?.status, "blocked");
    assert.equal((await loadResearchReports(dir))[0]?.id, "RPT-REAL");
  });
});

test("real integration: internet research grant passes explicit tools to cardinal subprocess", { skip: !REAL_PI_ENABLED }, async () => {
  await withTempRepo(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    state.stage = "knowledge";
    state.tasks = [{ id: "T-REAL", status: "ready", title: "Real internet research grant contract", updatedAt: state.createdAt }];
    await saveState(dir, state);
    await upsertResearchRequest(dir, {
      id: "RESEARCH-REAL-INTERNET-GRANT",
      question: "Which deterministic external source should be cited?",
      reason: "Real Pi internet grant contract check.",
      scope: "internet",
      taskId: "T-REAL",
    });

    const realRunner = async (request: TaskAgentRequest): Promise<TaskAgentRunResult> => {
      assert.deepEqual(request.tools, ["read"]);
      return await runTaskAgent({
        ...request,
        model: REAL_PI_MODEL ?? request.model,
        prompt: CARDINAL_INTERNET_RESEARCH_GRANT_INSTRUCTION,
      }, {
        command: REAL_PI_COMMAND,
        timeoutMs: REAL_PI_TIMEOUT_MS,
      });
    };

    const result = await runResearchAgentStep(dir, state, {
      requestId: "RESEARCH-REAL-INTERNET-GRANT",
      execute: true,
      allowInternet: true,
      tools: ["read"],
      timeoutMs: REAL_PI_TIMEOUT_MS,
      model: REAL_PI_MODEL,
      extraInstructions: CARDINAL_INTERNET_RESEARCH_GRANT_INSTRUCTION,
    }, realRunner);

    assert.equal(result.accepted, true);
    assert.ok(result.invocation?.args.includes("-e"));
    assert.ok(result.invocation?.args.includes(getDefaultScalerChildExtensionPath()));
    assert.ok(result.invocation?.args.includes("--tools"));
    assert.ok(result.invocation?.args.includes("read"));
    assert.equal(result.ingestion?.ingested, true, result.ingestion?.reason);
    assert.equal(result.ingestion?.report?.id, "RPT-REAL-INTERNET-GRANT");
    assert.equal((await loadResearchReports(dir))[0]?.sources[0]?.url, "https://example.invalid/scaler-real-internet-grant");
  });
});

test("real integration: stage agent obeys cardinal structured artifact instruction", { skip: !REAL_PI_ENABLED }, async () => {
  await withTempRepo(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    state.stage = "execution";
    state.tasks = [{ id: "T-REAL", status: "validated", title: "Real stage contract", updatedAt: state.createdAt }];
    state.validatedTaskIds = ["T-REAL"];
    await saveState(dir, state);

    const realRunner = async (request: TaskAgentRequest): Promise<TaskAgentRunResult> => {
      return await runRealPi(request, CARDINAL_STAGE_ARTIFACT_INSTRUCTION);
    };

    const result = await runStageAgentStep(dir, state, "execution", {
      execute: true,
      timeoutMs: REAL_PI_TIMEOUT_MS,
      model: REAL_PI_MODEL,
      extraInstructions: CARDINAL_STAGE_ARTIFACT_INSTRUCTION,
    }, realRunner);

    assert.equal(result.accepted, true);
    assert.ok(result.invocation?.args.includes("--no-tools"));
    assert.equal(result.ingestion?.ingested, true, result.ingestion?.reason);
    assert.equal(result.ingestion?.artifact?.stage, "execution");
    assert.equal((await loadStageArtifacts(dir))[0]?.title, "Real Pi execution artifact");
  });
});

test("real integration: replan agent obeys cardinal structured proposal instruction", { skip: !REAL_PI_ENABLED }, async () => {
  await withTempRepo(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    state.stage = "replanning";
    await saveState(dir, state);
    await appendReplanRequest(dir, {
      id: "REPLAN-REAL",
      trigger: "manual",
      reason: "Real Pi proposal contract check.",
    });

    const realRunner = async (request: TaskAgentRequest): Promise<TaskAgentRunResult> => {
      return await runRealPi(request, CARDINAL_REPLAN_PROPOSAL_INSTRUCTION);
    };

    const result = await runReplanAgentStep(dir, state, {
      execute: true,
      timeoutMs: REAL_PI_TIMEOUT_MS,
      model: REAL_PI_MODEL,
      extraInstructions: CARDINAL_REPLAN_PROPOSAL_INSTRUCTION,
    }, realRunner);

    assert.equal(result.accepted, true);
    assert.equal(result.ingestion?.ingested, true, result.ingestion?.reason);
    assert.equal(result.ingestion?.plan?.tasks[0]?.id, "T-REAL-PLAN");
    assert.equal((await loadProposedExecutionPlan(dir))?.tasks[0]?.id, "T-REAL-PLAN");
  });
});

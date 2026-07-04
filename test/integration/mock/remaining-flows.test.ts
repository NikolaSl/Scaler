import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { setBudgetLimits } from "../../../src/budgets.js";
import { ensureTaskContextManifest, loadTaskContextManifest } from "../../../src/context.js";
import { assessDebugRetryGate, loadDebugReports, recordDebugAttempt } from "../../../src/debug.js";
import { runDebugAgentStep } from "../../../src/debug-agent.js";
import { assessGitStatusSafety } from "../../../src/git.js";
import { acquireExecutionLock, releaseExecutionLock } from "../../../src/locks.js";
import { readLogEvents } from "../../../src/logging.js";
import { loadMemoryIndex, writeMemory } from "../../../src/memory.js";
import { commitWithExecutionLock, runValidationWithExecutionLock } from "../../../src/operations.js";
import {
  acceptReplanProposal,
  appendReplanRequest,
  loadExecutionPlan,
  loadProposedExecutionPlan,
  loadReplanDecisions,
  loadReplanRequests,
  saveExecutionPlan,
} from "../../../src/plans.js";
import { loadPrdRequirements, upsertPrdRequirement } from "../../../src/prd.js";
import { loadReplanAgentRunRecords, runReplanAgentStep } from "../../../src/replan-agent.js";
import { loadResearchReports, loadResearchRequests, upsertResearchRequest } from "../../../src/research.js";
import { loadResearchAgentRunRecords, runResearchAgentStep } from "../../../src/research-agent.js";
import { assessToolCallSafety } from "../../../src/safety.js";
import { createDefaultState, loadState, saveState } from "../../../src/state.js";
import { loadStageAgentRunRecords, runStageAgentStep } from "../../../src/stage-agents.js";
import { runStageConductorStep } from "../../../src/stage-conductor.js";
import { loadStageArtifacts, upsertStageArtifact } from "../../../src/stages.js";
import type { TaskAgentRequest, TaskAgentRunResult } from "../../../src/subagents.js";
import { createTask } from "../../../src/tasks.js";
import type { ScalerState } from "../../../src/types.js";
import { applyValidationReport } from "../../../src/validation.js";
import { runConductorStep } from "../../../src/conductor.js";

const execFileAsync = promisify(execFile);

async function withTempRepo<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-remaining-integration-test-"));
  try {
    await execFileAsync("git", ["init"], { cwd: dir });
    await execFileAsync("git", ["config", "user.email", "scaler-test@example.invalid"], { cwd: dir });
    await execFileAsync("git", ["config", "user.name", "Scaler Test"], { cwd: dir });
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "package.json"), JSON.stringify({
      type: "module",
      scripts: { test: "node test-runner.js", build: "node -e \"process.exit(0)\"" },
    }, null, 2));
    await writeFile(join(dir, "test-runner.js"), "process.exit(0);\n");
    await writeFile(join(dir, "src/app.js"), "export const value = 1;\n");
    await execFileAsync("git", ["add", "package.json", "test-runner.js", "src/app.js"], { cwd: dir });
    await execFileAsync("git", ["commit", "-m", "initial fixture"], { cwd: dir });
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function stateAt(stage: ScalerState["stage"] = "execution"): ScalerState {
  const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
  state.stage = stage;
  return state;
}

function taskReport(taskId: string): Record<string, unknown> {
  return { type: "scaler_task_report", taskId, status: "completed", summary: "Task completed.", changedFiles: [], memoryRefs: [], validations: [], validationRefs: [], evidenceRefs: [], blockers: [], missingData: [], recommendedNextAction: "validate" };
}

function passedRunner(taskId = "T-001"): Promise<TaskAgentRunResult> {
  return Promise.resolve({ taskId, exitCode: 0, stdoutEvents: [taskReport(taskId)], stderr: "", timedOut: false, aborted: false });
}

async function setupRequirementAndPlan(dir: string, state: ScalerState): Promise<void> {
  await upsertPrdRequirement(dir, {
    id: "REQ-KEEP",
    title: "Keep requirement",
    statement: "Validated work must be preserved.",
    status: "validated",
    taskIds: ["T-KEEP"],
    now: new Date("2026-01-01T00:00:00.000Z"),
  });
  await upsertPrdRequirement(dir, {
    id: "REQ-NEW",
    title: "New requirement",
    statement: "New requirement must be planned.",
    status: "pending",
    now: new Date("2026-01-01T00:00:01.000Z"),
  });
  state.tasks = [{ id: "T-KEEP", status: "validated", title: "Keep", allowedPathPrefixes: ["src/app.js"], prdRefs: ["REQ-KEEP"], updatedAt: state.createdAt }];
  state.validatedTaskIds = ["T-KEEP"];
  state.completedTaskIds = ["T-KEEP"];
  await saveState(dir, state);
  await saveExecutionPlan(dir, {
    version: 1,
    planVersion: 1,
    status: "active",
    title: "Current plan",
    tasks: [{ id: "T-KEEP", title: "Keep", prdRefs: ["REQ-KEEP"], allowedPathPrefixes: ["src/app.js"] }],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
}

test("mock integration: budget hard stops pause conductor and validation before expensive work", async () => {
  await withTempRepo(async (dir) => {
    let state = stateAt("execution");
    state = setBudgetLimits(state, { spawnedAgents: { hard: 1 }, validationLoops: { hard: 1 } }, new Date("2026-01-01T00:00:00.000Z"));
    await saveState(dir, state);
    const created = await createTask(dir, state, { id: "T-BUDGET", title: "Budget task", status: "ready", allowedPathPrefixes: ["src/app.js"] });
    const conductor = await runConductorStep(dir, created.state, { execute: true }, async () => {
      throw new Error("runner must not execute after hard budget refusal");
    });
    assert.equal(conductor.accepted, false);
    assert.match(conductor.message, /Budget hard limit refused/);
    assert.equal((await loadState(dir)).stage, "paused");
    assert.ok((await readLogEvents(dir)).some((event) => event.eventType === "budget"));

    const validationState = stateAt("execution");
    validationState.tasks = [{ id: "T-VAL", status: "validating", title: "Validate", updatedAt: validationState.createdAt }];
    validationState.currentTaskId = "T-VAL";
    const limitedValidation = setBudgetLimits(validationState, { validationLoops: { hard: 1 } }, new Date("2026-01-01T00:00:00.000Z"));
    await saveState(dir, limitedValidation);
    const validation = await runValidationWithExecutionLock(dir, limitedValidation, "T-VAL");
    assert.equal(validation.accepted, false);
    assert.match(validation.message, /Validation refused by budget/);
    assert.equal((await loadState(dir)).stage, "paused");
  });
});

test("mock integration: context discovery feeds conductor prompt with local evidence and compression guidance", async () => {
  await withTempRepo(async (dir) => {
    await writeFile(join(dir, "src/app.js"), "export const value = 2;\n");
    await writeMemory(dir, { title: "Adapter memory", content: "Use the adapter evidence exactly.", taskId: "T-CONTEXT" });
    await upsertPrdRequirement(dir, { id: "REQ-CONTEXT", statement: "Context must include discovered evidence.", status: "pending" });
    const state = stateAt("execution");
    state.tasks = [{ id: "T-CONTEXT", status: "ready", title: "Use discovered context", allowedPathPrefixes: ["src/app.js"], prdRefs: ["REQ-CONTEXT"], updatedAt: state.createdAt }];
    await saveState(dir, state);
    await saveExecutionPlan(dir, {
      version: 1,
      planVersion: 1,
      status: "active",
      tasks: [{ id: "T-CONTEXT", title: "Use discovered context", prdRefs: ["REQ-CONTEXT"], allowedPathPrefixes: ["src/app.js"] }],
      createdAt: state.createdAt,
      updatedAt: state.createdAt,
    });

    const result = await runConductorStep(dir, state, { execute: false });
    assert.equal(result.accepted, true);
    assert.match(result.prompt ?? "", /Compression and Exact-Preservation Policy/);
    assert.match(result.prompt ?? "", /REQ-CONTEXT/);
    assert.match(result.prompt ?? "", /src\/app\.js/);
    const manifest = await loadTaskContextManifest(dir, "T-CONTEXT");
    assert.ok(manifest?.items.some((item) => item.source === "file" && item.path === "src/app.js"));
    assert.ok(manifest?.items.some((item) => item.source === "memory"));
  });
});

test("mock integration: non-debug child free-form output is rejected without mutating ledgers", async () => {
  await withTempRepo(async (dir) => {
    const state = stateAt("planning");
    await saveState(dir, state);
    const freeForm = async (request: TaskAgentRequest): Promise<TaskAgentRunResult> => ({
      taskId: request.taskId,
      exitCode: 0,
      stdoutEvents: [{ type: "unparsed", text: "looks good" }],
      stderr: "",
      timedOut: false,
      aborted: false,
    });

    const stage = await runStageAgentStep(dir, state, "planning", { execute: true }, freeForm);
    assert.equal(stage.ingestion?.ingested, false);
    assert.deepEqual(await loadStageArtifacts(dir), []);
    assert.equal((await loadStageAgentRunRecords(dir)).length, 1);

    await appendReplanRequest(dir, { id: "REPLAN-FREEFORM", trigger: "manual", reason: "Need plan." });
    const replan = await runReplanAgentStep(dir, { ...state, stage: "replanning" }, { execute: true }, freeForm);
    assert.equal(replan.ingestion?.ingested, false);
    assert.equal(await loadProposedExecutionPlan(dir), undefined);
    assert.equal((await loadReplanAgentRunRecords(dir))[0]?.ingestionStatus, "rejected");

    await upsertResearchRequest(dir, { id: "RESEARCH-FREEFORM", question: "Q?", reason: "Need answer.", scope: "local" });
    const research = await runResearchAgentStep(dir, state, { requestId: "RESEARCH-FREEFORM", execute: true }, freeForm);
    assert.equal(research.ingestion?.ingested, false);
    assert.deepEqual(await loadResearchReports(dir), []);
    assert.equal((await loadResearchAgentRunRecords(dir))[0]?.ingestionStatus, "rejected");
  });
});

test("mock integration: unsafe replan proposal is rejected without replacing current plan", async () => {
  await withTempRepo(async (dir) => {
    const state = stateAt("replanning");
    await setupRequirementAndPlan(dir, state);
    await appendReplanRequest(dir, { id: "REPLAN-UNSAFE", trigger: "coverage_gap", reason: "Need REQ-NEW.", requirementRefs: ["REQ-NEW"] });
    const unsafeRunner = async (request: TaskAgentRequest): Promise<TaskAgentRunResult> => ({
      taskId: request.taskId,
      exitCode: 0,
      stdoutEvents: [{
        type: "scaler_replan_proposal",
        plan: { version: 1, planVersion: 2, status: "draft", tasks: [{ id: "T-NEW", title: "Only new", prdRefs: ["REQ-NEW"] }], createdAt: state.createdAt, updatedAt: state.createdAt },
      }],
      stderr: "",
      timedOut: false,
      aborted: false,
    });
    const proposal = await runReplanAgentStep(dir, await loadState(dir), { execute: true }, unsafeRunner);
    assert.equal(proposal.ingestion?.ingested, true);
    assert.equal(proposal.ingestion?.preservation?.ok, false);

    const accepted = await acceptReplanProposal(dir, await loadState(dir), await loadPrdRequirements(dir));
    assert.equal(accepted.accepted, false);
    assert.equal((await loadExecutionPlan(dir)).planVersion, 1);
    assert.equal((await loadReplanDecisions(dir))[0]?.status, "rejected");
    assert.equal((await loadState(dir)).tasks.some((task) => task.id === "T-NEW"), false);
  });
});

test("mock integration: debug blocked report creates replan request and accepted plan clears retry gate", async () => {
  await withTempRepo(async (dir) => {
    const state = stateAt("debugging");
    await setupRequirementAndPlan(dir, state);
    state.tasks = [{ id: "T-KEEP", status: "debugging", title: "Debug keep", allowedPathPrefixes: ["src/app.js"], prdRefs: ["REQ-KEEP"], updatedAt: state.createdAt }];
    state.currentTaskId = "T-KEEP";
    await saveState(dir, state);
    await recordDebugAttempt(dir, state, { taskId: "T-KEEP", failureId: "F-1", hypothesis: "A", actionSummary: "A", result: "new_failure", failureFingerprint: "failure-a", resultingFailureFingerprint: "failure-b", evidence: ["e1"] });
    await recordDebugAttempt(dir, state, { taskId: "T-KEEP", failureId: "F-1", hypothesis: "B", actionSummary: "B", result: "new_failure", failureFingerprint: "failure-b", resultingFailureFingerprint: "failure-a", evidence: ["e2"] });
    assert.equal((await assessDebugRetryGate(dir, "T-KEEP")).allowed, false);
    const debugRunner = async (request: TaskAgentRequest): Promise<TaskAgentRunResult> => ({
      taskId: request.taskId,
      exitCode: 0,
      stdoutEvents: [{ type: "scaler_debug_report", taskId: "T-KEEP", status: "needs_replan", summary: "Local debug exhausted.", failureId: "F-1", failureFingerprint: "same", attemptedApproaches: ["A"], investigationSummary: "No safe local fix.", replanReason: "Need replacement plan.", evidenceRefs: ["e1"] }],
      stderr: "",
      timedOut: false,
      aborted: false,
    });
    const debug = await runDebugAgentStep(dir, await loadState(dir), { taskId: "T-KEEP", execute: true }, debugRunner);
    assert.equal(debug.ingestion?.ingested, true);
    assert.ok((await loadReplanRequests(dir)).some((request) => request.trigger === "debug_blocked"));

    const safeRunner = async (request: TaskAgentRequest): Promise<TaskAgentRunResult> => ({ taskId: request.taskId, exitCode: 0, stdoutEvents: [{ type: "scaler_replan_proposal", plan: { version: 1, planVersion: 2, status: "draft", tasks: [{ id: "T-KEEP", title: "Keep", prdRefs: ["REQ-KEEP"] }, { id: "T-NEW", title: "New", prdRefs: ["REQ-NEW"] }], createdAt: state.createdAt, updatedAt: state.createdAt } }], stderr: "", timedOut: false, aborted: false });
    await runReplanAgentStep(dir, await loadState(dir), { execute: true }, safeRunner);
    const accepted = await acceptReplanProposal(dir, await loadState(dir), await loadPrdRequirements(dir));
    assert.equal(accepted.accepted, true);
    assert.equal((await assessDebugRetryGate(dir, "T-KEEP")).allowed, true);
  });
});

test("mock integration: blocked validation requests replanning and acceptance resolves it", async () => {
  await withTempRepo(async (dir) => {
    const state = stateAt("execution");
    await setupRequirementAndPlan(dir, state);
    state.tasks.push({ id: "T-BLOCK", status: "validating", title: "Blocked", prdRefs: ["REQ-NEW"], updatedAt: state.createdAt });
    state.currentTaskId = "T-BLOCK";
    await saveState(dir, state);
    const blocked = await applyValidationReport(dir, state, { taskId: "T-BLOCK", status: "blocked", summary: "External dependency unavailable.", details: { evidenceRefs: ["validation-blocked"] } });
    assert.equal(blocked.accepted, true);
    assert.equal(blocked.state.stage, "replanning");
    assert.equal((await loadReplanRequests(dir))[0]?.trigger, "validation_blocked");

    const runner = async (request: TaskAgentRequest): Promise<TaskAgentRunResult> => ({ taskId: request.taskId, exitCode: 0, stdoutEvents: [{ type: "scaler_replan_proposal", plan: { version: 1, planVersion: 2, status: "draft", tasks: [{ id: "T-KEEP", title: "Keep", prdRefs: ["REQ-KEEP"] }, { id: "T-BLOCK", title: "Blocked", prdRefs: ["REQ-NEW"] }], createdAt: state.createdAt, updatedAt: state.createdAt } }], stderr: "", timedOut: false, aborted: false });
    await runReplanAgentStep(dir, blocked.state, { execute: true }, runner);
    const accepted = await acceptReplanProposal(dir, blocked.state, await loadPrdRequirements(dir));
    assert.equal(accepted.accepted, true);
    assert.equal((await loadReplanRequests(dir))[0]?.status, "resolved");
  });
});

test("mock integration: held execution lock blocks integrated executors", async () => {
  await withTempRepo(async (dir) => {
    const state = stateAt("execution");
    state.tasks = [{ id: "T-LOCK", status: "ready", title: "Locked", updatedAt: state.createdAt }];
    await saveState(dir, state);
    await appendReplanRequest(dir, { id: "REPLAN-LOCK", trigger: "manual", reason: "lock" });
    await upsertResearchRequest(dir, { id: "RESEARCH-LOCK", question: "Q?", reason: "lock", scope: "local" });
    const lock = await acquireExecutionLock(dir, { operation: "test", reason: "hold" });
    assert.equal(lock.acquired, true);
    try {
      assert.equal((await runConductorStep(dir, state, { execute: true }, () => passedRunner("T-LOCK"))).accepted, false);
      assert.equal((await runValidationWithExecutionLock(dir, { ...state, tasks: [{ ...state.tasks[0]!, status: "validating" }] }, "T-LOCK")).accepted, false);
      assert.equal((await runStageAgentStep(dir, { ...state, stage: "planning" }, "planning", { execute: true }, () => passedRunner("stage-planning"))).accepted, false);
      assert.equal((await runReplanAgentStep(dir, { ...state, stage: "replanning" }, { execute: true }, () => passedRunner("replan-agent"))).accepted, false);
      assert.equal((await runResearchAgentStep(dir, state, { requestId: "RESEARCH-LOCK", execute: true }, () => passedRunner("research-agent-RESEARCH-LOCK"))).accepted, false);
      assert.equal((await runDebugAgentStep(dir, { ...state, stage: "debugging", currentTaskId: "T-LOCK", tasks: [{ ...state.tasks[0]!, status: "debugging" }] }, { taskId: "T-LOCK", execute: true }, () => passedRunner("T-LOCK"))).accepted, false);
      assert.equal((await commitWithExecutionLock(dir, { ...state, tasks: [{ ...state.tasks[0]!, status: "validated" }] }, "T-LOCK", ["src/app.js"])).accepted, false);
    } finally {
      await releaseExecutionLock(dir, lock.lock.id);
    }
  });
});

test("mock integration: safety and git allowed-path checks reject unrelated work before allowed commit", async () => {
  await withTempRepo(async (dir) => {
    assert.equal(assessToolCallSafety({ toolName: "write", input: { path: ".env" } }, { allowedPathPrefixes: ["src"] }).allowed, false);
    assert.equal(assessToolCallSafety({ toolName: "write", input: { path: "README.md" } }, { allowedPathPrefixes: ["src"] }).allowed, false);
    const state = stateAt("execution");
    state.tasks = [{ id: "T-SAFE", status: "validated", title: "Safe commit", allowedPathPrefixes: ["src/app.js"], updatedAt: state.createdAt }];
    state.validatedTaskIds = ["T-SAFE"];
    await saveState(dir, state);
    await writeFile(join(dir, "src/app.js"), "export const value = 3;\n");
    await writeFile(join(dir, "README.md"), "unrelated\n");
    assert.equal((await assessGitStatusSafety(dir, ["src/app.js"])).status, "unrelated");
    assert.equal((await commitWithExecutionLock(dir, state, "T-SAFE", ["src/app.js"])).accepted, false);
    await unlink(join(dir, "README.md"));
    const commit = await commitWithExecutionLock(dir, state, "T-SAFE", ["src/app.js"]);
    assert.equal(commit.accepted, true, commit.message);
  });
});

test("mock integration: research raw evidence becomes memory and appears in later context", async () => {
  await withTempRepo(async (dir) => {
    const state = stateAt("execution");
    state.tasks = [{ id: "T-RESEARCH-MEM", status: "ready", title: "Use raw evidence memory", prdRefs: ["REQ-MEM"], updatedAt: state.createdAt }];
    await saveState(dir, state);
    await upsertResearchRequest(dir, { id: "RESEARCH-MEM", question: "What evidence?", reason: "Need raw evidence", scope: "local", taskId: "T-RESEARCH-MEM" });
    const runner = async (request: TaskAgentRequest): Promise<TaskAgentRunResult> => ({ taskId: request.taskId, exitCode: 0, stdoutEvents: [{ type: "scaler_research_report", id: "RPT-MEM", requestId: "RESEARCH-MEM", taskId: "T-RESEARCH-MEM", status: "complete", question: "What evidence?", sources: [{ id: "src", title: "Source", quality: "project", path: "src/app.js" }], conclusions: [{ summary: "Use raw evidence.", confidence: "high", sourceRefs: ["src"] }], contradictions: [], unresolvedUnknowns: [], recommendations: ["Use memory"], rawEvidence: [{ title: "Raw evidence", content: "Exact raw evidence body", sourceId: "src", summary: "raw" }] }], stderr: "", timedOut: false, aborted: false });
    const research = await runResearchAgentStep(dir, state, { requestId: "RESEARCH-MEM", execute: true }, runner);
    assert.equal(research.ingestion?.ingested, true);
    const memoryEntries = await loadMemoryIndex(dir);
    assert.equal(memoryEntries.entries.length, 1);
    const reports = await loadResearchReports(dir);
    const stateWithMemory = { ...state, memoryRefs: reports[0]?.memoryRefs ?? [] };
    await saveState(dir, stateWithMemory);
    const manifest = await ensureTaskContextManifest(dir, stateWithMemory, "T-RESEARCH-MEM");
    assert.ok(manifest.items.some((item) => item.source === "memory"));
  });
});

test("mock integration: stage consistency rejection prevents advancement", async () => {
  await withTempRepo(async (dir) => {
    const state = stateAt("planning");
    await upsertPrdRequirement(dir, { id: "REQ-KNOWN", statement: "Known requirement" });
    await saveExecutionPlan(dir, { version: 1, planVersion: 1, status: "active", tasks: [{ id: "T-KNOWN", title: "Known", prdRefs: ["REQ-KNOWN"] }], createdAt: state.createdAt, updatedAt: state.createdAt });
    await writeFile(join(dir, "plan.md"), "plan\n");
    await upsertStageArtifact(dir, { stage: "planning", status: "ready", title: "Bad plan", path: "plan.md", requirementRefs: ["REQ-KNOWN"], taskRefs: ["T-MISSING"] });
    await saveState(dir, state);
    const result = await runStageConductorStep(dir, state, { execute: true });
    assert.equal(result.accepted, false);
    assert.match(result.message, /inconsistent/);
    assert.equal((await loadState(dir)).stage, "planning");
  });
});

test("mock integration: dependency-blocked task waits until dependency validates", async () => {
  await withTempRepo(async (dir) => {
    const state = stateAt("execution");
    state.tasks = [
      { id: "T-DEP", status: "ready", title: "Dependency", updatedAt: state.createdAt },
      { id: "T-CHILD", status: "ready", title: "Child", dependsOn: ["T-DEP"], updatedAt: state.createdAt },
    ];
    await saveState(dir, state);
    const first = await runConductorStep(dir, state, { execute: true }, () => passedRunner("T-DEP"));
    assert.equal(first.task?.id, "T-DEP");
    const validation = await applyValidationReport(dir, await loadState(dir), { taskId: "T-DEP", status: "passed", summary: "Dependency passed" });
    const second = await runConductorStep(dir, validation.state, { execute: false });
    assert.equal(second.task?.id, "T-CHILD");
  });
});

test("mock integration: commit refusals precede allowed validated commit", async () => {
  await withTempRepo(async (dir) => {
    const state = stateAt("execution");
    state.tasks = [{ id: "T-COMMIT-CHAIN", status: "ready", title: "Commit chain", allowedPathPrefixes: ["src/app.js"], updatedAt: state.createdAt }];
    await saveState(dir, state);
    await writeFile(join(dir, "src/app.js"), "export const value = 4;\n");
    assert.equal((await commitWithExecutionLock(dir, state, "T-COMMIT-CHAIN", ["src/app.js"])).accepted, false);
    const validated = { ...state, tasks: [{ ...state.tasks[0]!, status: "validated" as const }], validatedTaskIds: ["T-COMMIT-CHAIN"], completedTaskIds: ["T-COMMIT-CHAIN"] };
    await saveState(dir, validated);
    await writeFile(join(dir, "other.txt"), "unrelated\n");
    assert.equal((await commitWithExecutionLock(dir, validated, "T-COMMIT-CHAIN", ["src/app.js"])).accepted, false);
    await unlink(join(dir, "other.txt"));
    const commit = await commitWithExecutionLock(dir, validated, "T-COMMIT-CHAIN", ["src/app.js"]);
    assert.equal(commit.accepted, true, commit.message);
    const shown = await execFileAsync("git", ["show", "HEAD:src/app.js"], { cwd: dir });
    assert.equal(shown.stdout, "export const value = 4;\n");
  });
});

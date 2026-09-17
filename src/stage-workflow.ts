/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { normalizeOutputPaths } from "./output-artifacts.js";
import { appendLogEvent, createLogEvent, logStructuredReportAudit } from "./logging.js";
import {
  acceptReplanProposal,
  applyExecutionPlanTasks,
  applyPlanningReport,
  loadExecutionPlan,
  loadProposedExecutionPlan,
  loadReplanRequests,
  type ExecutionPlanArtifact,
  type ExecutionPlanStatus,
  type PlanningReportInput,
  type PlanningReportResult,
  type ReplanProposalAcceptanceResult,
} from "./plans.js";
import { getKnowledgeReportPath, getStageWorkflowRunsPath } from "./paths.js";
import {
  createPrdVersionSnapshot,
  isRuntimePrdRequirementStatus,
  loadPrdCoverage,
  loadPrdRequirements,
  applyPrdRequirementUpserts,
  saveCurrentPrd,
  computePrdCoverageSummary,
  normalizePrdAcceptanceCriteria,
  type RuntimePrdAcceptanceCriterion,
  type RuntimePrdRequirement,
} from "./prd.js";
import { requestReplan, type RequestReplanResult } from "./replanning.js";
import { runReplanAgentStep, type ReplanAgentRunner, type ReplanAgentStepResult } from "./replan-agent.js";
import {
  loadResearchReports,
  loadResearchRequests,
  saveResearchRequests,
  upsertResearchRequest,
  type ResearchReport,
  type ResearchRequest,
} from "./research.js";
import { runResearchAgentStep, type ResearchAgentRunner, type ResearchAgentStepResult } from "./research-agent.js";
import { saveState } from "./state.js";
import { advanceStageAfterReadyArtifact, type StageAdvancementResult } from "./stage-advancement.js";
import { defaultStageAgentTools, runStageAgentStep, type StageAgentRunner, type StageAgentStepResult } from "./stage-agents.js";
import {
  loadStageArtifacts,
  upsertStageArtifact,
  validateStageArtifactReadiness,
  type StageArtifact,
  type StageArtifactStage,
} from "./stages.js";
import { extractStructuredReportPayloads, type TaskAgentRunResult } from "./subagents.js";
import { transitionStage } from "./supervisor.js";
import type { ScalerState } from "./types.js";
import { completeRunWithEvidence } from "./run-completion.js";

export type StageWorkflowAction =
  | "advance_ready_stage"
  | "stage_agent"
  | "research_requests"
  | "research_agents"
  | "knowledge_merge"
  | "plan_apply"
  | "execution_replan_request"
  | "replan_agent"
  | "replan_accept"
  | "execution_ready"
  | "unsupported_stage";

export type StageWorkflowStopReason =
  | "completed"
  | "max_steps"
  | "prepared_agent"
  | "waiting_for_research"
  | "waiting_for_replan_acceptance"
  | "execution_ready"
  | "unsupported_stage"
  | "step_rejected";

export interface StageWorkflowOptions {
  execute?: boolean;
  maxSteps?: number;
  maxResearchRequests?: number;
  maxResearchAgents?: number;
  allowInternet?: boolean;
  tools?: string[];
  stageTools?: string[];
  researchTools?: string[];
  replanTools?: string[];
  autoAcceptReplan?: boolean;
  timeoutMs?: number;
}

export interface StageWorkflowRunners {
  stage?: StageAgentRunner;
  research?: ResearchAgentRunner;
  replan?: ReplanAgentRunner;
}

export interface StageWorkflowSupplementalIngestion {
  prd?: PrdWriteIngestionResult;
  planning?: PlanningReportIngestionResult;
}

export interface StageWorkflowStepResult {
  accepted: boolean;
  action: StageWorkflowAction;
  message: string;
  state: ScalerState;
  continueWorkflow: boolean;
  stopReason?: StageWorkflowStopReason;
  stage?: StageArtifactStage;
  artifact?: StageArtifact;
  stageAgent?: StageAgentStepResult;
  researchRequests?: ResearchRequest[];
  researchAgents?: ResearchAgentStepResult[];
  knowledgeMerge?: KnowledgeMergeResult;
  advancement?: StageAdvancementResult;
  supplemental?: StageWorkflowSupplementalIngestion;
  replanAgent?: ReplanAgentStepResult;
  replanAcceptance?: ReplanProposalAcceptanceResult;
  replanRequest?: RequestReplanResult;
  planApply?: { createdTaskIds: string[]; existingTaskIds: string[]; updatedTaskIds: string[]; rejectedTaskIds: string[] };
}

export interface StageWorkflowResult {
  accepted: boolean;
  completed: boolean;
  stopReason: StageWorkflowStopReason;
  steps: StageWorkflowStepResult[];
  finalState: ScalerState;
  message: string;
  runRecord: StageWorkflowRunRecord;
}

export interface StageWorkflowRunRecord {
  id: string;
  status: "passed" | "failed";
  stopReason: StageWorkflowStopReason;
  finalStage: ScalerState["stage"];
  executed: boolean;
  stepCount: number;
  actions: StageWorkflowAction[];
  createdAt: string;
}

export interface StageWorkflowRunIndex {
  version: 1;
  runs: StageWorkflowRunRecord[];
}

export interface PrdWriteIngestionResult {
  attempted: boolean;
  ingested: boolean;
  path?: string;
  requirementIds?: string[];
  snapshotPath?: string;
  artifact?: StageArtifact;
  reason?: string;
}

export interface PlanningReportIngestionResult {
  attempted: boolean;
  ingested: boolean;
  result?: PlanningReportResult;
  artifact?: StageArtifact;
  reason?: string;
}

export interface KnowledgeMergeResult {
  accepted: boolean;
  artifact?: StageArtifact;
  path?: string;
  reportIds: string[];
  sourceCount: number;
  conclusionCount: number;
  unresolvedUnknowns: string[];
  openRequestIds: string[];
  message: string;
}

interface SupplementalIngestionInput {
  stage: StageArtifactStage;
  state: ScalerState;
  runResult?: TaskAgentRunResult;
}

const executionPlanStatuses = new Set<ExecutionPlanStatus>(["draft", "active", "superseded", "completed"]);
const localProjectInspectionTools = ["read", "bash"];

export async function runAutonomousStageWorkflow(
  cwd: string,
  state: ScalerState,
  options: StageWorkflowOptions = {},
  runners: StageWorkflowRunners = {},
): Promise<StageWorkflowResult> {
  const steps: StageWorkflowStepResult[] = [];
  let currentState = state;
  let stopReason: StageWorkflowStopReason = "max_steps";
  const maxSteps = normalizeMax(options.maxSteps, 20, 1, 50);

  for (let index = 0; index < maxSteps; index += 1) {
    if (currentState.stage === "completed") {
      stopReason = "completed";
      break;
    }

    const step = await runAutonomousStageWorkflowStep(cwd, currentState, options, runners);
    steps.push(step);
    currentState = step.state;

    if (currentState.stage === "completed") {
      stopReason = "completed";
      break;
    }
    if (!step.accepted) {
      stopReason = step.stopReason ?? "step_rejected";
      break;
    }
    if (!step.continueWorkflow) {
      stopReason = step.stopReason ?? "max_steps";
      break;
    }
  }

  let completionMessage = "";
  if (currentState.stage === "completed") {
    const completion = await completeRunWithEvidence(cwd, currentState);
    stopReason = completion.accepted ? "completed" : "step_rejected";
    completionMessage = `\n${completion.message}`;
  }
  const accepted = stopReason !== "step_rejected" && steps.length > 0 && steps.every((step) => step.accepted);
  const message = formatStageWorkflowMessage(steps, currentState, stopReason) + completionMessage;
  const runRecord = await recordStageWorkflowRun(cwd, {
    id: `stage-workflow-${Date.now()}`,
    status: accepted ? "passed" : "failed",
    stopReason,
    finalStage: currentState.stage,
    executed: Boolean(options.execute),
    stepCount: steps.length,
    actions: steps.map((step) => step.action),
    createdAt: new Date().toISOString(),
  });
  await appendLogEvent(cwd, createLogEvent(currentState, {
    eventType: "system",
    summary: `Stage workflow ${runRecord.status}: stop=${stopReason} steps=${steps.length}`,
    details: { runRecord, steps: steps.map(summarizeStepForAudit) },
  }));

  return {
    accepted,
    completed: currentState.stage === "completed" && stopReason === "completed",
    stopReason,
    steps,
    finalState: currentState,
    message,
    runRecord,
  };
}

export async function runAutonomousStageWorkflowStep(
  cwd: string,
  state: ScalerState,
  options: StageWorkflowOptions = {},
  runners: StageWorkflowRunners = {},
): Promise<StageWorkflowStepResult> {
  switch (state.stage) {
    case "prd":
      return await runArtifactStageWorkflowStep(cwd, state, "prd", options, runners.stage);
    case "knowledge":
      return await runKnowledgeWorkflowStep(cwd, state, options, runners.research, runners.stage);
    case "planning":
      return await runArtifactStageWorkflowStep(cwd, state, "planning", options, runners.stage);
    case "replanning":
      return await runReplanningWorkflowStep(cwd, state, options, runners.replan, runners.stage);
    case "execution":
      return await runExecutionRefreshWorkflowStep(cwd, state, options);
    default:
      return {
        accepted: false,
        action: "unsupported_stage",
        message: `Autonomous stage workflow cannot run for supervisor stage ${state.stage}.`,
        state,
        continueWorkflow: false,
        stopReason: "unsupported_stage",
      };
  }
}

export async function loadStageWorkflowRunRecords(cwd: string): Promise<StageWorkflowRunRecord[]> {
  try {
    const raw = await readFile(getStageWorkflowRunsPath(cwd), "utf8");
    const index = JSON.parse(raw) as StageWorkflowRunIndex;
    if (index.version !== 1) throw new Error(`Unsupported stage workflow run index version: ${String(index.version)}`);
    return index.runs;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export function formatStageWorkflowRunRecords(records: StageWorkflowRunRecord[], limit = 20): string {
  if (records.length === 0) return "No stage workflow runs.";
  const lines = ["Stage workflow runs:"];
  for (const record of records.slice(0, limit)) {
    lines.push(`- ${record.id}: ${record.status} stop=${record.stopReason} final=${record.finalStage} steps=${record.stepCount} executed=${record.executed} actions=${record.actions.join(",")}`);
  }
  return lines.join("\n");
}

export async function ingestSupplementalStageReports(
  cwd: string,
  input: SupplementalIngestionInput,
): Promise<StageWorkflowSupplementalIngestion> {
  if (!input.runResult || input.runResult.exitCode !== 0) return {};
  const result: StageWorkflowSupplementalIngestion = {};
  if (input.stage === "prd") {
    result.prd = await ingestPrdWriteReport(cwd, input.state, input.runResult.stdoutEvents);
  }
  if (input.stage === "planning") {
    result.planning = await ingestPlanningReport(cwd, input.state, input.runResult.stdoutEvents);
  }
  return result;
}

export async function ingestPrdWriteReport(cwd: string, state: ScalerState, stdoutEvents: unknown[]): Promise<PrdWriteIngestionResult> {
  const reports = extractStructuredReportPayloads(stdoutEvents, "scaler_prd_write");
  if (reports.length === 0) return { attempted: false, ingested: false };
  const report = reports[reports.length - 1];
  const content = stringField(report, "content");
  const requirementInputs = arrayField(report, "requirements");
  if (!content && requirementInputs.length === 0) {
    return { attempted: true, ingested: false, reason: "scaler_prd_write report needs content or requirements." };
  }

  const existingRequirements = await loadPrdRequirements(cwd);
  const requirements = parsePrdRequirements(requirementInputs, new Date().toISOString(), existingRequirements.requirements);
  if (requirementInputs.length > 0 && !requirements) {
    return { attempted: true, ingested: false, reason: "Invalid scaler_prd_write requirements or acceptance criteria." };
  }
  const proposedRequirements = requirements?.map((requirement) => ({
    id: requirement.id,
    statement: requirement.statement,
    title: requirement.title,
    source: requirement.source,
    acceptanceCriteria: requirement.acceptanceCriteria,
  })) ?? [];
  try {
    await applyPrdRequirementUpserts(cwd, proposedRequirements);
  } catch (error) {
    return { attempted: true, ingested: false, reason: error instanceof Error ? error.message : String(error) };
  }
  const snapshotPath = booleanField(report, "snapshotCurrent")
    ? await createPrdVersionSnapshot(cwd, { reason: stringField(report, "snapshotReason") ?? "PRD replaced by stage workflow" })
    : undefined;
  if (content) await saveCurrentPrd(cwd, content);
  const requirementIds = proposedRequirements.map((requirement) => requirement.id);
  const artifact = await upsertStageArtifact(cwd, {
    stage: "prd",
    status: "ready",
    title: "Runtime PRD",
    path: ".scaler/prd/current.md",
    summary: `Runtime PRD ingested${requirementIds.length > 0 ? ` with ${requirementIds.length} requirements` : ""}.`,
    evidenceRefs: snapshotPath ? [snapshotPath] : undefined,
    requirementRefs: requirementIds,
  });
  await logStructuredReportAudit(cwd, state, {
    reportType: "scaler_prd_write",
    summary: `Runtime PRD ingested by stage workflow: requirements=${requirementIds.length}`,
    report: { ...report, content: content ? `[${content.length} chars]` : undefined },
    accepted: true,
    outputRefs: [artifact.id, ".scaler/prd/current.md"],
  });
  return { attempted: true, ingested: true, path: ".scaler/prd/current.md", requirementIds, snapshotPath, artifact };
}

export async function ingestPlanningReport(cwd: string, state: ScalerState, stdoutEvents: unknown[]): Promise<PlanningReportIngestionResult> {
  const reports = extractStructuredReportPayloads(stdoutEvents, "scaler_planning_report");
  if (reports.length === 0) return { attempted: false, ingested: false };
  const report = reports[reports.length - 1];
  const input = parsePlanningReportInput(report);
  if (!input) return { attempted: true, ingested: false, reason: "Invalid scaler_planning_report payload." };

  const result = await applyPlanningReport(cwd, state, input);
  const taskRefs = result.plan.tasks.map((task) => task.id);
  const requirementRefs = Array.from(new Set(result.plan.tasks.flatMap((task) => task.prdRefs ?? []))).sort((a, b) => a.localeCompare(b));
  const artifact = await upsertStageArtifact(cwd, {
    stage: "planning",
    status: result.accepted ? "ready" : "blocked",
    title: result.plan.title ?? "Execution plan",
    path: ".scaler/plans/current-plan.json",
    summary: result.message,
    evidenceRefs: [result.report.id],
    requirementRefs,
    taskRefs,
  });
  await logStructuredReportAudit(cwd, state, {
    reportType: "scaler_planning_report",
    summary: result.message,
    report: { report: result.report, planVersion: result.plan.planVersion },
    accepted: result.accepted,
    outputRefs: [artifact.id, ".scaler/plans/current-plan.json"],
  });
  return { attempted: true, ingested: result.accepted, result, artifact, reason: result.accepted ? undefined : result.message };
}

export function deriveKnowledgeResearchRequests(
  requirements: RuntimePrdRequirement[],
  requests: ResearchRequest[],
  reports: ResearchReport[],
  maxRequests: number,
): Array<{ id: string; question: string; reason: string; requirementRefs: string[]; scope: "local" }> {
  const derived: Array<{ id: string; question: string; reason: string; requirementRefs: string[]; scope: "local" }> = [];
  for (const requirement of requirements) {
    if (hasUsefulResearchReport(requirement.id, reports)) continue;
    if (requests.some((request) => isStageKnowledgeRequest(request) && request.requirementRefs?.includes(requirement.id) && request.status !== "superseded")) continue;
    derived.push({
      id: `RESEARCH-${safeId(requirement.id)}`,
      question: `What project-local knowledge, constraints, risks, and evidence are needed to implement ${requirement.id}: ${requirement.statement}`,
      reason: `Stage II knowledge collection for runtime requirement ${requirement.id}.`,
      requirementRefs: [requirement.id],
      scope: "local",
    });
    if (derived.length >= maxRequests) break;
  }
  return derived;
}

export async function mergeResearchReportsToKnowledgeArtifact(cwd: string, state: ScalerState): Promise<KnowledgeMergeResult> {
  const requirements = await loadPrdRequirements(cwd);
  const requests = await loadResearchRequests(cwd);
  const reports = await loadResearchReports(cwd);
  const stageRequests = requests.filter(isStageKnowledgeRequest);
  const openRequestIds = stageRequests.filter((request) => request.status === "open" || request.status === "in_progress").map((request) => request.id);
  const usableReports = reports.filter((report) => report.status === "complete" || report.status === "partial");

  if (openRequestIds.length > 0) {
    return {
      accepted: false,
      reportIds: usableReports.map((report) => report.id),
      sourceCount: 0,
      conclusionCount: 0,
      unresolvedUnknowns: [],
      openRequestIds,
      message: `Knowledge merge waiting for open research requests: ${openRequestIds.join(", ")}`,
    };
  }

  const merged = buildMergedKnowledgeMarkdown(requirements.requirements, usableReports);
  await mkdir(dirname(getKnowledgeReportPath(cwd)), { recursive: true });
  await writeFile(getKnowledgeReportPath(cwd), merged.markdown, "utf8");
  const artifact = await upsertStageArtifact(cwd, {
    stage: "knowledge",
    status: "ready",
    title: "Stage II knowledge report",
    path: ".scaler/knowledge/knowledge-report.md",
    summary: `Merged ${usableReports.length} research reports into ${merged.conclusions.length} unique conclusions.`,
    evidenceRefs: Array.from(new Set([...usableReports.map((report) => report.id), ...usableReports.flatMap((report) => report.memoryRefs ?? [])])),
    requirementRefs: merged.requirementRefs,
  });
  await logStructuredReportAudit(cwd, state, {
    reportType: "scaler_knowledge_merge",
    summary: `Knowledge report merged: reports=${usableReports.length} conclusions=${merged.conclusions.length}`,
    report: { reportIds: usableReports.map((report) => report.id), path: ".scaler/knowledge/knowledge-report.md" },
    accepted: true,
    outputRefs: [artifact.id, ".scaler/knowledge/knowledge-report.md"],
  });
  return {
    accepted: true,
    artifact,
    path: ".scaler/knowledge/knowledge-report.md",
    reportIds: usableReports.map((report) => report.id),
    sourceCount: merged.sources.length,
    conclusionCount: merged.conclusions.length,
    unresolvedUnknowns: merged.unresolvedUnknowns,
    openRequestIds: [],
    message: `Knowledge report ready: reports=${usableReports.length} conclusions=${merged.conclusions.length} sources=${merged.sources.length}`,
  };
}

async function runArtifactStageWorkflowStep(
  cwd: string,
  state: ScalerState,
  stage: "prd" | "planning",
  options: StageWorkflowOptions,
  runner?: StageAgentRunner,
): Promise<StageWorkflowStepResult> {
  const advancement = await advanceIfReady(cwd, state, stage);
  if (advancement) {
    return {
      accepted: advancement.accepted,
      action: "advance_ready_stage",
      message: advancement.message,
      state: advancement.state,
      continueWorkflow: advancement.advanced,
      stopReason: advancement.advanced ? undefined : "step_rejected",
      stage,
      advancement,
    };
  }

  const stageAgent = await runStageAgentStep(cwd, state, stage, {
    execute: options.execute,
    tools: resolveStageTools(stage, options),
    timeoutMs: options.timeoutMs,
  }, runner);
  const supplemental = await ingestSupplementalStageReports(cwd, { stage, state, runResult: stageAgent.runResult });
  const stateForAdvance = supplemental.planning?.result?.state ?? state;
  const postAdvance = options.execute ? await advanceIfReady(cwd, stateForAdvance, stage) : undefined;
  const accepted = stageAgent.accepted && (!options.execute || Boolean(postAdvance?.accepted));
  return {
    accepted,
    action: "stage_agent",
    message: formatStageAgentWorkflowMessage(stage, stageAgent, supplemental, postAdvance),
    state: postAdvance?.state ?? stateForAdvance,
    continueWorkflow: Boolean(postAdvance?.advanced),
    stopReason: options.execute ? (postAdvance?.advanced ? undefined : "step_rejected") : "prepared_agent",
    stage,
    stageAgent,
    supplemental,
    advancement: postAdvance,
  };
}

async function runKnowledgeWorkflowStep(
  cwd: string,
  state: ScalerState,
  options: StageWorkflowOptions,
  researchRunner?: ResearchAgentRunner,
  stageRunner?: StageAgentRunner,
): Promise<StageWorkflowStepResult> {
  const advancement = await advanceIfReady(cwd, state, "knowledge");
  if (advancement) {
    return {
      accepted: advancement.accepted,
      action: "advance_ready_stage",
      message: advancement.message,
      state: advancement.state,
      continueWorkflow: advancement.advanced,
      stopReason: advancement.advanced ? undefined : "step_rejected",
      stage: "knowledge",
      advancement,
    };
  }

  const requirements = await loadPrdRequirements(cwd);
  const requests = await loadResearchRequests(cwd);
  const reports = await loadResearchReports(cwd);
  const maxRequests = normalizeMax(options.maxResearchRequests, 5, 0, 50);
  const derived = deriveKnowledgeResearchRequests(requirements.requirements, requests, reports, maxRequests);
  if (derived.length > 0) {
    const created: ResearchRequest[] = [];
    for (const request of derived) created.push(await upsertResearchRequest(cwd, request));
    return {
      accepted: true,
      action: "research_requests",
      message: `Created Stage II research requests: ${created.map((request) => request.id).join(", ")}`,
      state,
      continueWorkflow: Boolean(options.execute),
      stopReason: options.execute ? undefined : "waiting_for_research",
      stage: "knowledge",
      researchRequests: created,
    };
  }

  const openRequests = (await loadResearchRequests(cwd)).filter((request) => isStageKnowledgeRequest(request) && (request.status === "open" || request.status === "in_progress"));
  if (openRequests.length > 0) {
    const maxAgents = normalizeMax(options.maxResearchAgents, 2, 1, 20);
    const selected = openRequests.slice(0, options.execute ? maxAgents : 1);
    const runs: ResearchAgentStepResult[] = [];
    for (const request of selected) {
      runs.push(await runResearchAgentStep(cwd, state, {
        requestId: request.id,
        execute: options.execute,
        allowInternet: options.allowInternet,
        tools: resolveResearchTools(options),
        timeoutMs: options.timeoutMs,
      }, researchRunner));
      if (!options.execute) break;
    }
    const accepted = runs.every((run) => run.accepted && (!options.execute || run.ingestion?.ingested !== false));
    return {
      accepted,
      action: "research_agents",
      message: `Stage II research agents ${options.execute ? "executed" : "prepared"}: ${selected.map((request) => request.id).join(", ")}`,
      state,
      continueWorkflow: Boolean(options.execute && accepted),
      stopReason: options.execute && accepted ? undefined : (options.execute ? "step_rejected" : "prepared_agent"),
      stage: "knowledge",
      researchAgents: runs,
    };
  }

  const merge = await mergeResearchReportsToKnowledgeArtifact(cwd, state);
  if (merge.accepted) {
    const postAdvance = await advanceIfReady(cwd, state, "knowledge");
    return {
      accepted: Boolean(postAdvance?.accepted),
      action: "knowledge_merge",
      message: `${merge.message}${postAdvance ? `\n${postAdvance.message}` : ""}`,
      state: postAdvance?.state ?? state,
      continueWorkflow: Boolean(postAdvance?.advanced),
      stopReason: postAdvance?.advanced ? undefined : "step_rejected",
      stage: "knowledge",
      artifact: merge.artifact,
      knowledgeMerge: merge,
      advancement: postAdvance,
    };
  }

  if (!options.execute) {
    const stageAgent = await runStageAgentStep(cwd, state, "knowledge", { execute: false, tools: resolveStageTools("knowledge", options) }, stageRunner);
    return {
      accepted: stageAgent.accepted,
      action: "stage_agent",
      message: stageAgent.message,
      state,
      continueWorkflow: false,
      stopReason: "prepared_agent",
      stage: "knowledge",
      stageAgent,
    };
  }

  return {
    accepted: false,
    action: "knowledge_merge",
    message: merge.message,
    state,
    continueWorkflow: false,
    stopReason: "waiting_for_research",
    stage: "knowledge",
    knowledgeMerge: merge,
  };
}

async function runExecutionRefreshWorkflowStep(
  cwd: string,
  state: ScalerState,
  options: StageWorkflowOptions,
): Promise<StageWorkflowStepResult> {
  const requirements = await loadPrdRequirements(cwd);
  const coverage = await loadPrdCoverage(cwd);
  const coverageSummary = computePrdCoverageSummary(requirements, coverage, state);
  const currentPlan = await loadExecutionPlan(cwd);
  const planApply = await applyExecutionPlanTasks(cwd, state, currentPlan);
  let workingState = planApply.state;
  if (planApply.createdTaskIds.length > 0 || planApply.updatedTaskIds.length > 0 || planApply.rejectedTaskIds.length > 0) {
    return {
      accepted: planApply.rejectedTaskIds.length === 0,
      action: "plan_apply",
      message: `Execution plan synchronized before Stage IV: ${planApply.message}`,
      state: workingState,
      continueWorkflow: planApply.rejectedTaskIds.length === 0,
      stopReason: planApply.rejectedTaskIds.length === 0 ? undefined : "step_rejected",
      planApply: {
        createdTaskIds: planApply.createdTaskIds,
        existingTaskIds: planApply.existingTaskIds,
        updatedTaskIds: planApply.updatedTaskIds,
        rejectedTaskIds: planApply.rejectedTaskIds,
      },
    };
  }

  const openRequests = (await loadReplanRequests(cwd)).filter((request) => request.status === "open");
  if (openRequests.length > 0) {
    const nextState = transitionStage(workingState, "replanning", { reason: `Open replan requests require Stage III refresh: ${openRequests.map((request) => request.id).join(",")}` });
    await saveState(cwd, nextState);
    return {
      accepted: nextState.stage === "replanning",
      action: "execution_replan_request",
      message: `Moved execution to replanning for open requests: ${openRequests.map((request) => request.id).join(", ")}`,
      state: nextState,
      continueWorkflow: nextState.stage === "replanning",
      stopReason: nextState.stage === "replanning" ? undefined : "step_rejected",
    };
  }

  if (coverageSummary.unlinkedRequirementIds.length > 0) {
    const request = await requestReplan(cwd, workingState, {
      trigger: "coverage_gap",
      reason: `Runtime PRD requirements are not linked by the execution plan: ${coverageSummary.unlinkedRequirementIds.join(", ")}`,
      requirementRefs: coverageSummary.unlinkedRequirementIds,
      evidenceRefs: ["runtime-prd-coverage"],
      planVersion: currentPlan.planVersion,
    });
    return {
      accepted: request.transitioned,
      action: "execution_replan_request",
      message: request.message,
      state: request.state,
      continueWorkflow: request.transitioned && Boolean(options.execute),
      stopReason: request.transitioned && options.execute ? undefined : "step_rejected",
      replanRequest: request,
    };
  }

  return {
    accepted: true,
    action: "execution_ready",
    message: "Execution stage has no Stage II/III refresh gaps; use /scaler-step and validation for task execution.",
    state: workingState,
    continueWorkflow: false,
    stopReason: "execution_ready",
  };
}

async function runReplanningWorkflowStep(
  cwd: string,
  state: ScalerState,
  options: StageWorkflowOptions,
  replanRunner?: ReplanAgentRunner,
  stageRunner?: StageAgentRunner,
): Promise<StageWorkflowStepResult> {
  const advancement = await advanceIfReady(cwd, state, "replanning");
  if (advancement) {
    return {
      accepted: advancement.accepted,
      action: "advance_ready_stage",
      message: advancement.message,
      state: advancement.state,
      continueWorkflow: advancement.advanced,
      stopReason: advancement.advanced ? undefined : "step_rejected",
      stage: "replanning",
      advancement,
    };
  }

  const proposed = await loadProposedExecutionPlan(cwd);
  if (proposed && options.autoAcceptReplan !== false && options.execute) {
    return await acceptCurrentReplanProposalWorkflowStep(cwd, state);
  }

  const openRequests = (await loadReplanRequests(cwd)).filter((request) => request.status === "open");
  if (openRequests.length > 0) {
    const run = await runReplanAgentStep(cwd, state, {
      execute: options.execute,
      tools: resolveReplanTools(options),
      timeoutMs: options.timeoutMs,
    }, replanRunner);
    if (!options.execute) {
      return {
        accepted: run.accepted,
        action: "replan_agent",
        message: run.message,
        state,
        continueWorkflow: false,
        stopReason: "prepared_agent",
        stage: "replanning",
        replanAgent: run,
      };
    }
    if (!run.accepted || run.ingestion?.ingested === false || run.ingestion?.preservation?.ok === false) {
      return {
        accepted: false,
        action: "replan_agent",
        message: run.ingestion?.reason ?? run.message,
        state,
        continueWorkflow: false,
        stopReason: "step_rejected",
        stage: "replanning",
        replanAgent: run,
      };
    }
    if (options.autoAcceptReplan === false) {
      return {
        accepted: true,
        action: "replan_agent",
        message: `${run.message}; proposed plan awaiting explicit acceptance.`,
        state,
        continueWorkflow: false,
        stopReason: "waiting_for_replan_acceptance",
        stage: "replanning",
        replanAgent: run,
      };
    }
    const accepted = await acceptCurrentReplanProposalWorkflowStep(cwd, state);
    return { ...accepted, replanAgent: run };
  }

  const stageAgent = await runStageAgentStep(cwd, state, "replanning", {
    execute: options.execute,
    tools: resolveStageTools("replanning", options),
    timeoutMs: options.timeoutMs,
  }, stageRunner);
  const postAdvance = options.execute ? await advanceIfReady(cwd, state, "replanning") : undefined;
  return {
    accepted: stageAgent.accepted && (!options.execute || Boolean(postAdvance?.accepted)),
    action: "stage_agent",
    message: `${stageAgent.message}${postAdvance ? `\n${postAdvance.message}` : ""}`,
    state: postAdvance?.state ?? state,
    continueWorkflow: Boolean(postAdvance?.advanced),
    stopReason: options.execute ? (postAdvance?.advanced ? undefined : "step_rejected") : "prepared_agent",
    stage: "replanning",
    stageAgent,
    advancement: postAdvance,
  };
}

async function acceptCurrentReplanProposalWorkflowStep(cwd: string, state: ScalerState): Promise<StageWorkflowStepResult> {
  const requirements = await loadPrdRequirements(cwd);
  const accepted = await acceptReplanProposal(cwd, state, requirements);
  if (!accepted.accepted) {
    return {
      accepted: false,
      action: "replan_accept",
      message: accepted.message,
      state,
      continueWorkflow: false,
      stopReason: "step_rejected",
      stage: "replanning",
      replanAcceptance: accepted,
    };
  }
  const taskRefs = [
    ...(accepted.applyResult?.createdTaskIds ?? []),
    ...(accepted.applyResult?.existingTaskIds ?? []),
    ...(accepted.applyResult?.updatedTaskIds ?? []),
  ];
  const requestIds = accepted.decision.requestIds;
  await upsertStageArtifact(cwd, {
    stage: "replanning",
    status: "ready",
    title: `Accepted execution plan ${accepted.savedPlan?.planVersion ?? accepted.decision.proposedPlanVersion}`,
    path: ".scaler/plans/current-plan.json",
    summary: accepted.message,
    evidenceRefs: requestIds.length > 0 ? requestIds : [accepted.decision.id],
    requirementRefs: Array.from(new Set(accepted.savedPlan?.tasks.flatMap((task) => task.prdRefs ?? []) ?? [])).sort((a, b) => a.localeCompare(b)),
    taskRefs,
  });
  const advancement = await advanceIfReady(cwd, accepted.state, "replanning");
  return {
    accepted: Boolean(advancement?.accepted),
    action: "replan_accept",
    message: `${accepted.message}${advancement ? `\n${advancement.message}` : ""}`,
    state: advancement?.state ?? accepted.state,
    continueWorkflow: Boolean(advancement?.advanced),
    stopReason: advancement?.advanced ? undefined : "step_rejected",
    stage: "replanning",
    replanAcceptance: accepted,
    advancement,
  };
}

async function advanceIfReady(cwd: string, state: ScalerState, stage: StageArtifactStage): Promise<StageAdvancementResult | undefined> {
  const readiness = await validateStageArtifactReadiness(cwd, await loadStageArtifacts(cwd), stage);
  if (!readiness.ok) return undefined;
  return await advanceStageAfterReadyArtifact(cwd, state, stage);
}

async function recordStageWorkflowRun(cwd: string, record: StageWorkflowRunRecord): Promise<StageWorkflowRunRecord> {
  const records = [record, ...(await loadStageWorkflowRunRecords(cwd))];
  const path = getStageWorkflowRunsPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ version: 1, runs: records } satisfies StageWorkflowRunIndex, null, 2)}\n`, "utf8");
  return record;
}

function formatStageWorkflowMessage(steps: StageWorkflowStepResult[], finalState: ScalerState, stopReason: StageWorkflowStopReason): string {
  const lines = [`Stage workflow: steps=${steps.length} stop=${stopReason} final_stage=${finalState.stage}`];
  for (const [index, step] of steps.entries()) {
    lines.push(`- ${index + 1}. ${step.action}${step.stage ? `/${step.stage}` : ""}: ${firstLine(step.message)}`);
  }
  return lines.join("\n");
}

function formatStageAgentWorkflowMessage(
  stage: StageArtifactStage,
  stageAgent: StageAgentStepResult,
  supplemental: StageWorkflowSupplementalIngestion,
  advancement?: StageAdvancementResult,
): string {
  const lines = [stageAgent.message];
  if (supplemental.prd?.attempted) lines.push(supplemental.prd.ingested ? `Ingested runtime PRD ${supplemental.prd.path}.` : `Runtime PRD report rejected: ${supplemental.prd.reason ?? "unknown"}`);
  if (supplemental.planning?.attempted) lines.push(supplemental.planning.ingested ? `Ingested planning report ${supplemental.planning.result?.report.id}.` : `Planning report rejected: ${supplemental.planning.reason ?? "unknown"}`);
  if (stageAgent.ingestion?.attempted) lines.push(stageAgent.ingestion.ingested ? `Ingested ${stage} artifact ${stageAgent.ingestion.artifact?.id ?? "unknown"}.` : `Stage artifact rejected: ${stageAgent.ingestion.reason ?? "unknown"}`);
  if (advancement) lines.push(advancement.message);
  return lines.join("\n");
}

function buildMergedKnowledgeMarkdown(requirements: RuntimePrdRequirement[], reports: ResearchReport[]): {
  markdown: string;
  sources: Array<{ key: string; line: string }>;
  conclusions: Array<{ key: string; line: string }>;
  unresolvedUnknowns: string[];
  requirementRefs: string[];
} {
  const sourceByKey = new Map<string, string>();
  const conclusionByKey = new Map<string, string>();
  const unresolved = new Set<string>();
  const requirementRefs = new Set<string>();

  for (const report of reports) {
    for (const ref of report.requirementRefs ?? []) requirementRefs.add(ref);
    for (const source of report.sources) {
      const key = normalizeDedupeKey(source.url ?? source.path ?? source.id);
      if (!sourceByKey.has(key)) {
        const location = source.url ?? source.path ?? source.id;
        sourceByKey.set(key, `- ${source.id} (${source.quality}): ${source.title}${location ? ` — ${location}` : ""}`);
      }
    }
    for (const conclusion of report.conclusions) {
      const key = normalizeDedupeKey(conclusion.summary);
      if (!conclusionByKey.has(key)) {
        const refs = conclusion.sourceRefs.length > 0 ? ` sources=${conclusion.sourceRefs.join(",")}` : "";
        const evidence = conclusion.evidenceRefs && conclusion.evidenceRefs.length > 0 ? ` evidence=${conclusion.evidenceRefs.join(",")}` : "";
        conclusionByKey.set(key, `- [${conclusion.confidence}] ${conclusion.summary}${refs}${evidence}`);
      }
    }
    for (const unknown of report.unresolvedUnknowns ?? []) unresolved.add(unknown);
  }

  if (requirementRefs.size === 0) {
    for (const requirement of requirements) requirementRefs.add(requirement.id);
  }

  const sources = [...sourceByKey.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([key, line]) => ({ key, line }));
  const conclusions = [...conclusionByKey.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([key, line]) => ({ key, line }));
  const unresolvedUnknowns = [...unresolved].sort((a, b) => a.localeCompare(b));
  const lines = [
    "# Stage II Knowledge Report",
    "",
    `Generated from ${reports.length} research report(s).`,
    "",
    "## Requirements",
    ...(requirements.length > 0 ? requirements.map((requirement) => `- ${requirement.id}: ${requirement.statement}`) : ["- No runtime requirements recorded."]),
    "",
    "## Conclusions",
    ...(conclusions.length > 0 ? conclusions.map((item) => item.line) : ["- No research conclusions recorded; local requirements did not require additional research." ]),
    "",
    "## Sources",
    ...(sources.length > 0 ? sources.map((item) => item.line) : ["- No external sources recorded." ]),
    "",
    "## Unresolved Unknowns",
    ...(unresolvedUnknowns.length > 0 ? unresolvedUnknowns.map((item) => `- ${item}`) : ["- None recorded."]),
    "",
  ];
  return { markdown: lines.join("\n"), sources, conclusions, unresolvedUnknowns, requirementRefs: [...requirementRefs].sort((a, b) => a.localeCompare(b)) };
}

function parsePrdRequirements(
  values: unknown[],
  timestamp: string,
  existing: RuntimePrdRequirement[] = [],
): RuntimePrdRequirement[] | undefined {
  if (values.length === 0) return undefined;
  const requirements: RuntimePrdRequirement[] = [];
  for (const value of values) {
    if (!isRecord(value)) return undefined;
    const id = stringField(value, "id");
    const statement = stringField(value, "statement");
    if (!id || !statement) return undefined;
    const criteria = parsePrdAcceptanceCriteria(value);
    if (criteria === null) return undefined;
    const previous = existing.find((requirement) => requirement.id === id);
    requirements.push({
      id,
      statement,
      title: stringField(value, "title"),
      source: stringField(value, "source") ?? (previous ? previous.source : "stage_workflow_prd"),
      acceptanceCriteria: criteria ?? previous?.acceptanceCriteria,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }
  return requirements;
}

function parsePlanningReportInput(report: Record<string, unknown>): PlanningReportInput | undefined {
  const requirementsRaw = arrayField(report, "requirements");
  const requirements = requirementsRaw.map((value) => {
    if (!isRecord(value)) return undefined;
    const id = stringField(value, "id");
    const statement = stringField(value, "statement");
    if (!id || !statement) return undefined;
    const status = stringField(value, "status");
    const acceptanceCriteria = parsePrdAcceptanceCriteria(value);
    if (acceptanceCriteria === null) return undefined;
    return {
      id,
      statement,
      title: stringField(value, "title"),
      source: stringField(value, "source"),
      acceptanceCriteria,
      status: status && isRuntimePrdRequirementStatus(status) ? status : undefined,
      evidenceRefs: stringArrayField(value, "evidenceRefs"),
      notes: stringField(value, "notes"),
    };
  });
  if (requirements.some((requirement) => !requirement)) return undefined;
  const planRaw = report.plan;
  if (!isRecord(planRaw)) return undefined;
  const planVersion = numberField(planRaw, "planVersion");
  const status = stringField(planRaw, "status");
  const tasksRaw = arrayField(planRaw, "tasks");
  if (planVersion === undefined || !status || !executionPlanStatuses.has(status as ExecutionPlanStatus)) return undefined;
  const tasks = tasksRaw.map((value) => {
    if (!isRecord(value)) return undefined;
    const id = stringField(value, "id");
    const title = stringField(value, "title");
    if (!id || !title) return undefined;
    return {
      id,
      title,
      description: stringField(value, "description"),
      taskKind: stringField(value, "taskKind"),
      atomicityRationale: stringField(value, "atomicityRationale"),
      prdRefs: stringArrayField(value, "prdRefs"),
      allowedPathPrefixes: stringArrayField(value, "allowedPathPrefixes"),
      outputPaths: normalizeOutputPaths(value.outputPaths as string[] | undefined),
      dependsOn: stringArrayField(value, "dependsOn"),
      definitionOfDone: stringArrayField(value, "definitionOfDone"),
      validationRefs: stringArrayField(value, "validationRefs"),
      validationCommands: parseEmbeddedValidationCommands(arrayField(value, "validationCommands")),
      qualityWaivers: parseTaskQualityWaiverRecords(arrayField(value, "qualityWaivers")),
    };
  });
  if (tasks.some((task) => !task)) return undefined;

  const plan: ExecutionPlanArtifact = {
    version: 1,
    planVersion,
    status: status as ExecutionPlanStatus,
    title: stringField(planRaw, "title"),
    source: stringField(planRaw, "source"),
    tasks: tasks as ExecutionPlanArtifact["tasks"],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  return {
    id: stringField(report, "id"),
    reason: stringField(report, "reason"),
    source: stringField(report, "source"),
    requirements: requirements as PlanningReportInput["requirements"],
    plan,
  };
}

function parsePrdAcceptanceCriteria(
  record: Record<string, unknown>,
): RuntimePrdAcceptanceCriterion[] | undefined | null {
  if (!("acceptanceCriteria" in record)) return undefined;
  if (!Array.isArray(record.acceptanceCriteria)) return null;
  const criteria: RuntimePrdAcceptanceCriterion[] = [];
  for (const value of record.acceptanceCriteria) {
    if (!isRecord(value)) return null;
    const id = stringField(value, "id");
    const statement = stringField(value, "statement");
    const validationTaskId = stringField(value, "validationTaskId");
    const commandId = stringField(value, "commandId");
    const participantValues = value.participantTaskIds;
    if (!Array.isArray(participantValues) || participantValues.length === 0
      || participantValues.some((taskId) => typeof taskId !== "string" || !taskId.trim())) return null;
    const participantTaskIds = participantValues.map((taskId) => (taskId as string).trim());
    if (!id || !statement || !validationTaskId || !commandId) return null;
    criteria.push({ id, statement, validationTaskId, commandId, participantTaskIds });
  }
  try {
    return normalizePrdAcceptanceCriteria(criteria);
  } catch {
    return null;
  }
}

function hasUsefulResearchReport(requirementId: string, reports: ResearchReport[]): boolean {
  return reports.some((report) => (report.status === "complete" || report.status === "partial") && report.requirementRefs?.includes(requirementId));
}

function isStageKnowledgeRequest(request: ResearchRequest): boolean {
  return request.id.startsWith("RESEARCH-REQ") || request.reason.includes("Stage II knowledge collection") || (request.requirementRefs?.length ?? 0) > 0;
}

function resolveStageTools(stage: StageArtifactStage, options: StageWorkflowOptions): string[] | undefined {
  if (options.stageTools) return options.stageTools;
  return defaultStageAgentTools(stage, options.tools ?? []);
}

function resolveResearchTools(options: StageWorkflowOptions): string[] | undefined {
  if (options.researchTools) return options.researchTools;
  return uniqueTools([...localProjectInspectionTools, ...(options.tools ?? []), "scaler_research_report"]);
}

function resolveReplanTools(options: StageWorkflowOptions): string[] | undefined {
  if (options.replanTools) return options.replanTools;
  return options.tools ? uniqueTools(options.tools) : undefined;
}

function uniqueTools(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function summarizeStepForAudit(step: StageWorkflowStepResult): Record<string, unknown> {
  return {
    action: step.action,
    accepted: step.accepted,
    stage: step.stage,
    message: firstLine(step.message),
    stopReason: step.stopReason,
  };
}

function firstLine(value: string): string {
  return value.split("\n")[0] ?? value;
}

function normalizeMax(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), min), max);
}

function safeId(value: string): string {
  return value.replace(/[^A-Za-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "REQ";
}

function normalizeDedupeKey(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function numberField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanField(record: Record<string, unknown>, key: string): boolean {
  return record[key] === true;
}

function stringArrayField(record: Record<string, unknown>, key: string): string[] | undefined {
  const value = record[key];
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
  return items.length > 0 ? Array.from(new Set(items)).sort((a, b) => a.localeCompare(b)) : undefined;
}

function arrayField(record: Record<string, unknown>, key: string): unknown[] {
  const value = record[key];
  return Array.isArray(value) ? value : [];
}

function parseEmbeddedValidationCommands(values: unknown[]): ExecutionPlanArtifact["tasks"][number]["validationCommands"] {
  const commands: NonNullable<ExecutionPlanArtifact["tasks"][number]["validationCommands"]> = [];
  for (const value of values) {
    if (!isRecord(value)) continue;
    const id = stringField(value, "id");
    const command = stringField(value, "command");
    if (!id || !command) continue;
    commands.push({
      id,
      command,
      description: stringField(value, "description"),
      timeoutMs: numberField(value, "timeoutMs"),
      required: value.required === undefined ? undefined : booleanField(value, "required"),
      gate: stringField(value, "gate"),
      expectedResult: stringField(value, "expectedResult"),
      evidenceRefs: stringArrayField(value, "evidenceRefs"),
      environment: stringField(value, "environment"),
      disposition: stringField(value, "disposition"),
      dispositionReason: stringField(value, "dispositionReason"),
    });
  }
  return commands.length > 0 ? commands : undefined;
}

function parseTaskQualityWaiverRecords(values: unknown[]): ExecutionPlanArtifact["tasks"][number]["qualityWaivers"] {
  const waivers: NonNullable<ExecutionPlanArtifact["tasks"][number]["qualityWaivers"]> = [];
  for (const value of values) {
    if (!isRecord(value)) continue;
    const code = stringField(value, "code");
    const reason = stringField(value, "reason");
    if (!code || !reason) continue;
    waivers.push({ code, reason, evidenceRefs: stringArrayField(value, "evidenceRefs"), approvedBy: stringField(value, "approvedBy") });
  }
  return waivers.length > 0 ? waivers : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fingerprintValidationInputs, normalizeOutputPaths, normalizeValidationInputPaths } from "./output-artifacts.js";
import {
  getCurrentExecutionPlanPath,
  getExecutionPlansDir,
  getExecutionPlanVersionsDir,
  getPlanningReportsPath,
  getProposedExecutionPlanPath,
  getReplanDecisionsPath,
  getReplanRequestsPath,
} from "./paths.js";
import { advanceReplannedCoverage, applyPrdRequirementUpserts, computePrdCoverageSummary, loadPrdCoverage, loadPrdRequirements, type RuntimePrdAcceptanceCriterion, type RuntimePrdCoverageEntry, type RuntimePrdRequirementStatus, type RuntimePrdRequirementsFile } from "./prd.js";
import { assertStateSnapshotCurrent, saveState } from "./state.js";
import { assessTaskDefinitionQuality, normalizeTaskKind } from "./task-quality.js";
import { createTask, reviewTaskAcceptancePolicyMutation, updateTask, type UpdateTaskInput } from "./tasks.js";
import type { ScalerState, ScalerTaskKind, ScalerTaskQualityWaiver } from "./types.js";
import { assertValidationPolicyMutationAuthorized, getValidationManifestForTask, loadValidationManifests, withValidationPolicyLock, type EmbeddedValidationManifestCommandInput, type ValidationPolicyAuthority } from "./validation.js";

export const executionPlanStatuses = ["draft", "active", "superseded", "completed"] as const;
export type ExecutionPlanStatus = (typeof executionPlanStatuses)[number];

export const replanRequestStatuses = ["open", "accepted", "superseded", "resolved"] as const;
export type ReplanRequestStatus = (typeof replanRequestStatuses)[number];

export const replanRequestTriggers = ["manual", "validation_blocked", "debug_cycle", "debug_blocked", "coverage_gap", "plan_replacement"] as const;
export type ReplanRequestTrigger = (typeof replanRequestTriggers)[number];

export interface ExecutionPlanTask {
  id: string;
  outputPaths?: string[];
  validationInputPaths?: string[];
  title: string;
  description?: string;
  taskKind?: ScalerTaskKind | string;
  atomicityRationale?: string;
  prdRefs?: string[];
  allowedPathPrefixes?: string[];
  dependsOn?: string[];
  definitionOfDone?: string[];
  validationRefs?: string[];
  validationCommands?: EmbeddedValidationManifestCommandInput[];
  qualityWaivers?: ScalerTaskQualityWaiver[];
}

export interface ExecutionPlanArtifact {
  version: 1;
  planVersion: number;
  status: ExecutionPlanStatus;
  title?: string;
  source?: string;
  tasks: ExecutionPlanTask[];
  createdAt: string;
  updatedAt: string;
}

export interface ExecutionPlanApplyOptions {
  updateExisting?: boolean;
  acceptanceAuthority?: ValidationPolicyAuthority;
}

export interface ExecutionPlanApplyResult {
  state: ScalerState;
  createdTaskIds: string[];
  existingTaskIds: string[];
  updatedTaskIds: string[];
  rejectedTaskIds: string[];
  message: string;
}

export interface PlanningReportRequirementInput {
  id: string;
  statement: string;
  title?: string;
  source?: string;
  acceptanceCriteria?: RuntimePrdAcceptanceCriterion[];
  status?: RuntimePrdRequirementStatus;
  evidenceRefs?: string[];
  notes?: string;
}

export interface PlanningReportInput {
  id?: string;
  reason?: string;
  source?: string;
  requirements: PlanningReportRequirementInput[];
  plan: Omit<ExecutionPlanArtifact, "version" | "createdAt" | "updatedAt"> & Partial<Pick<ExecutionPlanArtifact, "version" | "createdAt" | "updatedAt">>;
}

export interface PlanningCoverageDiagnostics {
  linkedRequirementIds: string[];
  unlinkedRequirementIds: string[];
  unknownPlanRequirementIds: string[];
  planUnlinkedTaskIds: string[];
}

export interface PlanningReportRecord {
  id: string;
  reason: string;
  source?: string;
  planVersion: number;
  requirementIds: string[];
  createdTaskIds: string[];
  existingTaskIds: string[];
  updatedTaskIds: string[];
  rejectedTaskIds: string[];
  diagnostics: PlanningCoverageDiagnostics;
  createdAt: string;
}

interface PlanningReportIndex {
  version: 1;
  reports: PlanningReportRecord[];
}

export interface PlanningReportResult {
  accepted: boolean;
  message: string;
  state: ScalerState;
  plan: ExecutionPlanArtifact;
  report: PlanningReportRecord;
}

export interface ExecutionPlanSummary {
  planVersion: number;
  status: ExecutionPlanStatus;
  plannedTaskCount: number;
  createdTaskCount: number;
  missingTaskIds: string[];
  validatedPlannedTaskCount: number;
  linkedRequirementIds: string[];
  unlinkedRequirementIds: string[];
  planUnlinkedTaskIds: string[];
}

export interface ReplanRequest {
  id: string;
  status: ReplanRequestStatus;
  trigger: ReplanRequestTrigger;
  reason: string;
  taskId?: string;
  evidenceRefs?: string[];
  requirementRefs?: string[];
  planVersion?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ExecutionPlanPreservationCheck {
  ok: boolean;
  preservedValidatedTaskIds: string[];
  droppedValidatedTaskIds: string[];
  preservedValidatedRequirementIds: string[];
  droppedValidatedRequirementIds: string[];
  unlinkedRequirementIds: string[];
  planUnlinkedTaskIds: string[];
}

export interface ReplanRequestInput {
  id?: string;
  status?: ReplanRequestStatus | string;
  trigger: ReplanRequestTrigger | string;
  reason: string;
  taskId?: string;
  evidenceRefs?: string[];
  requirementRefs?: string[];
  planVersion?: number;
}

export type ReplanDecisionStatus = "applying" | "accepted" | "rejected";

export interface ReplanDecisionRecord {
  id: string;
  status: ReplanDecisionStatus;
  summary: string;
  requestIds: string[];
  previousPlanVersion: number;
  proposedPlanVersion: number;
  snapshotPath?: string;
  createdTaskIds?: string[];
  existingTaskIds?: string[];
  reopenedTaskIds?: string[];
  rejectedTaskIds?: string[];
  proposalFingerprint?: string;
  previousPlanFingerprint?: string;
  affectedRequirementRevisions?: Record<string, number>;
  affectedCoverageEntries?: Record<string, RuntimePrdCoverageEntry>;
  preservation: ExecutionPlanPreservationCheck;
  createdAt: string;
}

export interface ReplanProposalAcceptanceResult {
  accepted: boolean;
  message: string;
  state: ScalerState;
  decision: ReplanDecisionRecord;
  currentPlan: ExecutionPlanArtifact;
  proposedPlan?: ExecutionPlanArtifact;
  savedPlan?: ExecutionPlanArtifact;
  snapshotPath?: string;
  applyResult?: ExecutionPlanApplyResult;
}

interface ReplanRequestIndex {
  version: 1;
  requests: ReplanRequest[];
}

interface ReplanDecisionIndex {
  version: 1;
  decisions: ReplanDecisionRecord[];
}

export function createEmptyExecutionPlan(now = new Date()): ExecutionPlanArtifact {
  const timestamp = now.toISOString();
  return {
    version: 1,
    planVersion: 0,
    status: "draft",
    tasks: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function validateExecutionPlan(plan: ExecutionPlanArtifact): void {
  if (plan.version !== 1) throw new Error(`Unsupported execution plan version: ${String(plan.version)}`);
  if (!executionPlanStatuses.includes(plan.status)) throw new Error(`Invalid execution plan status: ${String(plan.status)}`);
  const taskIds = new Set<string>();
  const tasksById = new Map<string, ExecutionPlanTask>();
  for (const task of plan.tasks) {
    normalizeOutputPaths(task.outputPaths);
    if (!task.id.trim()) throw new Error("Execution plan task id is required.");
    if (taskIds.has(task.id)) throw new Error(`Duplicate execution plan task id: ${task.id}`);
    taskIds.add(task.id);
    tasksById.set(task.id, task);
    if (!task.title.trim()) throw new Error(`Execution plan task ${task.id} title is required.`);
  }

  for (const task of plan.tasks) {
    for (const dependencyId of task.dependsOn ?? []) {
      if (!taskIds.has(dependencyId)) {
        throw new Error(`Unknown dependency ${dependencyId} referenced by execution plan task ${task.id}.`);
      }
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const path: string[] = [];
  const visit = (taskId: string): void => {
    if (visited.has(taskId)) return;
    if (visiting.has(taskId)) {
      const cycleStart = path.indexOf(taskId);
      const cycle = [...path.slice(cycleStart), taskId];
      throw new Error(`Execution plan dependency cycle: ${cycle.join(" -> ")}.`);
    }
    visiting.add(taskId);
    path.push(taskId);
    for (const dependencyId of tasksById.get(taskId)?.dependsOn ?? []) visit(dependencyId);
    path.pop();
    visiting.delete(taskId);
    visited.add(taskId);
  };
  for (const task of plan.tasks) visit(task.id);
}

export async function loadExecutionPlan(cwd: string): Promise<ExecutionPlanArtifact> {
  try {
    const raw = await readFile(getCurrentExecutionPlanPath(cwd), "utf8");
    const plan = JSON.parse(raw) as ExecutionPlanArtifact;
    validateExecutionPlan(plan);
    return plan;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return createEmptyExecutionPlan();
    throw error;
  }
}

export async function loadProposedExecutionPlan(cwd: string): Promise<ExecutionPlanArtifact | undefined> {
  try {
    const raw = await readFile(getProposedExecutionPlanPath(cwd), "utf8");
    const plan = JSON.parse(raw) as ExecutionPlanArtifact;
    validateExecutionPlan(plan);
    return plan;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function saveProposedExecutionPlan(cwd: string, plan: ExecutionPlanArtifact, now = new Date()): Promise<ExecutionPlanArtifact> {
  const normalized = normalizeExecutionPlan(plan, now);
  validateExecutionPlan(normalized);
  await mkdir(getExecutionPlansDir(cwd), { recursive: true });
  await writeFile(getProposedExecutionPlanPath(cwd), `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return normalized;
}

export async function saveExecutionPlan(cwd: string, plan: ExecutionPlanArtifact, now = new Date()): Promise<ExecutionPlanArtifact> {
  const normalized = normalizeExecutionPlan(plan, now);
  validateExecutionPlan(normalized);
  await mkdir(getExecutionPlansDir(cwd), { recursive: true });
  await writeFile(getCurrentExecutionPlanPath(cwd), `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return normalized;
}

export async function acceptReplanProposal(
  cwd: string,
  state: ScalerState,
  requirements: RuntimePrdRequirementsFile,
  input?: { currentPlan?: ExecutionPlanArtifact; proposedPlan?: ExecutionPlanArtifact; now?: Date; requestIds?: string[] },
): Promise<ReplanProposalAcceptanceResult> {
  return withValidationPolicyLock(cwd, () => acceptReplanProposalLocked(cwd, state, requirements, input));
}

async function acceptReplanProposalLocked(
  cwd: string,
  state: ScalerState,
  requirements: RuntimePrdRequirementsFile,
  input?: { currentPlan?: ExecutionPlanArtifact; proposedPlan?: ExecutionPlanArtifact; now?: Date; requestIds?: string[] },
): Promise<ReplanProposalAcceptanceResult> {
  await assertStateSnapshotCurrent(cwd, state);
  const now = input?.now ?? new Date();
  const timestamp = now.toISOString();
  const currentPlan = input?.currentPlan ?? (await loadExecutionPlan(cwd));
  const proposedPlan = input?.proposedPlan ?? (await loadProposedExecutionPlan(cwd));
  if (!proposedPlan) {
    const preservation = emptyPreservationCheck(false);
    const decision = await appendReplanDecision(cwd, {
      id: `DECISION-${now.getTime()}`,
      status: "rejected",
      summary: "No proposed execution plan found.",
      requestIds: input?.requestIds ?? [],
      previousPlanVersion: currentPlan.planVersion,
      proposedPlanVersion: -1,
      preservation,
      createdAt: timestamp,
    });
    return { accepted: false, message: decision.summary, state, decision, currentPlan };
  }

  const proposalFingerprint = fingerprintReplanProposal(proposedPlan);
  const decisions = await loadReplanDecisions(cwd);
  const acceptedDecision = decisions.find((decision) =>
    decision.status === "accepted" && decision.proposalFingerprint === proposalFingerprint,
  );
  if (acceptedDecision) {
    const durablePlan = await loadExecutionPlan(cwd);
    const targetPlan: ExecutionPlanArtifact = {
      ...proposedPlan,
      status: "active",
      planVersion: acceptedDecision.proposedPlanVersion,
      source: proposedPlan.source ?? "replan-proposal",
    };
    if (!sameAcceptedReplanPlan(durablePlan, targetPlan)) {
      throw new Error(`Accepted replan decision ${acceptedDecision.id} conflicts with active plan version ${durablePlan.planVersion}.`);
    }
    const durableRequirements = await loadPrdRequirements(cwd);
    for (const [id, expectedRevision] of Object.entries(acceptedDecision.affectedRequirementRevisions ?? {})) {
      const requirement = durableRequirements.requirements.find((candidate) => candidate.id === id);
      const currentRevision = requirement?.revision ?? 1;
      if (!requirement || currentRevision !== expectedRevision) {
        throw new Error(`Accepted replan decision ${acceptedDecision.id} is stale for ${id}: expected revision ${expectedRevision}, current revision ${requirement ? currentRevision : "missing"}.`);
      }
    }
    const acceptedCoverage = await loadPrdCoverage(cwd);
    const reInvalidated = Object.keys(acceptedDecision.affectedRequirementRevisions ?? {}).filter((id) => {
      const entry = acceptedCoverage.entries.find((candidate) => candidate.requirementId === id);
      return !entry || entry.status === "needs_replan";
    });
    if (reInvalidated.length > 0) {
      throw new Error(`Accepted replan decision ${acceptedDecision.id} no longer covers: ${reInvalidated.join(", ")}.`);
    }
    return {
      accepted: true,
      message: acceptedDecision.summary,
      state,
      decision: acceptedDecision,
      currentPlan,
      proposedPlan,
      savedPlan: durablePlan,
      snapshotPath: acceptedDecision.snapshotPath,
      applyResult: {
        state,
        createdTaskIds: acceptedDecision.createdTaskIds ?? [],
        existingTaskIds: acceptedDecision.existingTaskIds ?? [],
        updatedTaskIds: [],
        rejectedTaskIds: acceptedDecision.rejectedTaskIds ?? [],
        message: `Plan apply already finalized by ${acceptedDecision.id}.`,
      },
    };
  }
  const applyingDecision = decisions.find((decision) =>
    decision.status === "applying" && decision.proposalFingerprint === proposalFingerprint,
  );
  const coverage = await loadPrdCoverage(cwd);
  const affectedRequirementIds = new Set(applyingDecision?.affectedRequirementRevisions
    ? Object.keys(applyingDecision.affectedRequirementRevisions)
    : coverage.entries.filter((entry) => entry.status === "needs_replan").map((entry) => entry.requirementId));
  const coverageAffectedTaskIds = new Set(coverage.entries
    .filter((entry) => affectedRequirementIds.has(entry.requirementId))
    .flatMap((entry) => entry.taskIds ?? []));
  const affectedTaskIds = applyingDecision?.reopenedTaskIds ?? state.tasks
    .filter((task) => (task.status === "validated" || task.status === "ready")
      && (coverageAffectedTaskIds.has(task.id) || task.prdRefs?.some((id) => affectedRequirementIds.has(id))))
    .map((task) => task.id);
  const reopenedTaskIds = applyingDecision?.reopenedTaskIds
    ?? affectedTaskIds.filter((id) => state.tasks.find((task) => task.id === id)?.status === "validated");
  const proposedTaskIds = new Set(proposedPlan.tasks.map((task) => task.id));
  const missingAffectedTaskIds = affectedTaskIds.filter((id) => !proposedTaskIds.has(id));
  const initialPreservation = applyingDecision?.preservation
    ?? checkExecutionPlanPreservation(currentPlan, proposedPlan, requirements, state);
  const preservation = applyingDecision?.preservation ?? (missingAffectedTaskIds.length === 0
    ? initialPreservation
    : {
        ...initialPreservation,
        ok: false,
        droppedValidatedTaskIds: [...new Set([...initialPreservation.droppedValidatedTaskIds, ...missingAffectedTaskIds])],
      });
  const openRequests = (await loadReplanRequests(cwd)).filter((request) => request.status === "open");
  const requestIds = applyingDecision?.requestIds ?? input?.requestIds ?? openRequests.map((request) => request.id);
  if (!preservation.ok) {
    const decision = await appendReplanDecision(cwd, {
      id: `DECISION-${now.getTime()}`,
      status: "rejected",
      summary: "Proposed execution plan failed preservation checks.",
      requestIds,
      previousPlanVersion: currentPlan.planVersion,
      proposedPlanVersion: proposedPlan.planVersion,
      preservation,
      createdAt: timestamp,
    });
    return { accepted: false, message: decision.summary, state, decision, currentPlan, proposedPlan };
  }

  assertExecutionPlanCoverage(
    proposedPlan,
    new Set(requirements.requirements.map((requirement) => requirement.id)),
  );
  const reopenedState = reopenAffectedValidatedTasks(state, reopenedTaskIds, timestamp);
  await preflightExecutionPlanTaskQuality(cwd, reopenedState, proposedPlan, { updateExisting: false });
  const policyRejections = await preflightExecutionPlanPolicyChanges(cwd, reopenedState, proposedPlan, "model");
  if (policyRejections.length > 0) {
    const decision = await appendReplanDecision(cwd, {
      id: `DECISION-${now.getTime()}`,
      status: "rejected",
      summary: `Proposed execution plan failed acceptance-policy authority: ${policyRejections.join(" ")}`,
      requestIds,
      previousPlanVersion: currentPlan.planVersion,
      proposedPlanVersion: proposedPlan.planVersion,
      preservation,
      createdAt: timestamp,
    });
    return { accepted: false, message: decision.summary, state, decision, currentPlan, proposedPlan };
  }

  await preflightExecutionPlanValidationInputs(cwd, proposedPlan);
  const targetPlanVersion = applyingDecision?.proposedPlanVersion
    ?? Math.max(currentPlan.planVersion + 1, proposedPlan.planVersion);
  const targetPlan: ExecutionPlanArtifact = {
    ...proposedPlan,
    status: "active",
    planVersion: targetPlanVersion,
    source: proposedPlan.source ?? "replan-proposal",
  };
  const affectedRequirementRevisions = applyingDecision?.affectedRequirementRevisions
    ?? Object.fromEntries([...affectedRequirementIds].map((id) => {
      const requirement = requirements.requirements.find((candidate) => candidate.id === id);
      if (!requirement) throw new Error(`Replan acceptance requires runtime PRD requirement ${id}.`);
      return [id, requirement.revision ?? 1];
    }));
  const affectedCoverageEntries = applyingDecision?.affectedCoverageEntries
    ?? Object.fromEntries([...affectedRequirementIds].map((id) => {
      const entry = coverage.entries.find((candidate) => candidate.requirementId === id);
      if (!entry) throw new Error(`Replan acceptance requires coverage entry ${id}.`);
      return [id, entry];
    }));
  const previousPlanFingerprint = applyingDecision?.previousPlanFingerprint
    ?? fingerprintReplanProposal(currentPlan);
  const durablePlan = await loadExecutionPlan(cwd);
  if (!applyingDecision && !sameAcceptedReplanPlan(durablePlan, { ...currentPlan, status: "active" })) {
    throw new Error(`Replan acceptance has a stale current plan: expected version ${currentPlan.planVersion}, active version ${durablePlan.planVersion}.`);
  }
  const snapshotPath = applyingDecision?.snapshotPath
    ?? await createExecutionPlanSnapshot(cwd, { plan: currentPlan, now });
  const journal = applyingDecision ?? await appendReplanDecision(cwd, {
    id: `DECISION-${now.getTime()}`,
    status: "applying",
    summary: `Applying proposed execution plan version ${targetPlanVersion}.`,
    requestIds,
    previousPlanVersion: currentPlan.planVersion,
    proposedPlanVersion: targetPlanVersion,
    snapshotPath,
    createdTaskIds: proposedPlan.tasks.filter((task) => !state.tasks.some((current) => current.id === task.id)).map((task) => task.id),
    existingTaskIds: proposedPlan.tasks.filter((task) => state.tasks.some((current) => current.id === task.id)).map((task) => task.id),
    reopenedTaskIds,
    proposalFingerprint,
    previousPlanFingerprint,
    affectedRequirementRevisions,
    affectedCoverageEntries,
    preservation,
    createdAt: timestamp,
  });
  if (durablePlan.planVersion === journal.proposedPlanVersion) {
    if (!sameAcceptedReplanPlan(durablePlan, targetPlan)) {
      throw new Error(`Replan decision ${journal.id} target plan conflicts with active plan version ${durablePlan.planVersion}.`);
    }
  } else if (durablePlan.planVersion === journal.previousPlanVersion) {
    if (!journal.previousPlanFingerprint || fingerprintReplanProposal(durablePlan) !== journal.previousPlanFingerprint) {
      throw new Error(`Replan decision ${journal.id} previous plan conflicts with active plan version ${durablePlan.planVersion}.`);
    }
  } else {
    throw new Error(`Replan decision ${journal.id} cannot resume from active plan version ${durablePlan.planVersion}.`);
  }
  const taskIdsByRequirement = buildPlanTaskIdsByRequirement(targetPlan);
  await advanceReplannedCoverage(cwd, {
    affectedRequirementRevisions,
    expectedCoverageEntries: affectedCoverageEntries,
    taskIdsByRequirement: Object.fromEntries(taskIdsByRequirement),
    updatedAt: journal.createdAt,
  });
  const durablePlanAfterCoverage = await loadExecutionPlan(cwd);
  let savedPlan: ExecutionPlanArtifact;
  if (durablePlanAfterCoverage.planVersion === journal.proposedPlanVersion) {
    if (!sameAcceptedReplanPlan(durablePlanAfterCoverage, targetPlan)) {
      throw new Error(`Replan decision ${journal.id} target plan conflicts with active plan version ${durablePlanAfterCoverage.planVersion}.`);
    }
    savedPlan = durablePlanAfterCoverage;
  } else if (durablePlanAfterCoverage.planVersion === journal.previousPlanVersion) {
    if (!journal.previousPlanFingerprint || fingerprintReplanProposal(durablePlanAfterCoverage) !== journal.previousPlanFingerprint) {
      throw new Error(`Replan decision ${journal.id} previous plan conflicts with active plan version ${durablePlanAfterCoverage.planVersion}.`);
    }
    savedPlan = await saveExecutionPlan(cwd, targetPlan, now);
  } else {
    throw new Error(`Replan decision ${journal.id} cannot resume from active plan version ${durablePlanAfterCoverage.planVersion}.`);
  }
  if (reopenedState !== state) await saveState(cwd, reopenedState);
  const applyResult = await applyExecutionPlanTasks(cwd, reopenedState, savedPlan);
  const requests = await loadReplanRequests(cwd);
  await saveReplanRequests(cwd, requests.map((request) =>
    requestIds.includes(request.id)
      ? { ...request, status: "resolved", planVersion: savedPlan.planVersion, updatedAt: timestamp }
      : request,
  ));
  const decision = await appendReplanDecision(cwd, {
    ...journal,
    id: journal.id,
    status: "accepted",
    summary: `Accepted proposed execution plan version ${savedPlan.planVersion}.`,
    createdTaskIds: journal.createdTaskIds ?? applyResult.createdTaskIds,
    existingTaskIds: journal.existingTaskIds ?? applyResult.existingTaskIds,
    rejectedTaskIds: applyResult.rejectedTaskIds,
  });

  return {
    accepted: true,
    message: decision.summary,
    state: applyResult.state,
    decision,
    currentPlan,
    proposedPlan,
    savedPlan,
    snapshotPath,
    applyResult,
  };
}

export async function applyExecutionPlanTasks(
  cwd: string,
  state: ScalerState,
  plan: ExecutionPlanArtifact,
  options: ExecutionPlanApplyOptions = {},
): Promise<ExecutionPlanApplyResult> {
  validateExecutionPlan(plan);
  await preflightExecutionPlanValidationInputs(cwd, plan);
  let nextState = state;
  const createdTaskIds: string[] = [];
  const existingTaskIds: string[] = [];
  const updatedTaskIds: string[] = [];
  const rejectedTaskIds: string[] = [];

  for (const task of plan.tasks) {
    const existing = nextState.tasks.find((candidate) => candidate.id === task.id);
    if (existing) {
      existingTaskIds.push(task.id);
      if (options.updateExisting) {
        const result = await updateTask(cwd, nextState, {
          id: task.id,
          title: existing.status === "validated" ? existing.title : task.title,
          taskKind: task.taskKind,
          atomicityRationale: task.atomicityRationale,
          allowedPathPrefixes: task.allowedPathPrefixes,
          dependsOn: task.dependsOn,
          prdRefs: task.prdRefs,
          definitionOfDone: task.definitionOfDone,
          validationRefs: task.validationRefs,
          validationCommands: task.validationCommands,
          outputPaths: task.outputPaths,
          validationInputPaths: task.validationInputPaths,
          qualityWaivers: task.qualityWaivers,
          qualityMode: "enforce",
          acceptanceAuthority: options.acceptanceAuthority ?? "system",
        });
        nextState = result.state;
        if (result.accepted) updatedTaskIds.push(task.id);
        else rejectedTaskIds.push(task.id);
      }
      continue;
    }

    const result = await createTask(cwd, nextState, {
      id: task.id,
      title: task.title,
      taskKind: task.taskKind,
      atomicityRationale: task.atomicityRationale,
      allowedPathPrefixes: task.allowedPathPrefixes,
      dependsOn: task.dependsOn,
      prdRefs: task.prdRefs,
      definitionOfDone: task.definitionOfDone,
      validationRefs: task.validationRefs,
      validationCommands: task.validationCommands,
      outputPaths: task.outputPaths,
      validationInputPaths: task.validationInputPaths,
      qualityWaivers: task.qualityWaivers,
      qualityMode: "enforce",
      acceptanceAuthority: options.acceptanceAuthority ?? "system",
    });
    nextState = result.state;
    if (result.accepted) createdTaskIds.push(task.id);
    else rejectedTaskIds.push(task.id);
  }

  return {
    state: nextState,
    createdTaskIds,
    existingTaskIds,
    updatedTaskIds,
    rejectedTaskIds,
    message: `Plan apply: created=${createdTaskIds.length} existing=${existingTaskIds.length} updated=${updatedTaskIds.length} rejected=${rejectedTaskIds.length}`,
  };
}

async function preflightExecutionPlanPolicyChanges(
  cwd: string,
  state: ScalerState,
  plan: ExecutionPlanArtifact,
  authority: ValidationPolicyAuthority,
): Promise<string[]> {
  const rejections: string[] = [];
  const manifests = await loadValidationManifests(cwd);
  for (const task of plan.tasks) {
    const existing = state.tasks.find((candidate) => candidate.id === task.id);
    if (!existing) {
      const manifest = manifests.find((candidate) => candidate.taskId === task.id);
      const writesManifest = Boolean(task.validationCommands?.length)
        || task.outputPaths !== undefined
        || task.validationInputPaths !== undefined;
      if (!manifest || !writesManifest) continue;
      try {
        await assertValidationPolicyMutationAuthorized(cwd, {
          ...manifest,
          outputPaths: task.outputPaths ?? manifest.outputPaths,
          validationInputPaths: task.validationInputPaths ?? manifest.validationInputPaths,
          definitionOfDone: task.definitionOfDone ?? manifest.definitionOfDone,
          commands: task.validationCommands?.length
            ? task.validationCommands.map((command) => ({ ...command, required: command.required ?? true }))
            : manifest.commands,
        }, { authority }, manifests);
      } catch (error) {
        rejections.push(error instanceof Error ? error.message : String(error));
      }
      continue;
    }
    const input: UpdateTaskInput = {
      id: task.id,
      title: task.title,
      taskKind: task.taskKind,
      atomicityRationale: task.atomicityRationale,
      allowedPathPrefixes: task.allowedPathPrefixes,
      dependsOn: task.dependsOn,
      prdRefs: task.prdRefs,
      definitionOfDone: task.definitionOfDone,
      validationRefs: task.validationRefs,
      validationCommands: task.validationCommands,
      outputPaths: task.outputPaths,
      validationInputPaths: task.validationInputPaths,
      qualityWaivers: task.qualityWaivers,
      acceptanceAuthority: authority,
    };
    const rejection = await reviewTaskAcceptancePolicyMutation(cwd, existing, input);
    if (rejection) rejections.push(rejection);
  }
  return rejections;
}

async function preflightExecutionPlanValidationInputs(
  cwd: string,
  plan: ExecutionPlanArtifact,
): Promise<void> {
  for (const task of plan.tasks) {
    try {
      const validationInputPaths = task.validationInputPaths
        ?? (await getValidationManifestForTask(cwd, task.id)).validationInputPaths;
      await fingerprintValidationInputs(cwd, validationInputPaths);
    } catch (error) {
      throw new Error(`Execution plan rejected before publication: task ${task.id} validation input preflight failed: ${String(error)}`);
    }
  }
}

export async function applyPlanningReport(
  cwd: string,
  state: ScalerState,
  input: PlanningReportInput,
  now = new Date(),
): Promise<PlanningReportResult> {
  return withValidationPolicyLock(cwd, () => applyPlanningReportLocked(cwd, state, input, now));
}

async function applyPlanningReportLocked(
  cwd: string,
  state: ScalerState,
  input: PlanningReportInput,
  now: Date,
): Promise<PlanningReportResult> {
  await assertStateSnapshotCurrent(cwd, state);
  const timestamp = now.toISOString();
  const plan: ExecutionPlanArtifact = normalizePlanningReportPlan(input.plan, timestamp);
  validateExecutionPlan(plan);
  const currentRequirements = await loadPrdRequirements(cwd);
  const prospectiveRequirementIds = new Set([
    ...currentRequirements.requirements.map((requirement) => requirement.id),
    ...input.requirements.map((requirement) => requirement.id),
  ]);
  assertExecutionPlanCoverage(plan, prospectiveRequirementIds);
  await preflightExecutionPlanTaskQuality(cwd, state, plan, { updateExisting: true });
  await preflightExecutionPlanValidationInputs(cwd, plan);
  const policyRejections = await preflightExecutionPlanPolicyChanges(cwd, state, plan, "model");
  if (policyRejections.length > 0) throw new Error(`Planning report rejected before publication: ${policyRejections.join(" ")}`);
  const taskIdsByRequirement = buildPlanTaskIdsByRequirement(plan);
  await applyPrdRequirementUpserts(cwd, input.requirements.map((requirement) => ({
    ...requirement,
    status: requirement.status ?? (taskIdsByRequirement.get(requirement.id)?.length ? "in_progress" : "pending"),
    taskIds: taskIdsByRequirement.get(requirement.id),
    now,
  })));
  const savedPlan = await saveExecutionPlan(cwd, plan);
  const applyResult = await applyExecutionPlanTasks(cwd, state, savedPlan, { updateExisting: true, acceptanceAuthority: "model" });

  const requirements = await loadPrdRequirements(cwd);
  const coverage = await loadPrdCoverage(cwd);
  const coverageSummary = computePrdCoverageSummary(requirements, coverage, applyResult.state);
  const diagnostics = buildPlanningCoverageDiagnostics(
    savedPlan,
    new Set(requirements.requirements.map((requirement) => requirement.id)),
    coverageSummary.unlinkedRequirementIds,
  );

  const report: PlanningReportRecord = {
    id: input.id?.trim() || `planning-${now.getTime()}`,
    reason: input.reason?.trim() || "Planner coverage synchronization.",
    source: input.source,
    planVersion: savedPlan.planVersion,
    requirementIds: input.requirements.map((requirement) => requirement.id),
    createdTaskIds: applyResult.createdTaskIds,
    existingTaskIds: applyResult.existingTaskIds,
    updatedTaskIds: applyResult.updatedTaskIds,
    rejectedTaskIds: applyResult.rejectedTaskIds,
    diagnostics,
    createdAt: timestamp,
  };
  await writePlanningReports(cwd, [report, ...(await loadPlanningReports(cwd))]);

  const warningCount = diagnostics.unlinkedRequirementIds.length + diagnostics.unknownPlanRequirementIds.length + diagnostics.planUnlinkedTaskIds.length + applyResult.rejectedTaskIds.length;
  return {
    accepted: warningCount === 0,
    message: `Planning report ${report.id}: requirements=${report.requirementIds.length} planTasks=${savedPlan.tasks.length} created=${report.createdTaskIds.length} updated=${report.updatedTaskIds.length} warnings=${warningCount}`,
    state: applyResult.state,
    plan: savedPlan,
    report,
  };
}

async function preflightExecutionPlanTaskQuality(
  cwd: string,
  state: ScalerState,
  plan: ExecutionPlanArtifact,
  options: { updateExisting: boolean },
): Promise<void> {
  const blocked: string[] = [];
  for (const task of plan.tasks) {
    const existing = state.tasks.find((candidate) => candidate.id === task.id);
    if (existing && !options.updateExisting) continue;
    const candidate: ScalerState["tasks"][number] = {
      ...(existing ?? { id: task.id, status: "pending", updatedAt: state.updatedAt }),
      title: existing?.status === "validated" ? existing.title : task.title,
      taskKind: task.taskKind !== undefined ? normalizeTaskKind(task.taskKind) : existing?.taskKind,
      atomicityRationale: task.atomicityRationale ?? existing?.atomicityRationale,
      allowedPathPrefixes: task.allowedPathPrefixes ?? existing?.allowedPathPrefixes,
      dependsOn: task.dependsOn ?? existing?.dependsOn,
      prdRefs: task.prdRefs ?? existing?.prdRefs,
      definitionOfDone: task.definitionOfDone ?? existing?.definitionOfDone,
      validationRefs: task.validationRefs ?? existing?.validationRefs,
      qualityWaivers: task.qualityWaivers ?? existing?.qualityWaivers,
    };
    const candidateState: ScalerState = {
      ...state,
      tasks: existing
        ? state.tasks.map((current) => current.id === candidate.id ? candidate : current)
        : [...state.tasks, candidate],
    };
    const assessment = await assessTaskDefinitionQuality(cwd, candidateState, candidate, {
      enforcement: "enforce",
      supplementalValidationCommands: task.validationCommands,
      supplementalValidationRefs: task.validationRefs,
    });
    if (assessment.warnings.length > 0) {
      blocked.push(`${task.id}(${assessment.warnings.map((warning) => warning.code).join(",")})`);
    }
  }
  if (blocked.length > 0) {
    throw new Error(`Planning report task contract preflight rejected before publication: ${blocked.join(" ")}.`);
  }
}

function reopenAffectedValidatedTasks(state: ScalerState, taskIds: string[], timestamp: string): ScalerState {
  if (taskIds.length === 0) return state;
  const affected = new Set(taskIds);
  const unexpected = state.tasks.filter((task) => affected.has(task.id) && task.status !== "validated" && task.status !== "ready");
  if (unexpected.length > 0) {
    throw new Error(`Replan acceptance cannot reopen tasks outside validated or ready status: ${unexpected.map((task) => task.id).join(", ")}.`);
  }
  const missing = taskIds.filter((id) => !state.tasks.some((task) => task.id === id));
  if (missing.length > 0) throw new Error(`Replan acceptance cannot reopen missing tasks: ${missing.join(", ")}.`);
  if (state.tasks.every((task) => !affected.has(task.id) || task.status === "ready")) return state;
  return {
    ...state,
    tasks: state.tasks.map((task) => affected.has(task.id)
      ? { ...task, status: "ready", updatedAt: timestamp }
      : task),
    completedTaskIds: state.completedTaskIds.filter((id) => !affected.has(id)),
    validatedTaskIds: state.validatedTaskIds.filter((id) => !affected.has(id)),
    currentTaskId: state.currentTaskId && affected.has(state.currentTaskId) ? null : state.currentTaskId,
    orchestrationReason: `Accepted replan reopened affected tasks: ${taskIds.join(", ")}`,
    updatedAt: timestamp,
  };
}

function fingerprintReplanProposal(plan: ExecutionPlanArtifact): string {
  return createHash("sha256").update(JSON.stringify(plan)).digest("hex");
}

function sameAcceptedReplanPlan(current: ExecutionPlanArtifact, target: ExecutionPlanArtifact): boolean {
  return current.planVersion === target.planVersion
    && current.status === "active"
    && current.title === target.title
    && JSON.stringify(current.tasks) === JSON.stringify(target.tasks);
}

function assertExecutionPlanCoverage(
  plan: ExecutionPlanArtifact,
  requirementIds: ReadonlySet<string>,
): PlanningCoverageDiagnostics {
  const diagnostics = buildPlanningCoverageDiagnostics(plan, requirementIds);
  const failures = [
    diagnostics.unlinkedRequirementIds.length > 0 ? `unlinked=${diagnostics.unlinkedRequirementIds.join(",")}` : undefined,
    diagnostics.unknownPlanRequirementIds.length > 0 ? `unknown=${diagnostics.unknownPlanRequirementIds.join(",")}` : undefined,
    diagnostics.planUnlinkedTaskIds.length > 0 ? `tasksWithoutPrdRefs=${diagnostics.planUnlinkedTaskIds.join(",")}` : undefined,
  ].filter((value): value is string => Boolean(value));
  if (failures.length > 0) {
    throw new Error(`Execution plan coverage preflight rejected before publication: ${failures.join(" ")}.`);
  }
  return diagnostics;
}

function buildPlanningCoverageDiagnostics(
  plan: ExecutionPlanArtifact,
  requirementIds: ReadonlySet<string>,
  unlinkedRequirementIds?: string[],
): PlanningCoverageDiagnostics {
  const planRequirementIds = new Set(plan.tasks.flatMap((task) => task.prdRefs ?? []));
  const coveredRequirementIds = new Set([...planRequirementIds].filter((id) => requirementIds.has(id)));
  return {
    linkedRequirementIds: [...coveredRequirementIds].sort((a, b) => a.localeCompare(b)),
    unlinkedRequirementIds: (unlinkedRequirementIds ?? [...requirementIds].filter((id) => !coveredRequirementIds.has(id)))
      .sort((a, b) => a.localeCompare(b)),
    unknownPlanRequirementIds: [...planRequirementIds].filter((id) => !requirementIds.has(id)).sort((a, b) => a.localeCompare(b)),
    planUnlinkedTaskIds: plan.tasks.filter((task) => !task.prdRefs || task.prdRefs.length === 0).map((task) => task.id),
  };
}

export async function loadPlanningReports(cwd: string): Promise<PlanningReportRecord[]> {
  try {
    const raw = await readFile(getPlanningReportsPath(cwd), "utf8");
    return (JSON.parse(raw) as PlanningReportIndex).reports;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export function formatPlanningReports(reports: PlanningReportRecord[], limit = 20): string {
  if (reports.length === 0) return "No planning reports.";
  const lines = ["Planning reports:"];
  for (const report of reports.slice(0, limit)) {
    const warnings = report.diagnostics.unlinkedRequirementIds.length + report.diagnostics.unknownPlanRequirementIds.length + report.diagnostics.planUnlinkedTaskIds.length + report.rejectedTaskIds.length;
    lines.push(`- ${report.id}: plan=${report.planVersion} requirements=${report.requirementIds.length} created=${report.createdTaskIds.length} updated=${report.updatedTaskIds.length} warnings=${warnings}`);
    if (report.diagnostics.unlinkedRequirementIds.length > 0) lines.push(`  unlinked=${report.diagnostics.unlinkedRequirementIds.join(",")}`);
    if (report.diagnostics.unknownPlanRequirementIds.length > 0) lines.push(`  unknown=${report.diagnostics.unknownPlanRequirementIds.join(",")}`);
    if (report.diagnostics.planUnlinkedTaskIds.length > 0) lines.push(`  tasksWithoutPrdRefs=${report.diagnostics.planUnlinkedTaskIds.join(",")}`);
  }
  return lines.join("\n");
}

export function summarizeExecutionPlan(
  plan: ExecutionPlanArtifact,
  requirements: RuntimePrdRequirementsFile,
  state: ScalerState,
): ExecutionPlanSummary {
  validateExecutionPlan(plan);
  const stateTaskIds = new Set(state.tasks.map((task) => task.id));
  const validatedTaskIds = new Set(state.tasks.filter((task) => task.status === "validated").map((task) => task.id));
  const planRequirementIds = new Set(plan.tasks.flatMap((task) => task.prdRefs ?? []));
  const requirementIds = requirements.requirements.map((requirement) => requirement.id);

  return {
    planVersion: plan.planVersion,
    status: plan.status,
    plannedTaskCount: plan.tasks.length,
    createdTaskCount: plan.tasks.filter((task) => stateTaskIds.has(task.id)).length,
    missingTaskIds: plan.tasks.filter((task) => !stateTaskIds.has(task.id)).map((task) => task.id),
    validatedPlannedTaskCount: plan.tasks.filter((task) => validatedTaskIds.has(task.id)).length,
    linkedRequirementIds: requirementIds.filter((id) => planRequirementIds.has(id)),
    unlinkedRequirementIds: requirementIds.filter((id) => !planRequirementIds.has(id)),
    planUnlinkedTaskIds: plan.tasks.filter((task) => !task.prdRefs || task.prdRefs.length === 0).map((task) => task.id),
  };
}

export function formatExecutionPlanSummary(summary: ExecutionPlanSummary): string {
  const lines = [
    `Execution plan: version=${summary.planVersion} status=${summary.status} tasks=${summary.plannedTaskCount}`,
    `Tasks: created=${summary.createdTaskCount} missing=${summary.missingTaskIds.length} validated=${summary.validatedPlannedTaskCount}`,
    `Requirements: linked=${summary.linkedRequirementIds.length} unlinked=${summary.unlinkedRequirementIds.length}`,
  ];
  if (summary.missingTaskIds.length > 0) lines.push(`Missing tasks: ${summary.missingTaskIds.join(", ")}`);
  if (summary.planUnlinkedTaskIds.length > 0) lines.push(`Plan tasks without PRD refs: ${summary.planUnlinkedTaskIds.join(", ")}`);
  if (summary.unlinkedRequirementIds.length > 0) lines.push(`Unlinked requirements: ${summary.unlinkedRequirementIds.join(", ")}`);
  return lines.join("\n");
}

export function checkExecutionPlanPreservation(
  currentPlan: ExecutionPlanArtifact,
  nextPlan: ExecutionPlanArtifact,
  requirements: RuntimePrdRequirementsFile,
  state: ScalerState,
): ExecutionPlanPreservationCheck {
  validateExecutionPlan(currentPlan);
  validateExecutionPlan(nextPlan);
  const currentPlanTaskIds = new Set(currentPlan.tasks.map((task) => task.id));
  const nextPlanTaskIds = new Set(nextPlan.tasks.map((task) => task.id));
  const nextPlanRequirementIds = new Set(nextPlan.tasks.flatMap((task) => task.prdRefs ?? []));
  const knownRequirementIds = requirements.requirements.map((requirement) => requirement.id);
  const validatedPlanTasks = state.tasks.filter((task) => task.status === "validated" && currentPlanTaskIds.has(task.id));
  const validatedRequirementIds = [
    ...new Set(
      validatedPlanTasks
        .flatMap((task) => task.prdRefs ?? [])
        .filter((id) => knownRequirementIds.includes(id)),
    ),
  ];

  const droppedValidatedTaskIds = validatedPlanTasks.filter((task) => !nextPlanTaskIds.has(task.id)).map((task) => task.id);
  const droppedValidatedRequirementIds = validatedRequirementIds.filter((id) => !nextPlanRequirementIds.has(id));
  const unlinkedRequirementIds = knownRequirementIds.filter((id) => !nextPlanRequirementIds.has(id));
  const planUnlinkedTaskIds = nextPlan.tasks.filter((task) => !task.prdRefs || task.prdRefs.length === 0).map((task) => task.id);

  return {
    ok: droppedValidatedTaskIds.length === 0 && droppedValidatedRequirementIds.length === 0 && unlinkedRequirementIds.length === 0,
    preservedValidatedTaskIds: validatedPlanTasks.filter((task) => nextPlanTaskIds.has(task.id)).map((task) => task.id),
    droppedValidatedTaskIds,
    preservedValidatedRequirementIds: validatedRequirementIds.filter((id) => nextPlanRequirementIds.has(id)),
    droppedValidatedRequirementIds,
    unlinkedRequirementIds,
    planUnlinkedTaskIds,
  };
}

export function formatExecutionPlanPreservationCheck(check: ExecutionPlanPreservationCheck): string {
  const lines = [
    `Plan preservation: ${check.ok ? "ok" : "blocked"}`,
    `Validated tasks: preserved=${check.preservedValidatedTaskIds.length} dropped=${check.droppedValidatedTaskIds.length}`,
    `Validated requirements: preserved=${check.preservedValidatedRequirementIds.length} dropped=${check.droppedValidatedRequirementIds.length}`,
    `Runtime requirements: unlinked=${check.unlinkedRequirementIds.length}`,
  ];
  if (check.droppedValidatedTaskIds.length > 0) lines.push(`Dropped validated tasks: ${check.droppedValidatedTaskIds.join(", ")}`);
  if (check.droppedValidatedRequirementIds.length > 0) lines.push(`Dropped validated requirements: ${check.droppedValidatedRequirementIds.join(", ")}`);
  if (check.unlinkedRequirementIds.length > 0) lines.push(`Unlinked requirements: ${check.unlinkedRequirementIds.join(", ")}`);
  if (check.planUnlinkedTaskIds.length > 0) lines.push(`Plan tasks without PRD refs: ${check.planUnlinkedTaskIds.join(", ")}`);
  return lines.join("\n");
}

export async function loadReplanRequests(cwd: string): Promise<ReplanRequest[]> {
  try {
    const raw = await readFile(getReplanRequestsPath(cwd), "utf8");
    const index = JSON.parse(raw) as ReplanRequestIndex;
    for (const request of index.requests) validateReplanRequest(request);
    return index.requests;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function appendReplanRequest(cwd: string, input: ReplanRequestInput, now = new Date()): Promise<ReplanRequest> {
  const timestamp = now.toISOString();
  const request: ReplanRequest = {
    id: input.id?.trim() || `REPLAN-${now.getTime()}`,
    status: (input.status ?? "open") as ReplanRequestStatus,
    trigger: input.trigger as ReplanRequestTrigger,
    reason: input.reason.trim(),
    taskId: input.taskId?.trim() || undefined,
    evidenceRefs: normalizeList(input.evidenceRefs),
    requirementRefs: normalizeList(input.requirementRefs),
    planVersion: input.planVersion,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  validateReplanRequest(request);
  const requests = await loadReplanRequests(cwd);
  await writeReplanRequestIndex(cwd, [request, ...requests.filter((candidate) => candidate.id !== request.id)]);
  return request;
}

export function validateReplanRequest(request: ReplanRequest): void {
  if (!request.id.trim()) throw new Error("Replan request id is required.");
  if (!replanRequestStatuses.includes(request.status)) throw new Error(`Invalid replan request status: ${String(request.status)}`);
  if (!replanRequestTriggers.includes(request.trigger)) throw new Error(`Invalid replan request trigger: ${String(request.trigger)}`);
  if (!request.reason.trim()) throw new Error("Replan request reason is required.");
}

export function formatReplanRequests(requests: ReplanRequest[]): string {
  if (requests.length === 0) return "No replan requests.";
  const lines = ["Replan requests:"];
  for (const request of requests) {
    const task = request.taskId ? ` task=${request.taskId}` : "";
    const refs = request.requirementRefs && request.requirementRefs.length > 0 ? ` reqs=${request.requirementRefs.join(",")}` : "";
    const evidence = request.evidenceRefs && request.evidenceRefs.length > 0 ? ` evidence=${request.evidenceRefs.join(",")}` : "";
    lines.push(`- ${request.id}: ${request.status} trigger=${request.trigger}${task}${refs}${evidence} reason=${request.reason}`);
  }
  return lines.join("\n");
}

export async function saveReplanRequests(cwd: string, requests: ReplanRequest[]): Promise<void> {
  await writeReplanRequestIndex(cwd, requests);
}

export async function loadReplanDecisions(cwd: string): Promise<ReplanDecisionRecord[]> {
  try {
    const raw = await readFile(getReplanDecisionsPath(cwd), "utf8");
    return (JSON.parse(raw) as ReplanDecisionIndex).decisions;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function appendReplanDecision(cwd: string, decision: ReplanDecisionRecord): Promise<ReplanDecisionRecord> {
  await writeReplanDecisionIndex(cwd, [decision, ...(await loadReplanDecisions(cwd)).filter((current) => current.id !== decision.id)]);
  return decision;
}

export function formatReplanDecisions(decisions: ReplanDecisionRecord[]): string {
  if (decisions.length === 0) return "No replan decisions.";
  const lines = ["Replan decisions:"];
  for (const decision of decisions) {
    const snapshot = decision.snapshotPath ? ` snapshot=${decision.snapshotPath}` : "";
    lines.push(`- ${decision.id}: ${decision.status} previous=${decision.previousPlanVersion} proposed=${decision.proposedPlanVersion}${snapshot} summary=${decision.summary}`);
  }
  return lines.join("\n");
}

export async function createExecutionPlanSnapshot(
  cwd: string,
  input?: { plan?: ExecutionPlanArtifact; now?: Date },
): Promise<string> {
  const versionsDir = getExecutionPlanVersionsDir(cwd);
  await mkdir(versionsDir, { recursive: true });
  const next = await getNextPlanVersionNumber(versionsDir);
  const fileName = `PLAN-v${String(next).padStart(3, "0")}.json`;
  const plan = input?.plan ?? (await loadExecutionPlan(cwd));
  validateExecutionPlan(plan);
  const absolutePath = join(versionsDir, fileName);
  await writeFile(absolutePath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  return `.scaler/plans/versions/${fileName}`;
}

async function writePlanningReports(cwd: string, reports: PlanningReportRecord[]): Promise<void> {
  const path = getPlanningReportsPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ version: 1, reports } satisfies PlanningReportIndex, null, 2)}\n`, "utf8");
}

function normalizePlanningReportPlan(input: PlanningReportInput["plan"], timestamp: string): ExecutionPlanArtifact {
  return normalizeExecutionPlan({
    version: 1,
    planVersion: input.planVersion,
    status: input.status,
    title: input.title,
    source: input.source,
    tasks: input.tasks,
    createdAt: input.createdAt ?? timestamp,
    updatedAt: input.updatedAt ?? timestamp,
  }, new Date(timestamp));
}

function buildPlanTaskIdsByRequirement(plan: ExecutionPlanArtifact): Map<string, string[]> {
  const byRequirement = new Map<string, string[]>();
  for (const task of plan.tasks) {
    for (const requirementId of task.prdRefs ?? []) {
      byRequirement.set(requirementId, [...(byRequirement.get(requirementId) ?? []), task.id]);
    }
  }
  return byRequirement;
}

async function writeReplanRequestIndex(cwd: string, requests: ReplanRequest[]): Promise<void> {
  for (const request of requests) validateReplanRequest(request);
  await mkdir(getExecutionPlansDir(cwd), { recursive: true });
  await writeFile(getReplanRequestsPath(cwd), `${JSON.stringify({ version: 1, requests } satisfies ReplanRequestIndex, null, 2)}\n`, "utf8");
}

async function writeReplanDecisionIndex(cwd: string, decisions: ReplanDecisionRecord[]): Promise<void> {
  await mkdir(getExecutionPlansDir(cwd), { recursive: true });
  await writeFile(getReplanDecisionsPath(cwd), `${JSON.stringify({ version: 1, decisions } satisfies ReplanDecisionIndex, null, 2)}\n`, "utf8");
}

async function getNextPlanVersionNumber(versionsDir: string): Promise<number> {
  try {
    const files = await readdir(versionsDir);
    const numbers = files
      .map((file) => /^PLAN-v(\d+)\.json$/.exec(file)?.[1])
      .filter((value): value is string => Boolean(value))
      .map((value) => Number(value));
    return numbers.length === 0 ? 1 : Math.max(...numbers) + 1;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 1;
    throw error;
  }
}

function emptyPreservationCheck(ok: boolean): ExecutionPlanPreservationCheck {
  return {
    ok,
    preservedValidatedTaskIds: [],
    droppedValidatedTaskIds: [],
    preservedValidatedRequirementIds: [],
    droppedValidatedRequirementIds: [],
    unlinkedRequirementIds: [],
    planUnlinkedTaskIds: [],
  };
}

function normalizeExecutionPlan(plan: ExecutionPlanArtifact, now: Date): ExecutionPlanArtifact {
  return {
    ...plan,
    updatedAt: now.toISOString(),
    tasks: plan.tasks.map((task) => ({
      ...task,
      taskKind: normalizeOptionalString(task.taskKind),
      atomicityRationale: normalizeOptionalString(task.atomicityRationale),
      prdRefs: normalizeList(task.prdRefs),
      allowedPathPrefixes: normalizePathList(task.allowedPathPrefixes),
      dependsOn: normalizeList(task.dependsOn),
      definitionOfDone: normalizeList(task.definitionOfDone),
      validationRefs: normalizeList(task.validationRefs),
      outputPaths: normalizeOutputPaths(task.outputPaths),
      validationInputPaths: normalizeValidationInputPaths(task.validationInputPaths),
      validationCommands: task.validationCommands?.map((command) => ({ ...command, id: command.id.trim(), command: command.command.trim() })).filter((command) => command.id && command.command),
      qualityWaivers: task.qualityWaivers?.map((waiver) => ({ ...waiver, code: waiver.code.trim(), reason: waiver.reason.trim() })).filter((waiver) => waiver.code && waiver.reason),
    })),
  };
}

function normalizeList(values: string[] | undefined): string[] | undefined {
  const normalized = (values ?? []).map((value) => value.trim()).filter((value) => value.length > 0);
  return normalized.length > 0 ? [...new Set(normalized)] : undefined;
}

function normalizePathList(values: string[] | undefined): string[] | undefined {
  const normalized = (values ?? [])
    .map((value) => value.trim().replace(/^\.\//, "").replace(/\/$/, ""))
    .filter((value) => value.length > 0);
  return normalized.length > 0 ? [...new Set(normalized)] : undefined;
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

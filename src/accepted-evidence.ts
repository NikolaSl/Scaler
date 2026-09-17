/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import { checkAttemptEvidence } from "./attempt-evidence.js";
import { verifyCommittedOutputs } from "./committed-outputs.js";
import { fingerprintJson } from "./fingerprints.js";
import { loadCommitReports, loadCommitSkips, type CommitReportRecord, type CommitSkipRecord, type CommitValidationSummary } from "./git.js";
import { loadState } from "./state.js";
import type { ScalerState, ScalerTaskState } from "./types.js";
import { getValidationManifestForTask, loadValidationRuns, type ValidationRunRecord } from "./validation.js";
import { captureValidationSnapshot, verifyValidationRecordEvidence } from "./validation-acceptance.js";

export interface AcceptedEvidenceContext {
  durable: ScalerState;
  runs: ValidationRunRecord[];
  commits: CommitReportRecord[];
  skips: CommitSkipRecord[];
}

export async function loadAcceptedEvidenceContext(cwd: string): Promise<AcceptedEvidenceContext> {
  const [durable, runs, commits, skips] = await Promise.all([
    loadState(cwd), loadValidationRuns(cwd), loadCommitReports(cwd), loadCommitSkips(cwd),
  ]);
  return { durable, runs, commits, skips };
}

export async function verifyAcceptedTaskEvidence(
  cwd: string,
  state: ScalerState,
  taskId: string,
  context?: AcceptedEvidenceContext,
  subject = "Accepted task evidence",
): Promise<string[]> {
  context ??= await loadAcceptedEvidenceContext(cwd);
  if (context.durable.runId !== state.runId || context.durable.revision !== state.revision) {
    return [`${subject} rejected: state changed; reload before continuing.`];
  }
  const task = state.tasks.find((candidate) => candidate.id === taskId);
  if (!task || task.status !== "validated" || !state.validatedTaskIds.includes(taskId)) {
    return [`${subject} rejected: ${taskId} is not currently validated.`];
  }
  const run = context.runs.find((candidate) => candidate.taskId === taskId);
  const manifest = await getValidationManifestForTask(cwd, taskId);
  const errors = verifyValidationRecordEvidence(run, manifest);
  if (run?.receipt && errors.length === 0) {
    errors.push(...await checkAttemptEvidence(cwd, state, taskId));
    const { gitCandidateFingerprint: _historical, ...historical } = run.receipt.snapshot;
    const { gitCandidateFingerprint: _current, ...current } = await captureValidationSnapshot(cwd, state, taskId);
    if (fingerprintJson(historical) !== fingerprintJson(current)) {
      errors.push(`${subject} rejected: run, task, attempt, policy, context or declared output changed.`);
    }
    const committed = context.commits.find((commit) => commit.taskId === taskId && commit.commitHash.trim()
      && matchesValidation(commit.validation, run));
    const skipped = context.skips.some((skip) => skip.taskId === taskId && skip.status === "skipped"
      && skip.reason.trim() && matchesValidation(skip.validation, run));
    if (!committed && !skipped) errors.push(`${subject} rejected: no matching accepted Git commit or reasoned skip.`);
    if (!committed && skipped && manifest.outputPaths === undefined) {
      errors.push(`${subject} rejected: skipped task has unknown filesystem output coverage; declare outputPaths in its validation manifest and revalidate. Use [] only for work with no filesystem outputs.`);
    }
    if (committed) errors.push(...await verifyCommittedOutputs(cwd, committed));
  }
  return errors;
}

export async function verifyTaskDependenciesAccepted(
  cwd: string,
  state: ScalerState,
  task: ScalerTaskState,
): Promise<string[]> {
  const dependencyIds = task.dependsOn ?? [];
  if (dependencyIds.length === 0) return [];
  const context = await loadAcceptedEvidenceContext(cwd);
  const diagnostics: string[] = [];
  for (const dependencyId of dependencyIds) {
    const errors = await verifyAcceptedTaskEvidence(cwd, state, dependencyId, context, "Evidence");
    diagnostics.push(...errors.map((error) => `Dependency ${dependencyId}: ${error}`));
  }
  return diagnostics;
}

function matchesValidation(summary: CommitValidationSummary, run: ValidationRunRecord): boolean {
  return summary.runId === run.id && summary.status === "passed"
    && summary.commandCount === run.commandRuns.length
    && summary.createdAt === run.createdAt;
}

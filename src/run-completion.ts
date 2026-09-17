/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import { checkAttemptEvidence } from "./attempt-evidence.js";
import { fingerprintJson } from "./fingerprints.js";
import { loadCommitReports, loadCommitSkips, type CommitValidationSummary } from "./git.js";
import { acquireExecutionLock, releaseExecutionLock } from "./locks.js";
import { loadState, saveState } from "./state.js";
import { transitionStage } from "./supervisor.js";
import type { ScalerState } from "./types.js";
import { getValidationManifestForTask, loadValidationRuns, type ValidationRunRecord } from "./validation.js";
import { captureValidationSnapshot, verifyValidationRecordEvidence } from "./validation-acceptance.js";

// Provenance is necessary, not sufficient for final integrated correctness.
// Historical candidates precede task commits; comparing all of them to current
// HEAD would invalidate legitimate multi-task work. Artifact freshness is separate.
async function verifyCompletionProvenance(cwd: string, state: ScalerState): Promise<string[]> {
  const durable = await loadState(cwd);
  if (durable.runId !== state.runId || durable.revision !== state.revision) {
    return ["Completion evidence rejected: state changed; reload before completion."];
  }
  if (!state.tasks.length || state.tasks.some((task) => task.status !== "validated")
    || new Set(state.tasks.map((task) => task.id)).size !== state.tasks.length) {
    return ["Completion evidence rejected: a nonempty set of distinct validated tasks is required."];
  }
  const runs = await loadValidationRuns(cwd);
  const commits = await loadCommitReports(cwd);
  const skips = await loadCommitSkips(cwd);
  const diagnostics: string[] = [];
  for (const task of state.tasks) {
    // Ledgers are newest-first: a newer failed/blocked run must not fall back to
    // an older green result, even if the task label still says validated.
    const run = runs.find((candidate) => candidate.taskId === task.id);
    const errors = verifyValidationRecordEvidence(run, await getValidationManifestForTask(cwd, task.id));
    if (run?.receipt && errors.length === 0) {
      errors.push(...await checkAttemptEvidence(cwd, state, task.id));
      const { gitCandidateFingerprint: _historical, ...historical } = run.receipt.snapshot;
      const { gitCandidateFingerprint: _current, ...current } = await captureValidationSnapshot(cwd, state, task.id);
      if (fingerprintJson(historical) !== fingerprintJson(current)) {
        errors.push("Completion evidence rejected: run, task, attempt, policy or context changed.");
      }
      const committed = commits.some((commit) => commit.taskId === task.id && commit.commitHash.trim()
        && matchesValidation(commit.validation, run));
      const skipped = skips.some((skip) => skip.taskId === task.id && skip.status === "skipped"
        && skip.reason.trim() && matchesValidation(skip.validation, run));
      if (!committed && !skipped) errors.push("Completion evidence rejected: no matching accepted Git commit or reasoned skip.");
    }
    diagnostics.push(...errors.map((error) => `${task.id}: ${error}`));
  }
  return diagnostics;
}

function matchesValidation(summary: CommitValidationSummary, run: ValidationRunRecord): boolean {
  // The full result and required commands were checked above. Historical summary
  // producers classify declared skips differently in failedCommandIds; that
  // redundant list is not acceptance authority.
  return summary.runId === run.id && summary.status === "passed"
    && summary.commandCount === run.commandRuns.length
    && summary.createdAt === run.createdAt;
}

export interface RunCompletionResult {
  accepted: boolean;
  state: ScalerState;
  message: string;
}

// Both publication and verification of loaded completed state use the same
// execution lock as validation/commit. A caller cannot supply proof or bypass flags.
export async function completeRunWithEvidence(cwd: string, state: ScalerState, now = new Date()): Promise<RunCompletionResult> {
  const lock = await acquireExecutionLock(cwd, { operation: "complete", reason: "Verify run completion evidence." });
  if (!lock.acquired) return { accepted: false, state, message: lock.message };
  try {
    if (state.stage !== "execution" && state.stage !== "completed") {
      return { accepted: false, state, message: `Cannot complete run from ${state.stage}.` };
    }
    const diagnostics = await verifyCompletionProvenance(cwd, state);
    if (diagnostics.length) return { accepted: false, state, message: diagnostics.join("\n") };
    const next = state.stage === "completed" ? state : transitionStage(state, "completed", {
      reason: "All planned tasks have matching validation and Git acceptance provenance.", now,
    });
    if (state.stage !== "completed") await saveState(cwd, next);
    return { accepted: next.stage === "completed", state: next, message: next.stage === "completed"
      ? "Run completion provenance verified for all planned tasks."
      : "Completion rejected by supervisor state invariants." };
  } catch (error) {
    return { accepted: false, state, message: `Completion evidence unavailable: ${String(error)}` };
  } finally {
    await releaseExecutionLock(cwd, lock.lock.id);
  }
}

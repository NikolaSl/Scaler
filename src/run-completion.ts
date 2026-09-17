/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import { loadAcceptedEvidenceContext, verifyAcceptedTaskEvidence } from "./accepted-evidence.js";
import { acquireExecutionLock, releaseExecutionLock } from "./locks.js";
import { computePrdCoverageSummary, loadPrdCoverage, loadPrdRequirements } from "./prd.js";
import { loadState, saveState } from "./state.js";
import { transitionStage } from "./supervisor.js";
import type { ScalerState } from "./types.js";
import { getValidationManifestForTask } from "./validation.js";

// Provenance is necessary, not sufficient for final integrated correctness.
// Historical candidates precede task commits; comparing all of them to current
// HEAD would invalidate legitimate multi-task work. Committed outputs are checked
// against their accepted commit. Declared filesystem outputs are checked for
// every acceptance kind; completeness of that declaration remains separate.
async function verifyCompletionProvenance(cwd: string, state: ScalerState): Promise<string[]> {
  const durable = await loadState(cwd);
  if (durable.runId !== state.runId || durable.revision !== state.revision) {
    return ["Completion evidence rejected: state changed; reload before completion."];
  }
  if (!state.tasks.length || state.tasks.some((task) => task.status !== "validated")
    || new Set(state.tasks.map((task) => task.id)).size !== state.tasks.length) {
    return ["Completion evidence rejected: a nonempty set of distinct validated tasks is required."];
  }
  const requirements = await loadPrdRequirements(cwd);
  if (requirements.requirements.length > 0) {
    const coverage = computePrdCoverageSummary(requirements, await loadPrdCoverage(cwd), state);
    const currentTaskIds = new Set(state.tasks.map((task) => task.id));
    const diagnostics = coverage.entries.flatMap((entry) => {
      if (entry.linkedTaskIds.length === 0) {
        return [`${entry.requirementId}: Completion evidence rejected: no linked task in current state.`];
      }
      const missingTaskIds = entry.linkedTaskIds.filter((taskId) => !currentTaskIds.has(taskId));
      if (missingTaskIds.length > 0) {
        return [`${entry.requirementId}: Completion evidence rejected: linked task is not current: ${missingTaskIds.join(", ")}.`];
      }
      if (entry.status !== "validated") {
        return [`${entry.requirementId}: Completion evidence rejected: current requirement coverage is ${entry.status}, not validated.`];
      }
      return [];
    });
    if (diagnostics.length > 0) return diagnostics;
  }
  const context = await loadAcceptedEvidenceContext(cwd);
  const diagnostics: string[] = [];
  for (const task of state.tasks) {
    const errors = await verifyAcceptedTaskEvidence(cwd, state, task.id, context, "Completion evidence");
    diagnostics.push(...errors.map((error) => `${task.id}: ${error}`));
  }
  diagnostics.push(...await verifyRequirementIntegrationCriteria(cwd, state, requirements, context));
  return diagnostics;
}

async function verifyRequirementIntegrationCriteria(
  cwd: string,
  state: ScalerState,
  requirements: Awaited<ReturnType<typeof loadPrdRequirements>>,
  context: Awaited<ReturnType<typeof loadAcceptedEvidenceContext>>,
): Promise<string[]> {
  const diagnostics: string[] = [];
  const currentTaskIds = new Set(state.tasks.map((task) => task.id));
  const coverage = computePrdCoverageSummary(requirements, await loadPrdCoverage(cwd), state);
  for (const requirement of requirements.requirements) {
    const linkedTaskIds = new Set(coverage.entries.find((entry) => entry.requirementId === requirement.id)?.linkedTaskIds ?? []);
    for (const criterion of requirement.acceptanceCriteria ?? []) {
      const subject = `${requirement.id}/${criterion.id}`;
      const referencedTaskIds = [...new Set([criterion.validationTaskId, ...criterion.participantTaskIds])];
      const missingTaskIds = referencedTaskIds.filter((taskId) => !currentTaskIds.has(taskId));
      if (missingTaskIds.length > 0) {
        diagnostics.push(`${subject}: Integration evidence rejected: task is not current: ${missingTaskIds.join(", ")}.`);
        continue;
      }
      const unlinkedTaskIds = referencedTaskIds.filter((taskId) => !linkedTaskIds.has(taskId));
      if (unlinkedTaskIds.length > 0) {
        diagnostics.push(`${subject}: Integration evidence rejected: task is not linked to the requirement: ${unlinkedTaskIds.join(", ")}.`);
        continue;
      }
      const manifest = await getValidationManifestForTask(cwd, criterion.validationTaskId);
      const commands = manifest.commands.filter((command) => command.id === criterion.commandId);
      if (commands.length !== 1 || !commands[0]!.required || commands[0]!.disposition === "skipped"
        || commands[0]!.disposition === "blocked") {
        diagnostics.push(`${subject}: Integration evidence rejected: ${criterion.validationTaskId}/${criterion.commandId} must name one required runnable command.`);
        continue;
      }
      const run = context.runs.find((candidate) => candidate.taskId === criterion.validationTaskId);
      const evidence = run?.commandRuns.filter((command) => command.commandId === criterion.commandId
        && command.command === commands[0]!.command && command.required && command.status === "passed") ?? [];
      if (run?.status !== "passed" || evidence.length !== 1) {
        diagnostics.push(`${subject}: Integration evidence rejected: named command has no current passing evidence.`);
      }
    }
  }
  return diagnostics;
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

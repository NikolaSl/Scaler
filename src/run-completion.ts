/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import { loadAcceptedEvidenceContext, verifyAcceptedTaskEvidence } from "./accepted-evidence.js";
import { acquireExecutionLock, releaseExecutionLock } from "./locks.js";
import { loadState, saveState } from "./state.js";
import { transitionStage } from "./supervisor.js";
import type { ScalerState } from "./types.js";

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
  const context = await loadAcceptedEvidenceContext(cwd);
  const diagnostics: string[] = [];
  for (const task of state.tasks) {
    const errors = await verifyAcceptedTaskEvidence(cwd, state, task.id, context, "Completion evidence");
    diagnostics.push(...errors.map((error) => `${task.id}: ${error}`));
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

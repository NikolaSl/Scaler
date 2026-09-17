/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import { fingerprintTaskContract, fingerprintTaskReportOutput, fingerprintValidationPolicy } from "./attempt-identity.js";
import { loadTaskContextManifest, resolveTaskContextManifest } from "./context.js";
import { fingerprintJson } from "./fingerprints.js";
import { loadTaskAttempts, taskAttemptBinding } from "./task-attempts.js";
import { loadTaskAgentReports } from "./task-reports.js";
import { loadState } from "./state.js";
import type { ScalerState } from "./types.js";
import { getValidationManifestForTask } from "./validation.js";

// The admitted input fingerprint never changes. This separate handoff snapshot
// detects later context edits without mistaking the worker's intended edits for
// a change to its original prompt. Runtime status/budget/timestamps are excluded.
export async function captureValidationContext(cwd: string, state: ScalerState, taskId: string): Promise<string> {
  const manifest = await loadTaskContextManifest(cwd, taskId);
  if (!manifest) return fingerprintJson({ taskId, manifest: null });
  const items = await resolveTaskContextManifest(cwd, state, manifest);
  const sources = [];
  for (let index = 0; index < manifest.items.length; index++) {
    const entry = manifest.items[index]!;
    let content: string | null = items[index]!.content;
    if (entry.source === "state") content = null;
    if (entry.source === "task") {
      const task = state.tasks.find((task) => task.id === (entry.taskId ?? taskId));
      content = task ? fingerprintTaskContract(task) : null;
    }
    if (entry.source === "validation_manifest") {
      content = fingerprintValidationPolicy(await getValidationManifestForTask(cwd, entry.taskId ?? taskId));
    }
    sources.push({
      id: entry.id, type: entry.type, reason: entry.reason,
      priority: entry.priority, scope: entry.scope, exactness: entry.exactness ?? null,
      source: entry.source, path: entry.path ?? null, memoryId: entry.memoryId ?? null,
      taskId: entry.taskId ?? null, content,
    });
  }
  return fingerprintJson({ taskId, tokenBudget: manifest.tokenBudget ?? null, sources });
}

// This guard covers attempt-backed evidence. Migrating manual, legacy and hook
// acceptance routes to a single authority remains P2.3, not an implicit upgrade.
export async function checkAttemptEvidence(cwd: string, state: ScalerState, taskId: string): Promise<string[]> {
  const task = state.tasks.find((task) => task.id === taskId);
  const attempts = (await loadTaskAttempts(cwd)).filter((attempt) => attempt.runId === state.runId && attempt.taskId === taskId);
  if (!task?.attemptId && attempts.length === 0) return [];
  const durable = await loadState(cwd);
  if (durable.runId !== state.runId || durable.revision !== state.revision) {
    return ["Validation evidence rejected: state changed; reload before validation."];
  }
  const attempt = attempts.find((attempt) => attempt.id === task?.attemptId);
  if (!attempt || attempts[0]?.id !== attempt.id || attempt.status !== "completed" || attempt.outcome !== "succeeded") {
    return ["Validation evidence rejected: no current completed task attempt."];
  }
  const diagnostics: string[] = [];
  if (!task || fingerprintTaskContract(task) !== attempt.taskFingerprint) diagnostics.push("Validation evidence rejected: task contract changed.");
  if (fingerprintValidationPolicy(await getValidationManifestForTask(cwd, taskId)) !== attempt.validationPolicyFingerprint) {
    diagnostics.push("Validation evidence rejected: validation policy changed.");
  }
  if (!attempt.validationContextFingerprint
    || await captureValidationContext(cwd, state, taskId) !== attempt.validationContextFingerprint) {
    diagnostics.push("Validation evidence rejected: handoff context changed or has no freshness snapshot.");
  }
  const report = (await loadTaskAgentReports(cwd)).find((report) => report.id === attempt.reportId && report.attemptId === attempt.id);
  if (!report || Object.entries(taskAttemptBinding(attempt)).some(([key, value]) => report[key as keyof typeof report] !== value)
    || report.outputFingerprint !== attempt.outputFingerprint
    || fingerprintTaskReportOutput(report) !== attempt.outputFingerprint) {
    diagnostics.push("Validation evidence rejected: task report identity or output fingerprint changed.");
  }
  return diagnostics;
}

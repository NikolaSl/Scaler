/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import { fingerprintJson } from "./fingerprints.js";
import type { ContextItem, ResolvedContext } from "./context.js";
import type { TaskAgentReportInput } from "./task-reports.js";
import type { ScalerTaskState } from "./types.js";
import type { TaskValidationManifest } from "./validation.js";

export function fingerprintTaskContract(task: ScalerTaskState): string {
  return fingerprintJson({
    id: task.id,
    title: task.title ?? null,
    taskKind: task.taskKind ?? null,
    atomicityRationale: task.atomicityRationale ?? null,
    allowedPathPrefixes: task.allowedPathPrefixes ?? [],
    dependsOn: task.dependsOn ?? [],
    prdRefs: task.prdRefs ?? [],
    definitionOfDone: task.definitionOfDone ?? [],
    validationRefs: task.validationRefs ?? [],
    qualityWaivers: (task.qualityWaivers ?? []).map((waiver) => ({
      code: waiver.code,
      reason: waiver.reason,
      evidenceRefs: waiver.evidenceRefs ?? [],
      approvedBy: waiver.approvedBy ?? null,
    })),
  });
}

export function fingerprintAdmittedInput(taskFingerprint: string, context: ResolvedContext): string {
  return fingerprintJson({
    taskFingerprint,
    included: context.included.map(contextItemMaterial),
    omitted: context.omitted.map(contextItemMaterial),
    renderedContext: context.text,
  });
}

function contextItemMaterial(item: ContextItem): Record<string, unknown> {
  return {
    id: item.id,
    type: item.type,
    reason: item.reason,
    content: item.content,
    priority: item.priority,
    scope: item.scope,
    exactness: item.exactness ?? null,
  };
}

export function fingerprintTaskRoute(model: string | undefined, tools: string[]): string {
  return fingerprintJson({
    model: model?.trim() || "provider-default",
    tools: Array.from(new Set(tools.map((tool) => tool.trim()).filter(Boolean))).sort(),
  });
}

export function fingerprintValidationPolicy(manifest: TaskValidationManifest): string {
  return fingerprintJson({
    taskId: manifest.taskId,
    revision: manifest.revision ?? 1,
    outputPaths: manifest.outputPaths ?? null,
    definitionOfDone: manifest.definitionOfDone ?? [],
    acceptanceCriteria: manifest.acceptanceCriteria ?? [],
    qualityWaivers: (manifest.qualityWaivers ?? []).map((waiver) => ({
      code: waiver.code,
      reason: waiver.reason,
      evidenceRefs: waiver.evidenceRefs ?? [],
      approvedBy: waiver.approvedBy ?? null,
    })),
    commands: manifest.commands.map((command) => ({
      id: command.id,
      command: command.command,
      description: command.description ?? null,
      timeoutMs: command.timeoutMs ?? null,
      required: command.required,
      gate: command.gate ?? null,
      expectedResult: command.expectedResult ?? null,
      evidenceRefs: command.evidenceRefs ?? [],
      environment: command.environment ?? null,
      disposition: command.disposition ?? null,
      dispositionReason: command.dispositionReason ?? null,
    })),
  });
}

export function fingerprintTaskReportOutput(report: TaskAgentReportInput): string {
  return fingerprintJson({
    taskId: report.taskId ?? null,
    status: report.status ?? null,
    summary: report.summary ?? null,
    outputs: report.outputs === undefined ? null : report.outputs,
    artifacts: report.artifacts ?? [],
    changedFiles: report.changedFiles ?? [],
    memoryRefs: report.memoryRefs ?? [],
    validations: (report.validations ?? []).map((validation) => ({
      id: validation.id ?? null,
      command: validation.command ?? null,
      status: validation.status ?? null,
      summary: validation.summary ?? null,
      evidenceRefs: validation.evidenceRefs ?? [],
    })),
    validationRefs: report.validationRefs ?? [],
    evidenceRefs: report.evidenceRefs ?? [],
    blockers: report.blockers ?? [],
    missingData: report.missingData ?? [],
    recommendedNextAction: report.recommendedNextAction ?? null,
  });
}

/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import { appendLogEvent, createLogEvent } from "./logging.js";
import { fingerprintTaskContract } from "./attempt-identity.js";
import { isScalerTaskStatus } from "./reports.js";
import { assertStateSnapshotCurrent, saveState } from "./state.js";
import { normalizeOutputPaths, normalizeValidationInputPaths } from "./output-artifacts.js";
import { reviewTaskDefinition, normalizeTaskKind, normalizeTaskQualityWaivers, type TaskDefinitionReviewRecord, type TaskQualityEnforcementMode, type TaskQualityWaiverInput } from "./task-quality.js";
import { addTask, transitionTask } from "./supervisor.js";
import type { ScalerState, ScalerTaskKind, ScalerTaskStatus } from "./types.js";
import { assertValidationPolicyMutationAuthorized, getValidationManifestForTask, hasValidationRunForTask, saveValidationManifest, withValidationPolicyLock, type EmbeddedValidationManifestCommandInput, type ValidationPolicyAuthority } from "./validation.js";

export interface CreateTaskInput {
  id: string;
  outputPaths?: string[];
  validationInputPaths?: string[];
  title?: string;
  status?: ScalerTaskStatus | string;
  taskKind?: ScalerTaskKind | string;
  atomicityRationale?: string;
  allowedPathPrefixes?: string[];
  dependsOn?: string[];
  prdRefs?: string[];
  definitionOfDone?: string[];
  validationRefs?: string[];
  validationCommands?: EmbeddedValidationManifestCommandInput[];
  qualityWaivers?: TaskQualityWaiverInput[];
  qualityMode?: TaskQualityEnforcementMode;
}

export interface CreateTaskResult {
  state: ScalerState;
  accepted: boolean;
  message: string;
  qualityReview?: TaskDefinitionReviewRecord;
}

export interface UpdateTaskInput {
  id: string;
  outputPaths?: string[];
  validationInputPaths?: string[];
  title?: string;
  status?: ScalerTaskStatus | string;
  taskKind?: ScalerTaskKind | string;
  atomicityRationale?: string;
  allowedPathPrefixes?: string[];
  dependsOn?: string[];
  prdRefs?: string[];
  definitionOfDone?: string[];
  validationRefs?: string[];
  validationCommands?: EmbeddedValidationManifestCommandInput[];
  qualityWaivers?: TaskQualityWaiverInput[];
  qualityMode?: TaskQualityEnforcementMode;
  acceptanceAuthority?: ValidationPolicyAuthority;
}

export interface UpdateTaskResult {
  state: ScalerState;
  accepted: boolean;
  message: string;
  qualityReview?: TaskDefinitionReviewRecord;
}

export interface RetryTaskResult {
  state: ScalerState;
  accepted: boolean;
  message: string;
}

export function formatTaskList(state: ScalerState): string {
  if (state.tasks.length === 0) return "No Scaler tasks.";

  const lines = ["Scaler tasks:"];
  for (const task of state.tasks) {
    const current = task.id === state.currentTaskId ? " *current*" : "";
    const title = task.title ? ` - ${task.title}` : "";
    const paths = task.allowedPathPrefixes && task.allowedPathPrefixes.length > 0 ? ` [paths: ${task.allowedPathPrefixes.join(", ")}]` : "";
    const deps = task.dependsOn && task.dependsOn.length > 0 ? ` [depends: ${task.dependsOn.join(", ")}]` : "";
    const prdRefs = task.prdRefs && task.prdRefs.length > 0 ? ` [prd: ${task.prdRefs.join(", ")}]` : "";
    const dod = task.definitionOfDone && task.definitionOfDone.length > 0 ? ` [dod: ${task.definitionOfDone.length}]` : " [dod: missing]";
    lines.push(`- ${task.id}: ${task.status}${current}${title}${paths}${deps}${prdRefs}${dod}`);
  }
  return lines.join("\n");
}

export async function retryTask(cwd: string, state: ScalerState, taskId: string, reason = "Task retry requested."): Promise<RetryTaskResult> {
  const task = state.tasks.find((candidate) => candidate.id === taskId);
  if (!task) {
    const message = `Task retry rejected: ${taskId} does not exist`;
    await appendLogEvent(cwd, createLogEvent(state, { eventType: "state", summary: message, taskId, details: { reason } }));
    return { state, accepted: false, message };
  }

  const targetStatus = getRetryTargetStatus(task.status);
  if (!targetStatus) {
    const message = `Task retry rejected: ${taskId} cannot retry from ${task.status}`;
    await appendLogEvent(cwd, createLogEvent(state, { eventType: "state", summary: message, taskId, details: { reason } }));
    return { state, accepted: false, message };
  }

  const beforeRejected = state.rejectedTransitions.length;
  const nextState = transitionTask(state, taskId, targetStatus, { reason });
  const accepted = nextState.rejectedTransitions.length === beforeRejected;
  await saveState(cwd, nextState);
  const message = accepted ? `Task retry accepted: ${taskId} -> ${targetStatus}` : `Task retry rejected: ${taskId}`;
  await appendLogEvent(cwd, createLogEvent(nextState, { eventType: "state", summary: message, taskId, details: { reason, targetStatus } }));
  return { state: nextState, accepted, message };
}

export async function updateTask(cwd: string, state: ScalerState, input: UpdateTaskInput): Promise<UpdateTaskResult> {
  return withValidationPolicyLock(cwd, () => updateTaskLocked(cwd, state, input));
}

async function updateTaskLocked(cwd: string, state: ScalerState, input: UpdateTaskInput): Promise<UpdateTaskResult> {
  await assertStateSnapshotCurrent(cwd, state);
  const outputPaths = normalizeOutputPaths(input.outputPaths);
  const validationInputPaths = normalizeValidationInputPaths(input.validationInputPaths);
  const existing = state.tasks.find((task) => task.id === input.id);
  if (!existing) {
    const message = `Task update rejected: ${input.id} does not exist`;
    await appendLogEvent(cwd, createLogEvent(state, { eventType: "state", summary: message, taskId: input.id, details: input }));
    return { state, accepted: false, message };
  }

  const acceptanceAuthority = input.acceptanceAuthority ?? "system";
  const policyRejection = await reviewTaskAcceptancePolicyMutation(cwd, existing, input);
  if (policyRejection) {
    await appendLogEvent(cwd, createLogEvent(state, { eventType: "state", summary: policyRejection, taskId: input.id, details: input }));
    return { state, accepted: false, message: policyRejection };
  }

  let nextState = state;
  if (input.status !== undefined) {
    if (!isScalerTaskStatus(input.status)) {
      const message = `Task update rejected: invalid status ${String(input.status)}`;
      await appendLogEvent(cwd, createLogEvent(state, { eventType: "state", summary: message, taskId: input.id, details: input }));
      return { state, accepted: false, message };
    }

    const beforeRejected = nextState.rejectedTransitions.length;
    nextState = transitionTask(nextState, input.id, input.status, { reason: "Task metadata update requested." });
    if (nextState.rejectedTransitions.length !== beforeRejected) {
      await saveState(cwd, nextState);
      const message = `Task update rejected: invalid transition ${existing.status} -> ${input.status}`;
      await appendLogEvent(cwd, createLogEvent(nextState, { eventType: "state", summary: message, taskId: input.id, details: input }));
      return { state: nextState, accepted: false, message };
    }
  }

  // Keep invalid-transition diagnostics above, but do not publish the proposed
  // transition or metadata when the request would grant/retain acceptance.
  if (input.status === "validated" || existing.status === "validated") {
    const message = existing.status === "validated"
      ? `Task update rejected: ${input.id} is already validated; use explicit replanning/replacement instead of rewriting accepted metadata.`
      : `Task update rejected: ${input.id} acceptance requires the dedicated validation path.`;
    await appendLogEvent(cwd, createLogEvent(state, { eventType: "state", summary: message, taskId: input.id, details: input }));
    return { state, accepted: false, message };
  }

  const timestamp = new Date().toISOString();
  nextState = {
    ...nextState,
    tasks: nextState.tasks.map((task) =>
      task.id === input.id
        ? {
            ...task,
            title: input.title ?? task.title,
            taskKind: input.taskKind !== undefined ? normalizeTaskKind(input.taskKind) : task.taskKind,
            atomicityRationale: input.atomicityRationale !== undefined ? normalizeOptionalString(input.atomicityRationale) : task.atomicityRationale,
            allowedPathPrefixes: input.allowedPathPrefixes ? normalizeAllowedPaths(input.allowedPathPrefixes) : task.allowedPathPrefixes,
            dependsOn: input.dependsOn ? normalizeIdList(input.dependsOn) : task.dependsOn,
            prdRefs: input.prdRefs ? normalizeIdList(input.prdRefs) : task.prdRefs,
            definitionOfDone: input.definitionOfDone ? normalizeDefinitionOfDone(input.definitionOfDone) : task.definitionOfDone,
            validationRefs: input.validationRefs ? normalizeIdList(input.validationRefs) : task.validationRefs,
            qualityWaivers: input.qualityWaivers ? normalizeTaskQualityWaivers(input.qualityWaivers) : task.qualityWaivers,
            updatedAt: timestamp,
          }
        : task,
    ),
    updatedAt: timestamp,
  };

  const qualityMode = input.qualityMode ?? "warn";
  if (qualityMode === "enforce") {
    const enforcementReview = await reviewTaskDefinition(cwd, nextState, input.id, new Date(), {
      enforcement: "enforce",
      supplementalValidationCommands: input.validationCommands,
    });
    if (enforcementReview.status === "blocked") {
      const message = `Task update rejected: ${input.id} quality blocked (${enforcementReview.warnings.map((warning) => warning.code).join(",")})`;
      await appendLogEvent(cwd, createLogEvent(state, { eventType: "state", summary: message, taskId: input.id, details: { input, qualityReview: enforcementReview } }));
      return { state, accepted: false, message, qualityReview: enforcementReview };
    }
  }

  await persistTaskValidationCommands(cwd, input.id, input.validationCommands, nextState.tasks.find((task) => task.id === input.id)?.definitionOfDone, outputPaths, validationInputPaths, acceptanceAuthority);
  await saveState(cwd, nextState);
  const qualityReview = await reviewTaskDefinition(cwd, nextState, input.id, new Date(), { enforcement: qualityMode });
  await appendLogEvent(
    cwd,
    createLogEvent(nextState, { eventType: "state", summary: `Task updated: ${input.id}`, taskId: input.id, details: { input, qualityReview } }),
  );
  const warningSuffix = qualityReview.warnings.length > 0 ? ` warnings=${qualityReview.warnings.length}` : "";
  return { state: nextState, accepted: true, message: `Task updated: ${input.id}${warningSuffix}`, qualityReview };
}

export async function reviewTaskAcceptancePolicyMutation(
  cwd: string,
  existing: ScalerState["tasks"][number],
  input: UpdateTaskInput,
): Promise<string | undefined> {
  const authority = input.acceptanceAuthority ?? "system";
  if (authority !== "model") return undefined;
  const exercised = await hasValidationRunForTask(cwd, input.id);
  const proposedTask = {
    ...existing,
    title: input.title ?? existing.title,
    taskKind: input.taskKind !== undefined ? normalizeTaskKind(input.taskKind) : existing.taskKind,
    atomicityRationale: input.atomicityRationale !== undefined ? normalizeOptionalString(input.atomicityRationale) : existing.atomicityRationale,
    allowedPathPrefixes: input.allowedPathPrefixes ? normalizeAllowedPaths(input.allowedPathPrefixes) : existing.allowedPathPrefixes,
    dependsOn: input.dependsOn ? normalizeIdList(input.dependsOn) : existing.dependsOn,
    prdRefs: input.prdRefs ? normalizeIdList(input.prdRefs) : existing.prdRefs,
    definitionOfDone: input.definitionOfDone ? normalizeDefinitionOfDone(input.definitionOfDone) : existing.definitionOfDone,
    validationRefs: input.validationRefs ? normalizeIdList(input.validationRefs) : existing.validationRefs,
    qualityWaivers: input.qualityWaivers ? normalizeTaskQualityWaivers(input.qualityWaivers) : existing.qualityWaivers,
  };
  if (exercised && fingerprintTaskContract(proposedTask) !== fingerprintTaskContract(existing)) {
    return `Acceptance policy update rejected for ${input.id}: model routes cannot replace an exercised task contract; use an explicit local user command.`;
  }
  if (input.validationCommands !== undefined || input.outputPaths !== undefined || input.validationInputPaths !== undefined) {
    const manifest = await getValidationManifestForTask(cwd, input.id);
    try {
      await assertValidationPolicyMutationAuthorized(cwd, {
        ...manifest,
        outputPaths: normalizeOutputPaths(input.outputPaths) ?? manifest.outputPaths,
        validationInputPaths: normalizeValidationInputPaths(input.validationInputPaths) ?? manifest.validationInputPaths,
        definitionOfDone: proposedTask.definitionOfDone ?? manifest.definitionOfDone,
        commands: input.validationCommands?.length
          ? input.validationCommands.map((command) => ({ ...command, required: command.required ?? true }))
          : manifest.commands,
      }, { authority });
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }
  return undefined;
}

export async function createTask(cwd: string, state: ScalerState, input: CreateTaskInput): Promise<CreateTaskResult> {
  const outputPaths = normalizeOutputPaths(input.outputPaths);
  const validationInputPaths = normalizeValidationInputPaths(input.validationInputPaths);
  const status = input.status ?? "pending";
  if (status === "validated") {
    const message = `Task create rejected: ${input.id} acceptance requires the dedicated validation path; create an unvalidated task first.`;
    await appendLogEvent(cwd, createLogEvent(state, { eventType: "state", summary: message, taskId: input.id, details: input }));
    return { state, accepted: false, message };
  }
  if (!isScalerTaskStatus(status)) {
    await appendLogEvent(
      cwd,
      createLogEvent(state, {
        eventType: "state",
        summary: `Task create rejected: invalid status ${String(status)}`,
        taskId: input.id,
        details: input,
      }),
    );
    return {
      state,
      accepted: false,
      message: `Task create rejected: invalid status ${String(status)}`,
    };
  }

  const beforeRejected = state.rejectedTransitions.length;
  const nextState = addTask(state, {
    id: input.id,
    title: input.title,
    status,
    taskKind: normalizeTaskKind(input.taskKind),
    atomicityRationale: normalizeOptionalString(input.atomicityRationale),
    allowedPathPrefixes: normalizeAllowedPaths(input.allowedPathPrefixes),
    dependsOn: normalizeIdList(input.dependsOn),
    prdRefs: normalizeIdList(input.prdRefs),
    definitionOfDone: normalizeDefinitionOfDone(input.definitionOfDone),
    validationRefs: normalizeIdList(input.validationRefs),
    qualityWaivers: normalizeTaskQualityWaivers(input.qualityWaivers),
  });
  const accepted = nextState.rejectedTransitions.length === beforeRejected;
  if (!accepted) {
    await saveState(cwd, nextState);
    await appendLogEvent(
      cwd,
      createLogEvent(nextState, {
        eventType: "state",
        summary: `Task create rejected: ${input.id}`,
        taskId: input.id,
        details: { input },
      }),
    );
    return { state: nextState, accepted: false, message: `Task create rejected: ${input.id}` };
  }

  const qualityMode = input.qualityMode ?? "warn";
  if (qualityMode === "enforce") {
    const enforcementReview = await reviewTaskDefinition(cwd, nextState, input.id, new Date(), {
      enforcement: "enforce",
      supplementalValidationCommands: input.validationCommands,
      supplementalValidationRefs: input.validationRefs,
    });
    if (enforcementReview.status === "blocked") {
      const message = `Task create rejected: ${input.id} quality blocked (${enforcementReview.warnings.map((warning) => warning.code).join(",")})`;
      await appendLogEvent(cwd, createLogEvent(state, { eventType: "state", summary: message, taskId: input.id, details: { input, qualityReview: enforcementReview } }));
      return { state, accepted: false, message, qualityReview: enforcementReview };
    }
  }

  await persistTaskValidationCommands(cwd, input.id, input.validationCommands, nextState.tasks.find((task) => task.id === input.id)?.definitionOfDone, outputPaths, validationInputPaths);
  await saveState(cwd, nextState);
  const qualityReview = await reviewTaskDefinition(cwd, nextState, input.id, new Date(), { enforcement: qualityMode });
  await appendLogEvent(
    cwd,
    createLogEvent(nextState, {
      eventType: "state",
      summary: `Task created: ${input.id}`,
      taskId: input.id,
      details: { input, qualityReview },
    }),
  );

  const warningSuffix = qualityReview && qualityReview.warnings.length > 0 ? ` warnings=${qualityReview.warnings.length}` : "";
  return {
    state: nextState,
    accepted: true,
    message: `Task created: ${input.id}${warningSuffix}`,
    qualityReview,
  };
}

function getRetryTargetStatus(status: ScalerTaskStatus): ScalerTaskStatus | undefined {
  if (status === "debugging") return "running";
  if (status === "blocked" || status === "needs_replan") return "ready";
  return undefined;
}

function normalizeAllowedPaths(paths: string[] | undefined): string[] | undefined {
  const normalized = (paths ?? [])
    .map((path) => path.trim().replace(/^\.\//, "").replace(/\/$/, ""))
    .filter((path) => path.length > 0);
  return normalized.length > 0 ? [...new Set(normalized)] : undefined;
}

function normalizeIdList(ids: string[] | undefined): string[] | undefined {
  const normalized = (ids ?? []).map((id) => id.trim()).filter((id) => id.length > 0);
  return normalized.length > 0 ? [...new Set(normalized)] : undefined;
}

function normalizeDefinitionOfDone(items: string[] | undefined): string[] | undefined {
  const normalized = (items ?? []).map((item) => item.trim()).filter((item) => item.length > 0);
  return normalized.length > 0 ? [...new Set(normalized)] : undefined;
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

async function persistTaskValidationCommands(
  cwd: string,
  taskId: string,
  commands: EmbeddedValidationManifestCommandInput[] | undefined,
  definitionOfDone: string[] | undefined,
  outputPaths: string[] | undefined,
  validationInputPaths: string[] | undefined,
  authority: ValidationPolicyAuthority = "system",
): Promise<void> {
  if ((!commands || commands.length === 0) && outputPaths === undefined && validationInputPaths === undefined) return;
  const existing = await getValidationManifestForTask(cwd, taskId);
  const timestamp = new Date().toISOString();
  await saveValidationManifest(cwd, {
    ...existing,
    taskId,
    outputPaths: outputPaths ?? existing.outputPaths,
    validationInputPaths: validationInputPaths ?? existing.validationInputPaths,
    definitionOfDone: definitionOfDone ?? existing.definitionOfDone,
    commands: commands?.length ? commands.map((command) => ({ ...command, required: command.required ?? true })) : existing.commands,
    createdAt: existing.createdAt || timestamp,
    updatedAt: timestamp,
  }, { authority });
}

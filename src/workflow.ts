/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StageArtifact, StageArtifactStage } from "./stages.js";
import type { ScalerState, ScalerTaskState } from "./types.js";

export interface WorkflowSummary {
  currentTask: string;
  nextAction: string;
  hints: string[];
  warnings: string[];
}

export interface WorkflowSummaryOptions {
  stageArtifacts?: StageArtifact[];
}

export function summarizeWorkflow(state: ScalerState, options: WorkflowSummaryOptions = {}): WorkflowSummary {
  const currentTask = state.currentTaskId
    ? formatTaskRef(state.tasks.find((task) => task.id === state.currentTaskId)) ?? `${state.currentTaskId}:missing`
    : "none";
  const warnings = buildWarnings(state);
  const hints = buildHints(state);

  return {
    currentTask,
    nextAction: selectNextAction(state, options.stageArtifacts),
    hints,
    warnings,
  };
}

export function formatWorkflowSummary(summary: WorkflowSummary): string {
  const lines = ["Workflow:", `- current: ${summary.currentTask}`, `- next: ${summary.nextAction}`];
  if (summary.hints.length > 0) lines.push(`- hints: ${summary.hints.join("; ")}`);
  if (summary.warnings.length > 0) lines.push(`- warnings: ${summary.warnings.join("; ")}`);
  return lines.join("\n");
}

function selectNextAction(state: ScalerState, stageArtifacts: StageArtifact[] | undefined): string {
  const stageAction = selectStageArtifactAction(state, stageArtifacts);
  if (stageAction) return stageAction;

  const validating = state.tasks.find((task) => task.status === "validating");
  if (validating) return `/scaler-validate ${validating.id}`;

  const debugging = state.tasks.find((task) => task.status === "debugging");
  if (debugging) return `debug ${debugging.id}, then report a validation/debug outcome`;

  const blocked = state.tasks.find((task) => task.status === "blocked" || task.status === "needs_replan");
  if (blocked) return `resolve ${blocked.status} task ${blocked.id}`;

  const runnable = state.tasks.find((task) => task.status === "ready" || task.status === "pending");
  if (runnable) return "/scaler-step";

  const validated = state.tasks.find((task) => task.status === "validated");
  if (validated) return `/scaler-commit ${validated.id}`;

  if (state.tasks.length === 0) return "/scaler-task-create <taskId> | <title> | <paths>";
  return "/scaler-status";
}

function selectStageArtifactAction(state: ScalerState, stageArtifacts: StageArtifact[] | undefined): string | undefined {
  if (!stageArtifacts) return undefined;
  if (!isStageArtifactStage(state.stage) || state.stage === "execution") return undefined;
  const artifact = stageArtifacts
    .filter((candidate) => candidate.stage === state.stage)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))[0];
  if (artifact?.status === "ready" || artifact?.status === "accepted") return undefined;
  return `/scaler-stage-record ${state.stage} | ready | ${stageArtifactTitle(state.stage)} | <path> | <summary>`;
}

function isStageArtifactStage(value: string): value is StageArtifactStage {
  return ["prd", "knowledge", "planning", "execution", "replanning"].includes(value);
}

function stageArtifactTitle(stage: StageArtifactStage): string {
  switch (stage) {
    case "prd": return "Stage I PRD artifact";
    case "knowledge": return "Stage II knowledge artifact";
    case "planning": return "Stage III execution plan artifact";
    case "execution": return "Stage IV execution artifact";
    case "replanning": return "Replanning artifact";
  }
}

function buildHints(state: ScalerState): string[] {
  const hints: string[] = [];
  const validated = state.tasks.filter((task) => task.status === "validated");
  if (validated.length > 0) hints.push(`${validated.length} validated task(s) can be committed`);
  const runnable = state.tasks.filter((task) => task.status === "ready" || task.status === "pending");
  if (runnable.length > 0) hints.push(`${runnable.length} runnable task(s)`);
  const validating = state.tasks.filter((task) => task.status === "validating");
  if (validating.length > 0) hints.push(`${validating.length} task(s) awaiting validation`);
  return hints;
}

function buildWarnings(state: ScalerState): string[] {
  const warnings: string[] = [];
  const debugging = state.tasks.filter((task) => task.status === "debugging");
  if (debugging.length > 0) warnings.push(`${debugging.length} task(s) in debugging`);
  const blocked = state.tasks.filter((task) => task.status === "blocked" || task.status === "needs_replan");
  if (blocked.length > 0) warnings.push(`${blocked.length} blocked/replan task(s)`);
  if (state.rejectedTransitions.length > 0) warnings.push(`${state.rejectedTransitions.length} rejected transition(s)`);
  return warnings;
}

function formatTaskRef(task: ScalerTaskState | undefined): string | undefined {
  if (!task) return undefined;
  return `${task.id}:${task.status}${task.title ? ` (${task.title})` : ""}`;
}

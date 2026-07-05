/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { recordBudgetCheckpoint, persistBudgetDecision, type BudgetCheckpoint } from "./budgets.js";
import { appendLogEvent, createLogEvent, logStateEvent } from "./logging.js";
import { getCheckpointsDir } from "./paths.js";
import { ensureState, saveState } from "./state.js";
import { transitionStage } from "./supervisor.js";
import { verifyResumeReadiness } from "./watchdogs.js";
import type { ScalerState } from "./types.js";

export interface ScalerCheckpointFile {
  version: 1;
  id: string;
  timestamp: string;
  scope: string;
  summary?: string;
  budgetCheckpoint: BudgetCheckpoint;
  state: ScalerState;
}

export interface WriteCheckpointResult {
  path: string;
  state: ScalerState;
  checkpoint: ScalerCheckpointFile;
}

export interface CommandTransitionResult {
  state: ScalerState;
  checkpointPath: string;
  message: string;
}

export async function writeCheckpoint(
  cwd: string,
  state: ScalerState,
  scope: string,
  summary?: string,
  now = new Date(),
): Promise<WriteCheckpointResult> {
  const { state: budgetedState, decision, checkpoint: budgetCheckpoint } = recordBudgetCheckpoint(state, scope, summary, now);
  const persistedState = await persistBudgetDecision(cwd, budgetedState, decision);
  const checkpoint: ScalerCheckpointFile = {
    version: 1,
    id: budgetCheckpoint.id,
    timestamp: budgetCheckpoint.timestamp,
    scope,
    summary,
    budgetCheckpoint,
    state: persistedState,
  };
  const path = join(getCheckpointsDir(cwd), `${safeTimestamp(checkpoint.timestamp)}-${safeName(scope)}.json`);
  await mkdir(getCheckpointsDir(cwd), { recursive: true });
  await writeFile(path, `${JSON.stringify(checkpoint, null, 2)}\n`, "utf8");
  await appendLogEvent(
    cwd,
    createLogEvent(persistedState, {
      eventType: "system",
      summary: `Checkpoint written: ${scope}`,
      detailsPath: path,
    }),
  );
  return { path, state: persistedState, checkpoint };
}

export async function pauseScalerRun(cwd: string, reason = "manual pause"): Promise<CommandTransitionResult> {
  const state = await ensureState(cwd);
  const nextState = transitionStage(state, "paused", { reason });
  const { path, state: checkpointState } = await writeCheckpoint(cwd, nextState, "pause", reason);
  await logStateEvent(cwd, checkpointState, `Scaler pause requested: ${reason}`, { checkpointPath: path });
  return {
    state: checkpointState,
    checkpointPath: path,
    message: checkpointState.stage === "paused" ? `SCALER paused: ${reason}` : `SCALER pause rejected: ${reason}`,
  };
}

export async function resumeScalerRun(cwd: string, reason = "manual resume"): Promise<CommandTransitionResult> {
  const state = await ensureState(cwd);
  const verification = await verifyResumeReadiness(cwd, state);
  const targetStage = state.previousStage ?? "idle";
  if (verification.status === "failed") {
    const { path, state: checkpointState } = await writeCheckpoint(cwd, state, "resume-rejected", `Resume verification failed: ${reason}`);
    await logStateEvent(cwd, checkpointState, `Scaler resume rejected by verification: ${reason}`, { checkpointPath: path, verification });
    return { state: checkpointState, checkpointPath: path, message: `SCALER resume rejected: verification failed for ${targetStage}` };
  }
  const nextState = transitionStage(state, targetStage, { reason });
  await saveState(cwd, nextState);
  const { path, state: checkpointState } = await writeCheckpoint(cwd, nextState, "resume", reason);
  await logStateEvent(cwd, checkpointState, `Scaler resume requested: ${reason}`, {
    checkpointPath: path,
    targetStage,
    verification,
  });
  return {
    state: checkpointState,
    checkpointPath: path,
    message: checkpointState.stage === targetStage ? `SCALER resumed to ${targetStage}` : `SCALER resume rejected: ${reason}`,
  };
}

function safeTimestamp(timestamp: string): string {
  return timestamp.replace(/[:.]/g, "-");
}

function safeName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "checkpoint";
}

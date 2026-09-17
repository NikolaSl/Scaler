/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { loadExecutionLock } from "./locks.js";
import { getTaskAttemptsPath } from "./paths.js";

export type TaskAttemptStatus = "admitted" | "dispatching" | "completed" | "failed" | "interrupted";
export type TaskAttemptOutcome = "not_started" | "succeeded" | "failed" | "unknown";

export interface TaskAttemptRecord {
  id: string;
  runId: string;
  taskId: string;
  taskFingerprint: string;
  inputFingerprint: string;
  routeFingerprint: string;
  validationPolicyFingerprint: string;
  status: TaskAttemptStatus;
  outcome?: TaskAttemptOutcome;
  outputFingerprint?: string;
  reportId?: string;
  diagnostics?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface TaskAttemptAdmissionInput {
  runId: string;
  taskId: string;
  taskFingerprint: string;
  inputFingerprint: string;
  routeFingerprint: string;
  validationPolicyFingerprint: string;
}

export interface TaskAttemptCompletionInput {
  status: "completed" | "failed" | "interrupted";
  outcome: TaskAttemptOutcome;
  outputFingerprint?: string;
  reportId?: string;
  diagnostics?: string[];
}

interface TaskAttemptIndex {
  version: 1;
  attempts: TaskAttemptRecord[];
}

const openAttemptStatuses = new Set<TaskAttemptStatus>(["admitted", "dispatching"]);
const fingerprintPattern = /^sha256:[0-9a-f]{64}$/;

export async function loadTaskAttempts(cwd: string): Promise<TaskAttemptRecord[]> {
  try {
    const parsed = JSON.parse(await readFile(getTaskAttemptsPath(cwd), "utf8")) as TaskAttemptIndex;
    if (parsed.version !== 1 || !Array.isArray(parsed.attempts)) throw new Error("Invalid task-attempt index.");
    for (const attempt of parsed.attempts) validateStoredAttempt(attempt);
    return parsed.attempts;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export function findOpenTaskAttempt(attempts: TaskAttemptRecord[], runId: string, taskId: string): TaskAttemptRecord | undefined {
  return attempts.find((attempt) => attempt.runId === runId && attempt.taskId === taskId && openAttemptStatuses.has(attempt.status));
}

export async function admitTaskAttempt(
  cwd: string,
  executionLockId: string,
  input: TaskAttemptAdmissionInput,
  now = new Date(),
): Promise<TaskAttemptRecord> {
  await assertAttemptWriter(cwd, executionLockId, input.taskId);
  validateAdmission(input);
  const attempts = await loadTaskAttempts(cwd);
  const existing = findOpenTaskAttempt(attempts, input.runId, input.taskId);
  if (existing) throw new Error(`Task attempt admission rejected: ${input.taskId} already has open attempt ${existing.id}.`);
  const timestamp = now.toISOString();
  const record: TaskAttemptRecord = {
    id: randomUUID(),
    ...input,
    runId: input.runId.trim(),
    taskId: input.taskId.trim(),
    status: "admitted",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await writeTaskAttempts(cwd, [record, ...attempts]);
  return record;
}

export async function markTaskAttemptDispatching(
  cwd: string,
  executionLockId: string,
  attemptId: string,
  now = new Date(),
): Promise<TaskAttemptRecord> {
  const attempts = await loadTaskAttempts(cwd);
  const current = requireAttempt(attempts, attemptId);
  await assertAttemptWriter(cwd, executionLockId, current.taskId);
  if (current.status !== "admitted") throw new Error(`Task attempt ${current.id} cannot dispatch from ${current.status}.`);
  const updated = { ...current, status: "dispatching" as const, updatedAt: now.toISOString() };
  await writeTaskAttempts(cwd, replaceAttempt(attempts, updated));
  return updated;
}

export async function completeTaskAttempt(
  cwd: string,
  executionLockId: string,
  attemptId: string,
  input: TaskAttemptCompletionInput,
  now = new Date(),
): Promise<TaskAttemptRecord> {
  const attempts = await loadTaskAttempts(cwd);
  const current = requireAttempt(attempts, attemptId);
  await assertAttemptWriter(cwd, executionLockId, current.taskId);
  if (!openAttemptStatuses.has(current.status)) throw new Error(`Task attempt ${current.id} is already terminal (${current.status}).`);
  validateCompletion(input);
  if (current.status === "admitted" && (input.status !== "failed" || input.outcome !== "not_started")) {
    throw new Error(`Admitted task attempt ${current.id} can only finish as failed/not_started.`);
  }
  const updated: TaskAttemptRecord = {
    ...current,
    status: input.status,
    outcome: input.outcome,
    outputFingerprint: input.outputFingerprint,
    reportId: input.reportId?.trim() || undefined,
    diagnostics: uniqueNonEmpty(input.diagnostics ?? []),
    updatedAt: now.toISOString(),
  };
  await writeTaskAttempts(cwd, replaceAttempt(attempts, updated));
  return updated;
}

function validateAdmission(input: TaskAttemptAdmissionInput): void {
  if (typeof input.runId !== "string" || !input.runId.trim()) throw new Error("Task attempt requires runId.");
  if (typeof input.taskId !== "string" || !input.taskId.trim()) throw new Error("Task attempt requires taskId.");
  for (const [name, value] of Object.entries({
    taskFingerprint: input.taskFingerprint,
    inputFingerprint: input.inputFingerprint,
    routeFingerprint: input.routeFingerprint,
    validationPolicyFingerprint: input.validationPolicyFingerprint,
  })) {
    if (!fingerprintPattern.test(value)) throw new Error(`Task attempt requires valid ${name}.`);
  }
}

function validateCompletion(input: TaskAttemptCompletionInput): void {
  if (input.outputFingerprint !== undefined && !fingerprintPattern.test(input.outputFingerprint)) {
    throw new Error("Task attempt completion requires a valid outputFingerprint.");
  }
  if (input.status === "completed" && (input.outcome !== "succeeded" || !input.outputFingerprint)) {
    throw new Error("Completed task attempt requires succeeded outcome and outputFingerprint.");
  }
  if (input.status === "interrupted" && input.outcome !== "unknown") {
    throw new Error("Interrupted task attempt requires unknown outcome.");
  }
  if (input.status === "failed" && input.outcome !== "failed" && input.outcome !== "not_started") {
    throw new Error("Failed task attempt requires failed or not_started outcome.");
  }
}

function validateStoredAttempt(attempt: TaskAttemptRecord): void {
  if (!attempt || typeof attempt !== "object" || !attempt.id?.trim()) throw new Error("Invalid stored task attempt identity.");
  validateAdmission(attempt);
  if (!["admitted", "dispatching", "completed", "failed", "interrupted"].includes(attempt.status)) {
    throw new Error(`Invalid stored task attempt status for ${attempt.id}.`);
  }
  if (!attempt.createdAt || !attempt.updatedAt) throw new Error(`Invalid stored task attempt timestamps for ${attempt.id}.`);
  if (attempt.status === "completed" || attempt.status === "failed" || attempt.status === "interrupted") {
    validateCompletion({
      status: attempt.status,
      outcome: attempt.outcome as TaskAttemptOutcome,
      outputFingerprint: attempt.outputFingerprint,
      reportId: attempt.reportId,
      diagnostics: attempt.diagnostics,
    });
  } else if (attempt.outcome || attempt.outputFingerprint || attempt.reportId) {
    throw new Error(`Open task attempt ${attempt.id} contains terminal fields.`);
  }
}

async function assertAttemptWriter(cwd: string, executionLockId: string, taskId: string): Promise<void> {
  const lock = await loadExecutionLock(cwd);
  if (!lock || lock.id !== executionLockId || lock.taskId !== taskId) {
    throw new Error(`Task attempt write rejected: execution lock does not own task ${taskId}.`);
  }
}

function requireAttempt(attempts: TaskAttemptRecord[], attemptId: string): TaskAttemptRecord {
  const current = attempts.find((attempt) => attempt.id === attemptId.trim());
  if (!current) throw new Error(`Task attempt ${attemptId.trim() || "<missing>"} does not exist.`);
  return current;
}

function replaceAttempt(attempts: TaskAttemptRecord[], updated: TaskAttemptRecord): TaskAttemptRecord[] {
  return attempts.map((attempt) => attempt.id === updated.id ? updated : attempt);
}

function uniqueNonEmpty(values: string[]): string[] | undefined {
  const normalized = Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
  return normalized.length > 0 ? normalized : undefined;
}

async function writeTaskAttempts(cwd: string, attempts: TaskAttemptRecord[]): Promise<void> {
  const path = getTaskAttemptsPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  let published = false;
  try {
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(`${JSON.stringify({ version: 1, attempts } satisfies TaskAttemptIndex, null, 2)}\n`, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path);
    published = true;
  } finally {
    if (!published) await rm(temporary, { force: true });
  }
}

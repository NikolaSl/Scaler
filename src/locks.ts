/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdir, open, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { appendLogEvent, createLogEvent } from "./logging.js";
import { getExecutionLockPath } from "./paths.js";
import { ensureState } from "./state.js";

export interface ExecutionLock {
  version: 1;
  id: string;
  operation: string;
  taskId?: string;
  reason?: string;
  createdAt: string;
}

export interface AcquireExecutionLockInput {
  operation: string;
  taskId?: string;
  reason?: string;
  now?: Date;
}

export interface AcquireExecutionLockResult {
  acquired: boolean;
  lock: ExecutionLock;
  existingLock?: ExecutionLock;
  message: string;
}

export interface ReleaseExecutionLockResult {
  released: boolean;
  message: string;
}

export async function loadExecutionLock(cwd: string): Promise<ExecutionLock | undefined> {
  try {
    return JSON.parse(await readFile(getExecutionLockPath(cwd), "utf8")) as ExecutionLock;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function acquireExecutionLock(cwd: string, input: AcquireExecutionLockInput): Promise<AcquireExecutionLockResult> {
  const lock: ExecutionLock = {
    version: 1,
    id: randomUUID(),
    operation: input.operation,
    taskId: input.taskId,
    reason: input.reason,
    createdAt: (input.now ?? new Date()).toISOString(),
  };
  const path = getExecutionLockPath(cwd);
  await mkdir(dirname(path), { recursive: true });

  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(path, "wx");
    await handle.writeFile(`${JSON.stringify(lock, null, 2)}\n`, "utf8");
    await handle.close();
    return { acquired: true, lock, message: `Execution lock acquired: ${lock.operation}` };
  } catch (error) {
    if (handle) await handle.close();
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existingLock = await loadExecutionLock(cwd);
    return {
      acquired: false,
      lock,
      existingLock,
      message: existingLock ? `Execution lock held: ${formatExecutionLock(existingLock)}` : "Execution lock exists but could not be read.",
    };
  }
}

export async function releaseExecutionLock(cwd: string, lockId: string): Promise<ReleaseExecutionLockResult> {
  const existing = await loadExecutionLock(cwd);
  if (!existing) return { released: false, message: "No execution lock exists." };
  if (existing.id !== lockId) return { released: false, message: `Execution lock not released; held by ${existing.id}.` };

  await unlink(getExecutionLockPath(cwd));
  return { released: true, message: `Execution lock released: ${existing.operation}` };
}

export async function clearExecutionLock(cwd: string, reason: string): Promise<ReleaseExecutionLockResult> {
  const existing = await loadExecutionLock(cwd);
  if (!existing) return { released: false, message: "No execution lock exists." };
  await unlink(getExecutionLockPath(cwd));
  const state = await ensureState(cwd);
  await appendLogEvent(
    cwd,
    createLogEvent(state, {
      eventType: "system",
      summary: `Execution lock manually cleared: ${reason}`,
      details: { lock: existing, reason },
    }),
  );
  return { released: true, message: `Execution lock cleared: ${existing.operation}` };
}

export async function withExecutionLock<T>(
  cwd: string,
  input: AcquireExecutionLockInput,
  fn: (lock: ExecutionLock) => Promise<T>,
): Promise<T | AcquireExecutionLockResult> {
  const acquired = await acquireExecutionLock(cwd, input);
  if (!acquired.acquired) return acquired;
  try {
    return await fn(acquired.lock);
  } finally {
    await releaseExecutionLock(cwd, acquired.lock.id);
  }
}

export function formatExecutionLock(lock: ExecutionLock | undefined): string {
  if (!lock) return "No execution lock.";
  const task = lock.taskId ? ` task=${lock.taskId}` : "";
  const reason = lock.reason ? ` reason=${lock.reason}` : "";
  return `lock=${lock.id} operation=${lock.operation}${task} createdAt=${lock.createdAt}${reason}`;
}

export async function writeExecutionLock(cwd: string, lock: ExecutionLock): Promise<void> {
  const path = getExecutionLockPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
}

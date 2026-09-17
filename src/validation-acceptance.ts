/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readlink } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { promisify } from "node:util";
import { captureValidationContext, checkAttemptEvidence } from "./attempt-evidence.js";
import { fingerprintTaskContract, fingerprintValidationPolicy } from "./attempt-identity.js";
import { fingerprintJson } from "./fingerprints.js";
import { loadState } from "./state.js";
import { loadTaskAttempts } from "./task-attempts.js";
import type { ScalerState } from "./types.js";
import { getValidationManifestForTask, loadValidationRuns, type ValidationRunRecord } from "./validation.js";

const exec = promisify(execFile);

export interface ValidationSnapshot {
  version: 1;
  runId: string;
  taskId: string;
  taskFingerprint: string;
  attemptId: string | null;
  outputFingerprint: string | null;
  policyFingerprint: string;
  contextFingerprint: string;
  gitCandidateFingerprint: string | null;
}

export interface ValidationReceipt {
  snapshot: ValidationSnapshot;
  resultFingerprint: string;
}

export async function captureValidationSnapshot(cwd: string, state: ScalerState, taskId: string): Promise<ValidationSnapshot> {
  const task = state.tasks.find((task) => task.id === taskId);
  if (!task) throw new Error(`Cannot snapshot missing validation task ${taskId}.`);
  const attempt = task.attemptId ? (await loadTaskAttempts(cwd)).find((attempt) => attempt.id === task.attemptId) : undefined;
  return {
    version: 1, runId: state.runId, taskId,
    taskFingerprint: fingerprintTaskContract(task),
    attemptId: task.attemptId ?? null, outputFingerprint: attempt?.outputFingerprint ?? null,
    policyFingerprint: fingerprintValidationPolicy(await getValidationManifestForTask(cwd, taskId)),
    contextFingerprint: await captureValidationContext(cwd, state, taskId),
    gitCandidateFingerprint: await fingerprintGitCandidate(cwd),
  };
}

export function fingerprintValidationResult(run: ValidationRunRecord): string {
  // Canonicalize command evidence: absent policy diagnostics mean an empty list;
  // the JSON round-trip drops undefined optional fields in nested command records.
  return fingerprintJson(JSON.parse(JSON.stringify({
    id: run.id, taskId: run.taskId, status: run.status,
    commandRuns: run.commandRuns, policyDiagnostics: run.policyDiagnostics ?? [],
  })));
}

// Shared read-only boundary for direct commit/skip and their locked wrappers.
// A digest binds versions; it is not authentication against a writer of ledgers.
export async function verifyCurrentValidationReceipt(cwd: string, state: ScalerState, taskId: string): Promise<string[]> {
  const durable = await loadState(cwd);
  if (durable.runId !== state.runId || durable.revision !== state.revision) {
    return ["Validation receipt rejected: state changed or was not persisted; reload and revalidate."];
  }
  const run = (await loadValidationRuns(cwd)).find((run) => run.taskId === taskId);
  const hasEvidence = run?.commandRuns.some((command) => command.status === "passed"
    || (command.status === "skipped" && command.disposition === "skipped" && command.dispositionReason?.trim()));
  if (!run?.receipt || run.status !== "passed" || !hasEvidence) {
    return ["Validation receipt rejected: no current version-bound passing command evidence; revalidate."];
  }
  const diagnostics = await checkAttemptEvidence(cwd, state, taskId);
  if (run.receipt.resultFingerprint !== fingerprintValidationResult(run)) {
    diagnostics.push("Validation receipt rejected: validation result changed.");
  }
  try {
    const current = await captureValidationSnapshot(cwd, state, taskId);
    if (fingerprintJson(run.receipt.snapshot) !== fingerprintJson(current)) {
      diagnostics.push("Validation receipt rejected: run, task, attempt, policy, context or candidate output changed.");
    }
  } catch (error) {
    diagnostics.push(`Validation receipt rejected: snapshot unavailable: ${String(error)}`);
  }
  const manifest = await getValidationManifestForTask(cwd, taskId);
  for (const command of manifest.commands.filter((command) => command.required)) {
    const evidence = run.commandRuns.find((run) => run.commandId === command.id && run.command === command.command && run.required);
    if (!evidence || (evidence.status !== "passed" && !(evidence.status === "skipped" && command.disposition === "skipped" && command.dispositionReason?.trim()))) {
      diagnostics.push(`Validation receipt rejected: required command ${command.id} has no passing evidence or declared skip.`);
    }
  }
  return diagnostics;
}

async function fingerprintGitCandidate(cwd: string): Promise<string | null> {
  let root: string;
  try { root = (await exec("git", ["rev-parse", "--show-toplevel"], { cwd })).stdout.trim(); }
  catch (error) {
    if ((error as { code?: number }).code === 128) return null;
    throw error;
  }
  let head: string | null;
  try { head = (await exec("git", ["rev-parse", "--verify", "HEAD"], { cwd: root })).stdout.trim(); }
  catch (error) {
    if ((error as { code?: number }).code !== 128) throw error;
    head = null;
  }
  const changed = await exec("git", head ? ["diff", "--no-renames", "--name-only", "-z", "HEAD", "--"] : ["ls-files", "--cached", "-z"], { cwd: root });
  const untracked = await exec("git", ["ls-files", "--others", "--exclude-standard", "-z"], { cwd: root });
  const projectPrefix = relative(root, cwd).split(sep).filter(Boolean).join("/");
  const runtimePrefix = projectPrefix ? `${projectPrefix}/.scaler` : ".scaler";
  const paths = [...new Set((changed.stdout + untracked.stdout).split("\0").filter((path) => path && path !== runtimePrefix && !path.startsWith(`${runtimePrefix}/`)))].sort();
  const files = [];
  for (const path of paths) {
    const absolute = join(root, path);
    try {
      const segments = path.split("/");
      for (let depth = 1; depth < segments.length; depth++) {
        const parent = await lstat(join(root, ...segments.slice(0, depth)));
        if (parent.isSymbolicLink()) throw new Error(`Cannot capture validation candidate ${path}: symlink ancestor; reconcile before acceptance.`);
      }
      const stat = await lstat(absolute);
      if (stat.isSymbolicLink()) files.push({ path, kind: "symlink", target: await readlink(absolute) });
      else if (stat.isFile()) files.push({ path, kind: "file", executable: (stat.mode & 0o111) !== 0, digest: await fingerprintFile(absolute) });
      else throw new Error(`Cannot capture validation candidate ${path}: unsupported file type; reconcile before acceptance.`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      files.push({ path, kind: "deleted" });
    }
  }
  return fingerprintJson({ head, files });
}

async function fingerprintFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

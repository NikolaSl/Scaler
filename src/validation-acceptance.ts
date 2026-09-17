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
import { getValidationManifestForTask, loadValidationRuns, type TaskValidationManifest, type ValidationRunRecord } from "./validation.js";

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
  const run = (await loadValidationRuns(cwd)).find((run) => run.taskId === taskId);
  return verifyValidationRunReceipt(cwd, state, taskId, run);
}

// Also used before automatic acceptance, while the supervisor-produced record
// is still in memory. This checks evidence, not caller authority or signatures.
export async function verifyValidationRunReceipt(cwd: string, state: ScalerState, taskId: string, run: ValidationRunRecord | undefined): Promise<string[]> {
  const durable = await loadState(cwd);
  if (durable.runId !== state.runId || durable.revision !== state.revision) {
    return ["Validation receipt rejected: state changed or was not persisted; reload and revalidate."];
  }
  const diagnostics = verifyValidationRecordEvidence(run, await getValidationManifestForTask(cwd, taskId));
  if (!run?.receipt || diagnostics.length > 0) return diagnostics;
  diagnostics.push(...await checkAttemptEvidence(cwd, state, taskId));
  try {
    const current = await captureValidationSnapshot(cwd, state, taskId);
    if (fingerprintJson(run.receipt.snapshot) !== fingerprintJson(current)) {
      diagnostics.push("Validation receipt rejected: run, task, attempt, policy, context or candidate output changed.");
    }
  } catch (error) {
    diagnostics.push(`Validation receipt rejected: snapshot unavailable: ${String(error)}`);
  }
  return diagnostics;
}

// Integrity of historical command evidence only. Callers must additionally
// verify identity/freshness and acceptance; this does not authorize any effect.
export function verifyValidationRecordEvidence(run: ValidationRunRecord | undefined, manifest: TaskValidationManifest): string[] {
  const hasEvidence = Array.isArray(run?.commandRuns) && run.commandRuns.some((command) => command.status === "passed"
    || (command.status === "skipped" && command.disposition === "skipped" && command.dispositionReason?.trim()));
  if (!run?.receipt || run.taskId !== manifest.taskId || run.status !== "passed" || !hasEvidence) {
    return ["Validation receipt rejected: no current version-bound passing command evidence; revalidate."];
  }
  const diagnostics: string[] = [];
  if (run.receipt.resultFingerprint !== fingerprintValidationResult(run)) {
    diagnostics.push("Validation receipt rejected: validation result changed.");
  }
  for (const command of manifest.commands.filter((command) => command.required)) {
    const evidence = run.commandRuns.find((run) => run.commandId === command.id && run.command === command.command && run.required);
    const declaredSkip = evidence?.status === "skipped" && evidence.disposition === "skipped"
      && Boolean(evidence.dispositionReason?.trim()) && command.disposition === "skipped"
      && evidence.dispositionReason?.trim() === command.dispositionReason?.trim();
    if (!evidence || (evidence.status !== "passed" && !declaredSkip)) {
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
  const flagged = await exec("git", ["ls-files", "-v", "-z"], { cwd: root });
  const projectPrefix = relative(root, cwd).split(sep).filter(Boolean).join("/");
  const runtimePrefix = projectPrefix ? `${projectPrefix}/.scaler` : ".scaler";
  // HEAD already binds the clean index. Capture only its staged delta, with
  // full object IDs and modes; --cached also handles an unborn HEAD. Raw output
  // avoids reading blob contents or serializing every clean tracked entry.
  const staged = await exec("git", ["diff", "--cached", "--raw", "--no-abbrev", "--no-renames", "-z",
    "--no-ext-diff", "--no-textconv", "--ignore-submodules=none", "--", ".", `:(exclude,literal)${runtimePrefix}`], { cwd: root });
  if (staged.stdout.split("\0").some((entry) => /^:\d{6} \d{6} [0-9a-f]+ [0-9a-f]+ U$/.test(entry))) {
    throw new Error("Cannot capture validation candidate: unmerged index; reconcile conflicts before acceptance.");
  }
  const isOutputPath = (path: string) => path && path !== runtimePrefix && !path.startsWith(`${runtimePrefix}/`);
  // Lowercase tags mean assume-unchanged; S/s means skip-worktree. These
  // tracked files can be absent from Git diff even when physical bytes change.
  const hiddenPaths = flagged.stdout.split("\0").filter((entry) => /^[a-zS] /.test(entry)).map((entry) => entry.slice(2));
  const candidates = [...(changed.stdout + untracked.stdout).split("\0"), ...hiddenPaths];
  const paths = [...new Set(candidates.filter(isOutputPath))].sort();
  // Bind the index independently: restoring working bytes must not hide a
  // different staged candidate. Runtime ledger entries remain excluded.
  const index = staged.stdout;
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
  return fingerprintJson({ head, files, index });
}

async function fingerprintFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

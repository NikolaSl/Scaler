/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";
import { logGitCommitAudit } from "./logging.js";
import { getCommitReportsPath, getCommitSkipsPath, getGitBootstrapReportsPath } from "./paths.js";
import { loadValidationRuns, type ValidationRunRecord } from "./validation.js";
import { verifyCurrentValidationReceipt } from "./validation-acceptance.js";
import type { ScalerState } from "./types.js";

const execFileAsync = promisify(execFile);

export type GitSafetyStatus = "clean" | "runtime_only" | "allowed" | "unrelated" | "not_git_repo";
export type GitBootstrapStatus = "existing" | "initialized" | "failed";
export type GitCommitSkipStatus = "skipped" | "rejected";

export interface GitStatusSafetyDecision {
  status: GitSafetyStatus;
  clean: boolean;
  changedPaths: string[];
  runtimePaths: string[];
  allowedPaths: string[];
  unrelatedPaths: string[];
  reason: string;
}

export interface GitCommitTaskResult {
  accepted: boolean;
  message: string;
  commitHash?: string;
  safety: GitStatusSafetyDecision;
  report?: CommitReportRecord;
  skip?: CommitSkipRecord;
}

export interface CommitValidationSummary {
  runId?: string;
  status?: ValidationRunRecord["status"];
  commandCount: number;
  failedCommandIds: string[];
  createdAt?: string;
}

export interface CommitReportRecord {
  id: string;
  taskId: string;
  commitHash: string;
  includedPaths: string[];
  validation: CommitValidationSummary;
  safety: Pick<GitStatusSafetyDecision, "status" | "reason" | "runtimePaths" | "allowedPaths">;
  createdAt: string;
}

export interface CommitSkipRecord {
  id: string;
  taskId: string;
  status: GitCommitSkipStatus;
  reason: string;
  validation: CommitValidationSummary;
  safety: Pick<GitStatusSafetyDecision, "status" | "reason" | "changedPaths" | "runtimePaths" | "allowedPaths" | "unrelatedPaths">;
  createdAt: string;
}

export interface GitBootstrapRecord {
  id: string;
  status: GitBootstrapStatus;
  wasRepository: boolean;
  gitignoreUpdated: boolean;
  ignoreRules: string[];
  message: string;
  safety: GitStatusSafetyDecision;
  createdAt: string;
}

export interface GitValidationAcceptanceDecision {
  accepted: boolean;
  status: "commit_not_required" | "commit_skipped" | "commit_required" | "blocked";
  message: string;
  safety: GitStatusSafetyDecision;
  skip?: CommitSkipRecord;
}

export interface CommitReportIndex {
  version: 1;
  commits: CommitReportRecord[];
}

export interface CommitSkipIndex {
  version: 1;
  skips: CommitSkipRecord[];
}

export interface GitBootstrapIndex {
  version: 1;
  records: GitBootstrapRecord[];
}

const scalerGitIgnoreRules = [
  ".scaler/state.json.lock/",
  ".scaler/state.json.*.tmp",
  ".scaler/tool-requests/execution-ledger.lock/",
  ".scaler/tool-requests/*.tmp",
  ".scaler/reports/*.tmp",
  ".scaler/logs/",
  ".scaler/cache/",
  ".scaler/artifacts/",
  ".scaler/tmp/",
  ".scaler/cicd/",
  ".scaler/storage/archive/",
];

export async function ensureGitRepository(cwd: string, options: { init?: boolean; updateIgnore?: boolean; now?: Date } = {}): Promise<GitBootstrapRecord> {
  const now = options.now ?? new Date();
  const wasRepository = await isGitRepository(cwd);
  let status: GitBootstrapStatus = wasRepository ? "existing" : "initialized";
  let message = wasRepository ? "Project is already a git repository." : "Initialized git repository for SCALER run.";
  try {
    if (!wasRepository) {
      if (options.init === false) {
        status = "failed";
        message = "Project is not a git repository and initialization is disabled.";
      } else {
        await execFileAsync("git", ["init"], { cwd });
      }
    }
  } catch (error) {
    status = "failed";
    message = `Git initialization failed: ${error instanceof Error ? error.message : String(error)}`;
  }

  const gitignoreUpdated = status !== "failed" && options.updateIgnore !== false ? await ensureScalerGitIgnore(cwd) : false;
  const safety = await assessGitStatusSafety(cwd, []);
  const record: GitBootstrapRecord = {
    id: `git-bootstrap-${now.getTime()}`,
    status,
    wasRepository,
    gitignoreUpdated,
    ignoreRules: scalerGitIgnoreRules,
    message: gitignoreUpdated ? `${message} Updated git exclude rules with SCALER runtime paths.` : message,
    safety,
    createdAt: now.toISOString(),
  };
  await writeGitBootstrapRecords(cwd, [record, ...(await loadGitBootstrapRecords(cwd))]);
  return record;
}

export async function loadGitBootstrapRecords(cwd: string): Promise<GitBootstrapRecord[]> {
  try {
    const raw = await readFile(getGitBootstrapReportsPath(cwd), "utf8");
    return (JSON.parse(raw) as GitBootstrapIndex).records;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export function formatGitBootstrapRecords(records: GitBootstrapRecord[], limit = 10): string {
  if (!records.length) return "No git bootstrap records.";
  const shown = records.slice(0, Math.max(1, limit));
  const lines = [`Git bootstrap records: records=${records.length} showing=${shown.length}`];
  for (const record of shown) {
    lines.push(`- ${record.id} status=${record.status} wasRepo=${record.wasRepository} gitignoreUpdated=${record.gitignoreUpdated} safety=${record.safety.status}: ${record.message}`);
  }
  return lines.join("\n");
}

export async function loadCommitSkips(cwd: string): Promise<CommitSkipRecord[]> {
  try {
    const raw = await readFile(getCommitSkipsPath(cwd), "utf8");
    return (JSON.parse(raw) as CommitSkipIndex).skips;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export function formatCommitSkips(records: CommitSkipRecord[], taskId?: string, limit = 20): string {
  const filtered = taskId ? records.filter((record) => record.taskId === taskId) : records;
  if (!filtered.length) return taskId ? `No commit skip records for ${taskId}.` : "No commit skip records.";
  const lines = [taskId ? `Commit skip records for ${taskId}:` : "Commit skip records:"];
  for (const record of filtered.slice(0, limit)) {
    lines.push(`- ${record.taskId}: ${record.status} safety=${record.safety.status} validation=${record.validation.status ?? "unknown"} reason=${record.reason}`);
  }
  return lines.join("\n");
}

export async function getGitChangedPaths(cwd: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd });
    return stdout
      .split("\n")
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0)
      .map(parsePorcelainPath)
      .sort((a, b) => a.localeCompare(b));
  } catch (error) {
    const code = (error as { code?: number }).code;
    if (code === 128) return [];
    throw error;
  }
}

export async function commitValidatedTask(
  cwd: string,
  state: ScalerState,
  taskId: string,
  allowedPathPrefixes: string[],
): Promise<GitCommitTaskResult> {
  const task = state.tasks.find((candidate) => candidate.id === taskId);
  const safety = await assessGitStatusSafety(cwd, allowedPathPrefixes);
  const validation = await buildCommitValidationSummary(cwd, taskId);

  if (!task) return logCommitResult(cwd, state, taskId, { accepted: false, message: `Task ${taskId} does not exist.`, safety });
  if (task.status !== "validated" && !(task.status === "validating" && validation.status === "passed")) {
    return logCommitResult(cwd, state, taskId, { accepted: false, message: `Task ${taskId} is not validated or validation-passed.`, safety });
  }
  if (safety.status === "not_git_repo" || safety.status === "unrelated") {
    return logCommitResult(cwd, state, taskId, { accepted: false, message: `Commit refused: ${safety.reason}`, safety });
  }
  const receiptDiagnostics = await verifyCurrentValidationReceipt(cwd, state, taskId);
  if (receiptDiagnostics.length > 0) return logCommitResult(cwd, state, taskId, { accepted: false, message: receiptDiagnostics.join(" "), safety });
  if (safety.status === "clean" || safety.status === "runtime_only") {
    const skip = await recordCommitSkip(cwd, {
      taskId,
      reason: `Commit skipped: ${safety.reason}`,
      validation,
      safety,
      status: "skipped",
    });
    return logCommitResult(cwd, state, taskId, { accepted: true, message: `Commit skipped with evidence: ${safety.reason}`, safety, skip });
  }

  for (const path of allowedPathPrefixes) {
    await execFileAsync("git", ["add", path], { cwd });
  }
  await execFileAsync("git", ["commit", "-m", buildTaskCommitMessage(taskId, task.title)], { cwd });
  const { stdout } = await execFileAsync("git", ["rev-parse", "--short", "HEAD"], { cwd });
  const commitHash = stdout.trim();
  const report = await recordCommitReport(cwd, {
    taskId,
    commitHash,
    includedPaths: safety.allowedPaths,
    safety,
    validation,
  });
  return logCommitResult(cwd, state, taskId, {
    accepted: true,
    message: `Committed ${taskId}: ${commitHash}`,
    commitHash,
    safety,
    report,
  });
}

export async function evaluateValidationGitAcceptance(
  cwd: string,
  state: ScalerState,
  taskId: string,
  validation: CommitValidationSummary,
): Promise<GitValidationAcceptanceDecision> {
  const task = state.tasks.find((candidate) => candidate.id === taskId);
  const safety = await assessGitStatusSafety(cwd, task?.allowedPathPrefixes ?? []);
  if (!task) {
    return { accepted: false, status: "blocked", message: `Task ${taskId} does not exist.`, safety };
  }

  if (safety.status === "not_git_repo") {
    const skip = await recordCommitSkip(cwd, {
      taskId,
      reason: "Git commit explicitly skipped because no git repository is available for this validation context.",
      validation,
      safety,
      status: "skipped",
    });
    return { accepted: true, status: "commit_skipped", message: skip.reason, safety, skip };
  }

  if (safety.status === "clean" || safety.status === "runtime_only") {
    const skip = await recordCommitSkip(cwd, {
      taskId,
      reason: `Git commit explicitly skipped because ${safety.reason}`,
      validation,
      safety,
      status: "skipped",
    });
    return { accepted: true, status: "commit_skipped", message: skip.reason, safety, skip };
  }

  if (safety.status === "allowed") {
    return {
      accepted: false,
      status: "commit_required",
      message: `Validation passed for ${taskId}; git commit or explicit commit skip is required before the task can be marked validated.`,
      safety,
    };
  }

  return {
    accepted: false,
    status: "blocked",
    message: `Validation passed for ${taskId}, but git acceptance is blocked: ${safety.reason}`,
    safety,
  };
}

export async function skipTaskCommit(
  cwd: string,
  state: ScalerState,
  taskId: string,
  reason: string,
): Promise<GitCommitTaskResult> {
  const task = state.tasks.find((candidate) => candidate.id === taskId);
  const safety = await assessGitStatusSafety(cwd, task?.allowedPathPrefixes ?? []);
  const validation = await buildCommitValidationSummary(cwd, taskId);
  if (!task) return logCommitResult(cwd, state, taskId, { accepted: false, message: `Task ${taskId} does not exist.`, safety });
  if (task.status !== "validated" && !(task.status === "validating" && validation.status === "passed")) {
    return logCommitResult(cwd, state, taskId, { accepted: false, message: `Commit skip refused: ${taskId} is not validated or validation-passed.`, safety });
  }
  if (safety.status === "unrelated") {
    return logCommitResult(cwd, state, taskId, { accepted: false, message: `Commit skip refused: ${safety.reason}`, safety });
  }
  const receiptDiagnostics = await verifyCurrentValidationReceipt(cwd, state, taskId);
  if (receiptDiagnostics.length > 0) return logCommitResult(cwd, state, taskId, { accepted: false, message: receiptDiagnostics.join(" "), safety });
  const trimmedReason = reason.trim();
  if (!trimmedReason) {
    return logCommitResult(cwd, state, taskId, { accepted: false, message: "Commit skip refused: reason is required.", safety });
  }
  const skip = await recordCommitSkip(cwd, { taskId, reason: trimmedReason, validation, safety, status: "skipped" });
  return logCommitResult(cwd, state, taskId, { accepted: true, message: `Commit skipped for ${taskId}: ${trimmedReason}`, safety, skip });
}

export async function loadCommitReports(cwd: string): Promise<CommitReportRecord[]> {
  try {
    const raw = await readFile(getCommitReportsPath(cwd), "utf8");
    return (JSON.parse(raw) as CommitReportIndex).commits;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function recordCommitReport(
  cwd: string,
  input: {
    taskId: string;
    commitHash: string;
    includedPaths: string[];
    validation: CommitValidationSummary;
    safety: GitStatusSafetyDecision;
  },
  now = new Date(),
): Promise<CommitReportRecord> {
  const record: CommitReportRecord = {
    id: `${input.taskId}-commit-${now.getTime()}`,
    taskId: input.taskId,
    commitHash: input.commitHash,
    includedPaths: [...input.includedPaths].sort((a, b) => a.localeCompare(b)),
    validation: input.validation,
    safety: {
      status: input.safety.status,
      reason: input.safety.reason,
      runtimePaths: input.safety.runtimePaths,
      allowedPaths: input.safety.allowedPaths,
    },
    createdAt: now.toISOString(),
  };
  await writeCommitReports(cwd, [record, ...(await loadCommitReports(cwd))]);
  return record;
}

export async function recordCommitSkip(
  cwd: string,
  input: {
    taskId: string;
    reason: string;
    validation: CommitValidationSummary;
    safety: GitStatusSafetyDecision;
    status?: GitCommitSkipStatus;
  },
  now = new Date(),
): Promise<CommitSkipRecord> {
  const record: CommitSkipRecord = {
    id: `${input.taskId}-commit-skip-${now.getTime()}`,
    taskId: input.taskId,
    status: input.status ?? "skipped",
    reason: input.reason,
    validation: input.validation,
    safety: {
      status: input.safety.status,
      reason: input.safety.reason,
      changedPaths: input.safety.changedPaths,
      runtimePaths: input.safety.runtimePaths,
      allowedPaths: input.safety.allowedPaths,
      unrelatedPaths: input.safety.unrelatedPaths,
    },
    createdAt: now.toISOString(),
  };
  await writeCommitSkips(cwd, [record, ...(await loadCommitSkips(cwd))]);
  return record;
}

export function formatCommitReports(records: CommitReportRecord[], taskId?: string, limit = 20): string {
  const filtered = taskId ? records.filter((record) => record.taskId === taskId) : records;
  if (filtered.length === 0) return taskId ? `No commit reports for ${taskId}.` : "No commit reports.";
  const lines = [taskId ? `Commit reports for ${taskId}:` : "Commit reports:"];
  for (const record of filtered.slice(0, limit)) {
    const validation = record.validation.runId
      ? `${record.validation.status} ${record.validation.runId} commands=${record.validation.commandCount} failed=${record.validation.failedCommandIds.length}`
      : "no validation run found";
    lines.push(`- ${record.taskId}: ${record.commitHash} paths=${record.includedPaths.join(",") || "none"} validation=${validation}`);
  }
  return lines.join("\n");
}

export async function buildCommitValidationSummary(cwd: string, taskId: string): Promise<CommitValidationSummary> {
  const latest = (await loadValidationRuns(cwd))
    .filter((run) => run.taskId === taskId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (!latest) return { commandCount: 0, failedCommandIds: [] };
  return {
    runId: latest.id,
    status: latest.status,
    commandCount: latest.commandRuns.length,
    failedCommandIds: latest.commandRuns.filter((run) => run.status !== "passed").map((run) => run.commandId),
    createdAt: latest.createdAt,
  };
}

export async function assessGitStatusSafety(cwd: string, allowedPathPrefixes: string[] = []): Promise<GitStatusSafetyDecision> {
  const isRepo = await isGitRepository(cwd);
  if (!isRepo) {
    return {
      status: "not_git_repo",
      clean: false,
      changedPaths: [],
      runtimePaths: [],
      allowedPaths: [],
      unrelatedPaths: [],
      reason: "Not a git repository.",
    };
  }

  const changedPaths = await getGitChangedPaths(cwd);
  if (changedPaths.length === 0) {
    return {
      status: "clean",
      clean: true,
      changedPaths,
      runtimePaths: [],
      allowedPaths: [],
      unrelatedPaths: [],
      reason: "Working tree is clean.",
    };
  }

  const runtimePaths = changedPaths.filter(isRuntimePath);
  const nonRuntimePaths = changedPaths.filter((path) => !isRuntimePath(path));
  const allowedPaths = nonRuntimePaths.filter((path) => isAllowedPath(path, allowedPathPrefixes));
  const unrelatedPaths = nonRuntimePaths.filter((path) => !isAllowedPath(path, allowedPathPrefixes));

  if (nonRuntimePaths.length === 0) {
    return {
      status: "runtime_only",
      clean: false,
      changedPaths,
      runtimePaths,
      allowedPaths: [],
      unrelatedPaths: [],
      reason: "Only .scaler runtime paths changed.",
    };
  }

  if (unrelatedPaths.length === 0) {
    return {
      status: "allowed",
      clean: false,
      changedPaths,
      runtimePaths,
      allowedPaths,
      unrelatedPaths,
      reason: "Only allowed task paths changed outside .scaler.",
    };
  }

  return {
    status: "unrelated",
    clean: false,
    changedPaths,
    runtimePaths,
    allowedPaths,
    unrelatedPaths,
    reason: `Unrelated changes detected: ${unrelatedPaths.join(", ")}`,
  };
}

async function isGitRepository(cwd: string): Promise<boolean> {
  try {
    await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], { cwd });
    return true;
  } catch {
    return false;
  }
}

async function writeCommitReports(cwd: string, commits: CommitReportRecord[]): Promise<void> {
  const path = getCommitReportsPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ version: 1, commits } satisfies CommitReportIndex, null, 2)}\n`, "utf8");
}

async function writeCommitSkips(cwd: string, skips: CommitSkipRecord[]): Promise<void> {
  const path = getCommitSkipsPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ version: 1, skips } satisfies CommitSkipIndex, null, 2)}\n`, "utf8");
}

async function writeGitBootstrapRecords(cwd: string, records: GitBootstrapRecord[]): Promise<void> {
  const path = getGitBootstrapReportsPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ version: 1, records } satisfies GitBootstrapIndex, null, 2)}\n`, "utf8");
}

async function ensureScalerGitIgnore(cwd: string): Promise<boolean> {
  const path = `${cwd}/.git/info/exclude`;
  let current = "";
  try {
    current = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const existing = new Set(current.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
  const missing = scalerGitIgnoreRules.filter((rule) => !existing.has(rule));
  if (!missing.length) return false;
  const prefix = current.trim().length ? `${current.replace(/\s*$/, "\n")}\n` : "";
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${prefix}# SCALER runtime data\n${missing.join("\n")}\n`, "utf8");
  return true;
}

async function logCommitResult(cwd: string, state: ScalerState, taskId: string, result: GitCommitTaskResult): Promise<GitCommitTaskResult> {
  await logGitCommitAudit(cwd, state, {
    taskId,
    accepted: result.accepted,
    message: result.message,
    commitHash: result.commitHash,
    details: result,
  });
  return result;
}

function buildTaskCommitMessage(taskId: string, title: string | undefined): string {
  const cleanTitle = (title ?? "validated task").split("\n")[0]?.trim() || "validated task";
  return `${taskId}: ${cleanTitle}`;
}

function parsePorcelainPath(line: string): string {
  const path = line.slice(3).trim();
  const renameSeparator = " -> ";
  if (path.includes(renameSeparator)) return path.split(renameSeparator).at(-1) ?? path;
  return path;
}

function isRuntimePath(path: string): boolean {
  return path === ".scaler" || path.startsWith(".scaler/");
}

function isAllowedPath(path: string, allowedPathPrefixes: string[]): boolean {
  return allowedPathPrefixes.some((prefix) => {
    const normalized = prefix.replace(/^\.\//, "").replace(/\/$/, "");
    return path === normalized || path.startsWith(`${normalized}/`);
  });
}

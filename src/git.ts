import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";
import { logGitCommitAudit } from "./logging.js";
import { getCommitReportsPath } from "./paths.js";
import { loadValidationRuns, type ValidationRunRecord } from "./validation.js";
import type { ScalerState } from "./types.js";

const execFileAsync = promisify(execFile);

export type GitSafetyStatus = "clean" | "runtime_only" | "allowed" | "unrelated" | "not_git_repo";

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

export interface CommitReportIndex {
  version: 1;
  commits: CommitReportRecord[];
}

export async function getGitChangedPaths(cwd: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync("git", ["status", "--porcelain"], { cwd });
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

  if (!task) return logCommitResult(cwd, state, taskId, { accepted: false, message: `Task ${taskId} does not exist.`, safety });
  if (task.status !== "validated") {
    return logCommitResult(cwd, state, taskId, { accepted: false, message: `Task ${taskId} is not validated.`, safety });
  }
  if (safety.status === "not_git_repo" || safety.status === "unrelated") {
    return logCommitResult(cwd, state, taskId, { accepted: false, message: `Commit refused: ${safety.reason}`, safety });
  }
  if (safety.status === "clean" || safety.status === "runtime_only") {
    return logCommitResult(cwd, state, taskId, { accepted: false, message: `Commit skipped: ${safety.reason}`, safety });
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
    validation: await buildCommitValidationSummary(cwd, taskId),
  });
  return logCommitResult(cwd, state, taskId, {
    accepted: true,
    message: `Committed ${taskId}: ${commitHash}`,
    commitHash,
    safety,
    report,
  });
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

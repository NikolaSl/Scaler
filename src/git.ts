import { execFile } from "node:child_process";
import { promisify } from "node:util";

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

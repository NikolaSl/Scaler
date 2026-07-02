import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ScalerState, ScalerTaskState } from "./types.js";
import {
  getCurrentPrdPath,
  getPrdChangesPath,
  getPrdCoveragePath,
  getPrdDir,
  getPrdRequirementsPath,
  getPrdVersionsDir,
} from "./paths.js";

export const runtimePrdRequirementStatuses = ["pending", "in_progress", "implemented", "validated", "blocked", "needs_replan"] as const;

export type RuntimePrdRequirementStatus = (typeof runtimePrdRequirementStatuses)[number];

export interface RuntimePrdRequirement {
  id: string;
  statement: string;
  title?: string;
  source?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RuntimePrdRequirementsFile {
  version: 1;
  requirements: RuntimePrdRequirement[];
}

export interface RuntimePrdCoverageEntry {
  requirementId: string;
  status: RuntimePrdRequirementStatus;
  taskIds?: string[];
  evidenceRefs?: string[];
  notes?: string;
  updatedAt: string;
}

export interface RuntimePrdCoverageFile {
  version: 1;
  entries: RuntimePrdCoverageEntry[];
}

export interface RuntimePrdChangeRecord {
  timestamp: string;
  reason: string;
  source?: string;
  affectedRequirementIds?: string[];
  versionPath?: string;
}

export interface RuntimePrdComputedCoverageEntry {
  requirementId: string;
  status: RuntimePrdRequirementStatus;
  linkedTaskIds: string[];
  explicitStatus?: RuntimePrdRequirementStatus;
  evidenceRefs: string[];
  notes?: string;
}

export interface RuntimePrdCoverageSummary {
  entries: RuntimePrdComputedCoverageEntry[];
  countsByStatus: Record<RuntimePrdRequirementStatus, number>;
  unlinkedRequirementIds: string[];
  linkedRequirementIds: string[];
}

export function isRuntimePrdRequirementStatus(value: string): value is RuntimePrdRequirementStatus {
  return runtimePrdRequirementStatuses.includes(value as RuntimePrdRequirementStatus);
}

export function computePrdCoverageSummary(
  requirements: RuntimePrdRequirementsFile,
  coverage: RuntimePrdCoverageFile,
  state: ScalerState,
): RuntimePrdCoverageSummary {
  validatePrdCoverage(coverage);
  const entries = requirements.requirements.map((requirement) => {
    const explicit = coverage.entries.find((entry) => entry.requirementId === requirement.id);
    const taskLinkedIds = state.tasks.filter((task) => task.prdRefs?.includes(requirement.id)).map((task) => task.id);
    const linkedTaskIds = unique([...(explicit?.taskIds ?? []), ...taskLinkedIds]);
    const linkedTasks = state.tasks.filter((task) => linkedTaskIds.includes(task.id));
    return {
      requirementId: requirement.id,
      status: resolveComputedRequirementStatus(explicit, linkedTasks),
      linkedTaskIds,
      explicitStatus: explicit?.status,
      evidenceRefs: explicit?.evidenceRefs ?? [],
      notes: explicit?.notes,
    };
  });

  return {
    entries,
    countsByStatus: countCoverageStatuses(entries),
    unlinkedRequirementIds: entries.filter((entry) => entry.linkedTaskIds.length === 0).map((entry) => entry.requirementId),
    linkedRequirementIds: entries.filter((entry) => entry.linkedTaskIds.length > 0).map((entry) => entry.requirementId),
  };
}

export async function loadCurrentPrd(cwd: string): Promise<string> {
  try {
    return await readFile(getCurrentPrdPath(cwd), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

export async function saveCurrentPrd(cwd: string, content: string): Promise<void> {
  await mkdir(getPrdDir(cwd), { recursive: true });
  await writeFile(getCurrentPrdPath(cwd), content.endsWith("\n") ? content : `${content}\n`, "utf8");
}

export async function loadPrdRequirements(cwd: string): Promise<RuntimePrdRequirementsFile> {
  try {
    const raw = await readFile(getPrdRequirementsPath(cwd), "utf8");
    return JSON.parse(raw) as RuntimePrdRequirementsFile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: 1, requirements: [] };
    }
    throw error;
  }
}

export async function savePrdRequirements(cwd: string, requirements: RuntimePrdRequirementsFile): Promise<void> {
  await mkdir(getPrdDir(cwd), { recursive: true });
  await writeFile(getPrdRequirementsPath(cwd), `${JSON.stringify(requirements, null, 2)}\n`, "utf8");
}

export async function loadPrdCoverage(cwd: string): Promise<RuntimePrdCoverageFile> {
  try {
    const raw = await readFile(getPrdCoveragePath(cwd), "utf8");
    const coverage = JSON.parse(raw) as RuntimePrdCoverageFile;
    validatePrdCoverage(coverage);
    return coverage;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: 1, entries: [] };
    }
    throw error;
  }
}

export async function savePrdCoverage(cwd: string, coverage: RuntimePrdCoverageFile): Promise<void> {
  validatePrdCoverage(coverage);
  await mkdir(getPrdDir(cwd), { recursive: true });
  await writeFile(getPrdCoveragePath(cwd), `${JSON.stringify(coverage, null, 2)}\n`, "utf8");
}

export async function appendPrdChange(cwd: string, change: RuntimePrdChangeRecord): Promise<void> {
  await mkdir(getPrdDir(cwd), { recursive: true });
  await appendFile(getPrdChangesPath(cwd), `${JSON.stringify(change)}\n`, "utf8");
}

export async function loadPrdChanges(cwd: string): Promise<RuntimePrdChangeRecord[]> {
  try {
    const raw = await readFile(getPrdChangesPath(cwd), "utf8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as RuntimePrdChangeRecord);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export async function createPrdVersionSnapshot(cwd: string, input?: { content?: string; reason?: string; now?: Date }): Promise<string> {
  const versionsDir = getPrdVersionsDir(cwd);
  await mkdir(versionsDir, { recursive: true });
  const next = await getNextPrdVersionNumber(versionsDir);
  const fileName = `PRD-v${String(next).padStart(3, "0")}.md`;
  const content = input?.content ?? (await loadCurrentPrd(cwd));
  const absolutePath = join(versionsDir, fileName);
  const relativePath = `.scaler/prd/versions/${fileName}`;
  await writeFile(absolutePath, content.endsWith("\n") ? content : `${content}\n`, "utf8");

  if (input?.reason) {
    await appendPrdChange(cwd, {
      timestamp: (input.now ?? new Date()).toISOString(),
      reason: input.reason,
      versionPath: relativePath,
    });
  }

  return relativePath;
}

function resolveComputedRequirementStatus(
  explicit: RuntimePrdCoverageEntry | undefined,
  linkedTasks: ScalerTaskState[],
): RuntimePrdRequirementStatus {
  if (explicit?.status === "blocked" || explicit?.status === "needs_replan") {
    return explicit.status;
  }

  if (linkedTasks.some((task) => task.status === "validated")) {
    return "validated";
  }

  if (explicit) {
    return explicit.status;
  }

  if (linkedTasks.some((task) => task.status === "blocked")) return "blocked";
  if (linkedTasks.some((task) => task.status === "needs_replan" || task.status === "failed")) return "needs_replan";
  if (linkedTasks.some((task) => task.status === "running" || task.status === "validating" || task.status === "debugging")) return "in_progress";
  return "pending";
}

function countCoverageStatuses(entries: RuntimePrdComputedCoverageEntry[]): Record<RuntimePrdRequirementStatus, number> {
  const counts = Object.fromEntries(runtimePrdRequirementStatuses.map((status) => [status, 0])) as Record<RuntimePrdRequirementStatus, number>;
  for (const entry of entries) {
    counts[entry.status] += 1;
  }
  return counts;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function validatePrdCoverage(coverage: RuntimePrdCoverageFile): void {
  for (const entry of coverage.entries) {
    if (!isRuntimePrdRequirementStatus(entry.status)) {
      throw new Error(`Invalid runtime PRD requirement status: ${entry.status}`);
    }
  }
}

async function getNextPrdVersionNumber(versionsDir: string): Promise<number> {
  let entries: string[];
  try {
    entries = await readdir(versionsDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return 1;
    }
    throw error;
  }

  const max = entries.reduce((highest, entry) => {
    const match = /^PRD-v(\d+)\.md$/.exec(entry);
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0);
  return max + 1;
}

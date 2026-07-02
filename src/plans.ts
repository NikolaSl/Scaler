import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  getCurrentExecutionPlanPath,
  getExecutionPlansDir,
  getExecutionPlanVersionsDir,
} from "./paths.js";
import type { RuntimePrdRequirementsFile } from "./prd.js";
import type { ScalerState } from "./types.js";

export const executionPlanStatuses = ["draft", "active", "superseded", "completed"] as const;
export type ExecutionPlanStatus = (typeof executionPlanStatuses)[number];

export interface ExecutionPlanTask {
  id: string;
  title: string;
  description?: string;
  prdRefs?: string[];
  allowedPathPrefixes?: string[];
  dependsOn?: string[];
  validationRefs?: string[];
}

export interface ExecutionPlanArtifact {
  version: 1;
  planVersion: number;
  status: ExecutionPlanStatus;
  title?: string;
  source?: string;
  tasks: ExecutionPlanTask[];
  createdAt: string;
  updatedAt: string;
}

export interface ExecutionPlanSummary {
  planVersion: number;
  status: ExecutionPlanStatus;
  plannedTaskCount: number;
  createdTaskCount: number;
  missingTaskIds: string[];
  validatedPlannedTaskCount: number;
  linkedRequirementIds: string[];
  unlinkedRequirementIds: string[];
  planUnlinkedTaskIds: string[];
}

export function createEmptyExecutionPlan(now = new Date()): ExecutionPlanArtifact {
  const timestamp = now.toISOString();
  return {
    version: 1,
    planVersion: 0,
    status: "draft",
    tasks: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function validateExecutionPlan(plan: ExecutionPlanArtifact): void {
  if (plan.version !== 1) throw new Error(`Unsupported execution plan version: ${String(plan.version)}`);
  if (!executionPlanStatuses.includes(plan.status)) throw new Error(`Invalid execution plan status: ${String(plan.status)}`);
  const taskIds = new Set<string>();
  for (const task of plan.tasks) {
    if (!task.id.trim()) throw new Error("Execution plan task id is required.");
    if (taskIds.has(task.id)) throw new Error(`Duplicate execution plan task id: ${task.id}`);
    taskIds.add(task.id);
    if (!task.title.trim()) throw new Error(`Execution plan task ${task.id} title is required.`);
  }
}

export async function loadExecutionPlan(cwd: string): Promise<ExecutionPlanArtifact> {
  try {
    const raw = await readFile(getCurrentExecutionPlanPath(cwd), "utf8");
    const plan = JSON.parse(raw) as ExecutionPlanArtifact;
    validateExecutionPlan(plan);
    return plan;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return createEmptyExecutionPlan();
    throw error;
  }
}

export async function saveExecutionPlan(cwd: string, plan: ExecutionPlanArtifact, now = new Date()): Promise<ExecutionPlanArtifact> {
  const timestamp = now.toISOString();
  const normalized: ExecutionPlanArtifact = {
    ...plan,
    updatedAt: timestamp,
    tasks: plan.tasks.map((task) => ({
      ...task,
      prdRefs: normalizeList(task.prdRefs),
      allowedPathPrefixes: normalizePathList(task.allowedPathPrefixes),
      dependsOn: normalizeList(task.dependsOn),
      validationRefs: normalizeList(task.validationRefs),
    })),
  };
  validateExecutionPlan(normalized);
  await mkdir(getExecutionPlansDir(cwd), { recursive: true });
  await writeFile(getCurrentExecutionPlanPath(cwd), `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return normalized;
}

export function summarizeExecutionPlan(
  plan: ExecutionPlanArtifact,
  requirements: RuntimePrdRequirementsFile,
  state: ScalerState,
): ExecutionPlanSummary {
  validateExecutionPlan(plan);
  const stateTaskIds = new Set(state.tasks.map((task) => task.id));
  const validatedTaskIds = new Set(state.tasks.filter((task) => task.status === "validated").map((task) => task.id));
  const planRequirementIds = new Set(plan.tasks.flatMap((task) => task.prdRefs ?? []));
  const requirementIds = requirements.requirements.map((requirement) => requirement.id);

  return {
    planVersion: plan.planVersion,
    status: plan.status,
    plannedTaskCount: plan.tasks.length,
    createdTaskCount: plan.tasks.filter((task) => stateTaskIds.has(task.id)).length,
    missingTaskIds: plan.tasks.filter((task) => !stateTaskIds.has(task.id)).map((task) => task.id),
    validatedPlannedTaskCount: plan.tasks.filter((task) => validatedTaskIds.has(task.id)).length,
    linkedRequirementIds: requirementIds.filter((id) => planRequirementIds.has(id)),
    unlinkedRequirementIds: requirementIds.filter((id) => !planRequirementIds.has(id)),
    planUnlinkedTaskIds: plan.tasks.filter((task) => !task.prdRefs || task.prdRefs.length === 0).map((task) => task.id),
  };
}

export function formatExecutionPlanSummary(summary: ExecutionPlanSummary): string {
  const lines = [
    `Execution plan: version=${summary.planVersion} status=${summary.status} tasks=${summary.plannedTaskCount}`,
    `Tasks: created=${summary.createdTaskCount} missing=${summary.missingTaskIds.length} validated=${summary.validatedPlannedTaskCount}`,
    `Requirements: linked=${summary.linkedRequirementIds.length} unlinked=${summary.unlinkedRequirementIds.length}`,
  ];
  if (summary.missingTaskIds.length > 0) lines.push(`Missing tasks: ${summary.missingTaskIds.join(", ")}`);
  if (summary.planUnlinkedTaskIds.length > 0) lines.push(`Plan tasks without PRD refs: ${summary.planUnlinkedTaskIds.join(", ")}`);
  if (summary.unlinkedRequirementIds.length > 0) lines.push(`Unlinked requirements: ${summary.unlinkedRequirementIds.join(", ")}`);
  return lines.join("\n");
}

export async function createExecutionPlanSnapshot(
  cwd: string,
  input?: { plan?: ExecutionPlanArtifact; now?: Date },
): Promise<string> {
  const versionsDir = getExecutionPlanVersionsDir(cwd);
  await mkdir(versionsDir, { recursive: true });
  const next = await getNextPlanVersionNumber(versionsDir);
  const fileName = `PLAN-v${String(next).padStart(3, "0")}.json`;
  const plan = input?.plan ?? (await loadExecutionPlan(cwd));
  validateExecutionPlan(plan);
  const absolutePath = join(versionsDir, fileName);
  await writeFile(absolutePath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  return `.scaler/plans/versions/${fileName}`;
}

async function getNextPlanVersionNumber(versionsDir: string): Promise<number> {
  try {
    const files = await readdir(versionsDir);
    const numbers = files
      .map((file) => /^PLAN-v(\d+)\.json$/.exec(file)?.[1])
      .filter((value): value is string => Boolean(value))
      .map((value) => Number(value));
    return numbers.length === 0 ? 1 : Math.max(...numbers) + 1;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 1;
    throw error;
  }
}

function normalizeList(values: string[] | undefined): string[] | undefined {
  const normalized = (values ?? []).map((value) => value.trim()).filter((value) => value.length > 0);
  return normalized.length > 0 ? [...new Set(normalized)] : undefined;
}

function normalizePathList(values: string[] | undefined): string[] | undefined {
  const normalized = (values ?? [])
    .map((value) => value.trim().replace(/^\.\//, "").replace(/\/$/, ""))
    .filter((value) => value.length > 0);
  return normalized.length > 0 ? [...new Set(normalized)] : undefined;
}

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  getCurrentExecutionPlanPath,
  getExecutionPlansDir,
  getExecutionPlanVersionsDir,
} from "./paths.js";

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

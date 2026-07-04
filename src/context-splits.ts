import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { CompressionAssessment } from "./compression.js";
import type { ResolvedContext } from "./context.js";
import { getContextSplitsPath } from "./paths.js";
import type { ScalerState } from "./types.js";

export interface ContextSplitRecord {
  id: string;
  taskId: string;
  estimatedTokens: number;
  activeContextLimitTokens: number;
  overByTokens: number;
  includedItemIds: string[];
  exactRefs: string[];
  summaryOkRefs: string[];
  referenceOnlyRefs: string[];
  externalizeRefs: string[];
  minimalContextItemIds: string[];
  recommendations: string[];
  createdAt: string;
}

interface ContextSplitIndex {
  version: 1;
  splits: ContextSplitRecord[];
}

export async function loadContextSplitRecords(cwd: string): Promise<ContextSplitRecord[]> {
  try {
    const raw = await readFile(getContextSplitsPath(cwd), "utf8");
    return (JSON.parse(raw) as ContextSplitIndex).splits;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function recordContextSplitIfNeeded(
  cwd: string,
  state: ScalerState,
  taskId: string,
  resolvedContext: ResolvedContext,
  assessment: CompressionAssessment,
  now = new Date(),
): Promise<ContextSplitRecord | undefined> {
  if (!assessment.splitRecommended) return undefined;
  const record = buildContextSplitRecord(state, taskId, resolvedContext, assessment, now);
  await writeContextSplitRecords(cwd, [record, ...(await loadContextSplitRecords(cwd))]);
  return record;
}

export function buildContextSplitRecord(
  state: ScalerState,
  taskId: string,
  resolvedContext: ResolvedContext,
  assessment: CompressionAssessment,
  now = new Date(),
): ContextSplitRecord {
  const requiredIds = resolvedContext.included.filter((item) => item.priority === "required").map((item) => item.id);
  const exactRequiredIds = assessment.exactRefs.filter((id) => requiredIds.includes(id));
  const referenceIds = assessment.referenceOnlyRefs;
  return {
    id: `${taskId}-context-split-${now.getTime()}`,
    taskId,
    estimatedTokens: assessment.estimatedTokens,
    activeContextLimitTokens: assessment.policy.activeContextLimitTokens,
    overByTokens: assessment.overByTokens,
    includedItemIds: resolvedContext.included.map((item) => item.id),
    exactRefs: assessment.exactRefs,
    summaryOkRefs: assessment.summaryOkRefs,
    referenceOnlyRefs: assessment.referenceOnlyRefs,
    externalizeRefs: assessment.externalizeRefs,
    minimalContextItemIds: [...new Set([...exactRequiredIds, ...referenceIds, ...assessment.externalizeRefs])],
    recommendations: [
      ...assessment.recommendations,
      `Prepare a fresh minimal-context task-agent handoff for ${taskId} with exact required refs plus references to externalized large items.`,
      `Supervisor stage at split: ${state.stage}.`,
    ],
    createdAt: now.toISOString(),
  };
}

export function formatContextSplitRecords(records: ContextSplitRecord[], taskId?: string, limit = 20): string {
  const filtered = taskId ? records.filter((record) => record.taskId === taskId) : records;
  if (filtered.length === 0) return taskId ? `No context split records for ${taskId}.` : "No context split records.";
  const lines = [taskId ? `Context split records for ${taskId}:` : "Context split records:"];
  for (const record of filtered.slice(0, limit)) {
    lines.push(`- ${record.id}: task=${record.taskId} estimated=${record.estimatedTokens} target=${record.activeContextLimitTokens} over=${record.overByTokens}`);
    if (record.externalizeRefs.length > 0) lines.push(`  externalize=${record.externalizeRefs.join(",")}`);
    if (record.minimalContextItemIds.length > 0) lines.push(`  minimal=${record.minimalContextItemIds.join(",")}`);
  }
  return lines.join("\n");
}

async function writeContextSplitRecords(cwd: string, splits: ContextSplitRecord[]): Promise<void> {
  const path = getContextSplitsPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ version: 1, splits } satisfies ContextSplitIndex, null, 2)}\n`, "utf8");
}

/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { CompressionAssessment } from "./compression.js";
import type { ContextItem, ResolvedContext } from "./context.js";
import { writeMemory } from "./memory.js";
import { getContextSplitsPath } from "./paths.js";
import type { ScalerState } from "./types.js";

export interface ExternalizedContextRef {
  itemId: string;
  memoryId: string;
  path: string;
  exactness: string;
  scope: string;
  originalTokens: number;
  replacementTokens: number;
  sha256: string;
  createdAt: string;
}

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
  externalizedMemoryRefs: ExternalizedContextRef[];
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
  const baseRecord = buildContextSplitRecord(state, taskId, resolvedContext, assessment, now);
  const externalizedMemoryRefs = await externalizeContextSplitItems(cwd, baseRecord, resolvedContext, now);
  const record: ContextSplitRecord = { ...baseRecord, externalizedMemoryRefs };
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
    externalizedMemoryRefs: [],
    minimalContextItemIds: [...new Set([...exactRequiredIds, ...referenceIds, ...assessment.externalizeRefs])],
    recommendations: [
      ...assessment.recommendations,
      `Prepare a fresh minimal-context task-agent handoff for ${taskId} with exact required refs plus references to externalized large items.`,
      `Supervisor stage at split: ${state.stage}.`,
    ],
    createdAt: now.toISOString(),
  };
}

export async function externalizeContextSplitItems(
  cwd: string,
  record: ContextSplitRecord,
  resolvedContext: ResolvedContext,
  now = new Date(),
): Promise<ExternalizedContextRef[]> {
  const refs: ExternalizedContextRef[] = [];
  const itemsById = new Map(resolvedContext.included.map((item) => [item.id, item]));

  for (const itemId of record.externalizeRefs) {
    const item = itemsById.get(itemId);
    if (!item || !item.content) continue;
    const entry = await writeMemory(cwd, {
      title: `Context split ${record.taskId} ${item.id}`,
      source: `context-split:${record.id}`,
      taskId: record.taskId,
      tags: ["context-externalized", record.taskId, item.id, item.type],
      validity: "active",
      summary: buildExternalizedSummary(record, item),
      content: formatExternalizedContextMemory(record, item),
      now,
    });
    refs.push({
      itemId: item.id,
      memoryId: entry.id,
      path: entry.path,
      exactness: item.exactness ?? "exact",
      scope: item.scope,
      originalTokens: estimateContextItemTokens(item),
      replacementTokens: estimateReplacementTokens(entry.id, entry.path),
      sha256: createHash("sha256").update(item.content).digest("hex"),
      createdAt: now.toISOString(),
    });
  }

  return refs;
}

export function formatContextSplitRecords(records: ContextSplitRecord[], taskId?: string, limit = 20): string {
  const filtered = taskId ? records.filter((record) => record.taskId === taskId) : records;
  if (filtered.length === 0) return taskId ? `No context split records for ${taskId}.` : "No context split records.";
  const lines = [taskId ? `Context split records for ${taskId}:` : "Context split records:"];
  for (const record of filtered.slice(0, limit)) {
    lines.push(`- ${record.id}: task=${record.taskId} estimated=${record.estimatedTokens} target=${record.activeContextLimitTokens} over=${record.overByTokens}`);
    if (record.externalizeRefs.length > 0) lines.push(`  externalize=${record.externalizeRefs.join(",")}`);
    if ((record.externalizedMemoryRefs ?? []).length > 0) lines.push(`  memory=${record.externalizedMemoryRefs.map((ref) => `${ref.itemId}->${ref.memoryId}`).join(",")}`);
    if (record.minimalContextItemIds.length > 0) lines.push(`  minimal=${record.minimalContextItemIds.join(",")}`);
  }
  return lines.join("\n");
}

function buildExternalizedSummary(record: ContextSplitRecord, item: ContextItem): string {
  return `Externalized ${item.exactness ?? "exact"} ${item.type} context item ${item.id} for task ${record.taskId} and split ${record.id}; original estimate ${estimateContextItemTokens(item)} tokens.`;
}

function formatExternalizedContextMemory(record: ContextSplitRecord, item: ContextItem): string {
  return [
    `# Externalized Context Item ${item.id}`,
    "",
    `- taskId: ${record.taskId}`,
    `- splitId: ${record.id}`,
    `- type: ${item.type}`,
    `- scope: ${item.scope}`,
    `- exactness: ${item.exactness ?? "exact"}`,
    `- priority: ${item.priority}`,
    `- reason: ${item.reason}`,
    `- sha256: ${createHash("sha256").update(item.content ?? "").digest("hex")}`,
    "",
    "## Content",
    "",
    item.content ?? "",
  ].join("\n");
}

function estimateContextItemTokens(item: ContextItem): number {
  return item.estimatedTokens ?? Math.ceil((item.content ?? "").length / 4);
}

function estimateReplacementTokens(memoryId: string, path: string): number {
  return Math.ceil(`memory:${memoryId} path:${path}`.length / 4);
}

async function writeContextSplitRecords(cwd: string, splits: ContextSplitRecord[]): Promise<void> {
  const path = getContextSplitsPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ version: 1, splits } satisfies ContextSplitIndex, null, 2)}\n`, "utf8");
}

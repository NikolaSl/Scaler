/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { normalizeExactness, type CompressionAssessment } from "./compression.js";
import type { ContextItem, ResolvedContext } from "./context.js";
import { loadMemoryIndex, writeMemory } from "./memory.js";
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

export interface ContextSplitDispatchProjection {
  accepted: boolean;
  contextItems: ContextItem[];
  diagnostics: string[];
}

export async function loadContextSplitRecords(cwd: string): Promise<ContextSplitRecord[]> {
  try {
    const raw = await readFile(getContextSplitsPath(cwd), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Invalid context split index.");
    }
    const index = parsed as Partial<ContextSplitIndex>;
    if (index.version !== 1 || !Array.isArray(index.splits)) {
      throw new Error("Invalid context split index.");
    }
    return index.splits;
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
      exactness: normalizeExactness(item.exactness, item.scope),
      scope: item.scope,
      originalTokens: estimateContextItemTokens(item),
      replacementTokens: estimateReplacementTokens(entry.id, entry.path),
      sha256: createHash("sha256").update(item.content).digest("hex"),
      createdAt: now.toISOString(),
    });
  }

  return refs;
}

export async function projectContextSplitForDispatch(
  cwd: string,
  taskId: string,
  resolvedContext: ResolvedContext,
  split: ContextSplitRecord,
): Promise<ContextSplitDispatchProjection> {
  const diagnostics = validateContextSplitProjection(taskId, resolvedContext, split);
  if (diagnostics.length > 0) return { accepted: false, contextItems: [], diagnostics };

  const sources = new Map<string, { ref: ExternalizedContextRef; binding: ContextItem["fileSource"] }>();
  for (const ref of split.externalizedMemoryRefs) {
    const verified = await verifyExternalizedDispatchSource(cwd, split, ref, resolvedContext);
    if (!verified) {
      diagnostics.push(`Context split ${split.id} externalized source ${ref.itemId} is unavailable or changed.`);
      continue;
    }
    sources.set(ref.itemId, { ref, binding: verified });
  }
  if (diagnostics.length > 0) return { accepted: false, contextItems: [], diagnostics };

  const selectedIds = new Set([
    ...resolvedContext.included.filter((item) => item.priority === "required").map((item) => item.id),
    ...split.minimalContextItemIds,
  ]);
  const projected: ContextItem[] = [];
  const reservedIds = new Set(resolvedContext.included.map((item) => item.id));
  for (const item of resolvedContext.included) {
    if (!selectedIds.has(item.id)) continue;
    const source = sources.get(item.id);
    if (!source) {
      projected.push({ ...item, fileSource: item.fileSource ? { ...item.fileSource } : undefined });
      continue;
    }
    const referenceContent = formatExternalizedDispatchReference(source.ref);
    projected.push({
      ...item,
      content: referenceContent,
      scope: "reference-only",
      exactness: "reference-only",
      estimatedTokens: Math.ceil(referenceContent.length / 4),
      fileSource: item.fileSource ? { ...item.fileSource } : source.binding,
    });
    if (item.fileSource) {
      const bindingId = `context-split-source:${split.id}:${item.id}`;
      if (reservedIds.has(bindingId)) {
        return {
          accepted: false,
          contextItems: [],
          diagnostics: [`Context split ${split.id} integrity binding id collides with context item ${bindingId}.`],
        };
      }
      reservedIds.add(bindingId);
      projected.push({
        id: bindingId,
        type: "memory",
        reason: `Freshness binding for externalized context item ${item.id}.`,
        content: `Integrity source for ${item.id}: ${source.ref.memoryId} (${source.ref.path}).`,
        priority: "required",
        scope: "reference-only",
        exactness: "reference-only",
        fileSource: { ...source.binding!, itemId: bindingId },
      });
    }
  }

  return { accepted: true, contextItems: projected, diagnostics: [] };
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
  return `Externalized ${normalizeExactness(item.exactness, item.scope)} ${item.type} context item ${item.id} for task ${record.taskId} and split ${record.id}; original estimate ${estimateContextItemTokens(item)} tokens.`;
}

function formatExternalizedContextMemory(record: ContextSplitRecord, item: ContextItem): string {
  return [
    `# Externalized Context Item ${item.id}`,
    "",
    `- taskId: ${record.taskId}`,
    `- splitId: ${record.id}`,
    `- type: ${item.type}`,
    `- scope: ${item.scope}`,
    `- exactness: ${normalizeExactness(item.exactness, item.scope)}`,
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

function validateContextSplitProjection(
  taskId: string,
  resolvedContext: ResolvedContext,
  split: ContextSplitRecord,
): string[] {
  const diagnostics: string[] = [];
  const includedIds = resolvedContext.included.map((item) => item.id);
  if (!split.id || split.taskId !== taskId) diagnostics.push("Context split task identity is missing or changed.");
  if (JSON.stringify(split.includedItemIds) !== JSON.stringify(includedIds)) {
    diagnostics.push(`Context split ${split.id} does not cover the current resolved context identity.`);
  }
  if (new Set(includedIds).size !== includedIds.length
      || new Set(split.minimalContextItemIds).size !== split.minimalContextItemIds.length
      || new Set(split.externalizeRefs).size !== split.externalizeRefs.length) {
    diagnostics.push(`Context split ${split.id} contains duplicate item identities.`);
  }
  if (!split.minimalContextItemIds.every((id) => includedIds.includes(id))) {
    diagnostics.push(`Context split ${split.id} minimal context contains a foreign item.`);
  }
  const refIds = split.externalizedMemoryRefs.map((ref) => ref.itemId);
  if (new Set(refIds).size !== refIds.length
      || split.externalizeRefs.length !== refIds.length
      || !split.externalizeRefs.every((id) => refIds.includes(id))) {
    diagnostics.push(`Context split ${split.id} externalized reference coverage is incomplete.`);
  }
  return diagnostics;
}

async function verifyExternalizedDispatchSource(
  cwd: string,
  split: ContextSplitRecord,
  ref: ExternalizedContextRef,
  resolvedContext: ResolvedContext,
): Promise<ContextItem["fileSource"] | undefined> {
  try {
    if (!ref.itemId || !ref.memoryId || !ref.path || !/^[0-9a-f]{64}$/.test(ref.sha256)
        || !["exact", "summary-ok"].includes(ref.exactness)
        || !["full", "section", "snippet", "summary", "reference-only"].includes(ref.scope)
        || !Number.isSafeInteger(ref.originalTokens) || ref.originalTokens <= 0
        || !Number.isSafeInteger(ref.replacementTokens) || ref.replacementTokens <= 0
        || !Number.isFinite(Date.parse(ref.createdAt))
        || !split.externalizeRefs.includes(ref.itemId)) return undefined;
    const item = resolvedContext.included.find((candidate) => candidate.id === ref.itemId);
    if (!item || item.available === false || item.scope !== ref.scope
        || normalizeExactness(item.exactness, item.scope) !== ref.exactness
        || createHash("sha256").update(item.content).digest("hex") !== ref.sha256) return undefined;

    const memory = await loadMemoryIndex(cwd);
    const entry = memory.entries.find((candidate) => candidate.id === ref.memoryId);
    if (!entry || entry.path !== ref.path || entry.taskId !== split.taskId
        || entry.source !== `context-split:${split.id}` || entry.validity !== "active"
        || !entry.tags?.includes("context-externalized")
        || !entry.tags.includes(split.taskId.toLowerCase())
        || !entry.tags.includes(ref.itemId.toLowerCase())) return undefined;
    const normalizedPath = ref.path.replace(/\\/g, "/").replace(/^\.\//, "");
    if (!normalizedPath.startsWith(".scaler/memory/") || normalizedPath.includes("/../")) return undefined;
    const root = await realpath(cwd);
    const absolute = isAbsolute(ref.path) ? resolve(ref.path) : resolve(cwd, ref.path);
    if (!pathIsWithin(root, absolute)) return undefined;
    const stats = await lstat(absolute);
    if (!stats.isFile() || stats.isSymbolicLink()) return undefined;
    const canonical = await realpath(absolute);
    if (!pathIsWithin(root, canonical)) return undefined;
    const raw = await readFile(canonical, "utf8");
    const marker = "\n## Content\n\n";
    const markerIndex = raw.indexOf(marker);
    if (markerIndex < 0) return undefined;
    const identity = new Set(raw.slice(0, markerIndex).split("\n"));
    if (!identity.has(`# Externalized Context Item ${ref.itemId}`)
        || !identity.has(`- taskId: ${split.taskId}`)
        || !identity.has(`- splitId: ${split.id}`)
        || !identity.has(`- sha256: ${ref.sha256}`)) return undefined;
    const storedContent = raw.slice(markerIndex + marker.length, raw.endsWith("\n") ? -1 : undefined);
    if (createHash("sha256").update(storedContent).digest("hex") !== ref.sha256) return undefined;
    return {
      itemId: ref.itemId,
      path: normalizedPath,
      scope: "full",
      contentFingerprint: `sha256:${createHash("sha256").update(raw).digest("hex")}`,
      outputExemptible: false,
    };
  } catch {
    return undefined;
  }
}

function formatExternalizedDispatchReference(ref: ExternalizedContextRef): string {
  return [
    `Externalized context reference for ${ref.itemId}.`,
    `Memory ID: ${ref.memoryId}`,
    `Path: ${ref.path}`,
    `Original exactness: ${ref.exactness}`,
    `Original content SHA-256: ${ref.sha256}`,
    "Retrieve and verify the referenced source only if its exact bytes are required for the task.",
  ].join("\n");
}

function pathIsWithin(root: string, candidate: string): boolean {
  const offset = relative(root, candidate);
  return offset === "" || (!offset.startsWith("..") && !isAbsolute(offset));
}

async function writeContextSplitRecords(cwd: string, splits: ContextSplitRecord[]): Promise<void> {
  const path = getContextSplitsPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ version: 1, splits } satisfies ContextSplitIndex, null, 2)}\n`, "utf8");
}

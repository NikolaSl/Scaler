/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from "node:crypto";
import { appendFile, mkdir, open, readFile, readdir, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { ScalerState, ScalerTaskState } from "./types.js";
import {
  getCurrentPrdPath,
  getPrdChangesPath,
  getPrdCoveragePath,
  getPrdDir,
  getPrdRequirementsPath,
  getPrdRequirementsLockPath,
  getPrdVersionsDir,
} from "./paths.js";

export const runtimePrdRequirementStatuses = ["pending", "in_progress", "implemented", "validated", "blocked", "needs_replan"] as const;

export type RuntimePrdRequirementStatus = (typeof runtimePrdRequirementStatuses)[number];

export interface RuntimePrdAcceptanceCriterion {
  id: string;
  statement: string;
  validationTaskId: string;
  commandId: string;
  participantTaskIds: string[];
}

export interface RuntimePrdRequirement {
  id: string;
  statement: string;
  title?: string;
  source?: string;
  acceptanceCriteria?: RuntimePrdAcceptanceCriterion[];
  revision?: number;
  versionHistory?: RuntimePrdRequirementVersion[];
  createdAt: string;
  updatedAt: string;
}

export interface RuntimePrdRequirementVersion {
  revision: number;
  statement: string;
  title?: string;
  source?: string;
  acceptanceCriteria?: RuntimePrdAcceptanceCriterion[];
  recordedAt: string;
  authority: {
    kind: "legacy_unknown" | "normalized_input" | "user_command";
    reason?: string;
  };
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

export interface UpsertPrdRequirementInput {
  id: string;
  statement: string;
  title?: string;
  source?: string;
  acceptanceCriteria?: RuntimePrdAcceptanceCriterion[];
  status?: RuntimePrdRequirementStatus;
  taskIds?: string[];
  evidenceRefs?: string[];
  notes?: string;
  now?: Date;
}

export interface AmendPrdRequirementInput {
  id: string;
  expectedRevision: number;
  reason: string;
  changes: {
    statement?: string;
    title?: string | null;
    source?: string | null;
    acceptanceCriteria?: RuntimePrdAcceptanceCriterion[];
  };
  now?: Date;
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

export function formatPrdCoverageSummary(requirements: RuntimePrdRequirementsFile, summary: RuntimePrdCoverageSummary): string {
  const countParts = runtimePrdRequirementStatuses.map((status) => `${status}=${summary.countsByStatus[status]}`).join(" ");
  const lines = [`Runtime PRD coverage: requirements=${requirements.requirements.length} ${countParts}`];
  if (summary.unlinkedRequirementIds.length > 0) {
    lines.push(`Unlinked requirements: ${summary.unlinkedRequirementIds.join(", ")}`);
  }
  for (const entry of summary.entries) {
    const linked = entry.linkedTaskIds.length > 0 ? ` tasks=${entry.linkedTaskIds.join(",")}` : " tasks=none";
    lines.push(`- ${entry.requirementId}: ${entry.status}${linked}`);
  }
  return lines.join("\n");
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
  return loadPrdRequirementsUnlocked(cwd);
}

async function loadPrdRequirementsUnlocked(cwd: string): Promise<RuntimePrdRequirementsFile> {
  try {
    const raw = await readFile(getPrdRequirementsPath(cwd), "utf8");
    const requirements = JSON.parse(raw) as RuntimePrdRequirementsFile;
    return normalizePrdRequirementsFile(requirements);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: 1, requirements: [] };
    }
    throw error;
  }
}

export async function savePrdRequirements(cwd: string, requirements: RuntimePrdRequirementsFile): Promise<void> {
  await withPrdRequirementsLock(cwd, async () => {
    const normalized = normalizePrdRequirementsFile(requirements);
    assertCatalogDoesNotRollBack(await loadPrdRequirementsUnlocked(cwd), normalized);
    await savePrdRequirementsUnlocked(cwd, normalized);
  });
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
  await withPrdRequirementsLock(cwd, async () => savePrdCoverageUnlocked(cwd, coverage));
}

export async function upsertPrdRequirement(cwd: string, input: UpsertPrdRequirementInput): Promise<RuntimePrdRequirement> {
  const [requirement] = await applyPrdRequirementUpserts(cwd, [input]);
  return requirement!;
}

export async function applyPrdRequirementUpserts(
  cwd: string,
  inputs: UpsertPrdRequirementInput[],
): Promise<RuntimePrdRequirement[]> {
  if (inputs.length === 0) return [];
  return withPrdRequirementsLock(cwd, async () => applyPrdRequirementUpsertsLocked(cwd, inputs));
}

async function applyPrdRequirementUpsertsLocked(
  cwd: string,
  inputs: UpsertPrdRequirementInput[],
): Promise<RuntimePrdRequirement[]> {
  const duplicate = inputs.find((input, index) => inputs.findIndex((candidate) => candidate.id === input.id) !== index);
  if (duplicate) throw new Error(`Invalid runtime PRD requirements: duplicate id ${duplicate.id}.`);
  const current = await loadPrdRequirementsUnlocked(cwd);
  const byId = new Map(current.requirements.map((requirement) => [requirement.id, requirement]));
  const coverage = inputs.some((input) => input.status) ? await loadPrdCoverage(cwd) : undefined;
  const coverageById = new Map(coverage?.entries.map((entry) => [entry.requirementId, entry]) ?? []);
  const updated: RuntimePrdRequirement[] = [];
  const changes: RuntimePrdChangeRecord[] = [];
  for (const input of inputs) {
    if (input.status && !isRuntimePrdRequirementStatus(input.status)) {
      throw new Error(`Invalid runtime PRD requirement status: ${input.status}`);
    }

    const timestamp = (input.now ?? new Date()).toISOString();
    const existing = byId.get(input.id);
    const acceptanceCriteria = input.acceptanceCriteria === undefined
      ? existing?.acceptanceCriteria
      : normalizePrdAcceptanceCriteria(input.acceptanceCriteria);
    const proposedContent = {
      statement: requiredRequirementString(input.statement, "statement"),
      title: input.title ?? existing?.title,
      source: input.source ?? existing?.source,
      acceptanceCriteria,
    };
    assertModelRouteRequirementChangeAllowed(existing, proposedContent);
    const revision = existing?.revision ?? 1;
    const history = existing?.versionHistory ?? [];
    const requirement: RuntimePrdRequirement = {
      id: input.id,
      ...proposedContent,
      revision,
      versionHistory: history.length > 0 ? history : [requirementVersion({
        ...proposedContent,
        revision,
        recordedAt: existing?.createdAt ?? timestamp,
        authority: { kind: existing ? "legacy_unknown" : "normalized_input" },
      })],
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: existing && sameRequirementContent(existing, proposedContent) ? existing.updatedAt : timestamp,
    };
    byId.set(input.id, requirement);
    updated.push(requirement);

    if (input.status) {
      const existingCoverage = coverageById.get(input.id);
      coverageById.set(input.id, {
        requirementId: input.id,
        status: input.status,
        taskIds: input.taskIds ?? existingCoverage?.taskIds,
        evidenceRefs: input.evidenceRefs ?? existingCoverage?.evidenceRefs,
        notes: input.notes ?? existingCoverage?.notes,
        updatedAt: timestamp,
      });
    }

    changes.push({
      timestamp,
      reason: `Requirement upserted: ${input.id}`,
      source: input.source,
      affectedRequirementIds: [input.id],
    });
  }
  await savePrdRequirementsUnlocked(cwd, { version: 1, requirements: [...byId.values()] });
  if (coverage) await savePrdCoverageUnlocked(cwd, { version: 1, entries: [...coverageById.values()] });
  for (const change of changes) await appendPrdChange(cwd, change);
  return updated;
}

export async function amendPrdRequirement(cwd: string, input: AmendPrdRequirementInput): Promise<RuntimePrdRequirement> {
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) {
    throw new Error("Runtime PRD amendment expectedRevision must be a positive integer.");
  }
  const reason = input.reason.trim();
  if (!reason) throw new Error("Runtime PRD amendment reason is required.");
  if (Object.keys(input.changes).length === 0) throw new Error("Runtime PRD amendment changes are required.");
  if (input.changes.statement !== undefined && typeof input.changes.statement !== "string") {
    throw new Error("Runtime PRD amendment statement must be a string.");
  }
  if (input.changes.title !== undefined && input.changes.title !== null && typeof input.changes.title !== "string") {
    throw new Error("Runtime PRD amendment title must be a string or null.");
  }
  if (input.changes.source !== undefined && input.changes.source !== null && typeof input.changes.source !== "string") {
    throw new Error("Runtime PRD amendment source must be a string or null.");
  }
  if (input.changes.acceptanceCriteria !== undefined && !Array.isArray(input.changes.acceptanceCriteria)) {
    throw new Error("Runtime PRD amendment acceptanceCriteria must be an array.");
  }

  return withPrdRequirementsLock(cwd, async () => amendPrdRequirementLocked(cwd, input, reason));
}

async function amendPrdRequirementLocked(
  cwd: string,
  input: AmendPrdRequirementInput,
  reason: string,
): Promise<RuntimePrdRequirement> {
  const requirements = await loadPrdRequirementsUnlocked(cwd);
  const existing = requirements.requirements.find((requirement) => requirement.id === input.id);
  if (!existing) throw new Error(`Runtime PRD requirement not found: ${input.id}.`);
  const revision = existing.revision ?? 1;
  if (revision !== input.expectedRevision) {
    throw new Error(`Stale runtime PRD amendment for ${input.id}: expected revision ${input.expectedRevision}, current revision ${revision}.`);
  }
  const timestamp = (input.now ?? new Date()).toISOString();
  const proposedContent = {
    statement: input.changes.statement === undefined
      ? existing.statement
      : requiredRequirementString(input.changes.statement, "statement"),
    title: input.changes.title === undefined ? existing.title : input.changes.title ?? undefined,
    source: input.changes.source === undefined ? existing.source : input.changes.source ?? undefined,
    acceptanceCriteria: input.changes.acceptanceCriteria === undefined
      ? existing.acceptanceCriteria
      : normalizePrdAcceptanceCriteria(input.changes.acceptanceCriteria),
  };
  if (sameRequirementContent(existing, proposedContent)) {
    throw new Error(`Runtime PRD amendment for ${input.id} does not change requirement content.`);
  }
  const nextRevision = revision + 1;
  const requirement: RuntimePrdRequirement = {
    id: existing.id,
    ...proposedContent,
    revision: nextRevision,
    versionHistory: [
      ...(existing.versionHistory ?? [requirementVersion({
        ...existing,
        revision,
        recordedAt: existing.createdAt,
        authority: { kind: "legacy_unknown" },
      })]),
      requirementVersion({
        ...proposedContent,
        revision: nextRevision,
        recordedAt: timestamp,
        authority: { kind: "user_command", reason },
      }),
    ],
    createdAt: existing.createdAt,
    updatedAt: timestamp,
  };
  await savePrdRequirementsUnlocked(cwd, {
    version: 1,
    requirements: [...requirements.requirements.filter((candidate) => candidate.id !== input.id), requirement],
  });
  await appendPrdChange(cwd, {
    timestamp,
    reason,
    source: "user_command",
    affectedRequirementIds: [input.id],
  });
  return requirement;
}

async function savePrdRequirementsUnlocked(cwd: string, requirements: RuntimePrdRequirementsFile): Promise<void> {
  const path = getPrdRequirementsPath(cwd);
  await mkdir(getPrdDir(cwd), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  let published = false;
  try {
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(`${JSON.stringify(normalizePrdRequirementsFile(requirements), null, 2)}\n`, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path);
    published = true;
  } finally {
    if (!published) await rm(temporary, { force: true });
  }
}

async function savePrdCoverageUnlocked(cwd: string, coverage: RuntimePrdCoverageFile): Promise<void> {
  validatePrdCoverage(coverage);
  const path = getPrdCoveragePath(cwd);
  await mkdir(getPrdDir(cwd), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  let published = false;
  try {
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(`${JSON.stringify(coverage, null, 2)}\n`, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path);
    published = true;
  } finally {
    if (!published) await rm(temporary, { force: true });
  }
}

async function withPrdRequirementsLock<T>(cwd: string, fn: () => Promise<T>): Promise<T> {
  await mkdir(getPrdDir(cwd), { recursive: true });
  const path = getPrdRequirementsLockPath(cwd);
  let acquired = false;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      await mkdir(path);
      acquired = true;
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await delay(25);
    }
  }
  if (!acquired) {
    throw new Error("Runtime PRD requirements are locked by another active writer; retry after it finishes.");
  }
  try {
    return await fn();
  } finally {
    await releasePrdRequirementsLock(path);
  }
}

async function releasePrdRequirementsLock(path: string): Promise<void> {
  let releaseError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await rmdir(path);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      releaseError = error;
      if (attempt < 2) await delay(10);
    }
  }
  process.emitWarning(
    `Runtime PRD requirements lock could not be released: ${path}. A write may already have committed; reconcile the active owner before removing the lock. ${String(releaseError)}`,
    { code: "SCALER_PRD_LOCK_RELEASE_FAILED" },
  );
}

function assertCatalogDoesNotRollBack(current: RuntimePrdRequirementsFile, next: RuntimePrdRequirementsFile): void {
  for (const existing of current.requirements) {
    const proposed = next.requirements.find((requirement) => requirement.id === existing.id);
    if (!proposed) throw new Error(`Runtime PRD catalog replacement cannot remove requirement ${existing.id}.`);
    const currentRevision = existing.revision ?? 1;
    const proposedRevision = proposed.revision ?? 1;
    if (proposedRevision !== currentRevision || JSON.stringify(proposed.versionHistory) !== JSON.stringify(existing.versionHistory)) {
      throw new Error(`Runtime PRD catalog replacement cannot roll back requirement ${existing.id}.`);
    }
    if (!sameRequirementContent(existing, proposed)) {
      throw new Error(`Runtime PRD catalog replacement cannot change ${existing.id} without amendment authority.`);
    }
  }
}

export function normalizePrdAcceptanceCriteria(
  criteria: RuntimePrdAcceptanceCriterion[],
): RuntimePrdAcceptanceCriterion[] {
  const normalized = criteria.map((criterion, index) => {
    if (!criterion || typeof criterion !== "object") {
      throw new Error(`Invalid runtime PRD acceptance criterion at index ${index}.`);
    }
    const id = requiredCriterionString(criterion.id, "id", index);
    const statement = requiredCriterionString(criterion.statement, "statement", index);
    const validationTaskId = requiredCriterionString(criterion.validationTaskId, "validationTaskId", index);
    const commandId = requiredCriterionString(criterion.commandId, "commandId", index);
    if (!Array.isArray(criterion.participantTaskIds)) {
      throw new Error(`Invalid runtime PRD acceptance criterion ${id}: participantTaskIds must be an array.`);
    }
    const participantTaskIds = [...new Set(criterion.participantTaskIds.map((taskId, taskIndex) =>
      requiredCriterionString(taskId, `participantTaskIds[${taskIndex}]`, index)))].sort();
    if (participantTaskIds.length === 0) {
      throw new Error(`Invalid runtime PRD acceptance criterion ${id}: at least one participant task is required.`);
    }
    return { id, statement, validationTaskId, commandId, participantTaskIds };
  }).sort((a, b) => a.id.localeCompare(b.id));
  const duplicate = normalized.find((criterion, index) => index > 0 && normalized[index - 1]!.id === criterion.id);
  if (duplicate) throw new Error(`Invalid runtime PRD acceptance criteria: duplicate id ${duplicate.id}.`);
  return normalized;
}

function normalizePrdRequirementsFile(requirements: RuntimePrdRequirementsFile): RuntimePrdRequirementsFile {
  if (requirements?.version !== 1 || !Array.isArray(requirements.requirements)) {
    throw new Error("Malformed runtime PRD requirements: expected version 1 with a requirements array.");
  }
  return {
    version: 1,
    requirements: requirements.requirements.map((requirement) => normalizeRuntimePrdRequirement(requirement)),
  };
}

function normalizeRuntimePrdRequirement(requirement: RuntimePrdRequirement): RuntimePrdRequirement {
  const acceptanceCriteria = requirement.acceptanceCriteria === undefined
    ? undefined
    : normalizePrdAcceptanceCriteria(requirement.acceptanceCriteria);
  const revision = Number.isSafeInteger(requirement.revision) && (requirement.revision ?? 0) > 0 ? requirement.revision! : 1;
  const history = requirement.versionHistory?.map((version) => requirementVersion({
    ...version,
    acceptanceCriteria: version.acceptanceCriteria === undefined
      ? undefined
      : normalizePrdAcceptanceCriteria(version.acceptanceCriteria),
  })) ?? [requirementVersion({
    statement: requirement.statement,
    title: requirement.title,
    source: requirement.source,
    acceptanceCriteria,
    revision,
    recordedAt: requirement.createdAt,
    authority: { kind: "legacy_unknown" },
  })];
  if (history.length === 0 || history.some((version, index) => version.revision !== index + 1)) {
    throw new Error(`Invalid runtime PRD requirement ${requirement.id}: history revisions must be consecutive from 1.`);
  }
  if (history.at(-1)?.revision !== revision) {
    throw new Error(`Invalid runtime PRD requirement ${requirement.id}: history does not end at revision ${revision}.`);
  }
  const latest = history.at(-1)!;
  if (!sameRequirementContent({ ...requirement, acceptanceCriteria }, latest)) {
    throw new Error(`Invalid runtime PRD requirement ${requirement.id}: current content does not match revision ${revision}.`);
  }
  return { ...requirement, acceptanceCriteria, revision, versionHistory: history };
}

function requirementVersion(version: RuntimePrdRequirementVersion): RuntimePrdRequirementVersion {
  return JSON.parse(JSON.stringify(version)) as RuntimePrdRequirementVersion;
}

function assertModelRouteRequirementChangeAllowed(
  existing: RuntimePrdRequirement | undefined,
  proposed: Pick<RuntimePrdRequirement, "statement" | "title" | "source" | "acceptanceCriteria">,
): void {
  if (!existing) {
    if ((proposed.acceptanceCriteria?.length ?? 0) > 0) {
      throw new Error("Runtime PRD acceptance criteria require an explicit user command amendment authority.");
    }
    return;
  }
  if (!sameRequirementContent(existing, proposed)) {
    throw new Error(`Runtime PRD requirement ${existing.id} amendment authority requires an explicit user command.`);
  }
}

function sameRequirementContent(
  existing: Pick<RuntimePrdRequirement, "statement" | "title" | "source" | "acceptanceCriteria">,
  proposed: Pick<RuntimePrdRequirement, "statement" | "title" | "source" | "acceptanceCriteria">,
): boolean {
  return JSON.stringify({
    statement: existing.statement,
    title: existing.title ?? null,
    source: existing.source ?? null,
    acceptanceCriteria: existing.acceptanceCriteria ?? [],
  }) === JSON.stringify({
    statement: proposed.statement,
    title: proposed.title ?? null,
    source: proposed.source ?? null,
    acceptanceCriteria: proposed.acceptanceCriteria ?? [],
  });
}

function requiredRequirementString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Invalid runtime PRD requirement: ${field} is required.`);
  }
  return value.trim();
}

function requiredCriterionString(value: unknown, field: string, index: number): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Invalid runtime PRD acceptance criterion at index ${index}: ${field} is required.`);
  }
  return value.trim();
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

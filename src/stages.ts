import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { getStageArtifactsPath } from "./paths.js";

export const stageArtifactStages = ["prd", "knowledge", "planning", "execution", "replanning"] as const;
export type StageArtifactStage = (typeof stageArtifactStages)[number];

export const stageArtifactStatuses = ["draft", "in_progress", "ready", "accepted", "blocked", "superseded"] as const;
export type StageArtifactStatus = (typeof stageArtifactStatuses)[number];

export interface StageArtifact {
  id: string;
  stage: StageArtifactStage;
  status: StageArtifactStatus;
  title: string;
  path?: string;
  summary?: string;
  evidenceRefs?: string[];
  requirementRefs?: string[];
  taskRefs?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface StageArtifactInput {
  id?: string;
  stage: StageArtifactStage | string;
  status?: StageArtifactStatus | string;
  title?: string;
  path?: string;
  summary?: string;
  evidenceRefs?: string[];
  requirementRefs?: string[];
  taskRefs?: string[];
}

export interface StageArtifactIndex {
  version: 1;
  artifacts: StageArtifact[];
}

export interface StageArtifactSummary {
  total: number;
  latestByStage: Partial<Record<StageArtifactStage, StageArtifact>>;
  missingStages: StageArtifactStage[];
  readyStages: StageArtifactStage[];
  blockedStages: StageArtifactStage[];
}

export interface StageArtifactReadinessValidation {
  ok: boolean;
  stage: StageArtifactStage;
  artifact?: StageArtifact;
  reasons: string[];
}

export interface StageArtifactSemanticValidation {
  ok: boolean;
  stage: StageArtifactStage;
  artifact?: StageArtifact;
  reasons: string[];
}

export async function loadStageArtifacts(cwd: string): Promise<StageArtifact[]> {
  try {
    const raw = await readFile(getStageArtifactsPath(cwd), "utf8");
    const index = JSON.parse(raw) as StageArtifactIndex;
    if (index.version !== 1) throw new Error(`Unsupported stage artifact index version: ${String(index.version)}`);
    for (const artifact of index.artifacts) validateStageArtifact(artifact);
    return sortStageArtifacts(index.artifacts);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function saveStageArtifacts(cwd: string, artifacts: StageArtifact[]): Promise<StageArtifact[]> {
  for (const artifact of artifacts) validateStageArtifact(artifact);
  const sorted = sortStageArtifacts(artifacts);
  const path = getStageArtifactsPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ version: 1, artifacts: sorted }, null, 2)}\n`, "utf8");
  return sorted;
}

export async function upsertStageArtifact(cwd: string, input: StageArtifactInput, now = new Date()): Promise<StageArtifact> {
  const artifacts = await loadStageArtifacts(cwd);
  const timestamp = now.toISOString();
  const existing = input.id ? artifacts.find((artifact) => artifact.id === input.id) : undefined;
  const artifact = normalizeStageArtifactInput(input, existing, timestamp);
  await saveStageArtifacts(cwd, [
    ...artifacts.filter((candidate) => candidate.id !== artifact.id),
    artifact,
  ]);
  return artifact;
}

export function summarizeStageArtifacts(artifacts: StageArtifact[]): StageArtifactSummary {
  const latestByStage: Partial<Record<StageArtifactStage, StageArtifact>> = {};
  for (const artifact of sortStageArtifacts(artifacts)) {
    const current = latestByStage[artifact.stage];
    if (!current || artifact.updatedAt > current.updatedAt || (artifact.updatedAt === current.updatedAt && artifact.id > current.id)) {
      latestByStage[artifact.stage] = artifact;
    }
  }

  const missingStages = stageArtifactStages.filter((stage) => !latestByStage[stage]);
  const readyStages = stageArtifactStages.filter((stage) => {
    const artifact = latestByStage[stage];
    return artifact?.status === "ready" || artifact?.status === "accepted";
  });
  const blockedStages = stageArtifactStages.filter((stage) => latestByStage[stage]?.status === "blocked");

  return { total: artifacts.length, latestByStage, missingStages, readyStages, blockedStages };
}

export async function validateStageArtifactReadiness(
  cwd: string,
  artifacts: StageArtifact[],
  stageInput: StageArtifactStage | string,
): Promise<StageArtifactReadinessValidation> {
  const stage = normalizeStageArtifactStage(stageInput);
  const artifact = latestArtifactForStage(artifacts, stage);
  const reasons: string[] = [];

  if (!artifact) {
    return { ok: false, stage, reasons: [`No artifact recorded for stage ${stage}.`] };
  }

  if (artifact.status !== "ready" && artifact.status !== "accepted") {
    reasons.push(`Latest ${stage} artifact ${artifact.id} status is ${artifact.status}, expected ready or accepted.`);
  }

  if (requiresPath(stage) && !artifact.path) {
    reasons.push(`Stage ${stage} requires an artifact path.`);
  }

  if (!artifact.path && !artifact.summary && (!artifact.taskRefs || artifact.taskRefs.length === 0)) {
    reasons.push(`Stage ${stage} artifact ${artifact.id} needs a path, summary, or task refs.`);
  }

  if (artifact.path) {
    const path = isAbsolute(artifact.path) ? artifact.path : join(cwd, artifact.path);
    try {
      const pathStat = await stat(path);
      if (!pathStat.isFile()) reasons.push(`Artifact path is not a file: ${artifact.path}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") reasons.push(`Artifact path does not exist: ${artifact.path}`);
      else throw error;
    }
  }

  return { ok: reasons.length === 0, stage, artifact, reasons };
}

export function validateStageArtifactSemantics(
  artifacts: StageArtifact[],
  stageInput: StageArtifactStage | string,
): StageArtifactSemanticValidation {
  const stage = normalizeStageArtifactStage(stageInput);
  const artifact = latestArtifactForStage(artifacts, stage);
  const reasons: string[] = [];

  if (!artifact) {
    return { ok: false, stage, reasons: [`No artifact recorded for stage ${stage}.`] };
  }

  switch (stage) {
    case "prd":
      if (!hasRefs(artifact.requirementRefs) && !artifact.summary) {
        reasons.push(`Stage prd artifact ${artifact.id} requires requirement refs or a summary.`);
      }
      break;
    case "knowledge":
      if (!hasRefs(artifact.evidenceRefs) && !artifact.summary) {
        reasons.push(`Stage knowledge artifact ${artifact.id} requires evidence refs or a summary.`);
      }
      break;
    case "planning":
      if (!hasRefs(artifact.taskRefs) && !hasRefs(artifact.requirementRefs)) {
        reasons.push(`Stage planning artifact ${artifact.id} requires task refs or requirement refs.`);
      }
      break;
    case "replanning":
      if (!hasRefs(artifact.evidenceRefs)) {
        reasons.push(`Stage replanning artifact ${artifact.id} requires evidence refs.`);
      }
      if (!hasRefs(artifact.requirementRefs) && !hasRefs(artifact.taskRefs)) {
        reasons.push(`Stage replanning artifact ${artifact.id} requires requirement refs or task refs.`);
      }
      break;
    case "execution":
      if (!hasRefs(artifact.taskRefs) && !artifact.summary) {
        reasons.push(`Stage execution artifact ${artifact.id} requires task refs or a summary.`);
      }
      break;
  }

  return { ok: reasons.length === 0, stage, artifact, reasons };
}

export function formatStageArtifactReadiness(validation: StageArtifactReadinessValidation): string {
  const artifact = validation.artifact ? ` artifact=${validation.artifact.id}` : "";
  if (validation.ok) return `Stage ${validation.stage} artifact is ready.${artifact}`;
  return [`Stage ${validation.stage} artifact is not ready.${artifact}`, ...validation.reasons.map((reason) => `- ${reason}`)].join("\n");
}

export function formatStageArtifactSemantics(validation: StageArtifactSemanticValidation): string {
  const artifact = validation.artifact ? ` artifact=${validation.artifact.id}` : "";
  if (validation.ok) return `Stage ${validation.stage} artifact is semantically valid.${artifact}`;
  return [`Stage ${validation.stage} artifact is semantically invalid.${artifact}`, ...validation.reasons.map((reason) => `- ${reason}`)].join("\n");
}

export function formatStageArtifactSummary(summary: StageArtifactSummary): string {
  const lines = [`Stage artifacts: total=${summary.total} ready=${summary.readyStages.length}/${stageArtifactStages.length}`];
  for (const stage of stageArtifactStages) {
    const artifact = summary.latestByStage[stage];
    if (!artifact) {
      lines.push(`- ${stage}: missing`);
      continue;
    }
    const details = [artifact.id, artifact.status];
    if (artifact.path) details.push(`path=${artifact.path}`);
    if (artifact.title) details.push(`title=${artifact.title}`);
    lines.push(`- ${stage}: ${details.join(" ")}`);
  }
  if (summary.blockedStages.length > 0) lines.push(`blocked=${summary.blockedStages.join(",")}`);
  return lines.join("\n");
}

export function validateStageArtifact(artifact: StageArtifact): void {
  if (!artifact.id.trim()) throw new Error("Stage artifact id is required.");
  if (!stageArtifactStages.includes(artifact.stage)) throw new Error(`Invalid stage artifact stage: ${String(artifact.stage)}`);
  if (!stageArtifactStatuses.includes(artifact.status)) throw new Error(`Invalid stage artifact status: ${String(artifact.status)}`);
  if (!artifact.title.trim()) throw new Error(`Stage artifact ${artifact.id} title is required.`);
  if (!artifact.createdAt.trim()) throw new Error(`Stage artifact ${artifact.id} createdAt is required.`);
  if (!artifact.updatedAt.trim()) throw new Error(`Stage artifact ${artifact.id} updatedAt is required.`);
}

function normalizeStageArtifactInput(input: StageArtifactInput, existing: StageArtifact | undefined, timestamp: string): StageArtifact {
  const stage = normalizeStageArtifactStage(input.stage);
  const status = (input.status ?? existing?.status ?? "draft") as StageArtifactStatus;
  if (!stageArtifactStatuses.includes(status)) throw new Error(`Invalid stage artifact status: ${String(input.status)}`);
  const id = input.id?.trim() || existing?.id || `ART-${stage}-${timestamp.replace(/[^0-9]/g, "")}`;
  return {
    id,
    stage,
    status,
    title: clean(input.title) ?? existing?.title ?? defaultTitle(stage),
    path: clean(input.path) ?? existing?.path,
    summary: clean(input.summary) ?? existing?.summary,
    evidenceRefs: normalizeList(input.evidenceRefs ?? existing?.evidenceRefs),
    requirementRefs: normalizeList(input.requirementRefs ?? existing?.requirementRefs),
    taskRefs: normalizeList(input.taskRefs ?? existing?.taskRefs),
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
}

function defaultTitle(stage: StageArtifactStage): string {
  switch (stage) {
    case "prd": return "Stage I PRD artifact";
    case "knowledge": return "Stage II knowledge artifact";
    case "planning": return "Stage III planning artifact";
    case "execution": return "Stage IV execution artifact";
    case "replanning": return "Replanning artifact";
  }
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeList(values: string[] | undefined): string[] | undefined {
  const normalized = Array.from(new Set((values ?? []).map((value) => value.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  return normalized.length > 0 ? normalized : undefined;
}

function hasRefs(values: string[] | undefined): boolean {
  return Boolean(values && values.length > 0);
}

export function normalizeStageArtifactStage(stage: StageArtifactStage | string): StageArtifactStage {
  const normalized = stage.trim() as StageArtifactStage;
  if (!stageArtifactStages.includes(normalized)) throw new Error(`Invalid stage artifact stage: ${String(stage)}`);
  return normalized;
}

function latestArtifactForStage(artifacts: StageArtifact[], stage: StageArtifactStage): StageArtifact | undefined {
  return sortStageArtifacts(artifacts).find((artifact) => artifact.stage === stage);
}

function requiresPath(stage: StageArtifactStage): boolean {
  return stage === "prd" || stage === "knowledge" || stage === "planning" || stage === "replanning";
}

function sortStageArtifacts(artifacts: StageArtifact[]): StageArtifact[] {
  return [...artifacts].sort((a, b) => {
    const stageDelta = stageArtifactStages.indexOf(a.stage) - stageArtifactStages.indexOf(b.stage);
    if (stageDelta !== 0) return stageDelta;
    const updatedDelta = b.updatedAt.localeCompare(a.updatedAt);
    if (updatedDelta !== 0) return updatedDelta;
    return a.id.localeCompare(b.id);
  });
}

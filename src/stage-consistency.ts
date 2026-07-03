import { loadExecutionPlan, loadProposedExecutionPlan, loadReplanRequests } from "./plans.js";
import { loadPrdRequirements } from "./prd.js";
import { loadStageArtifacts, normalizeStageArtifactStage, type StageArtifact, type StageArtifactStage } from "./stages.js";
import type { ScalerState } from "./types.js";

export interface StageArtifactConsistencyValidation {
  ok: boolean;
  stage: StageArtifactStage;
  artifact?: StageArtifact;
  reasons: string[];
}

export async function validateStageArtifactConsistency(
  cwd: string,
  state: ScalerState,
  stageInput: StageArtifactStage | string,
  artifactInput?: StageArtifact,
): Promise<StageArtifactConsistencyValidation> {
  const stage = normalizeStageArtifactStage(stageInput);
  const artifact = artifactInput ?? latestArtifactForStage(await loadStageArtifacts(cwd), stage);
  const reasons: string[] = [];
  if (!artifact) return { ok: false, stage, reasons: [`No artifact recorded for stage ${stage}.`] };

  await validateRequirementRefs(cwd, artifact, reasons, stage);

  if (stage === "planning") await validatePlanningRefs(cwd, artifact, reasons);
  if (stage === "execution") validateExecutionRefs(state, artifact, reasons);
  if (stage === "replanning") await validateReplanningRefs(cwd, artifact, reasons);

  return { ok: reasons.length === 0, stage, artifact, reasons };
}

export function formatStageArtifactConsistency(validation: StageArtifactConsistencyValidation): string {
  const artifact = validation.artifact ? ` artifact=${validation.artifact.id}` : "";
  if (validation.ok) return `Stage ${validation.stage} artifact is consistent.${artifact}`;
  return [`Stage ${validation.stage} artifact is inconsistent.${artifact}`, ...validation.reasons.map((reason) => `- ${reason}`)].join("\n");
}

async function validateRequirementRefs(
  cwd: string,
  artifact: StageArtifact,
  reasons: string[],
  stage: StageArtifactStage,
): Promise<void> {
  const requirements = await loadPrdRequirements(cwd);
  if (requirements.requirements.length === 0) return;
  const knownRequirementIds = new Set(requirements.requirements.map((requirement) => requirement.id));
  const refs = artifact.requirementRefs ?? [];
  if (stage === "prd" && refs.length === 0) {
    reasons.push(`Stage prd artifact ${artifact.id} must reference runtime PRD requirement ids when requirements exist.`);
    return;
  }
  const missing = refs.filter((ref) => !knownRequirementIds.has(ref));
  if (missing.length > 0) {
    reasons.push(`Stage ${stage} artifact ${artifact.id} references unknown runtime PRD requirement ids: ${missing.join(", ")}.`);
  }
}

async function validatePlanningRefs(cwd: string, artifact: StageArtifact, reasons: string[]): Promise<void> {
  const plan = await loadExecutionPlan(cwd);
  if (plan.tasks.length === 0 || !artifact.taskRefs || artifact.taskRefs.length === 0) return;
  const knownTaskIds = new Set(plan.tasks.map((task) => task.id));
  const missing = artifact.taskRefs.filter((ref) => !knownTaskIds.has(ref));
  if (missing.length > 0) {
    reasons.push(`Stage planning artifact ${artifact.id} references task ids not in current execution plan: ${missing.join(", ")}.`);
  }
}

function validateExecutionRefs(state: ScalerState, artifact: StageArtifact, reasons: string[]): void {
  if (state.tasks.length === 0 || !artifact.taskRefs || artifact.taskRefs.length === 0) return;
  const knownTaskIds = new Set(state.tasks.map((task) => task.id));
  const missing = artifact.taskRefs.filter((ref) => !knownTaskIds.has(ref));
  if (missing.length > 0) {
    reasons.push(`Stage execution artifact ${artifact.id} references unknown supervisor task ids: ${missing.join(", ")}.`);
  }
}

async function validateReplanningRefs(cwd: string, artifact: StageArtifact, reasons: string[]): Promise<void> {
  const requests = await loadReplanRequests(cwd);
  if (requests.length > 0) {
    const knownRequestIds = new Set(requests.map((request) => request.id));
    const evidenceRefs = artifact.evidenceRefs ?? [];
    const matchingRefs = evidenceRefs.filter((ref) => knownRequestIds.has(ref));
    if (matchingRefs.length === 0) {
      reasons.push(`Stage replanning artifact ${artifact.id} must reference a known replan request id in evidence refs.`);
    }
  }

  if (artifact.path === ".scaler/plans/proposed-plan.json") {
    try {
      const proposed = await loadProposedExecutionPlan(cwd);
      if (!proposed) reasons.push(`Stage replanning artifact ${artifact.id} points to missing proposed execution plan.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reasons.push(`Stage replanning artifact ${artifact.id} points to invalid proposed execution plan: ${message}`);
    }
  }
}

function latestArtifactForStage(artifacts: StageArtifact[], stage: StageArtifactStage): StageArtifact | undefined {
  return artifacts
    .filter((artifact) => artifact.stage === stage)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))[0];
}

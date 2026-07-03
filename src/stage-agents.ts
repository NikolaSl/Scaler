import { buildTaskAgentInvocation, type TaskAgentInvocation } from "./subagents.js";
import { formatStateStatus } from "./state.js";
import { stageArtifactStages, type StageArtifact, type StageArtifactStage } from "./stages.js";
import type { ScalerState } from "./types.js";

export interface StageAgentPromptInput {
  stage: StageArtifactStage | string;
  state: ScalerState;
  artifacts?: StageArtifact[];
  extraInstructions?: string;
}

export interface StageAgentInvocationOptions {
  tools?: string[];
  model?: string;
  appendSystemPromptPath?: string;
  extensionPaths?: string[];
  command?: string;
}

export interface StageAgentPreparation {
  stage: StageArtifactStage;
  prompt: string;
  invocation: TaskAgentInvocation;
}

export function buildStageAgentPrompt(input: StageAgentPromptInput): string {
  const stage = normalizeStage(input.stage);
  const relatedArtifacts = (input.artifacts ?? []).filter((artifact) => artifact.stage === stage);
  const lines = [
    "You are a focused SCALER stage agent.",
    "Follow the deterministic supervisor state. Do not claim completion unless the required artifact exists or is explicitly described as blocked.",
    "",
    `Target stage: ${stage}`,
    `Supervisor: ${formatStateStatus(input.state)}`,
    "",
    "Stage contract:",
    ...stageContract(stage).map((item) => `- ${item}`),
    "",
    "Existing stage artifacts:",
    ...formatArtifactLines(relatedArtifacts),
    "",
    "Required final response:",
    "- Summarize what artifact was produced or why it is blocked.",
    "- List exact file paths and evidence references used.",
    "- State the /scaler-stage-record command arguments that should record the artifact.",
  ];

  if (input.extraInstructions?.trim()) {
    lines.push("", "Extra instructions:", input.extraInstructions.trim());
  }

  return lines.join("\n");
}

export function prepareStageAgentInvocation(
  cwd: string,
  input: StageAgentPromptInput,
  options: StageAgentInvocationOptions = {},
): StageAgentPreparation {
  const stage = normalizeStage(input.stage);
  const prompt = buildStageAgentPrompt({ ...input, stage });
  const invocation = buildTaskAgentInvocation({
    taskId: `stage-${stage}`,
    prompt,
    cwd,
    tools: options.tools,
    model: options.model,
    appendSystemPromptPath: options.appendSystemPromptPath,
    extensionPaths: options.extensionPaths,
  }, options.command ?? "pi");
  return { stage, prompt, invocation };
}

export function normalizeStage(stage: StageArtifactStage | string): StageArtifactStage {
  const normalized = stage.trim() as StageArtifactStage;
  if (!stageArtifactStages.includes(normalized)) throw new Error(`Invalid stage agent stage: ${String(stage)}`);
  return normalized;
}

function stageContract(stage: StageArtifactStage): string[] {
  switch (stage) {
    case "prd":
      return [
        "Review user/project PRD inputs and produce a polished, internally consistent PRD.",
        "Write or update `agent-prd.md` when enough information exists.",
        "Update the runtime PRD ledger with stable requirement ids when possible.",
        "Request clarification instead of inventing requirements when contradictions or gaps block progress.",
      ];
    case "knowledge":
      return [
        "Identify knowledge needed to execute the polished PRD.",
        "Inspect local project sources first and keep raw detail outside active context.",
        "Record reliable findings, contradictions, uncertainty, and evidence references.",
        "Produce a knowledge report artifact suitable for planning.",
      ];
    case "planning":
      return [
        "Create or refresh the sequential execution plan from PRD and knowledge artifacts.",
        "Keep tasks atomic, ordered, independently validateable, and linked to runtime PRD ids.",
        "Write `.scaler/plans/current-plan.json` when producing the active plan.",
        "Include validation references and allowed path prefixes where known.",
      ];
    case "execution":
      return [
        "Summarize Stage IV execution readiness and current task progress.",
        "Do not execute arbitrary task work directly; use `/scaler-step`, validation, and commit commands for task execution.",
        "Record execution-stage blockers, validation state, and task refs.",
      ];
    case "replanning":
      return [
        "Consume open replan requests, validation/debug evidence, runtime PRD coverage, and the current plan.",
        "Preserve validated tasks and validated requirement coverage.",
        "Write `.scaler/plans/proposed-plan.json` for replacement plans before acceptance.",
        "Explain preservation risks and unresolved gaps explicitly.",
      ];
  }
}

function formatArtifactLines(artifacts: StageArtifact[]): string[] {
  if (artifacts.length === 0) return ["- none"];
  return [...artifacts]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
    .map((artifact) => {
      const fields = [artifact.id, artifact.status, artifact.title];
      if (artifact.path) fields.push(`path=${artifact.path}`);
      if (artifact.summary) fields.push(`summary=${artifact.summary}`);
      return `- ${fields.join(" | ")}`;
    });
}

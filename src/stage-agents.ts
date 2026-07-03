import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { acquireExecutionLock, releaseExecutionLock } from "./locks.js";
import { getStageAgentRunsPath } from "./paths.js";
import { buildTaskAgentInvocation, runTaskAgent, type TaskAgentInvocation, type TaskAgentRequest, type TaskAgentRunResult } from "./subagents.js";
import { formatStateStatus } from "./state.js";
import { loadStageArtifacts, stageArtifactStatuses, stageArtifactStages, type StageArtifact, type StageArtifactInput, type StageArtifactStage } from "./stages.js";
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
  request: TaskAgentRequest;
  invocation: TaskAgentInvocation;
}

export interface StageAgentRunRecord {
  id: string;
  stage: StageArtifactStage;
  status: "prepared" | "passed" | "failed";
  exitCode?: number;
  stdoutEventCount?: number;
  stderrSummary?: string;
  timedOut?: boolean;
  aborted?: boolean;
  createdAt: string;
}

export interface StageAgentRunIndex {
  version: 1;
  runs: StageAgentRunRecord[];
}

export interface RunStageAgentOptions extends StageAgentInvocationOptions {
  execute?: boolean;
  timeoutMs?: number;
  extraInstructions?: string;
}

export interface StageAgentStepResult {
  accepted: boolean;
  message: string;
  stage?: StageArtifactStage;
  prompt?: string;
  invocation?: TaskAgentInvocation;
  runResult?: TaskAgentRunResult;
  runRecord?: StageAgentRunRecord;
}

export type StageAgentRunner = typeof runTaskAgent;

export interface StageAgentArtifactReport {
  stage: StageArtifactStage;
  status: string;
  title?: string;
  path?: string;
  summary?: string;
  evidenceRefs?: string[];
  requirementRefs?: string[];
  taskRefs?: string[];
}

export interface StageAgentReportExtractionResult {
  ok: boolean;
  artifactInput?: StageArtifactInput;
  reason?: string;
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
    "- Emit one JSON event with type `scaler_stage_artifact` and fields: stage, status, title, optional path, optional summary, optional evidenceRefs, optional requirementRefs, optional taskRefs.",
    "- If JSON event emission is unavailable, state the /scaler-stage-record command arguments that should record the artifact.",
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
  const request: TaskAgentRequest = {
    taskId: `stage-${stage}`,
    prompt,
    cwd,
    tools: options.tools,
    model: options.model,
    appendSystemPromptPath: options.appendSystemPromptPath,
    extensionPaths: options.extensionPaths,
  };
  const invocation = buildTaskAgentInvocation(request, options.command ?? "pi");
  return { stage, prompt, request, invocation };
}

export async function runStageAgentStep(
  cwd: string,
  state: ScalerState,
  stageInput: StageArtifactStage | string,
  options: RunStageAgentOptions = {},
  runner: StageAgentRunner = runTaskAgent,
): Promise<StageAgentStepResult> {
  const stage = normalizeStage(stageInput);
  const lock = await acquireExecutionLock(cwd, {
    operation: options.execute ? "stage_agent_execute" : "stage_agent_prepare",
    reason: `Stage agent ${stage}`,
  });
  if (!lock.acquired) return { accepted: false, message: lock.message, stage };

  try {
    const artifacts = await loadStageArtifacts(cwd);
    const preparation = prepareStageAgentInvocation(cwd, {
      stage,
      state,
      artifacts,
      extraInstructions: options.extraInstructions,
    }, options);
    const runResult = options.execute ? await runner(preparation.request, { timeoutMs: options.timeoutMs }) : undefined;
    const runRecord = await recordStageAgentRun(cwd, stage, runResult, options.execute ? undefined : "prepared");
    return {
      accepted: true,
      message: `${options.execute ? "Executed" : "Prepared"} stage agent ${stage}`,
      stage,
      prompt: preparation.prompt,
      invocation: preparation.invocation,
      runResult,
      runRecord,
    };
  } finally {
    await releaseExecutionLock(cwd, lock.lock.id);
  }
}

export async function loadStageAgentRunRecords(cwd: string): Promise<StageAgentRunRecord[]> {
  try {
    const raw = await readFile(getStageAgentRunsPath(cwd), "utf8");
    const index = JSON.parse(raw) as StageAgentRunIndex;
    if (index.version !== 1) throw new Error(`Unsupported stage-agent run index version: ${String(index.version)}`);
    return index.runs;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function recordStageAgentRun(
  cwd: string,
  stage: StageArtifactStage,
  runResult: TaskAgentRunResult | undefined,
  preparedStatus?: "prepared",
  now = new Date(),
): Promise<StageAgentRunRecord> {
  const timestamp = now.toISOString();
  const record: StageAgentRunRecord = runResult ? {
    id: `stage-${stage}-${now.getTime()}`,
    stage,
    status: runResult.exitCode === 0 ? "passed" : "failed",
    exitCode: runResult.exitCode,
    stdoutEventCount: runResult.stdoutEvents.length,
    stderrSummary: summarizeOutput(runResult.stderr),
    timedOut: runResult.timedOut,
    aborted: runResult.aborted,
    createdAt: timestamp,
  } : {
    id: `stage-${stage}-${now.getTime()}`,
    stage,
    status: preparedStatus ?? "prepared",
    createdAt: timestamp,
  };
  const runs = [record, ...(await loadStageAgentRunRecords(cwd))];
  const path = getStageAgentRunsPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ version: 1, runs }, null, 2)}\n`, "utf8");
  return record;
}

export function formatStageAgentRunList(records: StageAgentRunRecord[], stage?: StageArtifactStage | string, limit = 10): string {
  const normalizedStage = stage?.trim() ? normalizeStage(stage) : undefined;
  const filtered = normalizedStage ? records.filter((record) => record.stage === normalizedStage) : records;
  if (filtered.length === 0) return normalizedStage ? `No stage-agent runs for ${normalizedStage}.` : "No stage-agent runs.";
  const lines = [normalizedStage ? `Stage-agent runs for ${normalizedStage}:` : "Stage-agent runs:"];
  for (const record of filtered.slice(0, limit)) {
    const exit = record.exitCode === undefined ? "n/a" : String(record.exitCode);
    const flags = [record.timedOut && "timed_out", record.aborted && "aborted"].filter(Boolean).join(",") || "none";
    const stderr = record.stderrSummary ? ` stderr=${record.stderrSummary}` : "";
    lines.push(`- ${record.stage}: ${record.status} exit=${exit} flags=${flags} stdout_events=${record.stdoutEventCount ?? 0}${stderr}`);
  }
  return lines.join("\n");
}

export function extractStageAgentArtifactReport(
  stdoutEvents: unknown[],
  expectedStage?: StageArtifactStage | string,
): StageAgentReportExtractionResult {
  const expected = expectedStage ? normalizeStage(expectedStage) : undefined;
  const candidates = stdoutEvents
    .map((event) => extractReportPayload(event))
    .filter((payload): payload is Record<string, unknown> => Boolean(payload));
  if (candidates.length === 0) return { ok: false, reason: "No scaler_stage_artifact report found in stage-agent output." };

  const report = candidates[candidates.length - 1];
  const stageValue = stringField(report, "stage");
  if (!stageValue) return { ok: false, reason: "Stage artifact report is missing stage." };
  const stage = normalizeStage(stageValue);
  if (expected && stage !== expected) return { ok: false, reason: `Stage artifact report stage ${stage} does not match expected ${expected}.` };

  const status = stringField(report, "status");
  if (!status) return { ok: false, reason: "Stage artifact report is missing status." };
  if (!stageArtifactStatuses.includes(status as never)) return { ok: false, reason: `Invalid stage artifact report status: ${status}.` };

  const title = stringField(report, "title");
  if (!title) return { ok: false, reason: "Stage artifact report is missing title." };

  return {
    ok: true,
    artifactInput: {
      stage,
      status,
      title,
      path: stringField(report, "path"),
      summary: stringField(report, "summary"),
      evidenceRefs: stringArrayField(report, "evidenceRefs"),
      requirementRefs: stringArrayField(report, "requirementRefs"),
      taskRefs: stringArrayField(report, "taskRefs"),
    },
  };
}

export function normalizeStage(stage: StageArtifactStage | string): StageArtifactStage {
  const normalized = stage.trim() as StageArtifactStage;
  if (!stageArtifactStages.includes(normalized)) throw new Error(`Invalid stage agent stage: ${String(stage)}`);
  return normalized;
}

function extractReportPayload(event: unknown): Record<string, unknown> | undefined {
  if (!isRecord(event)) return undefined;
  if (event.type === "scaler_stage_artifact") return event;
  const nested = event.scaler_stage_artifact ?? event.payload ?? event.data;
  if (isRecord(nested) && nested.type === "scaler_stage_artifact") return nested;
  if (isRecord(nested) && isRecord(nested.scaler_stage_artifact)) return nested.scaler_stage_artifact;
  return undefined;
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function stringArrayField(record: Record<string, unknown>, key: string): string[] | undefined {
  const value = record[key];
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
  return items.length > 0 ? Array.from(new Set(items)).sort((a, b) => a.localeCompare(b)) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function summarizeOutput(value: string, limit = 240): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= limit) return compact;
  return `${compact.slice(0, limit - 1)}…`;
}

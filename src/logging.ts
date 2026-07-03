import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getEventLogPath, getLogDetailsDir } from "./paths.js";
import type { ScalerState, ScalerStage } from "./types.js";

export type ScalerLogEventType =
  | "command"
  | "state"
  | "transition"
  | "rejected_transition"
  | "agent"
  | "tool"
  | "memory"
  | "validation"
  | "report"
  | "debug"
  | "research"
  | "git"
  | "safety"
  | "budget"
  | "system";

export interface ScalerLogEvent {
  timestamp: string;
  runId: string;
  stage: ScalerStage;
  taskId?: string;
  agentId?: string;
  agentType?: string;
  eventType: ScalerLogEventType;
  summary: string;
  inputRefs?: string[];
  outputRefs?: string[];
  details?: unknown;
  detailsPath?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cost?: number;
  };
}

export type ScalerLogEventInput = Omit<ScalerLogEvent, "timestamp" | "runId" | "stage"> & {
  timestamp?: string;
  runId?: string;
  stage?: ScalerStage;
};

export function createLogEvent(state: ScalerState, input: ScalerLogEventInput, now = new Date()): ScalerLogEvent {
  return {
    timestamp: input.timestamp ?? now.toISOString(),
    runId: input.runId ?? state.runId,
    stage: input.stage ?? state.stage,
    taskId: input.taskId,
    agentId: input.agentId,
    agentType: input.agentType,
    eventType: input.eventType,
    summary: input.summary,
    inputRefs: input.inputRefs,
    outputRefs: input.outputRefs,
    details: input.details,
    detailsPath: input.detailsPath,
    usage: input.usage,
  };
}

export async function appendLogEvent(cwd: string, event: ScalerLogEvent): Promise<void> {
  const logPath = getEventLogPath(cwd);
  await mkdir(dirname(logPath), { recursive: true });
  await writeFile(logPath, `${JSON.stringify(event)}\n`, { encoding: "utf8", flag: "a" });
}

export interface AuditDetailRecord {
  version: 1;
  category: string;
  timestamp: string;
  payload: unknown;
}

export interface CommandAuditInput {
  command: string;
  phase: "start" | "end" | "error";
  args?: string;
  accepted?: boolean;
  message?: string;
  error?: string;
  details?: unknown;
}

export interface AgentPromptAuditInput {
  agentType: string;
  agentId: string;
  prompt: string;
  taskId?: string;
  inputRefs?: string[];
  details?: unknown;
}

export interface StructuredReportAuditInput {
  reportType: string;
  summary: string;
  report: unknown;
  accepted?: boolean;
  taskId?: string;
  outputRefs?: string[];
  details?: unknown;
}

export interface ValidationSummaryAuditInput {
  taskId: string;
  runId?: string;
  status: string;
  commandCount?: number;
  failedCommandIds?: string[];
  details?: unknown;
}

export interface GitCommitAuditInput {
  taskId?: string;
  accepted: boolean;
  message: string;
  commitHash?: string;
  details?: unknown;
}

export interface ToolAuditInput {
  toolName: string;
  summary: string;
  input?: unknown;
  result?: unknown;
  accepted?: boolean;
}

export async function writeAuditDetail(cwd: string, category: string, payload: unknown, now = new Date()): Promise<string> {
  const timestamp = now.toISOString();
  const safeCategory = category.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-") || "detail";
  const fileName = `${timestamp.replace(/[^0-9]/g, "")}-${safeCategory}.json`;
  const path = join(getLogDetailsDir(cwd), fileName);
  const record: AuditDetailRecord = { version: 1, category, timestamp, payload };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return path;
}

export async function logCommandAudit(cwd: string, state: ScalerState, input: CommandAuditInput, now = new Date()): Promise<ScalerLogEvent> {
  const detailPayload = input.details ?? { args: input.args, accepted: input.accepted, message: input.message, error: input.error };
  const detailsPath = await writeAuditDetail(cwd, `command-${input.command}-${input.phase}`, detailPayload, now);
  const event = createLogEvent(state, {
    eventType: "command",
    summary: `Command ${input.phase}: ${input.command}${input.message ? ` - ${input.message}` : ""}`,
    details: { command: input.command, phase: input.phase, accepted: input.accepted, message: input.message, error: input.error },
    detailsPath,
  }, now);
  await appendLogEvent(cwd, event);
  return event;
}

export async function logAgentPromptAudit(cwd: string, state: ScalerState, input: AgentPromptAuditInput, now = new Date()): Promise<ScalerLogEvent> {
  const detailsPath = await writeAuditDetail(cwd, `agent-prompt-${input.agentType}-${input.agentId}`, {
    prompt: input.prompt,
    details: input.details,
  }, now);
  const event = createLogEvent(state, {
    eventType: "agent",
    summary: `Agent prompt prepared: ${input.agentType}/${input.agentId}`,
    agentId: input.agentId,
    agentType: input.agentType,
    taskId: input.taskId,
    inputRefs: input.inputRefs,
    details: { promptLength: input.prompt.length, detailsPath },
    detailsPath,
  }, now);
  await appendLogEvent(cwd, event);
  return event;
}

export async function logStructuredReportAudit(cwd: string, state: ScalerState, input: StructuredReportAuditInput, now = new Date()): Promise<ScalerLogEvent> {
  const detailsPath = await writeAuditDetail(cwd, `report-${input.reportType}`, {
    report: input.report,
    details: input.details,
  }, now);
  const event = createLogEvent(state, {
    eventType: "report",
    summary: `${input.accepted === false ? "Report rejected" : "Report recorded"}: ${input.reportType} - ${input.summary}`,
    taskId: input.taskId,
    outputRefs: input.outputRefs,
    details: { reportType: input.reportType, accepted: input.accepted, detailsPath },
    detailsPath,
  }, now);
  await appendLogEvent(cwd, event);
  return event;
}

export async function logValidationSummaryAudit(cwd: string, state: ScalerState, input: ValidationSummaryAuditInput, now = new Date()): Promise<ScalerLogEvent> {
  const detailsPath = await writeAuditDetail(cwd, `validation-${input.taskId}`, input.details ?? input, now);
  const event = createLogEvent(state, {
    eventType: "validation",
    summary: `Validation summary: ${input.taskId} ${input.status}`,
    taskId: input.taskId,
    outputRefs: input.runId ? [input.runId] : undefined,
    details: {
      runId: input.runId,
      status: input.status,
      commandCount: input.commandCount,
      failedCommandIds: input.failedCommandIds,
      detailsPath,
    },
    detailsPath,
  }, now);
  await appendLogEvent(cwd, event);
  return event;
}

export async function logGitCommitAudit(cwd: string, state: ScalerState, input: GitCommitAuditInput, now = new Date()): Promise<ScalerLogEvent> {
  const detailsPath = await writeAuditDetail(cwd, `git-commit-${input.taskId ?? "none"}`, input.details ?? input, now);
  const event = createLogEvent(state, {
    eventType: "git",
    summary: input.message,
    taskId: input.taskId,
    outputRefs: input.commitHash ? [input.commitHash] : undefined,
    details: { accepted: input.accepted, commitHash: input.commitHash, detailsPath },
    detailsPath,
  }, now);
  await appendLogEvent(cwd, event);
  return event;
}

export async function logToolAudit(cwd: string, state: ScalerState, input: ToolAuditInput, now = new Date()): Promise<ScalerLogEvent> {
  const detailsPath = await writeAuditDetail(cwd, `tool-${input.toolName}`, { input: input.input, result: input.result }, now);
  const event = createLogEvent(state, {
    eventType: "tool",
    summary: input.summary,
    details: { toolName: input.toolName, accepted: input.accepted, detailsPath },
    detailsPath,
  }, now);
  await appendLogEvent(cwd, event);
  return event;
}

export async function readLogEvents(cwd: string): Promise<ScalerLogEvent[]> {
  const logPath = getEventLogPath(cwd);
  try {
    const raw = await readFile(logPath, "utf8");
    return raw
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as ScalerLogEvent);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function logStateEvent(
  cwd: string,
  state: ScalerState,
  summary: string,
  details?: unknown,
): Promise<ScalerLogEvent> {
  const event = createLogEvent(state, { eventType: "state", summary, details });
  await appendLogEvent(cwd, event);
  return event;
}

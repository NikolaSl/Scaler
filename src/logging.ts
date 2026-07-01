import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { getEventLogPath } from "./paths.js";
import type { ScalerState, ScalerStage } from "./types.js";

export type ScalerLogEventType =
  | "state"
  | "transition"
  | "rejected_transition"
  | "agent"
  | "tool"
  | "memory"
  | "validation"
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

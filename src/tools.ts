import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { createLogEvent, appendLogEvent } from "./logging.js";
import { ensureState } from "./state.js";
import { buildTaskAgentInvocation } from "./subagents.js";

export const scalerToolNames = [
  "scaler_report",
  "scaler_memory_write",
  "scaler_memory_retrieve",
  "scaler_spawn_task",
  "scaler_validation_report",
  "scaler_debug_attempt",
] as const;

export type ScalerToolName = (typeof scalerToolNames)[number];

const ReportParams = Type.Object({
  reportType: Type.String({ description: "Report type, e.g. task, research, plan, blocker." }),
  summary: Type.String({ description: "Concise report summary." }),
  taskId: Type.Optional(Type.String({ description: "Related task id, if any." })),
  details: Type.Optional(Type.Unknown({ description: "Structured report details." })),
});

const MemoryWriteParams = Type.Object({
  title: Type.String({ description: "Memory title." }),
  content: Type.String({ description: "Memory content to store later." }),
  taskId: Type.Optional(Type.String()),
});

const MemoryRetrieveParams = Type.Object({
  memoryIdOrPath: Type.String({ description: "Memory id or path to retrieve later." }),
  reason: Type.String({ description: "Why this memory is needed." }),
  scope: Type.Optional(Type.String({ description: "Requested section/scope." })),
});

const SpawnTaskParams = Type.Object({
  taskId: Type.String(),
  prompt: Type.String(),
  tools: Type.Optional(Type.Array(Type.String())),
  model: Type.Optional(Type.String()),
});

const ValidationReportParams = Type.Object({
  taskId: Type.String(),
  status: Type.String({ description: "passed, failed, partial, blocked, or not_applicable." }),
  summary: Type.String(),
  details: Type.Optional(Type.Unknown()),
});

const DebugAttemptParams = Type.Object({
  taskId: Type.String(),
  failureId: Type.String(),
  hypothesis: Type.String(),
  actionSummary: Type.String(),
  result: Type.String({ description: "fixed, same_failure, new_failure, partial, no_effect, worse, or blocked." }),
  details: Type.Optional(Type.Unknown()),
});

export function registerScalerTools(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "scaler_report",
    label: "Scaler Report",
    description: "Submit a structured report to Scaler supervisor/logging.",
    parameters: ReportParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      await logTool(ctx.cwd, "scaler_report", params.summary, params);
      return textResult(`Report accepted: ${params.summary}`, { status: "accepted", params });
    },
  });

  pi.registerTool({
    name: "scaler_memory_write",
    label: "Scaler Memory Write",
    description: "Request writing external memory. Skeleton currently logs the request only.",
    parameters: MemoryWriteParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      await logTool(ctx.cwd, "scaler_memory_write", `Memory write requested: ${params.title}`, params);
      return textResult(`Memory write request logged: ${params.title}`, { status: "logged", params });
    },
  });

  pi.registerTool({
    name: "scaler_memory_retrieve",
    label: "Scaler Memory Retrieve",
    description: "Request external memory retrieval. Skeleton currently logs the request only.",
    parameters: MemoryRetrieveParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      await logTool(ctx.cwd, "scaler_memory_retrieve", `Memory retrieval requested: ${params.memoryIdOrPath}`, params);
      return textResult(`Memory retrieval request logged: ${params.memoryIdOrPath}`, { status: "logged", params });
    },
  });

  pi.registerTool({
    name: "scaler_spawn_task",
    label: "Scaler Spawn Task",
    description: "Prepare isolated task-agent spawn. Skeleton returns the Pi invocation without executing it.",
    parameters: SpawnTaskParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const invocation = buildTaskAgentInvocation({
        taskId: params.taskId,
        prompt: params.prompt,
        tools: params.tools,
        model: params.model,
        cwd: ctx.cwd,
      });
      await logTool(ctx.cwd, "scaler_spawn_task", `Task spawn prepared: ${params.taskId}`, { params, invocation });
      return textResult(`Task spawn prepared: ${params.taskId}`, { status: "prepared", invocation });
    },
  });

  pi.registerTool({
    name: "scaler_validation_report",
    label: "Scaler Validation Report",
    description: "Submit a structured validation report.",
    parameters: ValidationReportParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      await logTool(ctx.cwd, "scaler_validation_report", `Validation ${params.status}: ${params.taskId}`, params);
      return textResult(`Validation report logged for ${params.taskId}: ${params.status}`, { status: "logged", params });
    },
  });

  pi.registerTool({
    name: "scaler_debug_attempt",
    label: "Scaler Debug Attempt",
    description: "Record a debug attempt for loop-resistant debugging.",
    parameters: DebugAttemptParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      await logTool(ctx.cwd, "scaler_debug_attempt", `Debug attempt ${params.result}: ${params.taskId}`, params);
      return textResult(`Debug attempt logged for ${params.taskId}: ${params.result}`, { status: "logged", params });
    },
  });
}

async function logTool(cwd: string, toolName: ScalerToolName, summary: string, details: unknown): Promise<void> {
  const state = await ensureState(cwd);
  await appendLogEvent(cwd, createLogEvent(state, { eventType: "tool", summary, details: { toolName, details } }));
}

function textResult(text: string, details: unknown) {
  return {
    content: [{ type: "text" as const, text }],
    details,
  };
}

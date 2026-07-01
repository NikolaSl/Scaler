import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { createLogEvent, appendLogEvent } from "./logging.js";
import { retrieveMemory, writeMemory } from "./memory.js";
import { ingestReport } from "./reports.js";
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
  stageTransition: Type.Optional(Type.String({ description: "Requested supervisor stage transition." })),
  taskTransition: Type.Optional(Type.String({ description: "Requested task status transition." })),
  reason: Type.Optional(Type.String({ description: "Transition reason." })),
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
      const state = await ensureState(ctx.cwd);
      const result = await ingestReport(ctx.cwd, state, {
        reportType: params.reportType,
        summary: params.summary,
        taskId: params.taskId,
        details: params.details,
        stageTransition: params.stageTransition,
        taskTransition: params.taskTransition,
        reason: params.reason,
      });
      await logTool(ctx.cwd, "scaler_report", params.summary, params);
      return textResult(`${result.message} ${params.summary}`, { status: result.accepted ? "accepted" : "rejected_transition", params });
    },
  });

  pi.registerTool({
    name: "scaler_memory_write",
    label: "Scaler Memory Write",
    description: "Write external memory under .scaler/memory and log the operation.",
    parameters: MemoryWriteParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const entry = await writeMemory(ctx.cwd, {
        title: params.title,
        content: params.content,
        taskId: params.taskId,
      });
      await logTool(ctx.cwd, "scaler_memory_write", `Memory written: ${entry.id}`, { params, entry });
      return textResult(`Memory written: ${entry.id}\nPath: ${entry.path}\nSummary: ${entry.summary}`, { status: "written", entry });
    },
  });

  pi.registerTool({
    name: "scaler_memory_retrieve",
    label: "Scaler Memory Retrieve",
    description: "Retrieve external memory content by id/path and log the operation.",
    parameters: MemoryRetrieveParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const memory = await retrieveMemory(ctx.cwd, params.memoryIdOrPath);
      await logTool(ctx.cwd, "scaler_memory_retrieve", `Memory retrieved: ${memory.entry.id}`, { params, entry: memory.entry });
      return textResult(memory.content, { status: "retrieved", entry: memory.entry, reason: params.reason, scope: params.scope });
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

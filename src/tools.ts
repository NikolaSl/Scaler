import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { incrementBudgetUsage, persistBudgetDecision, type BudgetUsageKey } from "./budgets.js";
import { recordDebugAttempt } from "./debug.js";
import { acquireExecutionLock, releaseExecutionLock } from "./locks.js";
import { createLogEvent, appendLogEvent } from "./logging.js";
import { retrieveMemory, writeMemory } from "./memory.js";
import {
  createPrdVersionSnapshot,
  saveCurrentPrd,
  savePrdRequirements,
  upsertPrdRequirement,
  type RuntimePrdRequirement,
  type RuntimePrdRequirementStatus,
} from "./prd.js";
import { ingestReport } from "./reports.js";
import { ensureState } from "./state.js";
import { buildTaskAgentInvocation, runTaskAgent, type TaskAgentRunResult } from "./subagents.js";
import { createTask, updateTask } from "./tasks.js";
import { prepareToolRequest } from "./tool-requests.js";
import type { ScalerState } from "./types.js";
import { applyValidationReport, saveValidationManifest } from "./validation.js";

export const scalerToolNames = [
  "scaler_report",
  "scaler_memory_write",
  "scaler_memory_retrieve",
  "scaler_spawn_task",
  "scaler_tool_request",
  "scaler_task_create",
  "scaler_task_update",
  "scaler_prd_write",
  "scaler_prd_requirement_update",
  "scaler_validation_manifest_write",
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

export interface SpawnTaskToolParams {
  taskId: string;
  prompt: string;
  tools?: string[];
  model?: string;
  execute?: boolean;
  timeoutMs?: number;
}

const SpawnTaskParams = Type.Object({
  taskId: Type.String(),
  prompt: Type.String(),
  tools: Type.Optional(Type.Array(Type.String())),
  model: Type.Optional(Type.String()),
  execute: Type.Optional(Type.Boolean({ description: "Execute the task agent instead of only preparing invocation." })),
  timeoutMs: Type.Optional(Type.Number({ description: "Task-agent timeout in milliseconds." })),
});

const ToolRequestParams = Type.Object({
  toolName: Type.String({ description: "Exact tool/MCP name requested." }),
  request: Type.String({ description: "Concise free-form request for the isolated tool agent." }),
  taskId: Type.Optional(Type.String()),
  contextSummary: Type.Optional(Type.String()),
  allowedTools: Type.Optional(Type.Array(Type.String(), { description: "Additional tools explicitly allowed for the isolated tool agent." })),
});

const TaskCreateParams = Type.Object({
  taskId: Type.String(),
  title: Type.Optional(Type.String()),
  status: Type.Optional(Type.String({ description: "Initial task status. Defaults to pending." })),
  allowedPathPrefixes: Type.Optional(Type.Array(Type.String(), { description: "Paths this task is allowed to modify/commit." })),
  dependsOn: Type.Optional(Type.Array(Type.String(), { description: "Task ids that must be validated first." })),
  prdRefs: Type.Optional(Type.Array(Type.String(), { description: "Runtime PRD requirement ids this task implements." })),
});

const TaskUpdateParams = Type.Object({
  taskId: Type.String(),
  title: Type.Optional(Type.String()),
  status: Type.Optional(Type.String({ description: "Target task status; must be a valid transition." })),
  allowedPathPrefixes: Type.Optional(Type.Array(Type.String(), { description: "Replacement allowed paths." })),
  dependsOn: Type.Optional(Type.Array(Type.String(), { description: "Replacement dependency ids." })),
  prdRefs: Type.Optional(Type.Array(Type.String(), { description: "Replacement runtime PRD requirement ids." })),
});

const PrdWriteParams = Type.Object({
  content: Type.String({ description: "Polished runtime PRD markdown content." }),
  snapshotCurrent: Type.Optional(Type.Boolean({ description: "Snapshot the existing current PRD before replacing it." })),
  snapshotReason: Type.Optional(Type.String({ description: "Reason recorded for the snapshot." })),
  requirements: Type.Optional(
    Type.Array(
      Type.Object({
        id: Type.String(),
        statement: Type.String(),
        title: Type.Optional(Type.String()),
        source: Type.Optional(Type.String()),
      }),
    ),
  ),
});

const PrdRequirementUpdateParams = Type.Object({
  id: Type.String(),
  statement: Type.String(),
  title: Type.Optional(Type.String()),
  source: Type.Optional(Type.String()),
  status: Type.Optional(Type.String({ description: "pending, in_progress, implemented, validated, blocked, or needs_replan." })),
  taskIds: Type.Optional(Type.Array(Type.String())),
  evidenceRefs: Type.Optional(Type.Array(Type.String())),
  notes: Type.Optional(Type.String()),
});

const ValidationManifestWriteParams = Type.Object({
  taskId: Type.String(),
  commands: Type.Array(
    Type.Object({
      id: Type.String(),
      command: Type.String(),
      description: Type.Optional(Type.String()),
      timeoutMs: Type.Optional(Type.Number()),
      required: Type.Optional(Type.Boolean()),
    }),
  ),
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
  failureFingerprint: Type.Optional(Type.String()),
  resultingFailureFingerprint: Type.Optional(Type.String()),
  attemptSignature: Type.Optional(Type.String()),
  changedFiles: Type.Optional(Type.Array(Type.String())),
  commands: Type.Optional(Type.Array(Type.String())),
  evidence: Type.Optional(Type.Array(Type.String())),
  validationRun: Type.Optional(Type.String()),
  logRefs: Type.Optional(Type.Array(Type.String())),
  newEvidence: Type.Optional(Type.String({ description: "New evidence that justifies retrying an otherwise repeated attempt." })),
  failureSummary: Type.Optional(Type.String()),
  validationCommand: Type.Optional(Type.String()),
  expectedResult: Type.Optional(Type.String()),
  actualResult: Type.Optional(Type.String()),
  outputRefs: Type.Optional(Type.Array(Type.String())),
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
    description: "Prepare or execute an isolated task-agent spawn.",
    parameters: SpawnTaskParams,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const result = await prepareOrRunSpawnTask(ctx.cwd, params, signal);
      if (params.execute) await recordBudgetUsage(ctx.cwd, "spawnedAgents");
      await logTool(ctx.cwd, "scaler_spawn_task", result.summary, result.details);
      return textResult(result.text, result.details);
    },
  });

  pi.registerTool({
    name: "scaler_tool_request",
    label: "Scaler Tool Request",
    description: "Prepare an isolated Tool/MCP agent request with only explicitly requested tools.",
    parameters: ToolRequestParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const state = await ensureState(ctx.cwd);
      const result = await prepareToolRequest(ctx.cwd, state, {
        toolName: params.toolName,
        request: params.request,
        taskId: params.taskId,
        contextSummary: params.contextSummary,
        allowedTools: params.allowedTools,
      });
      await recordBudgetUsage(ctx.cwd, "toolCalls");
      return textResult(result.message, {
        status: result.accepted ? "prepared" : "rejected",
        record: result.record,
        invocation: result.invocation,
      });
    },
  });

  pi.registerTool({
    name: "scaler_task_create",
    label: "Scaler Task Create",
    description: "Create a supervisor task record.",
    parameters: TaskCreateParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const state = await ensureState(ctx.cwd);
      const result = await createTask(ctx.cwd, state, {
        id: params.taskId,
        title: params.title,
        status: params.status,
        allowedPathPrefixes: params.allowedPathPrefixes,
        dependsOn: params.dependsOn,
        prdRefs: params.prdRefs,
      });
      await logTool(ctx.cwd, "scaler_task_create", result.message, params);
      return textResult(result.message, { status: result.accepted ? "created" : "rejected", taskId: params.taskId });
    },
  });

  pi.registerTool({
    name: "scaler_task_update",
    label: "Scaler Task Update",
    description: "Update task metadata and optionally request a valid task status transition.",
    parameters: TaskUpdateParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const state = await ensureState(ctx.cwd);
      const result = await updateTask(ctx.cwd, state, {
        id: params.taskId,
        title: params.title,
        status: params.status,
        allowedPathPrefixes: params.allowedPathPrefixes,
        dependsOn: params.dependsOn,
        prdRefs: params.prdRefs,
      });
      await logTool(ctx.cwd, "scaler_task_update", result.message, params);
      return textResult(result.message, { status: result.accepted ? "updated" : "rejected", taskId: params.taskId });
    },
  });

  pi.registerTool({
    name: "scaler_prd_write",
    label: "Scaler Runtime PRD Write",
    description: "Write the polished runtime PRD and optional requirement catalog under .scaler/prd.",
    parameters: PrdWriteParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const snapshotPath = params.snapshotCurrent ? await createPrdVersionSnapshot(ctx.cwd, { reason: params.snapshotReason ?? "PRD replaced" }) : undefined;
      await saveCurrentPrd(ctx.cwd, params.content);
      let requirements: RuntimePrdRequirement[] | undefined;
      if (params.requirements) {
        const timestamp = new Date().toISOString();
        requirements = params.requirements.map((requirement) => ({
          ...requirement,
          createdAt: timestamp,
          updatedAt: timestamp,
        }));
        await savePrdRequirements(ctx.cwd, { version: 1, requirements });
      }
      await logTool(ctx.cwd, "scaler_prd_write", "Runtime PRD written", { snapshotPath, requirements });
      return textResult(`Runtime PRD written${snapshotPath ? ` snapshot=${snapshotPath}` : ""}`, {
        status: "written",
        snapshotPath,
        requirementCount: requirements?.length,
      });
    },
  });

  pi.registerTool({
    name: "scaler_prd_requirement_update",
    label: "Scaler Runtime PRD Requirement Update",
    description: "Add or update a runtime PRD requirement and optional coverage status.",
    parameters: PrdRequirementUpdateParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const requirement = await upsertPrdRequirement(ctx.cwd, {
        id: params.id,
        statement: params.statement,
        title: params.title,
        source: params.source,
        status: params.status as RuntimePrdRequirementStatus | undefined,
        taskIds: params.taskIds,
        evidenceRefs: params.evidenceRefs,
        notes: params.notes,
      });
      await logTool(ctx.cwd, "scaler_prd_requirement_update", `Runtime PRD requirement updated: ${params.id}`, params);
      return textResult(`Runtime PRD requirement updated: ${params.id}`, { status: "updated", requirement });
    },
  });

  pi.registerTool({
    name: "scaler_validation_manifest_write",
    label: "Scaler Validation Manifest Write",
    description: "Persist validation commands for a task.",
    parameters: ValidationManifestWriteParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const manifest = await saveValidationManifest(ctx.cwd, {
        taskId: params.taskId,
        commands: params.commands.map((command) => ({
          id: command.id,
          command: command.command,
          description: command.description,
          timeoutMs: command.timeoutMs,
          required: command.required ?? true,
        })),
        createdAt: "",
        updatedAt: "",
      });
      await logTool(ctx.cwd, "scaler_validation_manifest_write", `Validation manifest written: ${params.taskId}`, { manifest });
      return textResult(`Validation manifest written for ${params.taskId}: ${manifest.commands.length} commands`, {
        status: "written",
        manifest,
      });
    },
  });

  pi.registerTool({
    name: "scaler_validation_report",
    label: "Scaler Validation Report",
    description: "Submit a structured validation report.",
    parameters: ValidationReportParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const state = await ensureState(ctx.cwd);
      const result = await applyValidationReport(ctx.cwd, state, {
        taskId: params.taskId,
        status: params.status,
        summary: params.summary,
        details: params.details,
      });
      await logTool(ctx.cwd, "scaler_validation_report", result.message, params);
      return textResult(result.message, { status: result.accepted ? "applied" : "rejected", params, targetStatus: result.targetStatus });
    },
  });

  pi.registerTool({
    name: "scaler_debug_attempt",
    label: "Scaler Debug Attempt",
    description: "Record a debug attempt for loop-resistant debugging.",
    parameters: DebugAttemptParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const state = await ensureState(ctx.cwd);
      const result = await recordDebugAttempt(ctx.cwd, state, {
        taskId: params.taskId,
        failureId: params.failureId,
        hypothesis: params.hypothesis,
        actionSummary: params.actionSummary,
        result: params.result,
        failureFingerprint: params.failureFingerprint,
        resultingFailureFingerprint: params.resultingFailureFingerprint,
        attemptSignature: params.attemptSignature,
        changedFiles: params.changedFiles,
        commands: params.commands,
        evidence: params.evidence,
        validationRun: params.validationRun,
        logRefs: params.logRefs,
        newEvidence: params.newEvidence,
        failureSummary: params.failureSummary,
        validationCommand: params.validationCommand,
        expectedResult: params.expectedResult,
        actualResult: params.actualResult,
        outputRefs: params.outputRefs,
      });
      if (result.accepted) await recordBudgetUsage(ctx.cwd, "debugAttempts");
      return textResult(result.message, {
        status: result.accepted ? "recorded" : "rejected",
        attemptId: result.attempt?.id,
        duplicateAttemptId: result.duplicateAttemptId,
        cycleDetected: result.cycleDetected,
      });
    },
  });
}

export async function prepareOrRunSpawnTask(
  cwd: string,
  params: SpawnTaskToolParams,
  signal?: AbortSignal,
  runner: typeof runTaskAgent = runTaskAgent,
): Promise<{ text: string; summary: string; details: unknown }> {
  const request = {
    taskId: params.taskId,
    prompt: params.prompt,
    tools: params.tools,
    model: params.model,
    cwd,
  };
  const invocation = buildTaskAgentInvocation(request);

  if (!params.execute) {
    return {
      text: `Task spawn prepared: ${params.taskId}`,
      summary: `Task spawn prepared: ${params.taskId}`,
      details: { status: "prepared", invocation },
    };
  }

  const lock = await acquireExecutionLock(cwd, {
    operation: "spawn_task_execute",
    taskId: params.taskId,
    reason: "scaler_spawn_task execute requested.",
  });
  if (!lock.acquired) {
    return {
      text: lock.message,
      summary: `Task spawn refused: ${params.taskId}`,
      details: { status: "locked", invocation, existingLock: lock.existingLock },
    };
  }

  try {
    const runResult: TaskAgentRunResult = await runner(request, { signal, timeoutMs: params.timeoutMs });
    return {
      text: `Task spawn executed: ${params.taskId} exit=${runResult.exitCode}`,
      summary: `Task spawn executed: ${params.taskId}`,
      details: { status: runResult.exitCode === 0 ? "executed" : "failed", invocation, result: runResult },
    };
  } finally {
    await releaseExecutionLock(cwd, lock.lock.id);
  }
}

async function logTool(cwd: string, toolName: ScalerToolName, summary: string, details: unknown): Promise<void> {
  const state = await recordBudgetUsage(cwd, "toolCalls");
  await appendLogEvent(cwd, createLogEvent(state, { eventType: "tool", summary, details: { toolName, details } }));
}

async function recordBudgetUsage(cwd: string, key: BudgetUsageKey): Promise<ScalerState> {
  const state = await ensureState(cwd);
  const { state: budgetedState, decision } = incrementBudgetUsage(state, key);
  return await persistBudgetDecision(cwd, budgetedState, decision);
}

function textResult(text: string, details: unknown) {
  return {
    content: [{ type: "text" as const, text }],
    details,
  };
}

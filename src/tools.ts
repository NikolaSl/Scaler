/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { incrementBudgetUsage, persistBudgetDecision, recordStorageBudgetUsage, type BudgetUsageKey } from "./budgets.js";
import { recordDebugAttempt } from "./debug.js";
import { acquireExecutionLock, releaseExecutionLock } from "./locks.js";
import { logToolAudit } from "./logging.js";
import { applyPlanningReport, type ExecutionPlanStatus } from "./plans.js";
import { formatMemorySearchResults, retrieveMemory, searchMemory, writeMemory, type MemoryValidity } from "./memory.js";
import { recordProviderUsageBudget } from "./provider-usage.js";
import {
  createPrdVersionSnapshot,
  saveCurrentPrd,
  savePrdRequirements,
  upsertPrdRequirement,
  type RuntimePrdRequirement,
  type RuntimePrdRequirementStatus,
} from "./prd.js";
import { ingestReport } from "./reports.js";
import { recordResearchReport } from "./research.js";
import { ensureState } from "./state.js";
import { buildTaskAgentInvocation, runTaskAgent, type TaskAgentRunResult } from "./subagents.js";
import { recordTaskAgentReport } from "./task-reports.js";
import { createTask, updateTask } from "./tasks.js";
import { prepareToolRequest, recordToolResult, recordToolSchema } from "./tool-requests.js";
import type { ScalerState } from "./types.js";
import { applyValidationReport, saveValidationManifest } from "./validation.js";

export const scalerToolNames = [
  "scaler_report",
  "scaler_memory_write",
  "scaler_memory_retrieve",
  "scaler_memory_search",
  "scaler_research_report",
  "scaler_task_report",
  "scaler_spawn_task",
  "scaler_tool_request",
  "scaler_tool_schema",
  "scaler_tool_result",
  "scaler_task_create",
  "scaler_task_update",
  "scaler_planning_report",
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
  tags: Type.Optional(Type.Array(Type.String(), { description: "Searchable memory tags." })),
  summary: Type.Optional(Type.String({ description: "Short summary/reference to keep in active context." })),
});

const MemoryRetrieveParams = Type.Object({
  memoryIdOrPath: Type.String({ description: "Memory id or path to retrieve later." }),
  reason: Type.String({ description: "Why this memory is needed." }),
  scope: Type.Optional(Type.String({ description: "Requested section/scope: summary, full, or section:<heading>." })),
});

const MemorySearchParams = Type.Object({
  query: Type.Optional(Type.String({ description: "Search words to match against memory id/title/summary/source/path/tags." })),
  tags: Type.Optional(Type.Array(Type.String(), { description: "All tags that must be present." })),
  taskId: Type.Optional(Type.String({ description: "Task id filter." })),
  validity: Type.Optional(Type.String({ description: "active, stale, obsolete, unknown, or any." })),
  includeObsolete: Type.Optional(Type.Boolean({ description: "Include obsolete memories in candidates." })),
  limit: Type.Optional(Type.Number({ description: "Maximum candidates to return." })),
});

const TaskAgentReportParams = Type.Object({
  taskId: Type.String(),
  status: Type.String({ description: "completed, needs_data, blocked, failed, or needs_replan." }),
  summary: Type.String(),
  outputs: Type.Optional(Type.Unknown()),
  artifacts: Type.Optional(Type.Array(Type.String())),
  changedFiles: Type.Optional(Type.Array(Type.String())),
  memoryRefs: Type.Optional(Type.Array(Type.String())),
  validations: Type.Optional(Type.Array(Type.Object({
    id: Type.Optional(Type.String()),
    command: Type.Optional(Type.String()),
    status: Type.Optional(Type.String()),
    summary: Type.Optional(Type.String()),
    evidenceRefs: Type.Optional(Type.Array(Type.String())),
  }))),
  validationRefs: Type.Optional(Type.Array(Type.String())),
  evidenceRefs: Type.Optional(Type.Array(Type.String())),
  blockers: Type.Optional(Type.Array(Type.String())),
  missingData: Type.Optional(Type.Array(Type.String())),
  recommendedNextAction: Type.Optional(Type.String()),
});

const ResearchReportParams = Type.Object({
  question: Type.String(),
  status: Type.Optional(Type.String({ description: "complete, partial, or blocked." })),
  requestId: Type.Optional(Type.String()),
  taskId: Type.Optional(Type.String()),
  requirementRefs: Type.Optional(Type.Array(Type.String())),
  sources: Type.Array(Type.Object({
    id: Type.String(),
    title: Type.String(),
    quality: Type.String({ description: "project, official, primary, trusted, reputable, weak, or unknown." }),
    url: Type.Optional(Type.String()),
    path: Type.Optional(Type.String()),
    version: Type.Optional(Type.String()),
    summary: Type.Optional(Type.String()),
  })),
  conclusions: Type.Array(Type.Object({
    summary: Type.String(),
    confidence: Type.String({ description: "high, medium, low, or unknown." }),
    sourceRefs: Type.Array(Type.String()),
    evidenceRefs: Type.Optional(Type.Array(Type.String())),
  })),
  contradictions: Type.Optional(Type.Array(Type.Object({
    summary: Type.String(),
    status: Type.String({ description: "resolved or unresolved." }),
    sourceRefs: Type.Array(Type.String()),
    resolution: Type.Optional(Type.String()),
  }))),
  unresolvedUnknowns: Type.Optional(Type.Array(Type.String())),
  recommendations: Type.Optional(Type.Array(Type.String())),
  rawEvidence: Type.Optional(Type.Array(Type.Object({
    title: Type.String(),
    content: Type.String(),
    sourceId: Type.Optional(Type.String()),
    summary: Type.Optional(Type.String()),
  }))),
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
  requesterAgentId: Type.Optional(Type.String({ description: "Requester agent id, if different from task id." })),
  contextSummary: Type.Optional(Type.String()),
  expectedOutput: Type.Optional(Type.String({ description: "What the requester needs back from the tool agent." })),
  requiredFormat: Type.Optional(Type.String({ description: "Required response format, if any." })),
  riskLevel: Type.Optional(Type.String({ description: "low, medium, high, destructive, external, secret, or unknown." })),
  permissionRequirement: Type.Optional(Type.String({ description: "Approval or policy requirement known to the requester." })),
  safetyNotes: Type.Optional(Type.String({ description: "Safety constraints for the isolated tool agent." })),
  allowedTools: Type.Optional(Type.Array(Type.String(), { description: "Additional tools explicitly allowed for the isolated tool agent." })),
});

const ToolSchemaParams = Type.Object({
  toolName: Type.String({ description: "Exact tool/MCP name whose schema or docs were discovered." }),
  source: Type.String({ description: "Where the metadata came from, e.g. help output, MCP schema endpoint, or local docs ref." }),
  description: Type.Optional(Type.String({ description: "Concise description of what the tool does." })),
  riskLevel: Type.Optional(Type.String({ description: "low, medium, high, destructive, external, secret, or unknown." })),
  permissionRequirement: Type.Optional(Type.String({ description: "Known approval or policy requirement." })),
  safetyNotes: Type.Optional(Type.String({ description: "Safety constraints discovered for this tool." })),
  docsRef: Type.Optional(Type.String({ description: "Stable docs/reference id or path." })),
  schemaRef: Type.Optional(Type.String({ description: "Stable schema/reference id or path." })),
  notes: Type.Optional(Type.String({ description: "Concise schema notes such as required args." })),
  evidenceRefs: Type.Optional(Type.Array(Type.String(), { description: "Evidence/source/log refs supporting the metadata." })),
  discoveredByAgentId: Type.Optional(Type.String({ description: "Agent id that discovered the metadata." })),
});

const ToolResultParams = Type.Object({
  requestId: Type.String({ description: "The scaler_tool_request id being completed." }),
  status: Type.String({ description: "completed, failed, or blocked." }),
  summary: Type.String({ description: "Concise result summary." }),
  outputs: Type.Optional(Type.Unknown({ description: "Structured output payload returned to the requester." })),
  evidenceRefs: Type.Optional(Type.Array(Type.String(), { description: "Evidence/source/log refs supporting the result." })),
  validationPerformed: Type.Optional(Type.Array(Type.String(), { description: "Checks performed by the isolated tool agent." })),
  errors: Type.Optional(Type.Array(Type.String(), { description: "Errors or blockers encountered." })),
  recommendations: Type.Optional(Type.Array(Type.String(), { description: "Follow-up recommendations." })),
});

const TaskQualityWaiverParams = Type.Object({
  code: Type.String({ description: "Quality issue code being explicitly waived, e.g. missing_test_first." }),
  reason: Type.String({ description: "Why the waiver is acceptable and what alternative evidence/validation applies." }),
  evidenceRefs: Type.Optional(Type.Array(Type.String())),
  approvedBy: Type.Optional(Type.String()),
});

const TaskValidationCommandParams = Type.Object({
  id: Type.String(),
  command: Type.String(),
  description: Type.Optional(Type.String()),
  timeoutMs: Type.Optional(Type.Number()),
  required: Type.Optional(Type.Boolean()),
  gate: Type.Optional(Type.String({ description: "dependency_check, test_first, build_compile, unit_tests, integration_tests, static_checks, security_checks, local_ci, acceptance_smoke, regression, or custom." })),
  expectedResult: Type.Optional(Type.String()),
  evidenceRefs: Type.Optional(Type.Array(Type.String())),
  environment: Type.Optional(Type.String()),
  disposition: Type.Optional(Type.String()),
  dispositionReason: Type.Optional(Type.String()),
});

const TaskCreateParams = Type.Object({
  taskId: Type.String(),
  title: Type.Optional(Type.String()),
  status: Type.Optional(Type.String({ description: "Initial task status. Defaults to pending." })),
  taskKind: Type.Optional(Type.String({ description: "software, non_software, or mixed. Software/mixed tasks require test_first coverage or a waiver." })),
  atomicityRationale: Type.Optional(Type.String({ description: "Why this is the smallest independently completable/testable task." })),
  allowedPathPrefixes: Type.Optional(Type.Array(Type.String(), { description: "Paths this task is allowed to modify/commit." })),
  dependsOn: Type.Optional(Type.Array(Type.String(), { description: "Task ids that must be validated first." })),
  prdRefs: Type.Optional(Type.Array(Type.String(), { description: "Runtime PRD requirement ids this task implements." })),
  definitionOfDone: Type.Optional(Type.Array(Type.String(), { description: "Concrete Definition of Done items." })),
  validationRefs: Type.Optional(Type.Array(Type.String(), { description: "Validation/checklist references when commands are not embedded." })),
  validationCommands: Type.Optional(Type.Array(TaskValidationCommandParams, { description: "Task-specific validation commands/checks to persist with the task." })),
  qualityWaivers: Type.Optional(Type.Array(TaskQualityWaiverParams, { description: "Explicit waivers for missing quality requirements." })),
});

const TaskUpdateParams = Type.Object({
  taskId: Type.String(),
  title: Type.Optional(Type.String()),
  status: Type.Optional(Type.String({ description: "Target task status; must be a valid transition." })),
  taskKind: Type.Optional(Type.String({ description: "software, non_software, or mixed." })),
  atomicityRationale: Type.Optional(Type.String()),
  allowedPathPrefixes: Type.Optional(Type.Array(Type.String(), { description: "Replacement allowed paths." })),
  dependsOn: Type.Optional(Type.Array(Type.String(), { description: "Replacement dependency ids." })),
  prdRefs: Type.Optional(Type.Array(Type.String(), { description: "Replacement runtime PRD requirement ids." })),
  definitionOfDone: Type.Optional(Type.Array(Type.String())),
  validationRefs: Type.Optional(Type.Array(Type.String())),
  validationCommands: Type.Optional(Type.Array(TaskValidationCommandParams)),
  qualityWaivers: Type.Optional(Type.Array(TaskQualityWaiverParams)),
});

const PlanningReportParams = Type.Object({
  id: Type.Optional(Type.String()),
  reason: Type.Optional(Type.String()),
  source: Type.Optional(Type.String()),
  requirements: Type.Array(Type.Object({
    id: Type.String(),
    statement: Type.String(),
    title: Type.Optional(Type.String()),
    source: Type.Optional(Type.String()),
    status: Type.Optional(Type.String({ description: "pending, in_progress, implemented, validated, blocked, or needs_replan." })),
    evidenceRefs: Type.Optional(Type.Array(Type.String())),
    notes: Type.Optional(Type.String()),
  })),
  plan: Type.Object({
    planVersion: Type.Number(),
    status: Type.String({ description: "draft, active, superseded, or completed." }),
    title: Type.Optional(Type.String()),
    source: Type.Optional(Type.String()),
    tasks: Type.Array(Type.Object({
      id: Type.String(),
      title: Type.String(),
      description: Type.Optional(Type.String()),
      taskKind: Type.Optional(Type.String()),
      atomicityRationale: Type.Optional(Type.String()),
      prdRefs: Type.Optional(Type.Array(Type.String())),
      allowedPathPrefixes: Type.Optional(Type.Array(Type.String())),
      dependsOn: Type.Optional(Type.Array(Type.String())),
      definitionOfDone: Type.Optional(Type.Array(Type.String())),
      validationRefs: Type.Optional(Type.Array(Type.String())),
      validationCommands: Type.Optional(Type.Array(TaskValidationCommandParams)),
      qualityWaivers: Type.Optional(Type.Array(TaskQualityWaiverParams)),
    })),
  }),
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
        tags: params.tags,
        summary: params.summary,
      });
      await recordCurrentStorageUsage(ctx.cwd);
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
      const memory = await retrieveMemory(ctx.cwd, params.memoryIdOrPath, { scope: params.scope });
      await logTool(ctx.cwd, "scaler_memory_retrieve", `Memory retrieved: ${memory.entry.id}`, { params, entry: memory.entry });
      return textResult(memory.content, { status: "retrieved", entry: memory.entry, reason: params.reason, scope: params.scope });
    },
  });

  pi.registerTool({
    name: "scaler_memory_search",
    label: "Scaler Memory Search",
    description: "Search external memory candidates by query/tag/task/validity and return summaries only.",
    parameters: MemorySearchParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const validity = normalizeMemoryValidityFilter(params.validity);
      const results = await searchMemory(ctx.cwd, {
        query: params.query,
        tags: params.tags,
        taskId: params.taskId,
        validity,
        includeObsolete: params.includeObsolete,
        limit: params.limit,
      });
      const message = formatMemorySearchResults(results, { query: params.query, tags: params.tags, taskId: params.taskId, validity });
      await logTool(ctx.cwd, "scaler_memory_search", `Memory search results: ${results.length}`, { params, results: results.map((result) => ({ entry: result.entry, score: result.score, matched: result.matched })) });
      return textResult(message, { status: "searched", results });
    },
  });

  pi.registerTool({
    name: "scaler_research_report",
    label: "Scaler Research Report",
    description: "Record structured research findings with source quality, confidence, contradictions, and optional raw evidence storage.",
    parameters: ResearchReportParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const report = await recordResearchReport(ctx.cwd, {
        question: params.question,
        status: params.status,
        requestId: params.requestId,
        taskId: params.taskId,
        requirementRefs: params.requirementRefs,
        sources: params.sources,
        conclusions: params.conclusions,
        contradictions: params.contradictions,
        unresolvedUnknowns: params.unresolvedUnknowns,
        recommendations: params.recommendations,
        rawEvidence: params.rawEvidence,
      });
      await recordBudgetUsage(ctx.cwd, "researchReports");
      await recordCurrentStorageUsage(ctx.cwd);
      await logTool(ctx.cwd, "scaler_research_report", `Research report recorded: ${report.id}`, { params, report });
      return textResult(`Research report recorded: ${report.id}`, { status: "recorded", report });
    },
  });

  pi.registerTool({
    name: "scaler_task_report",
    label: "Scaler Task Report",
    description: "Record the required structured completion report for a task-agent run.",
    parameters: TaskAgentReportParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const report = await recordTaskAgentReport(ctx.cwd, {
        taskId: params.taskId,
        status: params.status,
        summary: params.summary,
        outputs: params.outputs,
        artifacts: params.artifacts,
        changedFiles: params.changedFiles,
        memoryRefs: params.memoryRefs,
        validations: params.validations,
        validationRefs: params.validationRefs,
        evidenceRefs: params.evidenceRefs,
        blockers: params.blockers,
        missingData: params.missingData,
        recommendedNextAction: params.recommendedNextAction,
        source: "tool",
      });
      await recordCurrentStorageUsage(ctx.cwd);
      await logTool(ctx.cwd, "scaler_task_report", `Task-agent report recorded: ${report.id}`, { params, report });
      return textResult(`Task-agent report recorded: ${report.id}`, { status: "recorded", report });
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
        requesterAgentId: params.requesterAgentId,
        contextSummary: params.contextSummary,
        expectedOutput: params.expectedOutput,
        requiredFormat: params.requiredFormat,
        riskLevel: params.riskLevel,
        permissionRequirement: params.permissionRequirement,
        safetyNotes: params.safetyNotes,
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
    name: "scaler_tool_schema",
    label: "Scaler Tool Schema",
    description: "Record discovered docs/schema metadata for a Tool/MCP so later isolated tool agents can use verified local metadata.",
    parameters: ToolSchemaParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const state = await ensureState(ctx.cwd);
      const result = await recordToolSchema(ctx.cwd, state, {
        toolName: params.toolName,
        source: params.source,
        description: params.description,
        riskLevel: params.riskLevel,
        permissionRequirement: params.permissionRequirement,
        safetyNotes: params.safetyNotes,
        docsRef: params.docsRef,
        schemaRef: params.schemaRef,
        notes: params.notes,
        evidenceRefs: params.evidenceRefs,
        discoveredByAgentId: params.discoveredByAgentId,
      });
      await recordBudgetUsage(ctx.cwd, "toolCalls");
      return textResult(`Tool schema recorded: ${result.id}`, { status: "recorded", result });
    },
  });

  pi.registerTool({
    name: "scaler_tool_result",
    label: "Scaler Tool Result",
    description: "Record the structured result of an isolated Tool/MCP agent request.",
    parameters: ToolResultParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const state = await ensureState(ctx.cwd);
      const result = await recordToolResult(ctx.cwd, state, {
        requestId: params.requestId,
        status: params.status,
        summary: params.summary,
        outputs: params.outputs,
        evidenceRefs: params.evidenceRefs,
        validationPerformed: params.validationPerformed,
        errors: params.errors,
        recommendations: params.recommendations,
      });
      await recordBudgetUsage(ctx.cwd, "toolCalls");
      return textResult(`Tool result recorded: ${result.id}`, { status: "recorded", result });
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
        taskKind: params.taskKind,
        atomicityRationale: params.atomicityRationale,
        allowedPathPrefixes: params.allowedPathPrefixes,
        dependsOn: params.dependsOn,
        prdRefs: params.prdRefs,
        definitionOfDone: params.definitionOfDone,
        validationRefs: params.validationRefs,
        validationCommands: params.validationCommands,
        qualityWaivers: params.qualityWaivers,
        qualityMode: "enforce",
      });
      await logTool(ctx.cwd, "scaler_task_create", result.accepted ? `Task created: ${params.taskId}` : `Task create rejected: ${params.taskId}`, { params, result });
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
        taskKind: params.taskKind,
        atomicityRationale: params.atomicityRationale,
        allowedPathPrefixes: params.allowedPathPrefixes,
        dependsOn: params.dependsOn,
        prdRefs: params.prdRefs,
        definitionOfDone: params.definitionOfDone,
        validationRefs: params.validationRefs,
        validationCommands: params.validationCommands,
        qualityWaivers: params.qualityWaivers,
        qualityMode: "enforce",
      });
      await logTool(ctx.cwd, "scaler_task_update", result.message, params);
      return textResult(result.message, { status: result.accepted ? "updated" : "rejected", taskId: params.taskId });
    },
  });

  pi.registerTool({
    name: "scaler_planning_report",
    label: "Scaler Planning Report",
    description: "Ingest structured planner output, synchronize runtime PRD requirements, execution plan tasks, task PRD refs, and coverage diagnostics.",
    parameters: PlanningReportParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const state = await ensureState(ctx.cwd);
      const result = await applyPlanningReport(ctx.cwd, state, {
        id: params.id,
        reason: params.reason,
        source: params.source,
        requirements: params.requirements.map((requirement) => ({
          id: requirement.id,
          statement: requirement.statement,
          title: requirement.title,
          source: requirement.source,
          status: normalizePrdStatus(requirement.status),
          evidenceRefs: requirement.evidenceRefs,
          notes: requirement.notes,
        })),
        plan: { ...params.plan, status: normalizeExecutionPlanStatus(params.plan.status) },
      });
      await recordCurrentStorageUsage(ctx.cwd);
      await logTool(ctx.cwd, "scaler_planning_report", result.message, { params, report: result.report });
      return textResult(result.message, { status: result.accepted ? "accepted" : "warnings", report: result.report, plan: result.plan });
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
    if (runResult.usage) {
      const state = await ensureState(cwd);
      await recordProviderUsageBudget(cwd, state, runResult.usage, {
        source: "spawn-task-tool-run",
        taskId: params.taskId,
        agentId: params.taskId,
        agentType: "spawn-task",
      });
    }
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
  await logToolAudit(cwd, state, { toolName, summary, result: details });
}

async function recordBudgetUsage(cwd: string, key: BudgetUsageKey): Promise<ScalerState> {
  const state = await ensureState(cwd);
  const { state: budgetedState, decision } = incrementBudgetUsage(state, key);
  return await persistBudgetDecision(cwd, budgetedState, decision);
}

async function recordCurrentStorageUsage(cwd: string): Promise<ScalerState> {
  const state = await ensureState(cwd);
  const { state: budgetedState, decision } = await recordStorageBudgetUsage(cwd, state);
  return await persistBudgetDecision(cwd, budgetedState, decision);
}

function normalizeExecutionPlanStatus(value: string): ExecutionPlanStatus {
  const normalized = value.toLowerCase();
  if (["draft", "active", "superseded", "completed"].includes(normalized)) return normalized as ExecutionPlanStatus;
  return "draft";
}

function normalizePrdStatus(value: string | undefined): RuntimePrdRequirementStatus | undefined {
  if (!value) return undefined;
  const normalized = value.toLowerCase();
  if (["pending", "in_progress", "implemented", "validated", "blocked", "needs_replan"].includes(normalized)) return normalized as RuntimePrdRequirementStatus;
  return undefined;
}

function normalizeMemoryValidityFilter(value: string | undefined): MemoryValidity | "any" | undefined {
  if (!value) return undefined;
  const normalized = value.toLowerCase();
  if (["active", "stale", "obsolete", "unknown", "any"].includes(normalized)) return normalized as MemoryValidity | "any";
  return undefined;
}

function textResult(text: string, details: unknown) {
  return {
    content: [{ type: "text" as const, text }],
    details,
  };
}

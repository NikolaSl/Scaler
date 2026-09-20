/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { applyAdaptiveOrchestration, assessAdaptiveOrchestration, formatAdaptiveAssessment, startScalerRun } from "./adaptive.js";
import { runScalerAutomation } from "./autopilot.js";
import { formatBudgetStatus, getBudgetState, isBudgetUsageKey, persistBudgetDecision, setBudgetLimits, setBudgetUsage } from "./budgets.js";
import {
  parseBudgetSetArgs,
  parseCicdEnvArgs,
  parseCommitArgs,
  parseCommitSkipArgs,
  parseContextApproveArgs,
  parseContextCandidatesArgs,
  parseContextTaskArgs,
  parseDebugLoopArgs,
  parseDebugRunArgs,
  parseDebugRetryApprovalArgs,
  parseDebugRetryArgs,
  parseDebugRetryPolicyArgs,
  parseMemorySearchArgs,
  parseMissingContextResolveArgs,
  parseMissingContextRunArgs,
  parsePrdAmendArgs,
  parsePrdLinkArgs,
  parseReplanRequestArgs,
  parseReplanRunArgs,
  parseResearchReportArgs,
  parseResearchRequestArgs,
  parseResearchRunArgs,
  parseResearchWebArgs,
  parseSafetyApprovalArgs,
  parseSafetyPolicyArgs,
  parseSafetyScanArgs,
  parseStageLoopArgs,
  parseStageRecordArgs,
  parseStageRunArgs,
  parseStageWorkflowArgs,
  parseStorageMaintainArgs,
  parseStorageScheduleArgs,
  parseTaskCreateArgs,
  parseTaskUpdateArgs,
  parseTaskRetryArgs,
  parseToolCatalogArgs,
  parseToolDiscoverArgs,
  parseToolIterateArgs,
  parseToolIterationPolicyArgs,
  parseToolReplayApprovalArgs,
  parseToolReplayArgs,
  parseToolRunArgs,
  parseToolScheduleArgs,
  parseValidateLoopArgs,
  parseValidationAddArgs,
  parseValidationChecklistArgs,
  resolveCommitAllowedPaths,
  selectTaskForCommit,
} from "./commands.js";
import { pauseScalerRun, resumeScalerRun } from "./checkpoints.js";
import { formatCicdEnvironmentRecords, loadCicdEnvironmentRecords, provisionCicdEnvironment } from "./cicd-environments.js";
import { approveContextCandidate, buildContextHookInjection, discoverSemanticContextCandidates, ensureTaskContextManifest, formatContextCandidates, formatTaskContextManifest, loadTaskContextManifest } from "./context.js";
import { buildScalerCompactionInstructions, buildScalerCompactionResult, formatFreshContextHandoffs, formatScalerCompactionRecords, loadFreshContextHandoffRecords, loadScalerCompactionRecords, prepareFreshContextHandoff, shouldTriggerScalerCompaction } from "./context-compaction.js";
import { formatContextSplitRecords, loadContextSplitRecords } from "./context-splits.js";
import { formatTaskAgentRunList, loadTaskAgentRunRecords, runConductorStep } from "./conductor.js";
import { loadDebugAttempts, loadDebugFailures, loadDebugReports, loadDebugRetries, formatDebugReportSummary } from "./debug.js";
import { formatDebugAgentRunList, loadDebugAgentRunRecords, runDebugAgentStep } from "./debug-agent.js";
import { runDebugConductorLoop } from "./debug-conductor.js";
import { approveDebugRetry, formatDebugRetryApprovals, formatDebugRetryPolicy, formatDebugRetrySummary, loadDebugRetryApprovals, loadDebugRetryPolicy, runDebugRetryPolicyWorkflow, saveDebugRetryPolicy } from "./debug-retry.js";
import { ensureGitRepository, formatCommitReports, formatCommitSkips, formatGitBootstrapRecords, loadCommitReports, loadCommitSkips, loadGitBootstrapRecords } from "./git.js";
import { acquireExecutionLock, clearExecutionLock, formatExecutionLock, loadExecutionLock, releaseExecutionLock } from "./locks.js";
import { createLogEvent, appendLogEvent, externalizeLargeToolResult, logCommandAudit, logStateEvent, logToolAudit } from "./logging.js";
import { formatMemorySearchResults, loadMemoryIndex, searchMemory, type MemoryValidity } from "./memory.js";
import { dispatchMissingContextRequest, formatMissingContextRequests, loadMissingContextRequests, resolveMissingContextRequest, unblockTasksWithResolvedMissingContext } from "./missing-context.js";
import { commitWithExecutionLock, runValidationWithExecutionLock, skipCommitWithExecutionLock } from "./operations.js";
import { getEventLogPath } from "./paths.js";
import { formatValidationEnvironmentRecords, loadValidationEnvironmentRecords } from "./validation-environments.js";
import {
  acceptReplanProposal,
  applyExecutionPlanTasks,
  checkExecutionPlanPreservation,
  formatPlanningReports,
  formatExecutionPlanPreservationCheck,
  formatExecutionPlanSummary,
  formatReplanRequests,
  loadExecutionPlan,
  loadPlanningReports,
  loadProposedExecutionPlan,
  loadReplanRequests,
  summarizeExecutionPlan,
} from "./plans.js";
import { amendPrdRequirement, computePrdCoverageSummary, formatPrdCoverageSummary, loadPrdCoverage, loadPrdRequirements, type AmendPrdRequirementInput } from "./prd.js";
import { extractProviderUsage, recordProviderUsageBudget } from "./provider-usage.js";
import { requestReplan } from "./replanning.js";
import { formatReplanAgentRunList, loadReplanAgentRunRecords, runReplanAgentStep } from "./replan-agent.js";
import { formatResearchAgentRunList, loadResearchAgentRunRecords, runResearchAgentStep } from "./research-agent.js";
import { formatResearchSummary, loadResearchReports, loadResearchRequests, recordResearchReport, upsertResearchRequest } from "./research.js";
import { formatResearchWebRunResult, formatResearchWebTransactions, loadResearchWebTransactions, runResearchWebWorkflow } from "./research-web.js";
import { applySafetyApproval, assessToolCallSafety, createSafetyApproval, formatSafetyApprovals, formatSafetyPolicy, formatSafetyScanRecords, formatSafetyScanResult, loadSafetyApprovals, loadSafetyPolicy, loadSafetyScanRecords, mergeSafetyPolicy, revokeSafetyApproval, runSafetyScans, saveSafetyPolicy } from "./safety.js";
import { createTask, formatTaskList, retryTask, updateTask } from "./tasks.js";
import { formatTaskAgentReportList, loadTaskAgentReports } from "./task-reports.js";
import { formatTaskDefinitionReviews, loadTaskDefinitionReviews, parseTaskQualityWaivers, reviewAllTaskDefinitions, reviewTaskDefinition } from "./task-quality.js";
import { ensureState, formatDetailedStateStatus, formatStateStatus, saveState } from "./state.js";
import { advanceStageAfterReadyArtifact } from "./stage-advancement.js";
import { formatStageAgentRunList, loadStageAgentRunRecords, runStageAgentStep } from "./stage-agents.js";
import { runStageConductorLoop, runStageConductorStep } from "./stage-conductor.js";
import { formatStageWorkflowRunRecords, loadStageWorkflowRunRecords, runAutonomousStageWorkflow } from "./stage-workflow.js";
import {
  formatStageArtifactReadiness,
  formatStageArtifactSummary,
  loadStageArtifacts,
  summarizeStageArtifacts,
  upsertStageArtifact,
  validateStageArtifactReadiness,
} from "./stages.js";
import { formatStorageInventory, formatStorageMaintenanceReport, formatStorageMaintenanceSchedule, loadStorageMaintenanceSchedule, runScheduledStorageMaintenance, runStorageMaintenance, saveStorageInventory, scanScalerStorageInventory, updateStorageMaintenanceSchedule, type StorageMaintenancePolicy } from "./storage.js";
import { buildRuntimeToolCatalog, createToolReplayApproval, formatKnownToolCatalog, formatMcpEnumerationRuns, formatMcpServerRecords, formatRuntimeToolCatalog, formatToolIterationPolicy, formatToolIterationRuns, formatToolReplayApprovals, formatToolSchedules, formatToolSchemaDiscoveryRuns, formatToolTransactions, loadMcpEnumerationRuns, loadMcpServerRecords, loadToolIterationPolicy, loadToolIterationRuns, loadToolReplayApprovals, loadToolSchedules, loadToolSchemaDiscoveryRuns, loadToolSchemaRecords, loadToolTransactions, replayToolTransaction, revokeToolReplayApproval, runMcpServerEnumeration, runToolIterationWorkflow, runToolRequestAgent, runToolSchedule, runToolSchemaDiscoveryAgent, saveToolIterationPolicy, selectParentRequesterActiveTools, shouldApplyParentToolFocus } from "./tool-requests.js";
import { registerScalerTools } from "./tools.js";
import { formatValidationChecklist, recordValidationChecklist, upsertValidationManifestCommand } from "./validation.js";
import { runValidationDebugLoopWorkflow, selectTaskForValidationDebugLoop } from "./validation-debug-loop.js";
import { applyComplexityBudgetPolicy, formatComplexityBudgetPolicies, formatResumeVerificationRecords, formatWatchdogCleanupRecords, formatWatchdogEvents, formatWatchdogHeartbeats, loadResumeVerificationRecords, loadWatchdogCleanupRecords, loadWatchdogEvents, loadWatchdogHeartbeats, recordWatchdogHeartbeat, runWatchdogAssessment, verifyResumeReadiness } from "./watchdogs.js";
import { formatWorkflowSummary, summarizeWorkflow } from "./workflow.js";

type RuntimeToolAPI = Partial<Pick<ExtensionAPI, "getAllTools" | "getActiveTools" | "setActiveTools">>;

function runtimeToolApisAvailable(ctx: RuntimeToolAPI): ctx is Required<RuntimeToolAPI> {
  return typeof ctx.getAllTools === "function" && typeof ctx.getActiveTools === "function" && typeof ctx.setActiveTools === "function";
}

async function buildParentRuntimeToolCatalogText(cwd: string, ctx: RuntimeToolAPI): Promise<string | undefined> {
  if (!ctx.getAllTools || !ctx.getActiveTools) return undefined;
  const catalog = buildRuntimeToolCatalog(ctx.getAllTools(), ctx.getActiveTools(), await loadToolSchemaRecords(cwd));
  return formatRuntimeToolCatalog(catalog);
}

function applyParentToolFocus(cwd: string, state: Awaited<ReturnType<typeof ensureState>>, ctx: RuntimeToolAPI, snapshots: Map<string, string[]>, force = false): { applied: boolean; active: string[]; previous: string[] } | undefined {
  if (!runtimeToolApisAvailable(ctx) || (!force && !shouldApplyParentToolFocus(state))) return undefined;
  const allTools = ctx.getAllTools();
  const previous = ctx.getActiveTools();
  const desired = selectParentRequesterActiveTools(allTools.map((tool) => tool.name), previous);
  if (desired.length === 0 || arraysEqual(previous, desired)) return { applied: false, active: previous, previous };
  if (!snapshots.has(cwd)) snapshots.set(cwd, previous);
  ctx.setActiveTools(desired);
  return { applied: true, active: desired, previous };
}

function restoreParentToolFocus(cwd: string, ctx: RuntimeToolAPI, snapshots: Map<string, string[]>): string[] | undefined {
  if (!runtimeToolApisAvailable(ctx)) return undefined;
  const snapshot = snapshots.get(cwd);
  if (!snapshot) return undefined;
  ctx.setActiveTools(snapshot);
  snapshots.delete(cwd);
  return snapshot;
}

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export default function scalerExtension(pi: ExtensionAPI): void {
  registerScalerTools(pi);
  const isChildAgent = process.env.SCALER_CHILD_AGENT === "1";

  const originalRegisterCommand = pi.registerCommand.bind(pi);
  const auditedRegisterCommand: ExtensionAPI["registerCommand"] = (name, command) => originalRegisterCommand(name, {
    ...command,
    handler: async (args, ctx) => {
      const startState = await ensureState(ctx.cwd);
      await logCommandAudit(ctx.cwd, startState, { command: name, phase: "start", args: args ?? "" });
      try {
        const result = await command.handler(args, ctx);
        const endState = await ensureState(ctx.cwd);
        await logCommandAudit(ctx.cwd, endState, { command: name, phase: "end", args: args ?? "", accepted: true, message: "completed" });
        return result;
      } catch (error) {
        const errorState = await ensureState(ctx.cwd);
        const message = error instanceof Error ? error.message : String(error);
        await logCommandAudit(ctx.cwd, errorState, { command: name, phase: "error", args: args ?? "", accepted: false, error: message });
        throw error;
      }
    },
  });
  (pi as unknown as { registerCommand: ExtensionAPI["registerCommand"] }).registerCommand = auditedRegisterCommand;

  let lastAutoCompactKey: string | undefined;
  const activeToolFocusSnapshots = new Map<string, string[]>();

  pi.on("turn_end", async (event, ctx) => {
    const usage = extractProviderUsage([event]);
    let state = await ensureState(ctx.cwd);
    if (usage) {
      state = (await recordProviderUsageBudget(ctx.cwd, state, usage, {
        source: "parent-turn-end",
        agentType: "parent",
      })).state;
    }
    await recordWatchdogHeartbeat(ctx.cwd, {
      scopeKind: "run",
      scopeId: state.runId,
      status: "progress",
      action: "turn_end",
      taskId: state.currentTaskId ?? undefined,
      details: { usage },
    });

    const compactDecision = shouldTriggerScalerCompaction(ctx.getContextUsage?.());
    if (compactDecision.trigger && compactDecision.usage?.tokens !== null) {
      const compactKey = `${compactDecision.usage?.tokens}:${compactDecision.usage?.contextWindow}:${state.updatedAt}`;
      if (compactKey !== lastAutoCompactKey) {
        lastAutoCompactKey = compactKey;
        await logStateEvent(ctx.cwd, state, "SCALER automatic compaction requested", compactDecision);
        ctx.compact({ customInstructions: buildScalerCompactionInstructions(state, compactDecision) });
      }
    }
    const restoredTools = restoreParentToolFocus(ctx.cwd, pi, activeToolFocusSnapshots);
    if (restoredTools) await logStateEvent(ctx.cwd, state, "SCALER parent tool focus restored", { activeTools: restoredTools });
    return undefined;
  });

  pi.on("session_before_compact", async (event, ctx) => {
    const state = await ensureState(ctx.cwd);
    const compaction = await buildScalerCompactionResult(ctx.cwd, state, event.preparation, {
      reason: event.reason,
      willRetry: event.willRetry,
      customInstructions: event.customInstructions,
    });
    return { compaction };
  });

  pi.on("before_agent_start", async (_event, ctx) => {
    if (isChildAgent) return undefined;
    const state = await ensureState(ctx.cwd);
    const focus = applyParentToolFocus(ctx.cwd, state, pi, activeToolFocusSnapshots);
    if (focus?.applied) {
      await logStateEvent(ctx.cwd, state, "SCALER parent tool focus applied", {
        taskId: state.currentTaskId,
        previousActiveTools: focus.previous,
        activeTools: focus.active,
        lifecycle: "before_agent_start",
      });
    }
    return undefined;
  });

  pi.on("context", async (event, ctx) => {
    const state = await ensureState(ctx.cwd);
    const injection = await buildContextHookInjection(ctx.cwd, state);
    const runtimeToolCatalog = !isChildAgent && shouldApplyParentToolFocus(state) ? await buildParentRuntimeToolCatalogText(ctx.cwd, pi) : undefined;
    const sections = [injection, runtimeToolCatalog].filter((section): section is string => Boolean(section));
    if (sections.length === 0) return undefined;
    const message = sections.join("\n\n");
    await logStateEvent(ctx.cwd, state, "SCALER context hook injected approved manifest context", {
      taskId: state.currentTaskId,
      characters: message.length,
      parentToolFocusApplied: activeToolFocusSnapshots.has(ctx.cwd),
      parentToolCatalog: Boolean(runtimeToolCatalog),
    });
    return {
      messages: [
        ...event.messages,
        {
          role: "user",
          content: [{ type: "text", text: message }],
        },
      ] as never,
    };
  });

  pi.on("agent_start", async (event, ctx) => {
    const state = await ensureState(ctx.cwd);
    await recordWatchdogHeartbeat(ctx.cwd, {
      scopeKind: "agent",
      scopeId: state.currentTaskId ?? state.runId,
      status: "running",
      action: "agent_start",
      taskId: state.currentTaskId ?? undefined,
      details: event,
    });
    return undefined;
  });

  pi.on("agent_end", async (event, ctx) => {
    const state = await ensureState(ctx.cwd);
    const restoredTools = restoreParentToolFocus(ctx.cwd, pi, activeToolFocusSnapshots);
    if (restoredTools) await logStateEvent(ctx.cwd, state, "SCALER parent tool focus restored", { activeTools: restoredTools, reason: "agent_end" });
    await recordWatchdogHeartbeat(ctx.cwd, {
      scopeKind: "agent",
      scopeId: state.currentTaskId ?? state.runId,
      status: "completed",
      action: "agent_end",
      taskId: state.currentTaskId ?? undefined,
      details: event,
    });
    return undefined;
  });

  pi.on("tool_execution_start", async (event, ctx) => {
    const state = await ensureState(ctx.cwd);
    await recordWatchdogHeartbeat(ctx.cwd, {
      scopeKind: "tool",
      scopeId: (event as { toolName?: string }).toolName ?? "tool",
      status: "running",
      action: "tool_execution_start",
      taskId: state.currentTaskId ?? undefined,
      details: event,
    });
    return undefined;
  });

  pi.on("tool_execution_end", async (event, ctx) => {
    const state = await ensureState(ctx.cwd);
    await recordWatchdogHeartbeat(ctx.cwd, {
      scopeKind: "tool",
      scopeId: (event as { toolName?: string }).toolName ?? "tool",
      status: "completed",
      action: "tool_execution_end",
      taskId: state.currentTaskId ?? undefined,
      details: event,
    });
    return undefined;
  });

  pi.on("tool_result", async (event, ctx) => {
    const state = await ensureState(ctx.cwd);
    const externalized = await externalizeLargeToolResult(ctx.cwd, {
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      input: event.input,
      content: event.content as unknown[],
      details: event.details,
      isError: event.isError,
    });
    await logToolAudit(ctx.cwd, state, {
      toolName: event.toolName,
      summary: externalized.externalized ? `Tool result externalized: ${event.toolName}` : `Tool result observed: ${event.toolName}`,
      input: event.input,
      result: externalized.reference ? { reference: externalized.reference, isError: event.isError } : { content: event.content, details: event.details, isError: event.isError },
      accepted: !event.isError,
    });
    if (!externalized.externalized) return undefined;
    return { content: externalized.content, details: externalized.details, isError: externalized.isError };
  });

  pi.on("session_start", async (_event, ctx) => {
    const scheduled = await runScheduledStorageMaintenance(ctx.cwd);
    if (!scheduled.report) return undefined;
    const state = await ensureState(ctx.cwd);
    const inventory = await scanScalerStorageInventory(ctx.cwd);
    const budgetResult = setBudgetUsage(state, "storageBytes", inventory.totalBytes);
    const persisted = await persistBudgetDecision(ctx.cwd, budgetResult.state, budgetResult.decision);
    await logStateEvent(ctx.cwd, persisted, "Scaler scheduled storage maintenance checked", {
      schedule: scheduled.config,
      status: scheduled.status,
      report: scheduled.report,
      inventory,
      budgetDecision: budgetResult.decision,
    });
    return undefined;
  });

  pi.on("tool_call", async (event, ctx) => {
    const state = await ensureState(ctx.cwd);
    await logToolAudit(ctx.cwd, state, {
      toolName: event.toolName,
      summary: `Tool call observed: ${event.toolName}`,
      input: event.input,
    });
    const currentTaskCandidate = state.currentTaskId ? state.tasks.find((task) => task.id === state.currentTaskId) : undefined;
    const currentTask = currentTaskCandidate && isActiveTaskForSafety(currentTaskCandidate.status) ? currentTaskCandidate : undefined;
    const managedRunActive = isManagedRunActiveForSafety(state.stage);
    const persistedSafetyPolicy = await loadSafetyPolicy(ctx.cwd);
    const decision = assessToolCallSafety(
      {
        toolName: event.toolName,
        input: event.input as Record<string, unknown>,
      },
      mergeSafetyPolicy(persistedSafetyPolicy, {
        allowedPathPrefixes: currentTask?.allowedPathPrefixes,
        requireAllowedPathPrefixesForWrite: managedRunActive,
        allowBashProjectMutations: managedRunActive ? Boolean(currentTask) : undefined,
      }),
    );

    if (decision.allowed) return undefined;
    const approval = await applySafetyApproval(
      ctx.cwd,
      { toolName: event.toolName, input: event.input as Record<string, unknown> },
      decision,
    );
    if (approval.allowed) {
      await appendLogEvent(
        ctx.cwd,
        createLogEvent(state, {
          eventType: "safety",
          summary: `Allowed ${event.toolName} by approval: ${approval.approval?.id ?? "unknown"}`,
          details: {
            toolName: event.toolName,
            risk: decision.risk,
            requiresApproval: decision.requiresApproval,
            approvalId: approval.approval?.id,
            approvalReason: approval.approval?.reason,
          },
        }),
      );
      return undefined;
    }
    await appendLogEvent(
      ctx.cwd,
      createLogEvent(state, {
        eventType: "safety",
        summary: `Blocked ${event.toolName}: ${decision.reason}`,
        details: {
          toolName: event.toolName,
          risk: decision.risk,
          requiresApproval: decision.requiresApproval,
          approvalReason: approval.reason,
        },
      }),
    );

    if (ctx.hasUI) {
      ctx.ui.notify(`SCALER blocked ${event.toolName}: ${decision.reason}`, "warning");
    }

    return { block: true, reason: decision.reason };
  });

  pi.registerCommand("scaler", {
    description: "Run SCALER automation for a request until completion or a deterministic blocker.",
    handler: async (args, ctx) => {
      const state = await ensureState(ctx.cwd);
      const nextState = startScalerRun(state, args ?? "");
      await saveState(ctx.cwd, nextState);
      const gitBootstrap = await ensureGitRepository(ctx.cwd);
      await logStateEvent(ctx.cwd, nextState, "Scaler run requested", { command: "scaler", request: args ?? "", gitBootstrap });

      if (!args?.trim()) {
        const message = `${formatStateStatus(nextState)} reason=${nextState.orchestrationReason ?? "n/a"} git=${gitBootstrap.status}`;
        if (ctx.hasUI) ctx.ui.notify(message, "info");
        else console.log(message);
        return;
      }

      const automation = await runScalerAutomation(ctx.cwd, nextState);
      const message = `${formatStateStatus(automation.finalState)} reason=${automation.finalState.orchestrationReason ?? "n/a"} git=${gitBootstrap.status}\n${automation.message}`;
      if (ctx.hasUI) {
        ctx.ui.notify(message, automation.accepted ? "info" : "warning");
      } else {
        console.log(message);
      }
    },
  });

  pi.registerCommand("scaler-adapt", {
    description: "Assess or apply adaptive SCALER escalation/de-escalation: /scaler-adapt [apply]",
    handler: async (args, ctx) => {
      const state = await ensureState(ctx.cwd);
      const assessment = assessAdaptiveOrchestration(state);
      const apply = args?.trim().split(/\s+/).includes("apply") ?? false;
      const result = apply ? applyAdaptiveOrchestration(state, assessment) : undefined;
      if (result) await saveState(ctx.cwd, result.state);
      await logStateEvent(ctx.cwd, result?.state ?? state, apply ? "Scaler adaptive orchestration applied" : "Scaler adaptive orchestration assessed", {
        assessment,
        applied: Boolean(result),
        stageTransitionApplied: result?.stageTransitionApplied ?? false,
        complexityChanged: result?.complexityChanged ?? false,
      });
      const message = `${formatAdaptiveAssessment(assessment)}${result ? `\nApplied: stageTransition=${result.stageTransitionApplied} complexityChanged=${result.complexityChanged}` : ""}`;
      if (ctx.hasUI) ctx.ui.notify(message, assessment.action === "stay" ? "info" : "warning");
      else console.log(message);
    },
  });

  pi.registerCommand("scaler-lock", {
    description: "Show current SCALER execution lock.",
    handler: async (_args, ctx) => {
      const message = formatExecutionLock(await loadExecutionLock(ctx.cwd));
      if (ctx.hasUI) ctx.ui.notify(message, "info");
      else console.log(message);
    },
  });

  pi.registerCommand("scaler-lock-clear", {
    description: "Manually clear the SCALER execution lock: /scaler-lock-clear <reason>",
    handler: async (args, ctx) => {
      const reason = args?.trim() || "manual clear requested";
      const result = await clearExecutionLock(ctx.cwd, reason);
      if (ctx.hasUI) ctx.ui.notify(result.message, result.released ? "info" : "warning");
      else console.log(result.message);
    },
  });

  pi.registerCommand("scaler-runs", {
    description: "List recent SCALER task-agent run records. Optional arg filters by task id.",
    handler: async (args, ctx) => {
      const taskId = args?.trim() || undefined;
      const records = await loadTaskAgentRunRecords(ctx.cwd);
      const message = formatTaskAgentRunList(records, taskId);
      if (ctx.hasUI) ctx.ui.notify(message, "info");
      else console.log(message);
    },
  });

  pi.registerCommand("scaler-task-reports", {
    description: "List structured task-agent reports. Optional arg filters by task id.",
    handler: async (args, ctx) => {
      const taskId = args?.trim() || undefined;
      const message = formatTaskAgentReportList(await loadTaskAgentReports(ctx.cwd), taskId);
      if (ctx.hasUI) ctx.ui.notify(message, "info");
      else console.log(message);
    },
  });

  pi.registerCommand("scaler-task-quality", {
    description: "Review task Definition of Done, validation, and allowed-path warnings: /scaler-task-quality [taskId]",
    handler: async (args, ctx) => {
      const taskId = args?.trim() || undefined;
      const state = await ensureState(ctx.cwd);
      const records = taskId
        ? [await reviewTaskDefinition(ctx.cwd, state, taskId)]
        : await reviewAllTaskDefinitions(ctx.cwd, state);
      const message = records.length > 0
        ? formatTaskDefinitionReviews(records, taskId)
        : formatTaskDefinitionReviews(await loadTaskDefinitionReviews(ctx.cwd), taskId);
      if (ctx.hasUI) ctx.ui.notify(message, records.some((record) => record.warnings.length > 0) ? "warning" : "info");
      else console.log(message);
    },
  });

  pi.registerCommand("scaler-tasks", {
    description: "List SCALER tasks with status and allowed paths.",
    handler: async (_args, ctx) => {
      const state = await ensureState(ctx.cwd);
      const message = formatTaskList(state);
      if (ctx.hasUI) ctx.ui.notify(message, "info");
      else console.log(message);
    },
  });

  pi.registerCommand("scaler-context-init", {
    description: "Create a default task context manifest: /scaler-context-init [taskId]",
    handler: async (args, ctx) => {
      const parsed = parseContextTaskArgs(args);
      const state = await ensureState(ctx.cwd);
      const taskId = parsed.taskId ?? state.currentTaskId ?? state.tasks.find((task) => task.status !== "validated" && task.status !== "failed")?.id;
      if (!taskId) {
        const message = "No task found for /scaler-context-init.";
        if (ctx.hasUI) ctx.ui.notify(message, "warning");
        else console.log(message);
        return;
      }
      const manifest = await ensureTaskContextManifest(ctx.cwd, state, taskId);
      const message = `Context manifest ready: ${taskId} items=${manifest.items.length}`;
      if (ctx.hasUI) ctx.ui.notify(message, "info");
      else console.log(message);
    },
  });

  pi.registerCommand("scaler-context-status", {
    description: "Show task context manifest summary: /scaler-context-status [taskId]",
    handler: async (args, ctx) => {
      const parsed = parseContextTaskArgs(args);
      const state = await ensureState(ctx.cwd);
      const taskId = parsed.taskId ?? state.currentTaskId ?? state.tasks[0]?.id;
      const manifest = taskId ? await loadTaskContextManifest(ctx.cwd, taskId) : undefined;
      const message = manifest ? formatTaskContextManifest(manifest) : `No context manifest${taskId ? ` for ${taskId}` : ""}.`;
      if (ctx.hasUI) ctx.ui.notify(message, manifest ? "info" : "warning");
      else console.log(message);
    },
  });

  pi.registerCommand("scaler-context-candidates", {
    description: "List scored context candidates without injecting them: /scaler-context-candidates [taskId] [query] [limit=N]",
    handler: async (args, ctx) => {
      const parsed = parseContextCandidatesArgs(args);
      const state = await ensureState(ctx.cwd);
      const taskId = parsed.taskId ?? state.currentTaskId ?? state.tasks.find((task) => task.status !== "validated" && task.status !== "failed")?.id;
      if (!taskId) {
        const message = "No task found for /scaler-context-candidates.";
        if (ctx.hasUI) ctx.ui.notify(message, "warning");
        else console.log(message);
        return;
      }
      const candidates = await discoverSemanticContextCandidates(ctx.cwd, state, taskId, { query: parsed.query, limit: parsed.limit });
      const message = formatContextCandidates(candidates);
      if (ctx.hasUI) ctx.ui.notify(message, candidates.length > 0 ? "info" : "warning");
      else console.log(message);
    },
  });

  pi.registerCommand("scaler-context-approve", {
    description: "Approve a context candidate into the task manifest: /scaler-context-approve <taskId> <candidateId> [query]",
    handler: async (args, ctx) => {
      const parsed = parseContextApproveArgs(args);
      const state = await ensureState(ctx.cwd);
      const taskId = parsed.taskId ?? state.currentTaskId;
      if (!taskId || !parsed.candidateId) {
        const message = "Usage: /scaler-context-approve <taskId> <candidateId> [query]";
        if (ctx.hasUI) ctx.ui.notify(message, "warning");
        else console.log(message);
        return;
      }
      const result = await approveContextCandidate(ctx.cwd, state, taskId, parsed.candidateId, { query: parsed.query });
      const message = result.added
        ? `Context candidate approved: ${result.candidate.id} -> ${result.manifest.taskId} items=${result.manifest.items.length}`
        : `Context candidate already approved: ${result.candidate.id}`;
      if (ctx.hasUI) ctx.ui.notify(message, result.added ? "info" : "warning");
      else console.log(message);
    },
  });

  pi.registerCommand("scaler-context-splits", {
    description: "List automatic context split artifacts: /scaler-context-splits [taskId]",
    handler: async (args, ctx) => {
      const taskId = args?.trim() || undefined;
      const message = formatContextSplitRecords(await loadContextSplitRecords(ctx.cwd), taskId);
      if (ctx.hasUI) ctx.ui.notify(message, "info");
      else console.log(message);
    },
  });

  pi.registerCommand("scaler-compact", {
    description: "Trigger SCALER-aware Pi compaction with deterministic state-preservation instructions.",
    handler: async (_args, ctx) => {
      const state = await ensureState(ctx.cwd);
      const decision = shouldTriggerScalerCompaction(ctx.getContextUsage?.());
      ctx.compact({ customInstructions: buildScalerCompactionInstructions(state, decision) });
      const message = `SCALER compaction requested. ${decision.reason}`;
      await logStateEvent(ctx.cwd, state, message, decision);
      if (ctx.hasUI) ctx.ui.notify(message, "info");
      else console.log(message);
    },
  });

  pi.registerCommand("scaler-compactions", {
    description: "List SCALER-aware compaction records.",
    handler: async (_args, ctx) => {
      const message = formatScalerCompactionRecords(await loadScalerCompactionRecords(ctx.cwd));
      if (ctx.hasUI) ctx.ui.notify(message, "info");
      else console.log(message);
    },
  });

  pi.registerCommand("scaler-context-handoff", {
    description: "Prepare or execute a fresh minimal-context continuation from a split: /scaler-context-handoff [splitId|taskId] [execute]",
    handler: async (args, ctx) => {
      const parts = (args ?? "").trim().split(/\s+/).filter(Boolean);
      const execute = parts.some((part) => part.toLowerCase() === "execute");
      const id = parts.find((part) => part.toLowerCase() !== "execute");
      const state = await ensureState(ctx.cwd);
      const result = await prepareFreshContextHandoff(ctx.cwd, state, { splitId: id, taskId: id, execute });
      if (ctx.hasUI) ctx.ui.notify(`${result.message}\n${result.record.diagnostics.join("\n")}`, result.accepted ? "info" : "warning");
      else console.log(`${result.message}\n${result.record.diagnostics.join("\n")}`);
    },
  });

  pi.registerCommand("scaler-context-handoffs", {
    description: "List fresh minimal-context continuation handoffs: /scaler-context-handoffs [taskId|splitId|handoffId]",
    handler: async (args, ctx) => {
      const taskId = args?.trim() || undefined;
      const message = formatFreshContextHandoffs(await loadFreshContextHandoffRecords(ctx.cwd), taskId);
      if (ctx.hasUI) ctx.ui.notify(message, "info");
      else console.log(message);
    },
  });

  pi.registerCommand("scaler-memory-search", {
    description: "Search external memory candidates by query/tag/task/validity without loading full files.",
    handler: async (args, ctx) => {
      const parsed = parseMemorySearchArgs(args);
      const validity = normalizeMemoryValidityFilter(parsed.validity);
      const results = await searchMemory(ctx.cwd, {
        query: parsed.query,
        tags: parsed.tags,
        taskId: parsed.taskId,
        validity,
        includeObsolete: parsed.includeObsolete,
        limit: parsed.limit,
      });
      const message = formatMemorySearchResults(results, { query: parsed.query, tags: parsed.tags, taskId: parsed.taskId, validity });
      if (ctx.hasUI) ctx.ui.notify(message, "info");
      else console.log(message);
    },
  });

  pi.registerCommand("scaler-missing-context", {
    description: "List structured missing-context requests: /scaler-missing-context [taskId]",
    handler: async (args, ctx) => {
      const taskId = args?.trim() || undefined;
      const message = formatMissingContextRequests(await loadMissingContextRequests(ctx.cwd), taskId);
      if (ctx.hasUI) ctx.ui.notify(message, "info");
      else console.log(message);
    },
  });

  pi.registerCommand("scaler-missing-context-run", {
    description: "Plan or execute a missing-context retrieval/investigation: /scaler-missing-context-run [requestId] [execute] [internet]",
    handler: async (args, ctx) => {
      const parsed = parseMissingContextRunArgs(args);
      const state = await ensureState(ctx.cwd);
      const result = await dispatchMissingContextRequest(ctx.cwd, state, parsed.requestId, { execute: parsed.execute, allowInternet: parsed.allowInternet });
      const unblocked = result.accepted ? await unblockTasksWithResolvedMissingContext(ctx.cwd, await ensureState(ctx.cwd)) : undefined;
      const suffix = unblocked && unblocked.unblockedTaskIds.length > 0 ? `\nUnblocked tasks: ${unblocked.unblockedTaskIds.join(", ")}` : "";
      const message = `${result.message}${suffix}`;
      if (ctx.hasUI) ctx.ui.notify(message, result.accepted ? "info" : "warning");
      else console.log(message);
    },
  });

  pi.registerCommand("scaler-missing-context-resolve", {
    description: "Manually resolve a missing-context request: /scaler-missing-context-resolve <requestId> | <summary> | <evidence refs>",
    handler: async (args, ctx) => {
      const parsed = parseMissingContextResolveArgs(args);
      if (!parsed) {
        const message = "Usage: /scaler-missing-context-resolve <requestId> | <summary> | <evidence refs comma list>";
        if (ctx.hasUI) ctx.ui.notify(message, "warning");
        else console.log(message);
        return;
      }
      const state = await ensureState(ctx.cwd);
      const result = await resolveMissingContextRequest(ctx.cwd, state, parsed);
      const unblocked = result.accepted ? await unblockTasksWithResolvedMissingContext(ctx.cwd, await ensureState(ctx.cwd)) : undefined;
      const suffix = unblocked && unblocked.unblockedTaskIds.length > 0 ? `\nUnblocked tasks: ${unblocked.unblockedTaskIds.join(", ")}` : "";
      const message = `${result.message}${suffix}`;
      if (ctx.hasUI) ctx.ui.notify(message, result.accepted ? "info" : "warning");
      else console.log(message);
    },
  });

  pi.registerCommand("scaler-stage-status", {
    description: "Show SCALER Stage I-IV artifact status.",
    handler: async (_args, ctx) => {
      const message = formatStageArtifactSummary(summarizeStageArtifacts(await loadStageArtifacts(ctx.cwd)));
      if (ctx.hasUI) ctx.ui.notify(message, "info");
      else console.log(message);
    },
  });

  pi.registerCommand("scaler-stage-validate", {
    description: "Validate latest stage artifact readiness: /scaler-stage-validate <stage>",
    handler: async (args, ctx) => {
      const stage = args?.trim();
      if (!stage) {
        const message = "Usage: /scaler-stage-validate <stage>";
        if (ctx.hasUI) ctx.ui.notify(message, "warning");
        else console.log(message);
        return;
      }

      try {
        const validation = await validateStageArtifactReadiness(ctx.cwd, await loadStageArtifacts(ctx.cwd), stage);
        const message = formatStageArtifactReadiness(validation);
        if (ctx.hasUI) ctx.ui.notify(message, validation.ok ? "info" : "warning");
        else console.log(message);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (ctx.hasUI) ctx.ui.notify(message, "warning");
        else console.log(message);
      }
    },
  });

  pi.registerCommand("scaler-stage-advance", {
    description: "Advance supervisor stage after a ready artifact: /scaler-stage-advance <stage>",
    handler: async (args, ctx) => {
      const stage = args?.trim();
      if (!stage) {
        const message = "Usage: /scaler-stage-advance <stage>";
        if (ctx.hasUI) ctx.ui.notify(message, "warning");
        else console.log(message);
        return;
      }

      try {
        const state = await ensureState(ctx.cwd);
        const result = await advanceStageAfterReadyArtifact(ctx.cwd, state, stage);
        if (ctx.hasUI) ctx.ui.notify(result.message, result.accepted ? "info" : "warning");
        else console.log(result.message);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (ctx.hasUI) ctx.ui.notify(message, "warning");
        else console.log(message);
      }
    },
  });

  pi.registerCommand("scaler-stage-step", {
    description: "Run one deterministic SCALER stage-conductor step. Pass 'execute' to run the stage agent.",
    handler: async (args, ctx) => {
      try {
        const state = await ensureState(ctx.cwd);
        const execute = /\bexecute\b/i.test(args ?? "");
        const result = await runStageConductorStep(ctx.cwd, state, { execute });
        if (ctx.hasUI) ctx.ui.notify(result.message, result.accepted ? "info" : "warning");
        else console.log(result.message);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (ctx.hasUI) ctx.ui.notify(message, "warning");
        else console.log(message);
      }
    },
  });

  pi.registerCommand("scaler-stage-loop", {
    description: "Run bounded SCALER stage-conductor steps: /scaler-stage-loop [execute] [max=N]",
    handler: async (args, ctx) => {
      try {
        const state = await ensureState(ctx.cwd);
        const parsed = parseStageLoopArgs(args);
        const result = await runStageConductorLoop(ctx.cwd, state, { execute: parsed.execute, maxSteps: parsed.maxSteps });
        if (ctx.hasUI) ctx.ui.notify(result.message, result.accepted ? "info" : "warning");
        else console.log(result.message);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (ctx.hasUI) ctx.ui.notify(message, "warning");
        else console.log(message);
      }
    },
  });

  pi.registerCommand("scaler-stage-workflow", {
    description: "Run the autonomous SCALER Stage I-III/replanning coordinator: /scaler-stage-workflow [execute] [max=N] [research=N] [requests=N] [internet] [tools=a,b] [auto-accept-replan=on/off]",
    handler: async (args, ctx) => {
      try {
        const state = await ensureState(ctx.cwd);
        const parsed = parseStageWorkflowArgs(args);
        const result = await runAutonomousStageWorkflow(ctx.cwd, state, {
          execute: parsed.execute,
          maxSteps: parsed.maxSteps,
          maxResearchAgents: parsed.maxResearchAgents,
          maxResearchRequests: parsed.maxResearchRequests,
          allowInternet: parsed.allowInternet,
          tools: parsed.tools,
          autoAcceptReplan: parsed.autoAcceptReplan,
        });
        if (ctx.hasUI) ctx.ui.notify(result.message, result.accepted ? "info" : "warning");
        else console.log(result.message);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (ctx.hasUI) ctx.ui.notify(message, "warning");
        else console.log(message);
      }
    },
  });

  pi.registerCommand("scaler-stage-workflow-runs", {
    description: "List recent autonomous SCALER stage workflow runs.",
    handler: async (_args, ctx) => {
      const message = formatStageWorkflowRunRecords(await loadStageWorkflowRunRecords(ctx.cwd));
      if (ctx.hasUI) ctx.ui.notify(message, "info");
      else console.log(message);
    },
  });

  pi.registerCommand("scaler-stage-run", {
    description: "Prepare or execute a focused stage agent: /scaler-stage-run <stage> [execute]",
    handler: async (args, ctx) => {
      const parsed = parseStageRunArgs(args);
      if (!parsed.stage) {
        const message = "Usage: /scaler-stage-run <stage> [execute]";
        if (ctx.hasUI) ctx.ui.notify(message, "warning");
        else console.log(message);
        return;
      }

      try {
        const state = await ensureState(ctx.cwd);
        const result = await runStageAgentStep(ctx.cwd, state, parsed.stage, { execute: parsed.execute });
        let message = result.accepted ? `${result.message} run=${result.runRecord?.id ?? "n/a"}` : result.message;
        if (parsed.execute && result.ingestion?.attempted) {
          message = result.ingestion.ingested
            ? `${message}\nIngested stage artifact ${result.ingestion.artifact?.id ?? "unknown"}.`
            : `${message}\nNo stage artifact ingested: ${result.ingestion.reason ?? "unknown reason"}`;
        }
        if (parsed.execute && result.runRecord?.status === "passed" && result.stage) {
          const advancement = await advanceStageAfterReadyArtifact(ctx.cwd, state, result.stage);
          message = `${message}\n${advancement.message}`;
        }
        if (ctx.hasUI) ctx.ui.notify(message, result.accepted ? "info" : "warning");
        else console.log(message);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (ctx.hasUI) ctx.ui.notify(message, "warning");
        else console.log(message);
      }
    },
  });

  pi.registerCommand("scaler-stage-runs", {
    description: "List recent stage-agent runs. Optional arg filters by stage.",
    handler: async (args, ctx) => {
      const stage = args?.trim() || undefined;
      try {
        const message = formatStageAgentRunList(await loadStageAgentRunRecords(ctx.cwd), stage);
        if (ctx.hasUI) ctx.ui.notify(message, "info");
        else console.log(message);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (ctx.hasUI) ctx.ui.notify(message, "warning");
        else console.log(message);
      }
    },
  });

  pi.registerCommand("scaler-stage-record", {
    description: "Record a stage artifact: /scaler-stage-record <stage> | <status> | <title> | <path> | <summary> | <evidence refs> | <PRD refs> | <task refs>",
    handler: async (args, ctx) => {
      const parsed = parseStageRecordArgs(args);
      if (!parsed) {
        const message = "Usage: /scaler-stage-record <stage> | <status> | <title> | <path> | <summary> | <evidence refs> | <PRD refs> | <task refs>";
        if (ctx.hasUI) ctx.ui.notify(message, "warning");
        else console.log(message);
        return;
      }

      try {
        const artifact = await upsertStageArtifact(ctx.cwd, {
          stage: parsed.stage,
          status: parsed.status,
          title: parsed.title,
          path: parsed.path,
          summary: parsed.summary,
          evidenceRefs: parsed.evidenceRefs,
          requirementRefs: parsed.requirementRefs,
          taskRefs: parsed.taskRefs,
        });
        const message = `Recorded stage artifact ${artifact.id} stage=${artifact.stage} status=${artifact.status}`;
        if (ctx.hasUI) ctx.ui.notify(message, "info");
        else console.log(message);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (ctx.hasUI) ctx.ui.notify(message, "warning");
        else console.log(message);
      }
    },
  });

  pi.registerCommand("scaler-task-create", {
    description: "Create a SCALER task with enforced DoD/paths/validation/atomicity/test-first quality: /scaler-task-create <taskId> | <title> | <allowed paths> | <dependencies> | <PRD refs> | <DoD items> | <kind> | <atomicity rationale> | <validation refs> | <waivers code:reason>",
    handler: async (args, ctx) => {
      const parsed = parseTaskCreateArgs(args);
      if (!parsed) {
        const message = "Usage: /scaler-task-create <taskId> | <title> | <allowed paths comma list> | <dependency ids comma list> | <PRD refs comma list> | <DoD items semicolon list> | <kind software|non_software|mixed> | <atomicity rationale> | <validation refs comma list> | <waivers code:reason;...>";
        if (ctx.hasUI) ctx.ui.notify(message, "warning");
        else console.log(message);
        return;
      }
      const state = await ensureState(ctx.cwd);
      const result = await createTask(ctx.cwd, state, {
        id: parsed.taskId,
        title: parsed.title,
        allowedPathPrefixes: parsed.allowedPathPrefixes,
        dependsOn: parsed.dependsOn,
        prdRefs: parsed.prdRefs,
        definitionOfDone: parsed.definitionOfDone,
        taskKind: parsed.taskKind,
        atomicityRationale: parsed.atomicityRationale,
        validationRefs: parsed.validationRefs,
        qualityWaivers: parseTaskQualityWaivers(parsed.qualityWaivers),
        qualityMode: "enforce",
      });
      if (ctx.hasUI) ctx.ui.notify(result.message, result.accepted ? "info" : "warning");
      else console.log(result.message);
    },
  });

  pi.registerCommand("scaler-task-update", {
    description: "Update a SCALER task with enforced quality: /scaler-task-update <taskId> | <title> | <status> | <allowed paths> | <dependencies> | <PRD refs> | <DoD items> | <kind> | <atomicity rationale> | <validation refs> | <waivers code:reason>",
    handler: async (args, ctx) => {
      const parsed = parseTaskUpdateArgs(args);
      if (!parsed) {
        const message = "Usage: /scaler-task-update <taskId> | <title> | <status> | <allowed paths> | <dependencies> | <PRD refs> | <DoD items semicolon list> | <kind software|non_software|mixed> | <atomicity rationale> | <validation refs comma list> | <waivers code:reason;...>";
        if (ctx.hasUI) ctx.ui.notify(message, "warning");
        else console.log(message);
        return;
      }
      if (isChildAgent) {
        const message = "Task contract update refused: only the parent user-command route can authorize exercised-policy changes.";
        if (ctx.hasUI) ctx.ui.notify(message, "warning");
        else console.log(message);
        return;
      }

      const state = await ensureState(ctx.cwd);
      const result = await updateTask(ctx.cwd, state, {
        id: parsed.taskId,
        title: parsed.title,
        status: parsed.status,
        allowedPathPrefixes: parsed.allowedPathPrefixes,
        dependsOn: parsed.dependsOn,
        prdRefs: parsed.prdRefs,
        definitionOfDone: parsed.definitionOfDone,
        taskKind: parsed.taskKind,
        atomicityRationale: parsed.atomicityRationale,
        validationRefs: parsed.validationRefs,
        qualityWaivers: parseTaskQualityWaivers(parsed.qualityWaivers),
        qualityMode: "enforce",
        acceptanceAuthority: "user_command",
      });
      if (ctx.hasUI) ctx.ui.notify(result.message, result.accepted ? "info" : "warning");
      else console.log(result.message);
    },
  });

  pi.registerCommand("scaler-prd-status", {
    description: "Show runtime PRD requirement coverage for the active run.",
    handler: async (_args, ctx) => {
      const state = await ensureState(ctx.cwd);
      const requirements = await loadPrdRequirements(ctx.cwd);
      const coverage = await loadPrdCoverage(ctx.cwd);
      const summary = computePrdCoverageSummary(requirements, coverage, state);
      const message = formatPrdCoverageSummary(requirements, summary);
      if (ctx.hasUI) ctx.ui.notify(message, "info");
      else console.log(message);
    },
  });

  pi.registerCommand("scaler-plan-status", {
    description: "Show current SCALER execution plan summary.",
    handler: async (_args, ctx) => {
      const state = await ensureState(ctx.cwd);
      const plan = await loadExecutionPlan(ctx.cwd);
      const requirements = await loadPrdRequirements(ctx.cwd);
      const message = formatExecutionPlanSummary(summarizeExecutionPlan(plan, requirements, state));
      if (ctx.hasUI) ctx.ui.notify(message, "info");
      else console.log(message);
    },
  });

  pi.registerCommand("scaler-plan-apply", {
    description: "Create missing SCALER task records from the current execution plan.",
    handler: async (_args, ctx) => {
      const state = await ensureState(ctx.cwd);
      const plan = await loadExecutionPlan(ctx.cwd);
      const result = await applyExecutionPlanTasks(ctx.cwd, state, plan);
      if (ctx.hasUI) ctx.ui.notify(result.message, result.rejectedTaskIds.length === 0 ? "info" : "warning");
      else console.log(result.message);
    },
  });

  pi.registerCommand("scaler-planning-reports", {
    description: "List structured planner coverage synchronization reports.",
    handler: async (_args, ctx) => {
      const message = formatPlanningReports(await loadPlanningReports(ctx.cwd));
      if (ctx.hasUI) ctx.ui.notify(message, "info");
      else console.log(message);
    },
  });

  pi.registerCommand("scaler-replans", {
    description: "List SCALER replan requests.",
    handler: async (_args, ctx) => {
      const message = formatReplanRequests(await loadReplanRequests(ctx.cwd));
      if (ctx.hasUI) ctx.ui.notify(message, "info");
      else console.log(message);
    },
  });

  pi.registerCommand("scaler-replan-run", {
    description: "Prepare or execute the focused SCALER replanner agent: /scaler-replan-run [execute]",
    handler: async (args, ctx) => {
      const parsed = parseReplanRunArgs(args);
      const state = await ensureState(ctx.cwd);
      const result = await runReplanAgentStep(ctx.cwd, state, { execute: parsed.execute });
      const ingestion = result.ingestion?.attempted
        ? ` ingestion=${result.ingestion.ingested ? "ingested" : "rejected"}${result.ingestion.plan ? ` proposed_plan=${result.ingestion.plan.planVersion}` : ""}`
        : "";
      const message = result.accepted ? `${result.message}${ingestion}` : result.message;
      if (ctx.hasUI) ctx.ui.notify(message, result.accepted && result.ingestion?.ingested !== false ? "info" : "warning");
      else console.log(message);
    },
  });

  pi.registerCommand("scaler-replan-runs", {
    description: "List recent SCALER replanner-agent run records.",
    handler: async (_args, ctx) => {
      const message = formatReplanAgentRunList(await loadReplanAgentRunRecords(ctx.cwd));
      if (ctx.hasUI) ctx.ui.notify(message, "info");
      else console.log(message);
    },
  });

  pi.registerCommand("scaler-debug-run", {
    description: "Prepare or execute the focused SCALER debug agent: /scaler-debug-run [taskId] [execute]",
    handler: async (args, ctx) => {
      const parsed = parseDebugRunArgs(args);
      const state = await ensureState(ctx.cwd);
      const result = await runDebugAgentStep(ctx.cwd, state, { taskId: parsed.taskId, execute: parsed.execute });
      const ingestion = result.ingestion?.attempted
        ? ` ingestion=${result.ingestion.ingested ? "ingested" : "rejected"}${result.ingestion.report ? ` report=${result.ingestion.report.id}` : ""}${result.ingestion.researchRequestIds?.length ? ` research=${result.ingestion.researchRequestIds.join(",")}` : ""}${result.ingestion.replanRequestId ? ` replan=${result.ingestion.replanRequestId}` : ""}`
        : "";
      const message = result.accepted ? `${result.message}${ingestion}` : result.message;
      if (ctx.hasUI) ctx.ui.notify(message, result.accepted && result.ingestion?.ingested !== false ? "info" : "warning");
      else console.log(message);
    },
  });

  pi.registerCommand("scaler-debug-retry", {
    description: "Prepare or execute the latest accepted debug next_approach retry: /scaler-debug-retry [taskId] [execute]",
    handler: async (args, ctx) => {
      const parsed = parseDebugRetryArgs(args);
      const state = await ensureState(ctx.cwd);
      const result = await runDebugRetryPolicyWorkflow(ctx.cwd, state, { taskId: parsed.taskId, execute: parsed.execute });
      const suffix = result.retry ? ` retry=${result.retry.id} status=${result.retry.status}${result.exactValidationRun ? ` exact_validation=${result.exactValidationRun.status}` : ""}${result.postValidation ? ` post_validation=${result.postValidation.result?.status ?? "not_run"}` : ""}${result.postCommit ? ` post_commit=${result.postCommit.accepted ? "accepted" : "rejected"}` : ""}` : "";
      const message = `${result.message}${suffix}`;
      if (ctx.hasUI) ctx.ui.notify(message, result.accepted ? "info" : "warning");
      else console.log(message);
    },
  });

  pi.registerCommand("scaler-debug-retry-policy", {
    description: "Show or update debug retry automation policy: /scaler-debug-retry-policy [auto-start=on/off] [require-approval=on/off] [post-exact-pass=stop|validate|validate-commit]",
    handler: async (args, ctx) => {
      const parsed = parseDebugRetryPolicyArgs(args);
      const hasUpdate = parsed.autoStart !== undefined || parsed.requireApproval !== undefined || parsed.postExactPass !== undefined;
      const policy = hasUpdate
        ? await saveDebugRetryPolicy(ctx.cwd, { autoStart: parsed.autoStart, requireApproval: parsed.requireApproval, postExactPass: parsed.postExactPass })
        : await loadDebugRetryPolicy(ctx.cwd);
      const state = await ensureState(ctx.cwd);
      await logStateEvent(ctx.cwd, state, "Scaler debug retry policy requested", {
        command: "scaler-debug-retry-policy",
        updated: hasUpdate,
        policy,
      });
      const message = formatDebugRetryPolicy(policy);
      if (ctx.hasUI) ctx.ui.notify(message, "info");
      else console.log(message);
    },
  });

  pi.registerCommand("scaler-debug-retry-approve", {
    description: "Approve one debug retry report: /scaler-debug-retry-approve <debugReportId> | [taskId] | [reason]",
    handler: async (args, ctx) => {
      const parsed = parseDebugRetryApprovalArgs(args);
      if (!parsed) {
        const message = "Usage: /scaler-debug-retry-approve <debugReportId> | [taskId] | [reason]";
        if (ctx.hasUI) ctx.ui.notify(message, "warning");
        else console.log(message);
        return;
      }
      const approval = await approveDebugRetry(ctx.cwd, { debugReportId: parsed.debugReportId!, taskId: parsed.taskId, reason: parsed.reason });
      const state = await ensureState(ctx.cwd);
      await logStateEvent(ctx.cwd, state, "Scaler debug retry approved", {
        command: "scaler-debug-retry-approve",
        approval,
      });
      const message = `Debug retry approval created: ${approval.id} report=${approval.debugReportId} task=${approval.taskId ?? "*"}`;
      if (ctx.hasUI) ctx.ui.notify(message, "info");
      else console.log(message);
    },
  });

  pi.registerCommand("scaler-debug-retry-approvals", {
    description: "List debug retry approvals.",
    handler: async (_args, ctx) => {
      const message = formatDebugRetryApprovals(await loadDebugRetryApprovals(ctx.cwd));
      if (ctx.hasUI) ctx.ui.notify(message, "info");
      else console.log(message);
    },
  });

  pi.registerCommand("scaler-debug-loop", {
    description: "Run the bounded SCALER debug/research/replan conductor: /scaler-debug-loop [taskId] [execute] [max=N]",
    handler: async (args, ctx) => {
      const parsed = parseDebugLoopArgs(args);
      const state = await ensureState(ctx.cwd);
      const result = await runDebugConductorLoop(ctx.cwd, state, {
        taskId: parsed.taskId,
        execute: parsed.execute,
        maxSteps: parsed.maxSteps,
      });
      const message = result.message;
      if (ctx.hasUI) ctx.ui.notify(message, result.accepted ? "info" : "warning");
      else console.log(message);
    },
  });

  pi.registerCommand("scaler-debug-runs", {
    description: "List recent SCALER debug-agent run records: /scaler-debug-runs [taskId]",
    handler: async (args, ctx) => {
      const taskId = args?.trim() || undefined;
      const message = formatDebugAgentRunList(await loadDebugAgentRunRecords(ctx.cwd), taskId);
      if (ctx.hasUI) ctx.ui.notify(message, "info");
      else console.log(message);
    },
  });

  pi.registerCommand("scaler-debug-reports", {
    description: "List recent SCALER debug reports.",
    handler: async (_args, ctx) => {
      const message = formatDebugReportSummary(await loadDebugReports(ctx.cwd));
      if (ctx.hasUI) ctx.ui.notify(message, "info");
      else console.log(message);
    },
  });

  pi.registerCommand("scaler-debug-retries", {
    description: "List recent SCALER debug next-approach retry records.",
    handler: async (_args, ctx) => {
      const message = formatDebugRetrySummary(await loadDebugRetries(ctx.cwd));
      if (ctx.hasUI) ctx.ui.notify(message, "info");
      else console.log(message);
    },
  });

  pi.registerCommand("scaler-tool-catalog", {
    description: "List static plus discovered Tool/MCP schema metadata: /scaler-tool-catalog [toolName]",
    handler: async (args, ctx) => {
      const parsed = parseToolCatalogArgs(args);
      const message = formatKnownToolCatalog(await loadToolSchemaRecords(ctx.cwd), parsed.toolName);
      if (ctx.hasUI) ctx.ui.notify(message, "info");
      else console.log(message);
    },
  });

  pi.registerCommand("scaler-active-tools", {
    description: "Show or manage parent-session active-tool focus: /scaler-active-tools [catalog|focus|restore]",
    handler: async (args, ctx) => {
      const action = args?.trim().toLowerCase() || "catalog";
      const runtimeCtx = pi;
      if (!runtimeCtx.getAllTools || !runtimeCtx.getActiveTools || !runtimeCtx.setActiveTools) {
        const message = "Parent active-tool APIs are unavailable on this Pi ExtensionAPI.";
        if (ctx.hasUI) ctx.ui.notify(message, "warning");
        else console.log(message);
        return;
      }
      const state = await ensureState(ctx.cwd);
      if (action === "restore") {
        const restored = restoreParentToolFocus(ctx.cwd, runtimeCtx, activeToolFocusSnapshots);
        const message = restored ? `Parent active tools restored: ${restored.join(", ")}` : "No parent active-tool focus snapshot to restore.";
        if (restored) await logStateEvent(ctx.cwd, state, "SCALER parent tool focus restored", { activeTools: restored, reason: "command" });
        if (ctx.hasUI) ctx.ui.notify(message, restored ? "info" : "warning");
        else console.log(message);
        return;
      }
      if (action === "focus") {
        if (isChildAgent) {
          const message = "Parent tool focus is unavailable in a child agent; its selected tools are preserved.";
          if (ctx.hasUI) ctx.ui.notify(message, "warning");
          else console.log(message);
          return;
        }
        const focus = applyParentToolFocus(ctx.cwd, state, runtimeCtx, activeToolFocusSnapshots, true);
        const message = focus?.applied
          ? `Parent active tools focused: ${focus.active.join(", ")}`
          : `Parent active tools already focused: ${runtimeCtx.getActiveTools?.().join(", ") ?? "unavailable"}`;
        if (focus?.applied) await logStateEvent(ctx.cwd, state, "SCALER parent tool focus applied", { previousActiveTools: focus.previous, activeTools: focus.active, reason: "command" });
        if (ctx.hasUI) ctx.ui.notify(message, "info");
        else console.log(message);
        return;
      }
      const message = await buildParentRuntimeToolCatalogText(ctx.cwd, runtimeCtx) ?? "Parent tool catalog: unavailable";
      if (ctx.hasUI) ctx.ui.notify(message, "info");
      else console.log(message);
    },
  });

  pi.registerCommand("scaler-mcp-enumerate", {
    description: "Enumerate project-declared MCP servers from local config files: /scaler-mcp-enumerate",
    handler: async (_args, ctx) => {
      const state = await ensureState(ctx.cwd);
      const result = await runMcpServerEnumeration(ctx.cwd, state);
      const message = `${result.message} run=${result.run.id}`;
      if (ctx.hasUI) ctx.ui.notify(message, result.accepted ? "info" : "warning");
      else console.log(message);
    },
  });

  pi.registerCommand("scaler-mcp-servers", {
    description: "List project-declared MCP server enumeration records: /scaler-mcp-servers [name|runs]",
    handler: async (args, ctx) => {
      const value = args?.trim() || undefined;
      const message = value === "runs"
        ? formatMcpEnumerationRuns(await loadMcpEnumerationRuns(ctx.cwd))
        : formatMcpServerRecords(await loadMcpServerRecords(ctx.cwd), value);
      if (ctx.hasUI) ctx.ui.notify(message, "info");
      else console.log(message);
    },
  });

  pi.registerCommand("scaler-tool-discover", {
    description: "Prepare or execute a supervised Tool/MCP schema discovery probe: /scaler-tool-discover <toolName> [execute] [tools=a,b]",
    handler: async (args, ctx) => {
      const parsed = parseToolDiscoverArgs(args);
      const state = await ensureState(ctx.cwd);
      const result = await runToolSchemaDiscoveryAgent(ctx.cwd, state, {
        toolName: parsed.toolName ?? "",
        execute: parsed.execute,
        tools: parsed.tools,
      });
      const suffix = result.run ? ` run=${result.run.id} status=${result.run.status}` : "";
      const message = `${result.message}${suffix}`;
      if (ctx.hasUI) ctx.ui.notify(message, result.accepted ? "info" : "warning");
      else console.log(message);
    },
  });

  pi.registerCommand("scaler-tool-discovery-runs", {
    description: "List supervised Tool/MCP schema discovery probe runs: /scaler-tool-discovery-runs [toolName]",
    handler: async (args, ctx) => {
      const toolName = args?.trim() || undefined;
      const message = formatToolSchemaDiscoveryRuns(await loadToolSchemaDiscoveryRuns(ctx.cwd), toolName);
      if (ctx.hasUI) ctx.ui.notify(message, "info");
      else console.log(message);
    },
  });

  pi.registerCommand("scaler-tool-replay", {
    description: "Prepare or execute a persisted isolated tool-agent transaction replay: /scaler-tool-replay <transactionId> [execute] [approval=<id>]",
    handler: async (args, ctx) => {
      const parsed = parseToolReplayArgs(args);
      const state = await ensureState(ctx.cwd);
      const result = await replayToolTransaction(ctx.cwd, state, { transactionId: parsed.transactionId ?? "", execute: parsed.execute, approvalId: parsed.approvalId });
      const suffix = result.transaction ? ` transaction=${result.transaction.id} status=${result.transaction.status}` : "";
      const message = `${result.message}${suffix}`;
      if (ctx.hasUI) ctx.ui.notify(message, result.accepted ? "info" : "warning");
      else console.log(message);
    },
  });

  pi.registerCommand("scaler-tool-replay-approval", {
    description: "List/create/revoke closed tool replay approvals: /scaler-tool-replay-approval [approve|revoke] ...",
    handler: async (args, ctx) => {
      const parsed = parseToolReplayApprovalArgs(args);
      const state = await ensureState(ctx.cwd);
      if (parsed.action === "approve") {
        try {
          const approval = await createToolReplayApproval(ctx.cwd, state, {
            transactionId: parsed.transactionId ?? "",
            reason: parsed.reason ?? "",
            maxUses: parsed.maxUses,
            ttlMinutes: parsed.ttlMinutes,
          });
          const message = `Tool replay approval created: ${approval.id} transaction=${approval.transactionId} uses=${approval.uses}/${approval.maxUses}`;
          if (ctx.hasUI) ctx.ui.notify(message, "info");
          else console.log(message);
          return;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (ctx.hasUI) ctx.ui.notify(message, "warning");
          else console.log(message);
          return;
        }
      }
      if (parsed.action === "revoke") {
        try {
          const approval = await revokeToolReplayApproval(ctx.cwd, state, { id: parsed.id ?? "", reason: parsed.reason });
          const message = `Tool replay approval revoked: ${approval.id}`;
          if (ctx.hasUI) ctx.ui.notify(message, "info");
          else console.log(message);
          return;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (ctx.hasUI) ctx.ui.notify(message, "warning");
          else console.log(message);
          return;
        }
      }
      const message = formatToolReplayApprovals(await loadToolReplayApprovals(ctx.cwd));
      if (ctx.hasUI) ctx.ui.notify(message, "info");
      else console.log(message);
    },
  });

  pi.registerCommand("scaler-tool-iteration-policy", {
    description: "Inspect or update tool-agent iteration policy: /scaler-tool-iteration-policy [max=N] [auto-replay=on|off]",
    handler: async (args, ctx) => {
      const parsed = parseToolIterationPolicyArgs(args);
      const policy = parsed.maxIterations !== undefined || parsed.autoReplay !== undefined
        ? await saveToolIterationPolicy(ctx.cwd, { maxIterations: parsed.maxIterations, autoReplay: parsed.autoReplay })
        : await loadToolIterationPolicy(ctx.cwd);
      const message = formatToolIterationPolicy(policy);
      if (ctx.hasUI) ctx.ui.notify(message, "info");
      else console.log(message);
    },
  });

  pi.registerCommand("scaler-tool-iterate", {
    description: "Prepare or execute bounded tool-agent correction iterations: /scaler-tool-iterate [requestId] [execute] [max=N]",
    handler: async (args, ctx) => {
      const parsed = parseToolIterateArgs(args);
      const state = await ensureState(ctx.cwd);
      const result = await runToolIterationWorkflow(ctx.cwd, state, { requestId: parsed.requestId, execute: parsed.execute, maxIterations: parsed.maxIterations });
      const suffix = result.run ? ` run=${result.run.id} status=${result.run.status} steps=${result.run.steps.length}` : "";
      const message = `${result.message}${suffix}`;
      if (ctx.hasUI) ctx.ui.notify(message, result.accepted ? "info" : "warning");
      else console.log(message);
    },
  });

  pi.registerCommand("scaler-tool-iteration-runs", {
    description: "List bounded tool-agent iteration run records: /scaler-tool-iteration-runs [requestId]",
    handler: async (args, ctx) => {
      const requestId = args?.trim() || undefined;
      const message = formatToolIterationRuns(await loadToolIterationRuns(ctx.cwd), requestId);
      if (ctx.hasUI) ctx.ui.notify(message, "info");
      else console.log(message);
    },
  });

  pi.registerCommand("scaler-tool-schedule", {
    description: "Plan or execute safe scheduling for prepared tool requests: /scaler-tool-schedule [execute] [parallel=N]",
    handler: async (args, ctx) => {
      const parsed = parseToolScheduleArgs(args);
      const state = await ensureState(ctx.cwd);
      const result = await runToolSchedule(ctx.cwd, state, { execute: parsed.execute, parallelism: parsed.parallelism });
      const message = `${result.message} schedule=${result.schedule.id} status=${result.schedule.status}`;
      if (ctx.hasUI) ctx.ui.notify(message, result.accepted ? "info" : "warning");
      else console.log(message);
    },
  });

  pi.registerCommand("scaler-tool-schedules", {
    description: "List tool scheduling records: /scaler-tool-schedules [requestId]",
    handler: async (args, ctx) => {
      const requestId = args?.trim() || undefined;
      const message = formatToolSchedules(await loadToolSchedules(ctx.cwd), requestId);
      if (ctx.hasUI) ctx.ui.notify(message, "info");
      else console.log(message);
    },
  });

  pi.registerCommand("scaler-tool-run", {
    description: "Prepare or execute an isolated tool-agent transaction: /scaler-tool-run [requestId] [execute]",
    handler: async (args, ctx) => {
      const parsed = parseToolRunArgs(args);
      const state = await ensureState(ctx.cwd);
      const result = await runToolRequestAgent(ctx.cwd, state, { requestId: parsed.requestId, execute: parsed.execute });
      const suffix = result.transaction ? ` transaction=${result.transaction.id} status=${result.transaction.status}` : "";
      const message = `${result.message}${suffix}`;
      if (ctx.hasUI) ctx.ui.notify(message, result.accepted ? "info" : "warning");
      else console.log(message);
    },
  });

  pi.registerCommand("scaler-tool-transactions", {
    description: "List isolated tool-agent transaction records: /scaler-tool-transactions [requestId]",
    handler: async (args, ctx) => {
      const requestId = args?.trim() || undefined;
      const message = formatToolTransactions(await loadToolTransactions(ctx.cwd), requestId);
      if (ctx.hasUI) ctx.ui.notify(message, "info");
      else console.log(message);
    },
  });

  pi.registerCommand("scaler-research-run", {
    description: "Prepare or execute the focused SCALER research agent: /scaler-research-run [requestId] [execute] [internet] [tools=a,b]",
    handler: async (args, ctx) => {
      const parsed = parseResearchRunArgs(args);
      const state = await ensureState(ctx.cwd);
      const result = await runResearchAgentStep(ctx.cwd, state, { requestId: parsed.requestId, execute: parsed.execute, allowInternet: parsed.allowInternet, tools: parsed.tools });
      const ingestion = result.ingestion?.attempted
        ? ` ingestion=${result.ingestion.ingested ? "ingested" : "rejected"}${result.ingestion.report ? ` report=${result.ingestion.report.id}` : ""}`
        : "";
      const message = result.accepted ? `${result.message}${ingestion}` : result.message;
      if (ctx.hasUI) ctx.ui.notify(message, result.accepted && result.ingestion?.ingested !== false ? "info" : "warning");
      else console.log(message);
    },
  });

  pi.registerCommand("scaler-research-web", {
    description: "Plan or execute multi-query web research: /scaler-research-web [requestId] [execute] [internet] [tools=a,b] [max-queries=N]",
    handler: async (args, ctx) => {
      const parsed = parseResearchWebArgs(args);
      const state = await ensureState(ctx.cwd);
      const result = await runResearchWebWorkflow(ctx.cwd, state, {
        requestId: parsed.requestId,
        execute: parsed.execute,
        allowInternet: parsed.allowInternet,
        tools: parsed.tools,
        maxQueries: parsed.maxQueries,
      });
      const message = formatResearchWebRunResult(result);
      if (ctx.hasUI) ctx.ui.notify(message, result.accepted ? "info" : "warning");
      else console.log(message);
    },
  });

  pi.registerCommand("scaler-research-transactions", {
    description: "List web research transaction records: /scaler-research-transactions [requestId]",
    handler: async (args, ctx) => {
      const requestId = args?.trim() || undefined;
      const message = formatResearchWebTransactions(await loadResearchWebTransactions(ctx.cwd), requestId);
      if (ctx.hasUI) ctx.ui.notify(message, "info");
      else console.log(message);
    },
  });

  pi.registerCommand("scaler-research-runs", {
    description: "List recent SCALER research-agent run records: /scaler-research-runs [requestId]",
    handler: async (args, ctx) => {
      const requestId = args?.trim() || undefined;
      const message = formatResearchAgentRunList(await loadResearchAgentRunRecords(ctx.cwd), requestId);
      if (ctx.hasUI) ctx.ui.notify(message, "info");
      else console.log(message);
    },
  });

  pi.registerCommand("scaler-research-status", {
    description: "Show SCALER research request/report summary.",

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { applyAdaptiveOrchestration, assessAdaptiveOrchestration, formatAdaptiveAssessment, startScalerRun } from "./adaptive.js";
import { formatBudgetStatus, getBudgetState, isBudgetUsageKey, persistBudgetDecision, setBudgetLimits, setBudgetUsage } from "./budgets.js";
import {
  parseBudgetSetArgs,
  parseCommitArgs,
  parseContextTaskArgs,
  parseDebugLoopArgs,
  parseDebugRunArgs,
  parseDebugRetryApprovalArgs,
  parseDebugRetryArgs,
  parseDebugRetryPolicyArgs,
  parseMemorySearchArgs,
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
import { ensureTaskContextManifest, formatTaskContextManifest, loadTaskContextManifest } from "./context.js";
import { formatContextSplitRecords, loadContextSplitRecords } from "./context-splits.js";
import { formatTaskAgentRunList, loadTaskAgentRunRecords, runConductorStep } from "./conductor.js";
import { loadDebugAttempts, loadDebugFailures, loadDebugReports, loadDebugRetries, formatDebugReportSummary } from "./debug.js";
import { formatDebugAgentRunList, loadDebugAgentRunRecords, runDebugAgentStep } from "./debug-agent.js";
import { runDebugConductorLoop } from "./debug-conductor.js";
import { approveDebugRetry, formatDebugRetryApprovals, formatDebugRetryPolicy, formatDebugRetrySummary, loadDebugRetryApprovals, loadDebugRetryPolicy, runDebugRetryPolicyWorkflow, saveDebugRetryPolicy } from "./debug-retry.js";
import { formatCommitReports, loadCommitReports } from "./git.js";
import { clearExecutionLock, formatExecutionLock, loadExecutionLock } from "./locks.js";
import { createLogEvent, appendLogEvent, logCommandAudit, logStateEvent, logToolAudit } from "./logging.js";
import { formatMemorySearchResults, loadMemoryIndex, searchMemory, type MemoryValidity } from "./memory.js";
import { commitWithExecutionLock, runValidationWithExecutionLock } from "./operations.js";
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
import { computePrdCoverageSummary, formatPrdCoverageSummary, loadPrdCoverage, loadPrdRequirements } from "./prd.js";
import { extractProviderUsage, recordProviderUsageBudget } from "./provider-usage.js";
import { requestReplan } from "./replanning.js";
import { formatReplanAgentRunList, loadReplanAgentRunRecords, runReplanAgentStep } from "./replan-agent.js";
import { formatResearchAgentRunList, loadResearchAgentRunRecords, runResearchAgentStep } from "./research-agent.js";
import { formatResearchSummary, loadResearchReports, loadResearchRequests, recordResearchReport, upsertResearchRequest } from "./research.js";
import { formatResearchWebRunResult, formatResearchWebTransactions, loadResearchWebTransactions, runResearchWebWorkflow } from "./research-web.js";
import { applySafetyApproval, assessToolCallSafety, createSafetyApproval, formatSafetyApprovals, formatSafetyPolicy, formatSafetyScanRecords, formatSafetyScanResult, loadSafetyApprovals, loadSafetyPolicy, loadSafetyScanRecords, mergeSafetyPolicy, revokeSafetyApproval, runSafetyScans, saveSafetyPolicy } from "./safety.js";
import { createTask, formatTaskList, retryTask, updateTask } from "./tasks.js";
import { formatTaskAgentReportList, loadTaskAgentReports } from "./task-reports.js";
import { formatTaskDefinitionReviews, loadTaskDefinitionReviews, reviewAllTaskDefinitions, reviewTaskDefinition } from "./task-quality.js";
import { ensureState, formatDetailedStateStatus, formatStateStatus, saveState } from "./state.js";
import { advanceStageAfterReadyArtifact } from "./stage-advancement.js";
import { formatStageAgentRunList, loadStageAgentRunRecords, runStageAgentStep } from "./stage-agents.js";
import { runStageConductorLoop, runStageConductorStep } from "./stage-conductor.js";
import {
  formatStageArtifactReadiness,
  formatStageArtifactSummary,
  loadStageArtifacts,
  summarizeStageArtifacts,
  upsertStageArtifact,
  validateStageArtifactReadiness,
} from "./stages.js";
import { formatStorageInventory, formatStorageMaintenanceReport, formatStorageMaintenanceSchedule, loadStorageMaintenanceSchedule, runScheduledStorageMaintenance, runStorageMaintenance, saveStorageInventory, scanScalerStorageInventory, updateStorageMaintenanceSchedule, type StorageMaintenancePolicy } from "./storage.js";
import { createToolReplayApproval, formatKnownToolCatalog, formatMcpEnumerationRuns, formatMcpServerRecords, formatToolIterationPolicy, formatToolIterationRuns, formatToolReplayApprovals, formatToolSchedules, formatToolSchemaDiscoveryRuns, formatToolTransactions, loadMcpEnumerationRuns, loadMcpServerRecords, loadToolIterationPolicy, loadToolIterationRuns, loadToolReplayApprovals, loadToolSchedules, loadToolSchemaDiscoveryRuns, loadToolSchemaRecords, loadToolTransactions, replayToolTransaction, revokeToolReplayApproval, runMcpServerEnumeration, runToolIterationWorkflow, runToolRequestAgent, runToolSchedule, runToolSchemaDiscoveryAgent, saveToolIterationPolicy } from "./tool-requests.js";
import { registerScalerTools } from "./tools.js";
import { formatValidationChecklist, recordValidationChecklist, upsertValidationManifestCommand } from "./validation.js";
import { runValidationDebugLoopWorkflow, selectTaskForValidationDebugLoop } from "./validation-debug-loop.js";
import { formatWorkflowSummary, summarizeWorkflow } from "./workflow.js";

export default function scalerExtension(pi: ExtensionAPI): void {
  registerScalerTools(pi);

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

  pi.on("turn_end", async (event, ctx) => {
    const usage = extractProviderUsage([event]);
    if (!usage) return undefined;
    const state = await ensureState(ctx.cwd);
    await recordProviderUsageBudget(ctx.cwd, state, usage, {
      source: "parent-turn-end",
      agentType: "parent",
    });
    return undefined;
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
    const currentTask = state.currentTaskId ? state.tasks.find((task) => task.id === state.currentTaskId) : undefined;
    const persistedSafetyPolicy = await loadSafetyPolicy(ctx.cwd);
    const decision = assessToolCallSafety(
      {
        toolName: event.toolName,
        input: event.input as Record<string, unknown>,
      },
      mergeSafetyPolicy(persistedSafetyPolicy, { allowedPathPrefixes: currentTask?.allowedPathPrefixes }),
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
    description: "Start a minimal adaptive SCALER run for a request.",
    handler: async (args, ctx) => {
      const state = await ensureState(ctx.cwd);
      const nextState = startScalerRun(state, args ?? "");
      await saveState(ctx.cwd, nextState);
      await logStateEvent(ctx.cwd, nextState, "Scaler run requested", { command: "scaler", request: args ?? "" });

      const message = `${formatStateStatus(nextState)} reason=${nextState.orchestrationReason ?? "n/a"}`;
      if (ctx.hasUI) {
        ctx.ui.notify(message, "info");
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

  pi.registerCommand("scaler-context-splits", {
    description: "List automatic context split artifacts: /scaler-context-splits [taskId]",
    handler: async (args, ctx) => {
      const taskId = args?.trim() || undefined;
      const message = formatContextSplitRecords(await loadContextSplitRecords(ctx.cwd), taskId);
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
    description: "Create a SCALER task: /scaler-task-create <taskId> | <title> | <allowed paths comma list> | <dependency ids comma list> | <PRD refs comma list> | <DoD items semicolon list>",
    handler: async (args, ctx) => {
      const parsed = parseTaskCreateArgs(args);
      if (!parsed) {
        const message = "Usage: /scaler-task-create <taskId> | <title> | <allowed paths comma list> | <dependency ids comma list> | <PRD refs comma list> | <DoD items semicolon list>";
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
      });
      if (ctx.hasUI) ctx.ui.notify(result.message, result.accepted ? "info" : "warning");
      else console.log(result.message);
    },
  });

  pi.registerCommand("scaler-task-update", {
    description: "Update a SCALER task: /scaler-task-update <taskId> | <title> | <status> | <allowed paths> | <dependencies> | <PRD refs> | <DoD items semicolon list>",
    handler: async (args, ctx) => {
      const parsed = parseTaskUpdateArgs(args);
      if (!parsed) {
        const message = "Usage: /scaler-task-update <taskId> | <title> | <status> | <allowed paths> | <dependencies> | <PRD refs> | <DoD items semicolon list>";
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
    handler: async (_args, ctx) => {
      const message = formatResearchSummary(await loadResearchRequests(ctx.cwd), await loadResearchReports(ctx.cwd));
      if (ctx.hasUI) ctx.ui.notify(message, "info");
      else console.log(message);
    },
  });

  pi.registerCommand("scaler-research-request", {
    description: "Create a SCALER research request: /scaler-research-request <question> | <reason> | <taskId> | <PRD refs> | <scope>",
    handler: async (args, ctx) => {
      const parsed = parseResearchRequestArgs(args);
      if (!parsed) {
        const message = "Usage: /scaler-research-request <question> | <reason> | <taskId> | <PRD refs comma list> | <local|internet|mixed>";
        if (ctx.hasUI) ctx.ui.notify(message, "warning");
        else console.log(message);
        return;
      }
      try {
        const request = await upsertResearchRequest(ctx.cwd, {
          question: parsed.question,
          reason: parsed.reason ?? "Research requested by operator.",
          taskId: parsed.taskId,
          requirementRefs: parsed.requirementRefs,
          scope: parsed.scope,
        });
        const message = `Research request saved: ${request.id}`;
        if (ctx.hasUI) ctx.ui.notify(message, "info");
        else console.log(message);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (ctx.hasUI) ctx.ui.notify(message, "warning");
        else console.log(message);
      }
    },
  });

  pi.registerCommand("scaler-research-report", {
    description: "Record a compact SCALER research report: /scaler-research-report <question> | <conclusion> | <confidence> | <sourceId> | <sourceTitle> | <sourceQuality> | <sourceRef> | <requestId> | <taskId> | <PRD refs>",
    handler: async (args, ctx) => {
      const parsed = parseResearchReportArgs(args);
      if (!parsed) {
        const message = "Usage: /scaler-research-report <question> | <conclusion> | <confidence> | <sourceId> | <sourceTitle> | <sourceQuality> | <sourceRef> | <requestId> | <taskId> | <PRD refs>";
        if (ctx.hasUI) ctx.ui.notify(message, "warning");
        else console.log(message);
        return;
      }
      try {
        const sourceRef = parsed.sourceRef ?? "operator summary";
        const source = {
          id: parsed.sourceId ?? "source-1",
          title: parsed.sourceTitle ?? "Operator supplied source",
          quality: parsed.sourceQuality ?? "unknown",
          summary: sourceRef.startsWith("http") || sourceRef.includes("/") ? undefined : sourceRef,
          url: sourceRef.startsWith("http") ? sourceRef : undefined,
          path: !sourceRef.startsWith("http") && sourceRef.includes("/") ? sourceRef : undefined,
        };
        const report = await recordResearchReport(ctx.cwd, {
          status: "complete",
          question: parsed.question,
          requestId: parsed.requestId,
          taskId: parsed.taskId,
          requirementRefs: parsed.requirementRefs,
          sources: [source],
          conclusions: [{ summary: parsed.conclusion, confidence: parsed.confidence ?? "unknown", sourceRefs: [source.id] }],
        });
        const message = `Research report saved: ${report.id}`;
        if (ctx.hasUI) ctx.ui.notify(message, "info");
        else console.log(message);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (ctx.hasUI) ctx.ui.notify(message, "warning");
        else console.log(message);
      }
    },
  });

  pi.registerCommand("scaler-replan-proposal-status", {
    description: "Show staged SCALER replan proposal preservation status.",
    handler: async (_args, ctx) => {
      const state = await ensureState(ctx.cwd);
      const currentPlan = await loadExecutionPlan(ctx.cwd);
      const proposedPlan = await loadProposedExecutionPlan(ctx.cwd);
      const requirements = await loadPrdRequirements(ctx.cwd);
      const message = proposedPlan
        ? `${formatExecutionPlanSummary(summarizeExecutionPlan(proposedPlan, requirements, state))}\n${formatExecutionPlanPreservationCheck(checkExecutionPlanPreservation(currentPlan, proposedPlan, requirements, state))}`
        : "No proposed execution plan found at .scaler/plans/proposed-plan.json.";
      if (ctx.hasUI) ctx.ui.notify(message, proposedPlan ? "info" : "warning");
      else console.log(message);
    },
  });

  pi.registerCommand("scaler-replan-accept", {
    description: "Accept .scaler/plans/proposed-plan.json after preservation checks.",
    handler: async (_args, ctx) => {
      const state = await ensureState(ctx.cwd);
      const requirements = await loadPrdRequirements(ctx.cwd);
      const result = await acceptReplanProposal(ctx.cwd, state, requirements);
      const message = `${result.message} decision=${result.decision.id}`;
      if (ctx.hasUI) ctx.ui.notify(message, result.accepted ? "info" : "warning");
      else console.log(message);
    },
  });

  pi.registerCommand("scaler-replan-request", {
    description: "Create a SCALER replan request: /scaler-replan-request <reason> | <taskId> | <evidence refs> | <PRD refs>",
    handler: async (args, ctx) => {
      const parsed = parseReplanRequestArgs(args);
      if (!parsed) {
        const message = "Usage: /scaler-replan-request <reason> | <taskId> | <evidence refs comma list> | <PRD refs comma list>";
        if (ctx.hasUI) ctx.ui.notify(message, "warning");
        else console.log(message);
        return;
      }

      const state = await ensureState(ctx.cwd);
      const result = await requestReplan(ctx.cwd, state, {
        trigger: "manual",
        reason: parsed.reason,
        taskId: parsed.taskId,
        evidenceRefs: parsed.evidenceRefs,
        requirementRefs: parsed.requirementRefs,
      });
      if (ctx.hasUI) ctx.ui.notify(result.message, result.transitioned ? "info" : "warning");
      else console.log(result.message);
    },
  });

  pi.registerCommand("scaler-prd-link", {
    description: "Link an existing task to runtime PRD requirements: /scaler-prd-link <taskId> | <REQ-001,REQ-002>",
    handler: async (args, ctx) => {
      const parsed = parsePrdLinkArgs(args);
      if (!parsed) {
        const message = "Usage: /scaler-prd-link <taskId> | <REQ-001,REQ-002>";
        if (ctx.hasUI) ctx.ui.notify(message, "warning");
        else console.log(message);
        return;
      }

      const state = await ensureState(ctx.cwd);
      const result = await updateTask(ctx.cwd, state, { id: parsed.taskId, prdRefs: parsed.prdRefs });
      if (ctx.hasUI) ctx.ui.notify(result.message, result.accepted ? "info" : "warning");
      else console.log(result.message);
    },
  });

  pi.registerCommand("scaler-task-retry", {
    description: "Retry a SCALER task: /scaler-task-retry <taskId> | <reason>",
    handler: async (args, ctx) => {
      const parsed = parseTaskRetryArgs(args);
      const state = await ensureState(ctx.cwd);
      const taskId = parsed.taskId ?? state.currentTaskId ?? undefined;
      if (!taskId) {
        const message = "Usage: /scaler-task-retry <taskId> | <reason>";
        if (ctx.hasUI) ctx.ui.notify(message, "warning");
        else console.log(message);
        return;
      }

      const result = await retryTask(ctx.cwd, state, taskId, parsed.reason ?? "Task retry requested.");
      if (ctx.hasUI) ctx.ui.notify(result.message, result.accepted ? "info" : "warning");
      else console.log(result.message);
    },
  });

  pi.registerCommand("scaler-step", {
    description: "Run one minimal SCALER conductor step. Pass 'execute' to run the task agent.",
    handler: async (args, ctx) => {
      const state = await ensureState(ctx.cwd);
      const execute = /\bexecute\b/i.test(args ?? "");
      const result = await runConductorStep(ctx.cwd, state, { execute });
      const message = result.accepted ? `${result.message} checkpoint=${result.checkpointPath ?? "n/a"}` : result.message;
      if (ctx.hasUI) {
        ctx.ui.notify(message, result.accepted ? "info" : "warning");
      } else {
        console.log(message);
      }
    },
  });

  pi.registerCommand("scaler-validation-checklist", {
    description: "Record a deterministic non-software validation checklist: /scaler-validation-checklist <taskId> | <gate> | <summary> | <id::status::required::statement::evidence;...> | <evidence refs>",
    handler: async (args, ctx) => {
      const parsed = parseValidationChecklistArgs(args);
      if (!parsed) {
        const message = "Usage: /scaler-validation-checklist <taskId> | <gate> | <summary> | <id::status::required::statement::evidence;...> | <evidence refs>";
        if (ctx.hasUI) ctx.ui.notify(message, "warning");
        else console.log(message);
        return;
      }
      const state = await ensureState(ctx.cwd);
      const result = await recordValidationChecklist(ctx.cwd, state, {
        taskId: parsed.taskId,
        gate: parsed.gate,
        summary: parsed.summary,
        items: parsed.items,
        evidenceRefs: parsed.evidenceRefs,
      });
      const message = `${formatValidationChecklist(result.record)}\n${result.applyResult.message}`;
      if (ctx.hasUI) ctx.ui.notify(message, result.applyResult.accepted ? "info" : "warning");
      else console.log(message);
    },
  });

  pi.registerCommand("scaler-validation-add", {
    description: "Add or replace a validation command: /scaler-validation-add <taskId> | <id> | <command> | <description> | <required> | <gate> | <expected> | <evidence refs> | <environment> | <disposition>",
    handler: async (args, ctx) => {
      const parsed = parseValidationAddArgs(args);
      if (!parsed) {
        const message = "Usage: /scaler-validation-add <taskId> | <id> | <command> | <description> | <required> | <gate> | <expected> | <evidence refs> | <environment> | <disposition>";
        if (ctx.hasUI) ctx.ui.notify(message, "warning");
        else console.log(message);
        return;
      }

      const manifest = await upsertValidationManifestCommand(ctx.cwd, parsed);
      const saved = manifest.commands.find((command) => command.id === parsed.id);
      const message = `Validation command saved: ${parsed.taskId}/${parsed.id} commands=${manifest.commands.length}${saved?.gate ? ` gate=${saved.gate}` : ""}`;
      if (ctx.hasUI) ctx.ui.notify(message, "info");
      else console.log(message);
    },
  });

  pi.registerCommand("scaler-commit", {
    description: "Commit a validated SCALER task: /scaler-commit [taskId] | [allowed paths comma list]",
    handler: async (args, ctx) => {
      const state = await ensureState(ctx.cwd);
      const parsed = parseCommitArgs(args);
      const taskId = selectTaskForCommit(state, parsed.taskId);
      if (!taskId) {
        const message = "No validated task found for /scaler-commit.";
        if (ctx.hasUI) ctx.ui.notify(message, "warning");
        else console.log(message);
        return;
      }

      const allowedPaths = resolveCommitAllowedPaths(state, taskId, parsed.allowedPathPrefixes);
      const result = await commitWithExecutionLock(ctx.cwd, state, taskId, allowedPaths);
      if (ctx.hasUI) ctx.ui.notify(result.message, result.accepted ? "info" : "warning");
      else console.log(result.message);
    },
  });

  pi.registerCommand("scaler-commits", {
    description: "List SCALER post-commit reports: /scaler-commits [taskId]",
    handler: async (args, ctx) => {
      const taskId = args?.trim() || undefined;
      const message = formatCommitReports(await loadCommitReports(ctx.cwd), taskId);
      if (ctx.hasUI) ctx.ui.notify(message, "info");
      else console.log(message);
    },
  });

  pi.registerCommand("scaler-validate-loop", {
    description: "Run validation and, on failure, start the bounded debug loop: /scaler-validate-loop [taskId] [execute] [max=N]",
    handler: async (args, ctx) => {
      const parsed = parseValidateLoopArgs(args);
      const state = await ensureState(ctx.cwd);
      const taskId = selectTaskForValidationDebugLoop(state, parsed.taskId);
      if (!taskId) {
        const message = "No validating/debugging task found for /scaler-validate-loop.";
        if (ctx.hasUI) ctx.ui.notify(message, "warning");
        else console.log(message);
        return;
      }

      const result = await runValidationDebugLoopWorkflow(ctx.cwd, state, taskId, {
        execute: parsed.execute,
        maxSteps: parsed.maxSteps,
      });
      if (ctx.hasUI) ctx.ui.notify(result.message, result.accepted ? "info" : "warning");
      else console.log(result.message);
    },
  });

  pi.registerCommand("scaler-validate", {
    description: "Run validation for a task id, current validating task, or first validating task.",
    handler: async (args, ctx) => {
      const state = await ensureState(ctx.cwd);
      const requestedTaskId = args?.trim() || undefined;
      const taskId = requestedTaskId
        ?? (state.currentTaskId && state.tasks.find((task) => task.id === state.currentTaskId && task.status === "validating")?.id)
        ?? state.tasks.find((task) => task.status === "validating")?.id;

      if (!taskId) {
        const message = "No validating task found for /scaler-validate.";
        if (ctx.hasUI) ctx.ui.notify(message, "warning");
        else console.log(message);
        return;
      }

      const result = await runValidationWithExecutionLock(ctx.cwd, state, taskId);
      if (ctx.hasUI) {
        ctx.ui.notify(result.message, result.accepted && result.result?.status === "passed" ? "info" : "warning");
      } else {
        console.log(result.message);
      }
    },
  });

  pi.registerCommand("scaler-validation-envs", {
    description: "Show recent validation environment prepare/cleanup lifecycle records.",
    handler: async (_args, ctx) => {
      const message = formatValidationEnvironmentRecords(await loadValidationEnvironmentRecords(ctx.cwd));
      if (ctx.hasUI) ctx.ui.notify(message, "info");
      else console.log(message);
    },
  });

  pi.registerCommand("scaler-pause", {
    description: "Pause the current SCALER run and write a checkpoint.",
    handler: async (args, ctx) => {
      const result = await pauseScalerRun(ctx.cwd, args || "manual pause");
      if (ctx.hasUI) {
        ctx.ui.notify(result.message, "info");
      } else {
        console.log(result.message);
      }
    },
  });

  pi.registerCommand("scaler-resume", {
    description: "Resume a paused SCALER run to its previous active stage and write a checkpoint.",
    handler: async (args, ctx) => {
      const result = await resumeScalerRun(ctx.cwd, args || "manual resume");
      if (ctx.hasUI) {
        ctx.ui.notify(result.message, "info");
      } else {
        console.log(result.message);
      }
    },
  });

  pi.registerCommand("scaler-storage-status", {
    description: "Scan .scaler/ storage, persist an inventory index, update storage budget usage, and show largest files.",
    handler: async (_args, ctx) => {
      const state = await ensureState(ctx.cwd);
      const inventory = await saveStorageInventory(ctx.cwd, await scanScalerStorageInventory(ctx.cwd));
      const budgetResult = setBudgetUsage(state, "storageBytes", inventory.totalBytes);
      const persisted = await persistBudgetDecision(ctx.cwd, budgetResult.state, budgetResult.decision);
      await logStateEvent(ctx.cwd, persisted, "Scaler storage status requested", {
        command: "scaler-storage-status",
        inventory,
        budgetDecision: budgetResult.decision,
      });
      const message = `${formatStorageInventory(inventory)}\nBudget: ${budgetResult.decision.status} ${budgetResult.decision.reason}`;
      if (ctx.hasUI) ctx.ui.notify(message, budgetResult.decision.status === "hard_limit" ? "warning" : "info");
      else console.log(message);
    },
  });

  pi.registerCommand("scaler-storage-maintain", {
    description: "Plan or execute safe .scaler/ storage maintenance: /scaler-storage-maintain [execute] [compress] [delete-cache] [rotate-active] [delete-archives] [min-age-days=N] [min-size=N] [max-active-bytes=N] [min-free-bytes=N] [max-archive-bytes=N] [max-archive-age-days=N]",
    handler: async (args, ctx) => {
      const parsed = parseStorageMaintainArgs(args);
      const state = await ensureState(ctx.cwd);
      const report = await runStorageMaintenance(ctx.cwd, {
        execute: parsed.execute,
        compress: parsed.compress,
        deleteCache: parsed.deleteCache,
        minAgeDays: parsed.minAgeDays,
        minSizeBytes: parsed.minSizeBytes,
        rotateActive: parsed.rotateActive,
        maxActiveBytes: parsed.maxActiveBytes,
        minFreeBytes: parsed.minFreeBytes,
        deleteArchives: parsed.deleteArchives,
        maxArchiveBytes: parsed.maxArchiveBytes,
        maxArchiveAgeDays: parsed.maxArchiveAgeDays,
        deleteRawLogs: parsed.deleteRawLogs,
        maxRawLogBytes: parsed.maxRawLogBytes,
        maxRawLogAgeDays: parsed.maxRawLogAgeDays,
        deleteMemory: parsed.deleteMemory,
        maxMemoryBytes: parsed.maxMemoryBytes,
        maxMemoryAgeDays: parsed.maxMemoryAgeDays,
      });
      const inventory = await scanScalerStorageInventory(ctx.cwd);
      const budgetResult = setBudgetUsage(state, "storageBytes", inventory.totalBytes);
      const persisted = await persistBudgetDecision(ctx.cwd, budgetResult.state, budgetResult.decision);
      await logStateEvent(ctx.cwd, persisted, "Scaler storage maintenance requested", {
        command: "scaler-storage-maintain",
        report,
        inventory,
        budgetDecision: budgetResult.decision,
      });
      const message = `${formatStorageMaintenanceReport(report)}\nBudget: ${budgetResult.decision.status} ${budgetResult.decision.reason}`;
      if (ctx.hasUI) ctx.ui.notify(message, report.summary.failed > 0 || budgetResult.decision.status === "hard_limit" ? "warning" : "info");
      else console.log(message);
    },
  });

  pi.registerCommand("scaler-storage-schedule", {
    description: "Show, update, or run scheduled .scaler/ storage maintenance: /scaler-storage-schedule [enable|disable] [run] [force] [execute=on/off] [interval-hours=N] [compress=on/off] [delete-cache=on/off] [rotate-active=on/off] [delete-archives=on/off] ...",
    handler: async (args, ctx) => {
      const parsed = parseStorageScheduleArgs(args);
      const policy: Partial<StorageMaintenancePolicy> = {};
      if (parsed.compress !== undefined) policy.compress = parsed.compress;
      if (parsed.deleteCache !== undefined) policy.deleteCache = parsed.deleteCache;
      if (parsed.minAgeDays !== undefined) policy.minAgeDays = parsed.minAgeDays;
      if (parsed.minSizeBytes !== undefined) policy.minSizeBytes = parsed.minSizeBytes;
      if (parsed.rotateActive !== undefined) policy.rotateActive = parsed.rotateActive;
      if (parsed.maxActiveBytes !== undefined) policy.maxActiveBytes = parsed.maxActiveBytes;
      if (parsed.minFreeBytes !== undefined) policy.minFreeBytes = parsed.minFreeBytes;
      if (parsed.deleteArchives !== undefined) policy.deleteArchives = parsed.deleteArchives;
      if (parsed.maxArchiveBytes !== undefined) policy.maxArchiveBytes = parsed.maxArchiveBytes;
      if (parsed.maxArchiveAgeDays !== undefined) policy.maxArchiveAgeDays = parsed.maxArchiveAgeDays;
      if (parsed.deleteRawLogs !== undefined) policy.deleteRawLogs = parsed.deleteRawLogs;
      if (parsed.maxRawLogBytes !== undefined) policy.maxRawLogBytes = parsed.maxRawLogBytes;
      if (parsed.maxRawLogAgeDays !== undefined) policy.maxRawLogAgeDays = parsed.maxRawLogAgeDays;
      if (parsed.deleteMemory !== undefined) policy.deleteMemory = parsed.deleteMemory;
      if (parsed.maxMemoryBytes !== undefined) policy.maxMemoryBytes = parsed.maxMemoryBytes;
      if (parsed.maxMemoryAgeDays !== undefined) policy.maxMemoryAgeDays = parsed.maxMemoryAgeDays;
      const hasPolicyUpdate = Object.keys(policy).length > 0;
      const hasUpdate = parsed.enabled !== undefined || parsed.intervalHours !== undefined || parsed.execute !== undefined || hasPolicyUpdate;
      let schedule = hasUpdate
        ? await updateStorageMaintenanceSchedule(ctx.cwd, {
          enabled: parsed.enabled,
          intervalHours: parsed.intervalHours,
          execute: parsed.execute,
          policy: hasPolicyUpdate ? policy : undefined,
        })
        : await loadStorageMaintenanceSchedule(ctx.cwd);
      let runResult = parsed.run ? await runScheduledStorageMaintenance(ctx.cwd, { force: parsed.force }) : undefined;
      if (runResult) schedule = runResult.config;
      const state = await ensureState(ctx.cwd);
      let budgetDecision;
      let inventory;
      let persisted = state;
      if (runResult?.report) {
        inventory = await scanScalerStorageInventory(ctx.cwd);
        const budgetResult = setBudgetUsage(state, "storageBytes", inventory.totalBytes);
        budgetDecision = budgetResult.decision;
        persisted = await persistBudgetDecision(ctx.cwd, budgetResult.state, budgetResult.decision);
      }
      await logStateEvent(ctx.cwd, persisted, "Scaler storage schedule requested", {
        command: "scaler-storage-schedule",
        updated: hasUpdate,
        run: parsed.run,
        force: parsed.force,
        schedule,
        runResult,
        inventory,
        budgetDecision,
      });
      const baseMessage = formatStorageMaintenanceSchedule(schedule, runResult);
      const message = budgetDecision ? `${baseMessage}\nBudget: ${budgetDecision.status} ${budgetDecision.reason}` : baseMessage;
      if (ctx.hasUI) ctx.ui.notify(message, runResult?.report?.summary.failed ? "warning" : "info");
      else console.log(message);
    },
  });

  pi.registerCommand("scaler-safety-policy", {
    description: "Show or update persisted SCALER safety policy: /scaler-safety-policy [allow-internet=on/off] [allow-external=on/off] [allow-sandbox=on/off]",
    handler: async (args, ctx) => {
      const parsed = parseSafetyPolicyArgs(args);
      const hasUpdate = parsed.allowInternet !== undefined || parsed.allowExternalMutations !== undefined || parsed.allowSandbox !== undefined;
      const policy = hasUpdate ? await saveSafetyPolicy(ctx.cwd, parsed) : await loadSafetyPolicy(ctx.cwd);
      const state = await ensureState(ctx.cwd);
      await logStateEvent(ctx.cwd, state, "Scaler safety policy requested", {
        command: "scaler-safety-policy",
        updated: hasUpdate,
        policy,
      });
      const message = formatSafetyPolicy(policy);
      if (ctx.hasUI) ctx.ui.notify(message, "info");
      else console.log(message);
    },
  });

  pi.registerCommand("scaler-safety-approval", {
    description: "List/create/revoke scoped safety approvals: /scaler-safety-approval approve | <tool> | <match> | <value> | <risk> | <reason> | [max-uses=N ttl-minutes=N sandbox=on]",
    handler: async (args, ctx) => {
      const parsed = parseSafetyApprovalArgs(args);
      const state = await ensureState(ctx.cwd);
      let message: string;
      if (parsed.action === "approve") {
        if (!parsed.toolName || !parsed.match || !parsed.reason) {
          message = "Usage: /scaler-safety-approval approve | <tool> | <exact_command|target|tool> | <value> | <risk|any> | <reason> | [max-uses=N ttl-minutes=N sandbox=on]";
          if (ctx.hasUI) ctx.ui.notify(message, "warning");
          else console.log(message);
          return;
        }
        const approval = await createSafetyApproval(ctx.cwd, {
          toolName: parsed.toolName,
          match: parsed.match,
          value: parsed.value,
          risk: parsed.risk,
          reason: parsed.reason,
          sandboxOnly: parsed.sandboxOnly,
          maxUses: parsed.maxUses,
          ttlMinutes: parsed.ttlMinutes,
        });
        message = `Safety approval created: ${approval.id} risk=${approval.risk} tool=${approval.toolName ?? "*"} match=${approval.match} uses=0/${approval.maxUses}`;
        await logStateEvent(ctx.cwd, state, "Scaler safety approval created", {
          command: "scaler-safety-approval",
          action: "approve",
          approval,
        });
      } else if (parsed.action === "revoke") {
        if (!parsed.id) {
          message = "Usage: /scaler-safety-approval revoke | <approval-id> | [reason]";
          if (ctx.hasUI) ctx.ui.notify(message, "warning");
          else console.log(message);
          return;
        }
        const revoked = await revokeSafetyApproval(ctx.cwd, parsed.id, parsed.reason);
        message = revoked ? `Safety approval revoked: ${revoked.id}` : `Safety approval not found: ${parsed.id}`;
        await logStateEvent(ctx.cwd, state, "Scaler safety approval revoked", {
          command: "scaler-safety-approval",
          action: "revoke",
          approval: revoked,
          requestedId: parsed.id,
        });
      } else {
        const approvals = await loadSafetyApprovals(ctx.cwd);
        message = formatSafetyApprovals(approvals);
        await logStateEvent(ctx.cwd, state, "Scaler safety approvals requested", {
          command: "scaler-safety-approval",
          action: "list",
          count: approvals.length,
        });
      }
      if (ctx.hasUI) ctx.ui.notify(message, "info");
      else console.log(message);
    },
  });

  pi.registerCommand("scaler-safety-scan", {
    description: "Plan or run optional dependency/image security scanners: /scaler-safety-scan [execute] [kinds=npm_audit,trivy_fs]",
    handler: async (args, ctx) => {
      const parsed = parseSafetyScanArgs(args);
      const result = await runSafetyScans(ctx.cwd, { execute: parsed.execute, kinds: parsed.kinds });
      const records = await loadSafetyScanRecords(ctx.cwd);
      const state = await ensureState(ctx.cwd);
      await logStateEvent(ctx.cwd, state, "Scaler safety scan requested", {
        command: "scaler-safety-scan",
        execute: parsed.execute,
        result,
        records: records.length,
      });
      const message = `${formatSafetyScanResult(result)}\n${formatSafetyScanRecords(records, 5)}`;
      if (ctx.hasUI) ctx.ui.notify(message, result.summary.failed > 0 ? "warning" : "info");
      else console.log(message);
    },
  });

  pi.registerCommand("scaler-budget-status", {
    description: "Show SCALER budget usage, limits, and strongest decision.",
    handler: async (_args, ctx) => {
      const state = await ensureState(ctx.cwd);
      const message = formatBudgetStatus(state);
      await logStateEvent(ctx.cwd, state, "Scaler budget status requested", { command: "scaler-budget-status" });

      if (ctx.hasUI) ctx.ui.notify(message, "info");
      else console.log(message);
    },
  });

  pi.registerCommand("scaler-budget-set", {
    description: "Set a SCALER budget limit: /scaler-budget-set <key> | <soft> | <hard>; use - to clear a limit.",
    handler: async (args, ctx) => {
      const parsed = parseBudgetSetArgs(args);
      if (!parsed || !isBudgetUsageKey(parsed.key)) {
        const message = "Usage: /scaler-budget-set <key> | <soft> | <hard>. Example: /scaler-budget-set validationLoops | 2 | 3";
        if (ctx.hasUI) ctx.ui.notify(message, "warning");
        else console.log(message);
        return;
      }
      if (parsed.soft === undefined && parsed.hard === undefined) {
        const message = "Budget set requires at least one numeric soft or hard limit.";
        if (ctx.hasUI) ctx.ui.notify(message, "warning");
        else console.log(message);
        return;
      }

      const state = await ensureState(ctx.cwd);
      const nextState = setBudgetLimits(state, {
        [parsed.key]: { soft: parsed.soft, hard: parsed.hard },
      });
      await saveState(ctx.cwd, nextState);
      await logStateEvent(ctx.cwd, nextState, `Budget limit updated: ${parsed.key}`, {
        command: "scaler-budget-set",
        key: parsed.key,
        soft: parsed.soft,
        hard: parsed.hard,
      });
      const message = `Budget limit updated: ${parsed.key} soft=${parsed.soft ?? "-"} hard=${parsed.hard ?? "-"}`;
      if (ctx.hasUI) ctx.ui.notify(message, "info");
      else console.log(message);
    },
  });

  pi.registerCommand("scaler-status", {
    description: "Show SCALER supervisor status.",
    handler: async (_args, ctx) => {
      const state = await ensureState(ctx.cwd);
      const memoryIndex = await loadMemoryIndex(ctx.cwd);
      const debugAttempts = await loadDebugAttempts(ctx.cwd);
      const debugFailures = await loadDebugFailures(ctx.cwd);
      const budgetState = getBudgetState(state);
      const stageArtifacts = await loadStageArtifacts(ctx.cwd);
      await logStateEvent(ctx.cwd, state, "Scaler status requested", { command: "scaler-status" });
      const message = `${formatDetailedStateStatus(state, {
        memoryCount: memoryIndex.entries.length,
        debugAttemptCount: debugAttempts.length,
        debugFailureCount: debugFailures.length,
        budgetUsage: budgetState.usage,
        logPath: getEventLogPath(ctx.cwd),
      })}\n${formatWorkflowSummary(summarizeWorkflow(state, { stageArtifacts }))}`;

      if (ctx.hasUI) {
        ctx.ui.notify(message, "info");
      } else {
        console.log(message);
      }
    },
  });
}

function normalizeMemoryValidityFilter(value: string | undefined): MemoryValidity | "any" | undefined {
  if (!value) return undefined;
  const normalized = value.toLowerCase();
  if (["active", "stale", "obsolete", "unknown", "any"].includes(normalized)) return normalized as MemoryValidity | "any";
  return undefined;
}

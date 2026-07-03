import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { startScalerRun } from "./adaptive.js";
import { getBudgetState } from "./budgets.js";
import {
  parseCommitArgs,
  parseContextTaskArgs,
  parsePrdLinkArgs,
  parseReplanRequestArgs,
  parseStageLoopArgs,
  parseStageRecordArgs,
  parseStageRunArgs,
  parseTaskCreateArgs,
  parseTaskUpdateArgs,
  parseTaskRetryArgs,
  parseValidationAddArgs,
  resolveCommitAllowedPaths,
  selectTaskForCommit,
} from "./commands.js";
import { pauseScalerRun, resumeScalerRun } from "./checkpoints.js";
import { ensureTaskContextManifest, formatTaskContextManifest, loadTaskContextManifest } from "./context.js";
import { formatTaskAgentRunList, loadTaskAgentRunRecords, runConductorStep } from "./conductor.js";
import { loadDebugAttempts, loadDebugFailures } from "./debug.js";
import { clearExecutionLock, formatExecutionLock, loadExecutionLock } from "./locks.js";
import { createLogEvent, appendLogEvent, logStateEvent } from "./logging.js";
import { loadMemoryIndex } from "./memory.js";
import { commitWithExecutionLock, runValidationWithExecutionLock } from "./operations.js";
import { getEventLogPath } from "./paths.js";
import {
  acceptReplanProposal,
  applyExecutionPlanTasks,
  checkExecutionPlanPreservation,
  formatExecutionPlanPreservationCheck,
  formatExecutionPlanSummary,
  formatReplanRequests,
  loadExecutionPlan,
  loadProposedExecutionPlan,
  loadReplanRequests,
  summarizeExecutionPlan,
} from "./plans.js";
import { computePrdCoverageSummary, formatPrdCoverageSummary, loadPrdCoverage, loadPrdRequirements } from "./prd.js";
import { requestReplan } from "./replanning.js";
import { assessToolCallSafety } from "./safety.js";
import { createTask, formatTaskList, retryTask, updateTask } from "./tasks.js";
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
import { registerScalerTools } from "./tools.js";
import { upsertValidationManifestCommand } from "./validation.js";
import { formatWorkflowSummary, summarizeWorkflow } from "./workflow.js";

export default function scalerExtension(pi: ExtensionAPI): void {
  registerScalerTools(pi);

  pi.on("tool_call", async (event, ctx) => {
    const state = await ensureState(ctx.cwd);
    const currentTask = state.currentTaskId ? state.tasks.find((task) => task.id === state.currentTaskId) : undefined;
    const decision = assessToolCallSafety(
      {
        toolName: event.toolName,
        input: event.input as Record<string, unknown>,
      },
      { allowedPathPrefixes: currentTask?.allowedPathPrefixes },
    );

    if (decision.allowed) return undefined;
    await appendLogEvent(
      ctx.cwd,
      createLogEvent(state, {
        eventType: "safety",
        summary: `Blocked ${event.toolName}: ${decision.reason}`,
        details: {
          toolName: event.toolName,
          risk: decision.risk,
          requiresApproval: decision.requiresApproval,
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
    description: "Create a SCALER task: /scaler-task-create <taskId> | <title> | <allowed paths comma list> | <dependency ids comma list> | <PRD refs comma list>",
    handler: async (args, ctx) => {
      const parsed = parseTaskCreateArgs(args);
      if (!parsed) {
        const message = "Usage: /scaler-task-create <taskId> | <title> | <allowed paths comma list> | <dependency ids comma list> | <PRD refs comma list>";
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
      });
      if (ctx.hasUI) ctx.ui.notify(result.message, result.accepted ? "info" : "warning");
      else console.log(result.message);
    },
  });

  pi.registerCommand("scaler-task-update", {
    description: "Update a SCALER task: /scaler-task-update <taskId> | <title> | <status> | <allowed paths> | <dependencies> | <PRD refs>",
    handler: async (args, ctx) => {
      const parsed = parseTaskUpdateArgs(args);
      if (!parsed) {
        const message = "Usage: /scaler-task-update <taskId> | <title> | <status> | <allowed paths> | <dependencies> | <PRD refs>";
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

  pi.registerCommand("scaler-replans", {
    description: "List SCALER replan requests.",
    handler: async (_args, ctx) => {
      const message = formatReplanRequests(await loadReplanRequests(ctx.cwd));
      if (ctx.hasUI) ctx.ui.notify(message, "info");
      else console.log(message);
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

  pi.registerCommand("scaler-validation-add", {
    description: "Add or replace a validation command: /scaler-validation-add <taskId> | <id> | <command> | <description> | <required>",
    handler: async (args, ctx) => {
      const parsed = parseValidationAddArgs(args);
      if (!parsed) {
        const message = "Usage: /scaler-validation-add <taskId> | <id> | <command> | <description> | <required>";
        if (ctx.hasUI) ctx.ui.notify(message, "warning");
        else console.log(message);
        return;
      }

      const manifest = await upsertValidationManifestCommand(ctx.cwd, parsed);
      const message = `Validation command saved: ${parsed.taskId}/${parsed.id} commands=${manifest.commands.length}`;
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

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { startScalerRun } from "./adaptive.js";
import { getBudgetState } from "./budgets.js";
import { parseCommitArgs, parseTaskCreateArgs, parseTaskUpdateArgs, resolveCommitAllowedPaths, selectTaskForCommit } from "./commands.js";
import { pauseScalerRun, resumeScalerRun } from "./checkpoints.js";
import { runConductorStep } from "./conductor.js";
import { loadDebugAttempts, loadDebugFailures } from "./debug.js";
import { commitValidatedTask } from "./git.js";
import { createLogEvent, appendLogEvent, logStateEvent } from "./logging.js";
import { loadMemoryIndex } from "./memory.js";
import { getEventLogPath } from "./paths.js";
import { assessToolCallSafety } from "./safety.js";
import { createTask, formatTaskList, updateTask } from "./tasks.js";
import { ensureState, formatDetailedStateStatus, formatStateStatus, saveState } from "./state.js";
import { registerScalerTools } from "./tools.js";
import { runTaskValidation } from "./validation.js";
import { formatWorkflowSummary, summarizeWorkflow } from "./workflow.js";

export default function scalerExtension(pi: ExtensionAPI): void {
  registerScalerTools(pi);

  pi.on("tool_call", async (event, ctx) => {
    const decision = assessToolCallSafety({
      toolName: event.toolName,
      input: event.input as Record<string, unknown>,
    });

    if (decision.allowed) return undefined;

    const state = await ensureState(ctx.cwd);
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

  pi.registerCommand("scaler-tasks", {
    description: "List SCALER tasks with status and allowed paths.",
    handler: async (_args, ctx) => {
      const state = await ensureState(ctx.cwd);
      const message = formatTaskList(state);
      if (ctx.hasUI) ctx.ui.notify(message, "info");
      else console.log(message);
    },
  });

  pi.registerCommand("scaler-task-create", {
    description: "Create a SCALER task: /scaler-task-create <taskId> | <title> | <allowed paths comma list> | <dependency ids comma list>",
    handler: async (args, ctx) => {
      const parsed = parseTaskCreateArgs(args);
      if (!parsed) {
        const message = "Usage: /scaler-task-create <taskId> | <title> | <allowed paths comma list> | <dependency ids comma list>";
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
      });
      if (ctx.hasUI) ctx.ui.notify(result.message, result.accepted ? "info" : "warning");
      else console.log(result.message);
    },
  });

  pi.registerCommand("scaler-task-update", {
    description: "Update a SCALER task: /scaler-task-update <taskId> | <title> | <status> | <allowed paths> | <dependencies>",
    handler: async (args, ctx) => {
      const parsed = parseTaskUpdateArgs(args);
      if (!parsed) {
        const message = "Usage: /scaler-task-update <taskId> | <title> | <status> | <allowed paths> | <dependencies>";
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
      });
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
      const result = await commitValidatedTask(ctx.cwd, state, taskId, allowedPaths);
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

      const run = await runTaskValidation(ctx.cwd, state, taskId);
      const message = `Validation ${run.status}: ${taskId} commands=${run.commandRuns.length}`;
      if (ctx.hasUI) {
        ctx.ui.notify(message, run.status === "passed" ? "info" : "warning");
      } else {
        console.log(message);
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
      await logStateEvent(ctx.cwd, state, "Scaler status requested", { command: "scaler-status" });
      const message = `${formatDetailedStateStatus(state, {
        memoryCount: memoryIndex.entries.length,
        debugAttemptCount: debugAttempts.length,
        debugFailureCount: debugFailures.length,
        budgetUsage: budgetState.usage,
        logPath: getEventLogPath(ctx.cwd),
      })}\n${formatWorkflowSummary(summarizeWorkflow(state))}`;

      if (ctx.hasUI) {
        ctx.ui.notify(message, "info");
      } else {
        console.log(message);
      }
    },
  });
}

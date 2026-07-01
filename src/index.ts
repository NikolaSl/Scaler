import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { startScalerRun } from "./adaptive.js";
import { createLogEvent, appendLogEvent, logStateEvent } from "./logging.js";
import { getEventLogPath } from "./paths.js";
import { assessToolCallSafety } from "./safety.js";
import { ensureState, formatStateStatus, saveState } from "./state.js";
import { registerScalerTools } from "./tools.js";

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

  pi.registerCommand("scaler-status", {
    description: "Show SCALER supervisor status.",
    handler: async (_args, ctx) => {
      const state = await ensureState(ctx.cwd);
      await logStateEvent(ctx.cwd, state, "Scaler status requested", { command: "scaler-status" });
      const message = `${formatStateStatus(state)} log=${getEventLogPath(ctx.cwd)}`;

      if (ctx.hasUI) {
        ctx.ui.notify(message, "info");
      } else {
        console.log(message);
      }
    },
  });
}

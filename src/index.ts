import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createLogEvent, appendLogEvent, logStateEvent } from "./logging.js";
import { getEventLogPath } from "./paths.js";
import { assessToolCallSafety } from "./safety.js";
import { ensureState, formatStateStatus } from "./state.js";
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

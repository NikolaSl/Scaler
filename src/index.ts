import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { logStateEvent } from "./logging.js";
import { getEventLogPath } from "./paths.js";
import { ensureState, formatStateStatus } from "./state.js";

export default function scalerExtension(pi: ExtensionAPI): void {
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

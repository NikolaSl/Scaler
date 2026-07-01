import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ensureState, formatStateStatus } from "./state.js";

export default function scalerExtension(pi: ExtensionAPI): void {
  pi.registerCommand("scaler-status", {
    description: "Show SCALER supervisor status.",
    handler: async (_args, ctx) => {
      const state = await ensureState(ctx.cwd);
      const message = formatStateStatus(state);

      if (ctx.hasUI) {
        ctx.ui.notify(message, "info");
      } else {
        console.log(message);
      }
    },
  });
}

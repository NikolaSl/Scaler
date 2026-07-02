import { appendLogEvent, createLogEvent } from "./logging.js";
import { appendReplanRequest, type ReplanRequest, type ReplanRequestInput } from "./plans.js";
import { saveState } from "./state.js";
import { transitionStage } from "./supervisor.js";
import type { ScalerState } from "./types.js";

export interface RequestReplanResult {
  state: ScalerState;
  request: ReplanRequest;
  transitioned: boolean;
  message: string;
}

export async function requestReplan(
  cwd: string,
  state: ScalerState,
  input: ReplanRequestInput,
  now = new Date(),
): Promise<RequestReplanResult> {
  const request = await appendReplanRequest(cwd, input, now);
  const beforeRejected = state.rejectedTransitions.length;
  const nextState = transitionStage(state, "replanning", { reason: input.reason, now });
  const transitioned = nextState.rejectedTransitions.length === beforeRejected;
  await saveState(cwd, nextState);
  const message = `Replan request created: ${request.id}${transitioned ? " stage=replanning" : " stage_unchanged"}`;
  await appendLogEvent(
    cwd,
    createLogEvent(nextState, {
      eventType: "state",
      summary: message,
      taskId: input.taskId,
      details: { request, transitioned },
    }),
  );
  return { state: nextState, request, transitioned, message };
}

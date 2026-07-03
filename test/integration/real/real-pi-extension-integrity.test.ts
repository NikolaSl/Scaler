import assert from "node:assert/strict";
import { test } from "node:test";
import { readLogEvents } from "../../../src/logging.js";
import { loadState } from "../../../src/state.js";
import { REAL_PI_ENABLED, runScalerPi, withRealPiTempRepo } from "./real-pi-harness.js";

test("real Pi extension: slash command dispatch writes SCALER command audit logs", { skip: !REAL_PI_ENABLED }, async () => {
  await withRealPiTempRepo(async (dir) => {
    const result = await runScalerPi({
      cwd: dir,
      prompt: "/scaler-lock",
    });

    assert.equal(result.exitCode, 0, result.stderr || result.stdout);
    assert.match(`${result.stdout}\n${result.stderr}`, /No execution lock\./);
    assert.ok(result.events.some((event) => isRecord(event) && event.type === "session"), "expected Pi JSON session event");

    const state = await loadState(dir);
    assert.equal(state.stage, "idle");

    const events = await readLogEvents(dir);
    const commandEvents = events.filter((event) => event.eventType === "command" && isRecord(event.details) && event.details.command === "scaler-lock");
    assert.deepEqual(commandEvents.map((event) => (event.details as { phase: string }).phase), ["start", "end"]);
    assert.equal(commandEvents.every((event) => Boolean(event.detailsPath)), true);
    assert.match(commandEvents[0]?.summary ?? "", /Command start: scaler-lock/);
    assert.match(commandEvents[1]?.summary ?? "", /Command end: scaler-lock/);
  });
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

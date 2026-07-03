import assert from "node:assert/strict";
import { test } from "node:test";
import scalerExtension from "../src/index.js";

test("extension factory exports a function", () => {
  assert.equal(typeof scalerExtension, "function");
});

test("extension registers scaler commands", () => {
  const commands: string[] = [];
  const fakePi = {
    on() {},
    registerTool() {},
    registerCommand(name: string) {
      commands.push(name);
    },
  };

  scalerExtension(fakePi as never);

  assert.deepEqual(commands, [
    "scaler",
    "scaler-lock",
    "scaler-lock-clear",
    "scaler-runs",
    "scaler-tasks",
    "scaler-context-init",
    "scaler-context-status",
    "scaler-stage-status",
    "scaler-stage-validate",
    "scaler-stage-advance",
    "scaler-stage-step",
    "scaler-stage-loop",
    "scaler-stage-run",
    "scaler-stage-runs",
    "scaler-stage-record",
    "scaler-task-create",
    "scaler-task-update",
    "scaler-prd-status",
    "scaler-plan-status",
    "scaler-plan-apply",
    "scaler-replans",
    "scaler-replan-run",
    "scaler-replan-runs",
    "scaler-replan-proposal-status",
    "scaler-replan-accept",
    "scaler-replan-request",
    "scaler-prd-link",
    "scaler-task-retry",
    "scaler-step",
    "scaler-validation-add",
    "scaler-commit",
    "scaler-validate",
    "scaler-pause",
    "scaler-resume",
    "scaler-status",
  ]);
});

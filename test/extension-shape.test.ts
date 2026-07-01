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
    "scaler-task-create",
    "scaler-step",
    "scaler-validate",
    "scaler-pause",
    "scaler-resume",
    "scaler-status",
  ]);
});

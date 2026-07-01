import assert from "node:assert/strict";
import { test } from "node:test";
import { scalerToolNames, registerScalerTools } from "../src/tools.js";

test("scalerToolNames lists structured Scaler tools", () => {
  assert.deepEqual([...scalerToolNames], [
    "scaler_report",
    "scaler_memory_write",
    "scaler_memory_retrieve",
    "scaler_spawn_task",
    "scaler_tool_request",
    "scaler_task_create",
    "scaler_task_update",
    "scaler_validation_manifest_write",
    "scaler_validation_report",
    "scaler_debug_attempt",
  ]);
});

test("registerScalerTools registers all tool definitions", () => {
  const registered: string[] = [];
  const fakePi = {
    registerTool(definition: { name: string }) {
      registered.push(definition.name);
    },
  };

  registerScalerTools(fakePi as never);

  assert.deepEqual(registered, [...scalerToolNames]);
});

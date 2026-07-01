import assert from "node:assert/strict";
import { test } from "node:test";
import { estimateTokens, resolveContext } from "../src/context.js";
import { createDefaultState } from "../src/state.js";

test("estimateTokens returns rough character based estimate", () => {
  assert.equal(estimateTokens("12345678"), 2);
});

test("resolveContext includes required items even over budget", () => {
  const state = createDefaultState();
  const result = resolveContext({
    state,
    tokenBudget: 1,
    items: [
      {
        id: "REQ-1",
        type: "prd",
        reason: "Needed for task",
        content: "Important requirement",
        priority: "required",
        scope: "summary",
        estimatedTokens: 100,
      },
    ],
  });

  assert.equal(result.included.length, 1);
  assert.equal(result.omitted.length, 0);
  assert.match(result.text, /Important requirement/);
});

test("resolveContext omits optional items over budget", () => {
  const state = createDefaultState();
  const result = resolveContext({
    state,
    tokenBudget: 20,
    items: [
      {
        id: "REQ-1",
        type: "prd",
        reason: "Required",
        content: "Required item",
        priority: "required",
        scope: "summary",
        estimatedTokens: 1,
      },
      {
        id: "OPT-1",
        type: "memory",
        reason: "Optional",
        content: "Optional item",
        priority: "optional",
        scope: "summary",
        estimatedTokens: 1_000,
      },
    ],
  });

  assert.deepEqual(result.included.map((item) => item.id), ["REQ-1"]);
  assert.deepEqual(result.omitted.map((item) => item.id), ["OPT-1"]);
});

test("resolveContext orders by priority", () => {
  const state = createDefaultState();
  const result = resolveContext({
    state,
    items: [
      { id: "O", type: "memory", reason: "o", content: "optional", priority: "optional", scope: "summary" },
      { id: "R", type: "prd", reason: "r", content: "required", priority: "required", scope: "summary" },
      { id: "U", type: "knowledge", reason: "u", content: "useful", priority: "useful", scope: "summary" },
    ],
  });

  assert.deepEqual(result.included.map((item) => item.id), ["R", "U", "O"]);
});

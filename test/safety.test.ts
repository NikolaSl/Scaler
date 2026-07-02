import assert from "node:assert/strict";
import { test } from "node:test";
import { assessToolCallSafety, shouldBlockWithoutApproval } from "../src/safety.js";

test("allows low-risk read tool call", () => {
  const decision = assessToolCallSafety({ toolName: "read", input: { path: "src/index.ts" } });

  assert.equal(decision.allowed, true);
  assert.equal(decision.risk, "low");
});

test("blocks write to .env", () => {
  const decision = assessToolCallSafety({ toolName: "write", input: { path: ".env" } });

  assert.equal(decision.allowed, false);
  assert.equal(decision.risk, "secret");
  assert.equal(shouldBlockWithoutApproval(decision), true);
});

test("blocks edit using file_path alias to protected key", () => {
  const decision = assessToolCallSafety({ toolName: "edit", input: { file_path: "certs/prod.key" } });

  assert.equal(decision.allowed, false);
  assert.equal(decision.risk, "secret");
});

test("blocks bash command that reads protected path", () => {
  const decision = assessToolCallSafety({ toolName: "bash", input: { command: "cat .env" } });

  assert.equal(decision.allowed, false);
  assert.equal(decision.risk, "secret");
});

test("blocks bash command that references protected nested path", () => {
  const decision = assessToolCallSafety({ toolName: "bash", input: { command: "grep secret .ssh/config" } });

  assert.equal(decision.allowed, false);
  assert.equal(decision.risk, "secret");
});

test("blocks destructive rm command", () => {
  const decision = assessToolCallSafety({ toolName: "bash", input: { command: "rm -rf build" } });

  assert.equal(decision.allowed, false);
  assert.equal(decision.risk, "destructive");
});

test("blocks git reset hard", () => {
  const decision = assessToolCallSafety({ toolName: "bash", input: { command: "git reset --hard HEAD" } });

  assert.equal(decision.allowed, false);
  assert.equal(decision.risk, "destructive");
});

test("allows ordinary test command", () => {
  const decision = assessToolCallSafety({ toolName: "bash", input: { command: "npm test" } });

  assert.equal(decision.allowed, true);
});

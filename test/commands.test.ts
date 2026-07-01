import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCommaList, parseCommitArgs, parseTaskCreateArgs, resolveCommitAllowedPaths, selectTaskForCommit } from "../src/commands.js";
import { createDefaultState } from "../src/state.js";

test("parseTaskCreateArgs parses task id only", () => {
  assert.deepEqual(parseTaskCreateArgs("T-001"), { taskId: "T-001", title: undefined, allowedPathPrefixes: undefined });
});

test("parseTaskCreateArgs parses title and allowed paths", () => {
  assert.deepEqual(parseTaskCreateArgs("T-001 | Add parser | src, test"), {
    taskId: "T-001",
    title: "Add parser",
    allowedPathPrefixes: ["src", "test"],
  });
});

test("parseTaskCreateArgs returns undefined without task id", () => {
  assert.equal(parseTaskCreateArgs("  "), undefined);
});

test("parseCommaList removes blanks", () => {
  assert.deepEqual(parseCommaList("src, , test "), ["src", "test"]);
});

test("parseCommitArgs parses optional task and paths", () => {
  assert.deepEqual(parseCommitArgs("T-001 | src,test"), { taskId: "T-001", allowedPathPrefixes: ["src", "test"] });
  assert.deepEqual(parseCommitArgs(""), { taskId: undefined, allowedPathPrefixes: undefined });
});

test("selectTaskForCommit prefers requested, current validated, then first validated", () => {
  const state = createDefaultState();
  state.currentTaskId = "T-002";
  state.tasks = [
    { id: "T-001", status: "validated", updatedAt: state.createdAt },
    { id: "T-002", status: "validated", updatedAt: state.createdAt },
  ];

  assert.equal(selectTaskForCommit(state, "T-999"), "T-999");
  assert.equal(selectTaskForCommit(state), "T-002");
  state.currentTaskId = null;
  assert.equal(selectTaskForCommit(state), "T-001");
});

test("resolveCommitAllowedPaths prefers explicit paths over task paths", () => {
  const state = createDefaultState();
  state.tasks = [{ id: "T-001", status: "validated", allowedPathPrefixes: ["src"], updatedAt: state.createdAt }];

  assert.deepEqual(resolveCommitAllowedPaths(state, "T-001", ["test"]), ["test"]);
  assert.deepEqual(resolveCommitAllowedPaths(state, "T-001"), ["src"]);
  assert.deepEqual(resolveCommitAllowedPaths(state, "missing"), []);
});

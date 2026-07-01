import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseCommaList,
  parseCommitArgs,
  parseTaskCreateArgs,
  parseTaskUpdateArgs,
  parseValidationAddArgs,
  resolveCommitAllowedPaths,
  selectTaskForCommit,
} from "../src/commands.js";
import { createDefaultState } from "../src/state.js";

test("parseTaskCreateArgs parses task id only", () => {
  assert.deepEqual(parseTaskCreateArgs("T-001"), {
    taskId: "T-001",
    title: undefined,
    allowedPathPrefixes: undefined,
    dependsOn: undefined,
  });
});

test("parseTaskCreateArgs parses title, allowed paths, and dependencies", () => {
  assert.deepEqual(parseTaskCreateArgs("T-001 | Add parser | src, test | T-000, T-BASE"), {
    taskId: "T-001",
    title: "Add parser",
    allowedPathPrefixes: ["src", "test"],
    dependsOn: ["T-000", "T-BASE"],
  });
});

test("parseTaskUpdateArgs parses task update fields", () => {
  assert.deepEqual(parseTaskUpdateArgs("T-001 | New title | ready | src,test | T-000"), {
    taskId: "T-001",
    title: "New title",
    status: "ready",
    allowedPathPrefixes: ["src", "test"],
    dependsOn: ["T-000"],
  });
});

test("parseValidationAddArgs parses manifest command fields", () => {
  assert.deepEqual(parseValidationAddArgs("T-001 | test | npm test | Run tests | optional"), {
    taskId: "T-001",
    id: "test",
    command: "npm test",
    description: "Run tests",
    required: false,
  });
});

test("parseValidationAddArgs requires task, id, and command", () => {
  assert.equal(parseValidationAddArgs("T-001 | test"), undefined);
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

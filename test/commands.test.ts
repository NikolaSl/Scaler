import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCommaList, parseTaskCreateArgs } from "../src/commands.js";

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

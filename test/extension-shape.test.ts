import assert from "node:assert/strict";
import { test } from "node:test";
import scalerExtension from "../src/index.js";

test("extension factory exports a function", () => {
  assert.equal(typeof scalerExtension, "function");
});

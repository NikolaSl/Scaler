/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  classifyDefaultScriptGate,
  createDefaultValidationManifest,
  evaluateValidationManifestPolicy,
  getValidationManifestForTask,
  loadValidationManifests,
  normalizeValidationEnvironmentKind,
  normalizeValidationGateDisposition,
  normalizeValidationGateKind,
  saveValidationManifest,
  upsertValidationManifestCommand,
} from "../src/validation.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-validation-manifest-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("loadValidationManifests returns empty list when missing", async () => {
  await withTempDir(async (dir) => {
    assert.deepEqual(await loadValidationManifests(dir), []);
  });
});

test("saveValidationManifest writes and replaces per-task manifest", async () => {
  await withTempDir(async (dir) => {
    await saveValidationManifest(dir, {
      taskId: "T-001",
      commands: [{ id: "test", command: "npm test", required: true }],
      createdAt: "",
      updatedAt: "",
    });
    await saveValidationManifest(dir, {
      taskId: "T-001",
      commands: [{ id: "build", command: "npm run build", required: true }],
      createdAt: "",
      updatedAt: "",
    });

    const manifests = await loadValidationManifests(dir);
    assert.equal(manifests.length, 1);
    assert.equal(manifests[0]?.commands[0]?.command, "npm run build");
  });
});

test("saveValidationManifest identifies a malformed persisted policy entry", async () => {
  await withTempDir(async (dir) => {
    await saveValidationManifest(dir, {
      taskId: "T-CORRUPT",
      commands: [],
      createdAt: "",
      updatedAt: "",
    });
    await writeFile(join(dir, ".scaler", "reports", "validation-manifests.json"), `${JSON.stringify({
      version: 1,
      manifests: [{ taskId: "T-CORRUPT", createdAt: "", updatedAt: "" }],
    })}\n`, "utf8");

    await assert.rejects(
      saveValidationManifest(dir, {
        taskId: "T-CORRUPT",
        commands: [],
        createdAt: "",
        updatedAt: "",
      }),
      /Persisted validation manifest for T-CORRUPT is malformed: commands must be an array/,
    );
  });
});

test("normalizeValidationGateKind maps common software and non-software aliases", () => {
  assert.equal(normalizeValidationGateKind("unit"), "unit_tests");
  assert.equal(normalizeValidationGateKind("build-compile"), "build_compile");
  assert.equal(normalizeValidationGateKind("adversarial review"), "adversarial_review");
  assert.equal(normalizeValidationGateKind("unknown-special-gate"), "custom");
  assert.equal(normalizeValidationGateKind(" "), undefined);
});

test("normalizeValidationEnvironmentKind maps sandbox environment aliases", () => {
  assert.equal(normalizeValidationEnvironmentKind("native"), "host");
  assert.equal(normalizeValidationEnvironmentKind("docker-compose"), "compose");
  assert.equal(normalizeValidationEnvironmentKind("dev container"), "devcontainer");
  assert.equal(normalizeValidationEnvironmentKind("sandbox"), "local_ci");
  assert.equal(normalizeValidationEnvironmentKind("unknown-env"), undefined);
});

test("normalizeValidationGateDisposition maps skip and block aliases", () => {
  assert.equal(normalizeValidationGateDisposition("run"), "run");
  assert.equal(normalizeValidationGateDisposition("skip"), "skipped");
  assert.equal(normalizeValidationGateDisposition("n/a"), "skipped");
  assert.equal(normalizeValidationGateDisposition("blocked"), "blocked");
  assert.equal(normalizeValidationGateDisposition("unknown"), undefined);
});

test("upsertValidationManifestCommand appends and replaces commands with gate metadata", async () => {
  await withTempDir(async (dir) => {
    await upsertValidationManifestCommand(dir, {
      taskId: "T-001",
      id: "test",
      command: "npm test",
      description: "Run tests",
      required: true,
      gate: "unit",
      expectedResult: "Jest exits 0",
      evidenceRefs: ["plan:test-first", "plan:test-first"],
    });
    await upsertValidationManifestCommand(dir, {
      taskId: "T-001",
      id: "test",
      command: "npm test -- --runInBand",
      required: false,
    });

    const manifests = await loadValidationManifests(dir);
    assert.equal(manifests.length, 1);
    assert.equal(manifests[0]?.commands.length, 1);
    assert.equal(manifests[0]?.commands[0]?.command, "npm test -- --runInBand");
    assert.equal(manifests[0]?.commands[0]?.required, false);
    assert.equal(manifests[0]?.commands[0]?.gate, undefined);
  });
});

test("saveValidationManifest normalizes gate metadata", async () => {
  await withTempDir(async (dir) => {
    await saveValidationManifest(dir, {
      taskId: "T-001",
      commands: [{
        id: "review",
        command: "node review.js",
        required: true,
        gate: "source validation",
        expectedResult: "review evidence exists",
        evidenceRefs: ["doc:one", "doc:one", "doc:two"],
        environment: "docker-compose",
        disposition: "skip",
        dispositionReason: "covered by source review",
      }],
      createdAt: "",
      updatedAt: "",
    });

    const command = (await loadValidationManifests(dir))[0]?.commands[0];
    assert.equal(command?.gate, "source_validation");
    assert.equal(command?.expectedResult, "review evidence exists");
    assert.deepEqual(command?.evidenceRefs, ["doc:one", "doc:two"]);
    assert.equal(command?.environment, "compose");
    assert.equal(command?.disposition, "skipped");
    assert.equal(command?.dispositionReason, "covered by source review");
  });
});

test("evaluateValidationManifestPolicy passes policy gates before implementation gates", () => {
  const policy = evaluateValidationManifestPolicy({
    taskId: "T-001",
    createdAt: "",
    updatedAt: "",
    commands: [
      { id: "deps", command: "node deps.js", required: true, gate: "dependency_check" },
      { id: "test-first", command: "node test-first.js", required: true, gate: "test_first" },
      { id: "unit", command: "npm test", required: true, gate: "unit_tests" },
    ],
  });

  assert.equal(policy.status, "passed");
  assert.deepEqual(policy.diagnostics, []);
});

test("evaluateValidationManifestPolicy fails required dependency and test-first gates after implementation gates", () => {
  const policy = evaluateValidationManifestPolicy({
    taskId: "T-001",
    createdAt: "",
    updatedAt: "",
    commands: [
      { id: "unit", command: "npm test", required: true, gate: "unit_tests" },
      { id: "deps", command: "node deps.js", required: true, gate: "dependency_check" },
      { id: "test-first", command: "node test-first.js", required: true, gate: "test_first" },
    ],
  });

  assert.equal(policy.status, "failed");
  assert.deepEqual(policy.diagnostics.map((diagnostic) => diagnostic.code), ["dependency_check_order", "test_first_order"]);
});

test("evaluateValidationManifestPolicy accepts required skipped gates with reasons", () => {
  const policy = evaluateValidationManifestPolicy({
    taskId: "T-001",
    createdAt: "",
    updatedAt: "",
    commands: [{ id: "integration", command: "npm run integration", required: true, gate: "integration_tests", disposition: "skipped", dispositionReason: "No integration surface changed." }],
  });

  assert.equal(policy.status, "passed");
  assert.equal(policy.diagnostics.some((diagnostic) => diagnostic.code === "required_skipped_gate_missing_reason"), false);
});

test("evaluateValidationManifestPolicy rejects required skipped gates without reasons", () => {
  const policy = evaluateValidationManifestPolicy({
    taskId: "T-001",
    createdAt: "",
    updatedAt: "",
    commands: [{ id: "integration", command: "npm run integration", required: true, gate: "integration_tests", disposition: "skipped" }],
  });

  assert.equal(policy.status, "failed");
  assert.equal(policy.diagnostics.some((diagnostic) => diagnostic.code === "required_skipped_gate_missing_reason"), true);
});

test("evaluateValidationManifestPolicy rejects blocked gates without reasons", () => {
  const policy = evaluateValidationManifestPolicy({
    taskId: "T-001",
    createdAt: "",
    updatedAt: "",
    commands: [{ id: "ci", command: "npm run ci", required: true, gate: "local_ci", disposition: "blocked" }],
  });

  assert.equal(policy.status, "failed");
  assert.equal(policy.diagnostics.some((diagnostic) => diagnostic.code === "blocked_gate_missing_reason"), true);
});

test("evaluateValidationManifestPolicy fails required local-ci gates without sandbox environment", () => {
  const policy = evaluateValidationManifestPolicy({
    taskId: "T-001",
    createdAt: "",
    updatedAt: "",
    commands: [{ id: "ci", command: "npm run ci", required: true, gate: "local_ci" }],
  });

  assert.equal(policy.status, "failed");
  assert.equal(policy.diagnostics.some((diagnostic) => diagnostic.code === "local_ci_requires_environment"), true);
});

test("evaluateValidationManifestPolicy fails docker tooling without environment metadata", () => {
  const policy = evaluateValidationManifestPolicy({
    taskId: "T-001",
    createdAt: "",
    updatedAt: "",
    commands: [{ id: "docker", command: "docker compose config", required: true, gate: "local_ci" }],
  });

  assert.equal(policy.status, "failed");
  assert.equal(policy.diagnostics.some((diagnostic) => diagnostic.code === "sandbox_environment_missing"), true);
});

test("evaluateValidationManifestPolicy passes declared local-ci sandbox environment", () => {
  const policy = evaluateValidationManifestPolicy({
    taskId: "T-001",
    createdAt: "",
    updatedAt: "",
    commands: [
      { id: "deps", command: "node deps.js", required: true, gate: "dependency_check" },
      { id: "test-first", command: "node test-first.js", required: true, gate: "test_first" },
      { id: "ci", command: "docker compose config", required: true, gate: "local_ci", environment: "compose" },
    ],
  });

  assert.equal(policy.status, "passed");
  assert.deepEqual(policy.diagnostics, []);
});

test("evaluateValidationManifestPolicy warns when implementation gates omit policy preflights", () => {
  const policy = evaluateValidationManifestPolicy({
    taskId: "T-001",
    createdAt: "",
    updatedAt: "",
    commands: [{ id: "build", command: "npm run build", required: true, gate: "build_compile" }],
  });

  assert.equal(policy.status, "passed");
  assert.deepEqual(policy.diagnostics.map((diagnostic) => diagnostic.code), ["missing_dependency_check", "missing_test_first"]);
});

test("createDefaultValidationManifest uses and classifies package scripts", async () => {
  await withTempDir(async (dir) => {
    await writeFile(join(dir, "package.json"), JSON.stringify({ scripts: { test: "node --test", build: "tsc", lint: "eslint .", "test:integration": "node integration.js", audit: "npm audit" } }), "utf8");

    const manifest = await createDefaultValidationManifest(dir, "T-001");

    assert.deepEqual(manifest.commands.map((command) => command.command), ["npm test", "npm run build", "npm run lint", "npm run test:integration", "npm run audit"]);
    assert.deepEqual(manifest.commands.map((command) => command.gate), ["unit_tests", "build_compile", "static_checks", "integration_tests", "security_checks"]);
    assert.equal(manifest.commands.every((command) => command.expectedResult === "Command exits with code 0."), true);
  });
});

test("classifyDefaultScriptGate returns deterministic categories", () => {
  assert.equal(classifyDefaultScriptGate("typecheck"), "static_checks");
  assert.equal(classifyDefaultScriptGate("smoke"), "acceptance_smoke");
  assert.equal(classifyDefaultScriptGate("custom-script"), "custom");
});

test("getValidationManifestForTask falls back to default project commands", async () => {
  await withTempDir(async (dir) => {
    await writeFile(join(dir, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }), "utf8");

    const manifest = await getValidationManifestForTask(dir, "T-002");

    assert.equal(manifest.taskId, "T-002");
    assert.deepEqual(manifest.commands.map((command) => command.id), ["npm-test"]);
  });
});

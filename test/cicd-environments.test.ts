/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  detectCicdStack,
  formatCicdEnvironmentRecords,
  loadCicdEnvironmentRecords,
  prepareCicdValidationExecution,
  provisionCicdEnvironment,
} from "../src/cicd-environments.js";
import { runValidationCommand } from "../src/validation.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-cicd-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("detectCicdStack finds project package scripts and existing container tooling", async () => {
  await withTempDir(async (dir) => {
    await writeFile(join(dir, "package.json"), JSON.stringify({ scripts: { build: "tsc", test: "node --test", smoke: "node smoke.js" } }), "utf8");
    await writeFile(join(dir, "package-lock.json"), "{}\n", "utf8");
    await writeFile(join(dir, "Dockerfile"), "FROM node:22-bookworm-slim\n", "utf8");

    const detection = await detectCicdStack(dir);

    assert.equal(detection.stack, "node");
    assert.equal(detection.packageManager, "npm");
    assert.deepEqual(detection.defaultCommands, ["npm run build", "npm test", "npm run smoke"]);
    assert.equal(detection.existingTooling.includes("Dockerfile"), true);
  });
});

test("provisionCicdEnvironment plans deterministic Docker files and scanner limitation evidence", async () => {
  await withTempDir(async (dir) => {
    await writeFile(join(dir, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }), "utf8");
    await writeFile(join(dir, "package-lock.json"), "{}\n", "utf8");

    const record = await provisionCicdEnvironment(dir, {
      environment: "docker",
      taskId: "T-CI",
      commandId: "unit",
      validationCommand: "npm test",
    }, { execute: false, runScanners: true, now: new Date("2026-01-01T00:00:00.000Z") });

    assert.equal(record.status, "planned");
    assert.equal(record.environment, "docker");
    assert.deepEqual(record.validationCommands, ["npm test"]);
    assert.equal(record.generatedFiles.some((file) => file.path === ".scaler/cicd/Dockerfile.scaler" && file.action === "planned"), true);
    assert.equal(record.safetyChecks.some((check) => check.code === "network_policy" && check.status === "passed"), true);
    assert.ok(record.scannerRecordIds?.length, "expected scanner planning records");
    assert.match(formatCicdEnvironmentRecords([record]), /env=docker status=planned/);

    await assert.rejects(access(join(dir, ".scaler/cicd/Dockerfile.scaler")));
    assert.equal((await loadCicdEnvironmentRecords(dir))[0]?.id, record.id);
  });
});

test("provisionCicdEnvironment writes local-CI wrappers and blocks secret-like generated content", async () => {
  await withTempDir(async (dir) => {
    const generated = await provisionCicdEnvironment(dir, {
      environment: "local_ci",
      validationCommand: "node -e \"process.exit(0)\"",
    }, { execute: true, runScanners: false, now: new Date("2026-01-01T00:00:00.000Z") });

    assert.equal(generated.status, "generated");
    const wrapper = await readFile(join(dir, ".scaler/cicd/run-local-ci.sh"), "utf8");
    assert.match(wrapper, /AWS_SECRET_ACCESS_KEY/);
    assert.equal(generated.generatedFiles.some((file) => file.executable && file.action === "written"), true);

    const blocked = await provisionCicdEnvironment(dir, {
      environment: "local_ci",
      validationCommand: "TOKEN=1234567890 node -e \"process.exit(0)\"",
    }, { execute: true, runScanners: false, now: new Date("2026-01-01T00:00:01.000Z") });

    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.safetyChecks.some((check) => check.code === "no_production_credentials" && check.status === "blocked"), true);
  });
});

test("non-host validation runs through generated local-CI wrapper and records provision refs", async () => {
  await withTempDir(async (dir) => {
    const prepared = await prepareCicdValidationExecution(dir, {
      environment: "local_ci",
      taskId: "T-WRAP",
      commandId: "ci",
      command: "node -e \"process.exit(0)\"",
    }, { now: new Date("2026-01-01T00:00:00.000Z") });
    assert.match(prepared.executionCommand, /run-local-ci\.sh --/);

    const result = await runValidationCommand(dir, {
      id: "ci",
      command: "node -e \"require('node:fs').writeFileSync('wrapped.txt','ok')\"",
      required: true,
      gate: "local_ci",
      environment: "local_ci",
    }, { taskId: "T-WRAP" });

    assert.equal(result.status, "passed");
    assert.equal(result.environment, "local_ci");
    assert.ok(result.cicdProvisionRef);
    assert.match(result.executionCommand ?? "", /run-local-ci\.sh/);
    assert.deepEqual(result.artifactRefs, [".scaler/cicd/logs/", ".scaler/cicd/artifacts/", ".scaler/reports/cicd-environments.json"]);
    assert.equal(await readFile(join(dir, "wrapped.txt"), "utf8"), "ok");
  });
});

/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { applySafetyApproval, assessToolCallSafety, createSafetyApproval, discoverSafetyScanCandidates, formatSafetyPolicy, formatSafetyScanResult, isAllowedSandboxExceptionCommand, loadSafetyApprovals, loadSafetyPolicy, loadSafetyScanRecords, mergeSafetyPolicy, runSafetyScans, saveSafetyPolicy, shouldBlockWithoutApproval } from "../src/safety.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-safety-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

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

test("allows write inside explicit allowed path", () => {
  const decision = assessToolCallSafety(
    { toolName: "write", input: { path: "src/index.ts" } },
    { allowedPathPrefixes: ["src", "test"] },
  );

  assert.equal(decision.allowed, true);
});

test("blocks write outside explicit allowed path", () => {
  const decision = assessToolCallSafety(
    { toolName: "edit", input: { path: "docs/readme.md" } },
    { allowedPathPrefixes: ["src", "test"] },
  );

  assert.equal(decision.allowed, false);
  assert.equal(decision.risk, "medium");
});

test("allows write when no explicit allowed path policy exists", () => {
  const decision = assessToolCallSafety({ toolName: "write", input: { path: "docs/readme.md" } });

  assert.equal(decision.allowed, true);
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

test("blocks internet transfer commands unless policy allows internet", () => {
  const blocked = assessToolCallSafety({ toolName: "bash", input: { command: "curl https://example.invalid/docs" } });
  const allowed = assessToolCallSafety(
    { toolName: "bash", input: { command: "curl https://example.invalid/docs" } },
    { allowInternet: true },
  );

  assert.equal(blocked.allowed, false);
  assert.equal(blocked.risk, "external");
  assert.match(blocked.reason, /internet/);
  assert.equal(allowed.allowed, true);
});

test("blocks deploy publish and remote mutation commands unless policy allows external mutations", () => {
  const publish = assessToolCallSafety({ toolName: "bash", input: { command: "npm publish --dry-run" } });
  const gitPush = assessToolCallSafety({ toolName: "bash", input: { command: "git push origin main" } });
  const allowed = assessToolCallSafety(
    { toolName: "bash", input: { command: "npm publish --dry-run" } },
    { allowExternalMutations: true },
  );

  assert.equal(publish.allowed, false);
  assert.equal(publish.risk, "external");
  assert.equal(gitPush.allowed, false);
  assert.equal(gitPush.risk, "external");
  assert.equal(allowed.allowed, true);
});

test("force push remains destructive even when external mutations are allowed", () => {
  const decision = assessToolCallSafety(
    { toolName: "bash", input: { command: "git push --force origin main" } },
    { allowExternalMutations: true },
  );

  assert.equal(decision.allowed, false);
  assert.equal(decision.risk, "destructive");
});

test("blocks commands that expose common secret environment names", () => {
  const decision = assessToolCallSafety({ toolName: "bash", input: { command: "echo $OPENAI_API_KEY" } });

  assert.equal(decision.allowed, false);
  assert.equal(decision.risk, "secret");
});

test("allows contained sandbox destructive commands only when sandbox policy is enabled", () => {
  const command = "docker run --rm node:20 sh -lc 'rm -rf /tmp/scaler-work'";
  const blocked = assessToolCallSafety({ toolName: "bash", input: { command } });
  const allowed = assessToolCallSafety({ toolName: "bash", input: { command } }, { allowSandbox: true });

  assert.equal(isAllowedSandboxExceptionCommand(command), true);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.risk, "destructive");
  assert.equal(allowed.allowed, true);
  assert.match(allowed.reason, /Sandbox policy/);
});

test("rejects unsafe sandbox host mounts and privileged flags", () => {
  assert.equal(isAllowedSandboxExceptionCommand("docker run --rm -v /:/host node sh -lc 'rm -rf /host/tmp'"), false);
  assert.equal(isAllowedSandboxExceptionCommand("docker run --privileged node sh -lc 'rm -rf /tmp/work'"), false);

  const decision = assessToolCallSafety(
    { toolName: "bash", input: { command: "docker run --rm -v /:/host node sh -lc 'rm -rf /host/tmp'" } },
    { allowSandbox: true },
  );
  assert.equal(decision.allowed, false);
  assert.equal(decision.risk, "destructive");
});

test("safety approvals allow exact non-secret risky commands once", async () => {
  await withTempDir(async (dir) => {
    const command = "npm publish --dry-run";
    const decision = assessToolCallSafety({ toolName: "bash", input: { command } });
    assert.equal(decision.allowed, false);
    assert.equal(decision.risk, "external");

    const approval = await createSafetyApproval(dir, {
      toolName: "bash",
      match: "exact_command",
      value: command,
      risk: "external",
      reason: "Release dry-run approved.",
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    const first = await applySafetyApproval(dir, { toolName: "bash", input: { command } }, decision, { now: new Date("2026-01-01T00:01:00.000Z") });
    const second = await applySafetyApproval(dir, { toolName: "bash", input: { command } }, decision, { now: new Date("2026-01-01T00:02:00.000Z") });

    assert.equal(first.allowed, true);
    assert.equal(first.approval?.id, approval.id);
    assert.equal(first.approval?.status, "used");
    assert.equal(second.allowed, false);
    assert.equal((await loadSafetyApprovals(dir))[0]?.uses, 1);
  });
});

test("safety approvals do not override secret decisions", async () => {
  await withTempDir(async (dir) => {
    await createSafetyApproval(dir, {
      toolName: "bash",
      match: "exact_command",
      value: "cat .env",
      risk: "secret",
      reason: "Attempted secret approval.",
    });
    const decision = assessToolCallSafety({ toolName: "bash", input: { command: "cat .env" } });
    const result = await applySafetyApproval(dir, { toolName: "bash", input: { command: "cat .env" } }, decision);

    assert.equal(decision.risk, "secret");
    assert.equal(result.allowed, false);
    assert.match(result.reason, /not overridden/);
  });
});

test("allows ordinary test command", () => {
  const decision = assessToolCallSafety({ toolName: "bash", input: { command: "npm test" } });

  assert.equal(decision.allowed, true);
});

test("persisted safety policy round trips and merges with task policy", async () => {
  await withTempDir(async (dir) => {
    assert.equal((await loadSafetyPolicy(dir)).allowInternet, false);

    const saved = await saveSafetyPolicy(dir, {
      allowInternet: true,
      allowExternalMutations: true,
      allowSandbox: true,
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    assert.deepEqual(await loadSafetyPolicy(dir), saved);
    assert.deepEqual(mergeSafetyPolicy(saved, { allowedPathPrefixes: ["src"] }), {
      allowedPathPrefixes: ["src"],
      allowInternet: true,
      allowExternalMutations: true,
      allowSandbox: true,
    });
    assert.match(formatSafetyPolicy(saved), /allowInternet=true allowExternalMutations=true allowSandbox=true/);
  });
});

test("safety scan discovery records planned, unavailable, and executed scanner results", async () => {
  await withTempDir(async (dir) => {
    await writeFile(join(dir, "package-lock.json"), JSON.stringify({ lockfileVersion: 3 }), "utf8");

    const candidates = await discoverSafetyScanCandidates(dir);
    assert.deepEqual(candidates.map((candidate) => candidate.kind), ["npm_audit"]);

    const planned = await runSafetyScans(dir, {
      now: new Date("2026-01-01T00:00:00.000Z"),
      isCommandAvailable: async () => true,
    });
    assert.equal(planned.executed, false);
    assert.equal(planned.summary.planned, 1);
    assert.match(formatSafetyScanResult(planned), /planned npm_audit/);

    const unavailable = await runSafetyScans(dir, {
      execute: true,
      now: new Date("2026-01-01T00:01:00.000Z"),
      isCommandAvailable: async () => false,
    });
    assert.equal(unavailable.summary.unavailable, 1);

    const executed = await runSafetyScans(dir, {
      execute: true,
      now: new Date("2026-01-01T00:02:00.000Z"),
      isCommandAvailable: async () => true,
      commandRunner: async () => ({ exitCode: 0, stdout: "{}", stderr: "" }),
    });
    assert.equal(executed.summary.passed, 1);
    assert.equal((await loadSafetyScanRecords(dir)).length, 3);
  });
});

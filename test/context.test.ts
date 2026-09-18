/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import {
  approveContextCandidate,
  buildContextHookInjection,
  createDefaultTaskContextManifest,
  createDiscoveredTaskContextManifest,
  discoverSemanticContextCandidates,
  ensureTaskContextManifest,
  estimateTokens,
  formatContextCandidates,
  formatOmittedContextSummary,
  formatTaskContextManifest,
  loadTaskContextManifest,
  resolveContext,
  resolveTaskContextManifest,
  saveTaskContextManifest,
  validateTaskContextManifest,
} from "../src/context.js";
import { writeMemory } from "../src/memory.js";
import { saveExecutionPlan } from "../src/plans.js";
import { getValidationRunsPath } from "../src/paths.js";
import { upsertPrdRequirement } from "../src/prd.js";
import { createDefaultState } from "../src/state.js";
import { saveValidationManifest } from "../src/validation.js";

const execFileAsync = promisify(execFile);

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-context-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

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
  assert.match(result.text, /## Omitted Context/);
  assert.match(result.text, /OPT-1: Optional/);
});

test("resolveContext omits omitted section when nothing was omitted", () => {
  const state = createDefaultState();
  const result = resolveContext({
    state,
    items: [{ id: "REQ-1", type: "prd", reason: "Required", content: "Required item", priority: "required", scope: "summary" }],
  });

  assert.doesNotMatch(result.text, /## Omitted Context/);
});

test("formatOmittedContextSummary renders ids and reasons", () => {
  const summary = formatOmittedContextSummary([
    { id: "OPT-1", type: "memory", reason: "Too large", content: "x", priority: "optional", scope: "summary" },
  ]);

  assert.match(summary, /OPT-1: Too large \(memory, optional, summary, exactness=summary-ok\)/);
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

test("createDefaultTaskContextManifest includes state, task, validation, prd refs, and memory refs", () => {
  const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
  state.memoryRefs = ["mem-1"];
  state.tasks = [{ id: "T-001", status: "ready", prdRefs: ["REQ-001"], updatedAt: state.createdAt }];

  const manifest = createDefaultTaskContextManifest(state, "T-001", new Date("2026-01-01T00:00:01.000Z"));

  assert.equal(manifest.taskId, "T-001");
  assert.deepEqual(manifest.items.map((item) => item.id), ["state-summary", "task-metadata", "validation-manifest", "runtime-prd-refs", "memory-mem-1"]);
  assert.match(formatTaskContextManifest(manifest), /Task context manifest: T-001 items=5/);
});

test("createDiscoveredTaskContextManifest adds ranked evidence from changed files, plan, PRD, validation, and memory", async () => {
  await withTempDir(async (dir) => {
    await execFileAsync("git", ["init"], { cwd: dir });
    await mkdir(join(dir, "src"));
    await writeFile(join(dir, "src", "feature.ts"), "export const feature = true;\n", "utf8");
    await execFileAsync("git", ["add", "-N", "src/feature.ts"], { cwd: dir });

    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    state.tasks = [{
      id: "T-001",
      status: "ready",
      title: "Implement feature context",
      allowedPathPrefixes: ["src"],
      prdRefs: ["REQ-001"],
      updatedAt: state.createdAt,
    }];
    await saveExecutionPlan(dir, {
      version: 1,
      planVersion: 7,
      status: "active",
      tasks: [{ id: "T-001", title: "Implement feature context", prdRefs: ["REQ-001"], allowedPathPrefixes: ["src"] }],
      createdAt: state.createdAt,
      updatedAt: state.createdAt,
    });
    await upsertPrdRequirement(dir, {
      id: "REQ-001",
      statement: "Feature context must be deterministic.",
      status: "in_progress",
      taskIds: ["T-001"],
      now: new Date("2026-01-01T00:00:01.000Z"),
    });
    await mkdir(join(dir, ".scaler", "reports"), { recursive: true });
    await writeFile(getValidationRunsPath(dir), JSON.stringify({
      version: 1,
      runs: [{
        id: "RUN-001",
        taskId: "T-001",
        status: "failed",
        commandRuns: [{
          id: "cmd-1",
          commandId: "npm-test",
          command: "npm test",
          status: "failed",
          exitCode: 1,
          stdoutSummary: "",
          stderrSummary: "feature failure",
          startedAt: state.createdAt,
          finishedAt: state.createdAt,
        }],
        createdAt: "2026-01-01T00:00:02.000Z",
      }],
    }), "utf8");
    const memory = await writeMemory(dir, {
      title: "Feature context discovery note",
      content: "Relevant feature context memory",
      taskId: "T-001",
      now: new Date("2026-01-01T00:00:03.000Z"),
    });

    const manifest = await createDiscoveredTaskContextManifest(dir, state, "T-001", new Date("2026-01-01T00:00:04.000Z"));
    const ids = manifest.items.map((item) => item.id);

    assert.ok(ids.includes("git-changed-files"));
    assert.ok(ids.includes("changed-file-feature-ts"));
    assert.ok(ids.includes("execution-plan-task"));
    assert.ok(ids.includes("runtime-prd-coverage"));
    assert.ok(ids.includes("validation-history"));
    assert.ok(ids.includes(`memory-search-${memory.id}`));
      assert.equal(manifest.items.find((item) => item.id === "changed-file-feature-ts")?.priority, "useful");
    assert.equal(manifest.items.find((item) => item.id === "changed-file-feature-ts")?.exactness, "exact");
    assert.equal(manifest.items.find((item) => item.id === `memory-search-${memory.id}`)?.priority, "useful");
    assert.equal(manifest.items.find((item) => item.id === `memory-search-${memory.id}`)?.exactness, "summary-ok");
  });
});

test("saveTaskContextManifest and loadTaskContextManifest round trip normalized manifest", async () => {
  await withTempDir(async (dir) => {
    const saved = await saveTaskContextManifest(dir, {
      version: 1,
      taskId: "T-001",
      items: [
        { id: " file ", type: "file", reason: " Need file ", priority: "required", scope: "full", source: "file", path: " README.md " },
      ],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }, new Date("2026-01-01T00:00:01.000Z"));

    const loaded = await loadTaskContextManifest(dir, "T-001");
    assert.equal(saved.items[0]?.id, "file");
    assert.equal(saved.items[0]?.reason, "Need file");
    assert.equal(saved.items[0]?.path, "README.md");
    assert.equal(saved.items[0]?.exactness, "exact");
    assert.equal(loaded?.items[0]?.id, saved.items[0]?.id);
    assert.equal(loaded?.items[0]?.reason, saved.items[0]?.reason);
    assert.equal(loaded?.items[0]?.path, saved.items[0]?.path);
  });
});

test("task context manifest rejects a non-finite persisted token budget", async () => {
  await withTempDir(async (dir) => {
    const manifest = createDefaultTaskContextManifest(createDefaultState(), "T-001");
    await assert.rejects(
      saveTaskContextManifest(dir, { ...manifest, tokenBudget: Number.POSITIVE_INFINITY }),
      /positive finite integer/i,
    );
  });
});

test("ensureTaskContextManifest creates discovered manifest when missing", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState();
    state.tasks = [{ id: "T-001", status: "ready", title: "Plan-backed task", updatedAt: state.createdAt }];
    await saveExecutionPlan(dir, {
      version: 1,
      planVersion: 1,
      status: "active",
      tasks: [{ id: "T-001", title: "Plan-backed task" }],
      createdAt: state.createdAt,
      updatedAt: state.createdAt,
    });

    const manifest = await ensureTaskContextManifest(dir, state, "T-001");
    assert.equal(manifest.taskId, "T-001");
    assert.ok(manifest.items.some((item) => item.id === "execution-plan-task"));
    assert.equal((await loadTaskContextManifest(dir, "T-001"))?.taskId, "T-001");
  });
});

test("discoverSemanticContextCandidates scores memory and allowed file candidates for manual approval", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, "src"));
    await writeFile(join(dir, "src", "context-hook.ts"), "export const semanticContextHook = true;\n", "utf8");
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    state.tasks = [{
      id: "T-SEM",
      status: "ready",
      title: "Implement semantic context hook",
      allowedPathPrefixes: ["src"],
      prdRefs: ["REQ-CONTEXT"],
      updatedAt: state.createdAt,
    }];
    const memory = await writeMemory(dir, {
      title: "Semantic context hook note",
      content: "Approved summaries keep hook injection focused.",
      taskId: "T-SEM",
      tags: ["context", "hook"],
      now: new Date("2026-01-01T00:00:01.000Z"),
    });

    const candidates = await discoverSemanticContextCandidates(dir, state, "T-SEM", { query: "semantic hook", limit: 8 });
    const ids = candidates.map((candidate) => candidate.id);

    assert.ok(ids.includes(`candidate-memory-${memory.id}`));
    assert.ok(ids.includes("candidate-file-context-hook-ts"));
    assert.ok(ids.includes("candidate-prd-req-context"));
    assert.match(formatContextCandidates(candidates), /Context candidates:/);
  });
});

test("approveContextCandidate persists selected candidates without duplicating manifest entries", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    state.tasks = [{ id: "T-APPROVE", status: "ready", title: "Approve context", updatedAt: state.createdAt }];
    const memory = await writeMemory(dir, {
      title: "Approve context memory",
      content: "Candidate approval should add one manifest item.",
      taskId: "T-APPROVE",
      now: new Date("2026-01-01T00:00:01.000Z"),
    });
    await saveTaskContextManifest(dir, {
      version: 1,
      taskId: "T-APPROVE",
      items: [{ id: "task", type: "task_report", reason: "Task", priority: "required", scope: "summary", source: "task" }],
      createdAt: state.createdAt,
      updatedAt: state.createdAt,
    });

    const first = await approveContextCandidate(dir, state, "T-APPROVE", `candidate-memory-${memory.id}`);
    const second = await approveContextCandidate(dir, state, "T-APPROVE", `candidate-memory-${memory.id}`);

    assert.equal(first.added, true);
    assert.equal(second.added, false);
    const manifest = await loadTaskContextManifest(dir, "T-APPROVE");
    assert.equal(manifest?.items.filter((item) => item.memoryId === memory.id).length, 1);
  });
});

test("buildContextHookInjection injects only approved compact manifest items", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    state.currentTaskId = "T-HOOK";
    state.tasks = [{ id: "T-HOOK", status: "running", title: "Use context hook", updatedAt: state.createdAt }];
    await writeFile(join(dir, "large.txt"), "FULL FILE SHOULD NOT ENTER HOOK\n", "utf8");
    await saveTaskContextManifest(dir, {
      version: 1,
      taskId: "T-HOOK",
      items: [
        { id: "approved-summary", type: "decision", reason: "Approved compact summary", priority: "required", scope: "summary", source: "inline", content: "APPROVED SUMMARY TOKEN" },
        { id: "full-file", type: "file", reason: "Full file is not compact", priority: "required", scope: "full", source: "file", path: "large.txt" },
        { id: "optional-summary", type: "decision", reason: "Optional item remains pull-based", priority: "optional", scope: "summary", source: "inline", content: "OPTIONAL TOKEN" },
      ],
      createdAt: state.createdAt,
      updatedAt: state.createdAt,
    });

    const injection = await buildContextHookInjection(dir, state, undefined, 800);

    assert.match(injection ?? "", /SCALER Selected Context Injection/);
    assert.match(injection ?? "", /APPROVED SUMMARY TOKEN/);
    assert.doesNotMatch(injection ?? "", /FULL FILE SHOULD NOT ENTER HOOK/);
    assert.doesNotMatch(injection ?? "", /OPTIONAL TOKEN/);
  });
});

test("resolveTaskContextManifest resolves inline, file, memory, state, task, prd, and validation sources", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    state.tasks = [{ id: "T-001", status: "ready", title: "Do task", prdRefs: ["REQ-001"], updatedAt: state.createdAt }];
    await writeFile(join(dir, "README.md"), "File context", "utf8");
    const memory = await writeMemory(dir, { title: "Prior note", content: "Memory context FULL ONLY TOKEN", summary: "Memory summary", now: new Date("2026-01-01T00:00:01.000Z") });
    await saveValidationManifest(dir, {
      taskId: "T-001",
      commands: [{ id: "test", command: "npm test", required: true }],
      createdAt: "",
      updatedAt: "",
    });

    const items = await resolveTaskContextManifest(dir, state, {
      version: 1,
      taskId: "T-001",
      items: [
        { id: "inline", type: "decision", reason: "Inline", priority: "required", scope: "summary", source: "inline", content: "Inline context" },
        { id: "file", type: "file", reason: "File", priority: "required", scope: "full", source: "file", path: "README.md" },
        { id: "memory", type: "memory", reason: "Memory", priority: "useful", scope: "summary", source: "memory", memoryId: memory.id },
        { id: "state", type: "decision", reason: "State", priority: "required", scope: "summary", source: "state" },
        { id: "task", type: "task_report", reason: "Task", priority: "required", scope: "summary", source: "task" },
        { id: "prd", type: "prd", reason: "PRD", priority: "useful", scope: "reference-only", source: "prd_refs" },
        { id: "validation", type: "validation", reason: "Validation", priority: "useful", scope: "summary", source: "validation_manifest" },
      ],
      createdAt: state.createdAt,
      updatedAt: state.createdAt,
    });

    assert.match(items.find((item) => item.id === "inline")?.content ?? "", /Inline context/);
    assert.match(items.find((item) => item.id === "file")?.content ?? "", /File context/);
    assert.match(items.find((item) => item.id === "memory")?.content ?? "", /Memory summary/);
    assert.doesNotMatch(items.find((item) => item.id === "memory")?.content ?? "", /FULL ONLY TOKEN/);
    assert.match(items.find((item) => item.id === "state")?.content ?? "", /"stage": "idle"/);
    assert.match(items.find((item) => item.id === "task")?.content ?? "", /"title": "Do task"/);
    assert.match(items.find((item) => item.id === "prd")?.content ?? "", /REQ-001/);
    assert.match(items.find((item) => item.id === "validation")?.content ?? "", /npm test/);
    assert.equal(items.find((item) => item.id === "file")?.exactness, "exact");
    assert.equal(items.find((item) => item.id === "prd")?.exactness, "reference-only");
  });
});

test("resolveTaskContextManifest preserves missing source entries as missing context", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState();
    const items = await resolveTaskContextManifest(dir, state, {
      version: 1,
      taskId: "T-404",
      items: [{ id: "task", type: "task_report", reason: "Task", priority: "required", scope: "summary", source: "task" }],
      createdAt: state.createdAt,
      updatedAt: state.createdAt,
    });

    assert.equal(items[0]?.priority, "required");
    assert.match(items[0]?.reason ?? "", /missing: Task not found: T-404/);
    assert.match(items[0]?.content ?? "", /MISSING CONTEXT/);
  });
});

test("validateTaskContextManifest rejects invalid and incomplete items", () => {
  const base = {
    version: 1 as const,
    taskId: "T-001",
    items: [{ id: "file", type: "file" as const, reason: "Need file", priority: "required" as const, scope: "full" as const, source: "file" as const, path: "README.md" }],
    createdAt: "now",
    updatedAt: "now",
  };

  assert.throws(() => validateTaskContextManifest({ ...base, version: 2 as never }), /Unsupported task context manifest version/);
  assert.throws(() => validateTaskContextManifest({ ...base, items: [{ ...base.items[0]!, exactness: "lossy" as never }] }), /Invalid task context item exactness/);
  assert.throws(() => validateTaskContextManifest({ ...base, items: [{ ...base.items[0]!, path: undefined }] }), /file path is required/);
  assert.throws(() => validateTaskContextManifest({ ...base, items: [base.items[0]!, base.items[0]!] }), /Duplicate task context item id/);
});

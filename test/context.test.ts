/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
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

test("function candidate discovery emits and approves an exact path-bound selector", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, "src"));
    const selected = "export function targetFunction(input: string): string { return input.trim(); }";
    await writeFile(join(dir, "src", "feature.ts"), `${selected}\nconst unrelated = true;\n`, "utf8");
    await writeFile(join(dir, "src", "other.ts"), "export function otherFunction(): void {}\n", "utf8");
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    state.tasks = [{
      id: "T-FUNCTION-DISCOVERY", status: "ready", title: "Locate exact callable",
      allowedPathPrefixes: ["src"], updatedAt: state.createdAt,
    }];

    const candidates = await discoverSemanticContextCandidates(
      dir, state, "T-FUNCTION-DISCOVERY", { query: "function:targetFunction", limit: 10 },
    );

    assert.equal(candidates.length, 1);
    const [candidate] = candidates;
    assert.equal(candidate?.path, "src/feature.ts");
    assert.equal(candidate?.scope, "section");
    assert.equal(candidate?.exactness, "exact");
    assert.deepEqual(candidate?.selector, { kind: "typescript-function", name: "targetFunction" });
    assert.match(formatContextCandidates(candidates), /selector=typescript-function:targetFunction/);

    const approved = await approveContextCandidate(
      dir, state, "T-FUNCTION-DISCOVERY", candidate!.id, { query: "function:targetFunction" },
    );
    const item = approved.manifest.items.find((entry) => entry.path === "src/feature.ts");
    assert.equal(approved.added, true);
    assert.equal(item?.scope, "section");
    assert.deepEqual(item?.selector, { kind: "typescript-function", name: "targetFunction" });

    const resolved = await resolveTaskContextManifest(dir, state, approved.manifest);
    const selectedItem = resolved.find((entry) => entry.id === item?.id);
    assert.equal(selectedItem?.content, selected);
    assert.doesNotMatch(selectedItem?.content ?? "", /unrelated/);
  });
});

test("function candidate discovery keeps same-named symbols in separate files ambiguous", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, "src"));
    await mkdir(join(dir, "src", "nested"));
    await writeFile(join(dir, "src", "first.ts"), "export function sharedTarget(): number { return 1; }\n", "utf8");
    await writeFile(join(dir, "src", "nested", "first.ts"), "export function sharedTarget(): number { return 2; }\n", "utf8");
    const state = createDefaultState();
    state.tasks = [{
      id: "T-AMBIGUOUS-FUNCTION", status: "ready", title: "Locate shared callable",
      allowedPathPrefixes: ["src"], updatedAt: state.createdAt,
    }];

    const candidates = await discoverSemanticContextCandidates(
      dir, state, "T-AMBIGUOUS-FUNCTION", { query: "function:sharedTarget", limit: 10 },
    );

    assert.equal(candidates.length, 2);
    assert.equal(new Set(candidates.map((candidate) => candidate.id)).size, 2);
    assert.deepEqual(candidates.map((candidate) => candidate.path).sort(), ["src/first.ts", "src/nested/first.ts"]);
  });
});

test("function candidate discovery fails closed on malformed and ineligible selectors", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, "src"));
    await writeFile(join(dir, "src", "valid.ts"), "export function target(): number { return 1; }\n", "utf8");
    await writeFile(join(dir, "src", "duplicate.ts"), "function target() {}\nfunction target() {}\n", "utf8");
    await writeFile(join(dir, "src", "method.ts"), "class Example { target(): void {} }\n", "utf8");
    await writeFile(join(dir, "src", "malformed.ts"), "function target( {\n", "utf8");
    await writeFile(join(dir, "src", "oversized.ts"), `function target() { return '${"x".repeat(3_300)}'; }\n`, "utf8");
    await writeFile(join(dir, "src", "unsupported.py"), "def target():\n    return 1\n", "utf8");
    const state = createDefaultState();
    state.tasks = [{
      id: "T-REFUSE-FUNCTION", status: "ready", title: "Locate valid callable",
      allowedPathPrefixes: ["src"], updatedAt: state.createdAt,
    }];

    for (const query of ["function:", "function: target", "function:target.value", "function:return"]) {
      assert.deepEqual(
        await discoverSemanticContextCandidates(dir, state, "T-REFUSE-FUNCTION", { query, limit: 10 }),
        [],
      );
    }
    const candidates = await discoverSemanticContextCandidates(
      dir, state, "T-REFUSE-FUNCTION", { query: "function:target", limit: 10 },
    );
    assert.deepEqual(candidates.map((candidate) => candidate.path), ["src/valid.ts"]);
  });
});

test("function candidate discovery does not escape task allowed paths through changed files", async () => {
  await withTempDir(async (dir) => {
    await execFileAsync("git", ["init"], { cwd: dir });
    await mkdir(join(dir, "src"));
    await mkdir(join(dir, "outside"));
    await writeFile(join(dir, "src", "allowed.ts"), "export function allowedTarget(): void {}\n", "utf8");
    await writeFile(join(dir, "outside", "leak.ts"), "export function secretTarget(): void {}\n", "utf8");
    await execFileAsync("git", ["add", "-N", "outside/leak.ts"], { cwd: dir });
    const state = createDefaultState();
    state.tasks = [{
      id: "T-BOUNDED-FUNCTION", status: "ready", title: "Locate bounded callable",
      allowedPathPrefixes: ["src"], updatedAt: state.createdAt,
    }];

    const candidates = await discoverSemanticContextCandidates(
      dir, state, "T-BOUNDED-FUNCTION", { query: "function:secretTarget", limit: 10 },
    );

    assert.deepEqual(candidates, []);
  });
});

test("unrelated changed files cannot starve bounded function discovery in allowed paths", async () => {
  await withTempDir(async (dir) => {
    await execFileAsync("git", ["init"], { cwd: dir });
    await mkdir(join(dir, "noise"));
    await mkdir(join(dir, "src"));
    for (let index = 0; index < 30; index++) {
      const name = `noise-${String(index).padStart(2, "0")}.ts`;
      await writeFile(join(dir, "noise", name), `export const noise${index} = ${index};\n`, "utf8");
    }
    await writeFile(join(dir, "src", "target.ts"), "export function targetAfterNoise(): string { return 'found'; }\n", "utf8");
    await execFileAsync("git", ["add", "-N", "noise", "src/target.ts"], { cwd: dir });
    const state = createDefaultState();
    state.tasks = [{
      id: "T-NOISE-FUNCTION", status: "ready", title: "Locate bounded callable after unrelated changes",
      allowedPathPrefixes: ["src"], updatedAt: state.createdAt,
    }];

    const candidates = await discoverSemanticContextCandidates(
      dir, state, "T-NOISE-FUNCTION", { query: "function:targetAfterNoise", limit: 10 },
    );

    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]?.path, "src/target.ts");
  });
});

test("heading candidate discovery emits and approves an exact path-bound selector", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, "docs"));
    const selected = "## Target Section\r\nexact body\r\n### Nested\r\nnested body\r\n";
    await writeFile(
      join(dir, "docs", "guide.md"),
      `# Guide\r\nintro\r\n${selected}## Following\r\nDO_NOT_INCLUDE\r\n`,
      "utf8",
    );
    await writeFile(join(dir, "docs", "other.md"), "## Other Section\nother\n", "utf8");
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    state.tasks = [{
      id: "T-HEADING-DISCOVERY", status: "ready", title: "Locate exact documentation section",
      allowedPathPrefixes: ["docs"], updatedAt: state.createdAt,
    }];

    const candidates = await discoverSemanticContextCandidates(
      dir, state, "T-HEADING-DISCOVERY", { query: "heading:Target Section", limit: 10 },
    );

    assert.equal(candidates.length, 1);
    const [candidate] = candidates;
    assert.equal(candidate?.path, "docs/guide.md");
    assert.equal(candidate?.scope, "section");
    assert.deepEqual(candidate?.selector, { kind: "markdown-heading", heading: "Target Section" });
    assert.match(formatContextCandidates(candidates), /selector=markdown-heading:Target Section/);

    const approved = await approveContextCandidate(
      dir, state, "T-HEADING-DISCOVERY", candidate!.id, { query: "heading:Target Section" },
    );
    const item = approved.manifest.items.find((entry) => entry.path === "docs/guide.md");
    assert.equal(approved.added, true);
    assert.equal(item?.scope, "section");
    assert.deepEqual(item?.selector, { kind: "markdown-heading", heading: "Target Section" });

    const resolved = await resolveTaskContextManifest(dir, state, approved.manifest);
    const selectedItem = resolved.find((entry) => entry.id === item?.id);
    assert.equal(selectedItem?.content, selected);
    assert.doesNotMatch(selectedItem?.content ?? "", /DO_NOT_INCLUDE/);
  });
});

test("heading candidate discovery preserves Unicode whitespace identity", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, "docs"));
    await writeFile(join(dir, "docs", "unicode.md"), "## Target\u00a0\nexact\n", "utf8");
    const state = createDefaultState();
    state.tasks = [{
      id: "T-UNICODE-HEADING", status: "ready", title: "Locate exact Unicode heading",
      allowedPathPrefixes: ["docs"], updatedAt: state.createdAt,
    }];

    const exact = await discoverSemanticContextCandidates(
      dir, state, "T-UNICODE-HEADING", { query: "heading:Target\u00a0", limit: 10 },
    );
    const normalized = await discoverSemanticContextCandidates(
      dir, state, "T-UNICODE-HEADING", { query: "heading:Target", limit: 10 },
    );

    assert.equal(exact.length, 1);
    assert.deepEqual(exact[0]?.selector, { kind: "markdown-heading", heading: "Target\u00a0" });
    assert.deepEqual(normalized, []);
  });
});

test("heading candidate discovery keeps same-named headings in separate files ambiguous", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, "docs", "nested"), { recursive: true });
    await writeFile(join(dir, "docs", "first.md"), "## Shared Heading\nfirst\n", "utf8");
    await writeFile(join(dir, "docs", "nested", "first.md"), "## Shared Heading\nsecond\n", "utf8");
    const state = createDefaultState();
    state.tasks = [{
      id: "T-AMBIGUOUS-HEADING", status: "ready", title: "Locate shared heading",
      allowedPathPrefixes: ["docs"], updatedAt: state.createdAt,
    }];

    const candidates = await discoverSemanticContextCandidates(
      dir, state, "T-AMBIGUOUS-HEADING", { query: "heading:Shared Heading", limit: 10 },
    );

    assert.equal(candidates.length, 2);
    assert.equal(new Set(candidates.map((candidate) => candidate.id)).size, 2);
    assert.deepEqual(candidates.map((candidate) => candidate.path).sort(), ["docs/first.md", "docs/nested/first.md"]);
  });
});

test("heading candidate discovery fails closed on malformed and ineligible sections", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, "docs"));
    await writeFile(join(dir, "docs", "valid.md"), "## Target\nvalid\n", "utf8");
    await writeFile(join(dir, "docs", "duplicate.md"), "## Target\none\n## Target\ntwo\n", "utf8");
    await writeFile(join(dir, "docs", "fenced.md"), "```md\n## Target\n```\n", "utf8");
    await writeFile(join(dir, "docs", "oversized.md"), `## Target\n${"x".repeat(3_300)}\n`, "utf8");
    await writeFile(join(dir, "docs", "unsupported.txt"), "## Target\ntext\n", "utf8");
    const state = createDefaultState();
    state.tasks = [{
      id: "T-REFUSE-HEADING", status: "ready", title: "Locate valid heading",
      allowedPathPrefixes: ["docs"], updatedAt: state.createdAt,
    }];

    assert.deepEqual(
      await discoverSemanticContextCandidates(dir, state, "T-REFUSE-HEADING", { query: "heading:", limit: 10 }),
      [],
    );
    const candidates = await discoverSemanticContextCandidates(
      dir, state, "T-REFUSE-HEADING", { query: "heading:Target", limit: 10 },
    );
    assert.deepEqual(candidates.map((candidate) => candidate.path), ["docs/valid.md"]);
  });
});

test("unrelated changed files cannot starve bounded heading discovery in allowed paths", async () => {
  await withTempDir(async (dir) => {
    await execFileAsync("git", ["init"], { cwd: dir });
    await mkdir(join(dir, "noise"));
    await mkdir(join(dir, "docs"));
    for (let index = 0; index < 30; index++) {
      const name = `noise-${String(index).padStart(2, "0")}.md`;
      await writeFile(join(dir, "noise", name), `# Noise ${index}\n`, "utf8");
    }
    await writeFile(join(dir, "docs", "target.md"), "## Target After Noise\nfound\n", "utf8");
    await execFileAsync("git", ["add", "-N", "noise", "docs/target.md"], { cwd: dir });
    const state = createDefaultState();
    state.tasks = [{
      id: "T-NOISE-HEADING", status: "ready", title: "Locate bounded heading after unrelated changes",
      allowedPathPrefixes: ["docs"], updatedAt: state.createdAt,
    }];

    const candidates = await discoverSemanticContextCandidates(
      dir, state, "T-NOISE-HEADING", { query: "heading:Target After Noise", limit: 10 },
    );

    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]?.path, "docs/target.md");
  });
});

test("local link candidate discovery approves and resolves the exact referenced file", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, "docs", "nested"), { recursive: true });
    await writeFile(
      join(dir, "docs", "index.md"),
      "# Index\n[Target Guide](nested/target.md)\n[Target Guide](nested/target.md)\n",
      "utf8",
    );
    const target = "# Target\nexact linked context\n";
    await writeFile(join(dir, "docs", "nested", "target.md"), target, "utf8");
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    state.tasks = [{
      id: "T-LINK-DISCOVERY", status: "ready", title: "Locate exact linked document",
      allowedPathPrefixes: ["docs"], updatedAt: state.createdAt,
    }];

    const candidates = await discoverSemanticContextCandidates(
      dir, state, "T-LINK-DISCOVERY", { query: "link:Target Guide", limit: 10 },
    );

    assert.equal(candidates.length, 1);
    const [candidate] = candidates;
    assert.equal(candidate?.path, "docs/nested/target.md");
    assert.equal(candidate?.scope, "snippet");
    assert.equal(candidate?.exactness, "exact");
    assert.equal(candidate?.selector, undefined);
    assert.match(candidate?.reason ?? "", /exact local Markdown link/i);

    const approved = await approveContextCandidate(
      dir, state, "T-LINK-DISCOVERY", candidate!.id, { query: "link:Target Guide" },
    );
    const item = approved.manifest.items.find((entry) => entry.path === "docs/nested/target.md");
    assert.equal(approved.added, true);
    assert.equal(item?.scope, "snippet");
    const resolved = await resolveTaskContextManifest(dir, state, approved.manifest);
    assert.equal(resolved.find((entry) => entry.id === item?.id)?.content, target);
  });
});

test("local link discovery keeps distinct targets and deduplicates repeated references", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, "docs"));
    await writeFile(
      join(dir, "docs", "index.md"),
      "[Shared](first.md) [Shared](second.md) [Shared](first.md)\n",
      "utf8",
    );
    await writeFile(join(dir, "docs", "first.md"), "first\n", "utf8");
    await writeFile(join(dir, "docs", "second.md"), "second\n", "utf8");
    const state = createDefaultState();
    state.tasks = [{
      id: "T-LINK-MULTIPLE", status: "ready", title: "Locate shared local references",
      allowedPathPrefixes: ["docs"], updatedAt: state.createdAt,
    }];

    const candidates = await discoverSemanticContextCandidates(
      dir, state, "T-LINK-MULTIPLE", { query: "link:Shared", limit: 10 },
    );

    assert.equal(candidates.length, 2);
    assert.equal(new Set(candidates.map((candidate) => candidate.id)).size, 2);
    assert.deepEqual(candidates.map((candidate) => candidate.path).sort(), ["docs/first.md", "docs/second.md"]);
  });
});

test("local link discovery resolves a formatted label and parent path within allowed scope", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, "docs", "guides"), { recursive: true });
    await writeFile(join(dir, "docs", "guides", "index.md"), "[Target *Guide*](../target.md)\n", "utf8");
    await writeFile(join(dir, "docs", "target.md"), "normalized target\n", "utf8");
    const state = createDefaultState();
    state.tasks = [{
      id: "T-LINK-PARENT", status: "ready", title: "Resolve bounded parent link",
      allowedPathPrefixes: ["docs"], updatedAt: state.createdAt,
    }];

    const candidates = await discoverSemanticContextCandidates(
      dir, state, "T-LINK-PARENT", { query: "link:Target Guide", limit: 10 },
    );

    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]?.path, "docs/target.md");
  });
});

test("local link discovery refuses malformed, external, escaping and indirect destinations", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, "docs"));
    await mkdir(join(dir, "real"));
    await writeFile(join(dir, "outside.md"), "outside\n", "utf8");
    await writeFile(join(dir, "real", "secret.md"), "secret\n", "utf8");
    await writeFile(join(dir, "docs", "target.md"), "target\n", "utf8");
    await symlink(join(dir, "outside.md"), join(dir, "docs", "linked.md"));
    await symlink(join(dir, "real"), join(dir, "docs", "linked-dir"));
    await writeFile(
      join(dir, "docs", "index.md"),
      [
        "[External](https://example.com/docs)",
        "[Absolute](/etc/passwd)",
        "[Escape](../../outside.md)",
        "[Fragment](target.md#part)",
        "[Query](target.md?raw=1)",
        "[Symlink](linked.md)",
        "[Symlink Ancestor](linked-dir/secret.md)",
        "```md",
        "[Fenced](target.md)",
        "```",
      ].join("\n"),
      "utf8",
    );
    const state = createDefaultState();
    state.tasks = [{
      id: "T-LINK-REFUSE", status: "ready", title: "Refuse unsafe document links",
      allowedPathPrefixes: ["docs"], updatedAt: state.createdAt,
    }];

    for (const label of ["", "External", "Absolute", "Escape", "Fragment", "Query", "Symlink", "Symlink Ancestor", "Fenced"]) {
      assert.deepEqual(
        await discoverSemanticContextCandidates(dir, state, "T-LINK-REFUSE", { query: `link:${label}`, limit: 10 }),
        [],
        label || "empty label",
      );
    }
  });
});

test("local import candidate discovery approves and resolves the exact referenced source file", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, "src"));
    await writeFile(
      join(dir, "src", "entry.ts"),
      "import type { Target } from \"./target.ts\";\nexport { target } from \"./target.ts\";\n",
      "utf8",
    );
    const target = "export interface Target { value: string }\nexport const target = 1;\n";
    await writeFile(join(dir, "src", "target.ts"), target, "utf8");
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    state.tasks = [{
      id: "T-IMPORT-DISCOVERY", status: "ready", title: "Locate exact imported module",
      allowedPathPrefixes: ["src"], updatedAt: state.createdAt,
    }];

    const candidates = await discoverSemanticContextCandidates(
      dir, state, "T-IMPORT-DISCOVERY", { query: "import:./target.ts", limit: 10 },
    );

    assert.equal(candidates.length, 1);
    const [candidate] = candidates;
    assert.equal(candidate?.path, "src/target.ts");
    assert.equal(candidate?.scope, "snippet");
    assert.equal(candidate?.exactness, "exact");
    assert.equal(candidate?.selector, undefined);
    assert.match(candidate?.reason ?? "", /exact local module import/i);

    const approved = await approveContextCandidate(
      dir, state, "T-IMPORT-DISCOVERY", candidate!.id, { query: "import:./target.ts" },
    );
    const item = approved.manifest.items.find((entry) => entry.path === "src/target.ts");
    assert.equal(approved.added, true);
    assert.equal(item?.scope, "snippet");
    const resolved = await resolveTaskContextManifest(dir, state, approved.manifest);
    assert.equal(resolved.find((entry) => entry.id === item?.id)?.content, target);
  });
});

test("local import discovery deduplicates repeated edges and keeps distinct exact targets", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, "src", "first"), { recursive: true });
    await mkdir(join(dir, "src", "second"), { recursive: true });
    await writeFile(
      join(dir, "src", "first", "entry.ts"),
      "import { value } from \"./target.ts\";\nexport { value } from \"./target.ts\";\n",
      "utf8",
    );
    await writeFile(
      join(dir, "src", "second", "entry.ts"),
      "export type { Value } from \"./target.ts\";\n",
      "utf8",
    );
    await writeFile(join(dir, "src", "first", "target.ts"), "export const value = 1;\n", "utf8");
    await writeFile(join(dir, "src", "second", "target.ts"), "export type Value = 2;\n", "utf8");
    const state = createDefaultState();
    state.tasks = [{
      id: "T-IMPORT-MULTIPLE", status: "ready", title: "Locate exact local modules",
      allowedPathPrefixes: ["src"], updatedAt: state.createdAt,
    }];

    const candidates = await discoverSemanticContextCandidates(
      dir, state, "T-IMPORT-MULTIPLE", { query: "import:./target.ts", limit: 10 },
    );

    assert.equal(candidates.length, 2);
    assert.equal(new Set(candidates.map((candidate) => candidate.id)).size, 2);
    assert.deepEqual(candidates.map((candidate) => candidate.path).sort(), [
      "src/first/target.ts",
      "src/second/target.ts",
    ]);
  });
});

test("local import discovery refuses non-static and unsafe module specifiers", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, "src"));
    await writeFile(join(dir, "outside.ts"), "export const outside = true;\n", "utf8");
    await writeFile(join(dir, "src", "target.ts"), "export const target = true;\n", "utf8");
    await writeFile(join(dir, "src", "data.json"), "{}\n", "utf8");
    await symlink(join(dir, "outside.ts"), join(dir, "src", "linked.ts"));
    await writeFile(
      join(dir, "src", "unsafe.ts"),
      [
        "import('./target.ts');",
        "require('./target.ts');",
        "import value from 'package-name';",
        "import alias from '@/target.ts';",
        "import noExtension from './target';",
        "import query from './target.ts?raw';",
        "import fragment from './target.ts#part';",
        "import escape from '../outside.ts';",
        "import linked from './linked.ts';",
        "import data from './data.json';",
      ].join("\n"),
      "utf8",
    );
    const state = createDefaultState();
    state.tasks = [{
      id: "T-IMPORT-REFUSE", status: "ready", title: "Refuse unsafe module imports",
      allowedPathPrefixes: ["src"], updatedAt: state.createdAt,
    }];

    for (const specifier of [
      "", " ./target.ts", "./target.ts ", "./target.ts", "package-name", "@/target.ts",
      "./target", "./target.ts?raw", "./target.ts#part", "../outside.ts", "./linked.ts", "./data.json",
    ]) {
      assert.deepEqual(
        await discoverSemanticContextCandidates(
          dir, state, "T-IMPORT-REFUSE", { query: `import:${specifier}`, limit: 10 },
        ),
        [],
        specifier || "empty specifier",
      );
    }
  });
});

test("local import discovery rejects malformed sources and symlinked target ancestors", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, "src"));
    await mkdir(join(dir, "real"));
    await writeFile(join(dir, "real", "target.ts"), "export const target = true;\n", "utf8");
    await symlink(join(dir, "real"), join(dir, "src", "linked-dir"));
    await writeFile(join(dir, "src", "malformed.ts"), "import { from './target.ts';\n", "utf8");
    await writeFile(join(dir, "src", "linked-import.ts"), "import './linked-dir/target.ts';\n", "utf8");
    const state = createDefaultState();
    state.tasks = [{
      id: "T-IMPORT-HARDEN", status: "ready", title: "Refuse unsafe static module edges",
      allowedPathPrefixes: ["src"], updatedAt: state.createdAt,
    }];

    assert.deepEqual(
      await discoverSemanticContextCandidates(
        dir, state, "T-IMPORT-HARDEN", { query: "import:./target.ts", limit: 10 },
      ),
      [],
    );
    assert.deepEqual(
      await discoverSemanticContextCandidates(
        dir, state, "T-IMPORT-HARDEN", { query: "import:./linked-dir/target.ts", limit: 10 },
      ),
      [],
    );
  });
});

test("unrelated changed files cannot starve bounded local import discovery", async () => {
  await withTempDir(async (dir) => {
    await execFileAsync("git", ["init"], { cwd: dir });
    await mkdir(join(dir, "noise"));
    await mkdir(join(dir, "src"));
    for (let index = 0; index < 30; index++) {
      const name = `noise-${String(index).padStart(2, "0")}.ts`;
      await writeFile(join(dir, "noise", name), `export const noise${index} = ${index};\n`, "utf8");
    }
    await writeFile(join(dir, "src", "entry.ts"), "import './target.ts';\n", "utf8");
    await writeFile(join(dir, "src", "target.ts"), "export const target = 'found';\n", "utf8");
    await execFileAsync("git", ["add", "-N", "noise", "src/entry.ts", "src/target.ts"], { cwd: dir });
    const state = createDefaultState();
    state.tasks = [{
      id: "T-NOISE-IMPORT", status: "ready", title: "Locate bounded import after unrelated changes",
      allowedPathPrefixes: ["src"], updatedAt: state.createdAt,
    }];

    const candidates = await discoverSemanticContextCandidates(
      dir, state, "T-NOISE-IMPORT", { query: "import:./target.ts", limit: 10 },
    );

    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]?.path, "src/target.ts");
  });
});

test("imported function discovery approves and resolves only the exact exported callable", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, "src"));
    await writeFile(
      join(dir, "src", "entry.ts"),
      "import { selected as localSelected } from './target.ts';\n",
      "utf8",
    );
    const selected = "export function selected(input: string): string { return input.trim(); }";
    await writeFile(
      join(dir, "src", "target.ts"),
      `${selected}\nexport function unrelated(): void {}\n`,
      "utf8",
    );
    const state = createDefaultState();
    state.tasks = [{
      id: "T-IMPORTED-FUNCTION", status: "ready", title: "Locate imported callable",
      allowedPathPrefixes: ["src"], updatedAt: state.createdAt,
    }];

    const candidates = await discoverSemanticContextCandidates(
      dir, state, "T-IMPORTED-FUNCTION", { query: "import-function:./target.ts#selected", limit: 10 },
    );

    assert.equal(candidates.length, 1);
    const [candidate] = candidates;
    assert.equal(candidate?.path, "src/target.ts");
    assert.equal(candidate?.scope, "section");
    assert.equal(candidate?.exactness, "exact");
    assert.deepEqual(candidate?.selector, { kind: "typescript-function", name: "selected" });
    assert.match(candidate?.reason ?? "", /exact imported function/i);

    const approved = await approveContextCandidate(
      dir, state, "T-IMPORTED-FUNCTION", candidate!.id,
      { query: "import-function:./target.ts#selected" },
    );
    const item = approved.manifest.items.find((entry) => entry.path === "src/target.ts");
    assert.equal(approved.added, true);
    assert.deepEqual(item?.selector, { kind: "typescript-function", name: "selected" });
    const resolved = await resolveTaskContextManifest(dir, state, approved.manifest);
    assert.equal(resolved.find((entry) => entry.id === item?.id)?.content, selected);
  });
});

test("imported function discovery deduplicates named imports and re-exports but preserves distinct targets", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, "src", "first"), { recursive: true });
    await mkdir(join(dir, "src", "second"), { recursive: true });
    await writeFile(
      join(dir, "src", "first", "entry.ts"),
      [
        "import { target as localTarget } from './target.ts';",
        "export { target as forwardedTarget } from './target.ts';",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      join(dir, "src", "second", "entry.ts"),
      "export { target } from './target.ts';\n",
      "utf8",
    );
    await writeFile(join(dir, "src", "first", "target.ts"), "export const target = (): number => 1;\n", "utf8");
    await writeFile(join(dir, "src", "second", "target.ts"), "export function target(): number { return 2; }\n", "utf8");
    const state = createDefaultState();
    state.tasks = [{
      id: "T-IMPORTED-FUNCTION-MULTIPLE", status: "ready", title: "Locate exact imported functions",
      allowedPathPrefixes: ["src"], updatedAt: state.createdAt,
    }];

    const candidates = await discoverSemanticContextCandidates(
      dir, state, "T-IMPORTED-FUNCTION-MULTIPLE",
      { query: "import-function:./target.ts#target", limit: 10 },
    );

    assert.equal(candidates.length, 2);
    assert.equal(new Set(candidates.map((candidate) => candidate.id)).size, 2);
    assert.deepEqual(candidates.map((candidate) => candidate.path).sort(), [
      "src/first/target.ts",
      "src/second/target.ts",
    ]);
    assert.ok(candidates.every((candidate) => candidate.selector?.kind === "typescript-function"));
  });
});

test("imported function discovery fails closed on malformed edges and ineligible target declarations", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, "src"));
    await writeFile(join(dir, "src", "callable.ts"), "export function target(): void {}\n", "utf8");
    await writeFile(join(dir, "src", "hidden.ts"), "function hidden(): void {}\n", "utf8");
    await writeFile(join(dir, "src", "value.ts"), "export const value = 1;\n", "utf8");
    await writeFile(
      join(dir, "src", "ambiguous.ts"),
      "export function repeated(): void {}\nexport const repeated = (): void => {};\n",
      "utf8",
    );
    await writeFile(
      join(dir, "src", "edges.ts"),
      [
        "import defaultTarget from './callable.ts';",
        "import * as namespaceTarget from './callable.ts';",
        "import type { target as TypeTarget } from './callable.ts';",
        "import { hidden } from './hidden.ts';",
        "import { value } from './value.ts';",
        "import { repeated } from './ambiguous.ts';",
        "import { target } from 'package-name';",
        "import { target as aliasTarget } from '@/callable.ts';",
        "import('./callable.ts');",
        "require('./callable.ts');",
      ].join("\n"),
      "utf8",
    );
    const state = createDefaultState();
    state.tasks = [{
      id: "T-IMPORTED-FUNCTION-REFUSE", status: "ready", title: "Refuse unsafe imported functions",
      allowedPathPrefixes: ["src"], updatedAt: state.createdAt,
    }];

    for (const query of [
      "import-function:",
      "import-function: ./callable.ts#target",
      "import-function:./callable.ts #target",
      "import-function:./callable.ts# target",
      "import-function:./callable.ts#target ",
      "import-function:./callable.ts#not-valid!",
      "import-function:./callable#target",
      "import-function:./callable.ts?raw#target",
      "import-function:package-name#target",
      "import-function:@/callable.ts#target",
      "import-function:./callable.ts#default",
      "import-function:./callable.ts#namespaceTarget",
      "import-function:./callable.ts#TypeTarget",
      "import-function:./hidden.ts#hidden",
      "import-function:./value.ts#value",
      "import-function:./ambiguous.ts#repeated",
    ]) {
      assert.deepEqual(
        await discoverSemanticContextCandidates(
          dir, state, "T-IMPORTED-FUNCTION-REFUSE", { query, limit: 10 },
        ),
        [],
        query,
      );
    }
  });
});

test("imported function discovery rejects malformed, indirect and symlinked one-hop evidence", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, "src"));
    await mkdir(join(dir, "real"));
    await writeFile(join(dir, "real", "target.ts"), "export function target(): void {}\n", "utf8");
    await symlink(join(dir, "real"), join(dir, "src", "linked"));
    await writeFile(join(dir, "src", "malformed.ts"), "import { target from './target.ts';\n", "utf8");
    await writeFile(join(dir, "src", "target.ts"), "export { target } from './deep.ts';\n", "utf8");
    await writeFile(join(dir, "src", "deep.ts"), "export function target(): void {}\n", "utf8");
    await writeFile(
      join(dir, "src", "edges.ts"),
      [
        "import { target } from './target.ts';",
        "export type { target as targetType } from './deep.ts';",
        "export { target as forwarded } from './linked/target.ts';",
      ].join("\n"),
      "utf8",
    );
    const state = createDefaultState();
    state.tasks = [{
      id: "T-IMPORTED-FUNCTION-HARDEN", status: "ready", title: "Refuse indirect imported functions",
      allowedPathPrefixes: ["src"], updatedAt: state.createdAt,
    }];

    for (const query of [
      "import-function:./target.ts#target",
      "import-function:./linked/target.ts#target",
      "import-function:./linked/target.ts#forwarded",
      "import-function:./deep.ts#targetType",
      "import-function:./target.ts#target#extra",
    ]) {
      assert.deepEqual(
        await discoverSemanticContextCandidates(
          dir, state, "T-IMPORTED-FUNCTION-HARDEN", { query, limit: 10 },
        ),
        [],
        query,
      );
    }
  });
});

test("unrelated changed files cannot starve bounded imported function discovery", async () => {
  await withTempDir(async (dir) => {
    await execFileAsync("git", ["init"], { cwd: dir });
    await mkdir(join(dir, "noise"));
    await mkdir(join(dir, "src"));
    for (let index = 0; index < 30; index++) {
      const name = `noise-${String(index).padStart(2, "0")}.ts`;
      await writeFile(join(dir, "noise", name), `export function noise${index}(): number { return ${index}; }\n`, "utf8");
    }
    await writeFile(join(dir, "src", "entry.ts"), "import { target } from './target.ts';\n", "utf8");
    await writeFile(join(dir, "src", "target.ts"), "export function target(): string { return 'found'; }\n", "utf8");
    await execFileAsync("git", ["add", "-N", "noise", "src/entry.ts", "src/target.ts"], { cwd: dir });
    const state = createDefaultState();
    state.tasks = [{
      id: "T-NOISE-IMPORTED-FUNCTION", status: "ready", title: "Locate bounded imported function",
      allowedPathPrefixes: ["src"], updatedAt: state.createdAt,
    }];

    const candidates = await discoverSemanticContextCandidates(
      dir, state, "T-NOISE-IMPORTED-FUNCTION",
      { query: "import-function:./target.ts#target", limit: 10 },
    );

    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]?.path, "src/target.ts");
    assert.deepEqual(candidates[0]?.selector, { kind: "typescript-function", name: "target" });
  });
});

test("imported caller discovery approves and resolves only the exact top-level caller", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, "src"));
    await writeFile(join(dir, "src", "target.ts"), "export function selected(value: string): string { return value; }\n", "utf8");
    const caller = [
      "export function loadSelected(value: string): string {",
      "  return localSelected(value);",
      "}",
    ].join("\n");
    await writeFile(
      join(dir, "src", "entry.ts"),
      [
        "import { selected as localSelected } from './target.ts';",
        caller,
        "export function unrelated(value: string): string { return value; }",
      ].join("\n"),
      "utf8",
    );
    const state = createDefaultState();
    state.tasks = [{
      id: "T-IMPORTED-CALLER", status: "ready", title: "Locate exact imported caller",
      allowedPathPrefixes: ["src"], updatedAt: state.createdAt,
    }];

    const candidates = await discoverSemanticContextCandidates(
      dir, state, "T-IMPORTED-CALLER", { query: "import-caller:./target.ts#selected", limit: 10 },
    );

    assert.equal(candidates.length, 1);
    const [candidate] = candidates;
    assert.equal(candidate?.path, "src/entry.ts");
    assert.deepEqual(candidate?.selector, { kind: "typescript-function", name: "loadSelected" });
    assert.match(candidate?.reason ?? "", /exact imported caller/i);

    const approved = await approveContextCandidate(
      dir, state, "T-IMPORTED-CALLER", candidate!.id,
      { query: "import-caller:./target.ts#selected" },
    );
    const item = approved.manifest.items.find((entry) => entry.path === "src/entry.ts");
    assert.equal(approved.added, true);
    assert.deepEqual(item?.selector, { kind: "typescript-function", name: "loadSelected" });
    const resolved = await resolveTaskContextManifest(dir, state, approved.manifest);
    assert.equal(resolved.find((entry) => entry.id === item?.id)?.content, caller);
  });
});

test("imported caller discovery preserves distinct exact callers and ignores nested call evidence", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, "src"));
    await writeFile(join(dir, "src", "target.ts"), "export const target = (): number => 1;\n", "utf8");
    await writeFile(
      join(dir, "src", "entry.ts"),
      [
        "import { target as invoke } from './target.ts';",
        "export const first = (): number => invoke();",
        "export function second(): number { return invoke(); }",
        "export function nestedOnly(): () => number { return () => invoke(); }",
      ].join("\n"),
      "utf8",
    );
    const state = createDefaultState();
    state.tasks = [{
      id: "T-IMPORTED-CALLERS", status: "ready", title: "Locate exact imported callers",
      allowedPathPrefixes: ["src"], updatedAt: state.createdAt,
    }];

    const candidates = await discoverSemanticContextCandidates(
      dir, state, "T-IMPORTED-CALLERS", { query: "import-caller:./target.ts#target", limit: 10 },
    );

    assert.deepEqual(
      candidates.map((candidate) => candidate.selector?.kind === "typescript-function" ? candidate.selector.name : undefined).sort(),
      ["first", "second"],
    );
    assert.equal(new Set(candidates.map((candidate) => candidate.id)).size, 2);
  });
});

test("imported caller discovery fails closed on malformed queries and non-call edges", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, "src"));
    await writeFile(join(dir, "src", "target.ts"), "export function target(): void {}\n", "utf8");
    await writeFile(
      join(dir, "src", "edges.ts"),
      [
        "import defaultTarget from './target.ts';",
        "import * as namespaceTarget from './target.ts';",
        "import type { target as typedTarget } from './target.ts';",
        "import { target as localTarget } from './target.ts';",
        "export function propertyOnly(): void { ({ localTarget }).localTarget(); }",
        "export function constructedOnly(): void { new localTarget(); }",
        "export function taggedOnly(): void { localTarget``; }",
        "export function referencedOnly(): unknown { return localTarget; }",
        "import('./target.ts');",
        "require('./target.ts');",
      ].join("\n"),
      "utf8",
    );
    const state = createDefaultState();
    state.tasks = [{
      id: "T-IMPORTED-CALLER-REFUSE", status: "ready", title: "Refuse inexact imported caller evidence",
      allowedPathPrefixes: ["src"], updatedAt: state.createdAt,
    }];

    for (const query of [
      "import-caller:",
      "import-caller: ./target.ts#target",
      "import-caller:./target.ts #target",
      "import-caller:./target.ts# target",
      "import-caller:./target.ts#target ",
      "import-caller:./target#target",
      "import-caller:package-name#target",
      "import-caller:./target.ts#not-valid!",
      "import-caller:./target.ts#target#extra",
      "import-caller:./target.ts#defaultTarget",
      "import-caller:./target.ts#namespaceTarget",
      "import-caller:./target.ts#typedTarget",
      "import-caller:./target.ts#target",
    ]) {
      assert.deepEqual(
        await discoverSemanticContextCandidates(
          dir, state, "T-IMPORTED-CALLER-REFUSE", { query, limit: 10 },
        ),
        [],
        query,
      );
    }
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

for (const [name, prefix] of [
  ["a blockquote ends a preceding list", "- item\n> quote\n  ```markdown\n"],
  ["non-one ordered markers cannot interrupt a paragraph", "paragraph\n2. not a list\n   ```markdown\n"],
] as const) {
  test(`section retrieval ignores fenced headings after ${name}`, async () => {
    await withTempDir(async (dir) => {
      const state = createDefaultState();
      await writeFile(join(dir, "reference.md"), `${prefix}## Target\nFENCED_FAKE\n  \`\`\`\n\n## Real\nREAL_CONTRACT\n## Next\nNEXT\n`, "utf8");
      const manifest = {
        version: 1 as const, taskId: "T-SECTION",
        items: [{
          id: "target", type: "file" as const, reason: "Exact Target contract", priority: "required" as const,
          scope: "section" as const, source: "file" as const, path: "reference.md",
          selector: { kind: "markdown-heading", heading: "Target" },
        }],
        createdAt: state.createdAt, updatedAt: state.createdAt,
      };
      const [missing] = await resolveTaskContextManifest(dir, state, manifest as never);
      assert.equal(missing?.available, false);
      assert.match(missing?.content ?? "", /not found/i);
      manifest.items[0]!.selector.heading = "Real";
      const [real] = await resolveTaskContextManifest(dir, state, manifest as never);
      assert.equal(real?.available, true);
      assert.equal(real?.content, "## Real\nREAL_CONTRACT\n");
    });
  });
}

for (const [name, prefix, section] of [
  ["tab-suffixed closing fence", "", "## Target\n```\ncode\n```\t\n"],
  ["mixed fence is not a closer", "", "## Target\n```\ncode\n```~\n## Fake\nSTILL_CODE\n```\n"],
  ["vertical tab is not heading whitespace", "", "## Target\nbody\n##\u000bNotAHeading\nSTILL_TARGET\n"],
  ["duplicate reference definitions", "[ref]: /target\n[ref]: /target\n\n", "## Target\ncontract\n"],
] as const) {
  test(`exact section honors CommonMark ${name}`, async () => {
    await withTempDir(async (dir) => {
      const state = createDefaultState();
      await writeFile(join(dir, "reference.md"), prefix + section + "## Real\nNEXT\n", "utf8");
      const manifest = {
        version: 1 as const, taskId: "T-SECTION", createdAt: state.createdAt, updatedAt: state.createdAt,
        items: [{ id: "target", type: "file" as const, reason: "Exact contract", priority: "required" as const,
          scope: "section" as const, source: "file" as const, path: "reference.md",
          selector: { kind: "markdown-heading" as const, heading: "Target" } }],
      };
      const [item] = await resolveTaskContextManifest(dir, state, manifest);
      assert.equal(item?.available, true);
      assert.equal(item?.content, section);
      if (name === "mixed fence is not a closer") {
        manifest.items[0]!.selector.heading = "Fake";
        const [fake] = await resolveTaskContextManifest(dir, state, manifest);
        assert.equal(fake?.available, false);
      }
    });
  });
}

for (const title of ["Target\u00a0", "Target\u202f", "\u00a0"]) {
  test(`raw heading identity preserves Unicode whitespace ${JSON.stringify(title)}`, async () => {
    await withTempDir(async (dir) => {
      const state = createDefaultState();
      const section = `## ${title}\nUNICODE_TITLE\n`;
      await writeFile(join(dir, "reference.md"), section + "## Target\nASCII_TITLE\n", "utf8");
      await saveTaskContextManifest(dir, {
        version: 1, taskId: "T-SECTION", createdAt: state.createdAt, updatedAt: state.createdAt,
        items: [{ id: "target", type: "file", reason: "Exact contract", priority: "required",
          scope: "section", source: "file", path: "reference.md",
          selector: { kind: "markdown-heading", heading: ` \t${title}\t ` } }],
      });
      const manifest = (await loadTaskContextManifest(dir, "T-SECTION"))!;
      assert.equal(manifest.items[0]!.selector!.heading, title);
      const [item] = await resolveTaskContextManifest(dir, state, manifest);
      assert.equal(item?.available, true);
      assert.equal(item?.content, section);
      manifest.items[0]!.selector!.heading = "Target";
      const [ascii] = await resolveTaskContextManifest(dir, state, manifest);
      assert.equal(ascii?.available, true);
      assert.equal(ascii?.content, "## Target\nASCII_TITLE\n");
    });
  });
}

for (const eol of ["\n", "\r\n", "\r"]) {
  test(`block token offsets preserve ${JSON.stringify(eol)} source and Unicode`, async () => {
    await withTempDir(async (dir) => {
      const state = createDefaultState();
      // A blank line keeps Detail out of the following Setext heading's paragraph.
      const section = ["## Target", "😀 Exact contract", "### Child", "Detail", "", ""].join(eol);
      const source = ["# Intro", "😀 prefix", "", "[ref]: /target", "", ""].join(eol)
        + section + ["Next", "----", "NOT_SELECTED", ""].join(eol);
      await writeFile(join(dir, "reference.md"), source, "utf8");
      const [item] = await resolveTaskContextManifest(dir, state, {
        version: 1, taskId: "T-SECTION", createdAt: state.createdAt, updatedAt: state.createdAt,
        items: [{ id: "target", type: "file", reason: "Exact contract", priority: "required",
          scope: "section", source: "file", path: "reference.md",
          selector: { kind: "markdown-heading", heading: "Target" } }],
      });
      assert.equal(item?.available, true);
      assert.equal(item?.content, section);
    });
  });
}

for (const [name, source] of [
  ["HTML comment", "<!--\n## Target\nFAKE\n-->\n"],
  ["HTML block", "<div>\n## Target\nFAKE\n</div>\n\n"],
  ["blockquote", "> ## Target\n> FAKE\n"],
  ["list", "- ## Target\n  FAKE\n"],
  ["indented code", "    ## Target\n    FAKE\n"],
  ["setext heading", "Target\n------\n"],
] as const) {
  test(`document ATX selectors do not select ${name} content`, async () => {
    await withTempDir(async (dir) => {
      const state = createDefaultState();
      await writeFile(join(dir, "reference.md"), source, "utf8");
      const [item] = await resolveTaskContextManifest(dir, state, {
        version: 1, taskId: "T-SECTION", createdAt: state.createdAt, updatedAt: state.createdAt,
        items: [{ id: "target", type: "file", reason: "Exact contract", priority: "required",
          scope: "section", source: "file", path: "reference.md",
          selector: { kind: "markdown-heading", heading: "Target" } }],
      });
      assert.equal(item?.available, false);
      assert.match(item?.content ?? "", /not found/i);
    });
  });
}

test("file section scope resolves the selected exact Markdown heading", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState();
    const source = [
      "# Reference",
      "## Introduction",
      "UNRELATED_PREFIX",
      "```markdown",
      "## Target",
      "FENCED_PSEUDO_TARGET",
      "```",
      "filler line\n".repeat(300),
      "## Target",
      "EXACT_TARGET_CONTRACT = keep_this_unchanged;",
      "### Nested",
      "NESTED_TARGET_DETAIL",
      "## Next",
      "DO_NOT_INCLUDE_NEXT",
      "",
    ].join("\r\n");
    await writeFile(join(dir, "reference.md"), source, "utf8");
    const manifest = {
      version: 1 as const,
      taskId: "T-SECTION",
      items: [{
        id: "target", type: "file" as const, reason: "Exact Target contract", priority: "required" as const,
        scope: "section" as const, source: "file" as const, path: "reference.md",
        selector: { kind: "markdown-heading", heading: "Target" },
      }],
      createdAt: state.createdAt,
      updatedAt: state.createdAt,
    };

    const [item] = await resolveTaskContextManifest(dir, state, manifest as never);

    assert.match(item?.content ?? "", /^## Target\r\n/);
    assert.match(item?.content ?? "", /EXACT_TARGET_CONTRACT/);
    assert.match(item?.content ?? "", /### Nested\r\nNESTED_TARGET_DETAIL/);
    assert.doesNotMatch(item?.content ?? "", /UNRELATED_PREFIX|FENCED_PSEUDO_TARGET|DO_NOT_INCLUDE_NEXT/);
    assert.equal(item?.exactness, "exact");
  });
});

test("file section scope resolves the selected exact TypeScript function", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState();
    await mkdir(join(dir, "src"), { recursive: true });
    const selected = [
      "export async function selectedFunction(input: string): Promise<string> {",
      "  const normalized = input.trim();",
      "  return normalized.toUpperCase();",
      "}",
    ].join("\r\n");
    const source = [
      "const unrelatedPrefix = 'do not include';",
      "export function beforeFunction(): void {}",
      selected,
      "export function afterFunction(): void {}",
      "",
    ].join("\r\n");
    await writeFile(join(dir, "src", "example.ts"), source, "utf8");
    const manifest = {
      version: 1 as const,
      taskId: "T-FUNCTION",
      items: [{
        id: "selected-function", type: "file" as const, reason: "Exact function contract",
        priority: "required" as const, scope: "section" as const, source: "file" as const,
        path: "src/example.ts",
        selector: { kind: "typescript-function", name: "selectedFunction" },
      }],
      createdAt: state.createdAt,
      updatedAt: state.createdAt,
    };

    const [item] = await resolveTaskContextManifest(dir, state, manifest as never);

    assert.equal(item?.available, true);
    assert.equal(item?.content, selected);
    assert.doesNotMatch(item?.content ?? "", /unrelatedPrefix|beforeFunction|afterFunction/);
    assert.equal(item?.exactness, "exact");
  });
});

test("TypeScript function selector resolves a top-level callable variable statement", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState();
    const selected = "export const selectedFunction = (input: string): string => input.trim();";
    await writeFile(join(dir, "example.ts"), `${selected}\nconst after = 1;\n`, "utf8");
    const [item] = await resolveTaskContextManifest(dir, state, {
      version: 1, taskId: "T-FUNCTION", createdAt: state.createdAt, updatedAt: state.createdAt,
      items: [{ id: "selected", type: "file", reason: "Exact callable", priority: "required",
        scope: "section", source: "file", path: "example.ts",
        selector: { kind: "typescript-function", name: "selectedFunction" } }],
    });

    assert.equal(item?.available, true);
    assert.equal(item?.content, selected);
    assert.doesNotMatch(item?.content ?? "", /const after/);
  });
});

for (const [name, path, source, diagnostic] of [
  ["duplicate declarations", "example.ts", "function target() {}\nfunction target() {}\n", /ambiguous/i],
  ["overload groups", "example.ts", "function target(value: string): string;\nfunction target(value: string) { return value; }\n", /ambiguous/i],
  ["class methods", "example.ts", "class Example { target(): void {} }\n", /not found/i],
  ["multi-binding variable statements", "example.ts", "const target = () => 1, sibling = 2;\n", /not found/i],
  ["malformed source", "example.ts", "function target( {\n", /malformed/i],
  ["unsupported extensions", "example.py", "def target():\n    pass\n", /does not support file extension/i],
] as const) {
  test(`TypeScript function selector fails closed for ${name}`, async () => {
    await withTempDir(async (dir) => {
      const state = createDefaultState();
      await writeFile(join(dir, path), source, "utf8");
      const [item] = await resolveTaskContextManifest(dir, state, {
        version: 1, taskId: "T-FUNCTION", createdAt: state.createdAt, updatedAt: state.createdAt,
        items: [{ id: "selected", type: "file", reason: "Exact callable", priority: "required",
          scope: "section", source: "file", path,
          selector: { kind: "typescript-function", name: "target" } }],
      });

      assert.equal(item?.available, false);
      assert.match(item?.diagnostic ?? "", diagnostic);
    });
  });
}

test("TypeScript function selector enforces exact section size", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState();
    await writeFile(join(dir, "example.js"), "export function target() { return 'oversized'; }\n", "utf8");
    const [item] = await resolveTaskContextManifest(dir, state, {
      version: 1, taskId: "T-FUNCTION", createdAt: state.createdAt, updatedAt: state.createdAt,
      items: [{ id: "selected", type: "file", reason: "Exact callable", priority: "required",
        scope: "section", source: "file", path: "example.js",
        selector: { kind: "typescript-function", name: "target", maxChars: 20 } }],
    });

    assert.equal(item?.available, false);
    assert.match(item?.diagnostic ?? "", /oversized/i);
  });
});

test("TypeScript function selector round-trips through the durable manifest", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState();
    const saved = await saveTaskContextManifest(dir, {
      version: 1, taskId: "T-FUNCTION", createdAt: state.createdAt, updatedAt: state.createdAt,
      items: [{ id: "selected", type: "file", reason: "Exact callable", priority: "required",
        scope: "section", source: "file", path: "example.ts",
        selector: { kind: "typescript-function", name: " target ", maxChars: 512 } }],
    });
    const loaded = await loadTaskContextManifest(dir, "T-FUNCTION");

    assert.deepEqual(saved.items[0]?.selector, { kind: "typescript-function", name: "target", maxChars: 512 });
    assert.deepEqual(loaded?.items[0]?.selector, saved.items[0]?.selector);
    assert.match(formatTaskContextManifest(saved), /selector=typescript-function:target/);
  });
});

test("TypeScript function selector rejects malformed selector names", () => {
  const state = createDefaultState();
  for (const name of ["", " target ", "target.value", "two words", "return", "{ target }"]) {
    assert.throws(() => validateTaskContextManifest({
      version: 1, taskId: "T-FUNCTION", createdAt: state.createdAt, updatedAt: state.createdAt,
      items: [{ id: `selected-${name}`, type: "file", reason: "Exact callable", priority: "required",
        scope: "section", source: "file", path: "example.ts",
        selector: { kind: "typescript-function", name } }],
    }), /TypeScript function selector is invalid/);
  }
});

test("inline backtick text does not hide the next Markdown heading", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState();
    await writeFile(
      join(dir, "reference.md"),
      "## Target\ncontract\n```inline example```\n## Next\nDO_NOT_INCLUDE_NEXT\n",
      "utf8",
    );
    const [item] = await resolveTaskContextManifest(dir, state, {
      version: 1,
      taskId: "T-SECTION",
      items: [{
        id: "target", type: "file", reason: "Exact Target contract", priority: "required",
        scope: "section", source: "file", path: "reference.md",
        selector: { kind: "markdown-heading", heading: "Target" },
      }],
      createdAt: state.createdAt,
      updatedAt: state.createdAt,
    });

    assert.equal(item?.available, true);
    assert.doesNotMatch(item?.content ?? "", /## Next|DO_NOT_INCLUDE_NEXT/);
  });
});

test("list-contained code fences do not expose pseudo Markdown headings", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState();
    await writeFile(
      join(dir, "reference.md"),
      "- ```markdown\n  ## Target\n  FENCED_FAKE\n  ```\n\n## Target\nREAL_CONTRACT\n## Next\nNEXT_CONTENT\n",
      "utf8",
    );
    const [item] = await resolveTaskContextManifest(dir, state, {
      version: 1,
      taskId: "T-SECTION",
      items: [{
        id: "target", type: "file", reason: "Exact Target contract", priority: "required",
        scope: "section", source: "file", path: "reference.md",
        selector: { kind: "markdown-heading", heading: "Target" },
      }],
      createdAt: state.createdAt,
      updatedAt: state.createdAt,
    });

    assert.equal(item?.available, true);
    assert.match(item?.content ?? "", /^## Target\nREAL_CONTRACT\n$/);
    assert.doesNotMatch(item?.content ?? "", /FENCED_FAKE|NEXT_CONTENT/);
  });
});

test("an unclosed list fence ends before a following document heading", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState();
    await writeFile(
      join(dir, "reference.md"),
      "## Target\ncontract\n- ```markdown\n  code\n\n## Next\nNEXT_CONTENT\n",
      "utf8",
    );
    const [item] = await resolveTaskContextManifest(dir, state, {
      version: 1,
      taskId: "T-SECTION",
      items: [{
        id: "target", type: "file", reason: "Exact Target contract", priority: "required",
        scope: "section", source: "file", path: "reference.md",
        selector: { kind: "markdown-heading", heading: "Target" },
      }],
      createdAt: state.createdAt,
      updatedAt: state.createdAt,
    });

    assert.equal(item?.available, true);
    assert.match(item?.content ?? "", /^## Target\ncontract\n- ```markdown\n  code\n\n$/);
    assert.doesNotMatch(item?.content ?? "", /## Next|NEXT_CONTENT/);
  });
});

test("over-indented backticks after a list marker do not open a fence", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState();
    await writeFile(
      join(dir, "reference.md"),
      "## Target\ncontract\n\n-     ```\n\n## Next\nNEXT_CONTENT\n",
      "utf8",
    );
    const [item] = await resolveTaskContextManifest(dir, state, {
      version: 1,
      taskId: "T-SECTION",
      items: [{
        id: "target", type: "file", reason: "Exact Target contract", priority: "required",
        scope: "section", source: "file", path: "reference.md",
        selector: { kind: "markdown-heading", heading: "Target" },
      }],
      createdAt: state.createdAt,
      updatedAt: state.createdAt,
    });

    assert.equal(item?.available, true);
    assert.match(item?.content ?? "", /-     ```/);
    assert.doesNotMatch(item?.content ?? "", /## Next|NEXT_CONTENT/);
  });
});

test("a fence on a continued list-item line ends with its container", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState();
    await writeFile(
      join(dir, "reference.md"),
      "## Target\ncontract\n- item\n\n  ```markdown\n  code\n\n## Next\nNEXT_CONTENT\n",
      "utf8",
    );
    const [item] = await resolveTaskContextManifest(dir, state, {
      version: 1,
      taskId: "T-SECTION",
      items: [{
        id: "target", type: "file", reason: "Exact Target contract", priority: "required",
        scope: "section", source: "file", path: "reference.md",
        selector: { kind: "markdown-heading", heading: "Target" },
      }],
      createdAt: state.createdAt,
      updatedAt: state.createdAt,
    });

    assert.equal(item?.available, true);
    assert.doesNotMatch(item?.content ?? "", /## Next|NEXT_CONTENT/);
  });
});

test("tabs keep content inside a list-contained fence", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState();
    await writeFile(
      join(dir, "reference.md"),
      "- ```markdown\n\tcode\n  ## Target\n  FENCED_FAKE\n  ```\n\n## Target\nREAL_CONTRACT\n## Next\nNEXT_CONTENT\n",
      "utf8",
    );
    const [item] = await resolveTaskContextManifest(dir, state, {
      version: 1,
      taskId: "T-SECTION",
      items: [{
        id: "target", type: "file", reason: "Exact Target contract", priority: "required",
        scope: "section", source: "file", path: "reference.md",
        selector: { kind: "markdown-heading", heading: "Target" },
      }],
      createdAt: state.createdAt,
      updatedAt: state.createdAt,
    });

    assert.equal(item?.available, true);
    assert.match(item?.content ?? "", /^## Target\nREAL_CONTRACT\n$/);
    assert.doesNotMatch(item?.content ?? "", /FENCED_FAKE|NEXT_CONTENT/);
  });
});

test("a thematic break does not create a phantom list container", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState();
    await writeFile(
      join(dir, "reference.md"),
      "- - -\n  ```markdown\n## Target\nFENCED_FAKE\n  ```\n\n## Target\nREAL_CONTRACT\n## Next\nNEXT_CONTENT\n",
      "utf8",
    );
    const [item] = await resolveTaskContextManifest(dir, state, {
      version: 1,
      taskId: "T-SECTION",
      items: [{
        id: "target", type: "file", reason: "Exact Target contract", priority: "required",
        scope: "section", source: "file", path: "reference.md",
        selector: { kind: "markdown-heading", heading: "Target" },
      }],
      createdAt: state.createdAt,
      updatedAt: state.createdAt,
    });

    assert.equal(item?.available, true);
    assert.match(item?.content ?? "", /^## Target\nREAL_CONTRACT\n$/);
    assert.doesNotMatch(item?.content ?? "", /FENCED_FAKE|NEXT_CONTENT/);
  });
});

test("dedenting from a nested list fence restores the parent container", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState();
    await writeFile(
      join(dir, "reference.md"),
      "## Target\ncontract\n- outer\n  - inner\n\n  ```markdown\n  code\n\n## Next\nNEXT_CONTENT\n",
      "utf8",
    );
    const [item] = await resolveTaskContextManifest(dir, state, {
      version: 1,
      taskId: "T-SECTION",
      items: [{
        id: "target", type: "file", reason: "Exact Target contract", priority: "required",
        scope: "section", source: "file", path: "reference.md",
        selector: { kind: "markdown-heading", heading: "Target" },
      }],
      createdAt: state.createdAt,
      updatedAt: state.createdAt,
    });

    assert.equal(item?.available, true);
    assert.doesNotMatch(item?.content ?? "", /## Next|NEXT_CONTENT/);
  });
});

test("a lazy list paragraph preserves its container for a following fence", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState();
    await writeFile(
      join(dir, "reference.md"),
      "## Target\ncontract\n- item\ncontinued text\n  ```markdown\n  code\n\n## Next\nNEXT_CONTENT\n",
      "utf8",
    );
    const [item] = await resolveTaskContextManifest(dir, state, {
      version: 1,
      taskId: "T-SECTION",
      items: [{
        id: "target", type: "file", reason: "Exact Target contract", priority: "required",
        scope: "section", source: "file", path: "reference.md",
        selector: { kind: "markdown-heading", heading: "Target" },
      }],
      createdAt: state.createdAt,
      updatedAt: state.createdAt,
    });

    assert.equal(item?.available, true);
    assert.doesNotMatch(item?.content ?? "", /## Next|NEXT_CONTENT/);
  });
});

test("mixed space and tab list padding uses Markdown columns", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState();
    await writeFile(
      join(dir, "reference.md"),
      "## Target\ncontract\n- \t```markdown\n    code\n\n  ## Next\nNEXT_CONTENT\n",
      "utf8",
    );
    const [item] = await resolveTaskContextManifest(dir, state, {
      version: 1,
      taskId: "T-SECTION",
      items: [{
        id: "target", type: "file", reason: "Exact Target contract", priority: "required",
        scope: "section", source: "file", path: "reference.md",
        selector: { kind: "markdown-heading", heading: "Target" },
      }],
      createdAt: state.createdAt,
      updatedAt: state.createdAt,
    });

    assert.equal(item?.available, true);
    assert.doesNotMatch(item?.content ?? "", /## Next|NEXT_CONTENT/);
  });
});

for (const [description, source, selector, diagnostic] of [
  ["missing heading", "## Other\ncontent\n", { kind: "markdown-heading", heading: "Target" }, /not found/i],
  ["ambiguous heading", "## Target\nfirst\n## Target\nsecond\n", { kind: "markdown-heading", heading: "Target" }, /ambiguous/i],
  ["oversized heading", "## Target\n123456789\n", { kind: "markdown-heading", heading: "Target", maxChars: 8 }, /oversized/i],
] as const) {
  test(`file section scope reports ${description} as unavailable`, async () => {
    await withTempDir(async (dir) => {
      const state = createDefaultState();
      await writeFile(join(dir, "reference.md"), source, "utf8");
      const [item] = await resolveTaskContextManifest(dir, state, {
        version: 1,
        taskId: "T-SECTION",
        items: [{
          id: "target", type: "file", reason: "Exact Target contract", priority: "required",
          scope: "section", source: "file", path: "reference.md", selector,
        }],
        createdAt: state.createdAt,
        updatedAt: state.createdAt,
      });

      assert.equal(item?.available, false);
      assert.match(item?.diagnostic ?? "", diagnostic);
    });
  });
}

test("task context manifest round trips two selectors for the same file", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState();
    const saved = await saveTaskContextManifest(dir, {
      version: 1,
      taskId: "T-SECTION",
      items: [
        {
          id: "one", type: "file", reason: "First section", priority: "required", scope: "section",
          source: "file", path: "reference.md", selector: { kind: "markdown-heading", heading: " One ", maxChars: 200 },
        },
        {
          id: "two", type: "file", reason: "Second section", priority: "required", scope: "section",
          source: "file", path: "reference.md", selector: { kind: "markdown-heading", heading: "Two", maxChars: 300 },
        },
      ],
      createdAt: state.createdAt,
      updatedAt: state.createdAt,
    });
    const loaded = await loadTaskContextManifest(dir, "T-SECTION");

    assert.equal(saved.items[0]?.selector?.heading, "One");
    assert.deepEqual(loaded?.items.map((item) => item.selector), [
      { kind: "markdown-heading", heading: "One", maxChars: 200 },
      { kind: "markdown-heading", heading: "Two", maxChars: 300 },
    ]);
  });
});

test("file section scope without a selector is explicitly unavailable", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState();
    await writeFile(join(dir, "reference.md"), "## Target\ncontract\n", "utf8");
    const [item] = await resolveTaskContextManifest(dir, state, {
      version: 1,
      taskId: "T-SECTION",
      items: [{
        id: "target", type: "file", reason: "Exact Target contract", priority: "required",
        scope: "section", source: "file", path: "reference.md",
      }],
      createdAt: state.createdAt,
      updatedAt: state.createdAt,
    });

    assert.equal(item?.available, false);
    assert.match(item?.content ?? "", /MISSING CONTEXT.*selector/is);
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
  assert.throws(() => validateTaskContextManifest({ ...base, items: [{
    ...base.items[0]!, scope: "section", selector: { kind: "markdown-heading", heading: "", maxChars: 10 },
  }] }), /selector is invalid/);
  assert.throws(() => validateTaskContextManifest({ ...base, items: [{
    ...base.items[0]!, scope: "section", selector: { kind: "markdown-heading", heading: "Target", maxChars: 0 },
  }] }), /maxChars must be a positive finite integer/);
});

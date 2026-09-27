/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ensureTaskContextManifest, loadTaskContextManifest, resolveTaskContextManifest, saveTaskContextManifest } from "../src/context.js";
import { buildTaskAgentPrompt } from "../src/conductor.js";
import { writeMemory } from "../src/memory.js";
import {
  createMissingContextRequestsFromTaskReport,
  dispatchMissingContextRequest,
  inferMissingContextKind,
  loadMissingContextRequests,
  refreshAndUnblockMissingContext,
  resolveMissingContextRequest,
  unblockTasksWithResolvedMissingContext,
} from "../src/missing-context.js";
import { recordResearchReport } from "../src/research.js";
import { createDefaultState, loadState, saveState } from "../src/state.js";
import type { TaskAgentReportRecord } from "../src/task-reports.js";
import type { ScalerState } from "../src/types.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-missing-context-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function createState(): ScalerState {
  const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
  state.stage = "execution";
  state.tasks = [{ id: "T-MISS", title: "Needs context", status: "blocked", prdRefs: ["REQ-MISS"], updatedAt: state.createdAt }];
  state.currentTaskId = "T-MISS";
  return state;
}

function report(missingData: string[]): TaskAgentReportRecord {
  return {
    id: "T-MISS-report-1",
    type: "scaler_task_report",
    taskId: "T-MISS",
    status: "needs_data",
    summary: "Need more context.",
    changedFiles: [],
    memoryRefs: [],
    validations: [],
    validationRefs: [],
    evidenceRefs: [],
    blockers: [],
    missingData,
    source: "child-agent",
    createdAt: "2026-01-01T00:00:01.000Z",
  };
}

test("inferMissingContextKind classifies file memory internet user and local needs", () => {
  assert.equal(inferMissingContextKind("Need `src/app.ts`"), "file");
  assert.equal(inferMissingContextKind("Need memory about auth"), "memory");
  assert.equal(inferMissingContextKind("Need official docs from the internet"), "internet_research");
  assert.equal(inferMissingContextKind("Ask user which tenant"), "user");
  assert.equal(inferMissingContextKind("Need local dependency version"), "local_research");
});

test("missing-context requests are created from task reports and file dispatch resolves them", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src", "app.ts"), "export const value = 1;\n");
    const state = createState();
    state.tasks[0]!.allowedPathPrefixes = ["src"];
    await saveState(dir, state);

    const created = await createMissingContextRequestsFromTaskReport(dir, state, report(["Need `src/app.ts` before editing."]));
    assert.equal(created.created.length, 1);
    assert.equal(created.created[0]?.kind, "file");

    const result = await dispatchMissingContextRequest(dir, state, created.created[0]?.id, { execute: true });
    assert.equal(result.accepted, true, result.message);
    assert.equal(result.request?.status, "resolved");
    assert.match(result.request?.resultSummary ?? "", /src\/app\.ts/);
    const manifest = await loadTaskContextManifest(dir, "T-MISS");
    const requested = manifest?.items.find((item) => item.id === `missing-context-${created.created[0]?.id}`);
    assert.equal(requested?.source, "file");
    assert.equal(requested?.path, "src/app.ts");
    assert.equal(requested?.priority, "required");
    assert.equal(requested?.scope, "full");
    assert.ok(manifest);
    const resolved = await resolveTaskContextManifest(dir, state, manifest!);
    assert.equal(resolved.find((item) => item.id === requested?.id)?.content, "export const value = 1;\n");
    const unblocked = await unblockTasksWithResolvedMissingContext(dir, await loadState(dir));
    assert.deepEqual(unblocked.unblockedTaskIds, ["T-MISS"]);
    const nextItems = await resolveTaskContextManifest(dir, unblocked.state, (await loadTaskContextManifest(dir, "T-MISS"))!);
    const nextPrompt = buildTaskAgentPrompt({ state: unblocked.state, task: unblocked.state.tasks[0]!, contextItems: nextItems }).prompt;
    assert.match(nextPrompt, /export const value = 1;/);
    const again = await dispatchMissingContextRequest(dir, state, created.created[0]?.id, { execute: true });
    assert.equal(again.request?.status, "resolved");
    assert.equal((await loadTaskContextManifest(dir, "T-MISS"))?.items.filter((item) => item.id === requested?.id).length, 1);
  });
});

test("file missing-context dispatch delivers exact requested Markdown and function sections", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, "docs"), { recursive: true });
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "docs", "guide.md"), "# Intro\nignore\n\n## Target Section\nrequired details\n\n## Next\nexclude\n");
    await writeFile(join(dir, "src", "feature.ts"), "export const before = 1;\nexport function targetFunction() { return 42; }\nexport const after = 2;\n");
    const state = createState();
    state.tasks[0]!.allowedPathPrefixes = ["docs", "src"];
    await saveState(dir, state);

    for (const [query, expected, excluded] of [
      ["Need `docs/guide.md` `heading:Target Section` before editing.", "required details", "exclude"],
      ["Need `src/feature.ts` `function:targetFunction` before editing.", "targetFunction", "after = 2"],
    ]) {
      const created = await createMissingContextRequestsFromTaskReport(dir, state, report([query]));
      const result = await dispatchMissingContextRequest(dir, state, created.created[0]?.id, { execute: true });
      assert.equal(result.accepted, true, result.message);
      const manifest = await loadTaskContextManifest(dir, "T-MISS");
      const item = manifest?.items.find((candidate) => candidate.id === `missing-context-${created.created[0]?.id}`);
      assert.equal(item?.scope, "section");
      assert.ok(item?.selector);
      const resolved = await resolveTaskContextManifest(dir, state, manifest!);
      const content = resolved.find((candidate) => candidate.id === item?.id)?.content ?? "";
      assert.match(content, new RegExp(expected));
      assert.doesNotMatch(content, new RegExp(excluded));
    }
  });
});

test("file missing-context section requests fail closed on malformed or unavailable selectors", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, "docs"), { recursive: true });
    await writeFile(join(dir, "docs", "guide.md"), "# Duplicate\none\n\n# Duplicate\ntwo\n");
    const state = createState();
    state.tasks[0]!.allowedPathPrefixes = ["docs"];
    await saveState(dir, state);

    for (const query of [
      "Need `docs/guide.md` `heading:` before editing.",
      "Need `docs/guide.md` `heading:Duplicate` before editing.",
      "Need `docs/guide.md` `heading:Missing` before editing.",
      "Need `docs/guide.md` `heading:Duplicate` `function:other` before editing.",
    ]) {
      const created = await createMissingContextRequestsFromTaskReport(dir, state, report([query]));
      const result = await dispatchMissingContextRequest(dir, state, created.created[0]?.id, { execute: true });
      assert.equal(result.accepted, false, query);
      assert.equal(result.request?.status, "blocked", query);
      assert.equal((await loadTaskContextManifest(dir, "T-MISS"))?.items.some((item) => item.id === `missing-context-${created.created[0]?.id}`) ?? false, false);
    }
  });
});

test("file missing-context resolution refuses paths outside scope and symlinked sources", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, "src"), { recursive: true });
    await mkdir(join(dir, "other"), { recursive: true });
    await writeFile(join(dir, "other", "secret.ts"), "secret\n");
    await symlink(join(dir, "other", "secret.ts"), join(dir, "src", "linked.ts"));
    await symlink(join(dir, "other"), join(dir, "src", "linked-dir"));
    const state = createState();
    state.tasks[0]!.allowedPathPrefixes = ["src"];
    await saveState(dir, state);
    await mkdir(join(dir, "src", "directory.ts"));
    await writeFile(join(dir, "src", "oversized.ts"), "x".repeat(1024 * 1024 + 1));
    for (const source of ["other/secret.ts", "../outside.ts", join(dir, "other", "secret.ts"), ".scaler/state.json", "src/linked.ts", "src/linked-dir/secret.ts", "src/directory.ts", "src/oversized.ts", "src/missing.ts"]) {
      const created = await createMissingContextRequestsFromTaskReport(dir, state, report([`Need \`${source}\` before editing.`]));
      const result = await dispatchMissingContextRequest(dir, state, created.created[0]?.id, { execute: true });
      assert.equal(result.request?.status, "blocked", source);
    }
    const noPath = await createMissingContextRequestsFromTaskReport(dir, state, report(["Need the unknown implementation file before editing."]));
    const absent = await dispatchMissingContextRequest(dir, state, noPath.created[0]?.id, { execute: true });
    assert.equal(absent.action, "research_requested");
    assert.equal(absent.request?.status, "in_progress");
    assert.equal((await loadTaskContextManifest(dir, "T-MISS"))?.items.some((item) => item.id.startsWith("missing-context-")) ?? false, false);
  });
});

test("memory dispatch resolves from memory candidates and unblocks a task", async () => {
  await withTempDir(async (dir) => {
    const state = createState();
    await saveState(dir, state);
    await writeMemory(dir, { title: "Auth decision", content: "Use OAuth", summary: "OAuth decision", tags: ["auth"] });
    const created = await createMissingContextRequestsFromTaskReport(dir, state, report(["Need memory auth decision"]));

    const result = await dispatchMissingContextRequest(dir, state, created.created[0]?.id, { execute: true });
    assert.equal(result.accepted, true, result.message);
    const unblocked = await unblockTasksWithResolvedMissingContext(dir, await loadState(dir));
    assert.deepEqual(unblocked.unblockedTaskIds, ["T-MISS"]);
    assert.equal((await loadState(dir)).tasks[0]?.status, "ready");
  });
});

test("research dispatch creates a research request and refresh resolves from report", async () => {
  await withTempDir(async (dir) => {
    const state = createState();
    await saveState(dir, state);
    const created = await createMissingContextRequestsFromTaskReport(dir, state, report(["Need local dependency version"]));
    const dispatched = await dispatchMissingContextRequest(dir, state, created.created[0]?.id, { execute: true });
    assert.equal(dispatched.action, "research_requested");
    assert.equal(dispatched.request?.status, "in_progress");
    const researchId = dispatched.request?.evidenceRefs?.[0];
    assert.ok(researchId);

    await recordResearchReport(dir, {
      requestId: researchId,
      question: "Need local dependency version",
      status: "complete",
      taskId: "T-MISS",
      requirementRefs: ["REQ-MISS"],
      sources: [{ id: "package", title: "package.json", quality: "project", path: "package.json" }],
      conclusions: [{ summary: "Dependency version is known.", confidence: "high", sourceRefs: ["package"] }],
    });
    const refreshed = await refreshAndUnblockMissingContext(dir, await loadState(dir));
    assert.deepEqual(refreshed.unblockedTaskIds, ["T-MISS"]);
    assert.equal((await loadMissingContextRequests(dir))[0]?.status, "resolved");
    const manifest = await loadTaskContextManifest(dir, "T-MISS");
    assert.ok(manifest);
    const answer = manifest.items.find((item) => item.id === `missing-research-${created.created[0]?.id}`);
    assert.equal(answer?.priority, "required");
    assert.equal(answer?.source, "inline");
    const context = await resolveTaskContextManifest(dir, refreshed.state, manifest);
    const nextPrompt = buildTaskAgentPrompt({ state: refreshed.state, task: refreshed.state.tasks[0]!, contextItems: context }).prompt;
    assert.match(nextPrompt, /Dependency version is known/);
    assert.match(nextPrompt, /package\.json/);
    await refreshAndUnblockMissingContext(dir, await loadState(dir));
    assert.equal((await loadTaskContextManifest(dir, "T-MISS"))?.items.filter((item) => item.id === answer?.id).length, 1);
  });
});

test("research refresh does not overwrite an existing required answer identity", async () => {
  await withTempDir(async (dir) => {
    const state = createState();
    await saveState(dir, state);
    const created = await createMissingContextRequestsFromTaskReport(dir, state, report(["Need local dependency version"]));
    const dispatched = await dispatchMissingContextRequest(dir, state, created.created[0]?.id, { execute: true });
    const manifest = await ensureTaskContextManifest(dir, state, "T-MISS");
    await saveTaskContextManifest(dir, { ...manifest, items: [...manifest.items, {
      id: `missing-research-${created.created[0]!.id}`, type: "knowledge", source: "inline", priority: "required", scope: "full",
      reason: "Previous answer", content: "Conflicting earlier answer",
    }] });
    await recordResearchReport(dir, {
      requestId: dispatched.request!.evidenceRefs![0], question: "Need local dependency version", status: "complete", taskId: "T-MISS",
      sources: [{ id: "package", title: "package.json", quality: "project", path: "package.json" }],
      conclusions: [{ summary: "Version 1.0", confidence: "high", sourceRefs: ["package"] }],
    });
    const refreshed = await refreshAndUnblockMissingContext(dir, await loadState(dir));
    assert.deepEqual(refreshed.unblockedTaskIds, []);
    assert.equal((await loadMissingContextRequests(dir))[0]?.status, "in_progress");
    assert.equal((await loadTaskContextManifest(dir, "T-MISS"))?.items.find((item) => item.id.startsWith("missing-research-"))?.content, "Conflicting earlier answer");
  });
});

test("research refresh retains blockers for partial, foreign or unresolved answers", async () => {
  await withTempDir(async (dir) => {
    const state = createState();
    await saveState(dir, state);
    const created = await createMissingContextRequestsFromTaskReport(dir, state, report(["Need local dependency version"]));
    const dispatched = await dispatchMissingContextRequest(dir, state, created.created[0]?.id, { execute: true });
    const researchId = dispatched.request?.evidenceRefs?.[0];
    assert.ok(researchId);
    for (const [id, status, taskId, unknowns] of [
      ["RPT-PARTIAL", "partial", "T-MISS", []],
      ["RPT-FOREIGN", "complete", "T-OTHER", []],
      ["RPT-UNKNOWN", "complete", "T-MISS", ["Which exact version?"]],
    ] as const) {
      await recordResearchReport(dir, {
        id, requestId: researchId, question: "Need local dependency version", status, taskId,
        sources: [{ id: "package", title: "package.json", quality: "project", path: "package.json" }],
        conclusions: [{ summary: "The version might be 1.0.", confidence: "high", sourceRefs: ["package"] }],
        unresolvedUnknowns: [...unknowns],
      });
    }
    const refreshed = await refreshAndUnblockMissingContext(dir, await loadState(dir));
    assert.deepEqual(refreshed.unblockedTaskIds, []);
    assert.equal((await loadMissingContextRequests(dir))[0]?.status, "in_progress");
  });
});

test("manual resolution records evidence and can unblock", async () => {
  await withTempDir(async (dir) => {
    const state = createState();
    await saveState(dir, state);
    const created = await createMissingContextRequestsFromTaskReport(dir, state, report(["Ask user which tenant"]));
    const resolved = await resolveMissingContextRequest(dir, state, { requestId: created.created[0]!.id, summary: "Tenant is demo.", evidenceRefs: ["user:answer"] });
    assert.equal(resolved.accepted, true);
    assert.equal(resolved.request?.evidenceRefs?.includes("user:answer"), true);
    const unblocked = await unblockTasksWithResolvedMissingContext(dir, await loadState(dir));
    assert.deepEqual(unblocked.unblockedTaskIds, ["T-MISS"]);
    assert.match(await readFile(join(dir, ".scaler", "context", "missing-requests.json"), "utf8"), /Tenant is demo/);
    const manifest = await loadTaskContextManifest(dir, "T-MISS");
    assert.ok(manifest);
    const answer = manifest.items.find((item) => item.id === `missing-manual-${created.created[0]!.id}`);
    assert.equal(answer?.priority, "required");
    const context = await resolveTaskContextManifest(dir, unblocked.state, manifest);
    assert.match(buildTaskAgentPrompt({ state: unblocked.state, task: unblocked.state.tasks[0]!, contextItems: context }).prompt, /Tenant is demo/);
    await resolveMissingContextRequest(dir, unblocked.state, { requestId: created.created[0]!.id, summary: "Tenant is demo.", evidenceRefs: ["user:answer"] });
    assert.equal((await loadTaskContextManifest(dir, "T-MISS"))?.items.filter((item) => item.id === answer?.id).length, 1);
    const conflict = await resolveMissingContextRequest(dir, unblocked.state, { requestId: created.created[0]!.id, summary: "Tenant is another account." });
    assert.equal(conflict.accepted, false);
    assert.equal((await loadTaskContextManifest(dir, "T-MISS"))?.items.find((item) => item.id === answer?.id)?.content, answer?.content);
  });
});

test("manual resolution refuses exact file bypass, blank and oversized answers", async () => {
  await withTempDir(async (dir) => {
    const state = createState();
    await saveState(dir, state);
    const file = await createMissingContextRequestsFromTaskReport(dir, state, report(["Need `src/app.ts` before editing."]));
    const denied = await resolveMissingContextRequest(dir, state, { requestId: file.created[0]!.id, summary: "File is fine." });
    assert.equal(denied.accepted, false);
    const user = await createMissingContextRequestsFromTaskReport(dir, state, report(["Ask user which tenant"]));
    for (const summary of ["  ", "x".repeat(16_385)]) {
      const result = await resolveMissingContextRequest(dir, state, { requestId: user.created[0]!.id, summary });
      assert.equal(result.accepted, false);
    }
    assert.equal((await loadMissingContextRequests(dir)).every((request) => request.status !== "resolved"), true);
  });
});

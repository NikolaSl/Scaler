/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadTaskContextManifest, resolveTaskContextManifest } from "../src/context.js";
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
  });
});

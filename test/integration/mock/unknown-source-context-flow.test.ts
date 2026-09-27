/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createDefaultTaskContextManifest, loadTaskContextManifest, saveTaskContextManifest } from "../../../src/context.js";
import { dispatchMissingContextRequest, loadMissingContextRequests } from "../../../src/missing-context.js";
import { loadResearchRequests } from "../../../src/research.js";
import { createDefaultState, loadState, saveState } from "../../../src/state.js";
import type { TaskAgentRequest, TaskAgentRunResult } from "../../../src/subagents.js";
import { saveValidationManifest } from "../../../src/validation.js";
import { runConductorStep, runResearchAgentStep } from "./provider-bound-helpers.js";

function result(request: TaskAgentRequest, event: Record<string, unknown>): TaskAgentRunResult {
  return { taskId: request.taskId, exitCode: 0, stdoutEvents: [event], stderr: "", timedOut: false, aborted: false };
}

function taskReport(request: TaskAgentRequest, missingData: string[] = []): Record<string, unknown> {
  return {
    type: "scaler_task_report", taskId: request.taskId, ...request.attempt,
    status: missingData.length ? "needs_data" : "completed",
    summary: missingData.length ? "Need more context." : "Required source is available for validation.",
    changedFiles: [], memoryRefs: [], validations: [], validationRefs: [], evidenceRefs: [],
    blockers: [], missingData,
  };
}

for (const selectedPath of ["docs/guide.md", "private/secret.md"]) {
  test(`mock integration: unknown source research followed by exact section request ${selectedPath}`, async () => {
    const dir = await mkdtemp(join(tmpdir(), "scaler-unknown-source-flow-"));
    try {
      const question = "Locate the section describing ledger retry behavior.";
      const sourceText = "# Intro\nUNRELATED_PREFIX\n\n## Retry policy\nKeep the accepted ledger revision.\n\n## Other\nUNRELATED_SUFFIX\n";
      for (const path of ["docs", "private"]) await mkdir(join(dir, path));
      await writeFile(join(dir, "docs/guide.md"), sourceText);
      await writeFile(join(dir, "docs/legacy.md"), "# Legacy\nOBSOLETE_DETAILS\n");
      await writeFile(join(dir, "private/secret.md"), "## Retry policy\nOUTSIDE_SCOPE_BYTES\n");
      const state = createDefaultState();
      state.stage = "execution";
      state.tasks = [{
        id: "T-DISCOVER", title: "Validate the ledger retry contract", status: "ready",
        allowedPathPrefixes: ["docs"], definitionOfDone: ["Required source is retrieved before validation."],
        updatedAt: state.createdAt,
      }];
      state.currentTaskId = "T-DISCOVER";
      await saveState(dir, state);
      await saveValidationManifest(dir, { taskId: "T-DISCOVER", outputPaths: [], commands: [], createdAt: "", updatedAt: "" });
      await saveTaskContextManifest(dir, createDefaultTaskContextManifest(state, "T-DISCOVER"));

      const attemptIds: string[] = [];
      const first = await runConductorStep(dir, state, { execute: true }, async (request) => {
        assert.doesNotMatch(request.prompt, /docs\/guide\.md|Keep the accepted ledger revision/);
        assert.ok(request.attempt?.attemptId);
        attemptIds.push(request.attempt.attemptId);
        return result(request, taskReport(request, [question]));
      });
      assert.equal(first.accepted, true, first.message);
      assert.equal(first.validationHandoff?.status, "task_agent_report_blocked");
      const [missing] = await loadMissingContextRequests(dir);
      assert.equal(missing?.kind, "local_research");
      assert.equal(missing?.sourceHint, undefined);
      const dispatched = await dispatchMissingContextRequest(dir, await loadState(dir), missing!.id, { execute: true });
      assert.equal(dispatched.action, "research_requested");
      const [research] = await loadResearchRequests(dir);
      assert.equal(research?.scope, "local");
      assert.equal(research?.taskId, "T-DISCOVER");
      assert.equal((await loadState(dir)).tasks[0]?.status, "blocked");

      for (const status of ["partial", "complete"] as const) {
        const researched = await runResearchAgentStep(dir, await loadState(dir), {
          execute: true, requestId: research!.id, tools: ["read", "find"],
        }, async (request) => {
          assert.ok(request.prompt.includes(question));
          assert.deepEqual(request.tools, ["read", "find"]);
          return result(request, {
            type: "scaler_research_report", id: `R-DISCOVER-${status}`, requestId: research!.id,
            taskId: "T-DISCOVER", question, status,
            sources: [
              { id: "guide", title: "Current guide", quality: "project", path: "docs/guide.md" },
              { id: "legacy", title: "Legacy guide", quality: "project", path: "docs/legacy.md" },
            ],
            conclusions: [{ summary: "Candidate docs/guide.md, heading Retry policy; verify its exact bytes.", confidence: "medium", sourceRefs: ["guide", "legacy"] }],
            unresolvedUnknowns: status === "partial" ? ["Which guide applies?"] : [],
          });
        });
        assert.equal(researched.accepted, true, researched.message);
        assert.equal(researched.ingestion?.ingested, true, researched.ingestion?.reason);
        if (status === "partial") {
          let calls = 0;
          await runConductorStep(dir, await loadState(dir), { execute: true }, async (request) => {
            calls++;
            return result(request, taskReport(request));
          });
          assert.equal(calls, 0, "incomplete research must not dispatch a worker retry");
          assert.equal((await loadState(dir)).tasks[0]?.status, "blocked");
          assert.notEqual((await loadMissingContextRequests(dir))[0]?.status, "resolved");
        }
      }

      const second = await runConductorStep(dir, await loadState(dir), { execute: true }, async (request) => {
        assert.match(request.prompt, /Research answer \(reported claim, not verified source bytes\)/);
        assert.match(request.prompt, /R-DISCOVER-complete/);
        assert.match(request.prompt, /docs\/guide\.md/);
        assert.doesNotMatch(request.prompt, /Keep the accepted ledger revision|OBSOLETE_DETAILS/);
        assert.ok(request.attempt?.attemptId);
        attemptIds.push(request.attempt.attemptId);
        return result(request, taskReport(request, [`Need \`${selectedPath}\` \`heading:Retry policy\` before proceeding.`]));
      });
      assert.equal(second.validationHandoff?.status, "task_agent_report_blocked", second.message);
      assert.equal((await loadState(dir)).tasks[0]?.status, "blocked");
      const requests = await loadMissingContextRequests(dir);
      assert.equal(requests.length, 2);
      assert.equal(requests.find((entry) => entry.id === missing!.id)?.status, "resolved");
      const section = requests.find((entry) => entry.kind === "file")!;
      const retrieved = await dispatchMissingContextRequest(dir, await loadState(dir), section.id, { execute: true });
      assert.equal(retrieved.accepted, selectedPath === "docs/guide.md", retrieved.message);

      let finalCalls = 0;
      const final = await runConductorStep(dir, await loadState(dir), { execute: true }, async (request) => {
        finalCalls++;
        assert.match(request.prompt, /Keep the accepted ledger revision/);
        assert.doesNotMatch(request.prompt, /UNRELATED_PREFIX|UNRELATED_SUFFIX|OBSOLETE_DETAILS|OUTSIDE_SCOPE_BYTES/);
        assert.ok(request.attempt?.attemptId);
        attemptIds.push(request.attempt.attemptId);
        return result(request, taskReport(request));
      });
      const manifest = await loadTaskContextManifest(dir, "T-DISCOVER");
      const item = manifest?.items.find((entry) => entry.id === `missing-context-${section.id}`);
      if (selectedPath === "docs/guide.md") {
        assert.equal(finalCalls, 1);
        assert.equal(final.validationHandoff?.status, "validation_required", final.message);
        assert.equal((await loadState(dir)).tasks[0]?.status, "validating");
        assert.equal(item?.priority, "required");
        assert.equal(item?.scope, "section");
        assert.deepEqual(item?.selector, { kind: "markdown-heading", heading: "Retry policy" });
        assert.ok((await loadMissingContextRequests(dir)).every((entry) => entry.status === "resolved"));
      } else {
        assert.equal(finalCalls, 0, "research claims must not widen the task's allowed paths");
        assert.equal((await loadState(dir)).tasks[0]?.status, "blocked");
        assert.equal(retrieved.request?.status, "blocked");
        assert.equal(item, undefined);
      }
      assert.equal(new Set(attemptIds).size, attemptIds.length, "each retry must have a distinct admitted attempt");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}

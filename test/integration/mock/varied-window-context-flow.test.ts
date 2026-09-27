/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runConductorStep } from "../../../src/conductor.js";
import { createDefaultTaskContextManifest, loadTaskContextManifest, saveTaskContextManifest } from "../../../src/context.js";
import { dispatchMissingContextRequest, loadMissingContextRequests } from "../../../src/missing-context.js";
import type { ProviderAdmissionModel } from "../../../src/provider-admission.js";
import { assessTaskPromptAdmission } from "../../../src/prompt-admission.js";
import { runResearchAgentStep } from "../../../src/research-agent.js";
import { loadResearchRequests } from "../../../src/research.js";
import { createDefaultState, loadState, saveState } from "../../../src/state.js";
import type { TaskAgentRequest, TaskAgentRunResult } from "../../../src/subagents.js";
import { saveValidationManifest } from "../../../src/validation.js";

const windows = [32_768, 131_072] as const;

function result(request: TaskAgentRequest, event: Record<string, unknown>): TaskAgentRunResult {
  return { taskId: request.taskId, exitCode: 0, stdoutEvents: [event], stderr: "", timedOut: false, aborted: false };
}

function taskReport(request: TaskAgentRequest, missingData: string[] = []): Record<string, unknown> {
  return {
    type: "scaler_task_report", taskId: request.taskId, ...request.attempt,
    status: missingData.length ? "needs_data" : "completed",
    summary: missingData.length ? "Need required context." : "Required exact context is available.",
    changedFiles: [], memoryRefs: [], validations: [], validationRefs: [], evidenceRefs: [],
    blockers: [], missingData,
  };
}

function modelForWindow(contextWindow: number): ProviderAdmissionModel {
  return { api: "openai-completions", provider: "synthetic", id: `synthetic-${contextWindow}`, contextWindow };
}

for (const contextWindow of windows) {
  test(`mock integration: required exact context survives ${contextWindow}-token window`, async () => {
    const dir = await mkdtemp(join(tmpdir(), "scaler-varied-window-context-"));
    try {
      const question = "Locate the exact current retry requirement.";
      const unrelatedPrefix = "UNRELATED_PREFIX_MUST_NOT_REACH_WORKER\n".repeat(1_100);
      const unrelatedSuffix = "UNRELATED_SUFFIX_MUST_NOT_REACH_WORKER\n".repeat(1_100);
      const requiredLine = "The supervisor must preserve the accepted ledger revision.";
      const sourceText = `# Guide\n${unrelatedPrefix}\n## Retry policy\n${requiredLine}\n\n## Appendix\n${unrelatedSuffix}`;
      assert.ok(Buffer.byteLength(sourceText, "utf8") > windows[0], "whole source must exceed the smaller usable window");

      await mkdir(join(dir, "docs"));
      await writeFile(join(dir, "docs/guide.md"), sourceText);
      const state = createDefaultState();
      state.stage = "execution";
      state.tasks = [{
        id: "T-WINDOW", title: "Verify the retry requirement", status: "ready",
        allowedPathPrefixes: ["docs"], definitionOfDone: ["Use the current exact retry requirement."],
        updatedAt: state.createdAt,
      }];
      state.currentTaskId = "T-WINDOW";
      await saveState(dir, state);
      await saveValidationManifest(dir, { taskId: "T-WINDOW", outputPaths: [], commands: [], createdAt: "", updatedAt: "" });
      await saveTaskContextManifest(dir, { ...createDefaultTaskContextManifest(state, "T-WINDOW"), tokenBudget: contextWindow });

      const providerAdmissionModel = modelForWindow(contextWindow);
      const attempts: string[] = [];
      const conductorOptions = { execute: true, tokenBudget: contextWindow, providerAdmissionModel } as const;
      const first = await runConductorStep(dir, state, conductorOptions, async (request) => {
        assert.equal(request.providerAdmissionModel?.contextWindow, contextWindow);
        assert.equal(request.providerAdmission?.requestTokenAllowance, contextWindow);
        assert.equal(assessTaskPromptAdmission(request.prompt, contextWindow).accepted, true);
        assert.doesNotMatch(request.prompt, /docs\/guide\.md|accepted ledger revision/);
        attempts.push(request.attempt!.attemptId);
        return result(request, taskReport(request, [question]));
      });
      assert.equal(first.validationHandoff?.status, "task_agent_report_blocked", first.message);

      const [missing] = await loadMissingContextRequests(dir);
      assert.equal(missing?.kind, "local_research");
      const dispatched = await dispatchMissingContextRequest(dir, await loadState(dir), missing!.id, { execute: true });
      assert.equal(dispatched.action, "research_requested");
      const [research] = await loadResearchRequests(dir);
      const researched = await runResearchAgentStep(dir, await loadState(dir), {
        execute: true, requestId: research!.id, tools: ["read", "find"],
        tokenBudget: contextWindow, providerAdmissionModel,
      }, async (request) => {
        assert.equal(request.providerAdmissionModel?.contextWindow, contextWindow);
        assert.equal(assessTaskPromptAdmission(request.prompt, contextWindow).accepted, true);
        return result(request, {
          type: "scaler_research_report", id: `R-WINDOW-${contextWindow}`, requestId: research!.id,
          taskId: "T-WINDOW", question, status: "complete",
          sources: [{ id: "guide", title: "Current guide", quality: "project", path: "docs/guide.md" }],
          conclusions: [{ summary: "Use docs/guide.md heading Retry policy; exact bytes remain to be requested.", confidence: "high", sourceRefs: ["guide"] }],
          unresolvedUnknowns: [],
        });
      });
      assert.equal(researched.ingestion?.ingested, true, researched.ingestion?.reason);

      const second = await runConductorStep(dir, await loadState(dir), conductorOptions, async (request) => {
        assert.match(request.prompt, new RegExp(`R-WINDOW-${contextWindow}`));
        assert.doesNotMatch(request.prompt, new RegExp(requiredLine));
        attempts.push(request.attempt!.attemptId);
        return result(request, taskReport(request, ["Need `docs/guide.md` `heading:Retry policy` before proceeding."]));
      });
      assert.equal(second.validationHandoff?.status, "task_agent_report_blocked", second.message);

      const sectionRequest = (await loadMissingContextRequests(dir)).find((request) => request.kind === "file")!;
      const retrieved = await dispatchMissingContextRequest(dir, await loadState(dir), sectionRequest.id, { execute: true });
      assert.equal(retrieved.accepted, true, retrieved.message);

      const final = await runConductorStep(dir, await loadState(dir), conductorOptions, async (request) => {
        assert.equal(request.providerAdmissionModel?.contextWindow, contextWindow);
        assert.equal(request.providerAdmission?.requestTokenAllowance, contextWindow);
        assert.equal(assessTaskPromptAdmission(request.prompt, contextWindow).accepted, true);
        assert.match(request.prompt, new RegExp(requiredLine));
        assert.doesNotMatch(request.prompt, /UNRELATED_PREFIX_MUST_NOT_REACH_WORKER|UNRELATED_SUFFIX_MUST_NOT_REACH_WORKER/);
        attempts.push(request.attempt!.attemptId);
        return result(request, taskReport(request));
      });
      assert.equal(final.validationHandoff?.status, "validation_required", final.message);
      assert.equal((await loadState(dir)).tasks[0]?.status, "validating");
      assert.equal(new Set(attempts).size, attempts.length);

      const manifest = await loadTaskContextManifest(dir, "T-WINDOW");
      const item = manifest?.items.find((entry) => entry.id === `missing-context-${sectionRequest.id}`);
      assert.equal(item?.scope, "section");
      assert.deepEqual(item?.selector, { kind: "markdown-heading", heading: "Retry policy" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}

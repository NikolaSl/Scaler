/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { readLogEvents } from "../../../src/logging.js";
import { loadMemoryIndex } from "../../../src/memory.js";
import { loadResearchAgentRunRecords, runResearchAgentStep } from "../../../src/research-agent.js";
import { loadResearchReports, upsertResearchRequest } from "../../../src/research.js";
import { loadResearchWebTransactions, runResearchWebWorkflow } from "../../../src/research-web.js";
import { createDefaultState, saveState } from "../../../src/state.js";
import type { TaskAgentRequest, TaskAgentRunResult } from "../../../src/subagents.js";
import { recordToolSchema } from "../../../src/tool-requests.js";

const execFileAsync = promisify(execFile);

async function withTempRepo<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-research-internet-grant-integration-test-"));
  try {
    await execFileAsync("git", ["init"], { cwd: dir });
    await execFileAsync("git", ["config", "user.email", "scaler-test@example.invalid"], { cwd: dir });
    await execFileAsync("git", ["config", "user.name", "Scaler Test"], { cwd: dir });
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "package.json"), JSON.stringify({ type: "module" }, null, 2));
    await writeFile(join(dir, "src/app.js"), "export const value = 1;\n");
    await execFileAsync("git", ["add", "package.json", "src/app.js"], { cwd: dir });
    await execFileAsync("git", ["commit", "-m", "initial fixture"], { cwd: dir });
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("mock integration: web research workflow discovers tools and records query/source transactions", async () => {
  await withTempRepo(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    state.stage = "knowledge";
    await saveState(dir, state);
    await upsertResearchRequest(dir, {
      id: "RESEARCH-WEB-TXN",
      question: "Which external API is current?",
      reason: "Need official external documentation.",
      scope: "internet",
    }, new Date("2026-01-01T00:00:00.000Z"));
    await recordToolSchema(dir, state, {
      toolName: "mcp_docs_search",
      source: "mcp://docs/schema",
      description: "Search official docs.",
      riskLevel: "external",
      schemaRef: "schema:mcp-docs-search",
    });

    const result = await runResearchWebWorkflow(dir, state, { requestId: "RESEARCH-WEB-TXN", execute: true, allowInternet: true, maxQueries: 2 }, async (request) => {
      assert.deepEqual(request.tools, ["mcp_docs_search"]);
      assert.match(request.prompt, /multi-step web research transaction/);
      assert.match(request.prompt, /official documentation/);
      return {
        taskId: request.taskId,
        exitCode: 0,
        stdoutEvents: [{
          type: "scaler_research_report",
          requestId: "RESEARCH-WEB-TXN",
          question: "Which external API is current?",
          status: "complete",
          sources: [{ id: "official", title: "Official API docs", quality: "official", url: "https://example.invalid/api", version: "v1", checkedAt: "2026-01-01T00:00:00.000Z", summary: "Versioned API reference." }],
          conclusions: [{ summary: "Use the versioned official API reference.", confidence: "high", sourceRefs: ["official"] }],
          rawEvidence: [{ title: "Official excerpt", content: "Use /v1/widgets for current widgets.", sourceId: "official" }],
        }],
        stderr: "",
        timedOut: false,
        aborted: false,
      };
    });

    assert.equal(result.accepted, true);
    assert.equal(result.tools[0], "mcp_docs_search");
    const transactions = await loadResearchWebTransactions(dir);
    assert.ok(transactions.some((transaction) => transaction.kind === "tool_discovery" && transaction.status === "completed"));
    assert.ok(transactions.some((transaction) => transaction.kind === "query" && transaction.status === "completed"));
    assert.ok(transactions.some((transaction) => transaction.kind === "source_review" && transaction.freshnessStatus === "versioned"));
    assert.equal((await loadMemoryIndex(dir)).entries.length, 1);
  });
});

test("mock integration: internet research tools are withheld until explicitly granted", async () => {
  await withTempRepo(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    state.stage = "knowledge";
    await saveState(dir, state);
    await upsertResearchRequest(dir, {
      id: "RESEARCH-WEB",
      question: "Which external API is current?",
      reason: "Need official external documentation.",
      scope: "internet",
    }, new Date("2026-01-01T00:00:00.000Z"));

    const prepared = await runResearchAgentStep(dir, state, { requestId: "RESEARCH-WEB", tools: ["browser", "mcp-docs"] });
    assert.equal(prepared.accepted, true);
    assert.equal(prepared.invocation?.args.includes("--tools"), false);
    assert.match(prepared.prompt ?? "", /internet tools are not explicitly granted/);

    const runner = async (request: TaskAgentRequest): Promise<TaskAgentRunResult> => {
      assert.deepEqual(request.tools, ["browser", "mcp-docs"]);
      assert.match(request.prompt, /explicit internet grant/);
      assert.match(request.prompt, /Granted tools=browser, mcp-docs/);
      return {
        taskId: request.taskId,
        exitCode: 0,
        stdoutEvents: [{
          type: "scaler_research_report",
          requestId: "RESEARCH-WEB",
          question: "Which external API is current?",
          status: "complete",
          sources: [{ id: "official", title: "Official API docs", quality: "official", url: "https://example.invalid/api", summary: "Versioned API reference." }],
          conclusions: [{ summary: "Use the versioned official API reference.", confidence: "high", sourceRefs: ["official"] }],
          rawEvidence: [{ title: "Official excerpt", content: "Use /v1/widgets for current widgets.", sourceId: "official" }],
        }],
        stderr: "",
        timedOut: false,
        aborted: false,
      };
    };

    const executed = await runResearchAgentStep(dir, state, { requestId: "RESEARCH-WEB", execute: true, allowInternet: true, tools: ["browser", "mcp-docs"] }, runner);
    assert.equal(executed.accepted, true);
    assert.ok(executed.invocation?.args.includes("--tools"));
    assert.ok(executed.invocation?.args.includes("browser,mcp-docs"));
    assert.equal(executed.ingestion?.ingested, true);

    const report = (await loadResearchReports(dir))[0];
    assert.equal(report?.requestId, "RESEARCH-WEB");
    assert.equal(report?.sources[0]?.url, "https://example.invalid/api");
    assert.equal((await loadMemoryIndex(dir)).entries.length, 1);

    const runs = await loadResearchAgentRunRecords(dir);
    assert.deepEqual(runs.map((run) => run.status), ["passed", "prepared"]);

    const events = await readLogEvents(dir);
    const agentEvents = events.filter((event) => event.eventType === "agent" && event.detailsPath);
    assert.equal(agentEvents.length >= 2, true);
    const detailPath = agentEvents[agentEvents.length - 1]?.detailsPath ?? "";
    const latestAgentDetail = JSON.parse(await readFile(detailPath.startsWith("/") ? detailPath : join(dir, detailPath), "utf8")) as { payload?: { details?: { invocation?: { args?: string[] }; scope?: string } } };
    assert.equal(latestAgentDetail.payload?.details?.scope, "internet");
    assert.ok(latestAgentDetail.payload?.details?.invocation?.args?.includes("browser,mcp-docs"));
  });
});

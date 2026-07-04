import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseBudgetSetArgs,
  parseCommaList,
  parseCommitArgs,
  parseContextTaskArgs,
  parseDebugLoopArgs,
  parseDebugRunArgs,
  parseDebugRetryArgs,
  parsePrdLinkArgs,
  parseReplanRequestArgs,
  parseReplanRunArgs,
  parseResearchReportArgs,
  parseResearchRequestArgs,
  parseResearchRunArgs,
  parseTaskCreateArgs,
  parseTaskUpdateArgs,
  parseTaskRetryArgs,
  parseToolCatalogArgs,
  parseToolDiscoverArgs,
  parseToolReplayArgs,
  parseToolRunArgs,
  parseValidateLoopArgs,
  parseValidationChecklistArgs,
  parseStageLoopArgs,
  parseStageRecordArgs,
  parseStorageMaintainArgs,
  parseStageRunArgs,
  parseValidationAddArgs,
  resolveCommitAllowedPaths,
  selectTaskForCommit,
} from "../src/commands.js";
import { createDefaultState } from "../src/state.js";

test("parseTaskCreateArgs parses task id only", () => {
  assert.deepEqual(parseTaskCreateArgs("T-001"), {
    taskId: "T-001",
    title: undefined,
    allowedPathPrefixes: undefined,
    dependsOn: undefined,
    prdRefs: undefined,
  });
});

test("parseTaskCreateArgs parses title, allowed paths, dependencies, and PRD refs", () => {
  assert.deepEqual(parseTaskCreateArgs("T-001 | Add parser | src, test | T-000, T-BASE | REQ-001, REQ-002"), {
    taskId: "T-001",
    title: "Add parser",
    allowedPathPrefixes: ["src", "test"],
    dependsOn: ["T-000", "T-BASE"],
    prdRefs: ["REQ-001", "REQ-002"],
  });
});

test("parseTaskUpdateArgs parses task update fields", () => {
  assert.deepEqual(parseTaskUpdateArgs("T-001 | New title | ready | src,test | T-000 | REQ-001"), {
    taskId: "T-001",
    title: "New title",
    status: "ready",
    allowedPathPrefixes: ["src", "test"],
    dependsOn: ["T-000"],
    prdRefs: ["REQ-001"],
  });
});

test("parseTaskRetryArgs parses optional task and reason", () => {
  assert.deepEqual(parseTaskRetryArgs("T-001 | rerun after fix"), { taskId: "T-001", reason: "rerun after fix" });
  assert.deepEqual(parseTaskRetryArgs(""), { taskId: undefined, reason: undefined });
});

test("parsePrdLinkArgs parses task id and PRD refs", () => {
  assert.deepEqual(parsePrdLinkArgs("T-001 | REQ-001, REQ-002"), { taskId: "T-001", prdRefs: ["REQ-001", "REQ-002"] });
  assert.equal(parsePrdLinkArgs("T-001"), undefined);
  assert.equal(parsePrdLinkArgs(" | REQ-001"), undefined);
});

test("parseValidationAddArgs parses manifest command fields", () => {
  assert.deepEqual(parseValidationAddArgs("T-001 | test | npm test | Run tests | optional | unit | exits 0 | ev:1, ev:2 | docker | skipped:not needed on docs-only change"), {
    taskId: "T-001",
    id: "test",
    command: "npm test",
    description: "Run tests",
    required: false,
    gate: "unit",
    expectedResult: "exits 0",
    evidenceRefs: ["ev:1", "ev:2"],
    environment: "docker",
    disposition: "skipped",
    dispositionReason: "not needed on docs-only change",
  });
});

test("parseValidationAddArgs requires task, id, and command", () => {
  assert.equal(parseValidationAddArgs("T-001 | test"), undefined);
});

test("parseBudgetSetArgs parses key and optional numeric limits", () => {
  assert.deepEqual(parseBudgetSetArgs("validationLoops | 1 | 2"), { key: "validationLoops", soft: 1, hard: 2 });
  assert.deepEqual(parseBudgetSetArgs("estimatedCostMicros | - | 5000"), { key: "estimatedCostMicros", soft: undefined, hard: 5000 });
  assert.deepEqual(parseBudgetSetArgs("toolCalls | nope | -1"), { key: "toolCalls", soft: undefined, hard: undefined });
  assert.equal(parseBudgetSetArgs(" "), undefined);
});

test("parseValidationChecklistArgs parses checklist fields and items", () => {
  assert.deepEqual(parseValidationChecklistArgs("T-1 | completeness | Check complete | scope::passed::required::Scope covered::evidence-scope;edge::failed::optional::Edge cases documented::evidence-edge | evidence-root"), {
    taskId: "T-1",
    gate: "completeness",
    summary: "Check complete",
    items: [
      { id: "scope", status: "passed", required: true, statement: "Scope covered", evidenceRefs: ["evidence-scope"], notes: undefined },
      { id: "edge", status: "failed", required: false, statement: "Edge cases documented", evidenceRefs: ["evidence-edge"], notes: undefined },
    ],
    evidenceRefs: ["evidence-root"],
  });
  assert.equal(parseValidationChecklistArgs("T-1 | completeness | missing items"), undefined);
});

test("parseValidateLoopArgs parses optional task, execute flag, and max option", () => {
  assert.deepEqual(parseValidateLoopArgs("T-001 execute max=3"), { taskId: "T-001", execute: true, maxSteps: 3 });
  assert.deepEqual(parseValidateLoopArgs("execute max=2"), { taskId: undefined, execute: true, maxSteps: 2 });
  assert.deepEqual(parseValidateLoopArgs("max=bad"), { taskId: undefined, execute: false, maxSteps: undefined });
  assert.deepEqual(parseValidateLoopArgs(" "), { taskId: undefined, execute: false, maxSteps: undefined });
});

test("parseStorageMaintainArgs parses execute, compression, cache, rotation, and thresholds", () => {
  assert.deepEqual(parseStorageMaintainArgs("execute compress delete-cache rotate-active delete-archives min-age-days=3 min-size=128 max-active-bytes=256 min-free-bytes=512 max-archive-bytes=1024 max-archive-age-days=30"), { execute: true, compress: true, deleteCache: true, minAgeDays: 3, minSizeBytes: 128, rotateActive: true, maxActiveBytes: 256, minFreeBytes: 512, deleteArchives: true, maxArchiveBytes: 1024, maxArchiveAgeDays: 30 });
  assert.deepEqual(parseStorageMaintainArgs("no-compress min-size=bad max-active-bytes=bad min-free-bytes=bad max-archive-bytes=bad max-archive-age-days=bad"), { execute: false, compress: false, deleteCache: false, minAgeDays: undefined, minSizeBytes: undefined, rotateActive: false, maxActiveBytes: undefined, minFreeBytes: undefined, deleteArchives: false, maxArchiveBytes: undefined, maxArchiveAgeDays: undefined });
  assert.deepEqual(parseStorageMaintainArgs(" "), { execute: false, compress: true, deleteCache: false, minAgeDays: undefined, minSizeBytes: undefined, rotateActive: false, maxActiveBytes: undefined, minFreeBytes: undefined, deleteArchives: false, maxArchiveBytes: undefined, maxArchiveAgeDays: undefined });
});

test("parseTaskCreateArgs returns undefined without task id", () => {
  assert.equal(parseTaskCreateArgs("  "), undefined);
});

test("parseCommaList removes blanks", () => {
  assert.deepEqual(parseCommaList("src, , test "), ["src", "test"]);
});

test("parseContextTaskArgs parses optional task id", () => {
  assert.deepEqual(parseContextTaskArgs(" T-001 "), { taskId: "T-001" });
  assert.deepEqual(parseContextTaskArgs(" "), { taskId: undefined });
});

test("parseStageRunArgs parses stage and execute flag", () => {
  assert.deepEqual(parseStageRunArgs("planning execute"), { stage: "planning", execute: true });
  assert.deepEqual(parseStageRunArgs(" "), { stage: undefined, execute: false });
});

test("parseStageLoopArgs parses execute and max options", () => {
  assert.deepEqual(parseStageLoopArgs("execute max=7"), { execute: true, maxSteps: 7 });
  assert.deepEqual(parseStageLoopArgs("max=bad"), { execute: false, maxSteps: undefined });
  assert.deepEqual(parseStageLoopArgs(" "), { execute: false, maxSteps: undefined });
});

test("parseStageRecordArgs parses stage artifact fields", () => {
  assert.deepEqual(parseStageRecordArgs("planning | ready | Plan | .scaler/plans/current-plan.json | OK | ev:1,ev:2 | PRD-S01 | T-001"), {
    stage: "planning",
    status: "ready",
    title: "Plan",
    path: ".scaler/plans/current-plan.json",
    summary: "OK",
    evidenceRefs: ["ev:1", "ev:2"],
    requirementRefs: ["PRD-S01"],
    taskRefs: ["T-001"],
  });
  assert.equal(parseStageRecordArgs("  "), undefined);
});

test("parseReplanRequestArgs parses reason, task, evidence, and requirements", () => {
  assert.deepEqual(parseReplanRequestArgs("Need replan | T-001 | run-1, log-2 | REQ-001, REQ-002"), {
    reason: "Need replan",
    taskId: "T-001",
    evidenceRefs: ["run-1", "log-2"],
    requirementRefs: ["REQ-001", "REQ-002"],
  });
  assert.equal(parseReplanRequestArgs(" "), undefined);
});

test("parseReplanRunArgs parses execute flag", () => {
  assert.deepEqual(parseReplanRunArgs("execute"), { execute: true });
  assert.deepEqual(parseReplanRunArgs(" "), { execute: false });
});

test("parseResearchRunArgs parses optional request, execute, internet grant, and tool list", () => {
  assert.deepEqual(parseResearchRunArgs("RESEARCH-001 execute"), { requestId: "RESEARCH-001", execute: true, allowInternet: false, tools: undefined });
  assert.deepEqual(parseResearchRunArgs("execute internet tools=browser,mcp-docs RESEARCH-002"), { requestId: "RESEARCH-002", execute: true, allowInternet: true, tools: ["browser", "mcp-docs"] });
  assert.deepEqual(parseResearchRunArgs("execute"), { requestId: undefined, execute: true, allowInternet: false, tools: undefined });
  assert.deepEqual(parseResearchRunArgs(" "), { requestId: undefined, execute: false, allowInternet: false, tools: undefined });
});

test("parseToolRunArgs parses optional request and execute flag", () => {
  assert.deepEqual(parseToolRunArgs("REQ-1 execute"), { requestId: "REQ-1", execute: true });
  assert.deepEqual(parseToolRunArgs("execute"), { requestId: undefined, execute: true });
  assert.deepEqual(parseToolRunArgs(" "), { requestId: undefined, execute: false });
});

test("parseToolReplayArgs parses optional transaction and execute flag", () => {
  assert.deepEqual(parseToolReplayArgs("TXN-1 execute"), { transactionId: "TXN-1", execute: true });
  assert.deepEqual(parseToolReplayArgs("execute"), { transactionId: undefined, execute: true });
  assert.deepEqual(parseToolReplayArgs(" "), { transactionId: undefined, execute: false });
});

test("parseToolCatalogArgs parses optional tool name", () => {
  assert.deepEqual(parseToolCatalogArgs("mcp_docs_search"), { toolName: "mcp_docs_search" });
  assert.deepEqual(parseToolCatalogArgs(" "), { toolName: undefined });
});

test("parseToolDiscoverArgs parses target, execute, and explicit tools", () => {
  assert.deepEqual(parseToolDiscoverArgs("mcp_docs_search execute tools=read,bash"), { toolName: "mcp_docs_search", execute: true, tools: ["read", "bash"] });
  assert.deepEqual(parseToolDiscoverArgs("execute tools=read"), { toolName: undefined, execute: true, tools: ["read"] });
  assert.deepEqual(parseToolDiscoverArgs("mcp_docs_search"), { toolName: "mcp_docs_search", execute: false, tools: undefined });
});

test("parseDebugRunArgs parses optional task and execute flag", () => {
  assert.deepEqual(parseDebugRunArgs("T-001 execute"), { taskId: "T-001", execute: true });
  assert.deepEqual(parseDebugRunArgs("execute"), { taskId: undefined, execute: true });
  assert.deepEqual(parseDebugRunArgs(" "), { taskId: undefined, execute: false });
});

test("parseDebugRetryArgs parses optional task and execute flag", () => {
  assert.deepEqual(parseDebugRetryArgs("T-001 execute"), { taskId: "T-001", execute: true });
  assert.deepEqual(parseDebugRetryArgs("execute"), { taskId: undefined, execute: true });
  assert.deepEqual(parseDebugRetryArgs(" "), { taskId: undefined, execute: false });
});

test("parseDebugLoopArgs parses optional task, execute flag, and max option", () => {
  assert.deepEqual(parseDebugLoopArgs("T-001 execute max=4"), { taskId: "T-001", execute: true, maxSteps: 4 });
  assert.deepEqual(parseDebugLoopArgs("execute max=2"), { taskId: undefined, execute: true, maxSteps: 2 });
  assert.deepEqual(parseDebugLoopArgs("max=bad"), { taskId: undefined, execute: false, maxSteps: undefined });
  assert.deepEqual(parseDebugLoopArgs(" "), { taskId: undefined, execute: false, maxSteps: undefined });
});

test("parseResearchRequestArgs parses research request fields", () => {
  assert.deepEqual(parseResearchRequestArgs("Question? | Need answer | T-001 | REQ-001,REQ-002 | mixed"), {
    question: "Question?",
    reason: "Need answer",
    taskId: "T-001",
    requirementRefs: ["REQ-001", "REQ-002"],
    scope: "mixed",
  });
  assert.equal(parseResearchRequestArgs(" "), undefined);
});

test("parseResearchReportArgs parses compact report fields", () => {
  assert.deepEqual(parseResearchReportArgs("Question? | Conclusion | high | src-1 | Docs | official | https://example.invalid | RESEARCH-001 | T-001 | REQ-001"), {
    question: "Question?",
    conclusion: "Conclusion",
    confidence: "high",
    sourceId: "src-1",
    sourceTitle: "Docs",
    sourceQuality: "official",
    sourceRef: "https://example.invalid",
    requestId: "RESEARCH-001",
    taskId: "T-001",
    requirementRefs: ["REQ-001"],
  });
  assert.equal(parseResearchReportArgs("Question only"), undefined);
});

test("parseCommitArgs parses optional task and paths", () => {
  assert.deepEqual(parseCommitArgs("T-001 | src,test"), { taskId: "T-001", allowedPathPrefixes: ["src", "test"] });
  assert.deepEqual(parseCommitArgs(""), { taskId: undefined, allowedPathPrefixes: undefined });
});

test("selectTaskForCommit prefers requested, current validated, then first validated", () => {
  const state = createDefaultState();
  state.currentTaskId = "T-002";
  state.tasks = [
    { id: "T-001", status: "validated", updatedAt: state.createdAt },
    { id: "T-002", status: "validated", updatedAt: state.createdAt },
  ];

  assert.equal(selectTaskForCommit(state, "T-999"), "T-999");
  assert.equal(selectTaskForCommit(state), "T-002");
  state.currentTaskId = null;
  assert.equal(selectTaskForCommit(state), "T-001");
});

test("resolveCommitAllowedPaths prefers explicit paths over task paths", () => {
  const state = createDefaultState();
  state.tasks = [{ id: "T-001", status: "validated", allowedPathPrefixes: ["src"], updatedAt: state.createdAt }];

  assert.deepEqual(resolveCommitAllowedPaths(state, "T-001", ["test"]), ["test"]);
  assert.deepEqual(resolveCommitAllowedPaths(state, "T-001"), ["src"]);
  assert.deepEqual(resolveCommitAllowedPaths(state, "missing"), []);
});

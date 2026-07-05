import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseBudgetSetArgs,
  parseCicdEnvArgs,
  parseCommaList,
  parseSemicolonList,
  parseCommitArgs,
  parseCommitSkipArgs,
  parseContextApproveArgs,
  parseContextCandidatesArgs,
  parseContextTaskArgs,
  parseDebugLoopArgs,
  parseDebugRunArgs,
  parseDebugRetryApprovalArgs,
  parseDebugRetryArgs,
  parseDebugRetryPolicyArgs,
  parseMemorySearchArgs,
  parseMissingContextResolveArgs,
  parseMissingContextRunArgs,
  parsePrdLinkArgs,
  parseReplanRequestArgs,
  parseReplanRunArgs,
  parseResearchReportArgs,
  parseResearchRequestArgs,
  parseResearchRunArgs,
  parseResearchWebArgs,
  parseSafetyApprovalArgs,
  parseSafetyPolicyArgs,
  parseSafetyScanArgs,
  parseTaskCreateArgs,
  parseTaskUpdateArgs,
  parseTaskRetryArgs,
  parseToolCatalogArgs,
  parseToolDiscoverArgs,
  parseToolIterateArgs,
  parseToolIterationPolicyArgs,
  parseToolReplayApprovalArgs,
  parseToolReplayArgs,
  parseToolRunArgs,
  parseToolScheduleArgs,
  parseValidateLoopArgs,
  parseValidationChecklistArgs,
  parseStageLoopArgs,
  parseStageRecordArgs,
  parseStageWorkflowArgs,
  parseStorageMaintainArgs,
  parseStorageScheduleArgs,
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
    definitionOfDone: undefined,
    taskKind: undefined,
    atomicityRationale: undefined,
    validationRefs: undefined,
    qualityWaivers: undefined,
  });
});

test("parseTaskCreateArgs parses title, allowed paths, dependencies, PRD refs, and DoD", () => {
  assert.deepEqual(parseTaskCreateArgs("T-001 | Add parser | src, test | T-000, T-BASE | REQ-001, REQ-002 | tests pass; docs updated"), {
    taskId: "T-001",
    title: "Add parser",
    allowedPathPrefixes: ["src", "test"],
    dependsOn: ["T-000", "T-BASE"],
    prdRefs: ["REQ-001", "REQ-002"],
    definitionOfDone: ["tests pass", "docs updated"],
    taskKind: undefined,
    atomicityRationale: undefined,
    validationRefs: undefined,
    qualityWaivers: undefined,
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
    definitionOfDone: undefined,
    taskKind: undefined,
    atomicityRationale: undefined,
    validationRefs: undefined,
    qualityWaivers: undefined,
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

test("parseMemorySearchArgs parses query and filters", () => {
  assert.deepEqual(parseMemorySearchArgs("refresh token tag=api,auth task=T-1 validity=active limit=3 include-obsolete"), {
    query: "refresh token",
    tags: ["api", "auth"],
    taskId: "T-1",
    validity: "active",
    includeObsolete: true,
    limit: 3,
  });
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
  assert.deepEqual(parseStorageMaintainArgs("execute compress delete-cache rotate-active delete-archives delete-raw-logs delete-memory min-age-days=3 min-size=128 max-active-bytes=256 min-free-bytes=512 max-archive-bytes=1024 max-archive-age-days=30 max-raw-log-bytes=2048 max-raw-log-age-days=31 max-memory-bytes=4096 max-memory-age-days=32"), { execute: true, compress: true, deleteCache: true, minAgeDays: 3, minSizeBytes: 128, rotateActive: true, maxActiveBytes: 256, minFreeBytes: 512, deleteArchives: true, maxArchiveBytes: 1024, maxArchiveAgeDays: 30, deleteRawLogs: true, maxRawLogBytes: 2048, maxRawLogAgeDays: 31, deleteMemory: true, maxMemoryBytes: 4096, maxMemoryAgeDays: 32 });
  assert.deepEqual(parseStorageMaintainArgs("no-compress min-size=bad max-active-bytes=bad min-free-bytes=bad max-archive-bytes=bad max-archive-age-days=bad max-raw-log-bytes=bad max-raw-log-age-days=bad max-memory-bytes=bad max-memory-age-days=bad"), { execute: false, compress: false, deleteCache: false, minAgeDays: undefined, minSizeBytes: undefined, rotateActive: false, maxActiveBytes: undefined, minFreeBytes: undefined, deleteArchives: false, maxArchiveBytes: undefined, maxArchiveAgeDays: undefined, deleteRawLogs: false, maxRawLogBytes: undefined, maxRawLogAgeDays: undefined, deleteMemory: false, maxMemoryBytes: undefined, maxMemoryAgeDays: undefined });
  assert.deepEqual(parseStorageMaintainArgs(" "), { execute: false, compress: true, deleteCache: false, minAgeDays: undefined, minSizeBytes: undefined, rotateActive: false, maxActiveBytes: undefined, minFreeBytes: undefined, deleteArchives: false, maxArchiveBytes: undefined, maxArchiveAgeDays: undefined, deleteRawLogs: false, maxRawLogBytes: undefined, maxRawLogAgeDays: undefined, deleteMemory: false, maxMemoryBytes: undefined, maxMemoryAgeDays: undefined });
});

test("parseStorageScheduleArgs parses schedule toggles and policy", () => {
  assert.deepEqual(parseStorageScheduleArgs("enable run force execute=on interval-hours=12 compress=off delete-cache=on rotate-active=on delete-archives=off delete-raw-logs=on delete-memory=off min-age-days=3 min-size=128 max-active-bytes=256 min-free-bytes=512 max-archive-bytes=1024 max-archive-age-days=30 max-raw-log-bytes=2048 max-raw-log-age-days=31 max-memory-bytes=4096 max-memory-age-days=32"), {
    enabled: true,
    run: true,
    force: true,
    intervalHours: 12,
    execute: true,
    compress: false,
    deleteCache: true,
    minAgeDays: 3,
    minSizeBytes: 128,
    rotateActive: true,
    maxActiveBytes: 256,
    minFreeBytes: 512,
    deleteArchives: false,
    maxArchiveBytes: 1024,
    maxArchiveAgeDays: 30,
    deleteRawLogs: true,
    maxRawLogBytes: 2048,
    maxRawLogAgeDays: 31,
    deleteMemory: false,
    maxMemoryBytes: 4096,
    maxMemoryAgeDays: 32,
  });
  assert.deepEqual(parseStorageScheduleArgs("disable execute=off rotate-active=off interval-hours=bad"), {
    enabled: false,
    run: false,
    force: false,
    intervalHours: undefined,
    execute: false,
    compress: undefined,
    deleteCache: undefined,
    minAgeDays: undefined,
    minSizeBytes: undefined,
    rotateActive: false,
    maxActiveBytes: undefined,
    minFreeBytes: undefined,
    deleteArchives: undefined,
    maxArchiveBytes: undefined,
    maxArchiveAgeDays: undefined,
    deleteRawLogs: undefined,
    maxRawLogBytes: undefined,
    maxRawLogAgeDays: undefined,
    deleteMemory: undefined,
    maxMemoryBytes: undefined,
    maxMemoryAgeDays: undefined,
  });
});

test("parseSafetyPolicyArgs parses explicit allow toggles", () => {
  assert.deepEqual(parseSafetyPolicyArgs("allow-internet=on allow-external=off allow-sandbox=on"), { allowInternet: true, allowExternalMutations: false, allowSandbox: true });
  assert.deepEqual(parseSafetyPolicyArgs("allow-internet=deny allow-external=allowed allow-sandbox=off"), { allowInternet: false, allowExternalMutations: true, allowSandbox: false });
  assert.deepEqual(parseSafetyPolicyArgs(" "), { allowInternet: undefined, allowExternalMutations: undefined, allowSandbox: undefined });
});

test("parseSafetyApprovalArgs parses approval and revocation workflows", () => {
  assert.deepEqual(parseSafetyApprovalArgs("approve | bash | exact_command | npm publish --dry-run | external | Release dry run | max-uses=2 ttl-minutes=30 sandbox=off"), {
    action: "approve",
    toolName: "bash",
    match: "exact_command",
    value: "npm publish --dry-run",
    risk: "external",
    reason: "Release dry run",
    sandboxOnly: false,
    maxUses: 2,
    ttlMinutes: 30,
  });
  assert.deepEqual(parseSafetyApprovalArgs("revoke | approval-1 | no longer needed"), { action: "revoke", id: "approval-1", reason: "no longer needed" });
  assert.deepEqual(parseSafetyApprovalArgs(" "), { action: "list" });
});

test("parseSafetyScanArgs parses execute flag and kind filters", () => {
  assert.deepEqual(parseSafetyScanArgs("execute kinds=npm_audit,trivy_fs"), { execute: true, kinds: ["npm_audit", "trivy_fs"] });
  assert.deepEqual(parseSafetyScanArgs(" "), { execute: false, kinds: undefined });
});

test("parseCicdEnvArgs parses environment provisioning fields", () => {
  assert.deepEqual(parseCicdEnvArgs("docker | npm test | T-1 | ci | node | execute scan=off"), {
    environment: "docker",
    validationCommand: "npm test",
    taskId: "T-1",
    commandId: "ci",
    stack: "node",
    execute: true,
    runScanners: false,
  });
  assert.deepEqual(parseCicdEnvArgs("local_ci"), {
    environment: "local_ci",
    validationCommand: undefined,
    taskId: undefined,
    commandId: undefined,
    stack: undefined,
    execute: false,
    runScanners: true,
  });
});

test("parseTaskCreateArgs returns undefined without task id", () => {
  assert.equal(parseTaskCreateArgs("  "), undefined);
});

test("parseCommaList removes blanks", () => {
  assert.deepEqual(parseCommaList("src, , test "), ["src", "test"]);
});

test("parseSemicolonList removes blanks", () => {
  assert.deepEqual(parseSemicolonList("tests pass; ; docs updated "), ["tests pass", "docs updated"]);
});

test("parseContextTaskArgs parses optional task id", () => {
  assert.deepEqual(parseContextTaskArgs(" T-001 "), { taskId: "T-001" });
  assert.deepEqual(parseContextTaskArgs(" "), { taskId: undefined });
});

test("parseContextCandidatesArgs and parseContextApproveArgs parse curation commands", () => {
  assert.deepEqual(parseContextCandidatesArgs("T-001 semantic hook limit=7"), { taskId: "T-001", query: "semantic hook", limit: 7 });
  assert.deepEqual(parseContextCandidatesArgs(" "), { taskId: undefined, query: undefined, limit: undefined });
  assert.deepEqual(parseContextApproveArgs("T-001 candidate-memory-MEM-1 semantic hook"), {
    taskId: "T-001",
    candidateId: "candidate-memory-MEM-1",
    query: "semantic hook",
  });
});

test("parseMissingContextRunArgs parses request, execute, and internet flags", () => {
  assert.deepEqual(parseMissingContextRunArgs("MCTX-1 execute internet"), { requestId: "MCTX-1", execute: true, allowInternet: true });
  assert.deepEqual(parseMissingContextRunArgs(" "), { requestId: undefined, execute: false, allowInternet: false });
});

test("parseMissingContextResolveArgs parses manual resolution fields", () => {
  assert.deepEqual(parseMissingContextResolveArgs("MCTX-1 | Answer supplied | ev:1, ev:2"), { requestId: "MCTX-1", summary: "Answer supplied", evidenceRefs: ["ev:1", "ev:2"] });
  assert.equal(parseMissingContextResolveArgs("MCTX-1"), undefined);
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

test("parseStageWorkflowArgs parses bounded coordinator options", () => {
  assert.deepEqual(parseStageWorkflowArgs("execute max=9 research=3 requests=4 internet tools=web,scaler auto-accept-replan=off"), {
    execute: true,
    maxSteps: 9,
    maxResearchRequests: 4,
    maxResearchAgents: 3,
    allowInternet: true,
    tools: ["web", "scaler"],
    autoAcceptReplan: false,
  });
  assert.deepEqual(parseStageWorkflowArgs(" "), {
    execute: false,
    maxSteps: undefined,
    maxResearchRequests: undefined,
    maxResearchAgents: undefined,
    allowInternet: false,
    tools: undefined,
    autoAcceptReplan: undefined,
  });
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

test("parseResearchWebArgs parses web research controls", () => {
  assert.deepEqual(parseResearchWebArgs("RESEARCH-001 execute internet tools=browser,mcp-docs max-queries=2"), { requestId: "RESEARCH-001", execute: true, allowInternet: true, tools: ["browser", "mcp-docs"], maxQueries: 2 });
  assert.deepEqual(parseResearchWebArgs("internet"), { requestId: undefined, execute: false, allowInternet: true, tools: undefined, maxQueries: undefined });
});

test("parseToolRunArgs parses optional request and execute flag", () => {
  assert.deepEqual(parseToolRunArgs("REQ-1 execute"), { requestId: "REQ-1", execute: true });
  assert.deepEqual(parseToolRunArgs("execute"), { requestId: undefined, execute: true });
  assert.deepEqual(parseToolRunArgs(" "), { requestId: undefined, execute: false });
});

test("parseToolReplayArgs parses optional transaction, execute flag, and approval id", () => {
  assert.deepEqual(parseToolReplayArgs("TXN-1 execute"), { transactionId: "TXN-1", execute: true, approvalId: undefined });
  assert.deepEqual(parseToolReplayArgs("TXN-1 execute approval=APP-1"), { transactionId: "TXN-1", execute: true, approvalId: "APP-1" });
  assert.deepEqual(parseToolReplayArgs("execute"), { transactionId: undefined, execute: true, approvalId: undefined });
  assert.deepEqual(parseToolReplayArgs(" "), { transactionId: undefined, execute: false, approvalId: undefined });
});

test("parseToolReplayApprovalArgs parses approval workflow", () => {
  assert.deepEqual(parseToolReplayApprovalArgs("approve | TXN-1 | Audit follow-up | max-uses=2 ttl-minutes=30"), { action: "approve", transactionId: "TXN-1", reason: "Audit follow-up", maxUses: 2, ttlMinutes: 30 });
  assert.deepEqual(parseToolReplayApprovalArgs("revoke | APP-1 | No longer needed"), { action: "revoke", id: "APP-1", reason: "No longer needed" });
  assert.deepEqual(parseToolReplayApprovalArgs(" "), { action: "list" });
});

test("parseToolIterateArgs parses optional request, execute flag, and max cap", () => {
  assert.deepEqual(parseToolIterateArgs("REQ-1 execute max=4"), { requestId: "REQ-1", execute: true, maxIterations: 4 });
  assert.deepEqual(parseToolIterateArgs("execute max=2"), { requestId: undefined, execute: true, maxIterations: 2 });
  assert.deepEqual(parseToolIterateArgs("REQ-2"), { requestId: "REQ-2", execute: false, maxIterations: undefined });
});

test("parseToolIterationPolicyArgs parses max and auto-replay options", () => {
  assert.deepEqual(parseToolIterationPolicyArgs("max=5 auto-replay=off"), { maxIterations: 5, autoReplay: false });
  assert.deepEqual(parseToolIterationPolicyArgs("auto-replay=on"), { maxIterations: undefined, autoReplay: true });
  assert.deepEqual(parseToolIterationPolicyArgs(" "), { maxIterations: undefined, autoReplay: undefined });
});

test("parseToolScheduleArgs parses execute and parallelism", () => {
  assert.deepEqual(parseToolScheduleArgs("execute parallel=4"), { execute: true, parallelism: 4 });
  assert.deepEqual(parseToolScheduleArgs("parallel=2"), { execute: false, parallelism: 2 });
  assert.deepEqual(parseToolScheduleArgs(" "), { execute: false, parallelism: undefined });
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

test("parseDebugRetryPolicyArgs parses retry automation controls", () => {
  assert.deepEqual(parseDebugRetryPolicyArgs("auto-start=on require-approval=off post-exact-pass=validate-commit"), { autoStart: true, requireApproval: false, postExactPass: "validate-commit" });
  assert.deepEqual(parseDebugRetryPolicyArgs("auto-start=deny require-approval=allowed post-exact-pass=stop"), { autoStart: false, requireApproval: true, postExactPass: "stop" });
  assert.deepEqual(parseDebugRetryPolicyArgs(" "), { autoStart: undefined, requireApproval: undefined, postExactPass: undefined });
});

test("parseDebugRetryApprovalArgs parses report task and reason", () => {
  assert.deepEqual(parseDebugRetryApprovalArgs("RPT-1 | T-1 | approve retry"), { debugReportId: "RPT-1", taskId: "T-1", reason: "approve retry" });
  assert.deepEqual(parseDebugRetryApprovalArgs("RPT-1"), { debugReportId: "RPT-1", taskId: undefined, reason: undefined });
  assert.equal(parseDebugRetryApprovalArgs(" "), undefined);
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

test("parseCommitSkipArgs parses optional task and reason", () => {
  assert.deepEqual(parseCommitSkipArgs("T-001 | generated docs only"), { taskId: "T-001", reason: "generated docs only" });
  assert.deepEqual(parseCommitSkipArgs(""), { taskId: undefined, reason: undefined });
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

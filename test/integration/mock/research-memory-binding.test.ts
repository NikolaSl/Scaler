/* Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rename, rm, symlink, unlink, writeFile } from "node:fs/promises";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { loadMemoryIndex, retrieveMemory, searchMemory, formatMemorySearchResults, writeMemory, saveMemoryIndex, type MemoryEntry } from "../../../src/memory.js";
import { recordResearchReport, loadResearchReports } from "../../../src/research.js";
import { createDefaultState, loadState, saveState } from "../../../src/state.js";
import { createTask, updateTask } from "../../../src/tasks.js";
import { loadTaskContextManifest, resolveTaskContextManifest, saveTaskContextManifest } from "../../../src/context.js";
import { runConductorStep } from "./provider-bound-helpers.js";
import { buildTaskAgentPrompt } from "../../../src/conductor.js";
import { admitTaskExecution, startTaskExecution, checkTaskExecutionResult } from "../../../src/attempt-execution.js";
import { acquireExecutionLock, releaseExecutionLock } from "../../../src/locks.js";
import { verifyAcceptedTaskEvidence } from "../../../src/accepted-evidence.js";
import { loadValidationRuns, runTaskValidation } from "../../../src/validation.js";

async function fixture(fn: (dir: string, id: string) => Promise<void>, sourcePath = "service.txt") {
  const dir = await mkdtemp(join(tmpdir(), "scaler-memory-binding-"));
  try {
    const state = createDefaultState(); state.stage = "execution"; await saveState(dir, state);
    assert.equal((await createTask(dir, state, { id: "NEXT", title: "Inspect current config", taskKind: "non_software", acceptanceAuthority: "model",
      allowedPathPrefixes: [sourcePath.replace(/^\.\//, ""), "answer.txt"], outputPaths: ["answer.txt"], definitionOfDone: ["Use current config."],
      atomicityRationale: "One bounded answer.", validationCommands: [{ id: "answer", required: true, command: 'node -e "process.exit(1)"' }] })).accepted, true);
    await mkdir(dirname(join(dir, sourcePath)), { recursive: true });
    await writeFile(join(dir, sourcePath), "provider=local\n");
    const report = await recordResearchReport(dir, { id: "R1", taskId: "NEXT", status: "complete", question: "What provider?",
      sources: [{ id: "config", title: "Config", quality: "project", path: sourcePath }],
      conclusions: [{ summary: "Provider is local.", confidence: "high", sourceRefs: ["config"] }],
      rawEvidence: [{ title: "Config excerpt", sourceId: "config", content: await readFile(join(dir, sourcePath), "utf8"), summary: "Provider is local." }] });
    await saveTaskContextManifest(dir, { version: 1, taskId: "NEXT", items: [{ id: "memory", type: "memory", source: "memory",
      memoryId: report.memoryRefs![0], reason: "Current config claim", priority: "required", scope: "summary", exactness: "summary-ok" }], createdAt: "", updatedAt: "" });
    await fn(dir, report.memoryRefs![0]!);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

test("research memory retains original binding and revalidates search/retrieval without rewriting history", async () => {
  await fixture(async (dir, id) => {
    const report = (await loadResearchReports(dir))[0]!;
    const original = await retrieveMemory(dir, id);
    assert.ok("sourceBinding" in original.entry);
    const raw = await readFile(join(dir, original.entry.path), "utf8");
    assert.equal((await searchMemory(dir, { validity: "active" })).length, 1);
    await writeFile(join(dir, "service.txt"), "provider=remote\n");
    assert.equal((await retrieveMemory(dir, id, { scope: "summary" })).entry.validity, "stale");
    assert.equal((await loadMemoryIndex(dir)).entries[0]?.validity, "stale");
    assert.equal((await searchMemory(dir, { validity: "active" })).length, 0);
    assert.match((await retrieveMemory(dir, id)).content, /provider=local/);
    assert.equal(await readFile(join(dir, original.entry.path), "utf8"), raw);
    assert.deepEqual(await loadResearchReports(dir), [report]);
    await writeFile(join(dir, "service.txt"), "provider=local\n");
    assert.equal((await retrieveMemory(dir, id)).entry.validity, "active"); // Real original-hash check, not a new baseline.
  });
});

for (const change of ["bytes", "missing", "symlink", "scope"] as const) test(`required bound memory refuses actual dispatch after ${change}`, async () => {
  await fixture(async (dir, id) => {
    if (change === "bytes") await writeFile(join(dir, "service.txt"), "provider=remote\n");
    if (change === "missing" || change === "symlink") await unlink(join(dir, "service.txt"));
    if (change === "symlink") { await writeFile(join(dir, "other.txt"), "provider=local\n"); await symlink("other.txt", join(dir, "service.txt")); }
    if (change === "scope") assert.equal((await updateTask(dir, await loadState(dir), { id: "NEXT", allowedPathPrefixes: ["answer.txt"], acceptanceAuthority: "model" })).accepted, true);
    const before = await loadState(dir); let calls = 0;
    const result = await runConductorStep(dir, before, { execute: true, tools: [] }, async () => { calls++; assert.fail("Unusable current claim must not dispatch."); });
    assert.equal(calls, 0); assert.equal(result.accepted, false); assert.match(result.message, /required context/i);
    assert.deepEqual(await loadState(dir), before);
    assert.match((await retrieveMemory(dir, id)).content, /provider=local/); // Historical read, not current acceptance.
  });
});

for (const mixed of [false, true]) test(`bound memory rejects source mutation in the worker with mixed output context=${mixed}`, async () => {
  await fixture(async (dir) => {
    if (mixed) {
      assert.equal((await updateTask(dir, await loadState(dir), { id: "NEXT", outputPaths: ["answer.txt", "service.txt"], acceptanceAuthority: "model" })).accepted, true);
      const manifest = (await loadTaskContextManifest(dir, "NEXT"))!;
      await saveTaskContextManifest(dir, { ...manifest, items: [...manifest.items, { id: "mutable-output", type: "file", source: "file", path: "service.txt",
        priority: "required", scope: "full", reason: "Ordinary context that is also a declared output." }] });
    }
    let calls = 0;
    const result = await runConductorStep(dir, await loadState(dir), { execute: true, tools: [] }, async request => {
      calls++; assert.match(request.prompt, /Provider is local/);
      await writeFile(join(dir, "service.txt"), "provider=remote\n");
      return { taskId: request.taskId, exitCode: 0, stderr: "", timedOut: false, aborted: false,
        stdoutEvents: [{ type: "scaler_task_report", taskId: request.taskId, ...request.attempt, status: "completed", summary: "Proposed answer." }] };
    });
    assert.equal(calls, 1);
    assert.match(JSON.stringify(result), /context source.*changed|context source.*stale/i);
    assert.equal((await loadState(dir)).validatedTaskIds.includes("NEXT"), false);
  });
});

test("report refresh and unrelated memory writes cannot rebaseline old derived evidence", async () => {
  await fixture(async (dir, id) => {
    const original = (await retrieveMemory(dir, id)).entry;
    await writeFile(join(dir, "service.txt"), "provider=remote\n");
    assert.equal((await loadMemoryIndex(dir)).entries[0]?.validity, "stale");
    await writeMemory(dir, { title: "Unrelated", content: "Independent observation." });
    await recordResearchReport(dir, { id: "R1", question: "What provider?", taskId: "NEXT", sources: [{ id: "config", title: "Updated config", quality: "project", path: "service.txt" }],
      conclusions: [{ summary: "Provider is remote.", confidence: "high", sourceRefs: ["config"] }] });
    assert.equal((await retrieveMemory(dir, id)).entry.validity, "stale");
    assert.deepEqual((await retrieveMemory(dir, id)).entry.sourceBinding, original.sourceBinding);
    await writeFile(join(dir, "service.txt"), "provider=local\n");
    assert.equal((await retrieveMemory(dir, id)).entry.validity, "active");
  });
});

test("opaque direct and unattributed memory do not acquire a fabricated file binding", async () => {
  await fixture(async (dir) => {
    const entry = await writeMemory(dir, { title: "Unverified note", source: "research:config", content: "A timeless observation." });
    const value = await retrieveMemory(dir, entry.id, { scope: "summary" });
    assert.equal("sourceBinding" in value.entry, false);
    assert.match(value.content, /unverified/i);
  });
});

test("binding uses the producer's checked canonical local path", async () => {
  await fixture(async (dir, id) => {
    assert.equal((await retrieveMemory(dir, id)).entry.sourceBinding?.path, "service.txt");
  }, "./service.txt");
});

test("memory item task override and missing consumer cannot borrow producer scope", async () => {
  await fixture(async (dir) => {
    assert.equal((await createTask(dir, await loadState(dir), { id: "OTHER", allowedPathPrefixes: ["service.txt"] })).accepted, true);
    assert.equal((await updateTask(dir, await loadState(dir), { id: "NEXT", allowedPathPrefixes: ["answer.txt"], acceptanceAuthority: "model" })).accepted, true);
    const manifest = (await loadTaskContextManifest(dir, "NEXT"))!;
    const override = { ...manifest, items: manifest.items.map(item => ({ ...item, taskId: "OTHER" })) };
    await saveTaskContextManifest(dir, override);
    assert.equal((await resolveTaskContextManifest(dir, await loadState(dir), override))[0]?.available, false);
    const missing = { ...override, taskId: "MISSING" };
    assert.equal((await resolveTaskContextManifest(dir, await loadState(dir), missing))[0]?.available, false);
    let calls = 0;
    await runConductorStep(dir, await loadState(dir), { execute: true }, async () => { calls++; assert.fail("Cannot borrow a different task's scope."); });
    assert.equal(calls, 0);
  });
});

test("malformed persisted binding is unknown and historical, never current context", async () => {
  await fixture(async (dir, id) => {
    const entry = (await retrieveMemory(dir, id)).entry;
    await saveMemoryIndex(dir, { version: 1, entries: [{ ...entry, sourceBinding: null as unknown as MemoryEntry["sourceBinding"] }] });
    const historical = await retrieveMemory(dir, id);
    assert.equal(historical.entry.validity, "unknown");
    assert.match(historical.content, /Historical memory bytes \(not current evidence\)/);
    const manifest = (await loadTaskContextManifest(dir, "NEXT"))!;
    assert.equal((await resolveTaskContextManifest(dir, await loadState(dir), manifest))[0]?.available, false);
  });
});

test("strict memory result check rejects ancestor identity drift after reading unchanged source bytes", async (t) => {
  await fixture(async dir => {
    assert.equal((await updateTask(dir, await loadState(dir), { id: "NEXT", status: "ready" })).accepted, true);
    const state = await loadState(dir), task = state.tasks[0]!;
    const items = await resolveTaskContextManifest(dir, state, (await loadTaskContextManifest(dir, task.id))!);
    const context = buildTaskAgentPrompt({ state, task, contextItems: items }).resolvedContext;
    const lock = await acquireExecutionLock(dir, { operation: "memory-identity-regression", taskId: task.id });
    try {
      const admitted = await admitTaskExecution(dir, lock.lock.id, state, task, context, "test", []);
      assert.equal(admitted.contextSources?.[0]?.outputExemptible, false);
      const started = await startTaskExecution(dir, lock.lock.id, state, admitted);
      const before = await loadState(dir);
      assert.deepEqual((await checkTaskExecutionResult(dir, started.attempt, task.id)).diagnostics, []);
      const original = fs.lstat;
      let ancestorChecks = 0;
      // Actual reader's third direct-path check is after opened-fd bytes/fstat.
      // The leaf inode/bytes remain unchanged; only the current ancestor becomes a symlink.
      t.mock.method(fs, "lstat", (async (path: string) => {
        if (path === join(dir, "config") && ++ancestorChecks === 3) {
          await rename(join(dir, "config"), join(dir, "original-config"));
          await symlink("original-config", join(dir, "config"));
        }
        return original(path);
      }) as typeof fs.lstat);
      syncBuiltinESMExports();
      try {
        const checked = await checkTaskExecutionResult(dir, started.attempt, task.id);
        assert.equal(ancestorChecks, 3, "Observe the real post-read path check, not an earlier refusal.");
        assert.equal(await readFile(join(dir, "config/service.txt"), "utf8"), "provider=local\n");
        assert.match(checked.diagnostics.join(" "), /context.*(changed|stale|missing|unreadable).*config\/service\.txt/i);
        assert.deepEqual(await loadState(dir), before);
      } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
    } finally { await releaseExecutionLock(dir, lock.lock.id); }
  }, "config/service.txt");
});

test("accepted summary becomes historical after source change without rewriting its receipt or raw evidence", async () => {
  await fixture(async (dir, id) => {
    assert.equal((await updateTask(dir, await loadState(dir), { id: "NEXT", acceptanceAuthority: "model",
      validationCommands: [{ id: "answer", required: true, timeoutMs: 5000,
        command: "node -e \"const f=require('node:fs'),a=require('node:assert/strict');a.equal(f.readFileSync('answer.txt','utf8'),f.readFileSync('service.txt','utf8').trim().split('=')[1])\"" }] })).accepted, true);
    const original = await retrieveMemory(dir, id);
    let calls = 0;
    const result = await runConductorStep(dir, await loadState(dir), { execute: true, tools: [] }, async request => {
      calls++; assert.match(request.prompt, /Provider is local/);
      await writeFile(join(dir, "answer.txt"), "local");
      return { taskId: request.taskId, exitCode: 0, stderr: "", timedOut: false, aborted: false,
        stdoutEvents: [{ type: "scaler_task_report", taskId: request.taskId, ...request.attempt,
          status: "completed", summary: "Exact current provider summary prepared." }] };
    });
    assert.equal(calls, 1); assert.equal(result.validationHandoff?.status, "validation_required");
    assert.equal((await runTaskValidation(dir, await loadState(dir), "NEXT")).status, "passed");
    assert.deepEqual(await verifyAcceptedTaskEvidence(dir, await loadState(dir), "NEXT"), []);
    const historical = await loadValidationRuns(dir);
    assert.ok(historical[0]?.receipt);
    await writeFile(join(dir, "service.txt"), "provider=remote\n");
    assert.equal((await retrieveMemory(dir, id, { scope: "summary" })).entry.validity, "stale");
    assert.match((await verifyAcceptedTaskEvidence(dir, await loadState(dir), "NEXT")).join(" "), /context.*changed/i);
    assert.deepEqual(await loadValidationRuns(dir), historical);
    assert.equal(await readFile(join(dir, original.entry.path), "utf8"), original.content);
    assert.match((await retrieveMemory(dir, id)).content, /Historical memory bytes.*\n[\s\S]*provider=local/);
    await writeFile(join(dir, "service.txt"), "provider=local\n");
    assert.deepEqual(await verifyAcceptedTaskEvidence(dir, await loadState(dir), "NEXT"), []);
    assert.deepEqual(await loadValidationRuns(dir), historical); // Fresh original-hash recheck, not rewritten acceptance.
  });
});

async function qualifiedResearch(dir: string, unknown = "Which source takes precedence?") {
  assert.equal((await updateTask(dir, await loadState(dir), { id: "NEXT", acceptanceAuthority: "model",
    allowedPathPrefixes: ["service.txt", "environment.txt", "other.txt", "answer.txt"] })).accepted, true);
  await writeFile(join(dir, "environment.txt"), "provider=remote\n");
  await writeFile(join(dir, "other.txt"), "Independent observation.\n");
  return recordResearchReport(dir, { id: "QUALIFIED", taskId: "NEXT", status: "partial", question: "Effective provider?",
    sources: [{ id: "config", title: "Config", quality: "project", path: "service.txt" },
      { id: "env", title: "Environment", quality: "project", path: "environment.txt" },
      { id: "other", title: "Other", quality: "project", path: "other.txt" }],
    conclusions: [{ summary: "Effective provider is not established.", confidence: "low", sourceRefs: ["config", "env"] },
      { summary: "Independent observation recorded.", confidence: "high", sourceRefs: ["other"] }],
    contradictions: [{ summary: "Config and environment disagree.", status: "unresolved", sourceRefs: ["config", "env"] }],
    unresolvedUnknowns: [unknown], rawEvidence: [
      { title: "Config", sourceId: "config", content: `## Config\n${await readFile(join(dir, "service.txt"), "utf8")}`, summary: "Config reports provider=local." },
      { title: "Other", sourceId: "other", content: await readFile(join(dir, "other.txt"), "utf8") },
      { title: "Unattributed", content: "Unattributed observation." }],
  });
}

test("originating research qualification reaches every retrieval scope and actual worker without changing raw history", async () => {
  await fixture(async dir => {
    const report = await qualifiedResearch(dir), id = report.memoryRefs![0]!;
    const entry = (await retrieveMemory(dir, id)).entry;
    const raw = await readFile(join(dir, entry.path), "utf8");
    for (const scope of ["summary", "reference-only", "full", "section:Config"]) {
      const retrieved = await retrieveMemory(dir, id, { scope });
      assert.equal(retrieved.entry.validity, "active"); // Fresh raw bytes, not resolution of the investigation.
      assert.match(retrieved.content, /Originating research qualification/);
      assert.match(retrieved.content, /"reportId":"QUALIFIED"/);
      assert.match(retrieved.content, /"status":"partial"/);
      assert.match(retrieved.content, /"conclusions":\[.*"confidence":"low"/);
      assert.match(retrieved.content, /Config and environment disagree/);
      assert.match(retrieved.content, /Which source takes precedence/);
    }
    const summary = (await retrieveMemory(dir, id, { scope: "summary" })).content;
    assert.match(formatMemorySearchResults(await searchMemory(dir, { query: id })), /Config and environment disagree/);
    const manifest = (await loadTaskContextManifest(dir, "NEXT"))!;
    await saveTaskContextManifest(dir, { ...manifest, items: manifest.items.map(item => ({ ...item, memoryId: id })) });
    let calls = 0;
    await runConductorStep(dir, await loadState(dir), { execute: true, tools: [] }, async request => {
      calls++; assert.match(request.prompt, /Config reports provider=local/);
      assert.match(request.prompt, /Config and environment disagree/);
      assert.match(request.prompt, /Which source takes precedence/);
      return { taskId: request.taskId, exitCode: 1, stdoutEvents: [], stderr: "Qualified observation admission only", timedOut: false, aborted: false };
    });
    assert.equal(calls, 1);
    assert.match((await retrieveMemory(dir, report.memoryRefs![1]!, { scope: "summary" })).content, /"confidence":"high"/);
    assert.doesNotMatch((await retrieveMemory(dir, report.memoryRefs![1]!, { scope: "summary" })).content, /Config and environment disagree|"confidence":"low"/);
    assert.doesNotMatch((await retrieveMemory(dir, report.memoryRefs![2]!, { scope: "summary" })).content, /Originating research qualification/);
    await recordResearchReport(dir, { id: report.id, taskId: "NEXT", question: report.question, status: "complete",
      conclusions: [{ summary: "New reported conclusion.", confidence: "high", sourceRefs: ["config"] }],
      contradictions: [], unresolvedUnknowns: [] });
    assert.equal((await retrieveMemory(dir, id, { scope: "summary" })).content, summary);
    assert.equal(await readFile(join(dir, entry.path), "utf8"), raw);
  });
});

test("oversized required originating qualification refuses dispatch rather than dropping its limitation", async () => {
  await fixture(async dir => {
    const report = await qualifiedResearch(dir, "Unresolved precedence ".repeat(3000));
    const manifest = (await loadTaskContextManifest(dir, "NEXT"))!;
    await saveTaskContextManifest(dir, { ...manifest, tokenBudget: 1000, items: manifest.items.map(item => ({ ...item, memoryId: report.memoryRefs![0]! })) });
    const before = await loadState(dir); let calls = 0;
    const result = await runConductorStep(dir, before, { execute: true, tools: [] }, async () => { calls++; assert.fail("Required qualification cannot be silently dropped."); });
    assert.equal(result.accepted, false); assert.equal(calls, 0);
    assert.deepEqual(await loadState(dir), before);
  });
});

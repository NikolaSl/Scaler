/* Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadMemoryIndex, retrieveMemory, searchMemory, writeMemory } from "../../../src/memory.js";
import { recordResearchReport, loadResearchReports } from "../../../src/research.js";
import { createDefaultState, loadState, saveState } from "../../../src/state.js";
import { createTask, updateTask } from "../../../src/tasks.js";
import { loadTaskContextManifest, resolveTaskContextManifest, saveTaskContextManifest } from "../../../src/context.js";
import { runConductorStep } from "./provider-bound-helpers.js";

async function fixture(fn: (dir: string, id: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "scaler-memory-binding-"));
  try {
    const state = createDefaultState(); state.stage = "execution"; await saveState(dir, state);
    assert.equal((await createTask(dir, state, { id: "NEXT", title: "Inspect current config", taskKind: "non_software", acceptanceAuthority: "model",
      allowedPathPrefixes: ["service.txt", "answer.txt"], outputPaths: ["answer.txt"], definitionOfDone: ["Use current config."],
      atomicityRationale: "One bounded answer.", validationCommands: [{ id: "answer", required: true, command: 'node -e "process.exit(1)"' }] })).accepted, true);
    await writeFile(join(dir, "service.txt"), "provider=local\n");
    const report = await recordResearchReport(dir, { id: "R1", taskId: "NEXT", status: "complete", question: "What provider?",
      sources: [{ id: "config", title: "Config", quality: "project", path: "service.txt" }],
      conclusions: [{ summary: "Provider is local.", confidence: "high", sourceRefs: ["config"] }],
      rawEvidence: [{ title: "Config excerpt", sourceId: "config", content: await readFile(join(dir, "service.txt"), "utf8"), summary: "Provider is local." }] });
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

/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { admitTaskExecution, checkTaskExecutionResult, interruptTaskExecution, reconcileInterruptedTaskAttempt, startTaskExecution } from "../src/attempt-execution.js";
import { acquireExecutionLock, releaseExecutionLock } from "../src/locks.js";
import { createDefaultState, loadState, saveState } from "../src/state.js";
import { loadTaskAttempts } from "../src/task-attempts.js";
import { saveValidationManifest, upsertValidationManifestCommand } from "../src/validation.js";
import { buildTaskAgentPrompt } from "../src/conductor.js";
import { resolveTaskContextManifest, saveTaskContextManifest } from "../src/context.js";
import { getTaskAttemptsPath } from "../src/paths.js";

async function fixture(fn: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "scaler-attempt-execution-"));
  try { await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

async function admitted(dir: string) {
  const state = createDefaultState();
  state.stage = "execution";
  state.tasks = [{
    id: "T-1", status: "ready", title: "Contract",
    allowedPathPrefixes: ["result.txt"], definitionOfDone: ["The attempt result is recorded."],
    updatedAt: state.updatedAt,
  }];
  await saveState(dir, state);
  await saveValidationManifest(dir, { taskId: "T-1", outputPaths: [], commands: [], createdAt: "", updatedAt: "" });
  const lock = await acquireExecutionLock(dir, { operation: "test", taskId: "T-1" });
  const context = buildTaskAgentPrompt({ state, task: state.tasks[0]! }).resolvedContext;
  const attempt = await admitTaskExecution(dir, lock.lock.id, state, state.tasks[0]!, context, "test", []);
  return { state, lockId: lock.lock.id, context, attempt };
}

async function admittedFileContext(
  dir: string,
  options: {
    path?: string;
    content?: string | Uint8Array;
    priority?: "required" | "optional";
    tokenBudget?: number;
    allowedPathPrefixes?: string[];
    outputPaths?: string[];
    writeSource?: boolean;
    selectorHeading?: string;
  } = {},
) {
  const path = options.path ?? "reference.md";
  const state = createDefaultState();
  state.stage = "execution";
  state.tasks = [{
    id: "T-1", status: "ready", title: "Context freshness",
    allowedPathPrefixes: options.allowedPathPrefixes ?? ["result.txt"],
    definitionOfDone: ["The attempt result is recorded."], updatedAt: state.updatedAt,
  }];
  await saveState(dir, state);
  await saveValidationManifest(dir, {
    taskId: "T-1", outputPaths: options.outputPaths ?? [], commands: [], createdAt: "", updatedAt: "",
  });
  if (options.writeSource !== false) {
    if (path.includes("/")) await mkdir(join(dir, path.slice(0, path.lastIndexOf("/"))), { recursive: true });
    await writeFile(join(dir, path), options.content ?? "ORIGINAL\n");
  }
  const manifest = await saveTaskContextManifest(dir, {
    version: 1,
    taskId: "T-1",
    items: [{
      id: "reference", type: "file", reason: "Immutable source",
      priority: options.priority ?? "required", scope: options.selectorHeading === undefined ? "full" : "section", source: "file", path,
      selector: options.selectorHeading === undefined
        ? undefined
        : { kind: "markdown-heading", heading: options.selectorHeading },
    }],
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
  });
  const contextItems = await resolveTaskContextManifest(dir, state, manifest);
  const context = buildTaskAgentPrompt({
    state, task: state.tasks[0]!, contextItems, tokenBudget: options.tokenBudget,
  }).resolvedContext;
  const lock = await acquireExecutionLock(dir, { operation: "test", taskId: "T-1" });
  const attempt = await admitTaskExecution(dir, lock.lock.id, state, state.tasks[0]!, context, "test", []);
  return { state, lockId: lock.lock.id, attempt, context, path };
}

for (const heading of ["\u00a0", "\u202f"]) {
  test(`attempt admission preserves Markdown heading whitespace semantics for U+${heading.codePointAt(0)!.toString(16).toUpperCase()}`, async () => {
    await fixture(async (dir) => {
      const initial = await admittedFileContext(dir, {
        content: `## ${heading}\nSELECTED\n`,
        selectorHeading: heading,
      });
      assert.equal(initial.attempt.contextSources?.[0]?.selector?.heading, heading);
      assert.match(initial.context.text, /SELECTED/);
    });
  });
}

test("attempt recovery blocks an admission interrupted before the task snapshot is bound", async () => {
  await fixture(async (dir) => {
    const initial = await admitted(dir);
    await releaseExecutionLock(dir, initial.lockId);
    const recovery = await reconcileInterruptedTaskAttempt(dir, initial.state);
    assert.equal(recovery?.state.tasks[0]?.status, "blocked");
    assert.equal((await loadTaskAttempts(dir))[0]?.outcome, "not_started");
  });
});

test("attempt interruption checks ownership before mutating state", async () => {
  await fixture(async (dir) => {
    const initial = await admitted(dir);
    await assert.rejects(interruptTaskExecution(dir, "not-owner", initial.attempt.id, ["stop"]), /execution lock/);
    assert.equal((await loadState(dir)).tasks[0]?.status, "ready");
    assert.equal((await loadTaskAttempts(dir))[0]?.status, "admitted");
  });
});

test("dispatch refuses file context changed after attempt admission", async () => {
  await fixture(async (dir) => {
    const state = createDefaultState();
    state.stage = "execution";
    state.tasks = [{
      id: "T-1", status: "ready", title: "Context freshness",
      allowedPathPrefixes: ["result.txt"], definitionOfDone: ["The attempt result is recorded."],
      updatedAt: state.updatedAt,
    }];
    await saveState(dir, state);
    await saveValidationManifest(dir, { taskId: "T-1", outputPaths: [], commands: [], createdAt: "", updatedAt: "" });
    await writeFile(join(dir, "reference.md"), "ORIGINAL\n", "utf8");
    const manifest = await saveTaskContextManifest(dir, {
      version: 1,
      taskId: "T-1",
      items: [{
        id: "reference", type: "file", reason: "Immutable source", priority: "required",
        scope: "full", source: "file", path: "reference.md",
      }],
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
    });
    const contextItems = await resolveTaskContextManifest(dir, state, manifest);
    const context = buildTaskAgentPrompt({ state, task: state.tasks[0]!, contextItems }).resolvedContext;
    const lock = await acquireExecutionLock(dir, { operation: "test", taskId: "T-1" });
    const attempt = await admitTaskExecution(dir, lock.lock.id, state, state.tasks[0]!, context, "test", []);

    await writeFile(join(dir, "reference.md"), "CHANGED\n", "utf8");
    await assert.rejects(
      startTaskExecution(dir, lock.lock.id, state, attempt),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /context.*(changed|stale).*reference\.md/i);
        for (const identity of ["T-1", "reference", "reference.md"]) {
          assert.ok(error.message.includes(identity), error.message);
        }
        return true;
      },
    );
    assert.equal((await loadState(dir)).tasks[0]?.status, "ready");
    assert.equal((await loadTaskAttempts(dir))[0]?.status, "admitted");
    await interruptTaskExecution(dir, lock.lock.id, attempt.id, [
      "Context source reference.md changed for T-1/reference.",
    ]);
    const [closed] = await loadTaskAttempts(dir);
    assert.equal(closed?.status, "failed");
    assert.equal(closed?.outcome, "not_started");
    assert.equal(closed?.reportId, undefined);
    assert.equal((await loadState(dir)).tasks[0]?.status, "blocked");
  });
});

test("file context freshness binds original bytes rather than decoded text", async () => {
  await fixture(async (dir) => {
    const initial = await admittedFileContext(dir, { content: Uint8Array.from([0xff]) });
    await writeFile(join(dir, initial.path), Uint8Array.from([0xfe]));
    await assert.rejects(
      startTaskExecution(dir, initial.lockId, initial.state, initial.attempt),
      /context.*changed.*reference\.md/i,
    );
  });
});

test("budget-omitted file context is not an attempt dependency", async () => {
  await fixture(async (dir) => {
    const initial = await admittedFileContext(dir, { priority: "optional", tokenBudget: 1 });
    assert.deepEqual(initial.context.included, []);
    assert.equal(initial.context.omitted[0]?.fileSource, undefined);
    assert.deepEqual(initial.attempt.contextSources, []);
    await writeFile(join(dir, initial.path), "CHANGED\n", "utf8");
    const started = await startTaskExecution(dir, initial.lockId, initial.state, initial.attempt);
    assert.equal(started.attempt.status, "dispatching");
  });
});

test("allowed write prefix alone does not exempt changed file context", async () => {
  await fixture(async (dir) => {
    const initial = await admittedFileContext(dir, {
      path: "src/app.ts", allowedPathPrefixes: ["src"], outputPaths: ["src/other.ts"],
    });
    const started = await startTaskExecution(dir, initial.lockId, initial.state, initial.attempt);
    await writeFile(join(dir, initial.path), "CHANGED\n", "utf8");
    const checked = await checkTaskExecutionResult(dir, started.attempt, "T-1");
    assert.match(checked.diagnostics.join(" "), /context.*changed.*src\/app\.ts/i);
  });
});

for (const symlinkKind of ["leaf", "ancestor"] as const) {
  test(`exact output exemption rejects ${symlinkKind} symlink-backed context`, async () => {
    await fixture(async (dir) => {
      let contextPath: string;
      let referentPath: string;
      if (symlinkKind === "leaf") {
        await mkdir(join(dir, "src"), { recursive: true });
        referentPath = "reference.md";
        contextPath = "src/app.ts";
        await writeFile(join(dir, referentPath), "ORIGINAL\n", "utf8");
        await symlink("../reference.md", join(dir, contextPath));
      } else {
        await mkdir(join(dir, "real"), { recursive: true });
        referentPath = "real/app.ts";
        contextPath = "linked/app.ts";
        await writeFile(join(dir, referentPath), "ORIGINAL\n", "utf8");
        await symlink("real", join(dir, "linked"));
      }
      const initial = await admittedFileContext(dir, {
        path: contextPath,
        writeSource: false,
        allowedPathPrefixes: [contextPath.split("/")[0]!],
        outputPaths: [contextPath],
      });
      assert.equal(initial.attempt.contextSources?.[0]?.outputExemptible, false);
      const started = await startTaskExecution(dir, initial.lockId, initial.state, initial.attempt);
      await writeFile(join(dir, referentPath), "CHANGED\n", "utf8");
      const checked = await checkTaskExecutionResult(dir, started.attempt, "T-1");
      assert.match(checked.diagnostics.join(" "), /context.*changed/i);
    });
  });
}

for (const symlinkKind of ["leaf", "ancestor"] as const) {
  test(`dispatch rejects exact output changed from regular file to ${symlinkKind} symlink`, async () => {
    await fixture(async (dir) => {
      const contextPath = symlinkKind === "leaf" ? "src/app.ts" : "linked/app.ts";
      const initial = await admittedFileContext(dir, {
        path: contextPath,
        allowedPathPrefixes: [contextPath.split("/")[0]!],
        outputPaths: [contextPath],
      });
      assert.equal(initial.attempt.contextSources?.[0]?.outputExemptible, true);

      if (symlinkKind === "leaf") {
        await writeFile(join(dir, "reference.md"), "ORIGINAL\n", "utf8");
        await rm(join(dir, contextPath));
        await symlink("../reference.md", join(dir, contextPath));
      } else {
        await rename(join(dir, "linked"), join(dir, "real"));
        await symlink("real", join(dir, "linked"));
      }

      await assert.rejects(
        startTaskExecution(dir, initial.lockId, initial.state, initial.attempt),
        /context.*(changed|stale).*app\.ts/i,
      );
      assert.equal((await loadState(dir)).tasks[0]?.status, "ready");
      assert.equal((await loadTaskAttempts(dir))[0]?.status, "admitted");
    });
  });
}

test("FIFO replacement fails context freshness without blocking", async () => {
  await fixture(async (dir) => {
    const initial = await admittedFileContext(dir);
    const path = join(dir, initial.path);
    await rm(path);
    execFileSync("mkfifo", [path]);
    let writer: Promise<void> | undefined;
    const unblock = setTimeout(() => {
      writer = writeFile(path, "late writer\n");
    }, 500);
    const startedAt = Date.now();
    try {
      await assert.rejects(
        startTaskExecution(dir, initial.lockId, initial.state, initial.attempt),
        /context.*(missing|unreadable).*reference\.md/i,
      );
      assert.ok(Date.now() - startedAt < 400, "FIFO verification must fail before a writer appears");
    } finally {
      clearTimeout(unblock);
      if (writer) await writer;
    }
  });
});

test("durable context descriptor drift rejects a returning result", async () => {
  await fixture(async (dir) => {
    const initial = await admittedFileContext(dir);
    const started = await startTaskExecution(dir, initial.lockId, initial.state, initial.attempt);
    const path = getTaskAttemptsPath(dir);
    const index = JSON.parse(await readFile(path, "utf8")) as {
      attempts: Array<{ contextSources?: Array<{ contentFingerprint: string }> }>;
    };
    index.attempts[0]!.contextSources![0]!.contentFingerprint = `sha256:${"0".repeat(64)}`;
    await writeFile(path, `${JSON.stringify(index, null, 2)}\n`, "utf8");
    const checked = await checkTaskExecutionResult(dir, started.attempt, "T-1");
    assert.match(checked.diagnostics.join(" "), /context source descriptors changed/i);
  });
});

test("legacy open attempts without context coverage fail closed and remain recoverable", async () => {
  await fixture(async (dir) => {
    const initial = await admittedFileContext(dir);
    const path = getTaskAttemptsPath(dir);
    const index = JSON.parse(await readFile(path, "utf8")) as {
      attempts: Array<{ contextSources?: unknown }>;
    };
    delete index.attempts[0]!.contextSources;
    await writeFile(path, `${JSON.stringify(index, null, 2)}\n`, "utf8");
    await assert.rejects(
      startTaskExecution(dir, initial.lockId, initial.state, initial.attempt),
      /context freshness coverage is missing/i,
    );
    await releaseExecutionLock(dir, initial.lockId);
    const recovery = await reconcileInterruptedTaskAttempt(dir, initial.state);
    assert.equal(recovery?.state.tasks[0]?.status, "blocked");
    assert.equal((await loadTaskAttempts(dir))[0]?.outcome, "not_started");
  });
});

test("failed recovery state publication keeps the attempt discoverable for restart", async () => {
  await fixture(async (dir) => {
    const initial = await admitted(dir);
    await startTaskExecution(dir, initial.lockId, initial.state, initial.attempt);
    const publicationLock = join(dir, ".scaler", "state.json.lock");
    await mkdir(publicationLock);
    await assert.rejects(interruptTaskExecution(dir, initial.lockId, initial.attempt.id, ["transport lost"]), /publication lock/);
    assert.equal((await loadTaskAttempts(dir))[0]?.status, "dispatching");
    await rm(publicationLock, { recursive: true });
    await releaseExecutionLock(dir, initial.lockId);
    const recovery = await reconcileInterruptedTaskAttempt(dir, await loadState(dir));
    assert.equal(recovery?.state.tasks[0]?.status, "blocked");
    assert.equal((await loadTaskAttempts(dir))[0]?.outcome, "unknown");
  });
});

test("current task attempt and validation policy changes invalidate returning results", async () => {
  await fixture(async (dir) => {
    const initial = await admitted(dir);
    const started = await startTaskExecution(dir, initial.lockId, initial.state, initial.attempt);
    assert.deepEqual((await checkTaskExecutionResult(dir, started.attempt, "T-1")).diagnostics, []);
    const changed = await loadState(dir);
    changed.tasks[0]!.attemptId = "replacement";
    changed.tasks[0]!.title = "New contract";
    await saveState(dir, changed);
    await upsertValidationManifestCommand(dir, { taskId: "T-1", id: "changed-policy", command: "true" });
    const result = await checkTaskExecutionResult(dir, started.attempt, "T-1");
    assert.match(result.diagnostics.join(" "), /run, task or attempt changed/);
    assert.match(result.diagnostics.join(" "), /task contract changed/);
    assert.match(result.diagnostics.join(" "), /validation policy changed/);
    await interruptTaskExecution(dir, initial.lockId, initial.attempt.id, result.diagnostics);
    assert.equal((await loadState(dir)).tasks[0]?.attemptId, "replacement");
    assert.equal((await loadState(dir)).tasks[0]?.status, "running");
  });
});

test("retry admission creates a distinct identity and interrupted prelaunch retry stays blocked", async () => {
  await fixture(async (dir) => {
    const initial = await admitted(dir);
    await startTaskExecution(dir, initial.lockId, initial.state, initial.attempt);
    await interruptTaskExecution(dir, initial.lockId, initial.attempt.id, ["interrupted"]);
    const retryState = await loadState(dir);
    retryState.tasks[0]!.status = "ready";
    await saveState(dir, retryState);
    const retry = await admitTaskExecution(dir, initial.lockId, retryState, retryState.tasks[0]!, initial.context, "test", []);
    assert.notEqual(retry.id, initial.attempt.id);
    assert.equal(retry.taskFingerprint, initial.attempt.taskFingerprint);
    await interruptTaskExecution(dir, initial.lockId, retry.id, ["prelaunch failure"]);
    assert.equal((await loadState(dir)).tasks[0]?.status, "blocked");
    assert.equal((await loadTaskAttempts(dir))[0]?.outcome, "not_started");
  });
});

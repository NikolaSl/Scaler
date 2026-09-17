/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createDefaultState, ensureState, formatDetailedStateStatus, formatStateStatus, getTaskStatusCounts, loadState, saveState } from "../src/state.js";
import { getStatePath } from "../src/paths.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("createDefaultState creates idle state", () => {
  const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));

  assert.equal(state.version, 1);
  assert.equal(state.stage, "idle");
  assert.equal(state.complexityLevel, 0);
  assert.equal(state.currentTaskId, null);
  assert.equal(state.createdAt, "2026-01-01T00:00:00.000Z");
});

test("loadState returns default when state file is missing", async () => {
  await withTempDir(async (dir) => {
    const state = await loadState(dir);

    assert.equal(state.stage, "idle");
    assert.equal(state.tasks.length, 0);
  });
});

test("saveState and loadState persist state", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState();
    state.stage = "planning";
    state.complexityLevel = 3;

    await saveState(dir, state);
    const loaded = await loadState(dir);

    assert.equal(loaded.stage, "planning");
    assert.equal(loaded.complexityLevel, 3);
  });
});

test("ensureState creates .scaler/state.json", async () => {
  await withTempDir(async (dir) => {
    const state = await ensureState(dir);
    const raw = await readFile(getStatePath(dir), "utf8");

    assert.equal(state.stage, "idle");
    assert.match(raw, /\"stage\": \"idle\"/);
  });
});

test("ensureState reads existing state without changing bytes or modification time", async () => {
  await withTempDir(async (dir) => {
    await saveState(dir, createDefaultState());
    const path = getStatePath(dir);
    const oldTime = new Date("2020-01-01T00:00:00Z");
    await utimes(path, oldTime, oldTime);
    const before = await readFile(path, "utf8");
    const result = await ensureState(dir);
    assert.deepEqual(result, JSON.parse(before));
    assert.equal(await readFile(path, "utf8"), before);
    assert.equal((await stat(path)).mtimeMs, oldTime.getTime());
  });
});

test("concurrent initialization returns one durable run identity", async () => {
  await withTempDir(async (dir) => {
    const states = await Promise.all(Array.from({ length: 16 }, () => ensureState(dir)));
    const stored = await loadState(dir);
    assert.ok(states.every((state) => state.runId === stored.runId));
    assert.deepEqual(await readdir(join(dir, ".scaler")), ["state.json"]);
  });
});

test("ensureState preserves malformed state and fails instead of resetting it", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, ".scaler"));
    await writeFile(getStatePath(dir), '{"runId":');
    await assert.rejects(ensureState(dir), SyntaxError);
    assert.equal(await readFile(getStatePath(dir), "utf8"), '{"runId":');
  });
});

test("readers see complete state snapshots while replacements are written", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState();
    state.orchestrationReason = "x".repeat(256_000);
    await saveState(dir, state);
    const results = await Promise.allSettled([
      (async () => {
        for (let i = 0; i < 16; i++) {
          state.orchestrationReason = String(i).repeat(256_000);
          await saveState(dir, state);
        }
      })(),
      (async () => {
        for (let i = 0; i < 64; i++) {
          const loaded = await loadState(dir);
          assert.equal(loaded.runId, state.runId);
          assert.ok(loaded.orchestrationReason && loaded.orchestrationReason.length >= 256_000);
        }
      })(),
    ]);
    for (const result of results) if (result.status === "rejected") throw result.reason;
    assert.deepEqual(await readdir(join(dir, ".scaler")), ["state.json"]);
  });
});

test("failed state publication preserves the destination and cleans temporary data", async () => {
  await withTempDir(async (dir) => {
    const destination = getStatePath(dir);
    await mkdir(destination, { recursive: true });
    await writeFile(join(destination, "existing"), "preserve");
    await assert.rejects(saveState(dir, createDefaultState()));
    assert.equal(await readFile(join(destination, "existing"), "utf8"), "preserve");
    assert.deepEqual(await readdir(join(dir, ".scaler")), ["state.json"]);
  });
});

test("formatStateStatus returns compact status", () => {
  const state = createDefaultState();
  state.tasks = [{ id: "T-001", status: "validated", updatedAt: state.createdAt }];
  state.validatedTaskIds = ["T-001"];

  assert.equal(formatStateStatus(state), "SCALER stage=idle level=0 validated=1/1");
});

test("stale snapshots cannot overwrite a committed update", async () => {
  await withTempDir(async (dir) => {
    await ensureState(dir);
    const winner = await loadState(dir);
    const stale = await loadState(dir);
    winner.memoryRefs.push("retained-evidence");
    await saveState(dir, winner);
    const before = await readFile(getStatePath(dir), "utf8");
    stale.stage = "planning";
    await assert.rejects(saveState(dir, stale), { name: "StateConflictError" });
    assert.equal(await readFile(getStatePath(dir), "utf8"), before);
  });
});

test("independent processes cannot both publish the same base revision", { timeout: 15000 }, async () => {
  await withTempDir(async (dir) => {
    await ensureState(dir);
    const source = new URL("../src/state.ts", import.meta.url).href;
    const children = Array.from({ length: 2 }, (_, index) => {
      const script = `
        import { loadState, saveState } from ${JSON.stringify(source)};
        const state = await loadState(process.argv[1]);
        state.memoryRefs.push(process.argv[2]);
        process.once('message', async () => {
          try { await saveState(process.argv[1], state); process.exitCode = 0; }
          catch (error) { process.exitCode = error.name === 'StateConflictError' ? 2 : 3; }
          finally { process.disconnect(); }
        });
        process.send('ready');
      `;
      const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script, dir, `writer-${index}`], {
        stdio: ["ignore", "ignore", "pipe", "ipc"],
      });
      return { child, ready: once(child, "message"), done: once(child, "exit") };
    });
    try {
      await Promise.all(children.map(({ ready }) => ready));
      for (const { child } of children) child.send("save");
      const codes = (await Promise.all(children.map(({ done }) => done))).map(([code]) => code).sort();
      assert.deepEqual(codes, [0, 2]);
      assert.equal((await loadState(dir)).memoryRefs.length, 1);
    } finally {
      for (const { child } of children) if (child.exitCode === null) child.kill("SIGKILL");
    }
  });
});

test("a saved snapshot cannot recreate state deleted after it was read", async () => {
  await withTempDir(async (dir) => {
    const state = await ensureState(dir);
    await rm(getStatePath(dir));
    await assert.rejects(saveState(dir, state), { name: "StateConflictError" });
    await assert.rejects(readFile(getStatePath(dir)), { code: "ENOENT" });
  });
});

test("a fresh run cannot silently replace an existing run", async () => {
  await withTempDir(async (dir) => {
    const original = await ensureState(dir);
    await assert.rejects(saveState(dir, createDefaultState()), { name: "StateConflictError" });
    assert.equal((await loadState(dir)).runId, original.runId);
  });
});

test("legacy state reads preserve bytes and old acceptance labels without inventing evidence", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, ".scaler"));
    const { revision: _revision, ...legacy } = createDefaultState();
    legacy.validatedTaskIds = ["legacy-task"];
    const raw = JSON.stringify(legacy);
    await writeFile(getStatePath(dir), raw);
    const first = await ensureState(dir);
    const stale = await loadState(dir);
    assert.equal(first.revision, 1);
    assert.deepEqual(first.validatedTaskIds, ["legacy-task"]);
    assert.equal(await readFile(getStatePath(dir), "utf8"), raw);
    first.memoryRefs.push("new-evidence");
    await saveState(dir, first);
    assert.equal(first.revision, 2);
    await assert.rejects(saveState(dir, stale), { name: "StateConflictError" });
  });
});

test("invalid persisted revision is never reset or overwritten", async () => {
  await withTempDir(async (dir) => {
    const state = await ensureState(dir);
    for (const revision of [null, -1, 0, 1.5, "1", Number.MAX_SAFE_INTEGER + 1]) {
      const raw = JSON.stringify({ ...state, revision });
      await writeFile(getStatePath(dir), raw);
      await assert.rejects(loadState(dir), /Invalid stored state revision/);
      await assert.rejects(ensureState(dir), /Invalid stored state revision/);
      await assert.rejects(saveState(dir, state), /Invalid stored state revision/);
      assert.equal(await readFile(getStatePath(dir), "utf8"), raw);
    }
  });
});

test("publication lock is bounded and never stolen even when old", async () => {
  await withTempDir(async (dir) => {
    const state = await ensureState(dir);
    const before = await readFile(getStatePath(dir), "utf8");
    const lock = `${getStatePath(dir)}.lock`;
    await mkdir(lock);
    await utimes(lock, new Date(0), new Date(0));
    const revision = state.revision;
    await assert.rejects(saveState(dir, state), { name: "StateWriteBusyError" });
    assert.equal(state.revision, revision);
    assert.equal(await readFile(getStatePath(dir), "utf8"), before);
    assert.equal((await stat(lock)).isDirectory(), true);
    // Recovery here is fixture-controlled: no other writer is alive.
    await rm(lock, { recursive: true });
    await saveState(dir, state);
    assert.equal(state.revision, revision + 1);
    assert.equal(state.updatedAt, (await loadState(dir)).updatedAt);
  });
});

test("getTaskStatusCounts counts tasks by status", () => {
  const state = createDefaultState();
  state.tasks = [
    { id: "T-001", status: "ready", updatedAt: state.createdAt },
    { id: "T-002", status: "ready", updatedAt: state.createdAt },
    { id: "T-003", status: "validated", updatedAt: state.createdAt },
  ];

  assert.deepEqual(getTaskStatusCounts(state), { ready: 2, validated: 1 });
});

test("formatDetailedStateStatus includes task counts, rejected count, memory count, debug counts, budgets, and log path", () => {
  const state = createDefaultState();
  state.tasks = [{ id: "T-001", status: "ready", updatedAt: state.createdAt }];
  state.rejectedTransitions = [{ kind: "stage", from: "planning", to: "knowledge", reason: "bad", timestamp: state.createdAt }];

  const status = formatDetailedStateStatus(state, {
    memoryCount: 3,
    debugFailureCount: 2,
    debugAttemptCount: 5,
    budgetUsage: { toolCalls: 7, spawnedAgents: 1 },
    logPath: ".scaler/logs/events.jsonl",
  });

  assert.match(status, /tasks=ready:1/);
  assert.match(status, /rejected=1/);
  assert.match(status, /memories=3/);
  assert.match(status, /debug=failures:2,attempts:5/);
  assert.match(status, /budgets=spawnedAgents:1,toolCalls:7/);
  assert.match(status, /log=.scaler\/logs\/events.jsonl/);
});

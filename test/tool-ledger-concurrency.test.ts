/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { getToolRequestsDir, getToolResultsPath } from "../src/paths.js";
import { createDefaultState } from "../src/state.js";
import { loadToolRequests, loadToolResults, loadToolTransactions, prepareToolRequest, recordToolResult, runToolRequestAgent } from "../src/tool-requests.js";

async function withDirectory(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-tool-ledger-"));
  try { await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

test("parallel request and transaction writers retain every record", async () => {
  await withDirectory(async (dir) => {
    const state = createDefaultState();
    const requests = await Promise.all(Array.from({ length: 12 }, (_, i) => prepareToolRequest(dir, state, {
      toolName: "read", request: `Synthetic request ${i}`, taskId: `T-${i}`,
    })));
    const ids = requests.map(({ record }) => record!.id).sort();
    assert.deepEqual((await loadToolRequests(dir)).map(r => r.id).sort(), ids);
    await Promise.all(ids.map(requestId => runToolRequestAgent(dir, state, { requestId, execute: false })));
    assert.deepEqual((await loadToolTransactions(dir)).map(r => r.requestId).sort(), ids);
  });
});

test("concurrent readers never observe a partially published result index", async () => {
  await withDirectory(async (dir) => {
    const state = createDefaultState();
    const request = (await prepareToolRequest(dir, state, { toolName: "read", request: "Synthetic large result" })).record!;
    await recordToolResult(dir, state, { requestId: request.id, status: "completed", summary: "Initial", outputs: "initial" });
    const results = await Promise.allSettled([
      (async () => {
        for (let i = 0; i < 8; i++) await recordToolResult(dir, state, {
          requestId: request.id, status: "completed", summary: `Result ${i}`, outputs: "x".repeat(256 * 1024),
        });
      })(),
      (async () => {
        for (let i = 0; i < 80; i++) assert.ok((await loadToolResults(dir)).length >= 1);
      })(),
    ]);
    for (const result of results) if (result.status === "rejected") throw result.reason;
    assert.equal((await loadToolResults(dir)).length, 9);
  });
});

test("separate tool workers retain all request result and transaction identities", { timeout: 25000 }, async () => {
  await withDirectory(async (dir) => {
    const moduleUrl = new URL("../src/tool-requests.ts", import.meta.url).href;
    const stateUrl = new URL("../src/state.ts", import.meta.url).href;
    const children = Array.from({ length: 4 }, (_, i) => {
      const script = `
        import { prepareToolRequest, recordToolResult, runToolRequestAgent } from ${JSON.stringify(moduleUrl)};
        import { createDefaultState } from ${JSON.stringify(stateUrl)};
        const state = createDefaultState();
        process.once('message', async () => {
          try {
            const {record} = await prepareToolRequest(process.argv[1], state, {toolName:'read',request:'Synthetic',taskId:process.argv[2]});
            await runToolRequestAgent(process.argv[1], state, {requestId:record.id,execute:true}, async request => {
              await recordToolResult(process.argv[1], state, {requestId:record.id,executionId:request.executionId,status:'completed',summary:'Synthetic result',outputs:{ok:true}});
              return {taskId:request.taskId,exitCode:0,stdoutEvents:[],stderr:'',timedOut:false,aborted:false};
            });
          } catch (error) { console.error(error); process.exitCode=1; }
          finally { process.disconnect(); }
        });
        process.send('ready');
      `;
      const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script, dir, `T-${i}`], {
        stdio: ["ignore", "ignore", "pipe", "ipc"],
      });
      let stderr = "";
      child.stderr!.on("data", chunk => { stderr += String(chunk); });
      const done = once(child, "exit");
      const ready = Promise.race([once(child, "message"), done.then(() => { throw new Error(`Worker exited before ready: ${stderr}`); })]);
      const timer = setTimeout(() => child.kill("SIGKILL"), 20000);
      return { child, done, ready, timer, stderr: () => stderr };
    });
    try {
      await Promise.all(children.map(c => c.ready));
      children.forEach(c => c.child.send("start"));
      const codes = await Promise.all(children.map(c => c.done));
      codes.forEach(([code], i) => assert.equal(code, 0, children[i]!.stderr()));
      const requests = await loadToolRequests(dir);
      assert.deepEqual(requests.map(r => r.taskId).sort(), ["T-0", "T-1", "T-2", "T-3"]);
      assert.ok(requests.every(r => r.status === "completed"));
      const ids = requests.map(r => r.id).sort();
      assert.deepEqual((await loadToolResults(dir)).map(r => r.requestId).sort(), ids);
      assert.deepEqual((await loadToolTransactions(dir)).map(r => r.requestId).sort(), ids);
    } finally {
      for (const c of children) { clearTimeout(c.timer); if (c.child.exitCode === null) c.child.kill("SIGKILL"); }
      await Promise.all(children.map(c => c.done));
    }
  });
});

test("failed result serialization preserves the prior index and releases the writer", async () => {
  await withDirectory(async (dir) => {
    const state = createDefaultState();
    const request = (await prepareToolRequest(dir, state, { toolName: "read", request: "Synthetic" })).record!;
    await recordToolResult(dir, state, { requestId: request.id, status: "completed", summary: "Initial", outputs: 1 });
    const before = await readFile(getToolResultsPath(dir), "utf8");
    await assert.rejects(recordToolResult(dir, state, { requestId: request.id, status: "completed", summary: "Invalid JSON", outputs: 1n }));
    assert.equal(await readFile(getToolResultsPath(dir), "utf8"), before);
    await recordToolResult(dir, state, { requestId: request.id, status: "completed", summary: "Recovery", outputs: 2 });
    assert.equal((await loadToolResults(dir)).length, 2);
    assert.ok((await readdir(getToolRequestsDir(dir))).every(p => !p.endsWith(".tmp") && !p.endsWith(".lock")));
  });
});

test("lock cleanup failure does not turn a committed result into a failed tool call", async () => {
  await withDirectory(async (dir) => {
    const state = createDefaultState();
    const request = (await prepareToolRequest(dir, state, { toolName: "read", request: "Synthetic" })).record!;
    const lock = join(getToolRequestsDir(dir), "execution-ledger.lock");
    let injected = false;
    let receiveWarning = (_warning: Error & { code?: string }): void => undefined;
    const warning = new Promise<Error & { code?: string }>((resolve) => { receiveWarning = resolve; });
    const onWarning = (emitted: Error & { code?: string }): void => {
      if (emitted.code === "SCALER_TOOL_LEDGER_LOCK_RELEASE_FAILED") receiveWarning(emitted);
    };
    process.on("warning", onWarning);
    try {
      const record = await recordToolResult(dir, state, {
        requestId: request.id,
        status: "completed",
        summary: "Committed before cleanup",
        outputs: {
          toJSON() {
            if (!injected) {
              writeFileSync(join(lock, "foreign-entry"), "force rmdir failure", "utf8");
              injected = true;
            }
            return { ok: true };
          },
        },
      });
      const emitted = await warning;
      assert.equal(emitted.code, "SCALER_TOOL_LEDGER_LOCK_RELEASE_FAILED");
      assert.equal((await loadToolResults(dir))[0]?.id, record.id);
      assert.deepEqual(await readdir(lock), ["foreign-entry"]);
    } finally {
      process.off("warning", onWarning);
    }

    await rm(lock, { recursive: true });
    const next = await prepareToolRequest(dir, state, { toolName: "read", request: "After reconciliation" });
    assert.equal(next.accepted, true);
  });
});

test("an existing tool publication lock is not stolen", async () => {
  await withDirectory(async (dir) => {
    const lock = join(getToolRequestsDir(dir), "execution-ledger.lock");
    await mkdir(lock, { recursive: true });
    await assert.rejects(prepareToolRequest(dir, createDefaultState(), { toolName: "read", request: "Synthetic" }), /publication lock/);
    assert.deepEqual(await loadToolRequests(dir), []);
    assert.deepEqual(await readdir(getToolRequestsDir(dir)), ["execution-ledger.lock"]);
  });
});

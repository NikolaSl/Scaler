import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildTaskAgentInvocation, extractStructuredReportPayloads, getDefaultScalerChildExtensionPath, runTaskAgent } from "../src/subagents.js";
import { loadWatchdogCleanupRecords } from "../src/watchdogs.js";

async function withScript<T>(content: string, fn: (script: string, dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-subagent-test-"));
  const script = join(dir, "runner.sh");
  try {
    await writeFile(script, content, "utf8");
    await chmod(script, 0o755);
    return await fn(script, dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("buildTaskAgentInvocation creates deny-by-default isolated pi invocation", () => {
  const invocation = buildTaskAgentInvocation({ taskId: "T-001", prompt: "Do task" });

  assert.equal(invocation.command, "pi");
  assert.deepEqual(invocation.args, ["--mode", "json", "-p", "--no-session", "--no-tools", "Do task"]);
});

test("buildTaskAgentInvocation includes tools, model, cwd, prompt file, and explicit extensions", () => {
  const invocation = buildTaskAgentInvocation(
    {
      taskId: "T-002",
      prompt: "Task prompt",
      cwd: "/tmp/project",
      tools: ["read", "bash"],
      model: "test-model",
      appendSystemPromptPath: "/tmp/prompt.md",
      extensionPaths: ["./src/index.ts"],
    },
    "custom-pi",
  );

  assert.equal(invocation.command, "custom-pi");
  assert.equal(invocation.cwd, "/tmp/project");
  assert.deepEqual(invocation.args, [
    "--mode",
    "json",
    "-p",
    "--no-session",
    "-e",
    "./src/index.ts",
    "--model",
    "test-model",
    "--tools",
    "read,bash",
    "--append-system-prompt",
    "/tmp/prompt.md",
    "Task prompt",
  ]);
});

test("buildTaskAgentInvocation treats empty optional arrays as no tools", () => {
  const invocation = buildTaskAgentInvocation({ taskId: "T-003", prompt: "Task", tools: [], extensionPaths: [] });

  assert.deepEqual(invocation.args, ["--mode", "json", "-p", "--no-session", "--no-tools", "Task"]);
});

 test("buildTaskAgentInvocation loads default SCALER extension when granting tools", () => {
  const invocation = buildTaskAgentInvocation({ taskId: "T-tools", prompt: "Use read", tools: ["read", "read", " "] });

  assert.deepEqual(invocation.args.slice(0, 6), ["--mode", "json", "-p", "--no-session", "-e", getDefaultScalerChildExtensionPath()]);
  assert.ok(invocation.args.includes("--tools"));
  assert.ok(invocation.args.includes("read"));
});

test("buildTaskAgentInvocation can disable all tools for report-only child agents", () => {
  const invocation = buildTaskAgentInvocation({ taskId: "T-no-tools", prompt: "Report only", tools: ["read"], noTools: true });

  assert.deepEqual(invocation.args, ["--mode", "json", "-p", "--no-session", "--no-tools", "Report only"]);
});

test("extractStructuredReportPayloads accepts direct, nested, and exact Pi assistant JSON reports", () => {
  const piTextReport = {
    type: "message_end",
    message: {
      role: "assistant",
      content: [{
        type: "text",
        text: JSON.stringify({ type: "scaler_debug_report", taskId: "T-PI", status: "next_approach", summary: "Pi wrapped", nextApproach: "Use parsed assistant text." }),
      }],
    },
  };
  const payloads = extractStructuredReportPayloads([
    { type: "scaler_debug_report", taskId: "T-DIRECT" },
    { payload: { type: "scaler_debug_report", taskId: "T-NESTED" } },
    piTextReport,
  ], "scaler_debug_report");

  assert.deepEqual(payloads.map((payload) => payload.taskId), ["T-DIRECT", "T-NESTED", "T-PI"]);
});

test("extractStructuredReportPayloads rejects prose, markdown, user text, and wrong report types", () => {
  const payloads = extractStructuredReportPayloads([
    { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Here is the report: {\"type\":\"scaler_debug_report\",\"taskId\":\"T\"}" }] } },
    { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "```json\n{\"type\":\"scaler_debug_report\",\"taskId\":\"T\"}\n```" }] } },
    { type: "message_end", message: { role: "user", content: [{ type: "text", text: "{\"type\":\"scaler_debug_report\",\"taskId\":\"T\"}" }] } },
    { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "{\"type\":\"scaler_research_report\",\"requestId\":\"R\"}" }] } },
  ], "scaler_debug_report");

  assert.deepEqual(payloads, []);
});

test("runTaskAgent reports default timeout and abort flags", async () => {
  await withScript('#!/bin/sh\necho "{\\\"type\\\":\\\"done\\\"}"\n', async (script, dir) => {
    const result = await runTaskAgent({ taskId: "T-004", prompt: "ignored", cwd: dir }, { command: script });

    assert.equal(result.exitCode, 0);
    assert.equal(result.timedOut, false);
    assert.equal(result.aborted, false);
    assert.deepEqual(result.stdoutEvents, [{ type: "done" }]);
  });
});

test("runTaskAgent attaches provider usage from JSON stdout events", async () => {
  const event = JSON.stringify({
    type: "turn_end",
    message: {
      role: "assistant",
      usage: { input: 11, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 16, cost: { total: 0.000016 } },
    },
  });
  await withScript(`#!/bin/sh\necho '${event}'\n`, async (script, dir) => {
    const result = await runTaskAgent({ taskId: "T-usage", prompt: "ignored", cwd: dir }, { command: script });

    assert.equal(result.exitCode, 0);
    assert.equal(result.usage?.totalTokens, 16);
    assert.equal(result.usage?.costMicros, 16);
  });
});

test("runTaskAgent reports timeout diagnostics", async () => {
  await withScript("#!/bin/sh\nsleep 0.2\n", async (script, dir) => {
    const result = await runTaskAgent({ taskId: "T-005", prompt: "ignored", cwd: dir }, { command: script, timeoutMs: 10 });

    assert.equal(result.timedOut, true);
    assert.equal(result.aborted, false);
    assert.match(result.stderr, /timed out/);
    assert.equal((await loadWatchdogCleanupRecords(dir))[0]?.reason, "timeout");
  });
});

test("runTaskAgent reports abort diagnostics", async () => {
  await withScript("#!/bin/sh\nsleep 0.2\n", async (script, dir) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10);
    const result = await runTaskAgent({ taskId: "T-006", prompt: "ignored", cwd: dir }, { command: script, signal: controller.signal });

    assert.equal(result.timedOut, false);
    assert.equal(result.aborted, true);
    assert.equal((await loadWatchdogCleanupRecords(dir))[0]?.reason, "abort");
  });
});

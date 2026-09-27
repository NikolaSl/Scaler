/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { getEventListeners } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildTaskAgentInvocation, extractStructuredReportPayloads, getDefaultScalerChildExtensionPath, runTaskAgent, taskAgentRunSucceeded, TaskAgentInvocationAdmissionError } from "../src/subagents.js";
import { loadWatchdogCleanupRecords } from "../src/watchdogs.js";
import { testProviderAdmissionModel } from "./provider-model-fixture.js";

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

test("strict child invocation refuses tool grants that its isolated loader cannot provide", () => {
  for (const enforceLoadedToolAvailability of [undefined, false, true]) {
    assert.throws(() => buildTaskAgentInvocation({
      taskId: "T-external",
      prompt: "Browse",
      tools: ["browser", "mcp-docs"],
      enforceLoadedToolAvailability,
      providerAdmission: { requestTokenAllowance: 8_000, outputReserveTokens: 1_024, safetyMarginTokens: 1_024 },
      providerAdmissionModel: testProviderAdmissionModel,
    }), {
      name: "TaskAgentInvocationAdmissionError",
      message: /cannot load granted tools: browser, mcp-docs/i,
    });
  }
});

test("strict child invocation returns structured admission errors for malformed tool grants", () => {
  const sparse = Array(1) as string[];
  for (const tools of [[null], [1], "read", { name: "read" }, sparse]) {
    assert.throws(() => buildTaskAgentInvocation({
      taskId: "T-malformed-tools",
      prompt: "Inspect",
      tools: tools as string[],
      providerAdmission: { requestTokenAllowance: 8_000, outputReserveTokens: 1_024, safetyMarginTokens: 1_024 },
      providerAdmissionModel: testProviderAdmissionModel,
    }), {
      name: "TaskAgentInvocationAdmissionError",
      message: /malformed granted tools/i,
    });
  }
});

test("task-agent success rejects Pi JSON-mode terminal abort and error events despite exit zero", () => {
  for (const stopReason of ["aborted", "error"]) {
    assert.equal(taskAgentRunSucceeded({
      taskId: "T-stop", exitCode: 0, stderr: "", timedOut: false, aborted: false,
      stdoutEvents: [{ type: "message_end", message: { role: "assistant", stopReason } }],
    }), false);
  }
  assert.equal(taskAgentRunSucceeded({
    taskId: "T-stop", exitCode: 0, stderr: "", timedOut: false, aborted: false,
    stdoutEvents: [{ type: "message_end", message: { role: "assistant", stopReason: "stop" } }],
  }), true);
  assert.equal(taskAgentRunSucceeded({
    taskId: "T-retry", exitCode: 0, stderr: "", timedOut: false, aborted: false,
    stdoutEvents: [
      { type: "message_end", message: { role: "assistant", stopReason: "error" } },
      { type: "auto_retry_start" },
      { type: "message_end", message: { role: "assistant", stopReason: "stop" } },
      { type: "auto_retry_end", success: true },
    ],
  }), true);
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

test("runTaskAgent marks children so host hooks preserve their selected tools", async () => {
  await withScript('#!/bin/sh\nprintf \'{"child":"%s"}\\n\' "$SCALER_CHILD_AGENT"\n', async (script, dir) => {
    const result = await runTaskAgent({ taskId: "T-child", prompt: "ignored", cwd: dir }, { command: script });
    assert.equal(result.exitCode, 0);
    assert.deepEqual(result.stdoutEvents, [{ child: "1" }]);
  });
});

test("runTaskAgent supplies only the runtime-owned tool execution identity", async () => {
  await withScript('#!/bin/sh\nprintf \'{"execution":"%s"}\\n\' "$SCALER_TOOL_EXECUTION_ID"\n', async (script, dir) => {
    const previous = process.env.SCALER_TOOL_EXECUTION_ID;
    process.env.SCALER_TOOL_EXECUTION_ID = "ambient-spoof";
    try {
      const bound = await runTaskAgent({ taskId: "T-bound", executionId: "execution-123", prompt: "ignored", cwd: dir }, { command: script });
      const unbound = await runTaskAgent({ taskId: "T-unbound", prompt: "ignored", cwd: dir }, { command: script });
      assert.deepEqual(bound.stdoutEvents, [{ execution: "execution-123" }]);
      assert.deepEqual(unbound.stdoutEvents, [{ execution: "" }]);
    } finally {
      if (previous === undefined) delete process.env.SCALER_TOOL_EXECUTION_ID;
      else process.env.SCALER_TOOL_EXECUTION_ID = previous;
    }
  });
});

test("runTaskAgent reports timeout diagnostics", async () => {
  await withScript("#!/bin/sh\nsleep 0.2\n", async (script, dir) => {
    const result = await runTaskAgent({ taskId: "T-005", prompt: "ignored", cwd: dir }, { command: script, timeoutMs: 10 });

    assert.equal(result.timedOut, true);
    assert.equal(result.aborted, false);
    assert.notEqual(result.exitCode, 0);
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
    assert.notEqual(result.exitCode, 0);
    assert.equal((await loadWatchdogCleanupRecords(dir))[0]?.reason, "abort");
  });
});

test("runTaskAgent escalates a TERM-ignoring process and confirms its exit", { skip: process.platform === "win32" }, async () => {
  await withScript(`#!/usr/bin/env node
const fs = require('node:fs');
process.on('SIGTERM', () => {});
fs.writeFileSync('ready.pid', String(process.pid));
setInterval(() => {}, 1000);
// Safety stop makes the regression fail without leaving an immortal child.
setTimeout(() => process.exit(0), 7000);
`, async (script, dir) => {
    const controller = new AbortController();
    const run = runTaskAgent({ taskId: "T-ignore-term", prompt: "ignored", cwd: dir }, { command: script, signal: controller.signal });
    let pid: number | undefined;
    try {
      for (let i = 0; i < 200; i++) {
        try { pid = Number(await readFile(join(dir, "ready.pid"), "utf8")); break; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        await delay(10);
      }
      assert.ok(pid, "child must install its TERM handler before cancellation");
      controller.abort();
      const result = await run;
      assert.equal(result.aborted, true);
      assert.notEqual(result.exitCode, 0);
      assert.throws(() => process.kill(pid!, 0), { code: "ESRCH" });
      const cleanup = (await loadWatchdogCleanupRecords(dir))[0];
      assert.equal(cleanup?.status, "completed");
      assert.match(cleanup?.signal ?? "", /SIGKILL/);
    } finally {
      if (pid) { try { process.kill(pid, "SIGKILL"); } catch {} }
      await run.catch(() => undefined);
    }
  });
});

test("runTaskAgent does not launch when already cancelled", async () => {
  await withScript('#!/bin/sh\necho launched > launched.txt\n', async (script, dir) => {
    const controller = new AbortController();
    controller.abort();
    const result = await runTaskAgent({ taskId: "T-cancelled", prompt: "ignored", cwd: dir }, { command: script, signal: controller.signal });
    assert.equal(result.aborted, true);
    assert.notEqual(result.exitCode, 0);
    await assert.rejects(readFile(join(dir, "launched.txt")), { code: "ENOENT" });
  });
});

test("runTaskAgent rejects a missing executable without waiting for its timeout", async () => {
  await withScript('#!/bin/sh\nexit 0\n', async (_script, dir) => {
    const controller = new AbortController();
    await assert.rejects(runTaskAgent({ taskId: "T-missing", prompt: "ignored", cwd: dir }, { command: join(dir, "missing"), timeoutMs: 10_000, signal: controller.signal }), { code: "ENOENT" });
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  });
});

test("runTaskAgent removes cancellation listeners after normal completion", async () => {
  await withScript('#!/bin/sh\nexit 0\n', async (script, dir) => {
    const controller = new AbortController();
    const result = await runTaskAgent({ taskId: "T-complete", prompt: "ignored", cwd: dir }, { command: script, timeoutMs: 10_000, signal: controller.signal });
    assert.equal(result.exitCode, 0);
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
    controller.abort();
    assert.deepEqual(await loadWatchdogCleanupRecords(dir), []);
  });
});

test("runTaskAgent enforces raw stdout bytes before decoding or parsing", async () => {
  const script = `#!/usr/bin/env node
const bytes = Buffer.from("f09f99820a", "hex");
process.stdout.write(bytes.subarray(0, 2));
setTimeout(() => process.stdout.write(bytes.subarray(2)), 5);
`;
  await withScript(script, async (command, dir) => {
    const exact = await runTaskAgent(
      { taskId: "T-output-exact", prompt: "ignored", cwd: dir },
      { command, outputLimits: { stdoutBytes: 5, stderrBytes: 32 }, timeoutMs: 2_000 },
    );
    assert.equal(exact.exitCode, 0);
    assert.equal(exact.stdoutBytes, 5);
    assert.equal(exact.outputLimitExceeded, undefined);
    assert.deepEqual(exact.stdoutEvents, [{ type: "unparsed", text: "🙂" }]);

    const over = await runTaskAgent(
      { taskId: "T-output-over", prompt: "ignored", cwd: dir },
      { command, outputLimits: { stdoutBytes: 4, stderrBytes: 32 }, timeoutMs: 2_000 },
    );
    assert.equal(over.exitCode, 125);
    assert.equal(over.stdoutBytes, 5);
    assert.equal(over.outputLimitExceeded, "stdout");
  });
});

test("runTaskAgent bounds newline-free stdout and stderr floods", async () => {
  const stdoutScript = "#!/usr/bin/env node\nprocess.stdout.write('x'.repeat(257));\n";
  await withScript(stdoutScript, async (command, dir) => {
    const result = await runTaskAgent(
      { taskId: "T-stdout-flood", prompt: "ignored", cwd: dir },
      { command, outputLimits: { stdoutBytes: 256, stderrBytes: 64 }, timeoutMs: 2_000 },
    );
    assert.equal(result.outputLimitExceeded, "stdout");
    assert.equal(result.stdoutBytes, 257);
    assert.equal(result.exitCode, 125);
  });

  const stderrScript = "#!/usr/bin/env node\nprocess.stderr.write('e'.repeat(65));\n";
  await withScript(stderrScript, async (command, dir) => {
    const result = await runTaskAgent(
      { taskId: "T-stderr-flood", prompt: "ignored", cwd: dir },
      { command, outputLimits: { stdoutBytes: 256, stderrBytes: 64 }, timeoutMs: 2_000 },
    );
    assert.equal(result.outputLimitExceeded, "stderr");
    assert.equal(result.stderrBytes, 65);
    assert.equal(result.exitCode, 125);
    assert.ok(Buffer.byteLength(result.stderr, "utf8") < 256);
  });
});

test("runTaskAgent reports all raw bytes observed in the chunk that crosses the cap", async () => {
  const script = "#!/usr/bin/env node\nprocess.stdout.write(Buffer.alloc(1024, 120));\n";
  await withScript(script, async (command, dir) => {
    const result = await runTaskAgent(
      { taskId: "T-observed-output", prompt: "ignored", cwd: dir },
      { command, outputLimits: { stdoutBytes: 8, stderrBytes: 64 }, timeoutMs: 2_000 },
    );
    assert.equal(result.outputLimitExceeded, "stdout");
    assert.equal(result.stdoutBytes, 1024);
    assert.equal(result.exitCode, 125);
  });
});

test("runTaskAgent escalates output overflow when the child ignores TERM", { skip: process.platform === "win32" }, async () => {
  const script = `#!/usr/bin/env node
process.on("SIGTERM", () => {});
process.stdout.write(Buffer.alloc(1024, 120));
setInterval(() => {}, 1000);
setTimeout(() => process.exit(0), 7000);
`;
  await withScript(script, async (command, dir) => {
    const result = await runTaskAgent(
      { taskId: "T-output-ignore-term", prompt: "ignored", cwd: dir },
      { command, outputLimits: { stdoutBytes: 8, stderrBytes: 64 }, timeoutMs: 10_000 },
    );
    assert.equal(result.outputLimitExceeded, "stdout");
    assert.equal(result.stdoutBytes, 1024);
    assert.equal(result.exitCode, 125);
    assert.match((await loadWatchdogCleanupRecords(dir))[0]?.signal ?? "", /SIGKILL/);
  });
});

test("runTaskAgent refuses invalid runtime output limits before spawn", async () => {
  await withScript("#!/bin/sh\necho launched > launched.txt\n", async (command, dir) => {
    for (const stdoutBytes of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      await assert.rejects(runTaskAgent(
        { taskId: "T-invalid-output-limit", prompt: "ignored", cwd: dir },
        { command, outputLimits: { stdoutBytes, stderrBytes: 64 } },
      ), /output limit|positive safe integer/i);
    }
    await assert.rejects(readFile(join(dir, "launched.txt")), { code: "ENOENT" });
  });
});

const strictProviderPolicy = { requestTokenAllowance: 8_000, outputReserveTokens: 32, safetyMarginTokens: 1_024 };
const strictProviderModel = { api: "openai-completions", provider: "synthetic", id: "shared-model", contextWindow: 8_000 };
const providerPolicyEnvKeys = [
  "SCALER_PROVIDER_ADMISSION", "SCALER_REQUEST_TOKEN_ALLOWANCE",
  "SCALER_OUTPUT_RESERVE_TOKENS", "SCALER_REQUEST_MARGIN_TOKENS",
  "SCALER_EXPECTED_PROVIDER_API", "SCALER_EXPECTED_PROVIDER",
  "SCALER_EXPECTED_MODEL_ID", "SCALER_EXPECTED_CONTEXT_WINDOW",
] as const;

async function withInheritedProviderPolicy<T>(fn: () => Promise<T>): Promise<T> {
  const previous = Object.fromEntries(providerPolicyEnvKeys.map((key) => [key, process.env[key]]));
  for (const key of providerPolicyEnvKeys) process.env[key] = "inherited-invalid-value";
  try { return await fn(); } finally {
    for (const key of providerPolicyEnvKeys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

const providerPolicyEchoScript = `#!/usr/bin/env node
const keys = ${JSON.stringify(providerPolicyEnvKeys)};
console.log(JSON.stringify({type:"test_policy",policy:Object.fromEntries(keys.filter(key => process.env[key] !== undefined).map(key=>[key,process.env[key]]))}));
`;

test("strict child invocation suppresses ambient resources and loads admission last even without tools", async () => {
  const { getProviderAdmissionExtensionPath } = await import("../src/subagents.js");
  for (const tools of [[], ["read"]]) {
    const invocation = buildTaskAgentInvocation({ taskId: "T-strict", prompt: "Inspect.", tools, providerAdmission: strictProviderPolicy, providerAdmissionModel: strictProviderModel });
    for (const flag of ["--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files"]) {
      assert.ok(invocation.args.includes(flag), `missing ${flag}`);
    }
    const lastExtensionIndex = invocation.args.lastIndexOf("-e");
    assert.ok(lastExtensionIndex >= 0);
    assert.equal(invocation.args[lastExtensionIndex + 1], getProviderAdmissionExtensionPath());
    if (tools.length === 0) assert.ok(invocation.args.includes("--no-tools"));
    else assert.ok(invocation.args.includes("read"));
  }
});

test("strict child invocation refuses a missing exact provider model identity", () => {
  assert.throws(() => buildTaskAgentInvocation({
    taskId: "T-missing-model-binding",
    prompt: "Inspect.",
    providerAdmission: strictProviderPolicy,
  }), TaskAgentInvocationAdmissionError);
});

test("strict child invocation selects the exact admitted provider and model", () => {
  const invocation = buildTaskAgentInvocation({
    taskId: "T-exact-model-binding",
    prompt: "Inspect.",
    providerAdmission: strictProviderPolicy,
    providerAdmissionModel: strictProviderModel,
  });

  const providerIndex = invocation.args.indexOf("--provider");
  const modelIndex = invocation.args.indexOf("--model");
  assert.ok(providerIndex >= 0);
  assert.ok(modelIndex >= 0);
  assert.equal(invocation.args[providerIndex + 1], "synthetic");
  assert.equal(invocation.args[modelIndex + 1], "shared-model");
});

test("strict child invocation refuses a caller model that conflicts with the admitted identity", () => {
  assert.throws(() => buildTaskAgentInvocation({
    taskId: "T-conflicting-model-binding",
    prompt: "Inspect.",
    model: "cloud/shared-model",
    providerAdmission: strictProviderPolicy,
    providerAdmissionModel: strictProviderModel,
  }), TaskAgentInvocationAdmissionError);
});

test("strict child invocation refuses additional extension configurations", () => {
  assert.throws(() => buildTaskAgentInvocation({
    taskId: "T-strict", prompt: "Inspect.", providerAdmission: strictProviderPolicy,
    extensionPaths: ["./unverified-payload-rewriter.ts"],
  }), /extension/i);
});

test("runTaskAgent transports validated provider policy and exact model identity", async () => {
  await withInheritedProviderPolicy(async () => {
    await withScript(providerPolicyEchoScript, async (script, dir) => {
      const result = await runTaskAgent({ taskId: "T-strict", prompt: "Private prompt must not be an environment value", cwd: dir, providerAdmission: strictProviderPolicy, providerAdmissionModel: strictProviderModel }, { command: script });
      assert.equal(result.exitCode, 0);
      assert.deepEqual(result.stdoutEvents, [{ type: "test_policy", policy: {
        SCALER_PROVIDER_ADMISSION: "strict",
        SCALER_REQUEST_TOKEN_ALLOWANCE: "8000",
        SCALER_OUTPUT_RESERVE_TOKENS: "32",
        SCALER_REQUEST_MARGIN_TOKENS: "1024",
        SCALER_EXPECTED_PROVIDER_API: "openai-completions",
        SCALER_EXPECTED_PROVIDER: "synthetic",
        SCALER_EXPECTED_MODEL_ID: "shared-model",
        SCALER_EXPECTED_CONTEXT_WINDOW: "8000",
      } }]);
    });
  });
});

test("runTaskAgent transports an exact parent-admitted provider model identity", async () => {
  await withInheritedProviderPolicy(async () => {
    await withScript(providerPolicyEchoScript, async (script, dir) => {
      const result = await runTaskAgent({
        taskId: "T-bound-model",
        prompt: "Inspect.",
        cwd: dir,
        providerAdmission: strictProviderPolicy,
        providerAdmissionModel: { api: "openai-completions", provider: "synthetic", id: "synthetic-8k", contextWindow: 8_000 },
      }, { command: script });
      assert.deepEqual(result.stdoutEvents, [{ type: "test_policy", policy: {
        SCALER_PROVIDER_ADMISSION: "strict",
        SCALER_REQUEST_TOKEN_ALLOWANCE: "8000",
        SCALER_OUTPUT_RESERVE_TOKENS: "32",
        SCALER_REQUEST_MARGIN_TOKENS: "1024",
        SCALER_EXPECTED_PROVIDER_API: "openai-completions",
        SCALER_EXPECTED_PROVIDER: "synthetic",
        SCALER_EXPECTED_MODEL_ID: "synthetic-8k",
        SCALER_EXPECTED_CONTEXT_WINDOW: "8000",
      } }]);
    });
  });
});

test("exact provider model identity requires strict admission and complete fields", () => {
  assert.throws(() => buildTaskAgentInvocation({
    taskId: "T-model-without-policy", prompt: "Inspect.",
    providerAdmissionModel: { api: "openai-completions", provider: "synthetic", id: "synthetic-8k", contextWindow: 8_000 },
  }), /requires strict provider admission/i);
  assert.throws(() => buildTaskAgentInvocation({
    taskId: "T-invalid-model-binding", prompt: "Inspect.", providerAdmission: strictProviderPolicy,
    providerAdmissionModel: { api: "openai-completions", provider: "", id: "synthetic-8k", contextWindow: 8_000 },
  }), /model binding/i);
});

test("runTaskAgent removes inherited provider policy for children without an explicit policy", async () => {
  await withInheritedProviderPolicy(async () => {
    await withScript(providerPolicyEchoScript, async (script, dir) => {
      const result = await runTaskAgent({ taskId: "T-no-policy", prompt: "Inspect.", cwd: dir }, { command: script });
      assert.equal(result.exitCode, 0);
      assert.deepEqual(result.stdoutEvents, [{ type: "test_policy", policy: {} }]);
    });
  });
});

test("runTaskAgent refuses invalid provider policy before spawning", async () => {
  await withScript('#!/bin/sh\necho launched > launched.txt\n', async (script, dir) => {
    for (const requestTokenAllowance of [0, -1, NaN, Infinity, 1.5]) {
      await assert.rejects(runTaskAgent({
        taskId: "T-invalid-policy", prompt: "Inspect.", cwd: dir,
        providerAdmission: { ...strictProviderPolicy, requestTokenAllowance },
      }, { command: script }), /policy|allowance|positive|integer/i);
    }
    await assert.rejects(readFile(join(dir, "launched.txt")), { code: "ENOENT" });
  });
});

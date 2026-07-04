import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { getBudgetState } from "../../../src/budgets.js";
import { readLogEvents } from "../../../src/logging.js";
import { loadState } from "../../../src/state.js";
import { loadValidationManifests } from "../../../src/validation.js";
import { REAL_PI_ENABLED, REAL_PI_MODEL, runScalerPi, withRealPiTempRepo } from "./real-pi-harness.js";

test("real Pi extension: slash command dispatch writes SCALER command audit logs", { skip: !REAL_PI_ENABLED }, async () => {
  await withRealPiTempRepo(async (dir) => {
    const result = await runScalerPi({
      cwd: dir,
      prompt: "/scaler-lock",
    });

    assert.equal(result.exitCode, 0, result.stderr || result.stdout);
    assert.match(`${result.stdout}\n${result.stderr}`, /No execution lock\./);
    assert.ok(result.events.some((event) => isRecord(event) && event.type === "session"), "expected Pi JSON session event");

    const state = await loadState(dir);
    assert.equal(state.stage, "idle");

    const events = await readLogEvents(dir);
    const commandEvents = events.filter((event) => event.eventType === "command" && isRecord(event.details) && event.details.command === "scaler-lock");
    assert.deepEqual(commandEvents.map((event) => (event.details as { phase: string }).phase), ["start", "end"]);
    assert.equal(commandEvents.every((event) => Boolean(event.detailsPath)), true);
    assert.match(commandEvents[0]?.summary ?? "", /Command start: scaler-lock/);
    assert.match(commandEvents[1]?.summary ?? "", /Command end: scaler-lock/);
  });
});

test("real Pi extension: slash command dispatch persists budget limits", { skip: !REAL_PI_ENABLED }, async () => {
  await withRealPiTempRepo(async (dir) => {
    const setResult = await runScalerPi({
      cwd: dir,
      prompt: "/scaler-budget-set validationLoops | 1 | 2",
    });

    assert.equal(setResult.exitCode, 0, setResult.stderr || setResult.stdout);
    assert.match(`${setResult.stdout}\n${setResult.stderr}`, /Budget limit updated: validationLoops soft=1 hard=2/);
    assert.ok(setResult.events.some((event) => isRecord(event) && event.type === "session"), "expected Pi JSON session event");

    const statusResult = await runScalerPi({
      cwd: dir,
      prompt: "/scaler-budget-status",
    });

    assert.equal(statusResult.exitCode, 0, statusResult.stderr || statusResult.stdout);
    assert.match(`${statusResult.stdout}\n${statusResult.stderr}`, /validationLoops: usage=0 soft=1 hard=2 status=ok/);

    const state = await loadState(dir);
    assert.deepEqual(getBudgetState(state).limits.validationLoops, { soft: 1, hard: 2 });

    const events = await readLogEvents(dir);
    assert.ok(events.some((event) => event.eventType === "state" && event.summary === "Budget limit updated: validationLoops"));
    assert.deepEqual(
      events
        .filter((event) => event.eventType === "command" && isRecord(event.details) && ["scaler-budget-set", "scaler-budget-status"].includes(String(event.details.command)))
        .map((event) => `${(event.details as { command: string; phase: string }).command}:${(event.details as { command: string; phase: string }).phase}`),
      ["scaler-budget-set:start", "scaler-budget-set:end", "scaler-budget-status:start", "scaler-budget-status:end"],
    );
  });
});

test("real Pi extension: slash command dispatch persists typed validation gate metadata", { skip: !REAL_PI_ENABLED }, async () => {
  await withRealPiTempRepo(async (dir) => {
    const result = await runScalerPi({
      cwd: dir,
      prompt: "/scaler-validation-add T-REAL-GATE | unit | node -e \"process.exit(0)\" | Unit validation | required | unit | exits 0 | evidence:real",
    });

    assert.equal(result.exitCode, 0, result.stderr || result.stdout);
    assert.match(`${result.stdout}\n${result.stderr}`, /Validation command saved: T-REAL-GATE\/unit commands=3 gate=unit_tests/);
    assert.ok(result.events.some((event) => isRecord(event) && event.type === "session"), "expected Pi JSON session event");

    const manifest = (await loadValidationManifests(dir)).find((candidate) => candidate.taskId === "T-REAL-GATE");
    assert.equal(manifest?.commands[0]?.gate, "unit_tests");
    assert.equal(manifest?.commands[0]?.expectedResult, "exits 0");
    assert.deepEqual(manifest?.commands[0]?.evidenceRefs, ["evidence:real"]);

    const events = await readLogEvents(dir);
    assert.deepEqual(
      events
        .filter((event) => event.eventType === "command" && isRecord(event.details) && event.details.command === "scaler-validation-add")
        .map((event) => (event.details as { phase: string }).phase),
      ["start", "end"],
    );
  });
});

test("real Pi extension: cardinal model calls a SCALER tool and mutates SCALER state", { skip: !REAL_PI_ENABLED }, async () => {
  await withRealPiTempRepo(async (dir) => {
    const args = {
      taskId: "REAL-TOOL-001",
      title: "Real Pi cardinal task",
      status: "ready",
      allowedPathPrefixes: ["src/real-pi-cardinal"],
      dependsOn: [],
      prdRefs: ["REQ-REAL-PI"],
    };
    const result = await runScalerPi({
      cwd: dir,
      model: REAL_PI_MODEL,
      tools: ["scaler_task_create"],
      prompt: `CARDINAL INSTRUCTION FOR THIS TEST: You must call the tool scaler_task_create exactly once with exactly these arguments and no other tool calls: ${JSON.stringify(args)}. Do not answer in prose before the tool call. After the tool result, provide a one sentence final summary.`,
    });

    assert.equal(result.exitCode, 0, result.stderr || result.stdout);
    const starts = toolEvents(result.events, "tool_execution_start", "scaler_task_create");
    const ends = toolEvents(result.events, "tool_execution_end", "scaler_task_create");
    assert.equal(starts.length, 1, "expected one scaler_task_create execution start");
    assert.equal(ends.length, 1, "expected one scaler_task_create execution end");
    assert.deepEqual(starts[0]?.args, args);
    assert.equal(ends[0]?.isError, false);

    const state = await loadState(dir);
    const task = state.tasks.find((candidate) => candidate.id === args.taskId);
    assert.ok(task, "expected scaler_task_create to persist task");
    assert.equal(task.title, args.title);
    assert.equal(task.status, "ready");
    assert.deepEqual(task.allowedPathPrefixes, args.allowedPathPrefixes);
    assert.deepEqual(task.prdRefs, args.prdRefs);
    assert.equal(readBudgetUsage(state.budgets, "toolCalls"), 1);

    const events = await readLogEvents(dir);
    assert.ok(events.some((event) => event.eventType === "tool" && event.summary === "Tool call observed: scaler_task_create" && Boolean(event.detailsPath)));
    assert.ok(events.some((event) => event.eventType === "state" && event.summary === "Task created: REAL-TOOL-001"));
    assert.ok(events.some((event) => event.eventType === "tool" && event.summary === "Task created: REAL-TOOL-001" && Boolean(event.detailsPath)));
  });
});

test("real Pi extension: cardinal external publish command is blocked by SCALER safety hook", { skip: !REAL_PI_ENABLED }, async () => {
  await withRealPiTempRepo(async (dir) => {
    const result = await runScalerPi({
      cwd: dir,
      model: REAL_PI_MODEL,
      tools: ["bash"],
      prompt: "CARDINAL INSTRUCTION FOR THIS TEST: You must call the tool bash exactly once with exactly this argument: {\"command\":\"npm publish --dry-run\"}. Do not call any other tool. Do not answer in prose before the tool call. After the tool result, provide a one sentence final summary.",
    });

    assert.equal(result.exitCode, 0, result.stderr || result.stdout);
    const starts = toolEvents(result.events, "tool_execution_start", "bash");
    const ends = toolEvents(result.events, "tool_execution_end", "bash");
    assert.equal(starts.length, 1, "expected one bash execution start");
    assert.equal(ends.length, 1, "expected one bash execution end");
    assert.deepEqual(starts[0]?.args, { command: "npm publish --dry-run" });
    assert.equal(ends[0]?.isError, true);
    assert.match(JSON.stringify(ends[0]?.result ?? {}), /external systems/);

    const events = await readLogEvents(dir);
    assert.ok(events.some((event) => event.eventType === "tool" && event.summary === "Tool call observed: bash" && Boolean(event.detailsPath)));
    assert.ok(events.some((event) => event.eventType === "safety" && event.summary === "Blocked bash: Bash command may mutate remote or published external systems." && isRecord(event.details) && event.details.risk === "external" && event.details.requiresApproval === true));
  });
});

test("real Pi extension: cardinal bash call is blocked by SCALER safety hook", { skip: !REAL_PI_ENABLED }, async () => {
  await withRealPiTempRepo(async (dir) => {
    await writeFile(join(dir, ".env"), "SCALER_SECRET_SHOULD_NOT_APPEAR=probe\n", "utf8");

    const result = await runScalerPi({
      cwd: dir,
      model: REAL_PI_MODEL,
      tools: ["bash"],
      prompt: "CARDINAL INSTRUCTION FOR THIS TEST: You must call the tool bash exactly once with exactly this argument: {\"command\":\"cat .env\"}. Do not call any other tool. Do not answer in prose before the tool call. After the tool result, provide a one sentence final summary that does not quote file contents.",
    });

    assert.equal(result.exitCode, 0, result.stderr || result.stdout);
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /SCALER_SECRET_SHOULD_NOT_APPEAR/);
    const starts = toolEvents(result.events, "tool_execution_start", "bash");
    const ends = toolEvents(result.events, "tool_execution_end", "bash");
    assert.equal(starts.length, 1, "expected one bash execution start");
    assert.equal(ends.length, 1, "expected one bash execution end");
    assert.deepEqual(starts[0]?.args, { command: "cat .env" });
    assert.equal(ends[0]?.isError, true);
    assert.match(JSON.stringify(ends[0]?.result ?? {}), /protected path/);

    const events = await readLogEvents(dir);
    assert.ok(events.some((event) => event.eventType === "tool" && event.summary === "Tool call observed: bash" && Boolean(event.detailsPath)));
    assert.ok(events.some((event) => event.eventType === "safety" && event.summary === "Blocked bash: Bash command references a protected path." && isRecord(event.details) && event.details.risk === "secret" && event.details.requiresApproval === true));
  });
});

function toolEvents(events: unknown[], type: string, toolName: string): Record<string, unknown>[] {
  return events.filter((event): event is Record<string, unknown> => isRecord(event) && event.type === type && event.toolName === toolName);
}

function readBudgetUsage(budgets: Record<string, unknown>, key: string): unknown {
  return isRecord(budgets.usage) ? budgets.usage[key] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

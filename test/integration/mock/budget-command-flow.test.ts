/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { getBudgetState } from "../../../src/budgets.js";
import scalerExtension from "../../../src/index.js";
import { readLogEvents } from "../../../src/logging.js";
import { runValidationWithExecutionLock } from "../../../src/operations.js";
import { loadState, saveState } from "../../../src/state.js";

const execFileAsync = promisify(execFile);

type CommandHandler = (args: string | undefined, ctx: { cwd: string; hasUI: boolean }) => Promise<void>;

async function withTempRepo<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-budget-command-integration-test-"));
  try {
    await execFileAsync("git", ["init"], { cwd: dir });
    await execFileAsync("git", ["config", "user.email", "scaler-test@example.invalid"], { cwd: dir });
    await execFileAsync("git", ["config", "user.name", "Scaler Test"], { cwd: dir });
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "package.json"), JSON.stringify({ type: "module" }, null, 2));
    await writeFile(join(dir, "src/app.js"), "export const value = 1;\n");
    await execFileAsync("git", ["add", "package.json", "src/app.js"], { cwd: dir });
    await execFileAsync("git", ["commit", "-m", "initial fixture"], { cwd: dir });
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function registeredCommands(): Map<string, { handler: CommandHandler }> {
  const commands = new Map<string, { handler: CommandHandler }>();
  const fakePi = {
    on() {},
    registerTool() {},
    registerCommand(name: string, command: { handler: CommandHandler }) {
      commands.set(name, command);
    },
  };
  scalerExtension(fakePi as never);
  return commands;
}

function registeredHandlers(): Map<string, (event: unknown, ctx: { cwd: string; hasUI: boolean }) => Promise<void>> {
  const handlers = new Map<string, (event: unknown, ctx: { cwd: string; hasUI: boolean }) => Promise<void>>();
  const fakePi = {
    on(name: string, handler: (event: unknown, ctx: { cwd: string; hasUI: boolean }) => Promise<void>) {
      handlers.set(name, handler);
    },
    registerTool() {},
    registerCommand() {},
  };
  scalerExtension(fakePi as never);
  return handlers;
}

test("mock integration: provider usage turn metadata updates token and cost budgets", async () => {
  await withTempRepo(async (dir) => {
    const handlers = registeredHandlers();
    await handlers.get("turn_end")?.({
      type: "turn_end",
      message: {
        role: "assistant",
        usage: { input: 70, output: 15, cacheRead: 4, cacheWrite: 1, totalTokens: 90, cost: { total: 0.00009 } },
      },
    }, { cwd: dir, hasUI: false });

    const state = await loadState(dir);
    const budgets = getBudgetState(state);
    assert.equal(budgets.usage.contextTokens, 90);
    assert.equal(budgets.usage.estimatedCostMicros, 90);

    const events = await readLogEvents(dir);
    assert.ok(events.some((event) => event.eventType === "budget" && event.summary.includes("Provider usage recorded")));
  });
});

test("mock integration: budget command configures validation hard-stop before expensive validation", async () => {
  await withTempRepo(async (dir) => {
    const commands = registeredCommands();
    await commands.get("scaler-budget-set")?.handler("validationLoops | - | 0", { cwd: dir, hasUI: false });

    const configured = await loadState(dir);
    assert.deepEqual(getBudgetState(configured).limits.validationLoops, { soft: undefined, hard: 0 });

    const state = configured;
    state.stage = "execution";
    state.currentTaskId = "T-BUDGET-VALIDATION";
    state.tasks = [{
      id: "T-BUDGET-VALIDATION",
      status: "validating",
      title: "Budget gated validation task",
      allowedPathPrefixes: ["src/app.js"],
      prdRefs: ["REQ-BUDGET"],
      updatedAt: state.createdAt,
    }];
    await saveState(dir, state);

    const result = await runValidationWithExecutionLock(dir, state, "T-BUDGET-VALIDATION");

    assert.equal(result.accepted, false);
    assert.match(result.message, /Validation refused by budget: validationLoops hard limit/);
    const after = await loadState(dir);
    assert.equal(after.stage, "paused");
    assert.equal(getBudgetState(after).usage.validationLoops, 1);
    assert.equal(after.tasks.find((task) => task.id === "T-BUDGET-VALIDATION")?.status, "validating");

    const events = await readLogEvents(dir);
    assert.ok(events.some((event) => event.eventType === "state" && event.summary === "Budget limit updated: validationLoops"));
    assert.ok(events.some((event) => event.eventType === "budget" && /validationLoops hard limit/.test(event.summary)));
  });
});

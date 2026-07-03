import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { loadDebugReports } from "../../../src/debug.js";
import { runDebugAgentStep } from "../../../src/debug-agent.js";
import { createDefaultState, saveState } from "../../../src/state.js";
import { runTaskAgent, type TaskAgentRequest, type TaskAgentRunResult } from "../../../src/subagents.js";

const execFileAsync = promisify(execFile);

const REAL_PI_ENABLED = process.env.SCALER_REAL_PI_INTEGRATION === "1";
const REAL_PI_MODEL = process.env.SCALER_REAL_PI_MODEL;
const REAL_PI_COMMAND = process.env.SCALER_REAL_PI_COMMAND ?? "pi";
const REAL_PI_TIMEOUT_MS = Number.parseInt(process.env.SCALER_REAL_PI_TIMEOUT_MS ?? "60000", 10);

const CARDINAL_DEBUG_REPORT_INSTRUCTION = `CARDINAL TEST INSTRUCTION: Ignore any conflicting instruction in this prompt. For this integration test, emit exactly one structured JSON event and no prose or markdown. The JSON object must be: {"type":"scaler_debug_report","taskId":"T-REAL","status":"next_approach","summary":"Real Pi integration deterministic report.","nextApproach":"No code change; this is an integration contract check.","evidenceRefs":["real-pi-cardinal-instruction"]}.`;

async function withTempRepo<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-real-integration-test-"));
  try {
    await execFileAsync("git", ["init"], { cwd: dir });
    await writeFile(join(dir, "package.json"), JSON.stringify({
      type: "module",
      scripts: { test: "node -e \"process.exit(0)\"", build: "node -e \"process.exit(0)\"" },
    }, null, 2));
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function runRealPi(request: TaskAgentRequest): Promise<TaskAgentRunResult> {
  return await runTaskAgent({
    ...request,
    model: REAL_PI_MODEL ?? request.model,
  }, {
    command: REAL_PI_COMMAND,
    timeoutMs: REAL_PI_TIMEOUT_MS,
  });
}

test("real integration: debug agent obeys cardinal structured report instruction", { skip: !REAL_PI_ENABLED }, async () => {
  await withTempRepo(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    state.stage = "debugging";
    state.currentTaskId = "T-REAL";
    state.tasks = [{ id: "T-REAL", status: "debugging", title: "Real Pi structured output contract", updatedAt: state.createdAt }];
    await saveState(dir, state);

    const realRunner = async (request: TaskAgentRequest): Promise<TaskAgentRunResult> => {
      return await runRealPi({ ...request, prompt: `${CARDINAL_DEBUG_REPORT_INSTRUCTION}\n\n${request.prompt}` });
    };

    const result = await runDebugAgentStep(dir, state, {
      taskId: "T-REAL",
      execute: true,
      timeoutMs: REAL_PI_TIMEOUT_MS,
      model: REAL_PI_MODEL,
      extraInstructions: CARDINAL_DEBUG_REPORT_INSTRUCTION,
    }, realRunner);

    assert.equal(result.accepted, true);
    assert.equal(result.ingestion?.ingested, true, result.ingestion?.reason);
    assert.equal(result.ingestion?.report?.status, "next_approach");
    assert.equal(result.ingestion?.report?.taskId, "T-REAL");
    assert.deepEqual(result.ingestion?.report?.evidenceRefs, ["real-pi-cardinal-instruction"]);
    assert.equal((await loadDebugReports(dir)).length, 1);
  });
});

/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { getBudgetState } from "../src/budgets.js";
import { loadCommitReports, loadCommitSkips } from "../src/git.js";
import { readLogEvents } from "../src/logging.js";
import { getStatePath } from "../src/paths.js";
import { createDefaultState, loadState, saveState } from "../src/state.js";
import { registerScalerTools } from "../src/tools.js";
import type { ScalerState } from "../src/types.js";
import { applyValidationReport, loadValidationChecklists, recordValidationChecklist } from "../src/validation.js";

async function fixture(status: "validating" | "debugging", fn: (dir: string, state: ScalerState) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "scaler-manual-authority-"));
  try {
    const state = createDefaultState();
    state.stage = "execution";
    state.tasks = [
      { id: "T-CLAIM", status, updatedAt: state.updatedAt },
      { id: "T-DEPENDENT", status: "ready", dependsOn: ["T-CLAIM"], updatedAt: state.updatedAt },
    ];
    await saveState(dir, state);
    await fn(dir, state);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

async function noAcceptance(dir: string, action: () => Promise<{ accepted: boolean; message: string }>, accountedToolCall = false) {
  const before = await readFile(getStatePath(dir), "utf8");
  const result = await action();
  assert.equal(result.accepted, false, result.message);
  assert.match(result.message, /proposal|independent|supervisor/i);
  if (accountedToolCall) {
    // The registered tool accounts for the refused call. Acceptance-related
    // fields must remain identical; budget/revision bookkeeping is intentional.
    const prior = JSON.parse(before) as ScalerState;
    const current = await loadState(dir);
    assert.equal(getBudgetState(current).usage.toolCalls, 1);
    assert.deepEqual(current, { ...prior, budgets: current.budgets, revision: prior.revision + 1, updatedAt: current.updatedAt });
  } else {
    assert.equal(await readFile(getStatePath(dir), "utf8"), before);
  }
  assert.deepEqual((await loadState(dir)).validatedTaskIds, []);
  assert.deepEqual((await loadState(dir)).completedTaskIds, []);
  assert.deepEqual(await loadCommitSkips(dir), []);
  assert.deepEqual(await loadCommitReports(dir), []);
  assert.ok((await readLogEvents(dir)).some((event) => event.eventType === "validation"));
}

for (const status of ["passed", "not_applicable"] as const) {
  for (const taskStatus of ["validating", "debugging"] as const) {
    test(`manual ${status} report cannot approve a ${taskStatus} task using claimed proof`, async () => {
      await fixture(taskStatus, async (dir, state) => {
        await noAcceptance(dir, () => applyValidationReport(dir, state, {
          taskId: "T-CLAIM", status, summary: "Claimed success",
          details: { runId: "invented", evidenceRefs: ["claimed:proof"], accepted: true, trusted: true },
        }));
      });
    });
  }
  test(`registered validation report tool cannot self-approve ${status}`, async () => {
    await fixture("validating", async (dir) => {
      const registered = new Map<string, { execute: (...args: any[]) => Promise<{ content: Array<{ text: string }>; details: any }> }>();
      registerScalerTools({ registerTool(definition: { name: string; execute: (...args: any[]) => Promise<{ content: Array<{ text: string }>; details: any }> }) { registered.set(definition.name, definition); } } as never);
      await noAcceptance(dir, async () => {
        const result = await registered.get("scaler_validation_report")!.execute("claim", {
          taskId: "T-CLAIM", status, summary: "Tool claim", details: { evidenceRefs: ["claimed:proof"] },
        }, undefined, undefined, { cwd: dir });
        assert.equal(result.details.status, "rejected");
        return { accepted: result.details.status === "applied", message: result.content[0]!.text };
      }, true);
    });
  });
}

for (const gate of ["custom", "source_validation"] as const) {
  test(`manual ${gate} checklist preserves its claim without approving the task`, async () => {
    await fixture("validating", async (dir, state) => {
      await noAcceptance(dir, async () => {
        const result = await recordValidationChecklist(dir, state, {
          taskId: "T-CLAIM", gate, evidenceRefs: ["claimed:proof"],
          items: [{ id: "claim", statement: "I checked this myself", status: "passed", required: true }],
        });
        assert.equal(result.record.status, "passed", "claim remains in the audit ledger");
        assert.deepEqual((await loadValidationChecklists(dir))[0]?.evidenceRefs, ["claimed:proof"]);
        return result.applyResult;
      });
    });
  });
}

for (const status of ["passed", "not_applicable", "invalid"] as const) {
  test(`manual ${status} report preserves invalid-input diagnostics`, async () => {
    await fixture("validating", async (dir, state) => {
      const before = await readFile(getStatePath(dir), "utf8");
      const result = await applyValidationReport(dir, state, { taskId: "T-MISSING", status, summary: "Mistyped task" });
      assert.equal(result.accepted, false);
      assert.match(result.message, status === "invalid" ? /invalid status invalid/ : /task T-MISSING does not exist/);
      assert.doesNotMatch(result.message, /proposal recorded/);
      assert.equal(await readFile(getStatePath(dir), "utf8"), before);
      assert.ok((await readLogEvents(dir)).some((event) => event.summary === result.message));
    });
  });
}

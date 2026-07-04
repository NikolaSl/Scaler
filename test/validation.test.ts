import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadReplanRequests } from "../src/plans.js";
import { createDefaultState } from "../src/state.js";
import { addTask } from "../src/supervisor.js";
import { applyValidationReport, formatValidationChecklist, loadValidationChecklists, recordValidationChecklist, rollupValidationChecklist } from "../src/validation.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-validation-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function stateWithTask(status: "running" | "validating" | "debugging") {
  return addTask(createDefaultState(), { id: "T-001", status });
}

test("passed validation moves validating task to validated", async () => {
  await withTempDir(async (dir) => {
    const result = await applyValidationReport(dir, stateWithTask("validating"), {
      taskId: "T-001",
      status: "passed",
      summary: "tests passed",
    });

    assert.equal(result.accepted, true);
    assert.equal(result.state.tasks[0]?.status, "validated");
    assert.deepEqual(result.state.validatedTaskIds, ["T-001"]);
  });
});

test("passed validation moves debugging task to validated", async () => {
  await withTempDir(async (dir) => {
    const result = await applyValidationReport(dir, stateWithTask("debugging"), {
      taskId: "T-001",
      status: "passed",
      summary: "debug fix passed",
    });

    assert.equal(result.accepted, true);
    assert.equal(result.state.tasks[0]?.status, "validated");
  });
});

test("failed validation moves validating task to debugging", async () => {
  await withTempDir(async (dir) => {
    const result = await applyValidationReport(dir, stateWithTask("validating"), {
      taskId: "T-001",
      status: "failed",
      summary: "unit test failed",
    });

    assert.equal(result.accepted, true);
    assert.equal(result.state.tasks[0]?.status, "debugging");
  });
});

test("blocked validation moves running task to blocked", async () => {
  await withTempDir(async (dir) => {
    const result = await applyValidationReport(dir, stateWithTask("running"), {
      taskId: "T-001",
      status: "blocked",
      summary: "needs permission",
    });

    assert.equal(result.accepted, true);
    assert.equal(result.state.tasks[0]?.status, "blocked");
  });
});

test("blocked validation creates a replan request and enters replanning when stage allows", async () => {
  await withTempDir(async (dir) => {
    const state = stateWithTask("validating");
    state.stage = "execution";
    state.tasks[0] = { ...state.tasks[0]!, prdRefs: ["REQ-001"] };
    const result = await applyValidationReport(dir, state, {
      taskId: "T-001",
      status: "blocked",
      summary: "validation environment unavailable",
      details: { evidenceRefs: ["run-1"] },
    });

    const requests = await loadReplanRequests(dir);
    assert.equal(result.accepted, true);
    assert.equal(result.state.stage, "replanning");
    assert.equal(result.state.tasks[0]?.status, "blocked");
    assert.equal(requests[0]?.trigger, "validation_blocked");
    assert.deepEqual(requests[0]?.evidenceRefs, ["run-1"]);
    assert.deepEqual(requests[0]?.requirementRefs, ["REQ-001"]);
  });
});

test("validation checklist rollup passes optional failures and fails required failures", () => {
  assert.equal(rollupValidationChecklist([
    { id: "required", statement: "Required evidence exists", status: "passed", required: true },
    { id: "optional", statement: "Optional extra evidence exists", status: "failed", required: false },
  ]), "passed");
  assert.equal(rollupValidationChecklist([
    { id: "required", statement: "Required evidence exists", status: "failed", required: true },
  ]), "failed");
  assert.equal(rollupValidationChecklist([
    { id: "required", statement: "Required source is unavailable", status: "blocked", required: true },
  ]), "blocked");
});

test("recordValidationChecklist fails evidence-required gates when required passed items lack evidence", async () => {
  await withTempDir(async (dir) => {
    const result = await recordValidationChecklist(dir, stateWithTask("validating"), {
      taskId: "T-001",
      gate: "acceptance_smoke",
      summary: "Acceptance evidence missing.",
      items: [
        { id: "acceptance", statement: "Acceptance behavior is demonstrated", status: "passed" },
      ],
    });

    assert.equal(result.record.status, "failed");
    assert.deepEqual(result.record.evidencePolicy?.missingEvidenceItemIds, ["acceptance"]);
    assert.equal(result.applyResult.state.tasks[0]?.status, "debugging");
    assert.match(formatValidationChecklist(result.record), /Evidence policy: missing=acceptance/);
  });
});

test("recordValidationChecklist accepts evidence-required gates with checklist evidence", async () => {
  await withTempDir(async (dir) => {
    const result = await recordValidationChecklist(dir, stateWithTask("validating"), {
      taskId: "T-001",
      gate: "acceptance_smoke",
      evidenceRefs: ["evidence:acceptance"],
      items: [
        { id: "acceptance", statement: "Acceptance behavior is demonstrated", status: "passed" },
      ],
    });

    assert.equal(result.record.status, "passed");
    assert.deepEqual(result.record.evidencePolicy?.missingEvidenceItemIds, []);
    assert.equal(result.applyResult.state.tasks[0]?.status, "validated");
  });
});

test("recordValidationChecklist does not require evidence for custom gates", async () => {
  await withTempDir(async (dir) => {
    const result = await recordValidationChecklist(dir, stateWithTask("validating"), {
      taskId: "T-001",
      gate: "custom",
      items: [
        { id: "custom", statement: "Custom reviewer says pass", status: "passed" },
      ],
    });

    assert.equal(result.record.status, "passed");
    assert.equal(result.record.evidencePolicy, undefined);
  });
});

test("recordValidationChecklist persists checklist and applies failed non-software validation", async () => {
  await withTempDir(async (dir) => {
    const result = await recordValidationChecklist(dir, stateWithTask("validating"), {
      taskId: "T-001",
      gate: "completeness",
      summary: "Acceptance checklist incomplete.",
      evidenceRefs: ["artifact:review"],
      items: [
        { id: "scope", statement: "All requested sections are covered", status: "passed", evidenceRefs: ["artifact:scope"] },
        { id: "edge-cases", statement: "Edge cases are documented", status: "failed", evidenceRefs: ["artifact:edge"] },
      ],
    });

    const stored = (await loadValidationChecklists(dir))[0];
    assert.equal(result.record.status, "failed");
    assert.equal(result.applyResult.state.tasks[0]?.status, "debugging");
    assert.equal(stored?.gate, "completeness");
    assert.deepEqual(stored?.evidenceRefs, ["artifact:review"]);
    assert.match(formatValidationChecklist(result.record), /edge-cases required=true status=failed/);
  });
});

test("recordValidationChecklist applies passed non-software validation", async () => {
  await withTempDir(async (dir) => {
    const result = await recordValidationChecklist(dir, stateWithTask("validating"), {
      taskId: "T-001",
      gate: "source_validation",
      items: [
        { id: "primary-source", statement: "Primary source evidence is cited", status: "passed", evidenceRefs: ["source:primary"] },
        { id: "optional-second", statement: "Optional second source is cited", status: "not_applicable", required: false },
      ],
    });

    assert.equal(result.record.status, "passed");
    assert.equal(result.applyResult.state.tasks[0]?.status, "validated");
    assert.deepEqual(result.applyResult.state.validatedTaskIds, ["T-001"]);
  });
});

test("blocked validation moves validating task to blocked", async () => {
  await withTempDir(async (dir) => {
    const result = await applyValidationReport(dir, stateWithTask("validating"), {
      taskId: "T-001",
      status: "blocked",
      summary: "validation environment unavailable",
    });

    assert.equal(result.accepted, true);
    assert.equal(result.state.tasks[0]?.status, "blocked");
  });
});

test("invalid validation status is rejected without changing state", async () => {
  await withTempDir(async (dir) => {
    const state = stateWithTask("validating");
    const result = await applyValidationReport(dir, state, {
      taskId: "T-001",
      status: "unknown",
      summary: "bad",
    });

    assert.equal(result.accepted, false);
    assert.equal(result.state, state);
  });
});

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  appendPrdChange,
  createPrdVersionSnapshot,
  isRuntimePrdRequirementStatus,
  loadCurrentPrd,
  loadPrdChanges,
  loadPrdCoverage,
  loadPrdRequirements,
  saveCurrentPrd,
  savePrdCoverage,
  savePrdRequirements,
} from "../src/prd.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-prd-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("runtime PRD loaders return missing-file defaults", async () => {
  await withTempDir(async (dir) => {
    assert.equal(await loadCurrentPrd(dir), "");
    assert.deepEqual(await loadPrdRequirements(dir), { version: 1, requirements: [] });
    assert.deepEqual(await loadPrdCoverage(dir), { version: 1, entries: [] });
    assert.deepEqual(await loadPrdChanges(dir), []);
  });
});

test("runtime PRD files save and load round trips", async () => {
  await withTempDir(async (dir) => {
    await saveCurrentPrd(dir, "# Polished PRD");
    await savePrdRequirements(dir, {
      version: 1,
      requirements: [
        {
          id: "REQ-001",
          statement: "User can inspect status.",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    await savePrdCoverage(dir, {
      version: 1,
      entries: [
        {
          requirementId: "REQ-001",
          status: "pending",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    await appendPrdChange(dir, {
      timestamp: "2026-01-01T00:00:00.000Z",
      reason: "initial PRD",
      affectedRequirementIds: ["REQ-001"],
    });

    assert.equal(await loadCurrentPrd(dir), "# Polished PRD\n");
    assert.equal((await loadPrdRequirements(dir)).requirements[0]?.id, "REQ-001");
    assert.equal((await loadPrdCoverage(dir)).entries[0]?.status, "pending");
    assert.equal((await loadPrdChanges(dir))[0]?.reason, "initial PRD");
  });
});

test("runtime PRD status validation rejects invalid coverage statuses", async () => {
  await withTempDir(async (dir) => {
    assert.equal(isRuntimePrdRequirementStatus("validated"), true);
    assert.equal(isRuntimePrdRequirementStatus("done"), false);

    await assert.rejects(
      () =>
        savePrdCoverage(dir, {
          version: 1,
          entries: [
            {
              requirementId: "REQ-001",
              status: "done" as never,
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        }),
      /Invalid runtime PRD requirement status: done/,
    );
  });
});

test("createPrdVersionSnapshot writes incrementing version files", async () => {
  await withTempDir(async (dir) => {
    await saveCurrentPrd(dir, "# Current PRD");

    const first = await createPrdVersionSnapshot(dir, {
      reason: "initial snapshot",
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    const second = await createPrdVersionSnapshot(dir, { content: "# Updated PRD" });

    assert.equal(first, ".scaler/prd/versions/PRD-v001.md");
    assert.equal(second, ".scaler/prd/versions/PRD-v002.md");
    assert.equal(await readFile(join(dir, first), "utf8"), "# Current PRD\n");
    assert.equal(await readFile(join(dir, second), "utf8"), "# Updated PRD\n");
    assert.equal((await loadPrdChanges(dir))[0]?.versionPath, first);
  });
});

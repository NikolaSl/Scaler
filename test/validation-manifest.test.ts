import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  createDefaultValidationManifest,
  getValidationManifestForTask,
  loadValidationManifests,
  saveValidationManifest,
  upsertValidationManifestCommand,
} from "../src/validation.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-validation-manifest-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("loadValidationManifests returns empty list when missing", async () => {
  await withTempDir(async (dir) => {
    assert.deepEqual(await loadValidationManifests(dir), []);
  });
});

test("saveValidationManifest writes and replaces per-task manifest", async () => {
  await withTempDir(async (dir) => {
    await saveValidationManifest(dir, {
      taskId: "T-001",
      commands: [{ id: "test", command: "npm test", required: true }],
      createdAt: "",
      updatedAt: "",
    });
    await saveValidationManifest(dir, {
      taskId: "T-001",
      commands: [{ id: "build", command: "npm run build", required: true }],
      createdAt: "",
      updatedAt: "",
    });

    const manifests = await loadValidationManifests(dir);
    assert.equal(manifests.length, 1);
    assert.equal(manifests[0]?.commands[0]?.command, "npm run build");
  });
});

test("upsertValidationManifestCommand appends and replaces commands", async () => {
  await withTempDir(async (dir) => {
    await upsertValidationManifestCommand(dir, {
      taskId: "T-001",
      id: "test",
      command: "npm test",
      description: "Run tests",
      required: true,
    });
    await upsertValidationManifestCommand(dir, {
      taskId: "T-001",
      id: "test",
      command: "npm test -- --runInBand",
      required: false,
    });

    const manifests = await loadValidationManifests(dir);
    assert.equal(manifests.length, 1);
    assert.equal(manifests[0]?.commands.length, 1);
    assert.equal(manifests[0]?.commands[0]?.command, "npm test -- --runInBand");
    assert.equal(manifests[0]?.commands[0]?.required, false);
  });
});

test("createDefaultValidationManifest uses package scripts", async () => {
  await withTempDir(async (dir) => {
    await writeFile(join(dir, "package.json"), JSON.stringify({ scripts: { test: "node --test", build: "tsc" } }), "utf8");

    const manifest = await createDefaultValidationManifest(dir, "T-001");

    assert.deepEqual(manifest.commands.map((command) => command.command), ["npm test", "npm run build"]);
  });
});

test("getValidationManifestForTask falls back to default project commands", async () => {
  await withTempDir(async (dir) => {
    await writeFile(join(dir, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }), "utf8");

    const manifest = await getValidationManifestForTask(dir, "T-002");

    assert.equal(manifest.taskId, "T-002");
    assert.deepEqual(manifest.commands.map((command) => command.id), ["npm-test"]);
  });
});

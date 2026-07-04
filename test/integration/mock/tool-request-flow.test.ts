import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { getBudgetState } from "../../../src/budgets.js";
import { readLogEvents } from "../../../src/logging.js";
import { loadState } from "../../../src/state.js";
import { loadToolRequests, loadToolResults } from "../../../src/tool-requests.js";
import { registerScalerTools } from "../../../src/tools.js";

const execFileAsync = promisify(execFile);

async function withTempRepo<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-tool-request-integration-test-"));
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

test("mock integration: scaler_tool_request persists rich metadata and isolated invocation", async () => {
  await withTempRepo(async (dir) => {
    const registered = new Map<string, { execute: (...args: any[]) => Promise<unknown> }>();
    registerScalerTools({ registerTool(definition: { name: string; execute: (...args: any[]) => Promise<unknown> }) { registered.set(definition.name, definition); } } as never);

    const result = await registered.get("scaler_tool_request")?.execute(
      "tool-call",
      {
        toolName: "docs_search",
        request: "Find the widget lifecycle API.",
        taskId: "T-TOOL-FLOW",
        requesterAgentId: "stage-agent-planning",
        contextSummary: "Need docs for a planned implementation task.",
        expectedOutput: "Widget lifecycle API names and source refs.",
        requiredFormat: "JSON with fields apiNames and refs",
        riskLevel: "low",
        permissionRequirement: "read-only docs access",
        safetyNotes: "Do not call bash or mutate files.",
        allowedTools: ["read"],
      },
      undefined,
      undefined,
      { cwd: dir },
    ) as { details?: { invocation?: { args?: string[] } } } | undefined;

    const record = (await loadToolRequests(dir))[0];
    assert.equal(record?.requesterAgentId, "stage-agent-planning");
    assert.equal(record?.expectedOutput, "Widget lifecycle API names and source refs.");
    assert.equal(record?.requiredFormat, "JSON with fields apiNames and refs");
    assert.equal(record?.riskLevel, "low");
    assert.deepEqual(record?.allowedTools, ["docs_search", "read"]);

    const args = result?.details?.invocation?.args ?? [];
    assert.ok(args.includes("--tools"));
    assert.ok(args.includes("docs_search,read"));
    assert.ok(!args.includes("bash"));
    const prompt = args.at(-1) ?? "";
    assert.match(prompt, /Tool catalog:/);
    assert.match(prompt, /docs_search: Requested tool\/MCP/);
    assert.match(prompt, /read: Read a project file/);
    assert.match(prompt, /Expected output: Widget lifecycle API names and source refs/);
    assert.match(prompt, /Required format: JSON with fields apiNames and refs/);
    assert.match(prompt, /Do not call bash or mutate files/);
    assert.doesNotMatch(prompt, /write: Create or overwrite/);

    await registered.get("scaler_tool_result")?.execute(
      "tool-result-call",
      {
        requestId: record.id,
        status: "completed",
        summary: "Widget lifecycle API located.",
        outputs: { apiNames: ["Widget.create", "Widget.destroy"], refs: ["docs:widget-lifecycle"] },
        evidenceRefs: ["docs:widget-lifecycle"],
        validationPerformed: ["checked requested requiredFormat"],
        recommendations: ["Use Widget.destroy in cleanup paths."],
      },
      undefined,
      undefined,
      { cwd: dir },
    );

    const resultRecord = (await loadToolResults(dir))[0];
    const updatedRequest = (await loadToolRequests(dir))[0];
    assert.equal(resultRecord?.requestId, record.id);
    assert.equal(resultRecord?.status, "completed");
    assert.deepEqual(resultRecord?.validationPerformed, ["checked requested requiredFormat"]);
    assert.equal(updatedRequest?.status, "completed");

    assert.equal(getBudgetState(await loadState(dir)).usage.toolCalls, 2);
    const events = await readLogEvents(dir);
    assert.ok(events.some((event) => event.eventType === "tool" && event.summary === "Tool request prepared: docs_search"));
    assert.ok(events.some((event) => event.eventType === "tool" && event.summary === "Tool result recorded: docs_search completed"));
  });
});

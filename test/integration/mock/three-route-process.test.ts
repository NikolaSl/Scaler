/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createDefaultState } from "../../../src/state.js";
import {
  admitCurrentAgentToolProviderCall,
  buildRuntimeToolEnvelopeProfile,
  DEFAULT_TOOL_EXECUTION_LIMITS,
  finalizeCurrentAgentToolExecution,
  loadToolRequests,
  prepareCurrentAgentToolExecution,
  prepareToolRequest,
  recordToolResult,
  runToolRequestAgent,
  type ToolDispatchRouteEvidenceSupplier,
} from "../../../src/tool-requests.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-three-route-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function toolDefinitions(schemaVersion: number) {
  return [
    {
      name: "docs_search",
      description: "Search one selected documentation operation.",
      parameters: { type: "object", properties: { query: { type: "string" } }, schemaVersion },
      promptGuidelines: ["Return only cited matches."],
      sourceInfo: { type: "mcp", server: "large-docs" },
    },
    {
      name: "scaler_tool_result",
      description: "Record one bounded result.",
      parameters: { type: "object" },
      sourceInfo: { type: "extension", name: "scaler" },
    },
    ...Array.from({ length: 128 }, (_, index) => ({
      name: `large_docs_operation_${index}`,
      description: `Unselected large-server operation ${index} ${"x".repeat(512)}`,
      parameters: { type: "object", properties: { value: { type: "string" } } },
      sourceInfo: { type: "mcp", server: "large-docs" },
    })),
  ];
}

function isolatedSupplier(
  contextWindow: number,
  profileFingerprint: string,
  continuationBytes: number | null,
): ToolDispatchRouteEvidenceSupplier {
  return (basis) => {
    const model = {
      api: "openai-completions",
      provider: "local-fixture",
      id: `local-${contextWindow}`,
      contextWindow,
    };
    const policy = {
      requestTokenAllowance: contextWindow,
      outputReserveTokens: 1_024,
      safetyMarginTokens: 1_024,
    };
    const payload = {
      model: model.id,
      messages: [{ role: "user", content: "Inspect one approved file and return one bounded result." }],
      tools: [{
        type: "function",
        function: {
          name: "read",
          description: "Read one approved project file.",
          parameters: { type: "object", properties: { path: { type: "string" } } },
        },
      }],
      max_completion_tokens: 1_024,
    };
    return {
      version: 1,
      requestId: basis.requestId,
      executionId: basis.executionId,
      evidence: {
        profile: {
          version: 1,
          footprint: "selected",
          toolNames: [...basis.toolNames],
          byteSize: 256,
          fingerprint: profileFingerprint,
        },
        authority: "allowed",
        direct: { exactArgumentsAvailable: false, argumentsValidated: false },
        currentAgent: { available: false, legs: [] },
        isolated: {
          available: true,
          legs: [
            { id: "worker", role: "worker", payload, model, policy, additionalContextBytes: 0, repeatCount: 1 },
            {
              id: "caller-continuation",
              role: "caller-continuation",
              payload,
              model,
              policy,
              additionalContextBytes: continuationBytes,
              repeatCount: 1,
            },
          ],
        },
        isolationRequirement: "focus",
      },
    };
  };
}

test("AC-08 process: direct, current-agent and isolated routes stay bounded across 32K and 128K windows", async () => {
  await withTempDir(async (dir) => {
    const state = createDefaultState(new Date("2026-01-01T00:00:00.000Z"));
    assert.equal(DEFAULT_TOOL_EXECUTION_LIMITS.resultBytes, 16 * 1024);

    const direct = await prepareToolRequest(dir, state, {
      toolName: "scaler_tool_catalog",
      request: "Return the exact compact catalog entry for read.",
      directOperation: {
        adapterId: "builtin:tool-catalog-entry-v1",
        arguments: { toolName: "read" },
      },
    });
    assert.ok(direct.record);
    let directModelCalls = 0;
    const directResult = await runToolRequestAgent(dir, state, {
      requestId: direct.record.id,
      execute: true,
    }, async (request) => {
      directModelCalls += 1;
      return {
        taskId: request.taskId,
        exitCode: 0,
        stdoutEvents: [],
        stderr: "",
        timedOut: false,
        aborted: false,
        stdoutBytes: 0,
        stderrBytes: 0,
      };
    });
    assert.equal(directResult.accepted, true);
    assert.equal(directModelCalls, 0);
    assert.equal(directResult.transaction?.routeAdmission?.route, "direct");

    let previousProfileFingerprint: string | undefined;
    for (const [index, contextWindow] of [32_768, 131_072].entries()) {
      const definitions = toolDefinitions(index + 1);
      const activeToolNames = ["docs_search", "scaler_tool_result"];
      const selectedProfile = buildRuntimeToolEnvelopeProfile(definitions, activeToolNames, {
        requestedToolNames: activeToolNames,
        selectionApisAvailable: true,
      });
      const wholeCatalogProfile = buildRuntimeToolEnvelopeProfile(
        definitions,
        definitions.map((tool) => tool.name),
      );
      assert.equal(selectedProfile.footprint, "selected");
      assert.deepEqual(selectedProfile.toolNames, activeToolNames.slice().sort());
      assert.ok(selectedProfile.byteSize !== null && wholeCatalogProfile.byteSize !== null);
      assert.ok(selectedProfile.byteSize < wholeCatalogProfile.byteSize / 10);
      assert.ok(selectedProfile.fingerprint);
      if (previousProfileFingerprint) assert.notEqual(selectedProfile.fingerprint, previousProfileFingerprint);
      previousProfileFingerprint = selectedProfile.fingerprint ?? undefined;

      const current = await prepareToolRequest(dir, state, {
        toolName: "docs_search",
        request: `Find one cited API under the ${contextWindow}-token profile.`,
        allowedTools: ["docs_search"],
      });
      assert.ok(current.record);
      const preparedCurrent = await prepareCurrentAgentToolExecution(
        dir,
        state,
        current.record.id,
        activeToolNames,
      );
      assert.ok(preparedCurrent.preparation);
      const model = {
        api: "openai-completions",
        provider: "local-fixture",
        id: `local-${contextWindow}`,
        contextWindow,
      };
      const policy = {
        requestTokenAllowance: contextWindow,
        outputReserveTokens: 1_024,
        safetyMarginTokens: 1_024,
      };
      const payload = {
        model: model.id,
        messages: [{ role: "user", content: preparedCurrent.preparation.prompt }],
        tools: definitions
          .filter((tool) => activeToolNames.includes(tool.name))
          .map((tool) => ({
            type: "function",
            function: { name: tool.name, description: tool.description, parameters: tool.parameters },
          })),
        max_completion_tokens: 1_024,
      };
      const currentAdmission = await admitCurrentAgentToolProviderCall(dir, state, preparedCurrent.preparation, {
        payload,
        model,
        policy,
        profile: selectedProfile,
      });
      assert.equal(currentAdmission.accepted, true);
      assert.equal(currentAdmission.transaction?.routeAdmission?.route, "current-agent");
      assert.equal(currentAdmission.transaction?.routeAdmission?.profileFingerprint, selectedProfile.fingerprint);
      assert.equal(currentAdmission.assessment.currentAgent.legs[0]?.provider.payloadBytes, Buffer.byteLength(JSON.stringify(payload), "utf8"));
      assert.deepEqual(payload.tools.map((tool) => tool.function.name).sort(), activeToolNames.slice().sort());
      assert.doesNotMatch(JSON.stringify(payload), /large_docs_operation_/);
      await recordToolResult(dir, state, {
        requestId: current.record.id,
        executionId: currentAdmission.transaction!.id,
        status: "completed",
        summary: "One cited API found.",
        outputs: { refs: ["docs:api"] },
        validationPerformed: ["checked citation"],
      });
      const currentResult = await finalizeCurrentAgentToolExecution(
        dir,
        state,
        preparedCurrent.preparation,
        currentAdmission.transaction!,
      );
      assert.equal(currentResult.accepted, true);
      assert.equal(currentResult.resultRecord?.acceptanceStatus, "accepted");

      const isolated = await prepareToolRequest(dir, state, {
        toolName: "read",
        request: `Inspect one approved file under the ${contextWindow}-token profile.`,
        isolationRequirement: "focus",
        allowedTools: ["read"],
      });
      assert.ok(isolated.record);
      const isolatedDefinition = [{
        name: "read",
        description: "Read one approved project file.",
        parameters: { type: "object", properties: { path: { type: "string" } } },
        sourceInfo: { type: "builtin", name: "read" },
      }];
      const isolatedProfile = buildRuntimeToolEnvelopeProfile(isolatedDefinition, ["read"], {
        requestedToolNames: ["read"],
        selectionApisAvailable: true,
      });
      assert.ok(isolatedProfile.fingerprint);
      let isolatedModelCalls = 0;
      const unknownOutput = await runToolRequestAgent(dir, state, {
        requestId: isolated.record.id,
        execute: true,
        routeEvidenceSupplier: isolatedSupplier(contextWindow, isolatedProfile.fingerprint!, null),
      }, async (request) => {
        isolatedModelCalls += 1;
        return {
          taskId: request.taskId,
          exitCode: 0,
          stdoutEvents: [],
          stderr: "",
          timedOut: false,
          aborted: false,
          stdoutBytes: 0,
          stderrBytes: 0,
        };
      });
      assert.equal(unknownOutput.accepted, false);
      assert.equal(isolatedModelCalls, 0);
      assert.match(unknownOutput.message, /recommended blocked/i);
      assert.equal((await loadToolRequests(dir)).find((request) => request.id === isolated.record!.id)?.activeExecutionId, undefined);

      const insufficientReserve = await runToolRequestAgent(dir, state, {
        requestId: isolated.record.id,
        execute: true,
        routeEvidenceSupplier: isolatedSupplier(
          contextWindow,
          isolatedProfile.fingerprint!,
          DEFAULT_TOOL_EXECUTION_LIMITS.resultBytes - 1,
        ),
      }, async (request) => {
        isolatedModelCalls += 1;
        return {
          taskId: request.taskId,
          exitCode: 0,
          stdoutEvents: [],
          stderr: "",
          timedOut: false,
          aborted: false,
          stdoutBytes: 0,
          stderrBytes: 0,
        };
      });
      assert.equal(insufficientReserve.accepted, false);
      assert.equal(isolatedModelCalls, 0);
      assert.match(insufficientReserve.message, /caller continuation.*result reserve/i);

      const isolatedResult = await runToolRequestAgent(dir, state, {
        requestId: isolated.record.id,
        execute: true,
        routeEvidenceSupplier: isolatedSupplier(
          contextWindow,
          isolatedProfile.fingerprint!,
          DEFAULT_TOOL_EXECUTION_LIMITS.resultBytes,
        ),
      }, async (request) => {
        isolatedModelCalls += 1;
        assert.equal(request.providerAdmissionModel?.contextWindow, contextWindow);
        await recordToolResult(dir, state, {
          requestId: isolated.record!.id,
          executionId: request.executionId,
          status: "completed",
          summary: "Approved file inspected.",
          outputs: { refs: ["src:approved"] },
          validationPerformed: ["checked requested file boundary"],
        });
        return {
          taskId: request.taskId,
          exitCode: 0,
          stdoutEvents: [],
          stderr: "",
          timedOut: false,
          aborted: false,
          stdoutBytes: 0,
          stderrBytes: 0,
        };
      });
      assert.equal(isolatedResult.accepted, true, isolatedResult.message);
      assert.equal(isolatedModelCalls, 1);
      assert.equal(isolatedResult.transaction?.routeAdmission?.route, "isolated");
      assert.equal(isolatedResult.transaction?.routeAdmission?.profileFingerprint, isolatedProfile.fingerprint);
      assert.equal(isolatedResult.resultRecord?.acceptanceStatus, "accepted");
    }
  });
});

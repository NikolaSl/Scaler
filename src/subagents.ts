/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn } from "node:child_process";
import { extname } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath } from "node:url";
import { extractProviderUsage, type ProviderUsage } from "./provider-usage.js";
import {
  providerAdmissionEnvironmentKeys,
  validateProviderAdmissionPolicy,
  type ProviderAdmissionModel,
  type ProviderAdmissionPolicy,
} from "./provider-admission.js";
import { recordWatchdogCleanup } from "./watchdogs.js";
import type { TaskAttemptBinding } from "./task-attempts.js";

export interface TaskAgentRequest {
  taskId: string;
  prompt: string;
  executionId?: string;
  cwd?: string;
  tools?: string[];
  noTools?: boolean;
  model?: string;
  appendSystemPromptPath?: string;
  extensionPaths?: string[];
  providerAdmission?: ProviderAdmissionPolicy;
  /** Optional exact live-model identity bound by the parent admission decision. */
  providerAdmissionModel?: ProviderAdmissionModel;
  attempt?: TaskAttemptBinding;
}

export interface TaskAgentInvocation {
  command: string;
  args: string[];
  cwd?: string;
}

export interface TaskAgentRunResult {
  taskId: string;
  exitCode: number;
  stdoutEvents: unknown[];
  stderr: string;
  timedOut: boolean;
  aborted: boolean;
  stdoutBytes?: number;
  stderrBytes?: number;
  outputLimitExceeded?: "stdout" | "stderr";
  usage?: ProviderUsage;
}

export interface TaskAgentOutputLimits {
  stdoutBytes: number;
  stderrBytes: number;
}

export const DEFAULT_TASK_AGENT_OUTPUT_LIMITS: Readonly<TaskAgentOutputLimits> = Object.freeze({
  stdoutBytes: 4 * 1024 * 1024,
  stderrBytes: 1024 * 1024,
});

export interface RunTaskAgentOptions {
  command?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Runtime-owned transport limits. Never sourced from a child/model payload. */
  outputLimits?: TaskAgentOutputLimits;
}

export function buildTaskAgentInvocation(request: TaskAgentRequest, command = "pi"): TaskAgentInvocation {
  const args = ["--mode", "json", "-p", "--no-session"];
  const strictProviderAdmission = request.providerAdmission !== undefined;
  if (strictProviderAdmission) {
    const diagnostics = validateProviderAdmissionPolicy(request.providerAdmission!);
    if (diagnostics.length > 0) throw new Error(`Invalid provider admission policy: ${diagnostics.join("; ")}.`);
    if ((request.extensionPaths?.length ?? 0) > 0) {
      throw new Error("Strict provider admission does not allow additional extension paths.");
    }
    if (request.providerAdmissionModel) validateProviderAdmissionModelBinding(request.providerAdmissionModel);
    args.push("--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files");
  }
  if (!strictProviderAdmission && request.providerAdmissionModel) {
    throw new Error("Exact provider model binding requires strict provider admission.");
  }
  const grantedTools = normalizeGrantedTools(request);
  const extensionPaths = resolveChildAgentExtensionPaths(request, grantedTools.length > 0);

  for (const extensionPath of extensionPaths) {
    args.push("-e", extensionPath);
  }

  if (request.model) {
    args.push("--model", request.model);
  }

  if (grantedTools.length === 0) {
    args.push("--no-tools");
  } else {
    args.push("--tools", grantedTools.join(","));
  }

  if (request.appendSystemPromptPath) {
    args.push("--append-system-prompt", request.appendSystemPromptPath);
  }

  args.push(request.prompt);

  return {
    command,
    args,
    cwd: request.cwd,
  };
}

export function getDefaultScalerChildExtensionPath(): string {
  const currentPath = fileURLToPath(import.meta.url);
  const extension = extname(currentPath) || ".js";
  return fileURLToPath(new URL(`./index${extension}`, import.meta.url));
}

export function getProviderAdmissionExtensionPath(): string {
  const currentPath = fileURLToPath(import.meta.url);
  const extension = extname(currentPath) || ".js";
  return fileURLToPath(new URL(`./provider-admission-extension${extension}`, import.meta.url));
}

export function normalizeGrantedTools(request: TaskAgentRequest): string[] {
  if (request.noTools) return [];
  return uniqueStrings(request.tools ?? []);
}

export function resolveChildAgentExtensionPaths(request: TaskAgentRequest, toolsGranted = normalizeGrantedTools(request).length > 0): string[] {
  const provided = uniqueStrings(request.extensionPaths ?? []);
  if (request.providerAdmission) {
    if (provided.length > 0) throw new Error("Strict provider admission does not allow additional extension paths.");
    return [...(toolsGranted ? [getDefaultScalerChildExtensionPath()] : []), getProviderAdmissionExtensionPath()];
  }
  if (!toolsGranted || provided.length > 0) return provided;
  return [getDefaultScalerChildExtensionPath()];
}

export function extractStructuredReportPayloads(stdoutEvents: unknown[], reportType: string): Record<string, unknown>[] {
  const payloads: Record<string, unknown>[] = [];
  for (const event of stdoutEvents) {
    const direct = extractDirectReportPayload(event, reportType);
    if (direct) payloads.push(direct);

    for (const text of extractAssistantTextCandidates(event)) {
      const parsed = parseExactReportJson(text, reportType);
      if (parsed) payloads.push(parsed);
    }
  }
  return payloads;
}

export async function runTaskAgent(
  request: TaskAgentRequest,
  options: RunTaskAgentOptions = {},
): Promise<TaskAgentRunResult> {
  const outputLimits = validateTaskAgentOutputLimits(options.outputLimits ?? DEFAULT_TASK_AGENT_OUTPUT_LIMITS);
  if (options.signal?.aborted) {
    return {
      taskId: request.taskId,
      exitCode: 130,
      stdoutEvents: [],
      stderr: "Task agent cancelled before launch.",
      timedOut: false,
      aborted: true,
      stdoutBytes: 0,
      stderrBytes: 0,
    };
  }
  const invocation = buildTaskAgentInvocation(request, options.command ?? "pi");
  const environment: NodeJS.ProcessEnv = { ...process.env, SCALER_CHILD_AGENT: "1" };
  delete environment.SCALER_TOOL_EXECUTION_ID;
  for (const key of providerAdmissionEnvironmentKeys) delete environment[key];
  if (request.providerAdmission) {
    environment.SCALER_PROVIDER_ADMISSION = "strict";
    environment.SCALER_REQUEST_TOKEN_ALLOWANCE = String(request.providerAdmission.requestTokenAllowance);
    environment.SCALER_OUTPUT_RESERVE_TOKENS = String(request.providerAdmission.outputReserveTokens);
    environment.SCALER_REQUEST_MARGIN_TOKENS = String(request.providerAdmission.safetyMarginTokens);
    if (request.providerAdmissionModel) {
      environment.SCALER_EXPECTED_PROVIDER_API = String(request.providerAdmissionModel.api);
      environment.SCALER_EXPECTED_PROVIDER = String(request.providerAdmissionModel.provider);
      environment.SCALER_EXPECTED_MODEL_ID = String(request.providerAdmissionModel.id);
      environment.SCALER_EXPECTED_CONTEXT_WINDOW = String(request.providerAdmissionModel.contextWindow);
    }
  }
  if (request.executionId) environment.SCALER_TOOL_EXECUTION_ID = request.executionId;

  return await new Promise<TaskAgentRunResult>((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: invocation.cwd,
      // Routing metadata only: children keep their explicitly selected tools.
      // This flag does not grant authority or disable permission enforcement.
      env: environment,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdoutEvents: unknown[] = [];
    const stdoutDecoder = new StringDecoder("utf8");
    const stderrDecoder = new StringDecoder("utf8");
    let stdoutBuffer = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let outputLimitExceeded: "stdout" | "stderr" | undefined;
    let settled = false;
    let timeout: NodeJS.Timeout | undefined;
    let escalation: NodeJS.Timeout | undefined;
    let exited = false;
    let abort: (() => void) | undefined;
    let timedOut = false;
    let aborted = false;

    const cleanup = (): void => {
      if (timeout) clearTimeout(timeout);
      if (escalation) clearTimeout(escalation);
      if (abort) options.signal?.removeEventListener("abort", abort);
    };

    const processLine = (line: string): void => {
      if (!line.trim()) return;
      try {
        stdoutEvents.push(JSON.parse(line));
      } catch {
        stdoutEvents.push({ type: "unparsed", text: line });
      }
    };

    const latchOutputLimit = (stream: "stdout" | "stderr"): void => {
      if (outputLimitExceeded) return;
      outputLimitExceeded = stream;
      terminate();
    };

    child.stdout.on("data", (chunk: Buffer) => {
      const remaining = Math.max(0, outputLimits.stdoutBytes - stdoutBytes);
      const retained = chunk.length <= remaining ? chunk : chunk.subarray(0, remaining);
      stdoutBytes = addObservedBytes(stdoutBytes, chunk.length);
      if (retained.length > 0) stdoutBuffer += stdoutDecoder.write(retained);
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) processLine(line);
      if (chunk.length > remaining) latchOutputLimit("stdout");
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const remaining = Math.max(0, outputLimits.stderrBytes - stderrBytes);
      const retained = chunk.length <= remaining ? chunk : chunk.subarray(0, remaining);
      stderrBytes = addObservedBytes(stderrBytes, chunk.length);
      if (retained.length > 0) stderr += stderrDecoder.write(retained);
      if (chunk.length > remaining) latchOutputLimit("stderr");
    });

    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    });

    child.once("exit", () => {
      exited = true;
      cleanup();
    });

    child.once("close", async (code, signal) => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        stdoutBuffer += stdoutDecoder.end();
        stderr += stderrDecoder.end();
        if (stdoutBuffer.trim()) processLine(stdoutBuffer);
        if (outputLimitExceeded) {
          stderr += `\nTask agent ${outputLimitExceeded} exceeded its runtime byte limit.`;
        }
        if (request.cwd && (timedOut || aborted || outputLimitExceeded)) {
          await recordWatchdogCleanup(request.cwd, {
            scopeKind: "agent",
            scopeId: request.taskId,
            taskId: request.taskId,
            agentId: request.taskId,
            reason: timedOut ? "timeout" : aborted ? "abort" : "manual",
            signal: signal ?? "none",
            status: "completed",
            message: `Owned task-agent process exited after ${timedOut ? "timeout" : aborted ? "abort" : `${outputLimitExceeded} limit`}: code=${code ?? "null"} signal=${signal ?? "none"}.`,
          });
        }
        resolve({
          taskId: request.taskId,
          exitCode: timedOut ? 124 : aborted ? 130 : outputLimitExceeded ? 125 : code ?? 1,
          stdoutEvents,
          stderr,
          timedOut,
          aborted,
          stdoutBytes,
          stderrBytes,
          outputLimitExceeded,
          usage: extractProviderUsage(stdoutEvents),
        });
      } catch (error) {
        reject(error);
      }
    });

    const terminate = (): void => {
      if (exited || settled || escalation) return;
      if (timeout) clearTimeout(timeout);
      child.kill("SIGTERM");
      escalation = setTimeout(() => {
        // killed means a signal was sent, not that the process exited.
        if (!exited && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }, 5_000).unref();
    };

    if (options.signal) {
      abort = (): void => {
        aborted = true;
        terminate();
      };
      if (options.signal.aborted) abort();
      else options.signal.addEventListener("abort", abort, { once: true });
    }

    if (!aborted && options.timeoutMs && options.timeoutMs > 0) {
      timeout = setTimeout(() => {
        timedOut = true;
        stderr += `\nTask agent timed out after ${options.timeoutMs}ms.`;
        terminate();
      }, options.timeoutMs);
    }
  });
}

function validateProviderAdmissionModelBinding(model: ProviderAdmissionModel): void {
  const strings = [model.api, model.provider, model.id];
  if (!strings.every((value) => typeof value === "string" && value.trim().length > 0)
    || typeof model.contextWindow !== "number"
    || !Number.isSafeInteger(model.contextWindow)
    || model.contextWindow <= 0) {
    throw new Error("Invalid exact provider model binding.");
  }
}

function validateTaskAgentOutputLimits(limits: TaskAgentOutputLimits): TaskAgentOutputLimits {
  if (!isPositiveSafeInteger(limits.stdoutBytes) || !isPositiveSafeInteger(limits.stderrBytes)) {
    throw new Error("Invalid task-agent output limit: stdoutBytes and stderrBytes must be positive safe integers.");
  }
  return { stdoutBytes: limits.stdoutBytes, stderrBytes: limits.stderrBytes };
}

function addObservedBytes(current: number, additional: number): number {
  if (current > Number.MAX_SAFE_INTEGER - additional) return Number.MAX_SAFE_INTEGER;
  return current + additional;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function extractDirectReportPayload(event: unknown, reportType: string): Record<string, unknown> | undefined {
  if (!isRecord(event)) return undefined;
  if (event.type === reportType) return event;

  const nested = event[reportType] ?? event.payload ?? event.data;
  if (isRecord(nested) && nested.type === reportType) return nested;
  if (isRecord(nested) && isRecord(nested[reportType])) return nested[reportType];
  return undefined;
}

function extractAssistantTextCandidates(event: unknown): string[] {
  if (!isRecord(event)) return [];
  const texts: string[] = [];

  if (event.type === "message_update" && isRecord(event.assistantMessageEvent)) {
    const update = event.assistantMessageEvent;
    if (typeof update.delta === "string") texts.push(update.delta);
    if (typeof update.content === "string") texts.push(update.content);
    if (isRecord(update.partial)) texts.push(...extractAssistantMessageTexts(update.partial));
  }

  if ((event.type === "message_end" || event.type === "turn_end") && isRecord(event.message)) {
    texts.push(...extractAssistantMessageTexts(event.message));
  }

  if (event.type === "agent_end" && Array.isArray(event.messages)) {
    for (const message of event.messages) texts.push(...extractAssistantMessageTexts(message));
  }

  texts.push(...extractAssistantMessageTexts(event));
  return texts;
}

function extractAssistantMessageTexts(message: unknown): string[] {
  if (!isRecord(message) || message.role !== "assistant") return [];
  const content = message.content;
  if (typeof content === "string") return [content];
  if (!Array.isArray(content)) return [];
  return content
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text as string);
}

function parseExactReportJson(text: string, reportType: string): Record<string, unknown> | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return undefined;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return isRecord(parsed) && parsed.type === reportType ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

import { spawn } from "node:child_process";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import { extractProviderUsage, type ProviderUsage } from "./provider-usage.js";
import { recordWatchdogCleanup } from "./watchdogs.js";

export interface TaskAgentRequest {
  taskId: string;
  prompt: string;
  cwd?: string;
  tools?: string[];
  noTools?: boolean;
  model?: string;
  appendSystemPromptPath?: string;
  extensionPaths?: string[];
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
  usage?: ProviderUsage;
}

export interface RunTaskAgentOptions {
  command?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export function buildTaskAgentInvocation(request: TaskAgentRequest, command = "pi"): TaskAgentInvocation {
  const args = ["--mode", "json", "-p", "--no-session"];
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

export function normalizeGrantedTools(request: TaskAgentRequest): string[] {
  if (request.noTools) return [];
  return uniqueStrings(request.tools ?? []);
}

export function resolveChildAgentExtensionPaths(request: TaskAgentRequest, toolsGranted = normalizeGrantedTools(request).length > 0): string[] {
  const provided = uniqueStrings(request.extensionPaths ?? []);
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
  const invocation = buildTaskAgentInvocation(request, options.command ?? "pi");

  return await new Promise<TaskAgentRunResult>((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: invocation.cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdoutEvents: unknown[] = [];
    let stdoutBuffer = "";
    let stderr = "";
    let settled = false;
    let timeout: NodeJS.Timeout | undefined;
    let timedOut = false;
    let aborted = false;

    const settle = (result: TaskAgentRunResult): void => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      resolve(result);
    };

    const processLine = (line: string): void => {
      if (!line.trim()) return;
      try {
        stdoutEvents.push(JSON.parse(line));
      } catch {
        stdoutEvents.push({ type: "unparsed", text: line });
      }
    };

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBuffer += chunk.toString("utf8");
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) processLine(line);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      if (timeout) clearTimeout(timeout);
      reject(error);
    });

    child.on("close", async (code) => {
      if (stdoutBuffer.trim()) processLine(stdoutBuffer);
      if (request.cwd && (timedOut || aborted)) {
        await recordWatchdogCleanup(request.cwd, {
          scopeKind: "agent",
          scopeId: request.taskId,
          taskId: request.taskId,
          agentId: request.taskId,
          reason: timedOut ? "timeout" : "abort",
          signal: timedOut ? "SIGTERM/SIGKILL" : "abort-signal",
          status: "completed",
          message: timedOut ? `Task agent timed out and was terminated after ${options.timeoutMs}ms.` : "Task agent aborted and termination was requested.",
        });
      }
      settle({
        taskId: request.taskId,
        exitCode: code ?? 0,
        stdoutEvents,
        stderr,
        timedOut,
        aborted,
        usage: extractProviderUsage(stdoutEvents),
      });
    });

    const terminate = (): void => {
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, 5_000).unref();
    };

    if (options.signal) {
      const abort = (): void => {
        aborted = true;
        terminate();
      };
      if (options.signal.aborted) abort();
      else options.signal.addEventListener("abort", abort, { once: true });
    }

    if (options.timeoutMs && options.timeoutMs > 0) {
      timeout = setTimeout(() => {
        timedOut = true;
        stderr += `\nTask agent timed out after ${options.timeoutMs}ms.`;
        terminate();
      }, options.timeoutMs);
    }
  });
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

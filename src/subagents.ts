import { spawn } from "node:child_process";

export interface TaskAgentRequest {
  taskId: string;
  prompt: string;
  cwd?: string;
  tools?: string[];
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
}

export interface RunTaskAgentOptions {
  command?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export function buildTaskAgentInvocation(request: TaskAgentRequest, command = "pi"): TaskAgentInvocation {
  const args = ["--mode", "json", "-p", "--no-session"];

  for (const extensionPath of request.extensionPaths ?? []) {
    args.push("-e", extensionPath);
  }

  if (request.model) {
    args.push("--model", request.model);
  }

  if (request.tools && request.tools.length > 0) {
    args.push("--tools", request.tools.join(","));
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

    child.on("close", (code) => {
      if (stdoutBuffer.trim()) processLine(stdoutBuffer);
      settle({
        taskId: request.taskId,
        exitCode: code ?? 0,
        stdoutEvents,
        stderr,
        timedOut,
        aborted,
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

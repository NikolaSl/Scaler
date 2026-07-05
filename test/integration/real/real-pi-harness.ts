/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REAL_PI_ENABLED = process.env.SCALER_REAL_PI_INTEGRATION === "1";
export const REAL_PI_MODEL = process.env.SCALER_REAL_PI_MODEL ?? "openai-codex/gpt-5.3-codex-spark";
export const REAL_PI_COMMAND = process.env.SCALER_REAL_PI_COMMAND ?? "pi";
export const REAL_PI_TIMEOUT_MS = Number.parseInt(process.env.SCALER_REAL_PI_TIMEOUT_MS ?? "60000", 10);

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const SCALER_EXTENSION_PATH = join(REPO_ROOT, "src/index.ts");

export interface RealPiRunOptions {
  prompt: string;
  cwd: string;
  model?: string;
  tools?: string[];
  extensionPaths?: string[];
  timeoutMs?: number;
}

export interface RealPiRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  events: unknown[];
  args: string[];
}

export async function withRealPiTempRepo<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scaler-real-pi-extension-test-"));
  try {
    await runCommand("git", ["init"], dir);
    await runCommand("git", ["config", "user.email", "scaler-real@example.invalid"], dir);
    await runCommand("git", ["config", "user.name", "Scaler Real"], dir);
    await writeFile(join(dir, "package.json"), JSON.stringify({
      type: "module",
      scripts: {
        test: "node -e \"process.exit(0)\"",
        build: "node -e \"process.exit(0)\"",
      },
    }, null, 2));
    await runCommand("git", ["add", "package.json"], dir);
    await runCommand("git", ["commit", "-m", "initial real fixture"], dir);
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function runScalerPi(options: RealPiRunOptions): Promise<RealPiRunResult> {
  const args = ["--mode", "json", "-p", "--no-session"];
  for (const extensionPath of options.extensionPaths ?? [SCALER_EXTENSION_PATH]) {
    args.push("-e", extensionPath);
  }
  if (options.model) args.push("--model", options.model);
  if (options.tools && options.tools.length > 0) args.push("--tools", options.tools.join(","));
  args.push(options.prompt);

  const result = await execFileResult(REAL_PI_COMMAND, args, options.cwd, options.timeoutMs ?? REAL_PI_TIMEOUT_MS);
  return {
    ...result,
    events: parseJsonLines(result.stdout),
    args,
  };
}

export function parseJsonLines(output: string): unknown[] {
  return output
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      try {
        return JSON.parse(line) as unknown;
      } catch {
        return { type: "unparsed", text: line };
      }
    });
}

async function runCommand(command: string, args: string[], cwd: string): Promise<void> {
  const result = await execFileResult(command, args, cwd, 30_000);
  if (result.exitCode !== 0) throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
}

function execFileResult(command: string, args: string[], cwd: string, timeoutMs: number): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, 5_000).unref();
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      if (timedOut) stderr += `\n${command} timed out after ${timeoutMs}ms.`;
      resolve({ exitCode: timedOut ? 124 : (code ?? (signal ? 1 : 0)), stdout, stderr });
    });
  });
}

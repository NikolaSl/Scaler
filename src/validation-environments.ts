import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { getValidationEnvironmentsPath } from "./paths.js";
import type { ValidationEnvironmentKind } from "./validation.js";

export type ValidationEnvironmentLifecyclePhase = "prepare" | "cleanup";
export type ValidationEnvironmentLifecycleStatus = "prepared" | "unavailable" | "cleanup_completed" | "cleanup_failed";

export interface ValidationEnvironmentLifecycleRecord {
  id: string;
  taskId?: string;
  commandId: string;
  environment: ValidationEnvironmentKind;
  phase: ValidationEnvironmentLifecyclePhase;
  status: ValidationEnvironmentLifecycleStatus;
  message: string;
  tool?: string;
  probeCommand?: string;
  exitCode?: number | null;
  stdoutSummary?: string;
  stderrSummary?: string;
  startedAt: string;
  finishedAt: string;
}

export interface ValidationEnvironmentProbeResult {
  available: boolean;
  tool?: string;
  command?: string;
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
  message?: string;
}

export type ValidationEnvironmentProbe = (
  cwd: string,
  environment: Exclude<ValidationEnvironmentKind, "host">,
) => Promise<ValidationEnvironmentProbeResult>;

export interface ValidationEnvironmentLifecycleOptions {
  taskId?: string;
  commandId: string;
  probe?: ValidationEnvironmentProbe;
}

export interface ValidationEnvironmentLifecycleResult {
  prepared: boolean;
  environment: Exclude<ValidationEnvironmentKind, "host">;
  prepareRecord: ValidationEnvironmentLifecycleRecord;
  cleanupRecord?: ValidationEnvironmentLifecycleRecord;
  blockedReason?: string;
}

interface ValidationEnvironmentLifecycleIndex {
  version: 1;
  records: ValidationEnvironmentLifecycleRecord[];
}

const probeTimeoutMs = 5000;

export async function loadValidationEnvironmentRecords(cwd: string): Promise<ValidationEnvironmentLifecycleRecord[]> {
  try {
    const raw = await readFile(getValidationEnvironmentsPath(cwd), "utf8");
    return (JSON.parse(raw) as ValidationEnvironmentLifecycleIndex).records;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export function formatValidationEnvironmentRecords(records: ValidationEnvironmentLifecycleRecord[], limit = 10): string {
  if (!records.length) return "No validation environment lifecycle records.";
  const shown = records.slice(0, Math.max(1, limit));
  const lines = [`Validation environments: records=${records.length} showing=${shown.length}`];
  for (const record of shown) {
    lines.push(
      `- ${record.id} command=${record.commandId} env=${record.environment} phase=${record.phase} status=${record.status}: ${record.message}`,
    );
  }
  return lines.join("\n");
}

export async function prepareValidationEnvironment(
  cwd: string,
  environment: Exclude<ValidationEnvironmentKind, "host">,
  options: ValidationEnvironmentLifecycleOptions,
): Promise<ValidationEnvironmentLifecycleResult> {
  const startedAt = new Date();
  const probe = await (options.probe ?? probeValidationEnvironment)(cwd, environment);
  const finishedAt = new Date();
  const available = probe.available;
  const message = probe.message ?? defaultProbeMessage(environment, available);
  const prepareRecord: ValidationEnvironmentLifecycleRecord = {
    id: lifecycleRecordId(options.taskId, options.commandId, environment, "prepare", startedAt),
    taskId: options.taskId,
    commandId: options.commandId,
    environment,
    phase: "prepare",
    status: available ? "prepared" : "unavailable",
    message,
    tool: probe.tool,
    probeCommand: probe.command,
    exitCode: probe.exitCode,
    stdoutSummary: summarizeLifecycleOutput(probe.stdout),
    stderrSummary: summarizeLifecycleOutput(probe.stderr),
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
  };
  await appendValidationEnvironmentRecord(cwd, prepareRecord);
  return {
    prepared: available,
    environment,
    prepareRecord,
    blockedReason: available ? undefined : `Validation environment ${environment} unavailable: ${message}`,
  };
}

export async function cleanupValidationEnvironment(
  cwd: string,
  environment: Exclude<ValidationEnvironmentKind, "host">,
  options: ValidationEnvironmentLifecycleOptions,
): Promise<ValidationEnvironmentLifecycleRecord> {
  const startedAt = new Date();
  const finishedAt = new Date();
  const record: ValidationEnvironmentLifecycleRecord = {
    id: lifecycleRecordId(options.taskId, options.commandId, environment, "cleanup", startedAt),
    taskId: options.taskId,
    commandId: options.commandId,
    environment,
    phase: "cleanup",
    status: "cleanup_completed",
    message: cleanupMessage(environment),
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
  };
  await appendValidationEnvironmentRecord(cwd, record);
  return record;
}

export async function probeValidationEnvironment(
  cwd: string,
  environment: Exclude<ValidationEnvironmentKind, "host">,
): Promise<ValidationEnvironmentProbeResult> {
  if (environment === "local_ci") {
    return {
      available: true,
      tool: "local_ci",
      message: "Local CI lifecycle is available for project-local command execution.",
    };
  }

  if (environment === "compose") {
    const composeV2 = await runProbeCommand(cwd, "docker", ["compose", "version"]);
    if (composeV2.available) return { ...composeV2, tool: "docker compose", command: "docker compose version" };
    const composeV1 = await runProbeCommand(cwd, "docker-compose", ["--version"]);
    return { ...composeV1, tool: "docker-compose", command: "docker-compose --version" };
  }

  if (environment === "docker") {
    const result = await runProbeCommand(cwd, "docker", ["--version"]);
    return { ...result, tool: "docker", command: "docker --version" };
  }

  if (environment === "devcontainer") {
    const result = await runProbeCommand(cwd, "devcontainer", ["--version"]);
    return { ...result, tool: "devcontainer", command: "devcontainer --version" };
  }

  const result = await runProbeCommand(cwd, "minikube", ["version", "--short"]);
  return { ...result, tool: "minikube", command: "minikube version --short" };
}

async function appendValidationEnvironmentRecord(cwd: string, record: ValidationEnvironmentLifecycleRecord): Promise<void> {
  const records = await loadValidationEnvironmentRecords(cwd);
  await writeValidationEnvironmentRecords(cwd, [record, ...records]);
}

async function writeValidationEnvironmentRecords(cwd: string, records: ValidationEnvironmentLifecycleRecord[]): Promise<void> {
  const path = getValidationEnvironmentsPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ version: 1, records } satisfies ValidationEnvironmentLifecycleIndex, null, 2)}\n`, "utf8");
}

function lifecycleRecordId(
  taskId: string | undefined,
  commandId: string,
  environment: Exclude<ValidationEnvironmentKind, "host">,
  phase: ValidationEnvironmentLifecyclePhase,
  at: Date,
): string {
  const prefix = taskId ? `${taskId}-` : "";
  return `${prefix}${commandId}-${environment}-${phase}-${at.getTime()}`;
}

function defaultProbeMessage(environment: Exclude<ValidationEnvironmentKind, "host">, available: boolean): string {
  return available
    ? `Validation environment ${environment} prepared.`
    : `Required validation environment ${environment} tooling is unavailable.`;
}

function cleanupMessage(environment: Exclude<ValidationEnvironmentKind, "host">): string {
  if (environment === "local_ci") return "Local CI lifecycle cleanup completed; no external resources were created.";
  return `Validation environment ${environment} cleanup completed; no Scaler-managed resources remain.`;
}

async function runProbeCommand(cwd: string, executable: string, args: string[]): Promise<ValidationEnvironmentProbeResult> {
  return new Promise((resolve) => {
    const child = spawn(executable, args, { cwd, shell: false });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      child.kill("SIGTERM");
      resolve({
        available: false,
        exitCode: null,
        stdout,
        stderr,
        message: `${executable} probe timed out after ${probeTimeoutMs}ms.`,
      });
    }, probeTimeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        available: false,
        exitCode: null,
        stdout,
        stderr,
        message: error.message,
      });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        available: code === 0,
        exitCode: code,
        stdout,
        stderr,
        message: code === 0 ? `${executable} probe succeeded.` : `${executable} probe exited with code ${code ?? "unknown"}.`,
      });
    });
  });
}

function summarizeLifecycleOutput(output: string | undefined): string | undefined {
  const text = output?.trim();
  if (!text) return undefined;
  const max = 1000;
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

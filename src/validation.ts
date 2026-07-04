import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { appendLogEvent, createLogEvent, logValidationSummaryAudit } from "./logging.js";
import { getValidationChecklistsPath, getValidationManifestsPath, getValidationRunsPath } from "./paths.js";
import { requestReplan } from "./replanning.js";
import { saveState } from "./state.js";
import { transitionTask } from "./supervisor.js";
import type { ScalerState, ScalerTaskStatus } from "./types.js";

export type ValidationStatus = "passed" | "failed" | "partial" | "blocked" | "not_applicable";
export type ValidationChecklistItemStatus = "passed" | "failed" | "blocked" | "not_applicable";
export type ValidationChecklistStatus = "passed" | "failed" | "blocked";

export type ValidationGateKind =
  | "dependency_check"
  | "test_first"
  | "build_compile"
  | "unit_tests"
  | "integration_tests"
  | "static_checks"
  | "security_checks"
  | "local_ci"
  | "acceptance_smoke"
  | "regression"
  | "completeness"
  | "consistency"
  | "compliance"
  | "source_validation"
  | "adversarial_review"
  | "uncertainty_report"
  | "custom";

export interface ValidationReportInput {
  taskId: string;
  status: ValidationStatus | string;
  summary: string;
  details?: unknown;
}

export interface ValidationApplyResult {
  state: ScalerState;
  accepted: boolean;
  message: string;
  targetStatus?: ScalerTaskStatus;
}

export interface ValidationCommandManifest {
  id: string;
  command: string;
  description?: string;
  timeoutMs?: number;
  required: boolean;
  gate?: ValidationGateKind | string;
  expectedResult?: string;
  evidenceRefs?: string[];
}

export interface TaskValidationManifest {
  taskId: string;
  commands: ValidationCommandManifest[];
  createdAt: string;
  updatedAt: string;
}

export interface ValidationManifestCommandInput {
  taskId: string;
  id: string;
  command: string;
  description?: string;
  timeoutMs?: number;
  required?: boolean;
  gate?: ValidationGateKind | string;
  expectedResult?: string;
  evidenceRefs?: string[];
}

export interface ValidationChecklistItemInput {
  id: string;
  statement: string;
  status: ValidationChecklistItemStatus | string;
  required?: boolean;
  evidenceRefs?: string[];
  notes?: string;
}

export interface ValidationChecklistInput {
  taskId: string;
  gate?: ValidationGateKind | string;
  summary?: string;
  items: ValidationChecklistItemInput[];
  evidenceRefs?: string[];
}

export interface ValidationChecklistItemRecord {
  id: string;
  statement: string;
  status: ValidationChecklistItemStatus;
  required: boolean;
  evidenceRefs?: string[];
  notes?: string;
}

export interface ValidationChecklistRecord {
  id: string;
  taskId: string;
  gate?: ValidationGateKind;
  status: ValidationChecklistStatus;
  summary: string;
  items: ValidationChecklistItemRecord[];
  evidenceRefs?: string[];
  createdAt: string;
}

export interface ValidationChecklistApplyResult {
  record: ValidationChecklistRecord;
  applyResult: ValidationApplyResult;
}

interface ValidationManifestIndex {
  version: 1;
  manifests: TaskValidationManifest[];
}

export type ValidationCommandStatus = "passed" | "failed" | "timed_out";

export interface ValidationCommandRunRecord {
  id: string;
  commandId: string;
  command: string;
  status: ValidationCommandStatus;
  exitCode: number | null;
  stdoutSummary: string;
  stderrSummary: string;
  startedAt: string;
  finishedAt: string;
  required: boolean;
  description?: string;
  gate?: ValidationGateKind;
  expectedResult?: string;
  evidenceRefs?: string[];
}

export interface ValidationRunRecord {
  id: string;
  taskId: string;
  status: "passed" | "failed";
  commandRuns: ValidationCommandRunRecord[];
  createdAt: string;
}

interface ValidationRunIndex {
  version: 1;
  runs: ValidationRunRecord[];
}

interface ValidationChecklistIndex {
  version: 1;
  checklists: ValidationChecklistRecord[];
}

const validationStatuses = new Set<ValidationStatus>(["passed", "failed", "partial", "blocked", "not_applicable"]);

const validationChecklistItemStatuses = new Set<ValidationChecklistItemStatus>(["passed", "failed", "blocked", "not_applicable"]);

const validationGateKinds = new Set<ValidationGateKind>([
  "dependency_check",
  "test_first",
  "build_compile",
  "unit_tests",
  "integration_tests",
  "static_checks",
  "security_checks",
  "local_ci",
  "acceptance_smoke",
  "regression",
  "completeness",
  "consistency",
  "compliance",
  "source_validation",
  "adversarial_review",
  "uncertainty_report",
  "custom",
]);

const validationGateAliases: Record<string, ValidationGateKind> = {
  dependency: "dependency_check",
  dependencies: "dependency_check",
  deps: "dependency_check",
  dependency_check: "dependency_check",
  dependencycheck: "dependency_check",
  test_first: "test_first",
  testfirst: "test_first",
  tests_first: "test_first",
  build: "build_compile",
  compile: "build_compile",
  build_compile: "build_compile",
  buildcompile: "build_compile",
  unit: "unit_tests",
  unit_test: "unit_tests",
  unit_tests: "unit_tests",
  unittests: "unit_tests",
  test: "unit_tests",
  tests: "unit_tests",
  integration: "integration_tests",
  integration_test: "integration_tests",
  integration_tests: "integration_tests",
  e2e: "integration_tests",
  static: "static_checks",
  lint: "static_checks",
  typecheck: "static_checks",
  type_check: "static_checks",
  format_check: "static_checks",
  formatcheck: "static_checks",
  static_checks: "static_checks",
  security: "security_checks",
  audit: "security_checks",
  security_checks: "security_checks",
  cve: "security_checks",
  ci: "local_ci",
  local_ci: "local_ci",
  localci: "local_ci",
  docker: "local_ci",
  compose: "local_ci",
  smoke: "acceptance_smoke",
  acceptance: "acceptance_smoke",
  acceptance_smoke: "acceptance_smoke",
  regression: "regression",
  completeness: "completeness",
  consistency: "consistency",
  compliance: "compliance",
  source: "source_validation",
  sources: "source_validation",
  source_validation: "source_validation",
  adversarial: "adversarial_review",
  adversarial_review: "adversarial_review",
  uncertainty: "uncertainty_report",
  uncertainty_report: "uncertainty_report",
  custom: "custom",
};

const defaultScriptGateOrder = [
  "test",
  "test:unit",
  "build",
  "typecheck",
  "lint",
  "format:check",
  "test:integration",
  "integration",
  "test:e2e",
  "e2e",
  "smoke",
  "audit",
] as const;

export function isValidationStatus(value: unknown): value is ValidationStatus {
  return typeof value === "string" && validationStatuses.has(value as ValidationStatus);
}

export function isValidationGateKind(value: unknown): value is ValidationGateKind {
  return typeof value === "string" && validationGateKinds.has(value as ValidationGateKind);
}

export function normalizeValidationGateKind(value: unknown): ValidationGateKind | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!normalized) return undefined;
  return validationGateAliases[normalized] ?? (isValidationGateKind(normalized) ? normalized : "custom");
}

export async function loadValidationManifests(cwd: string): Promise<TaskValidationManifest[]> {
  try {
    const raw = await readFile(getValidationManifestsPath(cwd), "utf8");
    return (JSON.parse(raw) as ValidationManifestIndex).manifests;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function saveValidationManifest(cwd: string, manifest: TaskValidationManifest): Promise<TaskValidationManifest> {
  const manifests = await loadValidationManifests(cwd);
  const timestamp = new Date().toISOString();
  const normalized: TaskValidationManifest = {
    ...manifest,
    createdAt: manifest.createdAt || timestamp,
    updatedAt: timestamp,
    commands: manifest.commands.map((command, index) => ({
      ...command,
      id: command.id || `cmd-${index + 1}`,
      required: command.required,
      gate: normalizeValidationGateKind(command.gate),
      expectedResult: normalizeOptionalString(command.expectedResult),
      evidenceRefs: normalizeStringList(command.evidenceRefs),
    })),
  };
  const next = [normalized, ...manifests.filter((candidate) => candidate.taskId !== manifest.taskId)];
  await writeValidationManifestIndex(cwd, next);
  return normalized;
}

export async function upsertValidationManifestCommand(
  cwd: string,
  input: ValidationManifestCommandInput,
): Promise<TaskValidationManifest> {
  const existing = (await loadValidationManifests(cwd)).find((manifest) => manifest.taskId === input.taskId);
  const base = existing ?? (await createDefaultValidationManifest(cwd, input.taskId));
  const command: ValidationCommandManifest = {
    id: input.id,
    command: input.command,
    description: input.description,
    timeoutMs: input.timeoutMs,
    required: input.required ?? true,
    gate: normalizeValidationGateKind(input.gate),
    expectedResult: normalizeOptionalString(input.expectedResult),
    evidenceRefs: normalizeStringList(input.evidenceRefs),
  };
  return await saveValidationManifest(cwd, {
    ...base,
    commands: [command, ...base.commands.filter((candidate) => candidate.id !== input.id)],
  });
}

export async function getValidationManifestForTask(cwd: string, taskId: string): Promise<TaskValidationManifest> {
  const manifests = await loadValidationManifests(cwd);
  return manifests.find((manifest) => manifest.taskId === taskId) ?? (await createDefaultValidationManifest(cwd, taskId));
}

export async function createDefaultValidationManifest(cwd: string, taskId: string): Promise<TaskValidationManifest> {
  const commands: ValidationCommandManifest[] = [];
  const packageJsonPath = join(cwd, "package.json");
  try {
    const pkg = JSON.parse(await readFile(packageJsonPath, "utf8")) as { scripts?: Record<string, string> };
    for (const scriptName of defaultScriptGateOrder) {
      if (!pkg.scripts?.[scriptName]) continue;
      commands.push(createDefaultScriptValidationCommand(scriptName));
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const timestamp = new Date().toISOString();
  return { taskId, commands, createdAt: timestamp, updatedAt: timestamp };
}

export function createDefaultScriptValidationCommand(scriptName: string): ValidationCommandManifest {
  return {
    id: scriptName === "test" ? "npm-test" : `npm-run-${scriptName.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "")}`,
    command: scriptName === "test" ? "npm test" : `npm run ${scriptName}`,
    description: defaultScriptDescription(scriptName),
    required: true,
    gate: classifyDefaultScriptGate(scriptName),
    expectedResult: "Command exits with code 0.",
  };
}

export function classifyDefaultScriptGate(scriptName: string): ValidationGateKind {
  const normalized = scriptName.trim().toLowerCase();
  if (normalized === "build") return "build_compile";
  if (normalized === "test" || normalized === "test:unit") return "unit_tests";
  if (["lint", "typecheck", "format:check"].includes(normalized)) return "static_checks";
  if (["test:integration", "integration", "test:e2e", "e2e"].includes(normalized)) return "integration_tests";
  if (normalized === "smoke") return "acceptance_smoke";
  if (normalized === "audit") return "security_checks";
  return "custom";
}

export async function loadValidationRuns(cwd: string): Promise<ValidationRunRecord[]> {
  try {
    const raw = await readFile(getValidationRunsPath(cwd), "utf8");
    return (JSON.parse(raw) as ValidationRunIndex).runs;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function loadValidationChecklists(cwd: string): Promise<ValidationChecklistRecord[]> {
  try {
    const raw = await readFile(getValidationChecklistsPath(cwd), "utf8");
    return (JSON.parse(raw) as ValidationChecklistIndex).checklists;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export function rollupValidationChecklist(items: ValidationChecklistItemRecord[]): ValidationChecklistStatus {
  const required = items.filter((item) => item.required);
  if (required.some((item) => item.status === "blocked")) return "blocked";
  if (required.some((item) => item.status === "failed")) return "failed";
  return "passed";
}

export async function recordValidationChecklist(
  cwd: string,
  state: ScalerState,
  input: ValidationChecklistInput,
  now = new Date(),
): Promise<ValidationChecklistApplyResult> {
  const taskId = input.taskId.trim();
  if (!taskId) throw new Error("Validation checklist rejected: taskId is required.");
  if (!input.items.length) throw new Error("Validation checklist rejected: at least one item is required.");
  const items = input.items.map(normalizeValidationChecklistItem);
  const status = rollupValidationChecklist(items);
  const evidenceRefs = normalizeStringList(input.evidenceRefs);
  const record: ValidationChecklistRecord = {
    id: `${taskId}-checklist-${now.getTime()}`,
    taskId,
    gate: normalizeValidationGateKind(input.gate),
    status,
    summary: normalizeOptionalString(input.summary) ?? `Validation checklist ${status}: ${taskId}`,
    items,
    evidenceRefs,
    createdAt: now.toISOString(),
  };
  await writeValidationChecklistIndex(cwd, [record, ...(await loadValidationChecklists(cwd))]);
  const applyResult = await applyValidationReport(cwd, state, {
    taskId,
    status,
    summary: record.summary,
    details: {
      checklistId: record.id,
      gate: record.gate,
      evidenceRefs: collectChecklistEvidenceRefs(record),
      items,
    },
  });
  await logValidationSummaryAudit(cwd, applyResult.state, {
    taskId,
    runId: record.id,
    status: record.status,
    commandCount: 0,
    failedCommandIds: record.items.filter((item) => item.required && item.status !== "passed" && item.status !== "not_applicable").map((item) => item.id),
    gates: [{ commandId: record.id, gate: record.gate, required: true, status: record.status === "passed" ? "passed" : "failed" }],
    details: record,
  });
  return { record, applyResult };
}

export function formatValidationChecklist(record: ValidationChecklistRecord): string {
  const lines = [`Validation checklist ${record.id}: task=${record.taskId} gate=${record.gate ?? "custom"} status=${record.status}`];
  lines.push(`Summary: ${record.summary}`);
  for (const item of record.items) {
    lines.push(`- ${item.id} required=${item.required} status=${item.status}: ${item.statement}${item.evidenceRefs?.length ? ` evidence=${item.evidenceRefs.join(",")}` : ""}`);
  }
  return lines.join("\n");
}

export async function runTaskValidation(cwd: string, state: ScalerState, taskId: string): Promise<ValidationRunRecord> {
  const manifest = await getValidationManifestForTask(cwd, taskId);
  const commandRuns: ValidationCommandRunRecord[] = [];
  for (const command of manifest.commands) {
    commandRuns.push(await runValidationCommand(cwd, command));
  }

  const failedRequired = commandRuns.some((run) => run.required && run.status !== "passed");
  const record: ValidationRunRecord = {
    id: `${taskId}-${Date.now()}`,
    taskId,
    status: failedRequired ? "failed" : "passed",
    commandRuns,
    createdAt: new Date().toISOString(),
  };
  await writeValidationRuns(cwd, [record, ...(await loadValidationRuns(cwd))]);
  const result = await applyValidationReport(cwd, state, {
    taskId,
    status: record.status === "passed" ? "passed" : "failed",
    summary: `Validation ${record.status}: ${taskId}`,
    details: { runId: record.id, commandRuns },
  });
  await logValidationSummaryAudit(cwd, result.state, {
    taskId,
    runId: record.id,
    status: record.status,
    commandCount: commandRuns.length,
    failedCommandIds: commandRuns.filter((run) => run.status !== "passed").map((run) => run.commandId),
    gates: commandRuns.map((run) => ({ commandId: run.commandId, gate: run.gate, required: run.required, status: run.status })),
    details: record,
  });
  return record;
}

export async function runValidationCommandSet(
  cwd: string,
  taskId: string,
  commands: ValidationCommandManifest[],
  idPrefix = "validation",
): Promise<ValidationRunRecord> {
  const commandRuns: ValidationCommandRunRecord[] = [];
  for (const command of commands) {
    commandRuns.push(await runValidationCommand(cwd, command));
  }
  const failedRequired = commandRuns.some((run) => run.required && run.status !== "passed");
  const record: ValidationRunRecord = {
    id: `${taskId}-${idPrefix}-${Date.now()}`,
    taskId,
    status: failedRequired ? "failed" : "passed",
    commandRuns,
    createdAt: new Date().toISOString(),
  };
  await writeValidationRuns(cwd, [record, ...(await loadValidationRuns(cwd))]);
  return record;
}

export async function runValidationCommand(cwd: string, command: ValidationCommandManifest): Promise<ValidationCommandRunRecord> {
  const startedAt = new Date();
  const result = await executeCommand(cwd, command.command, command.timeoutMs);
  const finishedAt = new Date();
  const status: ValidationCommandStatus = result.timedOut ? "timed_out" : result.exitCode === 0 ? "passed" : "failed";
  return {
    id: `${command.id}-${startedAt.getTime()}`,
    commandId: command.id,
    command: command.command,
    status,
    exitCode: result.exitCode,
    stdoutSummary: summarizeOutput(result.stdout),
    stderrSummary: summarizeOutput(result.stderr),
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    required: command.required,
    description: command.description,
    gate: normalizeValidationGateKind(command.gate),
    expectedResult: normalizeOptionalString(command.expectedResult),
    evidenceRefs: normalizeStringList(command.evidenceRefs),
  };
}

export async function applyValidationReport(
  cwd: string,
  state: ScalerState,
  report: ValidationReportInput,
): Promise<ValidationApplyResult> {
  if (!isValidationStatus(report.status)) {
    return logAndReturn(cwd, state, report, false, `Validation rejected: invalid status ${String(report.status)}`);
  }

  const task = state.tasks.find((candidate) => candidate.id === report.taskId);
  if (!task) {
    return logAndReturn(cwd, state, report, false, `Validation rejected: task ${report.taskId} does not exist`);
  }

  const targetStatus = getTargetTaskStatus(task.status, report.status);
  if (!targetStatus) {
    return logAndReturn(
      cwd,
      state,
      report,
      false,
      `Validation ${report.status} cannot be applied from task status ${task.status}`,
    );
  }

  const beforeRejected = state.rejectedTransitions.length;
  const nextState = transitionTask(state, report.taskId, targetStatus, { reason: report.summary });
  const accepted = nextState.rejectedTransitions.length === beforeRejected;
  let finalState = nextState;
  await saveState(cwd, nextState);
  let replanRequestId: string | undefined;
  if (accepted && report.status === "blocked") {
    const replan = await requestReplan(cwd, nextState, {
      trigger: "validation_blocked",
      reason: report.summary,
      taskId: report.taskId,
      evidenceRefs: extractEvidenceRefs(report.details),
      requirementRefs: task.prdRefs,
    });
    finalState = replan.state;
    replanRequestId = replan.request.id;
  }
  await appendLogEvent(
    cwd,
    createLogEvent(finalState, {
      eventType: "validation",
      summary: `${accepted ? "Validation applied" : "Validation rejected"}: ${report.taskId} ${report.status}`,
      taskId: report.taskId,
      details: { report, targetStatus, replanRequestId },
    }),
  );

  return {
    state: finalState,
    accepted,
    message: accepted ? `Validation applied: ${report.taskId} -> ${targetStatus}` : `Validation transition rejected: ${report.taskId}`,
    targetStatus,
  };
}

function defaultScriptDescription(scriptName: string): string {
  switch (classifyDefaultScriptGate(scriptName)) {
    case "build_compile":
      return "Run package build/compile script.";
    case "unit_tests":
      return "Run package unit test script.";
    case "static_checks":
      return "Run package static check script.";
    case "integration_tests":
      return "Run package integration test script.";
    case "acceptance_smoke":
      return "Run package smoke/acceptance script.";
    case "security_checks":
      return "Run package security/audit script.";
    default:
      return "Run package validation script.";
  }
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const list = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
  return list.length > 0 ? Array.from(new Set(list)) : undefined;
}

function extractEvidenceRefs(details: unknown): string[] | undefined {
  if (!details || typeof details !== "object") return undefined;
  const refs = (details as { evidenceRefs?: unknown; runId?: unknown }).evidenceRefs;
  if (Array.isArray(refs)) return refs.filter((ref): ref is string => typeof ref === "string");
  const runId = (details as { runId?: unknown }).runId;
  return typeof runId === "string" ? [runId] : undefined;
}

function normalizeValidationChecklistItem(item: ValidationChecklistItemInput, index: number): ValidationChecklistItemRecord {
  const id = normalizeOptionalString(item.id) ?? `item-${index + 1}`;
  const statement = normalizeOptionalString(item.statement);
  if (!statement) throw new Error(`Validation checklist rejected: item ${id} statement is required.`);
  const status = normalizeValidationChecklistItemStatus(item.status);
  return {
    id,
    statement,
    status,
    required: item.required ?? true,
    evidenceRefs: normalizeStringList(item.evidenceRefs),
    notes: normalizeOptionalString(item.notes),
  };
}

function normalizeValidationChecklistItemStatus(value: unknown): ValidationChecklistItemStatus {
  if (typeof value !== "string") throw new Error("Validation checklist rejected: item status is required.");
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!validationChecklistItemStatuses.has(normalized as ValidationChecklistItemStatus)) {
    throw new Error(`Validation checklist rejected: invalid item status ${String(value)}.`);
  }
  return normalized as ValidationChecklistItemStatus;
}

function collectChecklistEvidenceRefs(record: ValidationChecklistRecord): string[] | undefined {
  const refs = normalizeStringList([
    ...(record.evidenceRefs ?? []),
    ...record.items.flatMap((item) => item.evidenceRefs ?? []),
    record.id,
  ]);
  return refs;
}

function getTargetTaskStatus(current: ScalerTaskStatus, validation: ValidationStatus): ScalerTaskStatus | undefined {
  if (validation === "passed" || validation === "not_applicable") {
    if (current === "validating" || current === "debugging") return "validated";
    return undefined;
  }

  if (validation === "failed" || validation === "partial") {
    if (current === "validating") return "debugging";
    return undefined;
  }

  if (validation === "blocked") {
    if (current === "running" || current === "validating") return "blocked";
    return undefined;
  }

  return undefined;
}

async function logAndReturn(
  cwd: string,
  state: ScalerState,
  report: ValidationReportInput,
  accepted: boolean,
  message: string,
): Promise<ValidationApplyResult> {
  await appendLogEvent(
    cwd,
    createLogEvent(state, {
      eventType: "validation",
      summary: message,
      taskId: report.taskId,
      details: report,
    }),
  );
  return { state, accepted, message };
}

async function writeValidationManifestIndex(cwd: string, manifests: TaskValidationManifest[]): Promise<void> {
  const path = getValidationManifestsPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ version: 1, manifests } satisfies ValidationManifestIndex, null, 2)}\n`, "utf8");
}

async function writeValidationRuns(cwd: string, runs: ValidationRunRecord[]): Promise<void> {
  const path = getValidationRunsPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ version: 1, runs } satisfies ValidationRunIndex, null, 2)}\n`, "utf8");
}

async function writeValidationChecklistIndex(cwd: string, checklists: ValidationChecklistRecord[]): Promise<void> {
  const path = getValidationChecklistsPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  const sorted = [...checklists].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  await writeFile(path, `${JSON.stringify({ version: 1, checklists: sorted } satisfies ValidationChecklistIndex, null, 2)}\n`, "utf8");
}

async function executeCommand(
  cwd: string,
  command: string,
  timeoutMs?: number,
): Promise<{ exitCode: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, { cwd, shell: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let timeout: NodeJS.Timeout | undefined;

    const settle = (exitCode: number | null): void => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      resolve({ exitCode, stdout, stderr, timedOut });
    };

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => settle(code));

    if (timeoutMs && timeoutMs > 0) {
      timeout = setTimeout(() => {
        timedOut = true;
        stderr += `\nValidation command timed out after ${timeoutMs}ms.`;
        child.kill("SIGTERM");
        setTimeout(() => {
          if (!child.killed) child.kill("SIGKILL");
        }, 1_000).unref();
      }, timeoutMs);
    }
  });
}

function summarizeOutput(output: string, limit = 2_000): string {
  const normalized = output.trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit)}\n...[truncated ${normalized.length - limit} chars]`;
}

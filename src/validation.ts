/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { checkAttemptEvidence } from "./attempt-evidence.js";
import { fingerprintValidationPolicy } from "./attempt-identity.js";
import { captureValidationSnapshot, fingerprintValidationResult, verifyValidationRunReceipt, type ValidationReceipt, type ValidationSnapshot } from "./validation-acceptance.js";
import { fingerprintJson } from "./fingerprints.js";
import { fingerprintValidationInputs, normalizeOutputPaths, normalizeValidationInputPaths } from "./output-artifacts.js";
import { mkdir, open, readFile, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { prepareCicdValidationExecution } from "./cicd-environments.js";
import { evaluateValidationGitAcceptance, type GitValidationAcceptanceDecision } from "./git.js";
import { appendLogEvent, createLogEvent, logValidationSummaryAudit } from "./logging.js";
import { getValidationChecklistsPath, getValidationManifestsPath, getValidationRunsPath } from "./paths.js";
import { cleanupValidationEnvironment, prepareValidationEnvironment, type ValidationEnvironmentProbe } from "./validation-environments.js";
import { requestReplan } from "./replanning.js";
import { saveState } from "./state.js";
import { transitionTask } from "./supervisor.js";
import type { ScalerState, ScalerTaskStatus } from "./types.js";
import { setTimeout as delay } from "node:timers/promises";

export type ValidationStatus = "passed" | "failed" | "partial" | "blocked" | "not_applicable";
export type ValidationChecklistItemStatus = "passed" | "failed" | "blocked" | "not_applicable";
export type ValidationChecklistStatus = "passed" | "failed" | "blocked";
export type ValidationEnvironmentKind = "host" | "docker" | "compose" | "devcontainer" | "minikube" | "local_ci";
export type ValidationGateDisposition = "run" | "skipped" | "blocked";
export type ValidationPolicyAuthority = "system" | "model" | "user_command";

export interface ValidationPolicyWriteOptions {
  authority?: ValidationPolicyAuthority;
  reason?: string;
}

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
  environment?: ValidationEnvironmentKind | string;
  disposition?: ValidationGateDisposition | string;
  dispositionReason?: string;
}

export interface TaskValidationManifest {
  taskId: string;
  establishedAuthority?: ValidationPolicyAuthority;
  revision?: number;
  versionHistory?: ValidationPolicyVersion[];
  outputPaths?: string[];
  validationInputPaths?: string[];
  validationInputFingerprint?: string;
  definitionOfDone?: string[];
  acceptanceCriteria?: string[];
  qualityWaivers?: Array<{ code: string; reason: string; evidenceRefs?: string[]; approvedBy?: string }>;
  commands: ValidationCommandManifest[];
  createdAt: string;
  updatedAt: string;
}

export interface ValidationPolicyVersion {
  revision: number;
  reason: string;
  authority: "user_command";
  changedAt: string;
  policy: {
    outputPaths?: string[];
    validationInputPaths?: string[];
    validationInputFingerprint?: string;
    definitionOfDone?: string[];
    acceptanceCriteria?: string[];
    qualityWaivers?: TaskValidationManifest["qualityWaivers"];
    commands: ValidationCommandManifest[];
  };
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
  environment?: ValidationEnvironmentKind | string;
  disposition?: ValidationGateDisposition | string;
  dispositionReason?: string;
}

export type EmbeddedValidationManifestCommandInput = Omit<ValidationManifestCommandInput, "taskId"> & { taskId?: string };

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

export interface ValidationChecklistEvidencePolicy {
  enforced: boolean;
  missingEvidenceItemIds: string[];
  message?: string;
}

export interface ValidationChecklistRecord {
  id: string;
  taskId: string;
  gate?: ValidationGateKind;
  status: ValidationChecklistStatus;
  summary: string;
  items: ValidationChecklistItemRecord[];
  evidenceRefs?: string[];
  evidencePolicy?: ValidationChecklistEvidencePolicy;
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

export type ValidationCommandStatus = "passed" | "failed" | "timed_out" | "skipped" | "blocked";

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
  environment?: ValidationEnvironmentKind;
  disposition?: ValidationGateDisposition;
  dispositionReason?: string;
  environmentLifecycleRefs?: string[];
  cicdProvisionRef?: string;
  executionCommand?: string;
  artifactRefs?: string[];
}

export interface ValidationCommandRunOptions {
  taskId?: string;
  environmentProbe?: ValidationEnvironmentProbe;
}

export type ValidationManifestPolicySeverity = "warning" | "failure";

export interface ValidationManifestPolicyDiagnostic {
  severity: ValidationManifestPolicySeverity;
  code: string;
  message: string;
  commandId?: string;
  gate?: ValidationGateKind;
  environment?: ValidationEnvironmentKind;
}

export interface ValidationManifestPolicyResult {
  status: "passed" | "failed";
  diagnostics: ValidationManifestPolicyDiagnostic[];
}

export interface ValidationAcceptanceRecord {
  accepted: boolean;
  message: string;
  targetStatus?: ScalerTaskStatus;
  git?: GitValidationAcceptanceDecision;
}

export interface ValidationRunRecord {
  id: string;
  taskId: string;
  status: "passed" | "failed" | "blocked";
  commandRuns: ValidationCommandRunRecord[];
  policyDiagnostics?: ValidationManifestPolicyDiagnostic[];
  acceptance?: ValidationAcceptanceRecord;
  receipt?: ValidationReceipt;
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

const validationEnvironmentKinds = new Set<ValidationEnvironmentKind>(["host", "docker", "compose", "devcontainer", "minikube", "local_ci"]);
const validationGateDispositions = new Set<ValidationGateDisposition>(["run", "skipped", "blocked"]);

const validationEnvironmentAliases: Record<string, ValidationEnvironmentKind> = {
  host: "host",
  local: "host",
  native: "host",
  machine: "host",
  docker: "docker",
  container: "docker",
  containers: "docker",
  compose: "compose",
  docker_compose: "compose",
  dockercompose: "compose",
  docker_compose_v2: "compose",
  dockercomposev2: "compose",
  "docker-compose": "compose",
  devcontainer: "devcontainer",
  dev_container: "devcontainer",
  devcontainers: "devcontainer",
  "dev-container": "devcontainer",
  minikube: "minikube",
  k8s: "minikube",
  kubernetes: "minikube",
  ci: "local_ci",
  local_ci: "local_ci",
  localci: "local_ci",
  sandbox: "local_ci",
};

const validationGateDispositionAliases: Record<string, ValidationGateDisposition> = {
  run: "run",
  execute: "run",
  executed: "run",
  required: "run",
  skip: "skipped",
  skipped: "skipped",
  not_applicable: "skipped",
  notapplicable: "skipped",
  n_a: "skipped",
  "n/a": "skipped",
  na: "skipped",
  block: "blocked",
  blocked: "blocked",
};

const implementationValidationGates = new Set<ValidationGateKind>([
  "build_compile",
  "unit_tests",
  "integration_tests",
  "static_checks",
  "security_checks",
  "local_ci",
  "acceptance_smoke",
  "regression",
]);

const policyValidationGates = new Set<ValidationGateKind>(["dependency_check", "test_first"]);

const evidenceRequiredChecklistGates = new Set<ValidationGateKind>([
  "acceptance_smoke",
  "completeness",
  "compliance",
  "source_validation",
  "adversarial_review",
]);

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

export function isValidationEnvironmentKind(value: unknown): value is ValidationEnvironmentKind {
  return typeof value === "string" && validationEnvironmentKinds.has(value as ValidationEnvironmentKind);
}

export function isValidationGateDisposition(value: unknown): value is ValidationGateDisposition {
  return typeof value === "string" && validationGateDispositions.has(value as ValidationGateDisposition);
}

export function normalizeValidationEnvironmentKind(value: unknown): ValidationEnvironmentKind | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!normalized) return undefined;
  return validationEnvironmentAliases[normalized] ?? (isValidationEnvironmentKind(normalized) ? normalized : undefined);
}

export function normalizeValidationGateDisposition(value: unknown): ValidationGateDisposition | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!normalized) return undefined;
  return validationGateDispositionAliases[normalized] ?? (isValidationGateDisposition(normalized) ? normalized : undefined);
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
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Persisted validation manifest index is malformed: expected an object.");
    }
    if ((parsed as { version?: unknown }).version !== 1) {
      throw new Error("Persisted validation manifest index is malformed: version must be 1.");
    }
    const manifests = (parsed as { manifests?: unknown }).manifests;
    if (!Array.isArray(manifests)) {
      throw new Error("Persisted validation manifest index is malformed: manifests must be an array.");
    }
    return manifests.map((candidate, index) => assertValidationManifestShape(candidate, index));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function assertValidationManifestShape(
  candidate: unknown,
  index: number,
  source: "Persisted" | "Proposed" = "Persisted",
): TaskValidationManifest {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error(`${source} validation manifest at index ${index} is malformed: expected an object.`);
  }
  const taskId = (candidate as { taskId?: unknown }).taskId;
  if (typeof taskId !== "string" || !taskId.trim()) {
    throw new Error(`${source} validation manifest at index ${index} is malformed: taskId must be a non-empty string.`);
  }
  const revision = (candidate as { revision?: unknown }).revision;
  if (revision !== undefined && (!Number.isSafeInteger(revision) || (revision as number) < 1)) {
    throw new Error(`${source} validation manifest for ${taskId} is malformed: revision must be a positive safe integer.`);
  }
  const commands = (candidate as { commands?: unknown }).commands;
  if (!Array.isArray(commands)) {
    throw new Error(`${source} validation manifest for ${taskId} is malformed: commands must be an array.`);
  }
  for (const [commandIndex, command] of commands.entries()) {
    if (!command || typeof command !== "object" || Array.isArray(command)) {
      throw new Error(`${source} validation manifest for ${taskId} is malformed: commands[${commandIndex}] must be an object.`);
    }
    const persistedCommand = command as { id?: unknown; command?: unknown; required?: unknown };
    if (typeof persistedCommand.id !== "string" || !persistedCommand.id.trim()) {
      throw new Error(`${source} validation manifest for ${taskId} is malformed: commands[${commandIndex}].id must be a non-empty string.`);
    }
    if (typeof persistedCommand.command !== "string" || !persistedCommand.command.trim()) {
      throw new Error(`${source} validation manifest for ${taskId} is malformed: commands[${commandIndex}].command must be a non-empty string.`);
    }
    if (typeof persistedCommand.required !== "boolean") {
      throw new Error(`${source} validation manifest for ${taskId} is malformed: commands[${commandIndex}].required must be a boolean.`);
    }
  }
  return candidate as TaskValidationManifest;
}

function fingerprintPersistedValidationManifest(
  manifest: TaskValidationManifest,
  expectedTaskId: string,
): string {
  if (!Array.isArray(manifest.commands)) {
    throw new Error(`Persisted validation manifest for ${expectedTaskId} is malformed: commands must be an array.`);
  }
  try {
    return fingerprintValidationPolicy(manifest);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Persisted validation manifest for ${expectedTaskId} is malformed and cannot be fingerprinted: ${detail}`,
      { cause: error },
    );
  }
}

export async function saveValidationManifest(
  cwd: string,
  manifest: TaskValidationManifest,
  options: ValidationPolicyWriteOptions = {},
): Promise<TaskValidationManifest> {
  return withValidationPolicyLock(cwd, async () => {
    const manifests = await loadValidationManifests(cwd);
    const timestamp = new Date().toISOString();
    let normalized = assertValidationManifestShape(
      await normalizeValidationManifest(cwd, manifest, timestamp),
      0,
      "Proposed",
    );
    const persistedCurrent = manifests.find((candidate) => candidate.taskId === manifest.taskId);
    const current = persistedCurrent
      ?? await createDefaultValidationManifest(cwd, manifest.taskId);
    const currentFingerprint = persistedCurrent
      ? fingerprintPersistedValidationManifest(persistedCurrent, manifest.taskId)
      : fingerprintValidationPolicy(current);
    const changed = currentFingerprint !== fingerprintValidationPolicy(normalized);
    const exercised = changed && await hasValidationRunForTask(cwd, manifest.taskId);
    await assertValidationPolicyMutationAuthorized(cwd, normalized, options, manifests, normalized);
    const authorizedAmendment = changed && options.authority === "user_command" && (persistedCurrent !== undefined || exercised);
    if (authorizedAmendment) {
      const reason = options.reason?.trim();
      if (!reason) throw new Error(`Acceptance policy update rejected for ${manifest.taskId}: an explicit user-command reason is required.`);
      const currentRevision = current.revision ?? 1;
      const proposedRevision = normalized.revision ?? 1;
      if (proposedRevision !== currentRevision) {
        throw new Error(`Acceptance policy update rejected for ${manifest.taskId}: stale revision ${proposedRevision}; expected ${currentRevision}.`);
      }
      if (currentRevision === Number.MAX_SAFE_INTEGER) {
        throw new Error(`Acceptance policy update rejected for ${manifest.taskId}: revision ${currentRevision} cannot be incremented safely.`);
      }
      normalized = {
        ...normalized,
        revision: currentRevision + 1,
        versionHistory: [...(current.versionHistory ?? []), {
          revision: currentRevision,
          reason,
          authority: "user_command",
          changedAt: timestamp,
          policy: captureValidationPolicy(current),
        }],
      };
    }
    normalized = {
      ...normalized,
      establishedAuthority: persistedCurrent
        ? (changed
            ? (options.authority ?? "system")
            : (persistedCurrent.establishedAuthority ?? "system"))
        : (exercised
            ? (options.authority === "user_command" ? "user_command" : "system")
            : (options.authority ?? "system")),
    };
    const next = [normalized, ...manifests.filter((candidate) => candidate.taskId !== manifest.taskId)];
    await writeValidationManifestIndex(cwd, next);
    return normalized;
  });
}

async function normalizeValidationManifest(
  cwd: string,
  manifest: TaskValidationManifest,
  timestamp = new Date().toISOString(),
): Promise<TaskValidationManifest> {
  const validationInputPaths = normalizeValidationInputPaths(manifest.validationInputPaths);
  const validationInputFingerprint = await fingerprintValidationInputs(cwd, validationInputPaths);
  return {
    ...manifest,
    outputPaths: normalizeOutputPaths(manifest.outputPaths),
    validationInputPaths,
    validationInputFingerprint: validationInputFingerprint ?? undefined,
    definitionOfDone: normalizeStringList(manifest.definitionOfDone),
    acceptanceCriteria: normalizeStringList(manifest.acceptanceCriteria),
    qualityWaivers: normalizeValidationQualityWaivers(manifest.qualityWaivers),
    createdAt: manifest.createdAt || timestamp,
    updatedAt: timestamp,
    commands: manifest.commands.map((command, index) => ({
      ...command,
      id: command.id || `cmd-${index + 1}`,
      required: command.required,
      gate: normalizeValidationGateKind(command.gate),
      expectedResult: normalizeOptionalString(command.expectedResult),
      evidenceRefs: normalizeStringList(command.evidenceRefs),
      environment: normalizeValidationEnvironmentKind(command.environment),
      disposition: normalizeValidationGateDisposition(command.disposition) ?? "run",
      dispositionReason: normalizeOptionalString(command.dispositionReason),
    })),
  };
}

function captureValidationPolicy(manifest: TaskValidationManifest): ValidationPolicyVersion["policy"] {
  return JSON.parse(JSON.stringify({
    outputPaths: manifest.outputPaths,
    validationInputPaths: manifest.validationInputPaths,
    validationInputFingerprint: manifest.validationInputFingerprint,
    definitionOfDone: manifest.definitionOfDone,
    acceptanceCriteria: manifest.acceptanceCriteria,
    qualityWaivers: manifest.qualityWaivers,
    commands: manifest.commands,
  })) as ValidationPolicyVersion["policy"];
}

export async function hasValidationRunForTask(cwd: string, taskId: string): Promise<boolean> {
  return (await loadValidationRuns(cwd)).some((run) => run.taskId === taskId);
}

export async function assertValidationPolicyMutationAuthorized(
  cwd: string,
  proposed: TaskValidationManifest,
  options: ValidationPolicyWriteOptions = {},
  loadedManifests?: TaskValidationManifest[],
  normalizedProposed?: TaskValidationManifest,
): Promise<void> {
  if ((options.authority ?? "system") !== "model") return;
  const manifests = loadedManifests ?? await loadValidationManifests(cwd);
  const persistedCurrent = manifests.find((manifest) => manifest.taskId === proposed.taskId);
  const exercised = await hasValidationRunForTask(cwd, proposed.taskId);
  if (!persistedCurrent && !exercised) return;
  const current = persistedCurrent ?? await createDefaultValidationManifest(cwd, proposed.taskId);
  // saveValidationManifest passes the exact normalized snapshot it will write.
  // Re-reading executable inputs here would authorize one filesystem version
  // while persisting another if the validator changes between both hashes.
  const normalized = normalizedProposed ?? await normalizeValidationManifest(cwd, proposed);
  if (fingerprintValidationPolicy(current) === fingerprintValidationPolicy(normalized)) return;
  if (!exercised && current.establishedAuthority === "model") return;
  throw new Error(`Acceptance policy update rejected for ${proposed.taskId}: model routes cannot replace an established policy; use an explicit local user command with a recorded reason.`);
}

export async function upsertValidationManifestCommand(
  cwd: string,
  input: ValidationManifestCommandInput,
  options: ValidationPolicyWriteOptions = {},
): Promise<TaskValidationManifest> {
  return withValidationPolicyLock(cwd, async () => {
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
      environment: normalizeValidationEnvironmentKind(input.environment),
      disposition: normalizeValidationGateDisposition(input.disposition) ?? "run",
      dispositionReason: normalizeOptionalString(input.dispositionReason),
    };
    return saveValidationManifest(cwd, {
      ...base,
      commands: [command, ...base.commands.filter((candidate) => candidate.id !== input.id)],
    }, options);
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
    environment: "host",
    disposition: "run",
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
  const evidenceRefs = normalizeStringList(input.evidenceRefs);
  const gate = normalizeValidationGateKind(input.gate);
  const evidencePolicy = evaluateValidationChecklistEvidencePolicy(gate, items, evidenceRefs);
  const rolledUpStatus = rollupValidationChecklist(items);
  const status: ValidationChecklistStatus = rolledUpStatus === "passed" && evidencePolicy.missingEvidenceItemIds.length > 0 ? "failed" : rolledUpStatus;
  const record: ValidationChecklistRecord = {
    id: `${taskId}-checklist-${now.getTime()}`,
    taskId,
    gate,
    status,
    summary: normalizeOptionalString(input.summary) ?? `Validation checklist ${status}: ${taskId}`,
    items,
    evidenceRefs,
    evidencePolicy: evidencePolicy.enforced ? evidencePolicy : undefined,
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
  if (record.evidencePolicy?.missingEvidenceItemIds.length) {
    lines.push(`Evidence policy: missing=${record.evidencePolicy.missingEvidenceItemIds.join(",")}`);
  }
  for (const item of record.items) {
    lines.push(`- ${item.id} required=${item.required} status=${item.status}: ${item.statement}${item.evidenceRefs?.length ? ` evidence=${item.evidenceRefs.join(",")}` : ""}`);
  }
  return lines.join("\n");
}

export function evaluateValidationManifestPolicy(manifest: TaskValidationManifest): ValidationManifestPolicyResult {
  const commands = manifest.commands.map((command, index) => ({
    command,
    index,
    gate: normalizeValidationGateKind(command.gate),
    environment: normalizeValidationEnvironmentKind(command.environment),
    detectedEnvironment: detectValidationEnvironmentFromCommand(command.command),
    disposition: normalizeValidationGateDisposition(command.disposition) ?? "run",
    dispositionReason: normalizeOptionalString(command.dispositionReason),
  }));
  const diagnostics: ValidationManifestPolicyDiagnostic[] = [];
  const firstNonPolicy = commands.find((entry) => !entry.gate || !policyValidationGates.has(entry.gate));
  const firstImplementation = commands.find((entry) => entry.gate && implementationValidationGates.has(entry.gate));
  const hasImplementationGate = Boolean(firstImplementation);
  const hasDependencyGate = commands.some((entry) => entry.gate === "dependency_check");
  const hasTestFirstGate = commands.some((entry) => entry.gate === "test_first");

  if (hasImplementationGate && !hasDependencyGate) {
    diagnostics.push({
      severity: "warning",
      code: "missing_dependency_check",
      gate: "dependency_check",
      message: "Implementation validation gates have no dependency_check preflight command.",
    });
  }
  if (hasImplementationGate && !hasTestFirstGate) {
    diagnostics.push({
      severity: "warning",
      code: "missing_test_first",
      gate: "test_first",
      message: "Implementation validation gates have no test_first preflight command.",
    });
  }

  if (firstNonPolicy) {
    for (const entry of commands.filter((candidate) => candidate.gate === "dependency_check" && candidate.index > firstNonPolicy.index)) {
      diagnostics.push({
        severity: entry.command.required ? "failure" : "warning",
        code: entry.command.required ? "dependency_check_order" : "optional_dependency_check_order",
        commandId: entry.command.id,
        gate: "dependency_check",
        message: `dependency_check command ${entry.command.id} must run before non-policy validation command ${firstNonPolicy.command.id}.`,
      });
    }
  }

  if (firstImplementation) {
    for (const entry of commands.filter((candidate) => candidate.gate === "test_first" && candidate.index > firstImplementation.index)) {
      diagnostics.push({
        severity: entry.command.required ? "failure" : "warning",
        code: entry.command.required ? "test_first_order" : "optional_test_first_order",
        commandId: entry.command.id,
        gate: "test_first",
        message: `test_first command ${entry.command.id} must run before implementation validation command ${firstImplementation.command.id}.`,
      });
    }
  }

  for (const entry of commands) {
    const environment = entry.environment;
    const isHostEnvironment = !environment || environment === "host";
    if (entry.disposition === "skipped" && !entry.dispositionReason) {
      diagnostics.push({
        severity: entry.command.required ? "failure" : "warning",
        code: entry.command.required ? "required_skipped_gate_missing_reason" : "optional_skipped_gate_missing_reason",
        commandId: entry.command.id,
        gate: entry.gate,
        environment,
        message: `skipped validation command ${entry.command.id} must include an accepted skip reason${entry.command.required ? " because it is required" : ""}.`,
      });
    }
    if (entry.disposition === "blocked" && !entry.dispositionReason) {
      diagnostics.push({
        severity: "failure",
        code: "blocked_gate_missing_reason",
        commandId: entry.command.id,
        gate: entry.gate,
        environment,
        message: `blocked validation command ${entry.command.id} must include a blocker reason.`,
      });
    }
    if (entry.disposition !== "run") continue;

    if (entry.gate === "local_ci" && entry.command.required && isHostEnvironment) {
      diagnostics.push({
        severity: "failure",
        code: "local_ci_requires_environment",
        commandId: entry.command.id,
        gate: "local_ci",
        environment,
        message: `local_ci command ${entry.command.id} must declare docker, compose, devcontainer, minikube, or local_ci environment metadata before execution.`,
      });
    }
    if (entry.gate === "acceptance_smoke" && isHostEnvironment) {
      diagnostics.push({
        severity: "warning",
        code: "acceptance_smoke_host_environment",
        commandId: entry.command.id,
        gate: "acceptance_smoke",
        environment,
        message: `acceptance_smoke command ${entry.command.id} is configured for host execution; declare a sandbox environment when available.`,
      });
    }
    if (entry.detectedEnvironment && isHostEnvironment) {
      diagnostics.push({
        severity: entry.command.required ? "failure" : "warning",
        code: entry.command.required ? "sandbox_environment_missing" : "optional_sandbox_environment_missing",
        commandId: entry.command.id,
        gate: entry.gate,
        environment: entry.detectedEnvironment,
        message: `command ${entry.command.id} appears to invoke ${entry.detectedEnvironment} tooling but does not declare matching validation environment metadata.`,
      });
    }
  }

  return {
    status: diagnostics.some((diagnostic) => diagnostic.severity === "failure") ? "failed" : "passed",
    diagnostics,
  };
}

function detectValidationEnvironmentFromCommand(command: string): ValidationEnvironmentKind | undefined {
  const normalized = command.toLowerCase();
  if (/\bdocker\s+compose\b|\bdocker-compose\b/.test(normalized)) return "compose";
  if (/\bdevcontainer\b|\bdev-container\b/.test(normalized)) return "devcontainer";
  if (/\bminikube\b/.test(normalized)) return "minikube";
  if (/\bdocker\b/.test(normalized)) return "docker";
  return undefined;
}

function createValidationPolicyFailureRuns(diagnostics: ValidationManifestPolicyDiagnostic[]): ValidationCommandRunRecord[] {
  const failures = diagnostics.filter((diagnostic) => diagnostic.severity === "failure");
  const now = new Date();
  return failures.map((diagnostic, index) => ({
    id: `policy-${diagnostic.code}-${now.getTime()}-${index + 1}`,
    commandId: `policy-${diagnostic.code}`,
    command: "SCALER validation manifest policy preflight",
    status: "failed",
    exitCode: 1,
    stdoutSummary: diagnostic.message,
    stderrSummary: "",
    startedAt: now.toISOString(),
    finishedAt: now.toISOString(),
    required: true,
    description: "Validation manifest policy preflight failed before command execution.",
    gate: diagnostic.gate,
    expectedResult: "Validation manifest policy preflight must pass before command execution.",
    evidenceRefs: diagnostic.commandId ? [`manifest:${diagnostic.commandId}`] : undefined,
    environment: diagnostic.environment,
    disposition: "blocked",
    dispositionReason: diagnostic.message,
  }));
}

function createValidationDispositionRun(command: ValidationCommandManifest): ValidationCommandRunRecord | undefined {
  const disposition = normalizeValidationGateDisposition(command.disposition) ?? "run";
  if (disposition === "run") return undefined;
  const now = new Date();
  const reason = normalizeOptionalString(command.dispositionReason) ?? `${disposition} without reason`;
  return {
    id: `${command.id}-${disposition}-${now.getTime()}`,
    commandId: command.id,
    command: command.command,
    status: disposition === "blocked" ? "blocked" : "skipped",
    exitCode: null,
    stdoutSummary: reason,
    stderrSummary: "",
    startedAt: now.toISOString(),
    finishedAt: now.toISOString(),
    required: command.required,
    description: command.description,
    gate: normalizeValidationGateKind(command.gate),
    expectedResult: normalizeOptionalString(command.expectedResult),
    evidenceRefs: normalizeStringList(command.evidenceRefs),
    environment: normalizeValidationEnvironmentKind(command.environment),
    disposition,
    dispositionReason: reason,
  };
}

function getValidationRunStatus(commandRuns: ValidationCommandRunRecord[]): ValidationRunRecord["status"] {
  if (commandRuns.some((run) => run.required && run.status === "blocked")) return "blocked";
  if (commandRuns.some((run) => run.required && ["failed", "timed_out"].includes(run.status))) return "failed";
  return "passed";
}

function isNonPassingValidationProblem(run: ValidationCommandRunRecord): boolean {
  return ["failed", "timed_out", "blocked"].includes(run.status);
}

export async function runTaskValidation(cwd: string, state: ScalerState, taskId: string): Promise<ValidationRunRecord> {
  return withValidationPolicyLock(cwd, () => runTaskValidationLocked(cwd, state, taskId));
}

async function runTaskValidationLocked(cwd: string, state: ScalerState, taskId: string): Promise<ValidationRunRecord> {
  const freshness = await checkAttemptEvidence(cwd, state, taskId);
  if (freshness.length > 0) return rejectStaleValidation(cwd, state, taskId, freshness, []);
  let snapshot: ValidationSnapshot;
  try {
    snapshot = await captureValidationSnapshot(cwd, state, taskId);
  } catch (error) {
    return rejectStaleValidation(cwd, state, taskId, [`Validation evidence rejected: snapshot unavailable: ${String(error)}`], []);
  }
  const manifest = await getValidationManifestForTask(cwd, taskId);
  const policy = evaluateValidationManifestPolicy(manifest);
  const commandRuns: ValidationCommandRunRecord[] = [];
  if (policy.status === "failed") {
    commandRuns.push(...createValidationPolicyFailureRuns(policy.diagnostics));
  } else {
    for (const command of manifest.commands) {
      commandRuns.push((await runValidationCommandOrDisposition(cwd, command, { taskId })));
    }
  }

  const record: ValidationRunRecord = {
    id: `${taskId}-${Date.now()}`,
    taskId,
    status: getValidationRunStatus(commandRuns),
    commandRuns,
    policyDiagnostics: policy.diagnostics.length ? policy.diagnostics : undefined,
    createdAt: new Date().toISOString(),
  };
  record.receipt = { snapshot, resultFingerprint: fingerprintValidationResult(record) };
  // For passing evidence, the shared verifier captures the current snapshot and
  // compares it to the receipt; failed/blocked outcomes check freshness below.
  const finalFreshness = record.status === "passed"
    ? await verifyValidationRunReceipt(cwd, state, taskId, record)
    : await checkAttemptEvidence(cwd, state, taskId);
  if (record.status !== "passed") {
    try {
      if (fingerprintJson(snapshot) !== fingerprintJson(await captureValidationSnapshot(cwd, state, taskId))) {
        finalFreshness.push("Validation evidence rejected: task, policy, context or candidate output changed during checks.");
      }
    } catch (error) {
      finalFreshness.push(`Validation evidence rejected: snapshot unavailable after checks: ${String(error)}`);
    }
  }
  if (finalFreshness.length > 0) return rejectStaleValidation(cwd, state, taskId, finalFreshness, commandRuns);
  let result: ValidationApplyResult;
  let gitAcceptance: GitValidationAcceptanceDecision | undefined;
  if (record.status === "passed") {
    gitAcceptance = await evaluateValidationGitAcceptance(cwd, state, taskId, record);
    if (gitAcceptance.accepted) {
      result = await applyValidationOutcome(cwd, state, {
        taskId,
        status: record.status,
        summary: `Validation ${record.status}: ${taskId}`,
        details: { runId: record.id, commandRuns, gitAcceptance },
      }, "supervisor");
    } else {
      await appendLogEvent(cwd, createLogEvent(state, {
        eventType: "validation",
        summary: gitAcceptance.message,
        taskId,
        details: { runId: record.id, commandRuns, gitAcceptance },
      }));
      result = { state, accepted: false, message: gitAcceptance.message };
    }
  } else {
    result = await applyValidationReport(cwd, state, {
      taskId,
      status: record.status,
      summary: `Validation ${record.status}: ${taskId}`,
      details: { runId: record.id, commandRuns },
    });
  }
  record.acceptance = { accepted: result.accepted, message: result.message, targetStatus: result.targetStatus, git: gitAcceptance };
  await writeValidationRuns(cwd, [record, ...(await loadValidationRuns(cwd))]);
  await logValidationSummaryAudit(cwd, result.state, {
    taskId,
    runId: record.id,
    status: record.status,
    commandCount: commandRuns.length,
    failedCommandIds: commandRuns.filter(isNonPassingValidationProblem).map((run) => run.commandId),
    gates: commandRuns.map((run) => ({ commandId: run.commandId, gate: run.gate, required: run.required, status: run.status, disposition: run.disposition })),
    details: record,
  });
  return record;
}

async function rejectStaleValidation(cwd: string, state: ScalerState, taskId: string, diagnostics: string[], commandRuns: ValidationCommandRunRecord[]): Promise<ValidationRunRecord> {
  const record: ValidationRunRecord = {
    id: `${taskId}-stale-${Date.now()}`, taskId, status: "blocked", commandRuns,
    acceptance: { accepted: false, message: diagnostics.join(" ") },
    createdAt: new Date().toISOString(),
  };
  await writeValidationRuns(cwd, [record, ...(await loadValidationRuns(cwd))]);
  await appendLogEvent(cwd, createLogEvent(state, { eventType: "validation", taskId, summary: record.acceptance!.message, details: record }));
  return record;
}

export async function runValidationCommandSet(
  cwd: string,
  taskId: string,
  commands: ValidationCommandManifest[],
  idPrefix = "validation",
  options: Omit<ValidationCommandRunOptions, "taskId"> = {},
): Promise<ValidationRunRecord> {
  const commandRuns: ValidationCommandRunRecord[] = [];
  for (const command of commands) {
    commandRuns.push(await runValidationCommandOrDisposition(cwd, command, { ...options, taskId }));
  }
  const record: ValidationRunRecord = {
    id: `${taskId}-${idPrefix}-${Date.now()}`,
    taskId,
    status: getValidationRunStatus(commandRuns),
    commandRuns,
    createdAt: new Date().toISOString(),
  };
  await writeValidationRuns(cwd, [record, ...(await loadValidationRuns(cwd))]);
  return record;
}

async function runValidationCommandOrDisposition(
  cwd: string,
  command: ValidationCommandManifest,
  options: ValidationCommandRunOptions = {},
): Promise<ValidationCommandRunRecord> {
  return createValidationDispositionRun(command) ?? (await runValidationCommand(cwd, command, options));
}

export async function runValidationCommand(
  cwd: string,
  command: ValidationCommandManifest,
  options: ValidationCommandRunOptions = {},
): Promise<ValidationCommandRunRecord> {
  const environment = normalizeValidationEnvironmentKind(command.environment);
  const lifecycleRefs: string[] = [];
  if (environment && environment !== "host") {
    const preparation = await prepareValidationEnvironment(cwd, environment, {
      taskId: options.taskId,
      commandId: command.id,
      probe: options.environmentProbe,
    });
    lifecycleRefs.push(preparation.prepareRecord.id);
    if (!preparation.prepared) {
      const now = new Date();
      return {
        id: `${command.id}-environment-blocked-${now.getTime()}`,
        commandId: command.id,
        command: command.command,
        status: "blocked",
        exitCode: null,
        stdoutSummary: preparation.blockedReason ?? `Validation environment ${environment} unavailable.`,
        stderrSummary: "",
        startedAt: now.toISOString(),
        finishedAt: now.toISOString(),
        required: command.required,
        description: command.description,
        gate: normalizeValidationGateKind(command.gate),
        expectedResult: normalizeOptionalString(command.expectedResult),
        evidenceRefs: normalizeStringList(command.evidenceRefs),
        environment,
        disposition: "blocked",
        dispositionReason: preparation.blockedReason,
        environmentLifecycleRefs: lifecycleRefs,
      };
    }
  }

  let executionCommand = command.command;
  let cicdProvisionRef: string | undefined;
  let artifactRefs: string[] | undefined;
  if (environment && environment !== "host") {
    try {
      const cicd = await prepareCicdValidationExecution(cwd, {
        environment,
        taskId: options.taskId,
        commandId: command.id,
        command: command.command,
      });
      executionCommand = cicd.executionCommand;
      cicdProvisionRef = cicd.record.id;
      artifactRefs = cicd.artifactRefs;
    } catch (error) {
      const now = new Date();
      const message = error instanceof Error ? error.message : String(error);
      const cleanup = await cleanupValidationEnvironment(cwd, environment, {
        taskId: options.taskId,
        commandId: command.id,
        probe: options.environmentProbe,
      });
      lifecycleRefs.push(cleanup.id);
      return {
        id: `${command.id}-cicd-blocked-${now.getTime()}`,
        commandId: command.id,
        command: command.command,
        status: "blocked",
        exitCode: null,
        stdoutSummary: message,
        stderrSummary: "",
        startedAt: now.toISOString(),
        finishedAt: now.toISOString(),
        required: command.required,
        description: command.description,
        gate: normalizeValidationGateKind(command.gate),
        expectedResult: normalizeOptionalString(command.expectedResult),
        evidenceRefs: normalizeStringList(command.evidenceRefs),
        environment,
        disposition: "blocked",
        dispositionReason: message,
        environmentLifecycleRefs: lifecycleRefs,
      };
    }
  }

  const startedAt = new Date();
  const result = await executeCommand(cwd, executionCommand, command.timeoutMs);
  const finishedAt = new Date();
  const status: ValidationCommandStatus = result.timedOut ? "timed_out" : result.exitCode === 0 ? "passed" : "failed";
  if (environment && environment !== "host") {
    const cleanup = await cleanupValidationEnvironment(cwd, environment, {
      taskId: options.taskId,
      commandId: command.id,
      probe: options.environmentProbe,
    });
    lifecycleRefs.push(cleanup.id);
  }
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
    environment,
    disposition: normalizeValidationGateDisposition(command.disposition) ?? "run",
    dispositionReason: normalizeOptionalString(command.dispositionReason),
    environmentLifecycleRefs: lifecycleRefs.length ? lifecycleRefs : undefined,
    cicdProvisionRef,
    executionCommand: executionCommand === command.command ? undefined : executionCommand,
    artifactRefs,
  };
}

export async function applyValidationReport(
  cwd: string,
  state: ScalerState,
  report: ValidationReportInput,
): Promise<ValidationApplyResult> {
  return applyValidationOutcome(cwd, state, report, "manual");
}

// Positive outcomes enter only from runTaskValidation after receipt and Git
// acceptance checks. Never expose a caller-supplied trusted flag for this path.
async function applyValidationOutcome(
  cwd: string,
  state: ScalerState,
  report: ValidationReportInput,
  source: "manual" | "supervisor",
): Promise<ValidationApplyResult> {
  if (!isValidationStatus(report.status)) {
    return logAndReturn(cwd, state, report, false, `Validation rejected: invalid status ${String(report.status)}`);
  }

  const task = state.tasks.find((candidate) => candidate.id === report.taskId);
  if (!task) {
    return logAndReturn(cwd, state, report, false, `Validation rejected: task ${report.taskId} does not exist`);
  }

  const freshness = await checkAttemptEvidence(cwd, state, report.taskId);
  if (freshness.length > 0) return logAndReturn(cwd, state, report, false, freshness.join(" "));

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

  if (source === "manual" && targetStatus === "validated") {
    return logAndReturn(cwd, state, report, false,
      "Validation proposal recorded without task acceptance: positive manual claims require independent supervisor verification; report fields and evidence-reference strings are not authority.");
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

function normalizeValidationQualityWaivers(value: TaskValidationManifest["qualityWaivers"]): TaskValidationManifest["qualityWaivers"] {
  const waivers = (value ?? [])
    .map((waiver) => ({
      code: waiver.code.trim(),
      reason: waiver.reason.trim(),
      evidenceRefs: normalizeStringList(waiver.evidenceRefs),
      approvedBy: normalizeOptionalString(waiver.approvedBy),
    }))
    .filter((waiver) => waiver.code.length > 0 && waiver.reason.length > 0);
  return waivers.length > 0 ? waivers : undefined;
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

function evaluateValidationChecklistEvidencePolicy(
  gate: ValidationGateKind | undefined,
  items: ValidationChecklistItemRecord[],
  checklistEvidenceRefs: string[] | undefined,
): ValidationChecklistEvidencePolicy {
  const enforced = Boolean(gate && evidenceRequiredChecklistGates.has(gate));
  if (!enforced) return { enforced: false, missingEvidenceItemIds: [] };
  const hasChecklistEvidence = Boolean(checklistEvidenceRefs?.length);
  const missingEvidenceItemIds = items
    .filter((item) => item.required && item.status === "passed" && !hasChecklistEvidence && !item.evidenceRefs?.length)
    .map((item) => item.id);
  return {
    enforced: true,
    missingEvidenceItemIds,
    message: missingEvidenceItemIds.length > 0
      ? `Required passed checklist items need evidence: ${missingEvidenceItemIds.join(", ")}`
      : "Required passed checklist items have evidence.",
  };
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
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(`${JSON.stringify({ version: 1, manifests } satisfies ValidationManifestIndex, null, 2)}\n`, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

interface ValidationPolicyLockOwner {
  active: boolean;
}

const validationPolicyLockContext = new AsyncLocalStorage<ReadonlyMap<string, ValidationPolicyLockOwner>>();

export async function withValidationPolicyLock<T>(cwd: string, fn: () => Promise<T>): Promise<T> {
  const manifestPath = getValidationManifestsPath(cwd);
  await mkdir(dirname(manifestPath), { recursive: true });
  const lockPath = `${manifestPath}.lock`;
  const heldLocks = validationPolicyLockContext.getStore();
  if (heldLocks?.get(lockPath)?.active) return fn();
  let acquired = false;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      await mkdir(lockPath);
      acquired = true;
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await delay(10);
    }
  }
  if (!acquired) throw new Error("Validation policy is locked by another active operation; retry after it finishes.");
  const owner: ValidationPolicyLockOwner = { active: true };
  const context = new Map(heldLocks ?? []);
  context.set(lockPath, owner);
  try {
    return await validationPolicyLockContext.run(context, fn);
  } finally {
    owner.active = false;
    await releaseValidationPolicyLock(lockPath);
  }
}

async function releaseValidationPolicyLock(lockPath: string): Promise<void> {
  let releaseError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await rmdir(lockPath);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      releaseError = error;
      if (attempt < 2) await delay(10);
    }
  }
  process.emitWarning(`Validation policy lock could not be released: ${lockPath}. Reconcile the active owner before retrying policy effects. ${String(releaseError)}`, {
    code: "SCALER_VALIDATION_POLICY_LOCK_RELEASE_FAILED",
  });
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

import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";
import { getSafetyApprovalsPath, getSafetyPolicyPath, getSafetyScansPath } from "./paths.js";

const execFileAsync = promisify(execFile);

export type SafetyRiskLevel = "low" | "medium" | "high" | "destructive" | "external" | "secret";
export type SafetyApprovalRisk = SafetyRiskLevel | "any";
export type SafetyApprovalMatch = "exact_command" | "target" | "tool";
export type SafetyApprovalStatus = "active" | "used" | "revoked" | "expired";
export type SafetyScanStatus = "planned" | "passed" | "failed" | "unavailable" | "skipped";
export type SafetyScannerKind = "npm_audit" | "pnpm_audit" | "yarn_audit" | "pip_audit" | "cargo_audit" | "trivy_fs" | "grype_fs";

export interface SafetyDecision {
  allowed: boolean;
  risk: SafetyRiskLevel;
  reason: string;
  requiresApproval: boolean;
}

export interface ToolCallLike {
  toolName: string;
  input: Record<string, unknown>;
}

export interface SafetyPolicy {
  allowedPathPrefixes?: string[];
  allowInternet?: boolean;
  allowExternalMutations?: boolean;
  allowSandbox?: boolean;
}

export interface PersistedSafetyPolicy {
  version: 1;
  allowInternet: boolean;
  allowExternalMutations: boolean;
  allowSandbox: boolean;
  updatedAt: string;
}

export interface SafetyPolicyUpdate {
  allowInternet?: boolean;
  allowExternalMutations?: boolean;
  allowSandbox?: boolean;
  now?: Date;
}

export interface SafetyApproval {
  version: 1;
  id: string;
  status: SafetyApprovalStatus;
  toolName?: string;
  match: SafetyApprovalMatch;
  value?: string;
  risk: SafetyApprovalRisk;
  reason: string;
  sandboxOnly: boolean;
  maxUses: number;
  uses: number;
  createdAt: string;
  expiresAt?: string;
  usedAt?: string;
  revokedAt?: string;
  revokedReason?: string;
}

export interface SafetyApprovalInput {
  toolName?: string;
  match?: string;
  value?: string;
  risk?: string;
  reason?: string;
  sandboxOnly?: boolean;
  maxUses?: number;
  ttlMinutes?: number;
  now?: Date;
}

export interface SafetyApprovalApplication {
  allowed: boolean;
  approval?: SafetyApproval;
  reason: string;
}

export interface SafetyScanCandidate {
  kind: SafetyScannerKind;
  command: string[];
  reason: string;
  evidenceFiles: string[];
}

export interface SafetyScanRecord {
  version: 1;
  id: string;
  kind: SafetyScannerKind;
  command: string[];
  status: SafetyScanStatus;
  reason: string;
  available: boolean;
  startedAt: string;
  finishedAt: string;
  exitCode?: number;
  stdoutSnippet?: string;
  stderrSnippet?: string;
  message: string;
}

export interface SafetyScanRunOptions {
  execute?: boolean;
  kinds?: string[];
  now?: Date;
  isCommandAvailable?: (command: string, cwd: string) => Promise<boolean>;
  commandRunner?: (command: string, args: string[], cwd: string) => Promise<{ exitCode: number; stdout?: string; stderr?: string }>;
}

export interface SafetyScanResult {
  executed: boolean;
  candidates: SafetyScanCandidate[];
  records: SafetyScanRecord[];
  summary: Record<SafetyScanStatus, number>;
}

export async function loadSafetyPolicy(cwd: string): Promise<PersistedSafetyPolicy> {
  try {
    return normalizePersistedSafetyPolicy(JSON.parse(await readFile(getSafetyPolicyPath(cwd), "utf8")) as Partial<PersistedSafetyPolicy>);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return createDefaultSafetyPolicy();
    throw error;
  }
}

export async function saveSafetyPolicy(cwd: string, update: SafetyPolicyUpdate): Promise<PersistedSafetyPolicy> {
  const current = await loadSafetyPolicy(cwd);
  const next: PersistedSafetyPolicy = {
    version: 1,
    allowInternet: update.allowInternet ?? current.allowInternet,
    allowExternalMutations: update.allowExternalMutations ?? current.allowExternalMutations,
    allowSandbox: update.allowSandbox ?? current.allowSandbox,
    updatedAt: (update.now ?? new Date()).toISOString(),
  };
  const path = getSafetyPolicyPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

export function mergeSafetyPolicy(persisted: PersistedSafetyPolicy, policy: SafetyPolicy = {}): SafetyPolicy {
  return {
    allowedPathPrefixes: policy.allowedPathPrefixes,
    allowInternet: policy.allowInternet ?? persisted.allowInternet,
    allowExternalMutations: policy.allowExternalMutations ?? persisted.allowExternalMutations,
    allowSandbox: policy.allowSandbox ?? persisted.allowSandbox,
  };
}

export function formatSafetyPolicy(policy: PersistedSafetyPolicy): string {
  return `Safety policy: allowInternet=${policy.allowInternet} allowExternalMutations=${policy.allowExternalMutations} allowSandbox=${policy.allowSandbox} updatedAt=${policy.updatedAt}`;
}

export async function loadSafetyApprovals(cwd: string): Promise<SafetyApproval[]> {
  try {
    const parsed = JSON.parse(await readFile(getSafetyApprovalsPath(cwd), "utf8")) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeSafetyApproval).filter((approval): approval is SafetyApproval => Boolean(approval));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function saveSafetyApprovals(cwd: string, approvals: SafetyApproval[]): Promise<void> {
  const path = getSafetyApprovalsPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(approvals, null, 2)}\n`, "utf8");
}

export async function createSafetyApproval(cwd: string, input: SafetyApprovalInput): Promise<SafetyApproval> {
  const now = input.now ?? new Date();
  const match = normalizeSafetyApprovalMatch(input.match) ?? "exact_command";
  const risk = normalizeSafetyApprovalRisk(input.risk) ?? "any";
  const maxUses = input.maxUses && Number.isFinite(input.maxUses) && input.maxUses > 0 ? Math.floor(input.maxUses) : 1;
  const approval: SafetyApproval = {
    version: 1,
    id: createSafetyApprovalId(now, input.toolName, risk),
    status: "active",
    toolName: normalizeOptionalString(input.toolName),
    match,
    value: normalizeOptionalString(input.value),
    risk,
    reason: normalizeOptionalString(input.reason) ?? "Manual safety approval.",
    sandboxOnly: input.sandboxOnly === true,
    maxUses,
    uses: 0,
    createdAt: now.toISOString(),
    expiresAt: input.ttlMinutes && Number.isFinite(input.ttlMinutes) && input.ttlMinutes > 0
      ? new Date(now.getTime() + Math.floor(input.ttlMinutes) * 60_000).toISOString()
      : undefined,
  };
  const approvals = await loadSafetyApprovals(cwd);
  approvals.push(approval);
  await saveSafetyApprovals(cwd, approvals);
  return approval;
}

export async function revokeSafetyApproval(cwd: string, id: string, reason?: string, now: Date = new Date()): Promise<SafetyApproval | undefined> {
  const approvals = await loadSafetyApprovals(cwd);
  const index = approvals.findIndex((approval) => approval.id === id);
  if (index < 0) return undefined;
  const approval = approvals[index];
  const next: SafetyApproval = {
    ...approval,
    status: "revoked",
    revokedAt: now.toISOString(),
    revokedReason: reason?.trim() || "Manual revocation.",
  };
  approvals[index] = next;
  await saveSafetyApprovals(cwd, approvals);
  return next;
}

export async function applySafetyApproval(
  cwd: string,
  toolCall: ToolCallLike,
  decision: SafetyDecision,
  options: { now?: Date } = {},
): Promise<SafetyApprovalApplication> {
  if (decision.allowed) return { allowed: true, reason: decision.reason };
  if (decision.risk === "secret") {
    return { allowed: false, reason: "Secret/protected-path decisions are not overridden by safety approvals." };
  }
  const now = options.now ?? new Date();
  const approvals = await loadSafetyApprovals(cwd);
  const match = approvals.find((approval) => safetyApprovalMatches(approval, toolCall, decision, now));
  if (!match) return { allowed: false, reason: "No matching active safety approval." };

  const nextApprovals = approvals.map((approval) => {
    if (approval.id !== match.id) return maybeExpireSafetyApproval(approval, now);
    const uses = approval.uses + 1;
    return {
      ...approval,
      uses,
      usedAt: now.toISOString(),
      status: uses >= approval.maxUses ? "used" as const : "active" as const,
    };
  });
  await saveSafetyApprovals(cwd, nextApprovals);
  const updated = nextApprovals.find((approval) => approval.id === match.id) ?? match;
  return { allowed: true, approval: updated, reason: `Allowed by safety approval ${updated.id}.` };
}

export function formatSafetyApprovals(approvals: SafetyApproval[], limit = 20): string {
  const sorted = [...approvals].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const lines = [`Safety approvals: records=${approvals.length} showing=${Math.min(limit, sorted.length)}`];
  for (const approval of sorted.slice(0, limit)) {
    lines.push(`- ${approval.id} status=${approval.status} risk=${approval.risk} tool=${approval.toolName ?? "*"} match=${approval.match} value=${approval.value ?? "*"} uses=${approval.uses}/${approval.maxUses} sandboxOnly=${approval.sandboxOnly} reason=${approval.reason}`);
  }
  return lines.join("\n");
}

export async function discoverSafetyScanCandidates(cwd: string, kinds?: string[]): Promise<SafetyScanCandidate[]> {
  const kindFilter = new Set((kinds ?? []).map((kind) => kind.trim().toLowerCase()).filter(Boolean));
  const definitions: SafetyScanCandidate[] = [
    { kind: "npm_audit", command: ["npm", "audit", "--audit-level=moderate", "--json"], reason: "package-lock.json present", evidenceFiles: ["package-lock.json"] },
    { kind: "pnpm_audit", command: ["pnpm", "audit", "--json"], reason: "pnpm-lock.yaml present", evidenceFiles: ["pnpm-lock.yaml"] },
    { kind: "yarn_audit", command: ["yarn", "npm", "audit", "--json"], reason: "yarn.lock present", evidenceFiles: ["yarn.lock"] },
    { kind: "pip_audit", command: ["pip-audit", "-f", "json"], reason: "Python dependency manifest present", evidenceFiles: ["requirements.txt", "pyproject.toml"] },
    { kind: "cargo_audit", command: ["cargo", "audit", "--json"], reason: "Cargo.lock present", evidenceFiles: ["Cargo.lock"] },
    { kind: "trivy_fs", command: ["trivy", "fs", "--scanners", "vuln", "--format", "json", "."], reason: "Dockerfile present", evidenceFiles: ["Dockerfile"] },
    { kind: "grype_fs", command: ["grype", "dir:.", "-o", "json"], reason: "Dockerfile present", evidenceFiles: ["Dockerfile"] },
  ];

  const candidates: SafetyScanCandidate[] = [];
  for (const definition of definitions) {
    if (kindFilter.size > 0 && !kindFilter.has(definition.kind)) continue;
    if (await anyEvidenceFileExists(cwd, definition.evidenceFiles)) candidates.push(definition);
  }
  return candidates;
}

export async function loadSafetyScanRecords(cwd: string): Promise<SafetyScanRecord[]> {
  try {
    const parsed = JSON.parse(await readFile(getSafetyScansPath(cwd), "utf8")) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeSafetyScanRecord).filter((record): record is SafetyScanRecord => Boolean(record));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function saveSafetyScanRecords(cwd: string, records: SafetyScanRecord[]): Promise<void> {
  const path = getSafetyScansPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(records, null, 2)}\n`, "utf8");
}

export async function runSafetyScans(cwd: string, options: SafetyScanRunOptions = {}): Promise<SafetyScanResult> {
  const execute = options.execute === true;
  const now = options.now ?? new Date();
  const candidates = await discoverSafetyScanCandidates(cwd, options.kinds);
  const isCommandAvailable = options.isCommandAvailable ?? defaultCommandAvailable;
  const commandRunner = options.commandRunner ?? defaultCommandRunner;
  const records: SafetyScanRecord[] = [];

  for (const candidate of candidates) {
    const startedAt = now.toISOString();
    const available = await isCommandAvailable(candidate.command[0] ?? "", cwd);
    if (!available) {
      records.push(createSafetyScanRecord(candidate, {
        available,
        startedAt,
        finishedAt: new Date().toISOString(),
        status: "unavailable",
        message: `${candidate.command[0]} is not available; scanner limitation recorded.`,
      }));
      continue;
    }
    if (!execute) {
      records.push(createSafetyScanRecord(candidate, {
        available,
        startedAt,
        finishedAt: new Date().toISOString(),
        status: "planned",
        message: "Scanner candidate recorded; pass execute to run it.",
      }));
      continue;
    }

    const result = await commandRunner(candidate.command[0] ?? "", candidate.command.slice(1), cwd);
    records.push(createSafetyScanRecord(candidate, {
      available,
      startedAt,
      finishedAt: new Date().toISOString(),
      status: result.exitCode === 0 ? "passed" : "failed",
      exitCode: result.exitCode,
      stdoutSnippet: truncateSnippet(result.stdout),
      stderrSnippet: truncateSnippet(result.stderr),
      message: result.exitCode === 0 ? "Scanner exited successfully." : `Scanner exited with code ${result.exitCode}.`,
    }));
  }

  const previous = await loadSafetyScanRecords(cwd);
  await saveSafetyScanRecords(cwd, [...previous, ...records]);
  return { executed: execute, candidates, records, summary: summarizeSafetyScanRecords(records) };
}

export function formatSafetyScanResult(result: SafetyScanResult): string {
  const lines = [
    `Safety scans: executed=${result.executed} candidates=${result.candidates.length} records=${result.records.length} planned=${result.summary.planned} passed=${result.summary.passed} failed=${result.summary.failed} unavailable=${result.summary.unavailable} skipped=${result.summary.skipped}`,
  ];
  if (result.records.length === 0) {
    lines.push("No dependency or image scanner candidates were discovered.");
  }
  for (const record of result.records) {
    lines.push(`- ${record.status} ${record.kind} command=${record.command.join(" ")} available=${record.available} message=${record.message}`);
  }
  return lines.join("\n");
}

export function formatSafetyScanRecords(records: SafetyScanRecord[], limit = 20): string {
  const sorted = [...records].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const lines = [`Safety scan records: records=${records.length} showing=${Math.min(limit, sorted.length)}`];
  for (const record of sorted.slice(0, limit)) {
    lines.push(`- ${record.startedAt} ${record.status} ${record.kind} command=${record.command.join(" ")} message=${record.message}`);
  }
  return lines.join("\n");
}

export function assessToolCallSafety(toolCall: ToolCallLike, policy: SafetyPolicy = {}): SafetyDecision {
  if ((toolCall.toolName === "write" || toolCall.toolName === "edit") && hasProtectedPath(toolCall.input)) {
    return {
      allowed: false,
      risk: "secret",
      reason: "Write/edit targets a protected path.",
      requiresApproval: true,
    };
  }

  if ((toolCall.toolName === "write" || toolCall.toolName === "edit") && !isAllowedPathTarget(toolCall.input, policy.allowedPathPrefixes)) {
    return {
      allowed: false,
      risk: "medium",
      reason: "Write/edit target is outside the current task allowed paths.",
      requiresApproval: true,
    };
  }

  if (toolCall.toolName === "bash") {
    const command = getCommand(toolCall.input);
    if (command && protectedCommandPathPatterns.some((pattern) => pattern.test(command))) {
      return {
        allowed: false,
        risk: "secret",
        reason: "Bash command references a protected path.",
        requiresApproval: true,
      };
    }

    if (command && secretEnvironmentExposurePatterns.some((pattern) => pattern.test(command))) {
      return {
        allowed: false,
        risk: "secret",
        reason: "Bash command may expose secret environment variables.",
        requiresApproval: true,
      };
    }

    if (command && destructiveCommandPatterns.some((pattern) => pattern.test(command))) {
      if (policy.allowSandbox && isAllowedSandboxExceptionCommand(command)) {
        return {
          allowed: true,
          risk: "medium",
          reason: "Sandbox policy allows contained destructive command inside an approved sandbox boundary.",
          requiresApproval: false,
        };
      }
      return {
        allowed: false,
        risk: "destructive",
        reason: "Bash command matches a destructive or high-risk pattern.",
        requiresApproval: true,
      };
    }

    if (command && !policy.allowExternalMutations && externalMutationCommandPatterns.some((pattern) => pattern.test(command))) {
      return {
        allowed: false,
        risk: "external",
        reason: "Bash command may mutate remote or published external systems.",
        requiresApproval: true,
      };
    }

    if (command && !policy.allowInternet && internetTransferCommandPatterns.some((pattern) => pattern.test(command))) {
      return {
        allowed: false,
        risk: "external",
        reason: "Bash command may transmit data over the internet.",
        requiresApproval: true,
      };
    }
  }

  return {
    allowed: true,
    risk: "low",
    reason: "No safety rule matched.",
    requiresApproval: false,
  };
}

export function shouldBlockWithoutApproval(decision: SafetyDecision): boolean {
  return !decision.allowed && decision.requiresApproval;
}

export function getToolCallTarget(input: Record<string, unknown>): string | undefined {
  const value = input.path ?? input.file_path ?? input.command;
  return typeof value === "string" ? value : undefined;
}

export function isAllowedSandboxExceptionCommand(command: string): boolean {
  if (!sandboxCommandPatterns.some((pattern) => pattern.test(command))) return false;
  if (unsafeSandboxCommandPatterns.some((pattern) => pattern.test(command))) return false;
  if (protectedCommandPathPatterns.some((pattern) => pattern.test(command))) return false;
  if (secretEnvironmentExposurePatterns.some((pattern) => pattern.test(command))) return false;
  if (externalMutationCommandPatterns.some((pattern) => pattern.test(command))) return false;
  if (internetTransferCommandPatterns.some((pattern) => pattern.test(command))) return false;
  return true;
}

function createDefaultSafetyPolicy(): PersistedSafetyPolicy {
  return { version: 1, allowInternet: false, allowExternalMutations: false, allowSandbox: false, updatedAt: "" };
}

function normalizePersistedSafetyPolicy(value: Partial<PersistedSafetyPolicy>): PersistedSafetyPolicy {
  return {
    version: 1,
    allowInternet: value.allowInternet === true,
    allowExternalMutations: value.allowExternalMutations === true,
    allowSandbox: value.allowSandbox === true,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "",
  };
}

function normalizeSafetyApproval(value: unknown): SafetyApproval | undefined {
  if (!isRecord(value)) return undefined;
  const id = normalizeOptionalString(value.id);
  const match = normalizeSafetyApprovalMatch(value.match);
  const risk = normalizeSafetyApprovalRisk(value.risk);
  const createdAt = normalizeOptionalString(value.createdAt);
  if (!id || !match || !risk || !createdAt) return undefined;
  const status = normalizeSafetyApprovalStatus(value.status) ?? "active";
  return {
    version: 1,
    id,
    status,
    toolName: normalizeOptionalString(value.toolName),
    match,
    value: normalizeOptionalString(value.value),
    risk,
    reason: normalizeOptionalString(value.reason) ?? "Manual safety approval.",
    sandboxOnly: value.sandboxOnly === true,
    maxUses: typeof value.maxUses === "number" && Number.isFinite(value.maxUses) && value.maxUses > 0 ? Math.floor(value.maxUses) : 1,
    uses: typeof value.uses === "number" && Number.isFinite(value.uses) && value.uses >= 0 ? Math.floor(value.uses) : 0,
    createdAt,
    expiresAt: normalizeOptionalString(value.expiresAt),
    usedAt: normalizeOptionalString(value.usedAt),
    revokedAt: normalizeOptionalString(value.revokedAt),
    revokedReason: normalizeOptionalString(value.revokedReason),
  };
}

function normalizeSafetyApprovalStatus(value: unknown): SafetyApprovalStatus | undefined {
  return value === "active" || value === "used" || value === "revoked" || value === "expired" ? value : undefined;
}

function normalizeSafetyApprovalMatch(value: unknown): SafetyApprovalMatch | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase().replace(/-/g, "_");
  if (normalized === "exact" || normalized === "exact_command" || normalized === "command") return "exact_command";
  if (normalized === "target" || normalized === "path") return "target";
  if (normalized === "tool") return "tool";
  return undefined;
}

function normalizeSafetyApprovalRisk(value: unknown): SafetyApprovalRisk | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "any") return "any";
  if (["low", "medium", "high", "destructive", "external", "secret"].includes(normalized)) return normalized as SafetyRiskLevel;
  return undefined;
}

function safetyApprovalMatches(approval: SafetyApproval, toolCall: ToolCallLike, decision: SafetyDecision, now: Date): boolean {
  const current = maybeExpireSafetyApproval(approval, now);
  if (current.status !== "active") return false;
  if (current.uses >= current.maxUses) return false;
  if (current.risk !== "any" && current.risk !== decision.risk) return false;
  if (current.toolName && current.toolName !== toolCall.toolName) return false;
  if (current.sandboxOnly && (!getCommand(toolCall.input) || !isAllowedSandboxExceptionCommand(getCommand(toolCall.input) ?? ""))) return false;
  if (current.match === "tool") return Boolean(current.toolName) && current.toolName === toolCall.toolName;
  if (current.match === "exact_command") return toolCall.toolName === "bash" && Boolean(current.value) && getCommand(toolCall.input) === current.value;
  if (current.match === "target") return Boolean(current.value) && normalizePath(getToolCallTarget(toolCall.input)) === normalizePath(current.value);
  return false;
}

function maybeExpireSafetyApproval(approval: SafetyApproval, now: Date): SafetyApproval {
  if (approval.status !== "active" || !approval.expiresAt) return approval;
  const expiresAt = Date.parse(approval.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt > now.getTime()) return approval;
  return { ...approval, status: "expired" };
}

function createSafetyApprovalId(now: Date, toolName: string | undefined, risk: SafetyApprovalRisk): string {
  return `approval-${now.getTime()}-${slugify(toolName ?? "any")}-${risk}`;
}

function normalizeSafetyScanRecord(value: unknown): SafetyScanRecord | undefined {
  if (!isRecord(value)) return undefined;
  const id = normalizeOptionalString(value.id);
  const kind = normalizeSafetyScannerKind(value.kind);
  const command = Array.isArray(value.command) ? value.command.filter((part): part is string => typeof part === "string") : [];
  const status = normalizeSafetyScanStatus(value.status);
  const startedAt = normalizeOptionalString(value.startedAt);
  const finishedAt = normalizeOptionalString(value.finishedAt);
  if (!id || !kind || command.length === 0 || !status || !startedAt || !finishedAt) return undefined;
  return {
    version: 1,
    id,
    kind,
    command,
    status,
    reason: normalizeOptionalString(value.reason) ?? "",
    available: value.available === true,
    startedAt,
    finishedAt,
    exitCode: typeof value.exitCode === "number" && Number.isFinite(value.exitCode) ? value.exitCode : undefined,
    stdoutSnippet: normalizeOptionalString(value.stdoutSnippet),
    stderrSnippet: normalizeOptionalString(value.stderrSnippet),
    message: normalizeOptionalString(value.message) ?? "",
  };
}

function normalizeSafetyScannerKind(value: unknown): SafetyScannerKind | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (["npm_audit", "pnpm_audit", "yarn_audit", "pip_audit", "cargo_audit", "trivy_fs", "grype_fs"].includes(normalized)) return normalized as SafetyScannerKind;
  return undefined;
}

function normalizeSafetyScanStatus(value: unknown): SafetyScanStatus | undefined {
  return value === "planned" || value === "passed" || value === "failed" || value === "unavailable" || value === "skipped" ? value : undefined;
}

function createSafetyScanRecord(
  candidate: SafetyScanCandidate,
  input: {
    available: boolean;
    startedAt: string;
    finishedAt: string;
    status: SafetyScanStatus;
    message: string;
    exitCode?: number;
    stdoutSnippet?: string;
    stderrSnippet?: string;
  },
): SafetyScanRecord {
  return {
    version: 1,
    id: `scan-${Date.parse(input.startedAt) || Date.now()}-${candidate.kind}`,
    kind: candidate.kind,
    command: candidate.command,
    status: input.status,
    reason: candidate.reason,
    available: input.available,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    exitCode: input.exitCode,
    stdoutSnippet: input.stdoutSnippet,
    stderrSnippet: input.stderrSnippet,
    message: input.message,
  };
}

function summarizeSafetyScanRecords(records: SafetyScanRecord[]): Record<SafetyScanStatus, number> {
  return records.reduce<Record<SafetyScanStatus, number>>(
    (summary, record) => {
      summary[record.status] += 1;
      return summary;
    },
    { planned: 0, passed: 0, failed: 0, unavailable: 0, skipped: 0 },
  );
}

async function anyEvidenceFileExists(cwd: string, files: string[]): Promise<boolean> {
  for (const file of files) {
    try {
      await access(`${cwd}/${file}`, constants.F_OK);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return false;
}

async function defaultCommandAvailable(command: string, cwd: string): Promise<boolean> {
  if (!command) return false;
  try {
    await execFileAsync("sh", ["-c", `command -v ${command}`], { cwd, timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

async function defaultCommandRunner(command: string, args: string[], cwd: string): Promise<{ exitCode: number; stdout?: string; stderr?: string }> {
  try {
    const result = await execFileAsync(command, args, { cwd, timeout: 120_000, maxBuffer: 1024 * 1024 });
    return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const maybe = error as NodeJS.ErrnoException & { code?: string | number; stdout?: string; stderr?: string };
    const exitCode = typeof maybe.code === "number" ? maybe.code : 1;
    return { exitCode, stdout: maybe.stdout, stderr: maybe.stderr ?? maybe.message };
  }
}

function truncateSnippet(value: string | undefined, max = 4000): string | undefined {
  if (!value) return undefined;
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function hasProtectedPath(input: Record<string, unknown>): boolean {
  const target = getToolCallTarget(input);
  if (!target) return false;
  return protectedPathPatterns.some((pattern) => pattern.test(target));
}

function getCommand(input: Record<string, unknown>): string | undefined {
  const command = input.command;
  return typeof command === "string" ? command : undefined;
}

function isAllowedPathTarget(input: Record<string, unknown>, allowedPathPrefixes: string[] | undefined): boolean {
  const prefixes = normalizePathPrefixes(allowedPathPrefixes);
  if (prefixes.length === 0) return true;
  const target = normalizePath(getToolCallTarget(input));
  if (!target) return true;
  return prefixes.some((prefix) => target === prefix || target.startsWith(`${prefix}/`));
}

function normalizePathPrefixes(paths: string[] | undefined): string[] {
  return (paths ?? [])
    .map((path) => normalizePath(path))
    .filter((path): path is string => Boolean(path));
}

function normalizePath(path: string | undefined): string | undefined {
  if (!path) return undefined;
  return path.trim().replace(/^\.\//, "").replace(/\/+$/, "");
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "value";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const protectedPathPatterns = [
  /(^|\/)\.env(\.|$|\/)?/i,
  /(^|\/)\.git(\/|$)/i,
  /(^|\/)\.ssh(\/|$)/i,
  /(^|\/)\.aws(\/|$)/i,
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
];

const protectedCommandPathPatterns = [
  /(^|\s|["'])\.env(\.|\s|$|\/|["'])/i,
  /(^|\s|["'])\.git(\/|\s|$|["'])/i,
  /(^|\s|["'])\.ssh(\/|\s|$|["'])/i,
  /(^|\s|["'])\.aws(\/|\s|$|["'])/i,
  /\S+\.pem(\s|$|["'])/i,
  /\S+\.key(\s|$|["'])/i,
  /\S+\.p12(\s|$|["'])/i,
];

const destructiveCommandPatterns = [
  /\brm\s+[^\n]*(?:-rf|-fr|--recursive)/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-[^\n]*f/i,
  /\bgit\s+push\b[^\n]*(?:--force|-f)\b/i,
  /\bsudo\b/i,
  /\b(chmod|chown)\b[^\n]*\b777\b/i,
  /\bdocker\s+system\s+prune\b/i,
  /\bkubectl\s+delete\b/i,
];

const secretEnvironmentExposurePatterns = [
  /\$[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|PRIVATE_KEY|ACCESS_KEY|AUTH)[A-Z0-9_]*\b/,
  /\b(?:echo|printf|printenv|env)\b[^\n]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|PRIVATE_KEY|ACCESS_KEY|AUTH)/i,
];

const externalMutationCommandPatterns = [
  /\b(?:npm|pnpm|yarn|bun)\s+publish\b/i,
  /\bgit\s+push\b/i,
  /\bdocker\s+push\b/i,
  /\b(?:kubectl|helm)\s+(?:apply|create|patch|replace|rollout|scale|set|upgrade|install)\b/i,
  /\b(?:terraform|tofu)\s+apply\b/i,
  /\bpulumi\s+up\b/i,
  /\b(?:vercel|netlify|firebase)\s+(?:deploy|hosting:channel:deploy)\b/i,
  /\bgh\s+release\s+create\b/i,
  /\b(?:aws|gcloud|az)\b[^\n]*\b(?:deploy|publish|push|put|delete|update|create|sync|apply)\b/i,
];

const internetTransferCommandPatterns = [
  /\b(?:curl|wget)\b[^\n]*https?:\/\//i,
  /\bssh\s+[^\s@]+@[^\s]+/i,
  /\bscp\b[^\n]*[^\s@]+@[^\s:]+:/i,
  /\brsync\b[^\n]*(?:[^\s@]+@[^\s:]+:|rsync:\/\/)/i,
];

const sandboxCommandPatterns = [
  /\b(?:docker|podman)\s+run\b/i,
  /\bdocker\s+compose\s+run\b/i,
  /\bdevcontainer\s+exec\b/i,
];

const unsafeSandboxCommandPatterns = [
  /\s--privileged(?:\s|$)/i,
  /\s--pid[=\s]host(?:\s|$)/i,
  /\s--network[=\s]host(?:\s|$)/i,
  /(?:^|\s)(?:-v|--volume)\s+\/(?:\s|:)/i,
  /(?:^|\s)(?:-v|--volume)\s+(?:~|\$HOME|\/home|\.\.)(?:\s|:|\/)/i,
  /--mount\s+[^\n]*(?:source|src)=\/(?:,|\s|$)/i,
  /--mount\s+[^\n]*(?:source|src)=(?:~|\$HOME|\/home|\.\.)(?:,|\s|$)/i,
];

/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { appendLogEvent, createLogEvent } from "./logging.js";
import { getMcpServersPath, getToolCatalogPath, getToolIterationPolicyPath, getToolIterationRunsPath, getToolReplayApprovalsPath, getToolRequestsIndexPath, getToolResultsPath, getToolSchedulesPath, getToolSchemaDiscoveryRunsPath, getToolTransactionsPath } from "./paths.js";
import { requireTaskPromptAdmission, TaskPromptAdmissionError, type TaskPromptAdmissionDecision } from "./prompt-admission.js";
import { createStrictProviderAdmissionPolicy, type ProviderAdmissionModel } from "./provider-admission.js";
import { recordProviderUsageBudget, type ProviderUsage } from "./provider-usage.js";
import { loadState } from "./state.js";
import { DEFAULT_TASK_AGENT_OUTPUT_LIMITS, buildTaskAgentInvocation, runTaskAgent, taskAgentRunSucceeded, TaskAgentInvocationAdmissionError, type RunTaskAgentOptions, type TaskAgentInvocation, type TaskAgentOutputLimits, type TaskAgentRequest, type TaskAgentRunResult } from "./subagents.js";
import { assessToolRoute, type ToolRouteAssessment, type ToolRouteAssessmentInput } from "./tool-routing.js";
import type { ScalerState } from "./types.js";

export type ToolRiskLevel = "low" | "medium" | "high" | "destructive" | "external" | "secret" | "unknown";

export interface ToolCatalogEntry {
  name: string;
  description: string;
  riskLevel: ToolRiskLevel;
  docsAvailable: boolean;
  schemaAvailable: boolean;
  source?: string;
  docsRef?: string;
  schemaRef?: string;
  notes?: string;
}

export interface RuntimeToolInfoSummary {
  name: string;
  description?: string;
  parameters?: unknown;
  promptGuidelines?: unknown;
  sourceInfo?: unknown;
}

export interface RuntimeToolCatalogEntry extends ToolCatalogEntry {
  active: boolean;
  sourceInfo?: string;
}

export type RuntimeToolEnvelopeFootprint = "selected" | "whole-catalog" | "unknown";

export interface RuntimeToolEnvelopeSelection {
  requestedToolNames?: string[];
  selectionApisAvailable?: boolean;
}

export interface RuntimeToolEnvelopeProfile {
  version: 1;
  footprint: RuntimeToolEnvelopeFootprint;
  toolNames: string[];
  byteSize: number | null;
  fingerprint: string | null;
  reason?: string;
}

export interface ToolSchemaInput {
  toolName: string;
  source: string;
  description?: string;
  riskLevel?: ToolRiskLevel | string;
  permissionRequirement?: string;
  safetyNotes?: string;
  docsRef?: string;
  schemaRef?: string;
  notes?: string;
  evidenceRefs?: string[];
  discoveredByAgentId?: string;
}

export interface ToolRequestInput {
  toolName: string;
  request: string;
  taskId?: string;
  requesterAgentId?: string;
  contextSummary?: string;
  expectedOutput?: string;
  requiredFormat?: string;
  riskLevel?: ToolRiskLevel | string;
  permissionRequirement?: string;
  safetyNotes?: string;
  allowedTools?: string[];
}

export type ToolRequestStatus = "prepared" | "completed" | "failed" | "blocked";
export type ToolResultStatus = "completed" | "failed" | "blocked";
export type ToolTransactionStatus = "prepared" | "completed" | "failed" | "blocked" | "missing_result" | "rejected";
export type ToolSchemaDiscoveryRunStatus = "prepared" | "completed" | "missing_schema" | "rejected";
export type ToolIterationRunStatus = "prepared" | "completed" | "failed" | "blocked" | "missing_result" | "exhausted" | "rejected";
export type ToolIterationStepAction = "run" | "replay";
export type ToolReplayApprovalStatus = "active" | "consumed" | "revoked" | "expired";
export type McpServerStatus = "discovered" | "invalid";
export type McpServerTransport = "stdio" | "http" | "sse" | "unknown";
export type McpEnumerationRunStatus = "completed" | "no_candidates" | "failed";
export type ToolScheduleStatus = "planned" | "completed" | "partial" | "rejected";
export type ToolScheduleStepMode = "parallel" | "serial";

export interface ToolRequestRecord {
  id: string;
  activeExecutionId?: string;
  taskId?: string;
  requesterAgentId?: string;
  toolName: string;
  request: string;
  contextSummary?: string;
  expectedOutput?: string;
  requiredFormat?: string;
  riskLevel: ToolRiskLevel;
  permissionRequirement?: string;
  safetyNotes?: string;
  allowedTools: string[];
  status: ToolRequestStatus;
  createdAt: string;
  updatedAt?: string;
}

export interface ToolSchemaDiscoveryRunRecord {
  id: string;
  toolName: string;
  status: ToolSchemaDiscoveryRunStatus;
  executed: boolean;
  allowedTools: string[];
  invocation: TaskAgentInvocation;
  runExitCode?: number;
  stdoutEventCount?: number;
  stderrSummary?: string;
  schemaRecordId?: string;
  message: string;
  createdAt: string;
  updatedAt: string;
  usage?: ProviderUsage;
}

export interface ToolSchemaRecord {
  id: string;
  toolName: string;
  source: string;
  description?: string;
  riskLevel: ToolRiskLevel;
  permissionRequirement?: string;
  safetyNotes?: string;
  docsRef?: string;
  schemaRef?: string;
  notes?: string;
  evidenceRefs?: string[];
  discoveredByAgentId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ToolResultInput {
  requestId: string;
  executionId?: string;
  status: ToolResultStatus | string;
  summary: string;
  outputs?: unknown;
  evidenceRefs?: string[];
  validationPerformed?: string[];
  errors?: string[];
  recommendations?: string[];
}

export interface ToolExecutionLimits extends TaskAgentOutputLimits {
  resultBytes: number;
}

export const DEFAULT_TOOL_EXECUTION_LIMITS: Readonly<ToolExecutionLimits> = Object.freeze({
  stdoutBytes: DEFAULT_TASK_AGENT_OUTPUT_LIMITS.stdoutBytes,
  stderrBytes: DEFAULT_TASK_AGENT_OUTPUT_LIMITS.stderrBytes,
  resultBytes: 1024 * 1024,
});

export interface ToolTransactionRecord {
  id: string;
  requestId: string;
  taskId?: string;
  toolName: string;
  status: ToolTransactionStatus;
  executed: boolean;
  invocation: TaskAgentInvocation;
  runExitCode?: number;
  stdoutEventCount?: number;
  stdoutBytes?: number;
  stderrBytes?: number;
  outputLimitExceeded?: "stdout" | "stderr";
  limits?: ToolExecutionLimits;
  routeAdmission?: ToolDispatchAdmissionRecord;
  stderrSummary?: string;
  resultId?: string;
  replayOfTransactionId?: string;
  message: string;
  createdAt: string;
  updatedAt: string;
  usage?: ProviderUsage;
}

export interface ToolResultRecord {
  id: string;
  requestId: string;
  executionId?: string;
  acceptanceStatus: "proposed" | "accepted" | "rejected" | "unbound";
  acceptanceMessage?: string;
  taskId?: string;
  toolName: string;
  status: ToolResultStatus;
  summary: string;
  outputs?: unknown;
  evidenceRefs?: string[];
  validationPerformed?: string[];
  errors?: string[];
  recommendations?: string[];
  serializedBytes?: number;
  createdAt: string;
}

export interface ToolIterationPolicy {
  version: 1;
  maxIterations: number;
  autoReplay: boolean;
  updatedAt?: string;
}

export interface ToolIterationStepRecord {
  iteration: number;
  action: ToolIterationStepAction;
  accepted: boolean;
  transactionId?: string;
  transactionStatus?: ToolTransactionStatus;
  resultId?: string;
  message: string;
}

export interface ToolIterationRunRecord {
  id: string;
  requestId?: string;
  taskId?: string;
  toolName?: string;
  status: ToolIterationRunStatus;
  executed: boolean;
  maxIterations: number;
  autoReplay: boolean;
  steps: ToolIterationStepRecord[];
  finalRequestStatus?: ToolRequestStatus;
  message: string;
  createdAt: string;
  updatedAt: string;
}

export interface ToolReplayApprovalRecord {
  id: string;
  transactionId: string;
  requestId: string;
  toolName: string;
  status: ToolReplayApprovalStatus;
  reason: string;
  maxUses: number;
  uses: number;
  expiresAt?: string;
  consumedByTransactionIds?: string[];
  revokedReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface McpServerRecord {
  id: string;
  name: string;
  sourcePath: string;
  status: McpServerStatus;
  transport: McpServerTransport;
  riskLevel: ToolRiskLevel;
  command?: string;
  args?: string[];
  url?: string;
  envKeys?: string[];
  message: string;
  createdAt: string;
  updatedAt: string;
}

export interface McpEnumerationRunRecord {
  id: string;
  status: McpEnumerationRunStatus;
  sourcePaths: string[];
  discoveredCount: number;
  invalidCount: number;
  recordIds: string[];
  message: string;
  createdAt: string;
  updatedAt: string;
}

export interface ToolScheduleStepRecord {
  requestId: string;
  toolName: string;
  mode: ToolScheduleStepMode;
  reason: string;
  accepted?: boolean;
  transactionId?: string;
  transactionStatus?: ToolTransactionStatus;
  message?: string;
}

export interface ToolScheduleRecord {
  id: string;
  status: ToolScheduleStatus;
  executed: boolean;
  parallelism: number;
  parallelRequestIds: string[];
  serialRequestIds: string[];
  steps: ToolScheduleStepRecord[];
  message: string;
  createdAt: string;
  updatedAt: string;
}

export interface ToolRequestPrepareResult {
  accepted: boolean;
  message: string;
  record?: ToolRequestRecord;
  prompt?: string;
  invocation?: TaskAgentInvocation;
}

export type ToolRouteRuntimeEvidence = Omit<ToolRouteAssessmentInput, "request">;

export interface ToolDispatchRouteBasis {
  version: 1;
  requestId: string;
  executionId: string;
  requestFingerprint: string;
  invocationFingerprint: string;
  toolNames: readonly string[];
  resultBytesReserve: number;
}

export interface ToolDispatchRouteSnapshot {
  version: 1;
  requestId: string;
  executionId: string;
  evidence: ToolRouteRuntimeEvidence;
}

export type ToolDispatchRouteEvidenceSupplier = (
  basis: Readonly<ToolDispatchRouteBasis>,
) => Promise<ToolDispatchRouteSnapshot> | ToolDispatchRouteSnapshot;

export interface ToolDispatchAdmissionRecord {
  version: 1;
  route: "isolated";
  authorized: true;
  requestFingerprint: string;
  invocationFingerprint: string;
  evidenceFingerprint: string;
  profileFingerprint: string;
  modelId: string;
  selectedEstimatedOverheadUpperBound: number;
}

export interface ToolRouteAssessmentRecordResult {
  recorded: boolean;
  message: string;
  assessment?: ToolRouteAssessment;
}

export interface ToolRequestRunOptions {
  requestId?: string;
  execute?: boolean;
  timeoutMs?: number;
  command?: string;
  /** Host-owned live envelope supplier. Model/request payloads cannot set it. */
  routeEvidenceSupplier?: ToolDispatchRouteEvidenceSupplier;
}

export interface ToolIterationWorkflowOptions {
  requestId?: string;
  execute?: boolean;
  maxIterations?: number;
  timeoutMs?: number;
  command?: string;
  routeEvidenceSupplier?: ToolDispatchRouteEvidenceSupplier;
}

export interface ToolScheduleOptions {
  execute?: boolean;
  parallelism?: number;
  timeoutMs?: number;
  command?: string;
  routeEvidenceSupplier?: ToolDispatchRouteEvidenceSupplier;
}

export interface ToolIterationPolicyInput {
  maxIterations?: number;
  autoReplay?: boolean;
}

export interface ToolTransactionReplayOptions {
  transactionId: string;
  execute?: boolean;
  timeoutMs?: number;
  command?: string;
  approvalId?: string;
  routeEvidenceSupplier?: ToolDispatchRouteEvidenceSupplier;
}

export interface ToolReplayApprovalInput {
  transactionId: string;
  reason: string;
  maxUses?: number;
  ttlMinutes?: number;
}

export interface ToolReplayApprovalRevokeInput {
  id: string;
  reason?: string;
}

export interface ToolSchemaDiscoveryRunOptions {
  toolName: string;
  execute?: boolean;
  tools?: string[];
  timeoutMs?: number;
  command?: string;
  tokenBudget?: number;
  providerAdmissionModel?: ProviderAdmissionModel;
}

export interface ToolRequestRunResult {
  accepted: boolean;
  message: string;
  request?: ToolRequestRecord;
  prompt?: string;
  invocation?: TaskAgentInvocation;
  runResult?: TaskAgentRunResult;
  transaction?: ToolTransactionRecord;
  resultRecord?: ToolResultRecord;
}

export interface ToolTransactionReplayResult {
  accepted: boolean;
  message: string;
  original?: ToolTransactionRecord;
  request?: ToolRequestRecord;
  prompt?: string;
  invocation?: TaskAgentInvocation;
  runResult?: TaskAgentRunResult;
  transaction?: ToolTransactionRecord;
  resultRecord?: ToolResultRecord;
}

export interface ToolSchemaDiscoveryRunResult {
  accepted: boolean;
  message: string;
  toolName?: string;
  prompt?: string;
  invocation?: TaskAgentInvocation;
  runResult?: TaskAgentRunResult;
  run?: ToolSchemaDiscoveryRunRecord;
  schemaRecord?: ToolSchemaRecord;
  promptAdmission?: TaskPromptAdmissionDecision;
}

export interface ToolIterationWorkflowResult {
  accepted: boolean;
  message: string;
  request?: ToolRequestRecord;
  run?: ToolIterationRunRecord;
  steps: ToolIterationStepRecord[];
}

export interface McpServerCatalog {
  version: 1;
  records: McpServerRecord[];
  runs: McpEnumerationRunRecord[];
}

export interface McpEnumerationResult {
  accepted: boolean;
  message: string;
  run: McpEnumerationRunRecord;
  records: McpServerRecord[];
}

export interface ToolScheduleResult {
  accepted: boolean;
  message: string;
  schedule: ToolScheduleRecord;
}

interface ToolRequestIndex {
  version: 1;
  requests: ToolRequestRecord[];
}

interface ToolResultIndex {
  version: 1;
  results: ToolResultRecord[];
}

interface ToolTransactionIndex {
  version: 1;
  transactions: ToolTransactionRecord[];
}

interface ToolSchemaIndex {
  version: 1;
  records: ToolSchemaRecord[];
}

interface ToolSchemaDiscoveryRunIndex {
  version: 1;
  runs: ToolSchemaDiscoveryRunRecord[];
}

interface ToolIterationRunIndex {
  version: 1;
  runs: ToolIterationRunRecord[];
}

interface ToolReplayApprovalIndex {
  version: 1;
  approvals: ToolReplayApprovalRecord[];
}

interface ToolScheduleIndex {
  version: 1;
  schedules: ToolScheduleRecord[];
}

const toolRiskLevels = new Set<ToolRiskLevel>(["low", "medium", "high", "destructive", "external", "secret", "unknown"]);
const toolResultStatuses = new Set<ToolResultStatus>(["completed", "failed", "blocked"]);
const toolLedgerWriteQueues = new Map<string, Promise<void>>();

export const parentRequesterToolNames = [
  "scaler_report",
  "scaler_memory_search",
  "scaler_memory_retrieve",
  "scaler_research_report",
  "scaler_task_report",
  "scaler_tool_request",
  "scaler_task_create",
  "scaler_task_update",
  "scaler_planning_report",
  "scaler_prd_write",
  "scaler_prd_requirement_update",
  "scaler_validation_manifest_write",
  "scaler_validation_report",
  "scaler_debug_attempt",
] as const;

const defaultToolCatalog: ToolCatalogEntry[] = [
  { name: "read", description: "Read a project file or image from the working tree.", riskLevel: "low", docsAvailable: false, schemaAvailable: true },
  { name: "write", description: "Create or overwrite a project file.", riskLevel: "medium", docsAvailable: false, schemaAvailable: true },
  { name: "edit", description: "Apply targeted edits to a project file.", riskLevel: "medium", docsAvailable: false, schemaAvailable: true },
  { name: "bash", description: "Run a shell command in the project.", riskLevel: "high", docsAvailable: true, schemaAvailable: true },
  { name: "scaler_memory_retrieve", description: "Retrieve a SCALER memory entry by id/path.", riskLevel: "low", docsAvailable: true, schemaAvailable: true },
  { name: "scaler_memory_write", description: "Write inactive detail to SCALER memory.", riskLevel: "medium", docsAvailable: true, schemaAvailable: true },
  { name: "scaler_research_report", description: "Record structured research evidence.", riskLevel: "medium", docsAvailable: true, schemaAvailable: true },
  { name: "scaler_tool_request", description: "Prepare another isolated tool-agent request.", riskLevel: "low", docsAvailable: true, schemaAvailable: true },
];

export function normalizeToolRiskLevel(value: unknown): ToolRiskLevel {
  if (typeof value !== "string") return "unknown";
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return toolRiskLevels.has(normalized as ToolRiskLevel) ? normalized as ToolRiskLevel : "unknown";
}

export function getDefaultToolCatalog(): ToolCatalogEntry[] {
  return defaultToolCatalog.map((entry) => ({ ...entry }));
}

export function getToolCatalogEntries(toolNames: string[], discoveredRecords: ToolSchemaRecord[] = []): ToolCatalogEntry[] {
  const catalog = getDefaultToolCatalog();
  const requested = uniqueNonEmpty(toolNames);
  const latestDiscovered = latestToolSchemaRecords(discoveredRecords);
  return requested.map((name) => {
    const discovered = latestDiscovered.get(name);
    const base = catalog.find((entry) => entry.name === name) ?? {
      name,
      description: "Requested tool/MCP; full docs/schema may be inspected by the isolated tool agent if available.",
      riskLevel: "unknown" as ToolRiskLevel,
      docsAvailable: false,
      schemaAvailable: false,
    };
    if (!discovered) return { ...base };
    return {
      ...base,
      description: discovered.description ?? base.description,
      riskLevel: discovered.riskLevel === "unknown" ? base.riskLevel : discovered.riskLevel,
      docsAvailable: base.docsAvailable || Boolean(discovered.docsRef),
      schemaAvailable: base.schemaAvailable || Boolean(discovered.schemaRef),
      source: discovered.source,
      docsRef: discovered.docsRef,
      schemaRef: discovered.schemaRef,
      notes: discovered.notes,
    };
  });
}

export function formatToolCatalog(entries: ToolCatalogEntry[]): string {
  if (entries.length === 0) return "Tool catalog: none";
  return [
    "Tool catalog:",
    ...entries.map((entry) => {
      const refs = [entry.source ? `source=${entry.source}` : undefined, entry.docsRef ? `docsRef=${entry.docsRef}` : undefined, entry.schemaRef ? `schemaRef=${entry.schemaRef}` : undefined].filter(Boolean).join(" ");
      const notes = entry.notes ? ` notes=${entry.notes}` : "";
      return `- ${entry.name}: ${entry.description} risk=${entry.riskLevel} docs=${entry.docsAvailable ? "yes" : "no"} schema=${entry.schemaAvailable ? "yes" : "no"}${refs ? ` ${refs}` : ""}${notes}`;
    }),
  ].join("\n");
}

export function buildRuntimeToolCatalog(
  allTools: RuntimeToolInfoSummary[],
  activeToolNames: string[],
  discoveredRecords: ToolSchemaRecord[] = [],
): RuntimeToolCatalogEntry[] {
  const active = new Set(activeToolNames);
  const discoveredByName = latestToolSchemaRecords(discoveredRecords);
  return allTools
    .filter((tool) => typeof tool.name === "string" && tool.name.trim().length > 0)
    .map((tool) => {
      const name = tool.name.trim();
      const discovered = discoveredByName.get(name);
      const fallback = getToolCatalogEntries([name], discoveredRecords)[0];
      const description = compactToolDescription(tool.description ?? discovered?.description ?? fallback?.description ?? "Configured Pi tool/MCP.");
      const riskLevel = discovered?.riskLevel && discovered.riskLevel !== "unknown" ? discovered.riskLevel : fallback?.riskLevel ?? "unknown";
      return {
        name,
        description,
        riskLevel,
        docsAvailable: Boolean(discovered?.docsRef) || Boolean(tool.promptGuidelines),
        schemaAvailable: Boolean(discovered?.schemaRef) || Boolean(tool.parameters),
        source: discovered?.source ?? fallback?.source,
        docsRef: discovered?.docsRef,
        schemaRef: discovered?.schemaRef,
        notes: discovered?.notes,
        active: active.has(name),
        sourceInfo: summarizeRuntimeToolSource(tool.sourceInfo),
      };
    })
    .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
}

function normalizeEnvelopeToolNames(names: string[]): string[] | undefined {
  const normalized = names.map((name) => name.trim());
  if (normalized.some((name) => name.length === 0) || new Set(normalized).size !== normalized.length) return undefined;
  return normalized.sort(compareEnvelopeStrings);
}

function compareEnvelopeStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sameEnvelopeToolNames(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((name, index) => name === right[index]);
}

function canonicalizeEnvelopeValue(value: unknown, ancestors = new Set<object>()): string {
  if (value === null) return "n";
  if (typeof value === "string") return `s:${JSON.stringify(value)}`;
  if (typeof value === "boolean") return value ? "b:1" : "b:0";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non-finite number");
    return `d:${JSON.stringify(Object.is(value, -0) ? 0 : value)}`;
  }
  if (value === undefined) return "u";
  if (typeof value !== "object") throw new Error(`unsupported ${typeof value}`);
  if (ancestors.has(value)) throw new Error("cyclic value");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const items = Array.from({ length: value.length }, (_, index) => Object.prototype.hasOwnProperty.call(value, index)
        ? canonicalizeEnvelopeValue(value[index], ancestors)
        : "h");
      return `a:[${items.join(",")}]`;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new Error("non-plain object");
    if (Object.getOwnPropertySymbols(value).length > 0) throw new Error("symbol keys");
    const entries = Object.keys(value as Record<string, unknown>)
      .sort(compareEnvelopeStrings)
      .map((key) => `${JSON.stringify(key)}:${canonicalizeEnvelopeValue((value as Record<string, unknown>)[key], ancestors)}`);
    return `o:{${entries.join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

function unknownRuntimeToolEnvelope(reason: string, toolNames: string[] = []): RuntimeToolEnvelopeProfile {
  return { version: 1, footprint: "unknown", toolNames, byteSize: null, fingerprint: null, reason };
}

export function buildRuntimeToolEnvelopeProfile(
  allTools: RuntimeToolInfoSummary[],
  activeToolNames: string[],
  selection: RuntimeToolEnvelopeSelection = {},
): RuntimeToolEnvelopeProfile {
  const active = normalizeEnvelopeToolNames(activeToolNames);
  if (!active) return unknownRuntimeToolEnvelope("invalid-active-tool-set");

  const definitions = new Map<string, RuntimeToolInfoSummary>();
  for (const tool of allTools) {
    if (typeof tool.name !== "string" || tool.name.trim().length === 0) return unknownRuntimeToolEnvelope("invalid-tool-definition", active);
    const name = tool.name.trim();
    if (definitions.has(name)) return unknownRuntimeToolEnvelope("duplicate-tool-definition", active);
    definitions.set(name, tool);
  }

  let footprint: Exclude<RuntimeToolEnvelopeFootprint, "unknown">;
  if (selection.requestedToolNames !== undefined) {
    if (selection.selectionApisAvailable !== true) return unknownRuntimeToolEnvelope("selection-apis-unavailable", active);
    const requested = normalizeEnvelopeToolNames(selection.requestedToolNames);
    if (!requested) return unknownRuntimeToolEnvelope("invalid-requested-tool-set", active);
    if (!sameEnvelopeToolNames(active, requested)) return unknownRuntimeToolEnvelope("post-selection-tool-mismatch", active);
    footprint = "selected";
  } else {
    const allNames = normalizeEnvelopeToolNames([...definitions.keys()]);
    if (!allNames || !sameEnvelopeToolNames(active, allNames)) return unknownRuntimeToolEnvelope("partial-tool-set-without-selection-proof", active);
    footprint = "whole-catalog";
  }

  const selectedDefinitions: RuntimeToolInfoSummary[] = [];
  for (const name of active) {
    const tool = definitions.get(name);
    if (!tool) return unknownRuntimeToolEnvelope("active-tool-definition-missing", active);
    selectedDefinitions.push(tool);
  }

  try {
    const canonical = canonicalizeEnvelopeValue({
      version: 1,
      footprint,
      tools: selectedDefinitions.map((tool) => ({
        name: tool.name.trim(),
        description: tool.description,
        parameters: tool.parameters,
        promptGuidelines: tool.promptGuidelines,
        sourceInfo: tool.sourceInfo,
      })),
    });
    const bytes = Buffer.from(canonical, "utf8");
    return {
      version: 1,
      footprint,
      toolNames: active,
      byteSize: bytes.byteLength,
      fingerprint: createHash("sha256").update(bytes).digest("hex"),
    };
  } catch (error) {
    return unknownRuntimeToolEnvelope(`unserializable-tool-definition:${error instanceof Error ? error.message : String(error)}`, active);
  }
}

export function formatRuntimeToolCatalog(entries: RuntimeToolCatalogEntry[], limit = 25): string {
  if (entries.length === 0) return "Parent tool catalog: none";
  const shown = entries.slice(0, limit);
  const lines = [
    `Parent tool catalog: showing=${shown.length}/${entries.length}`,
    "Only compact metadata is shown; parameter schemas, prompt guidelines, and full docs are intentionally withheld from requester context.",
  ];
  for (const entry of shown) {
    const source = entry.sourceInfo ? ` source=${entry.sourceInfo}` : "";
    lines.push(`- ${entry.name}: ${entry.description} active=${entry.active ? "yes" : "no"} risk=${entry.riskLevel} docs=${entry.docsAvailable ? "yes" : "no"} schema=${entry.schemaAvailable ? "yes" : "no"}${source}`);
  }
  if (entries.length > shown.length) lines.push(`- ... omitted ${entries.length - shown.length} additional tools; request /scaler-tool-catalog or a specific tool request if needed.`);
  return lines.join("\n");
}

export function selectParentRequesterActiveTools(allToolNames: string[], activeToolNames: string[]): string[] {
  const available = new Set(allToolNames);
  const selected = parentRequesterToolNames.filter((name) => available.has(name));
  if (selected.length === 0) return [...activeToolNames];
  return [...selected];
}

export function shouldApplyParentToolFocus(state: ScalerState): boolean {
  return Boolean(state.currentTaskId) || ["knowledge", "planning", "execution", "debugging", "replanning"].includes(state.stage);
}

export async function loadToolRequests(cwd: string): Promise<ToolRequestRecord[]> {
  try {
    const raw = await readFile(getToolRequestsIndexPath(cwd), "utf8");
    return (JSON.parse(raw) as ToolRequestIndex).requests;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function recordToolRouteAssessment(
  cwd: string,
  state: ScalerState,
  requestId: string,
  evidence: ToolRouteRuntimeEvidence,
): Promise<ToolRouteAssessmentRecordResult> {
  const request = (await loadToolRequests(cwd)).find((candidate) => candidate.id === requestId);
  if (!request) {
    const message = `Tool route assessment rejected: request ${requestId} was not found.`;
    await appendLogEvent(cwd, createLogEvent(state, {
      eventType: "tool",
      summary: message,
      details: { requestId, executionAuthorized: false },
    }));
    return { recorded: false, message };
  }

  const assessment = assessToolRoute({
    ...evidence,
    request: {
      requestId: request.id,
      taskId: request.taskId,
      toolNames: request.allowedTools,
      content: {
        toolName: request.toolName,
        request: request.request,
        requesterAgentId: request.requesterAgentId,
        contextSummary: request.contextSummary,
        expectedOutput: request.expectedOutput,
        requiredFormat: request.requiredFormat,
        riskLevel: request.riskLevel,
        permissionRequirement: request.permissionRequirement,
        safetyNotes: request.safetyNotes,
      },
    },
  });
  const message = `Tool route assessment recorded: ${request.id} recommendation=${assessment.route} authorized=no`;
  await appendLogEvent(cwd, createLogEvent(state, {
    eventType: "tool",
    summary: message,
    taskId: request.taskId,
    details: { assessment },
  }));
  return { recorded: true, message, assessment };
}

export async function loadToolResults(cwd: string): Promise<ToolResultRecord[]> {
  try {
    const raw = await readFile(getToolResultsPath(cwd), "utf8");
    return (JSON.parse(raw) as ToolResultIndex).results;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function loadToolTransactions(cwd: string): Promise<ToolTransactionRecord[]> {
  try {
    const raw = await readFile(getToolTransactionsPath(cwd), "utf8");
    return (JSON.parse(raw) as ToolTransactionIndex).transactions;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function loadToolSchemaRecords(cwd: string): Promise<ToolSchemaRecord[]> {
  try {
    const raw = await readFile(getToolCatalogPath(cwd), "utf8");
    return (JSON.parse(raw) as ToolSchemaIndex).records;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function loadToolSchemaDiscoveryRuns(cwd: string): Promise<ToolSchemaDiscoveryRunRecord[]> {
  try {
    const raw = await readFile(getToolSchemaDiscoveryRunsPath(cwd), "utf8");
    return (JSON.parse(raw) as ToolSchemaDiscoveryRunIndex).runs;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export function createDefaultToolIterationPolicy(): ToolIterationPolicy {
  return { version: 1, maxIterations: 3, autoReplay: true };
}

export async function loadToolIterationPolicy(cwd: string): Promise<ToolIterationPolicy> {
  try {
    const raw = await readFile(getToolIterationPolicyPath(cwd), "utf8");
    const parsed = JSON.parse(raw) as Partial<ToolIterationPolicy>;
    return normalizeToolIterationPolicy(parsed);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return createDefaultToolIterationPolicy();
    throw error;
  }
}

export async function saveToolIterationPolicy(cwd: string, input: ToolIterationPolicyInput, now = new Date()): Promise<ToolIterationPolicy> {
  const current = await loadToolIterationPolicy(cwd);
  const next = normalizeToolIterationPolicy({
    ...current,
    maxIterations: input.maxIterations ?? current.maxIterations,
    autoReplay: input.autoReplay ?? current.autoReplay,
    updatedAt: now.toISOString(),
  });
  const path = getToolIterationPolicyPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

export async function loadToolIterationRuns(cwd: string): Promise<ToolIterationRunRecord[]> {
  try {
    const raw = await readFile(getToolIterationRunsPath(cwd), "utf8");
    return (JSON.parse(raw) as ToolIterationRunIndex).runs;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export function formatToolIterationPolicy(policy: ToolIterationPolicy): string {
  return `Tool iteration policy: maxIterations=${policy.maxIterations} autoReplay=${policy.autoReplay} updatedAt=${policy.updatedAt ?? "default"}`;
}

export function formatToolIterationRuns(records: ToolIterationRunRecord[], requestId?: string, limit = 10): string {
  const filtered = requestId ? records.filter((record) => record.requestId === requestId) : records;
  if (filtered.length === 0) return requestId ? `No tool iteration runs for ${requestId}.` : "No tool iteration runs.";
  const lines = [requestId ? `Tool iteration runs for ${requestId}:` : "Tool iteration runs:"];
  for (const record of filtered.slice(0, limit)) {
    lines.push(`- ${record.id} request=${record.requestId ?? "n/a"} tool=${record.toolName ?? "n/a"} status=${record.status} executed=${record.executed} steps=${record.steps.length}/${record.maxIterations} final=${record.finalRequestStatus ?? "n/a"}: ${record.message}`);
  }
  return lines.join("\n");
}

export async function loadToolReplayApprovals(cwd: string): Promise<ToolReplayApprovalRecord[]> {
  try {
    const raw = await readFile(getToolReplayApprovalsPath(cwd), "utf8");
    return (JSON.parse(raw) as ToolReplayApprovalIndex).approvals;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function createToolReplayApproval(cwd: string, state: ScalerState, input: ToolReplayApprovalInput, now = new Date()): Promise<ToolReplayApprovalRecord> {
  const transactionId = input.transactionId.trim();
  const reason = input.reason.trim();
  if (!transactionId) throw new Error("Tool replay approval rejected: transactionId is required.");
  if (!reason) throw new Error("Tool replay approval rejected: reason is required.");
  const transaction = (await loadToolTransactions(cwd)).find((candidate) => candidate.id === transactionId);
  if (!transaction) throw new Error(`Tool replay approval rejected: transaction ${transactionId} not found.`);
  const request = (await loadToolRequests(cwd)).find((candidate) => candidate.id === transaction.requestId);
  if (!request) throw new Error(`Tool replay approval rejected: request ${transaction.requestId} not found.`);
  const maxUses = Math.min(10, Math.max(1, Math.trunc(input.maxUses ?? 1)));
  const ttlMinutes = input.ttlMinutes === undefined ? undefined : Math.max(1, Math.trunc(input.ttlMinutes));
  const timestamp = now.toISOString();
  const approval: ToolReplayApprovalRecord = {
    id: randomUUID(),
    transactionId: transaction.id,
    requestId: request.id,
    toolName: request.toolName,
    status: "active",
    reason,
    maxUses,
    uses: 0,
    expiresAt: ttlMinutes === undefined ? undefined : new Date(now.getTime() + ttlMinutes * 60_000).toISOString(),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await withToolLedgerWriteQueue(cwd, async () => {
    await writeToolReplayApprovalIndex(cwd, [approval, ...(await loadToolReplayApprovals(cwd))]);
  });
  await appendLogEvent(cwd, createLogEvent(state, {
    eventType: "tool",
    summary: `Tool replay approval created: ${approval.id}`,
    taskId: request.taskId,
    outputRefs: [approval.id, approval.transactionId, approval.requestId],
    details: { approval },
  }));
  return approval;
}

export async function revokeToolReplayApproval(cwd: string, state: ScalerState, input: ToolReplayApprovalRevokeInput, now = new Date()): Promise<ToolReplayApprovalRecord> {
  const id = input.id.trim();
  const updated = await withToolLedgerWriteQueue(cwd, async () => {
    const approvals = await loadToolReplayApprovals(cwd);
    const approval = approvals.find((candidate) => candidate.id === id);
    if (!approval) throw new Error(`Tool replay approval rejected: approval ${id || "<missing>"} not found.`);
    const next: ToolReplayApprovalRecord = { ...approval, status: "revoked", revokedReason: input.reason?.trim() || undefined, updatedAt: now.toISOString() };
    await writeToolReplayApprovalIndex(cwd, approvals.map((candidate) => candidate.id === approval.id ? next : candidate));
    return next;
  });
  await appendLogEvent(cwd, createLogEvent(state, {
    eventType: "tool",
    summary: `Tool replay approval revoked: ${updated.id}`,
    outputRefs: [updated.id, updated.transactionId, updated.requestId],
    details: { approval: updated },
  }));
  return updated;
}

export function formatToolReplayApprovals(records: ToolReplayApprovalRecord[], transactionId?: string, limit = 10): string {
  const filtered = transactionId ? records.filter((record) => record.transactionId === transactionId) : records;
  if (filtered.length === 0) return transactionId ? `No tool replay approvals for ${transactionId}.` : "No tool replay approvals.";
  const lines = [transactionId ? `Tool replay approvals for ${transactionId}:` : "Tool replay approvals:"];
  for (const record of filtered.slice(0, limit)) {
    lines.push(`- ${record.id} transaction=${record.transactionId} request=${record.requestId} tool=${record.toolName} status=${record.status} uses=${record.uses}/${record.maxUses} expiresAt=${record.expiresAt ?? "never"}: ${record.reason}`);
  }
  return lines.join("\n");
}

export async function loadMcpServerCatalog(cwd: string): Promise<McpServerCatalog> {
  try {
    const raw = await readFile(getMcpServersPath(cwd), "utf8");
    const parsed = JSON.parse(raw) as Partial<McpServerCatalog>;
    return { version: 1, records: parsed.records ?? [], runs: parsed.runs ?? [] };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, records: [], runs: [] };
    throw error;
  }
}

export async function loadMcpServerRecords(cwd: string): Promise<McpServerRecord[]> {
  return (await loadMcpServerCatalog(cwd)).records;
}

export async function loadMcpEnumerationRuns(cwd: string): Promise<McpEnumerationRunRecord[]> {
  return (await loadMcpServerCatalog(cwd)).runs;
}

export async function runMcpServerEnumeration(cwd: string, state: ScalerState, now = new Date()): Promise<McpEnumerationResult> {
  const discovered = await discoverMcpServerCandidates(cwd, now);
  const catalog = await loadMcpServerCatalog(cwd);
  const existingByKey = new Map(catalog.records.map((record) => [`${record.sourcePath}:${record.name}`, record]));
  const records = discovered.map((record) => existingByKey.has(`${record.sourcePath}:${record.name}`)
    ? { ...record, id: existingByKey.get(`${record.sourcePath}:${record.name}`)!.id, createdAt: existingByKey.get(`${record.sourcePath}:${record.name}`)!.createdAt }
    : record);
  const merged = mergeMcpServerRecords(records, catalog.records);
  const sourcePaths = uniqueNonEmpty(discovered.map((record) => record.sourcePath));
  const discoveredCount = discovered.filter((record) => record.status === "discovered").length;
  const invalidCount = discovered.filter((record) => record.status === "invalid").length;
  const status: McpEnumerationRunStatus = discovered.length === 0 ? "no_candidates" : invalidCount > 0 && discoveredCount === 0 ? "failed" : "completed";
  const timestamp = now.toISOString();
  const run: McpEnumerationRunRecord = {
    id: randomUUID(),
    status,
    sourcePaths,
    discoveredCount,
    invalidCount,
    recordIds: records.map((record) => record.id),
    message: status === "no_candidates" ? "No project MCP server declarations found." : `MCP enumeration ${status}: discovered=${discoveredCount} invalid=${invalidCount}`,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await writeMcpServerCatalog(cwd, { version: 1, records: merged, runs: [run, ...catalog.runs] });
  await appendLogEvent(cwd, createLogEvent(state, {
    eventType: "tool",
    summary: run.message,
    outputRefs: [run.id, ...run.recordIds],
    details: { run, records },
  }));
  return { accepted: status !== "failed", message: run.message, run, records };
}

export function formatMcpServerRecords(records: McpServerRecord[], name?: string, limit = 20): string {
  const filtered = name ? records.filter((record) => record.name === name) : records;
  if (filtered.length === 0) return name ? `No MCP server records for ${name}.` : "No MCP server records.";
  const lines = [name ? `MCP server records for ${name}:` : "MCP server records:"];
  for (const record of filtered.slice(0, limit)) {
    const target = record.url ? ` url=${redactSecretLikeValue(record.url)}` : record.command ? ` command=${record.command}` : "";
    const env = record.envKeys && record.envKeys.length > 0 ? ` envKeys=${record.envKeys.join(",")}` : "";
    lines.push(`- ${record.name} source=${record.sourcePath} status=${record.status} transport=${record.transport} risk=${record.riskLevel}${target}${env}: ${record.message}`);
  }
  return lines.join("\n");
}

export function formatMcpEnumerationRuns(records: McpEnumerationRunRecord[], limit = 10): string {
  if (records.length === 0) return "No MCP enumeration runs.";
  const lines = ["MCP enumeration runs:"];
  for (const record of records.slice(0, limit)) {
    lines.push(`- ${record.id} status=${record.status} discovered=${record.discoveredCount} invalid=${record.invalidCount} sources=${record.sourcePaths.join(",") || "none"}: ${record.message}`);
  }
  return lines.join("\n");
}

export async function loadToolSchedules(cwd: string): Promise<ToolScheduleRecord[]> {
  try {
    const raw = await readFile(getToolSchedulesPath(cwd), "utf8");
    return (JSON.parse(raw) as ToolScheduleIndex).schedules;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export function formatToolSchedules(records: ToolScheduleRecord[], requestId?: string, limit = 10): string {
  const filtered = requestId ? records.filter((record) => record.steps.some((step) => step.requestId === requestId)) : records;
  if (filtered.length === 0) return requestId ? `No tool schedules for ${requestId}.` : "No tool schedules.";
  const lines = [requestId ? `Tool schedules for ${requestId}:` : "Tool schedules:"];
  for (const record of filtered.slice(0, limit)) {
    lines.push(`- ${record.id} status=${record.status} executed=${record.executed} parallel=${record.parallelRequestIds.length} serial=${record.serialRequestIds.length} parallelism=${record.parallelism}: ${record.message}`);
  }
  return lines.join("\n");
}

export async function runToolSchedule(
  cwd: string,
  state: ScalerState,
  options: ToolScheduleOptions = {},
  runner: typeof runTaskAgent = runTaskAgent,
  now = new Date(),
): Promise<ToolScheduleResult> {
  const requests = (await loadToolRequests(cwd)).filter((request) => request.status === "prepared");
  const parallelism = clampParallelism(options.parallelism);
  const discoveredRecords = await loadToolSchemaRecords(cwd);
  const steps = requests.map((request) => classifyToolScheduleStep(request, discoveredRecords));
  if (requests.length === 0) {
    const schedule = await recordToolSchedule(cwd, {
      status: "rejected",
      executed: Boolean(options.execute),
      parallelism,
      steps: [],
      message: "Tool schedule rejected: no prepared tool requests.",
    }, now);
    await appendLogEvent(cwd, createLogEvent(state, { eventType: "tool", summary: schedule.message, details: { schedule } }));
    return { accepted: false, message: schedule.message, schedule };
  }

  if (!options.execute) {
    const schedule = await recordToolSchedule(cwd, {
      status: "planned",
      executed: false,
      parallelism,
      steps,
      message: `Tool schedule planned: parallel=${steps.filter((step) => step.mode === "parallel").length} serial=${steps.filter((step) => step.mode === "serial").length}`,
    }, now);
    await appendLogEvent(cwd, createLogEvent(state, { eventType: "tool", summary: schedule.message, details: { schedule } }));
    return { accepted: true, message: schedule.message, schedule };
  }

  const executedSteps: ToolScheduleStepRecord[] = [];
  const parallelSteps = steps.filter((step) => step.mode === "parallel");
  for (const step of steps) {
    const result = await runToolRequestAgent(cwd, state, {
      requestId: step.requestId,
      execute: true,
      timeoutMs: options.timeoutMs,
      command: options.command,
      routeEvidenceSupplier: options.routeEvidenceSupplier,
    }, runner);
    executedSteps.push(toolScheduleExecutedStep(step, result));
  }
  const status: ToolScheduleStatus = executedSteps.every((step) => step.accepted) ? "completed" : "partial";
  const schedule = await recordToolSchedule(cwd, {
    status,
    executed: true,
    parallelism: 1,
    steps: executedSteps,
    message: `Tool schedule ${status} sequentially: requests=${steps.length}; advisory_parallel=${parallelSteps.length}`,
  }, now);
  await appendLogEvent(cwd, createLogEvent(state, { eventType: "tool", summary: schedule.message, details: { schedule } }));
  return { accepted: status === "completed", message: schedule.message, schedule };
}

export async function recordToolSchema(cwd: string, state: ScalerState, input: ToolSchemaInput, now = new Date()): Promise<ToolSchemaRecord> {
  const toolName = input.toolName.trim();
  const source = input.source.trim();
  if (!toolName) throw new Error("Tool schema rejected: toolName is required.");
  if (!source) throw new Error("Tool schema rejected: source is required.");
  const timestamp = now.toISOString();
  const evidenceRefs = uniqueNonEmpty(input.evidenceRefs ?? []);
  const record: ToolSchemaRecord = {
    id: randomUUID(),
    toolName,
    source,
    description: input.description?.trim() || undefined,
    riskLevel: normalizeToolRiskLevel(input.riskLevel),
    permissionRequirement: input.permissionRequirement?.trim() || undefined,
    safetyNotes: input.safetyNotes?.trim() || undefined,
    docsRef: input.docsRef?.trim() || undefined,
    schemaRef: input.schemaRef?.trim() || undefined,
    notes: input.notes?.trim() || undefined,
    evidenceRefs: evidenceRefs.length > 0 ? evidenceRefs : undefined,
    discoveredByAgentId: input.discoveredByAgentId?.trim() || undefined,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const records = await loadToolSchemaRecords(cwd);
  await writeToolSchemaIndex(cwd, [record, ...records]);
  await appendLogEvent(cwd, createLogEvent(state, {
    eventType: "tool",
    summary: `Tool schema recorded: ${record.toolName}`,
    outputRefs: [record.id, ...(record.evidenceRefs ?? [])],
    details: { record },
  }));
  return record;
}

export function formatDiscoveredToolCatalog(toolNames: string[], discoveredRecords: ToolSchemaRecord[]): string {
  return formatToolCatalog(getToolCatalogEntries(toolNames, discoveredRecords));
}

export function formatKnownToolCatalog(discoveredRecords: ToolSchemaRecord[], toolName?: string): string {
  const names = toolName
    ? [toolName]
    : uniqueNonEmpty([...getDefaultToolCatalog().map((entry) => entry.name), ...discoveredRecords.map((record) => record.toolName)]);
  return formatDiscoveredToolCatalog(names, discoveredRecords);
}

export async function runToolSchemaDiscoveryAgent(
  cwd: string,
  state: ScalerState,
  options: ToolSchemaDiscoveryRunOptions,
  runner: typeof runTaskAgent = runTaskAgent,
): Promise<ToolSchemaDiscoveryRunResult> {
  const toolName = options.toolName.trim();
  if (!toolName) {
    const message = "Tool schema discovery rejected: toolName is required.";
    await appendLogEvent(cwd, createLogEvent(state, { eventType: "tool", summary: message, details: options }));
    return { accepted: false, message };
  }

  const existingRecords = await loadToolSchemaRecords(cwd);
  const prompt = buildToolSchemaDiscoveryPrompt(toolName, existingRecords, options.tools ?? []);
  let promptAdmission: TaskPromptAdmissionDecision;
  try {
    promptAdmission = requireTaskPromptAdmission(prompt, options.tokenBudget);
  } catch (error) {
    if (!(error instanceof TaskPromptAdmissionError)) throw error;
    return {
      accepted: false,
      message: error.message,
      toolName,
      promptAdmission: error.decision,
    };
  }
  const allowedTools = uniqueNonEmpty(["scaler_tool_schema", ...(options.tools ?? [])]);
  const agentRequest: TaskAgentRequest = {
    taskId: `tool-schema-${toolName}`,
    prompt,
    tools: allowedTools,
    cwd,
    providerAdmission: createStrictProviderAdmissionPolicy(promptAdmission.tokenBudget),
    providerAdmissionModel: options.providerAdmissionModel,
    enforceLoadedToolAvailability: true,
  };
  let invocation: TaskAgentInvocation;
  try {
    invocation = buildTaskAgentInvocation(agentRequest, options.command ?? "pi");
  } catch (error) {
    if (!(error instanceof TaskAgentInvocationAdmissionError)) throw error;
    return { accepted: false, message: error.message, toolName, prompt, promptAdmission };
  }

  if (!options.execute) {
    const run = await recordToolSchemaDiscoveryRun(cwd, {
      toolName,
      status: "prepared",
      executed: false,
      allowedTools,
      invocation,
      message: `Tool schema discovery prepared: ${toolName}`,
    });
    await appendLogEvent(cwd, createLogEvent(state, { eventType: "tool", summary: run.message, details: { run } }));
    return { accepted: true, message: run.message, toolName, prompt, invocation, run, promptAdmission };
  }

  const beforeIds = new Set(existingRecords.map((record) => record.id));
  const runResult = await runner(agentRequest, { timeoutMs: options.timeoutMs, command: options.command } satisfies RunTaskAgentOptions);
  if (runResult.usage) {
    await recordProviderUsageBudget(cwd, state, runResult.usage, {
      source: "tool-schema-discovery-run",
      agentId: `tool-schema-${toolName}`,
      agentType: "tool-schema",
    });
  }
  const schemaRecord = (await loadToolSchemaRecords(cwd)).find((record) => record.toolName === toolName && !beforeIds.has(record.id));
  const status: ToolSchemaDiscoveryRunStatus = taskAgentRunSucceeded(runResult) && schemaRecord ? "completed" : "missing_schema";
  const run = await recordToolSchemaDiscoveryRun(cwd, {
    toolName,
    status,
    executed: true,
    allowedTools,
    invocation,
    runResult,
    schemaRecordId: schemaRecord?.id,
    message: status === "missing_schema"
      ? `Tool schema discovery missing structured schema: ${toolName}`
      : `Tool schema discovery completed: ${toolName}`,
  });
  await appendLogEvent(cwd, createLogEvent(state, { eventType: "tool", summary: run.message, details: { run, runResult, schemaRecord } }));
  return { accepted: status === "completed", message: run.message, toolName, prompt, invocation, runResult, run, schemaRecord, promptAdmission };
}

export function formatToolSchemaDiscoveryRuns(records: ToolSchemaDiscoveryRunRecord[], toolName?: string, limit = 10): string {
  const filtered = toolName ? records.filter((record) => record.toolName === toolName) : records;
  if (filtered.length === 0) return toolName ? `No tool schema discovery runs for ${toolName}.` : "No tool schema discovery runs.";
  const lines = [toolName ? `Tool schema discovery runs for ${toolName}:` : "Tool schema discovery runs:"];
  for (const record of filtered.slice(0, limit)) {
    const run = record.runExitCode === undefined ? "not-run" : `exit=${record.runExitCode} stdout_events=${record.stdoutEventCount ?? 0}`;
    lines.push(`- ${record.id} tool=${record.toolName} status=${record.status} tools=${record.allowedTools.join(",")} ${run} schema=${record.schemaRecordId ?? "n/a"}: ${record.message}`);
  }
  return lines.join("\n");
}

export async function runToolRequestAgent(
  cwd: string,
  state: ScalerState,
  options: ToolRequestRunOptions = {},
  runner: typeof runTaskAgent = runTaskAgent,
): Promise<ToolRequestRunResult> {
  const request = await selectRunnableToolRequest(cwd, options.requestId);
  if (!request) {
    const message = options.requestId ? `Tool transaction rejected: request ${options.requestId} is not prepared.` : "Tool transaction rejected: no prepared tool request.";
    await appendLogEvent(cwd, createLogEvent(state, { eventType: "tool", summary: message, details: options }));
    return { accepted: false, message };
  }

  const prompt = buildToolAgentPrompt(request, await loadToolSchemaRecords(cwd));
  let agentRequest: TaskAgentRequest = {
    taskId: `tool-${request.id}`,
    prompt,
    tools: request.allowedTools,
    cwd,
  };
  let invocation = buildTaskAgentInvocation(agentRequest, options.command ?? "pi");

  if (!options.execute) {
    const transaction = await recordToolTransaction(cwd, request, {
      status: "prepared",
      executed: false,
      invocation,
      limits: copyToolExecutionLimits(DEFAULT_TOOL_EXECUTION_LIMITS),
      message: `Tool transaction prepared: ${request.id}`,
    });
    await appendLogEvent(cwd, createLogEvent(state, { eventType: "tool", summary: transaction.message, taskId: request.taskId, details: { transaction } }));
    return { accepted: true, message: transaction.message, request, prompt, invocation, transaction };
  }

  const limits = copyToolExecutionLimits(DEFAULT_TOOL_EXECUTION_LIMITS);
  const admission = await prepareToolDispatchAdmission(
    request,
    agentRequest,
    invocation,
    limits,
    options.routeEvidenceSupplier,
    options.command ?? "pi",
  );
  if (!admission.accepted) {
    const transaction = await recordToolTransaction(cwd, request, {
      id: admission.executionId,
      status: "rejected",
      executed: false,
      invocation,
      limits,
      message: admission.message,
    });
    await appendLogEvent(cwd, createLogEvent(state, { eventType: "tool", summary: transaction.message, taskId: request.taskId, details: { transaction } }));
    return { accepted: false, message: transaction.message, request, prompt, invocation, transaction };
  }
  agentRequest = admission.agentRequest;
  invocation = admission.invocation;
  const claim = await beginToolExecution(cwd, request, invocation, limits, undefined, undefined, admission.executionId, admission.routeAdmission);
  if (!claim.accepted) {
    await appendLogEvent(cwd, createLogEvent(state, { eventType: "tool", summary: claim.transaction.message, taskId: request.taskId, details: { transaction: claim.transaction } }));
    return { accepted: false, message: claim.transaction.message, request: claim.request, prompt, invocation, transaction: claim.transaction };
  }
  const execution = claim.transaction;
  agentRequest.executionId = execution.id;
  const beforeResultIds = new Set((await loadToolResults(cwd)).map((record) => record.id));
  const runResult = await runToolAgentWithOutcome(agentRequest, {
    timeoutMs: options.timeoutMs,
    command: options.command,
    outputLimits: limits,
  }, runner);
  const finalized = await finalizeToolExecution(cwd, request, execution, runResult, beforeResultIds, false);
  const { request: updatedRequest, resultRecord, transaction } = finalized;
  await recordToolExecutionUsage(cwd, runResult.usage, {
    source: "tool-agent-run",
    taskId: request.taskId,
    agentId: request.id,
    agentType: "tool",
  });
  await appendToolExecutionAudit(cwd, state, { eventType: "tool", summary: transaction.message, taskId: request.taskId, details: { transaction, runResult, resultRecord } });
  return {
    accepted: finalized.accepted,
    message: transaction.message,
    request: updatedRequest,
    prompt,
    invocation,
    runResult,
    transaction,
    resultRecord,
  };
}

export function formatToolTransactions(records: ToolTransactionRecord[], requestId?: string, limit = 10): string {
  const filtered = requestId ? records.filter((record) => record.requestId === requestId) : records;
  if (filtered.length === 0) return requestId ? `No tool transactions for ${requestId}.` : "No tool transactions.";
  const lines = [requestId ? `Tool transactions for ${requestId}:` : "Tool transactions:"];
  for (const record of filtered.slice(0, limit)) {
    const run = record.runExitCode === undefined ? "not-run" : `exit=${record.runExitCode} stdout_events=${record.stdoutEventCount ?? 0}`;
    const replay = record.replayOfTransactionId ? ` replayOf=${record.replayOfTransactionId}` : "";
    lines.push(`- ${record.id} request=${record.requestId} tool=${record.toolName} status=${record.status}${replay} ${run} result=${record.resultId ?? "n/a"}: ${record.message}`);
  }
  return lines.join("\n");
}

export async function runToolIterationWorkflow(
  cwd: string,
  state: ScalerState,
  options: ToolIterationWorkflowOptions = {},
  runner: typeof runTaskAgent = runTaskAgent,
): Promise<ToolIterationWorkflowResult> {
  const policy = await loadToolIterationPolicy(cwd);
  const maxIterations = clampIterationLimit(options.maxIterations ?? policy.maxIterations);
  const request = await selectRunnableToolRequest(cwd, options.requestId);
  if (!request) {
    const message = options.requestId ? `Tool iteration rejected: request ${options.requestId} is not prepared.` : "Tool iteration rejected: no prepared tool request.";
    const run = await recordToolIterationRun(cwd, {
      status: "rejected",
      executed: Boolean(options.execute),
      maxIterations,
      autoReplay: policy.autoReplay,
      steps: [],
      message,
    });
    await appendLogEvent(cwd, createLogEvent(state, { eventType: "tool", summary: message, details: { options, run } }));
    return { accepted: false, message, run, steps: [] };
  }

  if (!options.execute) {
    const prepared = await runToolRequestAgent(cwd, state, { requestId: request.id, execute: false, timeoutMs: options.timeoutMs, command: options.command }, runner);
    const step = toolIterationStep(1, "run", prepared);
    const run = await recordToolIterationRun(cwd, {
      request,
      status: prepared.accepted ? "prepared" : "rejected",
      executed: false,
      maxIterations,
      autoReplay: policy.autoReplay,
      steps: [step],
      finalRequestStatus: request.status,
      message: prepared.accepted ? `Tool iteration prepared: ${request.id}` : prepared.message,
    });
    await appendLogEvent(cwd, createLogEvent(state, { eventType: "tool", summary: run.message, taskId: request.taskId, details: { run } }));
    return { accepted: prepared.accepted, message: run.message, request, run, steps: [step] };
  }

  const steps: ToolIterationStepRecord[] = [];
  let currentRequest = request;
  let finalStatus: ToolIterationRunStatus = "missing_result";
  let message = `Tool iteration exhausted: ${request.id}`;

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const latestRequest = (await loadToolRequests(cwd)).find((candidate) => candidate.id === request.id);
    if (!latestRequest || latestRequest.status !== "prepared") {
      currentRequest = latestRequest ?? currentRequest;
      finalStatus = mapToolRequestStatusToIterationStatus(latestRequest?.status);
      message = `Tool iteration stopped: request ${request.id} is ${latestRequest?.status ?? "missing"}`;
      break;
    }
    currentRequest = latestRequest;

    const latestMissing = policy.autoReplay ? await latestMissingResultTransaction(cwd, request.id) : undefined;
    const action: ToolIterationStepAction = latestMissing ? "replay" : "run";
    const result = latestMissing
      ? await replayToolTransaction(cwd, state, {
          transactionId: latestMissing.id,
          execute: true,
          timeoutMs: options.timeoutMs,
          command: options.command,
          routeEvidenceSupplier: options.routeEvidenceSupplier,
        }, runner)
      : await runToolRequestAgent(cwd, state, {
          requestId: request.id,
          execute: true,
          timeoutMs: options.timeoutMs,
          command: options.command,
          routeEvidenceSupplier: options.routeEvidenceSupplier,
        }, runner);
    const step = toolIterationStep(iteration, action, result);
    steps.push(step);

    const afterRequest = (await loadToolRequests(cwd)).find((candidate) => candidate.id === request.id) ?? currentRequest;
    currentRequest = afterRequest;
    if (!result.accepted) {
      finalStatus = "rejected";
      message = result.message;
      break;
    }
    if (afterRequest.status !== "prepared") {
      finalStatus = mapToolRequestStatusToIterationStatus(afterRequest.status);
      message = `Tool iteration completed: request ${request.id} ${afterRequest.status}`;
      break;
    }
    if (step.transactionStatus !== "missing_result") {
      finalStatus = result.accepted ? "missing_result" : "rejected";
      message = result.message;
      break;
    }
    if (!policy.autoReplay) {
      finalStatus = "missing_result";
      message = `Tool iteration stopped after missing structured result: ${request.id}`;
      break;
    }
  }

  if (currentRequest.status === "prepared" && steps.length >= maxIterations && steps.at(-1)?.transactionStatus === "missing_result") {
    finalStatus = "exhausted";
    message = `Tool iteration exhausted after ${maxIterations} iterations: ${request.id}`;
  }

  const run = await recordToolIterationRun(cwd, {
    request: currentRequest,
    status: finalStatus,
    executed: true,
    maxIterations,
    autoReplay: policy.autoReplay,
    steps,
    finalRequestStatus: currentRequest.status,
    message,
  });
  await appendLogEvent(cwd, createLogEvent(state, { eventType: "tool", summary: run.message, taskId: currentRequest.taskId, details: { run } }));
  return { accepted: finalStatus === "completed" || finalStatus === "failed" || finalStatus === "blocked", message, request: currentRequest, run, steps };
}

export async function replayToolTransaction(
  cwd: string,
  state: ScalerState,
  options: ToolTransactionReplayOptions,
  runner: typeof runTaskAgent = runTaskAgent,
): Promise<ToolTransactionReplayResult> {
  const transactionId = options.transactionId.trim();
  const original = (await loadToolTransactions(cwd)).find((candidate) => candidate.id === transactionId);
  if (!original) {
    const message = `Tool transaction replay rejected: transaction ${transactionId || "<missing>"} not found.`;
    await appendLogEvent(cwd, createLogEvent(state, { eventType: "tool", summary: message, details: options }));
    return { accepted: false, message };
  }

  const request = (await loadToolRequests(cwd)).find((candidate) => candidate.id === original.requestId);
  if (!request) {
    const message = `Tool transaction replay rejected: request ${original.requestId} not found.`;
    await appendLogEvent(cwd, createLogEvent(state, { eventType: "tool", summary: message, details: { original } }));
    return { accepted: false, message, original };
  }

  let replayRequest = reconstructReplayTaskRequest(original, cwd);
  let invocation = buildTaskAgentInvocation(replayRequest, options.command ?? original.invocation.command);

  if (!options.execute) {
    const transaction = await recordToolTransaction(cwd, request, {
      status: "prepared",
      executed: false,
      invocation,
      limits: copyToolExecutionLimits(DEFAULT_TOOL_EXECUTION_LIMITS),
      replayOfTransactionId: original.id,
      message: `Tool transaction replay prepared: ${original.id}`,
    });
    await appendLogEvent(cwd, createLogEvent(state, { eventType: "tool", summary: transaction.message, taskId: request.taskId, details: { transaction, original } }));
    return { accepted: true, message: transaction.message, original, request, prompt: replayRequest.prompt, invocation, transaction };
  }

  const limits = copyToolExecutionLimits(DEFAULT_TOOL_EXECUTION_LIMITS);
  const currentPrompt = buildToolAgentPrompt(request, await loadToolSchemaRecords(cwd));
  const replayBasisMatchesCurrentRequest = replayRequest.taskId === `tool-${request.id}`
    && replayRequest.prompt === currentPrompt
    && replayRequest.cwd === cwd
    && JSON.stringify(replayRequest.tools ?? []) === JSON.stringify(request.allowedTools);
  if (!replayBasisMatchesCurrentRequest) {
    const transaction = await recordToolTransaction(cwd, request, {
      status: "rejected",
      executed: false,
      invocation,
      limits,
      replayOfTransactionId: original.id,
      message: "Tool transaction replay dispatch rejected: persisted invocation no longer matches the current request basis.",
    });
    await appendLogEvent(cwd, createLogEvent(state, { eventType: "tool", summary: transaction.message, taskId: request.taskId, details: { transaction, original } }));
    return { accepted: false, message: transaction.message, original, request, prompt: replayRequest.prompt, invocation, transaction };
  }
  const admission = await prepareToolDispatchAdmission(
    request,
    replayRequest,
    invocation,
    limits,
    options.routeEvidenceSupplier,
    options.command ?? original.invocation.command,
  );
  if (!admission.accepted) {
    const transaction = await recordToolTransaction(cwd, request, {
      id: admission.executionId,
      status: "rejected",
      executed: false,
      invocation,
      limits,
      replayOfTransactionId: original.id,
      message: admission.message,
    });
    await appendLogEvent(cwd, createLogEvent(state, { eventType: "tool", summary: transaction.message, taskId: request.taskId, details: { transaction, original } }));
    return { accepted: false, message: transaction.message, original, request, prompt: replayRequest.prompt, invocation, transaction };
  }
  replayRequest = admission.agentRequest;
  invocation = admission.invocation;
  const claim = await beginToolExecution(cwd, request, invocation, limits, original.id, options.approvalId, admission.executionId, admission.routeAdmission);
  if (!claim.accepted) {
    await appendLogEvent(cwd, createLogEvent(state, { eventType: "tool", summary: claim.transaction.message, taskId: request.taskId, details: { transaction: claim.transaction, original } }));
    return { accepted: false, message: claim.transaction.message, original, request: claim.request, prompt: replayRequest.prompt, invocation, transaction: claim.transaction };
  }
  const execution = claim.transaction;
  replayRequest.executionId = execution.id;
  const beforeResultIds = new Set((await loadToolResults(cwd)).map((record) => record.id));
  const runResult = await runToolAgentWithOutcome(replayRequest, {
    timeoutMs: options.timeoutMs,
    command: options.command ?? original.invocation.command,
    outputLimits: limits,
  }, runner);
  const finalized = await finalizeToolExecution(cwd, request, execution, runResult, beforeResultIds, request.status !== "prepared");
  const { request: updatedRequest, resultRecord, transaction } = finalized;
  await recordToolExecutionUsage(cwd, runResult.usage, {
    source: "tool-replay-run",
    taskId: request.taskId,
    agentId: request.id,
    agentType: "tool-replay",
  });
  await appendToolExecutionAudit(cwd, state, { eventType: "tool", summary: transaction.message, taskId: request.taskId, details: { transaction, original, runResult, resultRecord, approval: claim.approval } });
  return {
    accepted: finalized.accepted,
    message: transaction.message,
    original,
    request: updatedRequest,
    prompt: replayRequest.prompt,
    invocation,
    runResult,
    transaction,
    resultRecord,
  };
}

export async function recordToolResult(cwd: string, state: ScalerState, input: ToolResultInput, now = new Date()): Promise<ToolResultRecord> {
  return withToolLedgerWriteQueue(cwd, async () => {
    const requests = await loadToolRequests(cwd);
    const request = requests.find((candidate) => candidate.id === input.requestId.trim());
    if (!request) throw new Error(`Tool result rejected: request ${input.requestId.trim() || "<missing>"} not found.`);
    const executionId = input.executionId?.trim() || undefined;
    let transaction: ToolTransactionRecord | undefined;
    if (executionId) {
      transaction = (await loadToolTransactions(cwd)).find((candidate) => candidate.id === executionId);
      if (request.activeExecutionId !== executionId || transaction?.requestId !== request.id || transaction.status !== "prepared") {
        throw new Error(`Tool result rejected: execution ${executionId} is not the active prepared execution for request ${request.id}.`);
      }
    }
    const limits = transaction?.limits ?? copyToolExecutionLimits(DEFAULT_TOOL_EXECUTION_LIMITS);
    const limitDiagnostics = validateToolExecutionLimits(limits);
    if (limitDiagnostics.length > 0) {
      throw new Error(`Tool result rejected: durable execution limits are invalid: ${limitDiagnostics.join("; ")}.`);
    }

    const status = normalizeToolResultStatus(input.status);
    const summary = input.summary.trim();
    if (!summary) throw new Error("Tool result rejected: summary is required.");
    const evidenceRefs = uniqueNonEmpty(input.evidenceRefs ?? []);
    const validationPerformed = uniqueNonEmpty(input.validationPerformed ?? []);
    const errors = uniqueNonEmpty(input.errors ?? []);
    const recommendations = uniqueNonEmpty(input.recommendations ?? []);
    if (status === "completed" && input.outputs === undefined && evidenceRefs.length === 0 && validationPerformed.length === 0) {
      throw new Error("Tool result rejected: completed results require outputs, evidenceRefs, or validationPerformed.");
    }
    if ((status === "failed" || status === "blocked") && errors.length === 0 && recommendations.length === 0) {
      throw new Error("Tool result rejected: failed/blocked results require errors or recommendations.");
    }

    const normalizedOutputs = input.outputs === undefined ? undefined : normalizeJsonValue(input.outputs, "outputs");
    let record: ToolResultRecord = {
      id: randomUUID(),
      requestId: request.id,
      executionId,
      acceptanceStatus: executionId ? "proposed" : "unbound",
      acceptanceMessage: executionId
        ? "Awaiting parent process-outcome and execution-binding checks."
        : "Unbound result cannot satisfy an isolated execution.",
      taskId: request.taskId,
      toolName: request.toolName,
      status,
      summary,
      outputs: normalizedOutputs,
      evidenceRefs: evidenceRefs.length > 0 ? evidenceRefs : undefined,
      validationPerformed: validationPerformed.length > 0 ? validationPerformed : undefined,
      errors: errors.length > 0 ? errors : undefined,
      recommendations: recommendations.length > 0 ? recommendations : undefined,
      createdAt: now.toISOString(),
    };
    record = withMeasuredToolResultBytes(record);
    if (record.serializedBytes! > limits.resultBytes) {
      throw new Error(`Tool result rejected: serialized result ${record.serializedBytes} bytes exceeds runtime limit ${limits.resultBytes} bytes.`);
    }

    const results = await loadToolResults(cwd);
    await writeToolResultIndex(cwd, [record, ...results]);
    await appendLogEvent(
      cwd,
      createLogEvent(state, {
        eventType: "tool",
        summary: `Tool result proposal recorded: ${record.toolName} ${record.status}`,
        taskId: record.taskId,
        outputRefs: [record.id, record.requestId],
        details: { record },
      }),
    );
    return record;
  });
}

export async function prepareToolRequest(
  cwd: string,
  state: ScalerState,
  input: ToolRequestInput,
  now = new Date(),
): Promise<ToolRequestPrepareResult> {
  if (!input.toolName.trim()) {
    return rejectToolRequest(cwd, state, input, "Tool request rejected: toolName is required");
  }
  if (!input.request.trim()) {
    return rejectToolRequest(cwd, state, input, "Tool request rejected: request is required");
  }

  const record: ToolRequestRecord = {
    id: randomUUID(),
    taskId: input.taskId,
    requesterAgentId: input.requesterAgentId?.trim() || undefined,
    toolName: input.toolName.trim(),
    request: input.request.trim(),
    contextSummary: input.contextSummary?.trim() || undefined,
    expectedOutput: input.expectedOutput?.trim() || undefined,
    requiredFormat: input.requiredFormat?.trim() || undefined,
    riskLevel: normalizeToolRiskLevel(input.riskLevel),
    permissionRequirement: input.permissionRequirement?.trim() || undefined,
    safetyNotes: input.safetyNotes?.trim() || undefined,
    allowedTools: uniqueNonEmpty([input.toolName, ...(input.allowedTools ?? [])]),
    status: "prepared",
    createdAt: now.toISOString(),
  };
  const prompt = buildToolAgentPrompt(record, await loadToolSchemaRecords(cwd));
  const invocation = buildTaskAgentInvocation({
    taskId: `tool-${record.id}`,
    prompt,
    tools: record.allowedTools,
    cwd,
  });

  await withToolLedgerWriteQueue(cwd, async () => {
    const requests = await loadToolRequests(cwd);
    await writeToolRequestIndex(cwd, [...requests, record]);
  });
  await appendLogEvent(
    cwd,
    createLogEvent(state, {
      eventType: "tool",
      summary: `Tool request prepared: ${record.toolName}`,
      taskId: record.taskId,
      details: { record, invocation },
    }),
  );

  return {
    accepted: true,
    message: `Tool request prepared: ${record.id}`,
    record,
    prompt,
    invocation,
  };
}

export function buildToolSchemaDiscoveryPrompt(toolName: string, discoveredRecords: ToolSchemaRecord[] = [], explicitlyGrantedTools: string[] = []): string {
  const allowedTools = uniqueNonEmpty(["scaler_tool_schema", ...explicitlyGrantedTools]);
  const existing = formatDiscoveredToolCatalog([toolName], discoveredRecords);
  return [
    "You are an isolated SCALER Tool/MCP schema discovery agent.",
    "Your job is to discover concise docs/schema metadata for exactly one target tool.",
    "Do not assume the target tool or any external MCP/browser/internet tool is available unless it appears in Allowed tools below.",
    "Use only explicitly allowed tools. If only scaler_tool_schema is allowed, record known local metadata or mark uncertainty in notes without probing external systems.",
    "Complete by calling the structured `scaler_tool_schema` tool exactly once with toolName, source, description/risk/docs/schema refs, notes, evidence refs, and discoveredByAgentId when known.",
    "Do not rely on free-form prose as the completion signal; SCALER ingests only structured schema records.",
    `Target tool/MCP: ${toolName}`,
    `Allowed tools: ${allowedTools.join(", ")}`,
    existing,
  ].join("\n");
}

export function buildToolAgentPrompt(record: ToolRequestRecord, discoveredRecords: ToolSchemaRecord[] = []): string {
  const context = record.contextSummary ? `\nContext summary:\n${record.contextSummary}\n` : "";
  const metadata = [
    record.requesterAgentId ? `Requester agent id: ${record.requesterAgentId}` : undefined,
    record.expectedOutput ? `Expected output: ${record.expectedOutput}` : undefined,
    record.requiredFormat ? `Required format: ${record.requiredFormat}` : undefined,
    `Risk level: ${record.riskLevel}`,
    record.permissionRequirement ? `Permission requirement: ${record.permissionRequirement}` : undefined,
    record.safetyNotes ? `Safety notes: ${record.safetyNotes}` : undefined,
  ].filter((line): line is string => Boolean(line));
  return [
    "You are an isolated SCALER tool agent.",
    "Use only the explicitly allowed tool(s) for this request.",
    "Do not assume access to unrelated tools or MCP servers.",
    "If tool usage is uncertain, inspect available schema/help first.",
    "Prefer dry-run/read-only behavior for risky actions when possible.",
    "Complete the request by calling the structured `scaler_tool_result` tool exactly once with requestId, status, summary, outputs/evidence, validation performed, and any errors.",
    "Do not rely on free-form prose as the completion signal; SCALER ingests only structured tool results.",
    `Tool request id: ${record.id}`,
    `Requested tool/MCP: ${record.toolName}`,
    `Allowed tools: ${record.allowedTools.join(", ")}`,
    formatToolCatalog(getToolCatalogEntries(record.allowedTools, discoveredRecords)),
    metadata.join("\n"),
    context.trimEnd(),
    `Request:\n${record.request}`,
  ]
    .filter((part) => part.length > 0)
    .join("\n\n");
}

async function rejectToolRequest(
  cwd: string,
  state: ScalerState,
  input: ToolRequestInput,
  message: string,
): Promise<ToolRequestPrepareResult> {
  await appendLogEvent(
    cwd,
    createLogEvent(state, {
      eventType: "tool",
      summary: message,
      taskId: input.taskId,
      details: input,
    }),
  );
  return { accepted: false, message };
}

async function writeToolRequestIndex(cwd: string, requests: ToolRequestRecord[]): Promise<void> {
  const path = getToolRequestsIndexPath(cwd);
  await publishToolExecutionIndex(path, { version: 1, requests } satisfies ToolRequestIndex);
}

async function writeToolResultIndex(cwd: string, results: ToolResultRecord[]): Promise<void> {
  const path = getToolResultsPath(cwd);
  const sorted = [...results].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  await publishToolExecutionIndex(path, { version: 1, results: sorted } satisfies ToolResultIndex);
}

async function writeToolTransactionIndex(cwd: string, transactions: ToolTransactionRecord[]): Promise<void> {
  const path = getToolTransactionsPath(cwd);
  const sorted = [...transactions].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  await publishToolExecutionIndex(path, { version: 1, transactions: sorted } satisfies ToolTransactionIndex);
}

// Readers see either complete snapshot. This is not a transaction across indexes.
async function publishToolExecutionIndex(path: string, index: unknown): Promise<void> {
  // Result byte admission measures compact JSON. Use the same representation
  // on disk so nested values cannot amplify through pretty-print indentation.
  const contents = `${JSON.stringify(index)}\n`;
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  const file = await open(temporary, "wx", 0o600);
  try {
    try {
      await file.writeFile(contents, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function writeToolSchemaIndex(cwd: string, records: ToolSchemaRecord[]): Promise<void> {
  const path = getToolCatalogPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  const sorted = [...records].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  await writeFile(path, `${JSON.stringify({ version: 1, records: sorted } satisfies ToolSchemaIndex, null, 2)}\n`, "utf8");
}

async function writeToolSchemaDiscoveryRunIndex(cwd: string, runs: ToolSchemaDiscoveryRunRecord[]): Promise<void> {
  const path = getToolSchemaDiscoveryRunsPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  const sorted = [...runs].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  await writeFile(path, `${JSON.stringify({ version: 1, runs: sorted } satisfies ToolSchemaDiscoveryRunIndex, null, 2)}\n`, "utf8");
}

async function writeToolIterationRunIndex(cwd: string, runs: ToolIterationRunRecord[]): Promise<void> {
  const path = getToolIterationRunsPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  const sorted = [...runs].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  await writeFile(path, `${JSON.stringify({ version: 1, runs: sorted } satisfies ToolIterationRunIndex, null, 2)}\n`, "utf8");
}

async function writeToolReplayApprovalIndex(cwd: string, approvals: ToolReplayApprovalRecord[]): Promise<void> {
  const path = getToolReplayApprovalsPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  const sorted = [...approvals].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  await writeFile(path, `${JSON.stringify({ version: 1, approvals: sorted } satisfies ToolReplayApprovalIndex, null, 2)}\n`, "utf8");
}

async function writeMcpServerCatalog(cwd: string, catalog: McpServerCatalog): Promise<void> {
  const path = getMcpServersPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  const records = [...catalog.records].sort((left, right) => `${left.sourcePath}:${left.name}`.localeCompare(`${right.sourcePath}:${right.name}`));
  const runs = [...catalog.runs].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  await writeFile(path, `${JSON.stringify({ version: 1, records, runs } satisfies McpServerCatalog, null, 2)}\n`, "utf8");
}

async function writeToolScheduleIndex(cwd: string, schedules: ToolScheduleRecord[]): Promise<void> {
  const path = getToolSchedulesPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  const sorted = [...schedules].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  await writeFile(path, `${JSON.stringify({ version: 1, schedules: sorted } satisfies ToolScheduleIndex, null, 2)}\n`, "utf8");
}

async function recordToolSchemaDiscoveryRun(
  cwd: string,
  input: {
    toolName: string;
    status: ToolSchemaDiscoveryRunStatus;
    executed: boolean;
    allowedTools: string[];
    invocation: TaskAgentInvocation;
    runResult?: TaskAgentRunResult;
    schemaRecordId?: string;
    message: string;
  },
  now = new Date(),
): Promise<ToolSchemaDiscoveryRunRecord> {
  const timestamp = now.toISOString();
  const record: ToolSchemaDiscoveryRunRecord = {
    id: randomUUID(),
    toolName: input.toolName,
    status: input.status,
    executed: input.executed,
    allowedTools: input.allowedTools,
    invocation: input.invocation,
    runExitCode: input.runResult?.exitCode,
    stdoutEventCount: input.runResult?.stdoutEvents.length,
    stderrSummary: input.runResult ? summarizeOutput(input.runResult.stderr) : undefined,
    schemaRecordId: input.schemaRecordId,
    usage: input.runResult?.usage,
    message: input.message,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await writeToolSchemaDiscoveryRunIndex(cwd, [record, ...(await loadToolSchemaDiscoveryRuns(cwd))]);
  return record;
}

async function recordToolIterationRun(
  cwd: string,
  input: {
    request?: ToolRequestRecord;
    status: ToolIterationRunStatus;
    executed: boolean;
    maxIterations: number;
    autoReplay: boolean;
    steps: ToolIterationStepRecord[];
    finalRequestStatus?: ToolRequestStatus;
    message: string;
  },
  now = new Date(),
): Promise<ToolIterationRunRecord> {
  const timestamp = now.toISOString();
  const record: ToolIterationRunRecord = {
    id: randomUUID(),
    requestId: input.request?.id,
    taskId: input.request?.taskId,
    toolName: input.request?.toolName,
    status: input.status,
    executed: input.executed,
    maxIterations: input.maxIterations,
    autoReplay: input.autoReplay,
    steps: input.steps,
    finalRequestStatus: input.finalRequestStatus,
    message: input.message,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await writeToolIterationRunIndex(cwd, [record, ...(await loadToolIterationRuns(cwd))]);
  return record;
}

async function recordToolSchedule(
  cwd: string,
  input: {
    status: ToolScheduleStatus;
    executed: boolean;
    parallelism: number;
    steps: ToolScheduleStepRecord[];
    message: string;
  },
  now = new Date(),
): Promise<ToolScheduleRecord> {
  const timestamp = now.toISOString();
  const record: ToolScheduleRecord = {
    id: randomUUID(),
    status: input.status,
    executed: input.executed,
    parallelism: input.parallelism,
    parallelRequestIds: input.steps.filter((step) => step.mode === "parallel").map((step) => step.requestId),
    serialRequestIds: input.steps.filter((step) => step.mode === "serial").map((step) => step.requestId),
    steps: input.steps,
    message: input.message,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await writeToolScheduleIndex(cwd, [record, ...(await loadToolSchedules(cwd))]);
  return record;
}

function compactToolDescription(description: string): string {
  const firstLine = description.replace(/\s+/g, " ").trim();
  return firstLine.length > 160 ? `${firstLine.slice(0, 157)}...` : firstLine;
}

function summarizeRuntimeToolSource(sourceInfo: unknown): string | undefined {
  if (!sourceInfo || typeof sourceInfo !== "object") return undefined;
  const record = sourceInfo as Record<string, unknown>;
  const parts = [record.type, record.name, record.packageName, record.extensionName]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim());
  return parts.length > 0 ? parts.join(":") : undefined;
}

function latestToolSchemaRecords(records: ToolSchemaRecord[]): Map<string, ToolSchemaRecord> {
  const sorted = [...records].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const latest = new Map<string, ToolSchemaRecord>();
  for (const record of sorted) {
    if (!latest.has(record.toolName)) latest.set(record.toolName, record);
  }
  return latest;
}

async function selectRunnableToolRequest(cwd: string, requestId?: string): Promise<ToolRequestRecord | undefined> {
  const requests = await loadToolRequests(cwd);
  const prepared = requests.filter((request) => request.status === "prepared");
  if (requestId) return prepared.find((request) => request.id === requestId.trim());
  return prepared.sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0];
}

async function runToolAgentWithOutcome(
  request: TaskAgentRequest,
  options: RunTaskAgentOptions,
  runner: typeof runTaskAgent,
): Promise<TaskAgentRunResult> {
  try {
    return normalizeToolRunMeasurements(await runner(request, options), options.outputLimits ?? DEFAULT_TASK_AGENT_OUTPUT_LIMITS);
  } catch (error) {
    return {
      taskId: request.taskId,
      exitCode: 1,
      stdoutEvents: [],
      stderr: `Tool runner failed before a successful process outcome was observed: ${error instanceof Error ? error.message : String(error)}`,
      timedOut: false,
      aborted: false,
      stdoutBytes: 0,
      stderrBytes: 0,
    };
  }
}

function normalizeToolRunMeasurements(result: TaskAgentRunResult, limits: TaskAgentOutputLimits): TaskAgentRunResult {
  const stdoutBytes = result.stdoutBytes === undefined
    ? Number.MAX_SAFE_INTEGER
    : isNonNegativeSafeInteger(result.stdoutBytes) ? result.stdoutBytes : Number.MAX_SAFE_INTEGER;
  const stderrBytes = result.stderrBytes === undefined
    ? Number.MAX_SAFE_INTEGER
    : isNonNegativeSafeInteger(result.stderrBytes) ? result.stderrBytes : Number.MAX_SAFE_INTEGER;
  const outputLimitExceeded = result.outputLimitExceeded
    ?? (stdoutBytes > limits.stdoutBytes ? "stdout" : stderrBytes > limits.stderrBytes ? "stderr" : undefined);
  return { ...result, stdoutBytes, stderrBytes, outputLimitExceeded };
}

async function prepareToolDispatchAdmission(
  request: ToolRequestRecord,
  baseAgentRequest: TaskAgentRequest,
  baseInvocation: TaskAgentInvocation,
  limits: ToolExecutionLimits,
  supplier: ToolDispatchRouteEvidenceSupplier | undefined,
  command: string,
): Promise<
  | { accepted: true; executionId: string; agentRequest: TaskAgentRequest; invocation: TaskAgentInvocation; routeAdmission: ToolDispatchAdmissionRecord }
  | { accepted: false; executionId: string; message: string }
> {
  const executionId = randomUUID();
  const refuse = (reason: string) => ({
    accepted: false as const,
    executionId,
    message: `Tool transaction dispatch rejected: ${reason}.`,
  });
  if (!supplier) return refuse("a live route evidence supplier is required for isolated execution");

  const requestFingerprint = fingerprintToolRequest(request);
  const basis: ToolDispatchRouteBasis = Object.freeze({
    version: 1,
    requestId: request.id,
    executionId,
    requestFingerprint,
    invocationFingerprint: fingerprintInvocation(baseInvocation),
    toolNames: Object.freeze([...request.allowedTools]),
    resultBytesReserve: limits.resultBytes,
  });

  let snapshot: ToolDispatchRouteSnapshot;
  try {
    snapshot = structuredClone(await supplier(basis));
  } catch {
    return refuse("live route evidence supplier failed");
  }
  if (!isPlainObject(snapshot)
    || snapshot.version !== 1
    || snapshot.requestId !== request.id
    || snapshot.executionId !== executionId
    || !isPlainObject(snapshot.evidence)) {
    return refuse("live route evidence is malformed or bound to another request/execution");
  }
  if (snapshot.evidence.isolationRequirement !== "capability"
    && snapshot.evidence.isolationRequirement !== "focus"
    && snapshot.evidence.isolationRequirement !== "evidence-independence") {
    return refuse("live route evidence lacks an explicit isolation requirement");
  }

  const routeRequest = buildToolRouteRequestBasis(request, executionId);
  const assessment = assessToolRoute({ ...snapshot.evidence, request: routeRequest });
  if (assessment.route !== "isolated") {
    return refuse(`live route recomputation recommended ${assessment.route} (${assessment.reasonCode})`);
  }
  if (!assessment.evidenceFingerprint || !assessment.profileFingerprint || assessment.selectedEstimatedOverheadUpperBound === null) {
    return refuse("live route recomputation did not produce complete compact identity");
  }

  const isolated = isPlainObject(snapshot.evidence.isolated) ? snapshot.evidence.isolated : undefined;
  const callerContinuation = Array.isArray(isolated?.legs)
    ? isolated.legs.find((leg) => isPlainObject(leg) && leg.role === "caller-continuation")
    : undefined;
  if (!isPlainObject(callerContinuation)
    || !Number.isSafeInteger(callerContinuation.additionalContextBytes)
    || (callerContinuation.additionalContextBytes as number) < limits.resultBytes) {
    return refuse("caller continuation does not include the runtime-owned result reserve");
  }
  const worker = Array.isArray(isolated?.legs)
    ? isolated.legs.find((leg) => isPlainObject(leg) && leg.role === "worker")
    : undefined;
  if (!isPlainObject(worker) || !isPlainObject(worker.model) || !isPlainObject(worker.policy)) {
    return refuse("live worker provider evidence is missing");
  }
  const modelId = typeof worker.model.id === "string" && worker.model.id.trim().length > 0
    ? worker.model.id.trim()
    : undefined;
  const modelApi = typeof worker.model.api === "string" && worker.model.api.trim().length > 0 ? worker.model.api.trim() : undefined;
  const modelProvider = typeof worker.model.provider === "string" && worker.model.provider.trim().length > 0 ? worker.model.provider.trim() : undefined;
  const modelContextWindow = typeof worker.model.contextWindow === "number" && Number.isSafeInteger(worker.model.contextWindow) && worker.model.contextWindow > 0
    ? worker.model.contextWindow
    : undefined;
  if (!modelId || !modelApi || !modelProvider || modelContextWindow === undefined) return refuse("live worker model identity is missing");
  const providerAdmission = {
    requestTokenAllowance: worker.policy.requestTokenAllowance,
    outputReserveTokens: worker.policy.outputReserveTokens,
    safetyMarginTokens: worker.policy.safetyMarginTokens,
  };
  if (!Object.values(providerAdmission).every((value) => typeof value === "number")) {
    return refuse("live worker provider policy is malformed");
  }

  const agentRequest: TaskAgentRequest = {
    ...baseAgentRequest,
    model: modelId,
    providerAdmission: providerAdmission as TaskAgentRequest["providerAdmission"],
    providerAdmissionModel: {
      api: modelApi,
      provider: modelProvider,
      id: modelId,
      contextWindow: modelContextWindow,
    },
  };
  let invocation: TaskAgentInvocation;
  try {
    invocation = buildTaskAgentInvocation(agentRequest, command);
  } catch (error) {
    return refuse(`strict worker invocation could not be built: ${error instanceof Error ? error.message : String(error)}`);
  }
  const routeAdmission: ToolDispatchAdmissionRecord = {
    version: 1,
    route: "isolated",
    authorized: true,
    requestFingerprint,
    invocationFingerprint: fingerprintInvocation(invocation),
    evidenceFingerprint: assessment.evidenceFingerprint,
    profileFingerprint: assessment.profileFingerprint,
    modelId,
    selectedEstimatedOverheadUpperBound: assessment.selectedEstimatedOverheadUpperBound,
  };
  return { accepted: true, executionId, agentRequest, invocation, routeAdmission };
}

function buildToolRouteRequestBasis(request: ToolRequestRecord, executionId?: string): ToolRouteAssessmentInput["request"] {
  return {
    requestId: request.id,
    taskId: request.taskId,
    attemptId: executionId,
    toolNames: [...request.allowedTools],
    content: {
      toolName: request.toolName,
      request: request.request,
      requesterAgentId: request.requesterAgentId,
      contextSummary: request.contextSummary,
      expectedOutput: request.expectedOutput,
      requiredFormat: request.requiredFormat,
      riskLevel: request.riskLevel,
      permissionRequirement: request.permissionRequirement,
      safetyNotes: request.safetyNotes,
    },
  };
}

function fingerprintToolRequest(request: ToolRequestRecord): string {
  return createHash("sha256").update(JSON.stringify({
    id: request.id,
    taskId: request.taskId,
    requesterAgentId: request.requesterAgentId,
    toolName: request.toolName,
    request: request.request,
    contextSummary: request.contextSummary,
    expectedOutput: request.expectedOutput,
    requiredFormat: request.requiredFormat,
    riskLevel: request.riskLevel,
    permissionRequirement: request.permissionRequirement,
    safetyNotes: request.safetyNotes,
    allowedTools: request.allowedTools,
    status: request.status,
    createdAt: request.createdAt,
  }), "utf8").digest("hex");
}

function fingerprintInvocation(invocation: TaskAgentInvocation): string {
  return createHash("sha256").update(JSON.stringify({
    command: invocation.command,
    args: invocation.args,
    cwd: invocation.cwd,
  }), "utf8").digest("hex");
}

async function beginToolExecution(
  cwd: string,
  request: ToolRequestRecord,
  invocation: TaskAgentInvocation,
  limits: ToolExecutionLimits,
  replayOfTransactionId?: string,
  approvalId?: string,
  executionId: string = randomUUID(),
  routeAdmission?: ToolDispatchAdmissionRecord,
): Promise<{ accepted: boolean; request: ToolRequestRecord; transaction: ToolTransactionRecord; approval?: ToolReplayApprovalRecord }> {
  return withToolLedgerWriteQueue(cwd, async () => {
    const requests = await loadToolRequests(cwd);
    const transactions = await loadToolTransactions(cwd);
    const approvals = replayOfTransactionId ? await loadToolReplayApprovals(cwd) : [];
    const currentRequest = requests.find((candidate) => candidate.id === request.id);
    const timestamp = new Date().toISOString();
    const limitDiagnostics = validateToolExecutionLimits(limits);
    const requiresApproval = Boolean(replayOfTransactionId && currentRequest && currentRequest.status !== "prepared");
    const approval = requiresApproval
      ? approvals.find((candidate) => candidate.id === approvalId?.trim()
        && candidate.transactionId === replayOfTransactionId
        && candidate.requestId === request.id
        && candidate.status === "active"
        && candidate.uses < candidate.maxUses
        && (!candidate.expiresAt || candidate.expiresAt > timestamp))
      : undefined;
    const approvalRefusal = requiresApproval && !approval
      ? approvalId?.trim()
        ? `request ${request.id} is ${currentRequest!.status}; approval ${approvalId.trim()} is not usable`
        : `request ${request.id} is ${currentRequest!.status}; no approval supplied`
      : undefined;
    const currentRequestFingerprint = currentRequest ? fingerprintToolRequest(currentRequest) : undefined;
    const refusal = limitDiagnostics.length > 0
      ? `invalid runtime execution limits: ${limitDiagnostics.join("; ")}`
      : !routeAdmission
        ? "live isolated route admission is missing"
        : !currentRequest
          ? `request ${request.id} disappeared before dispatch`
          : currentRequestFingerprint !== routeAdmission.requestFingerprint
            ? `request ${request.id} changed while live route admission was evaluated`
            : fingerprintInvocation(invocation) !== routeAdmission.invocationFingerprint
              ? `invocation for request ${request.id} changed after live route admission`
              : currentRequest.status !== request.status
                ? `request status changed from ${request.status} to ${currentRequest.status} before dispatch`
                : currentRequest.activeExecutionId
                  ? `request ${request.id} already has active execution ${currentRequest.activeExecutionId}`
                  : approvalRefusal;
    const transaction: ToolTransactionRecord = {
      id: executionId,
      requestId: request.id,
      taskId: request.taskId,
      toolName: request.toolName,
      status: refusal ? "rejected" : "prepared",
      executed: !refusal,
      invocation,
      limits: copyToolExecutionLimits(limits),
      routeAdmission,
      replayOfTransactionId,
      message: refusal
        ? `Tool transaction ${replayOfTransactionId ? "replay " : ""}dispatch rejected: ${refusal}.`
        : `${replayOfTransactionId ? "Tool transaction replay execution" : "Tool execution"} prepared: ${request.id}`,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const claimedRequest = refusal || !currentRequest
      ? currentRequest ?? request
      : { ...currentRequest, activeExecutionId: transaction.id, updatedAt: timestamp };
    const reservedApproval = approval && !refusal
      ? {
          ...approval,
          uses: approval.uses + 1,
          status: approval.uses + 1 >= approval.maxUses ? "consumed" as const : approval.status,
          consumedByTransactionIds: uniqueNonEmpty([...(approval.consumedByTransactionIds ?? []), transaction.id]),
          updatedAt: timestamp,
        }
      : undefined;
    const expiredApproval = !approval && approvalId?.trim()
      ? approvals.find((candidate) => candidate.id === approvalId.trim() && candidate.status === "active" && candidate.expiresAt && candidate.expiresAt <= timestamp)
      : undefined;
    await writeToolTransactionIndex(cwd, [transaction, ...transactions]);
    if (reservedApproval || expiredApproval) {
      const updatedApproval = reservedApproval ?? { ...expiredApproval!, status: "expired" as const, updatedAt: timestamp };
      await writeToolReplayApprovalIndex(cwd, approvals.map((candidate) => candidate.id === updatedApproval.id ? updatedApproval : candidate));
    }
    if (!refusal && currentRequest) {
      await writeToolRequestIndex(cwd, requests.map((candidate) => candidate.id === currentRequest.id ? claimedRequest : candidate));
    }
    return { accepted: !refusal, request: claimedRequest, transaction, approval: reservedApproval };
  });
}

async function finalizeToolExecution(
  cwd: string,
  request: ToolRequestRecord,
  execution: ToolTransactionRecord,
  runResult: TaskAgentRunResult,
  beforeResultIds: Set<string>,
  preserveClosedRequestOnFailure: boolean,
): Promise<{
  accepted: boolean;
  status: ToolTransactionStatus;
  request: ToolRequestRecord;
  transaction: ToolTransactionRecord;
  resultRecord?: ToolResultRecord;
}> {
  return withToolLedgerWriteQueue(cwd, async () => {
    const requests = await loadToolRequests(cwd);
    const results = await loadToolResults(cwd);
    const transactions = await loadToolTransactions(cwd);
    const currentRequest = requests.find((candidate) => candidate.id === request.id);
    const currentExecution = transactions.find((candidate) => candidate.id === execution.id);
    const boundResults = results.filter((candidate) => candidate.requestId === request.id
      && candidate.executionId === execution.id
      && !beforeResultIds.has(candidate.id));
    const expectedLimits = execution.limits;
    const limitDiagnostics = expectedLimits ? validateToolExecutionLimits(expectedLimits) : ["limits are missing"];
    const measurementsValid = limitDiagnostics.length === 0
      && isNonNegativeSafeInteger(runResult.stdoutBytes)
      && isNonNegativeSafeInteger(runResult.stderrBytes)
      && runResult.stdoutBytes <= expectedLimits!.stdoutBytes
      && runResult.stderrBytes <= expectedLimits!.stderrBytes
      && runResult.outputLimitExceeded === undefined;
    const processSucceeded = runResult.exitCode === 0 && !runResult.timedOut && !runResult.aborted && measurementsValid;
    const requestUnchanged = currentRequest?.status === request.status && currentRequest.activeExecutionId === execution.id;
    const executionUnchanged = currentExecution?.status === "prepared"
      && currentExecution.requestId === execution.requestId
      && currentExecution.toolName === execution.toolName
      && currentExecution.createdAt === execution.createdAt
      && currentExecution.replayOfTransactionId === execution.replayOfTransactionId
      && JSON.stringify(currentExecution.invocation) === JSON.stringify(execution.invocation)
      && JSON.stringify(currentExecution.limits) === JSON.stringify(execution.limits)
      && JSON.stringify(currentExecution.routeAdmission) === JSON.stringify(execution.routeAdmission)
      && execution.routeAdmission?.authorized === true
      && execution.routeAdmission.route === "isolated"
      && fingerprintToolRequest(currentRequest ?? request) === execution.routeAdmission.requestFingerprint
      && fingerprintInvocation(execution.invocation) === execution.routeAdmission.invocationFingerprint;
    const ownershipUnchanged = requestUnchanged && executionUnchanged;
    const soleBoundResult = boundResults.length === 1 ? boundResults[0] : undefined;
    const measuredResultBytes = soleBoundResult ? measureToolResultBytes(soleBoundResult) : undefined;
    const acceptedResultProjection = soleBoundResult ? withMeasuredToolResultBytes({
      ...soleBoundResult,
      acceptanceStatus: "accepted",
      acceptanceMessage: `Accepted by parent execution ${execution.id} after successful process completion.`,
    }) : undefined;
    const resultBytesValid = Boolean(soleBoundResult
      && expectedLimits
      && isNonNegativeSafeInteger(soleBoundResult.serializedBytes)
      && measuredResultBytes === soleBoundResult.serializedBytes
      && measuredResultBytes <= expectedLimits.resultBytes
      && acceptedResultProjection!.serializedBytes! <= expectedLimits.resultBytes);
    const accepted = processSucceeded && ownershipUnchanged && boundResults.length === 1 && resultBytesValid;
    const proposedResult = accepted ? acceptedResultProjection : undefined;
    const status: ToolTransactionStatus = accepted ? proposedResult!.status : "blocked";
    const failureReason = !measurementsValid
      ? `process output limits invalid or exceeded: stdout=${String(runResult.stdoutBytes)} stderr=${String(runResult.stderrBytes)} exceeded=${runResult.outputLimitExceeded ?? "none"}`
      : !processSucceeded
        ? `process outcome exit=${runResult.exitCode} timedOut=${runResult.timedOut} aborted=${runResult.aborted}`
      : !requestUnchanged
        ? `request or active execution changed from ${request.status}/${execution.id} to ${currentRequest?.status ?? "missing"}/${currentRequest?.activeExecutionId ?? "none"}`
        : !executionUnchanged
          ? `durable execution ${execution.id} is missing or no longer matches its prepared identity`
        : boundResults.length === 0
          ? "no fresh result matched the execution identity"
          : boundResults.length !== 1
            ? `expected one execution-bound result, received ${boundResults.length}`
            : `execution-bound result failed serialized result limit or durable byte-identity checks: measured=${String(measuredResultBytes)} recorded=${String(soleBoundResult?.serializedBytes)} limit=${String(expectedLimits?.resultBytes)}`;
    const timestamp = new Date().toISOString();
    const updatedResults = results.map((candidate): ToolResultRecord => {
      if (!boundResults.some((bound) => bound.id === candidate.id)) return candidate;
      const isAccepted = accepted && candidate.id === proposedResult!.id;
      return withMeasuredToolResultBytes({
        ...candidate,
        acceptanceStatus: isAccepted ? "accepted" : "rejected",
        acceptanceMessage: isAccepted
          ? `Accepted by parent execution ${execution.id} after successful process completion.`
          : `Rejected by parent execution ${execution.id}: ${failureReason}.`,
      });
    });
    const resultRecord = proposedResult
      ? updatedResults.find((candidate) => candidate.id === proposedResult.id)
      : undefined;
    const updatedRequest: ToolRequestRecord = !ownershipUnchanged
      ? currentRequest ?? request
      : accepted
        ? { ...currentRequest!, status: resultRecord!.status, activeExecutionId: undefined, updatedAt: timestamp }
        : preserveClosedRequestOnFailure && currentRequest && currentRequest.status !== "prepared"
          ? { ...currentRequest, activeExecutionId: undefined, updatedAt: timestamp }
          : { ...currentRequest!, status: "blocked", activeExecutionId: undefined, updatedAt: timestamp };
    const message = accepted
      ? `${execution.replayOfTransactionId ? "Tool transaction replay" : "Tool transaction"} completed: ${request.id} ${status}`
      : `${execution.replayOfTransactionId ? "Tool transaction replay" : "Tool transaction"} blocked: ${request.id}; ${failureReason}`;
    const transaction: ToolTransactionRecord = {
      ...execution,
      status,
      runExitCode: runResult.exitCode,
      stdoutEventCount: runResult.stdoutEvents.length,
      stdoutBytes: runResult.stdoutBytes,
      stderrBytes: runResult.stderrBytes,
      outputLimitExceeded: runResult.outputLimitExceeded,
      stderrSummary: summarizeOutput(runResult.stderr),
      resultId: resultRecord?.id,
      usage: runResult.usage,
      message,
      updatedAt: timestamp,
    };
    await writeToolResultIndex(cwd, updatedResults);
    if (executionUnchanged) {
      await writeToolTransactionIndex(cwd, transactions.map((candidate) => candidate.id === execution.id ? transaction : candidate));
    }
    if (ownershipUnchanged && currentRequest) {
      await writeToolRequestIndex(cwd, requests.map((candidate) => candidate.id === updatedRequest.id ? updatedRequest : candidate));
    }
    return { accepted, status, request: updatedRequest, transaction, resultRecord };
  });
}

async function recordToolTransaction(
  cwd: string,
  request: ToolRequestRecord,
  input: {
    id?: string;
    status: ToolTransactionStatus;
    executed: boolean;
    invocation: TaskAgentInvocation;
    limits?: ToolExecutionLimits;
    routeAdmission?: ToolDispatchAdmissionRecord;
    runResult?: TaskAgentRunResult;
    resultId?: string;
    replayOfTransactionId?: string;
    message: string;
  },
  now = new Date(),
): Promise<ToolTransactionRecord> {
  const timestamp = now.toISOString();
  const record: ToolTransactionRecord = {
    id: input.id ?? randomUUID(),
    requestId: request.id,
    taskId: request.taskId,
    toolName: request.toolName,
    status: input.status,
    executed: input.executed,
    invocation: input.invocation,
    limits: input.limits ? copyToolExecutionLimits(input.limits) : undefined,
    routeAdmission: input.routeAdmission,
    runExitCode: input.runResult?.exitCode,
    stdoutEventCount: input.runResult?.stdoutEvents.length,
    stderrSummary: input.runResult ? summarizeOutput(input.runResult.stderr) : undefined,
    resultId: input.resultId,
    usage: input.runResult?.usage,
    replayOfTransactionId: input.replayOfTransactionId,
    message: input.message,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await withToolLedgerWriteQueue(cwd, async () => {
    await writeToolTransactionIndex(cwd, [record, ...(await loadToolTransactions(cwd))]);
  });
  return record;
}

function reconstructReplayTaskRequest(transaction: ToolTransactionRecord, cwd: string): TaskAgentRequest {
  const prompt = transaction.invocation.args[transaction.invocation.args.length - 1] ?? "";
  const toolsArgIndex = transaction.invocation.args.indexOf("--tools");
  const tools = toolsArgIndex >= 0 ? uniqueNonEmpty((transaction.invocation.args[toolsArgIndex + 1] ?? "").split(",")) : [];
  return {
    taskId: `tool-${transaction.requestId}`,
    prompt,
    tools,
    cwd: transaction.invocation.cwd ?? cwd,
  };
}

async function discoverMcpServerCandidates(cwd: string, now = new Date()): Promise<McpServerRecord[]> {
  const records: McpServerRecord[] = [];
  for (const sourcePath of [".mcp.json", "mcp.json", ".cursor/mcp.json", ".vscode/mcp.json", ".claude/mcp.json", "claude_desktop_config.json", "package.json"]) {
    const raw = await readOptionalText(join(cwd, sourcePath));
    if (raw === undefined) continue;
    try {
      const parsed = JSON.parse(raw) as unknown;
      const servers = extractMcpServerMap(parsed, sourcePath);
      if (!servers || Object.keys(servers).length === 0) continue;
      for (const [name, value] of Object.entries(servers)) {
        records.push(normalizeMcpServerRecord(name, sourcePath, value, now));
      }
    } catch (error) {
      records.push(createInvalidMcpServerRecord(sourcePath, sourcePath, error instanceof Error ? error.message : String(error), now));
    }
  }
  return records;
}

async function readOptionalText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function extractMcpServerMap(parsed: unknown, sourcePath: string): Record<string, unknown> | undefined {
  if (!isPlainObject(parsed)) return undefined;
  if (sourcePath === "package.json") {
    if (isPlainObject(parsed.mcpServers)) return parsed.mcpServers;
    if (isPlainObject(parsed.mcp) && isPlainObject(parsed.mcp.servers)) return parsed.mcp.servers;
    return undefined;
  }
  if (isPlainObject(parsed.mcpServers)) return parsed.mcpServers;
  if (isPlainObject(parsed.servers)) return parsed.servers;
  return undefined;
}

function normalizeMcpServerRecord(nameInput: string, sourcePath: string, value: unknown, now = new Date()): McpServerRecord {
  const timestamp = now.toISOString();
  const name = nameInput.trim() || "<unnamed>";
  if (!isPlainObject(value)) return createInvalidMcpServerRecord(name, sourcePath, "Server declaration is not an object.", now);
  const command = typeof value.command === "string" ? value.command.trim() || undefined : undefined;
  const url = typeof value.url === "string" ? value.url.trim() || undefined : typeof value.serverUrl === "string" ? value.serverUrl.trim() || undefined : undefined;
  const args = Array.isArray(value.args) ? uniqueNonEmpty(value.args.filter((arg): arg is string => typeof arg === "string")) : undefined;
  const envKeys = isPlainObject(value.env) ? Object.keys(value.env).sort() : undefined;
  const explicitTransport = typeof value.transport === "string" ? value.transport.trim().toLowerCase() : undefined;
  const transport: McpServerTransport = explicitTransport === "sse" ? "sse" : url ? (url.includes("/sse") || explicitTransport === "sse" ? "sse" : "http") : command ? "stdio" : "unknown";
  const riskLevel: ToolRiskLevel = url ? "external" : command ? "high" : "unknown";
  const status: McpServerStatus = command || url ? "discovered" : "invalid";
  return {
    id: randomUUID(),
    name,
    sourcePath,
    status,
    transport,
    riskLevel,
    command,
    args: args && args.length > 0 ? args : undefined,
    url: url ? redactSecretLikeValue(url) : undefined,
    envKeys: envKeys && envKeys.length > 0 ? envKeys : undefined,
    message: status === "discovered" ? "MCP server declaration discovered; not executed." : "MCP server declaration missing command or url.",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function createInvalidMcpServerRecord(name: string, sourcePath: string, message: string, now = new Date()): McpServerRecord {
  const timestamp = now.toISOString();
  return {
    id: randomUUID(),
    name: name.trim() || sourcePath,
    sourcePath,
    status: "invalid",
    transport: "unknown",
    riskLevel: "unknown",
    message,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function mergeMcpServerRecords(newRecords: McpServerRecord[], existingRecords: McpServerRecord[]): McpServerRecord[] {
  const byKey = new Map<string, McpServerRecord>();
  for (const record of existingRecords) byKey.set(`${record.sourcePath}:${record.name}`, record);
  for (const record of newRecords) byKey.set(`${record.sourcePath}:${record.name}`, record);
  return [...byKey.values()];
}

function redactSecretLikeValue(value: string): string {
  return value.replace(/([?&](?:token|key|secret|password)=)[^&\s]+/gi, "$1<redacted>");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function withToolLedgerWriteQueue<T>(cwd: string, fn: () => Promise<T>): Promise<T> {
  cwd = resolve(cwd);
  const previous = toolLedgerWriteQueues.get(cwd) ?? Promise.resolve();
  let releaseCurrent = (): void => undefined;
  const currentSlot = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  const current = previous.catch(() => undefined).then(() => currentSlot);
  toolLedgerWriteQueues.set(cwd, current);
  await previous.catch(() => undefined);
  try {
    const lock = join(dirname(getToolRequestsIndexPath(cwd)), "execution-ledger.lock");
    await mkdir(dirname(lock), { recursive: true });
    const deadline = performance.now() + 2000;
    for (;;) {
      try {
        await mkdir(lock);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        if (performance.now() >= deadline) throw new Error(`Tool ledger publication lock is busy: ${lock}. Reconcile the owner before removing it.`);
        await delay(10);
      }
    }
    try {
      return await fn();
    } finally {
      await releaseToolLedgerPublicationLock(lock);
    }
  } finally {
    releaseCurrent();
    if (toolLedgerWriteQueues.get(cwd) === current) toolLedgerWriteQueues.delete(cwd);
  }
}

async function releaseToolLedgerPublicationLock(lock: string): Promise<void> {
  let releaseError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await rmdir(lock);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      releaseError = error;
      if (attempt < 2) await delay(10);
    }
  }
  // Publication may already have committed. Do not report the tool operation as
  // failed and invite an unsafe retry solely because lock cleanup failed.
  process.emitWarning(
    `Tool ledger publication lock could not be released: ${lock}. A preceding publication may already have committed; stop writers and reconcile the orphaned lock without automatically replaying tool effects. ${String(releaseError)}`,
    { code: "SCALER_TOOL_LEDGER_LOCK_RELEASE_FAILED" },
  );
}

function copyToolExecutionLimits(limits: Readonly<ToolExecutionLimits>): ToolExecutionLimits {
  return {
    stdoutBytes: limits.stdoutBytes,
    stderrBytes: limits.stderrBytes,
    resultBytes: limits.resultBytes,
  };
}

function validateToolExecutionLimits(limits: ToolExecutionLimits): string[] {
  const diagnostics: string[] = [];
  if (!isPositiveSafeInteger(limits.stdoutBytes)) diagnostics.push("stdoutBytes must be a positive safe integer");
  if (!isPositiveSafeInteger(limits.stderrBytes)) diagnostics.push("stderrBytes must be a positive safe integer");
  if (!isPositiveSafeInteger(limits.resultBytes)) diagnostics.push("resultBytes must be a positive safe integer");
  return diagnostics;
}

function normalizeJsonValue(value: unknown, path: string): unknown {
  try {
    const serialized = JSON.stringify(value, (_key, item: unknown) => {
      if (typeof item === "number" && !Number.isFinite(item)) throw new Error("non-finite number");
      if (typeof item === "bigint" || typeof item === "symbol" || typeof item === "function") throw new Error("non-JSON value");
      return item;
    });
    if (serialized === undefined) throw new Error("undefined JSON encoding");
    return JSON.parse(serialized) as unknown;
  } catch (error) {
    throw new Error(`Tool result rejected: ${path} is not stable JSON data: ${error instanceof Error ? error.message : String(error)}.`);
  }
}

function withMeasuredToolResultBytes(record: ToolResultRecord): ToolResultRecord {
  let serializedBytes = 0;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = { ...record, serializedBytes };
    const measured = Buffer.byteLength(JSON.stringify(candidate), "utf8");
    if (measured === serializedBytes) return candidate;
    serializedBytes = measured;
  }
  throw new Error("Tool result rejected: serialized result byte measurement did not stabilize.");
}

function measureToolResultBytes(record: ToolResultRecord): number | undefined {
  try {
    const { serializedBytes: _ignored, ...unmeasured } = record;
    return withMeasuredToolResultBytes(unmeasured as ToolResultRecord).serializedBytes;
  } catch {
    return undefined;
  }
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function normalizeToolResultStatus(value: unknown): ToolResultStatus {
  if (typeof value !== "string") throw new Error("Tool result rejected: status is required.");
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!toolResultStatuses.has(normalized as ToolResultStatus)) throw new Error(`Tool result rejected: invalid status ${value}.`);
  return normalized as ToolResultStatus;
}

function normalizeToolIterationPolicy(value: Partial<ToolIterationPolicy>): ToolIterationPolicy {
  return {
    version: 1,
    maxIterations: clampIterationLimit(value.maxIterations),
    autoReplay: typeof value.autoReplay === "boolean" ? value.autoReplay : true,
    updatedAt: value.updatedAt,
  };
}

function clampIterationLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 3;
  return Math.min(10, Math.max(1, Math.trunc(value)));
}

async function latestMissingResultTransaction(cwd: string, requestId: string): Promise<ToolTransactionRecord | undefined> {
  return (await loadToolTransactions(cwd))
    .filter((transaction) => transaction.requestId === requestId && transaction.status === "missing_result")
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
}

async function recordToolExecutionUsage(
  cwd: string,
  usage: ProviderUsage | undefined,
  input: Parameters<typeof recordProviderUsageBudget>[3],
): Promise<void> {
  if (!usage) return;
  try {
    await recordProviderUsageBudget(cwd, await loadState(cwd), usage, input);
  } catch (error) {
    process.emitWarning(
      `Tool execution usage could not be added to the shared budget after its durable outcome was recorded. Reconcile from the transaction usage without replaying the tool execution. ${String(error)}`,
      { code: "SCALER_TOOL_USAGE_ACCOUNTING_FAILED" },
    );
  }
}

async function appendToolExecutionAudit(
  cwd: string,
  state: ScalerState,
  input: Parameters<typeof createLogEvent>[1],
): Promise<void> {
  try {
    await appendLogEvent(cwd, createLogEvent(state, input));
  } catch (error) {
    process.emitWarning(
      `Tool execution audit append failed after its durable outcome was recorded. Reconcile from the execution ledger without replaying the tool execution. ${String(error)}`,
      { code: "SCALER_TOOL_AUDIT_APPEND_FAILED" },
    );
  }
}

function toolIterationStep(
  iteration: number,
  action: ToolIterationStepAction,
  result: ToolRequestRunResult | ToolTransactionReplayResult,
): ToolIterationStepRecord {
  return {
    iteration,
    action,
    accepted: result.accepted,
    transactionId: result.transaction?.id,
    transactionStatus: result.transaction?.status,
    resultId: result.resultRecord?.id,
    message: result.message,
  };
}

function mapToolRequestStatusToIterationStatus(status: ToolRequestStatus | undefined): ToolIterationRunStatus {
  if (status === "completed" || status === "failed" || status === "blocked") return status;
  return status === "prepared" ? "missing_result" : "rejected";
}

function clampParallelism(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 2;
  return Math.min(8, Math.max(1, Math.trunc(value)));
}

function classifyToolScheduleStep(request: ToolRequestRecord, discoveredRecords: ToolSchemaRecord[]): ToolScheduleStepRecord {
  const entries = getToolCatalogEntries(request.allowedTools, discoveredRecords);
  const allAllowedLowRisk = entries.length > 0 && entries.every((entry) => entry.riskLevel === "low");
  const requestLowRisk = request.riskLevel === "low";
  const mode: ToolScheduleStepMode = requestLowRisk && allAllowedLowRisk ? "parallel" : "serial";
  const riskSummary = entries.map((entry) => `${entry.name}:${entry.riskLevel}`).join(",") || "no catalog entries";
  return {
    requestId: request.id,
    toolName: request.toolName,
    mode,
    reason: mode === "parallel" ? `low-risk request and allowed tools (${riskSummary})` : `serialized due to request/tool risk (${request.riskLevel}; ${riskSummary})`,
  };
}

function toolScheduleExecutedStep(step: ToolScheduleStepRecord, result: ToolRequestRunResult): ToolScheduleStepRecord {
  return {
    ...step,
    accepted: result.accepted,
    transactionId: result.transaction?.id,
    transactionStatus: result.transaction?.status,
    message: result.message,
  };
}

function uniqueNonEmpty(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

function summarizeOutput(output: string, limit = 2_000): string {
  const normalized = output.trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit)}\n...[truncated ${normalized.length - limit} chars]`;
}

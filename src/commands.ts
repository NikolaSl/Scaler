import type { ScalerState } from "./types.js";

export interface ParsedTaskCreateArgs {
  taskId: string;
  title?: string;
  allowedPathPrefixes?: string[];
  dependsOn?: string[];
  prdRefs?: string[];
}

export interface ParsedTaskUpdateArgs {
  taskId: string;
  title?: string;
  status?: string;
  allowedPathPrefixes?: string[];
  dependsOn?: string[];
  prdRefs?: string[];
}

export interface ParsedTaskRetryArgs {
  taskId?: string;
  reason?: string;
}

export interface ParsedValidationAddArgs {
  taskId: string;
  id: string;
  command: string;
  description?: string;
  required?: boolean;
  gate?: string;
  expectedResult?: string;
  evidenceRefs?: string[];
  environment?: string;
  disposition?: string;
  dispositionReason?: string;
}

export interface ParsedValidationChecklistItemArgs {
  id: string;
  status: string;
  statement: string;
  required?: boolean;
  evidenceRefs?: string[];
  notes?: string;
}

export interface ParsedValidationChecklistArgs {
  taskId: string;
  gate?: string;
  summary?: string;
  items: ParsedValidationChecklistItemArgs[];
  evidenceRefs?: string[];
}

export interface ParsedValidateLoopArgs {
  taskId?: string;
  execute: boolean;
  maxSteps?: number;
}

export interface ParsedBudgetSetArgs {
  key: string;
  soft?: number;
  hard?: number;
}

export interface ParsedStorageMaintainArgs {
  execute: boolean;
  compress: boolean;
  deleteCache: boolean;
  minAgeDays?: number;
  minSizeBytes?: number;
  rotateActive: boolean;
  maxActiveBytes?: number;
  minFreeBytes?: number;
  deleteArchives: boolean;
  maxArchiveBytes?: number;
  maxArchiveAgeDays?: number;
  deleteRawLogs: boolean;
  maxRawLogBytes?: number;
  maxRawLogAgeDays?: number;
  deleteMemory: boolean;
  maxMemoryBytes?: number;
  maxMemoryAgeDays?: number;
}

export interface ParsedStorageScheduleArgs {
  enabled?: boolean;
  run: boolean;
  force: boolean;
  intervalHours?: number;
  execute?: boolean;
  compress?: boolean;
  deleteCache?: boolean;
  minAgeDays?: number;
  minSizeBytes?: number;
  rotateActive?: boolean;
  maxActiveBytes?: number;
  minFreeBytes?: number;
  deleteArchives?: boolean;
  maxArchiveBytes?: number;
  maxArchiveAgeDays?: number;
  deleteRawLogs?: boolean;
  maxRawLogBytes?: number;
  maxRawLogAgeDays?: number;
  deleteMemory?: boolean;
  maxMemoryBytes?: number;
  maxMemoryAgeDays?: number;
}

export interface ParsedSafetyPolicyArgs {
  allowInternet?: boolean;
  allowExternalMutations?: boolean;
  allowSandbox?: boolean;
}

export interface ParsedSafetyApprovalArgs {
  action: "list" | "approve" | "revoke";
  id?: string;
  toolName?: string;
  match?: string;
  value?: string;
  risk?: string;
  reason?: string;
  sandboxOnly?: boolean;
  maxUses?: number;
  ttlMinutes?: number;
}

export interface ParsedSafetyScanArgs {
  execute: boolean;
  kinds?: string[];
}

export interface ParsedPrdLinkArgs {
  taskId: string;
  prdRefs: string[];
}

export interface ParsedCommitArgs {
  taskId?: string;
  allowedPathPrefixes?: string[];
}

export interface ParsedReplanRequestArgs {
  reason: string;
  taskId?: string;
  evidenceRefs?: string[];
  requirementRefs?: string[];
}

export interface ParsedReplanRunArgs {
  execute: boolean;
}

export interface ParsedResearchRequestArgs {
  question: string;
  reason?: string;
  taskId?: string;
  requirementRefs?: string[];
  scope?: string;
}

export interface ParsedResearchRunArgs {
  requestId?: string;
  execute: boolean;
  allowInternet: boolean;
  tools?: string[];
}

export interface ParsedResearchWebArgs {
  requestId?: string;
  execute: boolean;
  allowInternet: boolean;
  tools?: string[];
  maxQueries?: number;
}

export interface ParsedToolRunArgs {
  requestId?: string;
  execute: boolean;
}

export interface ParsedToolIterateArgs {
  requestId?: string;
  execute: boolean;
  maxIterations?: number;
}

export interface ParsedToolIterationPolicyArgs {
  maxIterations?: number;
  autoReplay?: boolean;
}

export interface ParsedToolReplayArgs {
  transactionId?: string;
  execute: boolean;
}

export interface ParsedToolCatalogArgs {
  toolName?: string;
}

export interface ParsedToolDiscoverArgs {
  toolName?: string;
  execute: boolean;
  tools?: string[];
}

export interface ParsedDebugRunArgs {
  taskId?: string;
  execute: boolean;
}

export interface ParsedDebugRetryArgs {
  taskId?: string;
  execute: boolean;
}

export interface ParsedDebugRetryPolicyArgs {
  autoStart?: boolean;
  requireApproval?: boolean;
  postExactPass?: string;
}

export interface ParsedDebugRetryApprovalArgs {
  debugReportId?: string;
  taskId?: string;
  reason?: string;
}

export interface ParsedDebugLoopArgs {
  taskId?: string;
  execute: boolean;
  maxSteps?: number;
}

export interface ParsedResearchReportArgs {
  question: string;
  conclusion: string;
  confidence?: string;
  sourceId?: string;
  sourceTitle?: string;
  sourceQuality?: string;
  sourceRef?: string;
  requestId?: string;
  taskId?: string;
  requirementRefs?: string[];
}

export interface ParsedContextTaskArgs {
  taskId?: string;
}

export interface ParsedStageRecordArgs {
  stage: string;
  status?: string;
  title?: string;
  path?: string;
  summary?: string;
  evidenceRefs?: string[];
  requirementRefs?: string[];
  taskRefs?: string[];
}

export interface ParsedStageRunArgs {
  stage?: string;
  execute: boolean;
}

export interface ParsedStageLoopArgs {
  execute: boolean;
  maxSteps?: number;
}

export function parseTaskCreateArgs(args: string | undefined): ParsedTaskCreateArgs | undefined {
  const parts = splitPipeArgs(args);
  const taskId = parts[0]?.trim();
  if (!taskId) return undefined;

  return {
    taskId,
    title: parts[1]?.trim() || undefined,
    allowedPathPrefixes: parseCommaList(parts[2]),
    dependsOn: parseCommaList(parts[3]),
    prdRefs: parseCommaList(parts[4]),
  };
}

export function parseTaskUpdateArgs(args: string | undefined): ParsedTaskUpdateArgs | undefined {
  const parts = splitPipeArgs(args);
  const taskId = parts[0]?.trim();
  if (!taskId) return undefined;
  return {
    taskId,
    title: parts[1]?.trim() || undefined,
    status: parts[2]?.trim() || undefined,
    allowedPathPrefixes: parseCommaList(parts[3]),
    dependsOn: parseCommaList(parts[4]),
    prdRefs: parseCommaList(parts[5]),
  };
}

export function parseTaskRetryArgs(args: string | undefined): ParsedTaskRetryArgs {
  const parts = splitPipeArgs(args);
  return {
    taskId: parts[0]?.trim() || undefined,
    reason: parts[1]?.trim() || undefined,
  };
}

export function parseValidationAddArgs(args: string | undefined): ParsedValidationAddArgs | undefined {
  const parts = splitPipeArgs(args);
  const taskId = parts[0]?.trim();
  const id = parts[1]?.trim();
  const command = parts[2]?.trim();
  if (!taskId || !id || !command) return undefined;
  const disposition = parseValidationDispositionArg(parts[9]);
  return {
    taskId,
    id,
    command,
    description: parts[3]?.trim() || undefined,
    required: parseOptionalBoolean(parts[4]),
    gate: parts[5]?.trim() || undefined,
    expectedResult: parts[6]?.trim() || undefined,
    evidenceRefs: parseCommaList(parts[7]),
    environment: parts[8]?.trim() || undefined,
    disposition: disposition.disposition,
    dispositionReason: disposition.reason,
  };
}

export function parseValidationChecklistArgs(args: string | undefined): ParsedValidationChecklistArgs | undefined {
  const parts = splitPipeArgs(args);
  const taskId = parts[0]?.trim();
  const itemPart = parts[3]?.trim();
  if (!taskId || !itemPart) return undefined;
  const items = parseValidationChecklistItems(itemPart);
  if (items.length === 0) return undefined;
  return {
    taskId,
    gate: parts[1]?.trim() || undefined,
    summary: parts[2]?.trim() || undefined,
    items,
    evidenceRefs: parseCommaList(parts[4]),
  };
}

export function parseValidateLoopArgs(args: string | undefined): ParsedValidateLoopArgs {
  const parts = (args ?? "").trim().split(/\s+/).filter(Boolean);
  const maxPart = parts.find((part) => /^max=\d+$/i.test(part));
  const maxSteps = maxPart ? Number.parseInt(maxPart.split("=")[1] ?? "", 10) : undefined;
  return {
    taskId: parts.find((part) => part.toLowerCase() !== "execute" && !/^max=/i.test(part)),
    execute: parts.some((part) => part.toLowerCase() === "execute"),
    maxSteps: maxSteps === undefined || !Number.isFinite(maxSteps) ? undefined : maxSteps,
  };
}

export function parseBudgetSetArgs(args: string | undefined): ParsedBudgetSetArgs | undefined {
  const parts = splitPipeArgs(args);
  const key = parts[0]?.trim();
  if (!key) return undefined;
  return {
    key,
    soft: parseOptionalNumber(parts[1]),
    hard: parseOptionalNumber(parts[2]),
  };
}

export function parseStorageMaintainArgs(args: string | undefined): ParsedStorageMaintainArgs {
  const parts = (args ?? "").trim().split(/\s+/).filter(Boolean);
  const minAgePart = parts.find((part) => /^min-age-days=\d+$/i.test(part));
  const minSizePart = parts.find((part) => /^min-size=\d+$/i.test(part));
  const maxActivePart = parts.find((part) => /^max-active-bytes=\d+$/i.test(part));
  const minFreePart = parts.find((part) => /^min-free-bytes=\d+$/i.test(part));
  const maxArchivePart = parts.find((part) => /^max-archive-bytes=\d+$/i.test(part));
  const maxArchiveAgePart = parts.find((part) => /^max-archive-age-days=\d+$/i.test(part));
  const maxRawLogPart = parts.find((part) => /^max-raw-log-bytes=\d+$/i.test(part));
  const maxRawLogAgePart = parts.find((part) => /^max-raw-log-age-days=\d+$/i.test(part));
  const maxMemoryPart = parts.find((part) => /^max-memory-bytes=\d+$/i.test(part));
  const maxMemoryAgePart = parts.find((part) => /^max-memory-age-days=\d+$/i.test(part));
  const minAgeDays = minAgePart ? Number.parseInt(minAgePart.split("=")[1] ?? "", 10) : undefined;
  const minSizeBytes = minSizePart ? Number.parseInt(minSizePart.split("=")[1] ?? "", 10) : undefined;
  const maxActiveBytes = maxActivePart ? Number.parseInt(maxActivePart.split("=")[1] ?? "", 10) : undefined;
  const minFreeBytes = minFreePart ? Number.parseInt(minFreePart.split("=")[1] ?? "", 10) : undefined;
  const maxArchiveBytes = maxArchivePart ? Number.parseInt(maxArchivePart.split("=")[1] ?? "", 10) : undefined;
  const maxArchiveAgeDays = maxArchiveAgePart ? Number.parseInt(maxArchiveAgePart.split("=")[1] ?? "", 10) : undefined;
  const maxRawLogBytes = maxRawLogPart ? Number.parseInt(maxRawLogPart.split("=")[1] ?? "", 10) : undefined;
  const maxRawLogAgeDays = maxRawLogAgePart ? Number.parseInt(maxRawLogAgePart.split("=")[1] ?? "", 10) : undefined;
  const maxMemoryBytes = maxMemoryPart ? Number.parseInt(maxMemoryPart.split("=")[1] ?? "", 10) : undefined;
  const maxMemoryAgeDays = maxMemoryAgePart ? Number.parseInt(maxMemoryAgePart.split("=")[1] ?? "", 10) : undefined;
  return {
    execute: parts.some((part) => part.toLowerCase() === "execute"),
    compress: !parts.some((part) => part.toLowerCase() === "no-compress"),
    deleteCache: parts.some((part) => part.toLowerCase() === "delete-cache"),
    minAgeDays: minAgeDays === undefined || !Number.isFinite(minAgeDays) ? undefined : minAgeDays,
    minSizeBytes: minSizeBytes === undefined || !Number.isFinite(minSizeBytes) ? undefined : minSizeBytes,
    rotateActive: parts.some((part) => part.toLowerCase() === "rotate-active"),
    maxActiveBytes: maxActiveBytes === undefined || !Number.isFinite(maxActiveBytes) ? undefined : maxActiveBytes,
    minFreeBytes: minFreeBytes === undefined || !Number.isFinite(minFreeBytes) ? undefined : minFreeBytes,
    deleteArchives: parts.some((part) => part.toLowerCase() === "delete-archives"),
    maxArchiveBytes: maxArchiveBytes === undefined || !Number.isFinite(maxArchiveBytes) ? undefined : maxArchiveBytes,
    maxArchiveAgeDays: maxArchiveAgeDays === undefined || !Number.isFinite(maxArchiveAgeDays) ? undefined : maxArchiveAgeDays,
    deleteRawLogs: parts.some((part) => part.toLowerCase() === "delete-raw-logs"),
    maxRawLogBytes: maxRawLogBytes === undefined || !Number.isFinite(maxRawLogBytes) ? undefined : maxRawLogBytes,
    maxRawLogAgeDays: maxRawLogAgeDays === undefined || !Number.isFinite(maxRawLogAgeDays) ? undefined : maxRawLogAgeDays,
    deleteMemory: parts.some((part) => part.toLowerCase() === "delete-memory"),
    maxMemoryBytes: maxMemoryBytes === undefined || !Number.isFinite(maxMemoryBytes) ? undefined : maxMemoryBytes,
    maxMemoryAgeDays: maxMemoryAgeDays === undefined || !Number.isFinite(maxMemoryAgeDays) ? undefined : maxMemoryAgeDays,
  };
}

export function parseStorageScheduleArgs(args: string | undefined): ParsedStorageScheduleArgs {
  const parts = (args ?? "").trim().split(/\s+/).filter(Boolean);
  const findNumber = (name: string): number | undefined => {
    const part = parts.find((candidate) => candidate.toLowerCase().startsWith(`${name.toLowerCase()}=`));
    if (!part) return undefined;
    const parsed = Number.parseInt(part.split("=")[1] ?? "", 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  const findBoolean = (name: string): boolean | undefined => {
    const part = parts.find((candidate) => candidate.toLowerCase().startsWith(`${name.toLowerCase()}=`));
    return parseOnOffOption(part);
  };
  return {
    enabled: parts.some((part) => part.toLowerCase() === "enable") ? true : parts.some((part) => part.toLowerCase() === "disable") ? false : undefined,
    run: parts.some((part) => part.toLowerCase() === "run"),
    force: parts.some((part) => part.toLowerCase() === "force"),
    intervalHours: findNumber("interval-hours"),
    execute: findBoolean("execute"),
    compress: findBoolean("compress"),
    deleteCache: findBoolean("delete-cache"),
    minAgeDays: findNumber("min-age-days"),
    minSizeBytes: findNumber("min-size"),
    rotateActive: findBoolean("rotate-active"),
    maxActiveBytes: findNumber("max-active-bytes"),
    minFreeBytes: findNumber("min-free-bytes"),
    deleteArchives: findBoolean("delete-archives"),
    maxArchiveBytes: findNumber("max-archive-bytes"),
    maxArchiveAgeDays: findNumber("max-archive-age-days"),
    deleteRawLogs: findBoolean("delete-raw-logs"),
    maxRawLogBytes: findNumber("max-raw-log-bytes"),
    maxRawLogAgeDays: findNumber("max-raw-log-age-days"),
    deleteMemory: findBoolean("delete-memory"),
    maxMemoryBytes: findNumber("max-memory-bytes"),
    maxMemoryAgeDays: findNumber("max-memory-age-days"),
  };
}

export function parseSafetyPolicyArgs(args: string | undefined): ParsedSafetyPolicyArgs {
  const parts = (args ?? "").trim().split(/\s+/).filter(Boolean);
  return {
    allowInternet: parseOnOffOption(parts.find((part) => /^allow-internet=/i.test(part))),
    allowExternalMutations: parseOnOffOption(parts.find((part) => /^allow-external=/i.test(part))),
    allowSandbox: parseOnOffOption(parts.find((part) => /^allow-sandbox=/i.test(part))),
  };
}

export function parseSafetyApprovalArgs(args: string | undefined): ParsedSafetyApprovalArgs {
  const parts = splitPipeArgs(args);
  const action = parts[0]?.trim().toLowerCase();
  if (action === "approve") {
    const optionParts = parts.slice(6).flatMap((part) => part.trim().split(/\s+/).filter(Boolean));
    const maxUsesPart = optionParts.find((part) => /^max-uses=\d+$/i.test(part));
    const ttlPart = optionParts.find((part) => /^ttl-minutes=\d+$/i.test(part));
    return {
      action: "approve",
      toolName: parts[1]?.trim() || undefined,
      match: parts[2]?.trim() || undefined,
      value: parts[3]?.trim() || undefined,
      risk: parts[4]?.trim() || undefined,
      reason: parts[5]?.trim() || undefined,
      sandboxOnly: parseOnOffOption(optionParts.find((part) => /^sandbox=/i.test(part))),
      maxUses: maxUsesPart ? Number.parseInt(maxUsesPart.split("=")[1] ?? "", 10) : undefined,
      ttlMinutes: ttlPart ? Number.parseInt(ttlPart.split("=")[1] ?? "", 10) : undefined,
    };
  }
  if (action === "revoke") {
    return { action: "revoke", id: parts[1]?.trim() || undefined, reason: parts[2]?.trim() || undefined };
  }
  return { action: "list" };
}

export function parseSafetyScanArgs(args: string | undefined): ParsedSafetyScanArgs {
  const parts = (args ?? "").trim().split(/\s+/).filter(Boolean);
  const kindsPart = parts.find((part) => /^kinds=/i.test(part));
  return {
    execute: parts.some((part) => part.toLowerCase() === "execute"),
    kinds: kindsPart ? parseCommaList(kindsPart.split("=").slice(1).join("=")) : undefined,
  };
}

export function parsePrdLinkArgs(args: string | undefined): ParsedPrdLinkArgs | undefined {
  const parts = splitPipeArgs(args);
  const taskId = parts[0]?.trim();
  const prdRefs = parseCommaList(parts[1]);
  if (!taskId || !prdRefs) return undefined;
  return { taskId, prdRefs };
}

export function parseCommitArgs(args: string | undefined): ParsedCommitArgs {
  const parts = splitPipeArgs(args);
  const taskId = parts[0]?.trim() || undefined;
  return {
    taskId,
    allowedPathPrefixes: parseCommaList(parts[1]),
  };
}

export function parseReplanRequestArgs(args: string | undefined): ParsedReplanRequestArgs | undefined {
  const parts = splitPipeArgs(args);
  const reason = parts[0]?.trim();
  if (!reason) return undefined;
  return {
    reason,
    taskId: parts[1]?.trim() || undefined,
    evidenceRefs: parseCommaList(parts[2]),
    requirementRefs: parseCommaList(parts[3]),
  };
}

export function parseReplanRunArgs(args: string | undefined): ParsedReplanRunArgs {
  const parts = (args ?? "").trim().split(/\s+/).filter(Boolean);
  return { execute: parts.some((part) => part.toLowerCase() === "execute") };
}

export function parseResearchRunArgs(args: string | undefined): ParsedResearchRunArgs {
  const parts = (args ?? "").trim().split(/\s+/).filter(Boolean);
  const optionParts = new Set(parts.filter((part) => part.toLowerCase() === "execute" || part.toLowerCase() === "internet" || /^tools=/i.test(part)));
  const toolsPart = parts.find((part) => /^tools=/i.test(part));
  return {
    requestId: parts.find((part) => !optionParts.has(part)),
    execute: parts.some((part) => part.toLowerCase() === "execute"),
    allowInternet: parts.some((part) => part.toLowerCase() === "internet"),
    tools: parseCommaList(toolsPart?.slice(toolsPart.indexOf("=") + 1)),
  };
}

export function parseResearchWebArgs(args: string | undefined): ParsedResearchWebArgs {
  const parts = (args ?? "").trim().split(/\s+/).filter(Boolean);
  const toolsPart = parts.find((part) => /^tools=/i.test(part));
  const maxPart = parts.find((part) => /^max-queries=\d+$/i.test(part));
  const optionParts = new Set(parts.filter((part) => part.toLowerCase() === "execute" || part.toLowerCase() === "internet" || /^tools=/i.test(part) || /^max-queries=/i.test(part)));
  const maxQueries = maxPart ? Number.parseInt(maxPart.split("=")[1] ?? "", 10) : undefined;
  return {
    requestId: parts.find((part) => !optionParts.has(part)),
    execute: parts.some((part) => part.toLowerCase() === "execute"),
    allowInternet: parts.some((part) => part.toLowerCase() === "internet"),
    tools: parseCommaList(toolsPart?.slice(toolsPart.indexOf("=") + 1)),
    maxQueries: maxQueries === undefined || !Number.isFinite(maxQueries) ? undefined : maxQueries,
  };
}

export function parseToolRunArgs(args: string | undefined): ParsedToolRunArgs {
  const parts = (args ?? "").trim().split(/\s+/).filter(Boolean);
  return {
    requestId: parts.find((part) => part.toLowerCase() !== "execute"),
    execute: parts.some((part) => part.toLowerCase() === "execute"),
  };
}

export function parseToolIterateArgs(args: string | undefined): ParsedToolIterateArgs {
  const parts = (args ?? "").trim().split(/\s+/).filter(Boolean);
  const maxPart = parts.find((part) => /^max=\d+$/i.test(part));
  const optionParts = new Set(parts.filter((part) => part.toLowerCase() === "execute" || /^max=/i.test(part)));
  const maxIterations = maxPart ? Number.parseInt(maxPart.split("=")[1] ?? "", 10) : undefined;
  return {
    requestId: parts.find((part) => !optionParts.has(part)),
    execute: parts.some((part) => part.toLowerCase() === "execute"),
    maxIterations: maxIterations === undefined || !Number.isFinite(maxIterations) ? undefined : maxIterations,
  };
}

export function parseToolIterationPolicyArgs(args: string | undefined): ParsedToolIterationPolicyArgs {
  const parts = (args ?? "").trim().split(/\s+/).filter(Boolean);
  const maxPart = parts.find((part) => /^max=\d+$/i.test(part));
  const maxIterations = maxPart ? Number.parseInt(maxPart.split("=")[1] ?? "", 10) : undefined;
  return {
    maxIterations: maxIterations === undefined || !Number.isFinite(maxIterations) ? undefined : maxIterations,
    autoReplay: parseOnOffOption(parts.find((part) => /^auto-replay=/i.test(part))),
  };
}

export function parseToolReplayArgs(args: string | undefined): ParsedToolReplayArgs {
  const parts = (args ?? "").trim().split(/\s+/).filter(Boolean);
  return {
    transactionId: parts.find((part) => part.toLowerCase() !== "execute"),
    execute: parts.some((part) => part.toLowerCase() === "execute"),
  };
}

export function parseToolCatalogArgs(args: string | undefined): ParsedToolCatalogArgs {
  return { toolName: args?.trim() || undefined };
}

export function parseToolDiscoverArgs(args: string | undefined): ParsedToolDiscoverArgs {
  const parts = (args ?? "").trim().split(/\s+/).filter(Boolean);
  const toolsPart = parts.find((part) => /^tools=/i.test(part));
  return {
    toolName: parts.find((part) => part.toLowerCase() !== "execute" && !/^tools=/i.test(part)),
    execute: parts.some((part) => part.toLowerCase() === "execute"),
    tools: parseCommaList(toolsPart?.slice(toolsPart.indexOf("=") + 1)),
  };
}

export function parseDebugRunArgs(args: string | undefined): ParsedDebugRunArgs {
  const parts = (args ?? "").trim().split(/\s+/).filter(Boolean);
  return {
    taskId: parts.find((part) => part.toLowerCase() !== "execute"),
    execute: parts.some((part) => part.toLowerCase() === "execute"),
  };
}

export function parseDebugRetryArgs(args: string | undefined): ParsedDebugRetryArgs {
  const parts = (args ?? "").trim().split(/\s+/).filter(Boolean);
  return {
    taskId: parts.find((part) => part.toLowerCase() !== "execute"),
    execute: parts.some((part) => part.toLowerCase() === "execute"),
  };
}

export function parseDebugRetryPolicyArgs(args: string | undefined): ParsedDebugRetryPolicyArgs {
  const parts = (args ?? "").trim().split(/\s+/).filter(Boolean);
  const postPart = parts.find((part) => /^post-exact-pass=/i.test(part));
  return {
    autoStart: parseOnOffOption(parts.find((part) => /^auto-start=/i.test(part))),
    requireApproval: parseOnOffOption(parts.find((part) => /^require-approval=/i.test(part))),
    postExactPass: postPart ? postPart.split("=").slice(1).join("=").trim() || undefined : undefined,
  };
}

export function parseDebugRetryApprovalArgs(args: string | undefined): ParsedDebugRetryApprovalArgs | undefined {
  const parts = splitPipeArgs(args);
  const debugReportId = parts[0]?.trim();
  if (!debugReportId) return undefined;
  return {
    debugReportId,
    taskId: parts[1]?.trim() || undefined,
    reason: parts[2]?.trim() || undefined,
  };
}

export function parseDebugLoopArgs(args: string | undefined): ParsedDebugLoopArgs {
  const parts = (args ?? "").trim().split(/\s+/).filter(Boolean);
  const maxPart = parts.find((part) => /^max=\d+$/i.test(part));
  const maxSteps = maxPart ? Number.parseInt(maxPart.split("=")[1] ?? "", 10) : undefined;
  return {
    taskId: parts.find((part) => part.toLowerCase() !== "execute" && !/^max=/i.test(part)),
    execute: parts.some((part) => part.toLowerCase() === "execute"),
    maxSteps: maxSteps === undefined || !Number.isFinite(maxSteps) ? undefined : maxSteps,
  };
}

export function parseResearchRequestArgs(args: string | undefined): ParsedResearchRequestArgs | undefined {
  const parts = splitPipeArgs(args);
  const question = parts[0]?.trim();
  if (!question) return undefined;
  return {
    question,
    reason: parts[1]?.trim() || undefined,
    taskId: parts[2]?.trim() || undefined,
    requirementRefs: parseCommaList(parts[3]),
    scope: parts[4]?.trim() || undefined,
  };
}

export function parseResearchReportArgs(args: string | undefined): ParsedResearchReportArgs | undefined {
  const parts = splitPipeArgs(args);
  const question = parts[0]?.trim();
  const conclusion = parts[1]?.trim();
  if (!question || !conclusion) return undefined;
  return {
    question,
    conclusion,
    confidence: parts[2]?.trim() || undefined,
    sourceId: parts[3]?.trim() || undefined,
    sourceTitle: parts[4]?.trim() || undefined,
    sourceQuality: parts[5]?.trim() || undefined,
    sourceRef: parts[6]?.trim() || undefined,
    requestId: parts[7]?.trim() || undefined,
    taskId: parts[8]?.trim() || undefined,
    requirementRefs: parseCommaList(parts[9]),
  };
}

export function parseContextTaskArgs(args: string | undefined): ParsedContextTaskArgs {
  return { taskId: args?.trim() || undefined };
}

export function parseStageRunArgs(args: string | undefined): ParsedStageRunArgs {
  const parts = (args ?? "").trim().split(/\s+/).filter(Boolean);
  return {
    stage: parts[0],
    execute: parts.slice(1).some((part) => part.toLowerCase() === "execute"),
  };
}

export function parseStageLoopArgs(args: string | undefined): ParsedStageLoopArgs {
  const parts = (args ?? "").trim().split(/\s+/).filter(Boolean);
  const maxPart = parts.find((part) => /^max=\d+$/i.test(part));
  const maxSteps = maxPart ? Number.parseInt(maxPart.split("=")[1] ?? "", 10) : undefined;
  return {
    execute: parts.some((part) => part.toLowerCase() === "execute"),
    maxSteps: maxSteps === undefined || !Number.isFinite(maxSteps) ? undefined : maxSteps,
  };
}

export function parseStageRecordArgs(args: string | undefined): ParsedStageRecordArgs | undefined {
  const parts = splitPipeArgs(args);
  const stage = parts[0]?.trim();
  if (!stage) return undefined;
  return {
    stage,
    status: parts[1]?.trim() || undefined,
    title: parts[2]?.trim() || undefined,
    path: parts[3]?.trim() || undefined,
    summary: parts[4]?.trim() || undefined,
    evidenceRefs: parseCommaList(parts[5]),
    requirementRefs: parseCommaList(parts[6]),
    taskRefs: parseCommaList(parts[7]),
  };
}

export function selectTaskForCommit(state: ScalerState, requestedTaskId?: string): string | undefined {
  if (requestedTaskId) return requestedTaskId;
  if (state.currentTaskId && state.tasks.some((task) => task.id === state.currentTaskId && task.status === "validated")) {
    return state.currentTaskId;
  }
  return state.tasks.find((task) => task.status === "validated")?.id;
}

export function resolveCommitAllowedPaths(state: ScalerState, taskId: string, explicitPaths?: string[]): string[] {
  if (explicitPaths && explicitPaths.length > 0) return explicitPaths;
  return state.tasks.find((task) => task.id === taskId)?.allowedPathPrefixes ?? [];
}

export function parseCommaList(value: string | undefined): string[] | undefined {
  const items = (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return items.length > 0 ? items : undefined;
}

function splitPipeArgs(args: string | undefined): string[] {
  return (args ?? "").split("|").map((part) => part.trim());
}

function parseValidationChecklistItems(value: string): ParsedValidationChecklistItemArgs[] {
  return value
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const parts = item.split("::").map((part) => part.trim());
      return {
        id: parts[0] || "item",
        status: parts[1] || "failed",
        required: parseOptionalBoolean(parts[2]),
        statement: parts[3] || parts[0] || "Checklist item",
        evidenceRefs: parseCommaList(parts[4]),
        notes: parts[5] || undefined,
      };
    })
    .filter((item) => item.id.length > 0 && item.statement.length > 0);
}

function parseValidationDispositionArg(value: string | undefined): { disposition?: string; reason?: string } {
  const raw = value?.trim();
  if (!raw) return {};
  const [disposition, ...reasonParts] = raw.split(":");
  const reason = reasonParts.join(":").trim();
  return {
    disposition: disposition?.trim() || undefined,
    reason: reason || undefined,
  };
}

function parseOnOffOption(value: string | undefined): boolean | undefined {
  const raw = value?.slice(value.indexOf("=") + 1).trim().toLowerCase();
  if (!raw) return undefined;
  if (["on", "true", "yes", "1", "allow", "allowed"].includes(raw)) return true;
  if (["off", "false", "no", "0", "deny", "denied"].includes(raw)) return false;
  return undefined;
}

function parseOptionalBoolean(value: string | undefined): boolean | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (["true", "yes", "required", "1"].includes(normalized)) return true;
  if (["false", "no", "optional", "0"].includes(normalized)) return false;
  return undefined;
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  const normalized = value?.trim();
  if (!normalized || normalized === "-") return undefined;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

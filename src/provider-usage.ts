/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import { applyBudgetUsageUpdates, persistBudgetDecision, type BudgetDecision, type BudgetUsageUpdate } from "./budgets.js";
import { appendLogEvent, createLogEvent } from "./logging.js";
import type { ScalerState } from "./types.js";

export interface ProviderUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
  costMicros?: number;
  sources: string[];
}

export interface ProviderUsageBudgetResult {
  state: ScalerState;
  applied: boolean;
  updates: BudgetUsageUpdate[];
  decision?: BudgetDecision;
  usage?: ProviderUsage;
}

export interface ProviderUsageBudgetInput {
  source: string;
  taskId?: string;
  agentId?: string;
  agentType?: string;
  logWhenOk?: boolean;
}

interface UsageCandidate {
  usage: ProviderUsage;
  final: boolean;
}

export function extractProviderUsage(events: unknown[]): ProviderUsage | undefined {
  const candidates: UsageCandidate[] = [];
  for (let index = 0; index < events.length; index += 1) {
    candidates.push(...extractUsageCandidatesFromEvent(events[index], `event[${index}]`));
  }

  if (candidates.length === 0) return undefined;
  const finalCandidates = candidates.filter((candidate) => candidate.final);
  const usage = finalCandidates.length > 0
    ? finalCandidates[finalCandidates.length - 1]?.usage
    : sumProviderUsages(candidates.map((candidate) => candidate.usage));
  return usage && hasPositiveUsage(usage) ? usage : undefined;
}

export function providerUsageToBudgetUpdates(usage: ProviderUsage | undefined): BudgetUsageUpdate[] {
  if (!usage) return [];
  const updates: BudgetUsageUpdate[] = [];
  const tokenUsage = usage.totalTokens ?? sumDefined([
    usage.inputTokens,
    usage.outputTokens,
    usage.cacheReadTokens,
    usage.cacheWriteTokens,
  ]);
  if (tokenUsage !== undefined && tokenUsage > 0) {
    updates.push({ key: "contextTokens", amount: tokenUsage, mode: "increment" });
  }
  if (usage.costMicros !== undefined && usage.costMicros > 0) {
    updates.push({ key: "estimatedCostMicros", amount: usage.costMicros, mode: "increment" });
  }
  return updates;
}

export async function recordProviderUsageBudget(
  cwd: string,
  state: ScalerState,
  usage: ProviderUsage | undefined,
  input: ProviderUsageBudgetInput,
): Promise<ProviderUsageBudgetResult> {
  const updates = providerUsageToBudgetUpdates(usage);
  if (!usage || updates.length === 0) return { state, applied: false, updates, usage };

  const budgetResult = applyBudgetUsageUpdates(state, updates);
  const nextState = await persistBudgetDecision(cwd, budgetResult.state, budgetResult.decision);

  if (input.logWhenOk !== false || budgetResult.decision.status !== "ok") {
    await appendLogEvent(cwd, createLogEvent(nextState, {
      eventType: "budget",
      summary: `Provider usage recorded: ${formatProviderUsage(usage)}`,
      taskId: input.taskId,
      agentId: input.agentId,
      agentType: input.agentType,
      details: {
        source: input.source,
        usage,
        updates,
        decisions: budgetResult.decisions,
      },
      usage: {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cost: usage.costMicros === undefined ? undefined : usage.costMicros / 1_000_000,
      },
    }));
  }

  return { state: nextState, applied: true, updates, decision: budgetResult.decision, usage };
}

export function formatProviderUsage(usage: ProviderUsage | undefined): string {
  if (!usage) return "unavailable";
  const parts = [
    usage.inputTokens !== undefined && `input=${usage.inputTokens}`,
    usage.outputTokens !== undefined && `output=${usage.outputTokens}`,
    usage.cacheReadTokens !== undefined && `cacheRead=${usage.cacheReadTokens}`,
    usage.cacheWriteTokens !== undefined && `cacheWrite=${usage.cacheWriteTokens}`,
    usage.reasoningTokens !== undefined && `reasoning=${usage.reasoningTokens}`,
    usage.totalTokens !== undefined && `total=${usage.totalTokens}`,
    usage.costMicros !== undefined && `costMicros=${usage.costMicros}`,
  ].filter((part): part is string => typeof part === "string");
  return parts.length > 0 ? parts.join(" ") : "unavailable";
}

function extractUsageCandidatesFromEvent(event: unknown, source: string): UsageCandidate[] {
  if (!isRecord(event)) return [];
  const eventType = typeof event.type === "string" ? event.type : "unknown";

  if (eventType === "agent_end" && Array.isArray(event.messages)) {
    const messageUsages = event.messages
      .map((message, index) => parseAssistantMessageUsage(message, `${source}.messages[${index}].usage`))
      .filter((usage): usage is ProviderUsage => usage !== undefined);
    const usage = sumProviderUsages(messageUsages, `${source}.messages`);
    return usage ? [{ usage, final: true }] : [];
  }

  const messageUsage = parseMessageCarrierUsage(event, source);
  if (messageUsage) {
    return [{ usage: messageUsage, final: eventType === "done" || eventType === "error" }];
  }

  const directUsage = parseDirectUsageRecord(event, `${source}.usage`);
  return directUsage ? [{ usage: directUsage, final: false }] : [];
}

function parseMessageCarrierUsage(event: Record<string, unknown>, source: string): ProviderUsage | undefined {
  const eventType = typeof event.type === "string" ? event.type : "unknown";
  if ((eventType === "turn_end" || eventType === "message_end" || eventType === "done") && isRecord(event.message)) {
    return parseAssistantMessageUsage(event.message, `${source}.message.usage`);
  }
  if (eventType === "error" && isRecord(event.error)) {
    return parseAssistantMessageUsage(event.error, `${source}.error.usage`);
  }
  return undefined;
}

function parseAssistantMessageUsage(message: unknown, source: string): ProviderUsage | undefined {
  if (!isRecord(message)) return undefined;
  if (message.role !== undefined && message.role !== "assistant") return undefined;
  return parseUsageObject(message.usage, source);
}

function parseDirectUsageRecord(record: Record<string, unknown>, source: string): ProviderUsage | undefined {
  const direct = parseUsageObject(record.usage, source);
  if (direct) return direct;
  const tokenUsage = parseUsageObject(record.tokenUsage, source.replace(/\.usage$/, ".tokenUsage"));
  if (tokenUsage) return tokenUsage;
  const modelUsage = parseUsageObject(record.modelUsage, source.replace(/\.usage$/, ".modelUsage"));
  if (modelUsage) return modelUsage;
  const responseUsage = isRecord(record.response) ? parseUsageObject(record.response.usage, source.replace(/\.usage$/, ".response.usage")) : undefined;
  if (responseUsage) return responseUsage;
  return parseUsageObject(record, source.replace(/\.usage$/, ""));
}

function parseUsageObject(value: unknown, source: string): ProviderUsage | undefined {
  if (!isRecord(value)) return undefined;

  const inputTokens = numberField(value, ["inputTokens", "input_tokens", "promptTokens", "prompt_tokens", "prompt", "input"]);
  const outputTokens = numberField(value, ["outputTokens", "output_tokens", "completionTokens", "completion_tokens", "generatedTokens", "generated_tokens", "completion", "output"]);
  const cacheReadTokens = numberField(value, ["cacheReadTokens", "cache_read_tokens", "cacheRead", "cache_read", "cachedInputTokens", "cached_input_tokens"]);
  const cacheWriteTokens = numberField(value, ["cacheWriteTokens", "cache_write_tokens", "cacheWrite", "cache_write"]);
  const reasoningTokens = numberField(value, ["reasoningTokens", "reasoning_tokens", "reasoning", "thinkingTokens", "thinking_tokens"]);
  const totalTokens = numberField(value, ["totalTokens", "total_tokens", "tokens", "total"])
    ?? sumDefined([inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens]);
  const costMicros = parseCostMicros(value);

  const usage: ProviderUsage = {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    reasoningTokens,
    totalTokens,
    costMicros,
    sources: [source],
  };
  return hasPositiveUsage(usage) ? usage : undefined;
}

function parseCostMicros(value: Record<string, unknown>): number | undefined {
  const explicitMicros = numberField(value, ["costMicros", "cost_micros", "estimatedCostMicros", "estimated_cost_micros", "totalCostMicros", "total_cost_micros"]);
  if (explicitMicros !== undefined) return Math.round(explicitMicros);

  const directUsd = numberField(value, ["costUsd", "cost_usd", "estimatedCostUsd", "estimated_cost_usd", "totalCostUsd", "total_cost_usd", "costDollars", "cost_dollars"]);
  if (directUsd !== undefined) return dollarsToMicros(directUsd);

  const cost = value.cost;
  if (typeof cost === "number" && Number.isFinite(cost)) return dollarsToMicros(cost);
  if (!isRecord(cost)) return undefined;

  const nestedMicros = numberField(cost, ["micros", "costMicros", "cost_micros", "totalMicros", "total_micros"]);
  if (nestedMicros !== undefined) return Math.round(nestedMicros);

  const nestedTotal = numberField(cost, ["total", "usd", "dollars", "costUsd", "cost_usd"]);
  if (nestedTotal !== undefined) return dollarsToMicros(nestedTotal);

  const componentUsd = sumDefined([
    numberField(cost, ["input", "prompt"]),
    numberField(cost, ["output", "completion"]),
    numberField(cost, ["cacheRead", "cache_read"]),
    numberField(cost, ["cacheWrite", "cache_write"]),
  ]);
  return componentUsd === undefined ? undefined : dollarsToMicros(componentUsd);
}

function sumProviderUsages(usages: ProviderUsage[], source?: string): ProviderUsage | undefined {
  if (usages.length === 0) return undefined;
  const inputTokens = sumDefined(usages.map((usage) => usage.inputTokens));
  const outputTokens = sumDefined(usages.map((usage) => usage.outputTokens));
  const cacheReadTokens = sumDefined(usages.map((usage) => usage.cacheReadTokens));
  const cacheWriteTokens = sumDefined(usages.map((usage) => usage.cacheWriteTokens));
  const reasoningTokens = sumDefined(usages.map((usage) => usage.reasoningTokens));
  const totalTokens = sumDefined(usages.map((usage) => usage.totalTokens))
    ?? sumDefined([inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens]);
  const costMicros = sumDefined(usages.map((usage) => usage.costMicros));
  const sources = source ? [source] : Array.from(new Set(usages.flatMap((usage) => usage.sources)));
  const usage: ProviderUsage = {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    reasoningTokens,
    totalTokens,
    costMicros,
    sources,
  };
  return hasPositiveUsage(usage) ? usage : undefined;
}

function hasPositiveUsage(usage: ProviderUsage): boolean {
  return [
    usage.inputTokens,
    usage.outputTokens,
    usage.cacheReadTokens,
    usage.cacheWriteTokens,
    usage.reasoningTokens,
    usage.totalTokens,
    usage.costMicros,
  ].some((value) => value !== undefined && value > 0);
}

function numberField(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, value);
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Math.max(0, Number(value));
  }
  return undefined;
}

function sumDefined(values: Array<number | undefined>): number | undefined {
  let total = 0;
  let found = false;
  for (const value of values) {
    if (value === undefined) continue;
    total += value;
    found = true;
  }
  return found ? Math.max(0, total) : undefined;
}

function dollarsToMicros(value: number): number {
  return Math.max(0, Math.round(value * 1_000_000));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

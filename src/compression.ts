export type ContextExactness = "exact" | "summary-ok" | "reference-only";

export interface CompressibleContextItem {
  id: string;
  content?: string;
  scope?: string;
  priority?: string;
  exactness?: ContextExactness | string;
  estimatedTokens?: number;
}

export interface CompressionPolicy {
  contextWindowTokens: number;
  targetRatio: number;
  activeContextLimitTokens: number;
  largeItemThresholdTokens: number;
}

export interface CompressionAssessmentInput {
  items: CompressibleContextItem[];
  estimatedTokens: number;
  contextWindowTokens?: number;
  targetRatio?: number;
  largeItemThresholdTokens?: number;
}

export interface CompressionAssessment {
  policy: CompressionPolicy;
  estimatedTokens: number;
  overTarget: boolean;
  overByTokens: number;
  exactRefs: string[];
  summaryOkRefs: string[];
  referenceOnlyRefs: string[];
  externalizeRefs: string[];
  splitRecommended: boolean;
  recommendations: string[];
}

const defaultContextWindowTokens = 8_000;
const defaultTargetRatio = 0.75;
const defaultLargeItemThresholdTokens = 1_000;

export function createCompressionPolicy(
  contextWindowTokens = defaultContextWindowTokens,
  targetRatio = defaultTargetRatio,
  largeItemThresholdTokens = defaultLargeItemThresholdTokens,
): CompressionPolicy {
  const normalizedWindow = Number.isFinite(contextWindowTokens) && contextWindowTokens > 0 ? Math.floor(contextWindowTokens) : defaultContextWindowTokens;
  const normalizedRatio = Number.isFinite(targetRatio) && targetRatio > 0 && targetRatio <= 1 ? targetRatio : defaultTargetRatio;
  const normalizedThreshold = Number.isFinite(largeItemThresholdTokens) && largeItemThresholdTokens > 0
    ? Math.floor(largeItemThresholdTokens)
    : defaultLargeItemThresholdTokens;
  return {
    contextWindowTokens: normalizedWindow,
    targetRatio: normalizedRatio,
    activeContextLimitTokens: Math.floor(normalizedWindow * normalizedRatio),
    largeItemThresholdTokens: normalizedThreshold,
  };
}

export function assessCompression(input: CompressionAssessmentInput): CompressionAssessment {
  const policy = createCompressionPolicy(input.contextWindowTokens, input.targetRatio, input.largeItemThresholdTokens);
  const exactRefs: string[] = [];
  const summaryOkRefs: string[] = [];
  const referenceOnlyRefs: string[] = [];
  const externalizeRefs: string[] = [];

  for (const item of input.items) {
    const exactness = normalizeExactness(item.exactness, item.scope);
    if (exactness === "exact") exactRefs.push(item.id);
    if (exactness === "summary-ok") summaryOkRefs.push(item.id);
    if (exactness === "reference-only") referenceOnlyRefs.push(item.id);
    if (exactness === "exact" && estimateItemTokens(item) > policy.largeItemThresholdTokens) externalizeRefs.push(item.id);
  }

  const overByTokens = Math.max(0, input.estimatedTokens - policy.activeContextLimitTokens);
  const overTarget = overByTokens > 0;
  const recommendations = buildRecommendations({ overTarget, overByTokens, exactRefs, summaryOkRefs, referenceOnlyRefs, externalizeRefs });

  return {
    policy,
    estimatedTokens: input.estimatedTokens,
    overTarget,
    overByTokens,
    exactRefs,
    summaryOkRefs,
    referenceOnlyRefs,
    externalizeRefs,
    splitRecommended: overTarget,
    recommendations,
  };
}

export function formatCompressionGuidance(assessment: CompressionAssessment): string {
  const lines = [
    "## Compression and Exact-Preservation Policy",
    `Active context target: <= ${assessment.policy.activeContextLimitTokens} tokens (${Math.round(assessment.policy.targetRatio * 100)}% of ${assessment.policy.contextWindowTokens}). Current estimate: ${assessment.estimatedTokens}.`,
    "- Preserve exact context unchanged; do not paraphrase code, commands, identifiers, API signatures, requirements, contracts, or validation evidence marked exact.",
    "- Compress only `summary-ok` context into concise claims with evidence refs.",
    "- Keep `reference-only` context as ids/paths unless retrieval is explicitly needed.",
    "- Store large or exact material externally and keep stable references in active context.",
  ];

  if (assessment.exactRefs.length > 0) lines.push(`Exact refs: ${assessment.exactRefs.join(", ")}`);
  if (assessment.summaryOkRefs.length > 0) lines.push(`Summary-ok refs: ${assessment.summaryOkRefs.join(", ")}`);
  if (assessment.referenceOnlyRefs.length > 0) lines.push(`Reference-only refs: ${assessment.referenceOnlyRefs.join(", ")}`);
  if (assessment.externalizeRefs.length > 0) lines.push(`Externalize exact refs if they must be carried forward: ${assessment.externalizeRefs.join(", ")}`);
  for (const recommendation of assessment.recommendations) lines.push(`- ${recommendation}`);
  return lines.join("\n");
}

export function normalizeExactness(value: string | undefined, scope?: string): ContextExactness {
  if (value === "exact" || value === "summary-ok" || value === "reference-only") return value;
  if (scope === "reference-only") return "reference-only";
  if (scope === "summary") return "summary-ok";
  return "exact";
}

function buildRecommendations(input: {
  overTarget: boolean;
  overByTokens: number;
  exactRefs: string[];
  summaryOkRefs: string[];
  referenceOnlyRefs: string[];
  externalizeRefs: string[];
}): string[] {
  const recommendations: string[] = [];
  if (input.exactRefs.length > 0) {
    recommendations.push("Keep exact refs unchanged; if too large, move them to memory/files and cite ids instead of summarizing them.");
  }
  if (input.summaryOkRefs.length > 0) {
    recommendations.push("Summarize summary-ok refs to task-relevant conclusions plus evidence refs.");
  }
  if (input.referenceOnlyRefs.length > 0) {
    recommendations.push("Do not expand reference-only refs unless they become required for the current task.");
  }
  if (input.externalizeRefs.length > 0) {
    recommendations.push("Externalize large exact refs before continuing so exact data is preserved outside active context.");
  }
  if (input.overTarget) {
    recommendations.push(`Context exceeds the active target by ${input.overByTokens} tokens; split the work or spawn a fresh minimal-context agent after externalizing necessary exact data.`);
  }
  if (recommendations.length === 0) {
    recommendations.push("Context is within target; keep active context minimal and preserve refs for omitted data.");
  }
  return recommendations;
}

function estimateItemTokens(item: CompressibleContextItem): number {
  if (item.estimatedTokens !== undefined) return item.estimatedTokens;
  return Math.ceil((item.content ?? "").length / 4);
}

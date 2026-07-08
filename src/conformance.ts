/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

export type ConformanceSeverity = "failure" | "warning";
export type AutomationStopCategory = "completed" | "deterministic_blocker" | "conformance_failure";

export interface ConformanceDiagnostic {
  id: string;
  severity: ConformanceSeverity;
  message: string;
  requirementId?: string;
  evidence?: string[];
}

export interface AutomationStopClassification {
  category: AutomationStopCategory;
  accepted: boolean;
  reason: string;
}

export interface ScalerEntrypointDocsInput {
  manualCommands: string;
  manualWorkflow: string;
}

export interface ConformanceCheckInput extends ScalerEntrypointDocsInput {
  requirementsCatalog: string;
  traceabilityMatrix: string;
}

export interface ConformanceReport {
  ok: boolean;
  diagnostics: ConformanceDiagnostic[];
}

export interface TraceabilityRow {
  requirementId: string;
  status: string;
  implementationTasks: string;
  codeArtifacts: string;
  tests: string;
  docs: string;
  gap: string;
}

const deterministicBlockerReasons = new Set(["blocked", "paused", "idle"]);
const conformanceFailureReasons = new Set([
  "max_steps",
  "stage_workflow_rejected",
  "task_agent_rejected",
  "validation_rejected",
  "commit_rejected",
  "debug_rejected",
  "failed",
  "no_progress",
]);

export function classifyAutomationStopReason(stopReason: string): AutomationStopClassification {
  const normalized = stopReason.trim().toLowerCase();
  if (normalized === "completed") {
    return {
      category: "completed",
      accepted: true,
      reason: "Automation completed all planned work.",
    };
  }
  if (deterministicBlockerReasons.has(normalized)) {
    return {
      category: "deterministic_blocker",
      accepted: true,
      reason: "Automation stopped on an explicit deterministic blocker.",
    };
  }
  if (conformanceFailureReasons.has(normalized)) {
    return {
      category: "conformance_failure",
      accepted: false,
      reason: `Automation stop reason ${normalized} indicates the top-level workflow did not complete or stop on an accepted blocker.`,
    };
  }
  return {
    category: "conformance_failure",
    accepted: false,
    reason: `Unknown automation stop reason ${stopReason || "<empty>"}.`,
  };
}

export function evaluateTraceabilityMarkdown(markdown: string): ConformanceDiagnostic[] {
  const diagnostics: ConformanceDiagnostic[] = [];
  for (const row of parseTraceabilityRows(markdown)) {
    if (normalizeStatus(row.status) !== "implemented") continue;
    if (isBlankEvidence(row.codeArtifacts)) {
      diagnostics.push({
        id: "traceability-implemented-code-missing",
        severity: "failure",
        requirementId: row.requirementId,
        message: `${row.requirementId} is marked Implemented but is missing code/artifact evidence.`,
      });
    }
    if (isBlankEvidence(row.tests)) {
      diagnostics.push({
        id: "traceability-implemented-tests-missing",
        severity: "failure",
        requirementId: row.requirementId,
        message: `${row.requirementId} is marked Implemented but is missing test coverage evidence.`,
      });
    }
    if (isBlankEvidence(row.docs)) {
      diagnostics.push({
        id: "traceability-implemented-docs-missing",
        severity: "failure",
        requirementId: row.requirementId,
        message: `${row.requirementId} is marked Implemented but is missing manual/docs evidence.`,
      });
    }
    if (/\b(missing|todo|not yet|gap remains)\b/i.test(stripMarkdown(row.gap))) {
      diagnostics.push({
        id: "traceability-implemented-gap-open",
        severity: "warning",
        requirementId: row.requirementId,
        message: `${row.requirementId} is marked Implemented but its gap column still indicates unfinished work.`,
      });
    }
  }
  return diagnostics;
}

export function evaluateRequirementsTraceability(requirementsCatalog: string, traceabilityMatrix: string): ConformanceDiagnostic[] {
  const rows = new Set(parseTraceabilityRows(traceabilityMatrix).map((row) => row.requirementId));
  const diagnostics: ConformanceDiagnostic[] = [];
  for (const requirementId of extractRequirementIds(requirementsCatalog)) {
    if (rows.has(requirementId)) continue;
    diagnostics.push({
      id: "traceability-requirement-row-missing",
      severity: "failure",
      requirementId,
      message: `${requirementId} exists in requirements-catalog.md but has no traceability matrix row.`,
    });
  }
  return diagnostics;
}

export function evaluateScalerEntrypointDocs(input: ScalerEntrypointDocsInput): ConformanceDiagnostic[] {
  const diagnostics: ConformanceDiagnostic[] = [];
  const scalerSection = extractSection(input.manualCommands, "## `/scaler <request>`");
  const combined = `${scalerSection}\n${input.manualWorkflow}`;
  const normalized = combined.toLowerCase();

  if (/early entrypoint/i.test(scalerSection) || /does not yet execute the full stage i-iv workflow/i.test(scalerSection)) {
    diagnostics.push({
      id: "docs-scaler-entrypoint-stale",
      severity: "failure",
      message: "/scaler documentation still describes the command as an early entrypoint instead of the full automation entrypoint.",
      evidence: ["manual/commands.md"],
    });
  }

  if (!normalized.includes("until completion or a deterministic blocker")) {
    diagnostics.push({
      id: "docs-scaler-entrypoint-stop-contract-missing",
      severity: "failure",
      message: "/scaler documentation must state that automation runs until completion or a deterministic blocker.",
      evidence: ["manual/commands.md", "manual/workflow.md"],
    });
  }

  if (!normalized.includes("bounded automation loop")) {
    diagnostics.push({
      id: "docs-scaler-entrypoint-loop-missing",
      severity: "failure",
      message: "/scaler workflow documentation must describe the bounded automation loop.",
      evidence: ["manual/workflow.md"],
    });
  }

  for (const requiredPhrase of ["staged workflow", "plan/task synchronization", "task-agent execution", "validation"]) {
    if (!normalized.includes(requiredPhrase)) {
      diagnostics.push({
        id: "docs-scaler-entrypoint-phase-missing",
        severity: "failure",
        message: `/scaler workflow documentation is missing required phase: ${requiredPhrase}.`,
        evidence: ["manual/workflow.md"],
      });
    }
  }

  return diagnostics;
}

export function runConformanceChecks(input: ConformanceCheckInput): ConformanceReport {
  const diagnostics = [
    ...evaluateRequirementsTraceability(input.requirementsCatalog, input.traceabilityMatrix),
    ...evaluateTraceabilityMarkdown(input.traceabilityMatrix),
    ...evaluateScalerEntrypointDocs(input),
  ];
  return {
    ok: diagnostics.every((diagnostic) => diagnostic.severity !== "failure"),
    diagnostics,
  };
}

export function parseTraceabilityRows(markdown: string): TraceabilityRow[] {
  const rows: TraceabilityRow[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    if (!line.trim().startsWith("|")) continue;
    if (!/\|\s*PRD-[A-Z0-9]+/i.test(line)) continue;
    const cells = splitMarkdownTableRow(line);
    if (cells.length < 7) continue;
    rows.push({
      requirementId: cells[0] ?? "",
      status: cells[1] ?? "",
      implementationTasks: cells[2] ?? "",
      codeArtifacts: cells[3] ?? "",
      tests: cells[4] ?? "",
      docs: cells[5] ?? "",
      gap: cells[6] ?? "",
    });
  }
  return rows;
}

export function extractRequirementIds(markdown: string): string[] {
  const ids = new Set<string>();
  for (const line of markdown.split(/\r?\n/)) {
    const match = /^\|\s*(PRD-[A-Z0-9]+)\s*\|/i.exec(line.trim());
    if (match?.[1]) ids.add(match[1]);
  }
  return [...ids].sort((a, b) => a.localeCompare(b));
}

function splitMarkdownTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

function normalizeStatus(value: string): string {
  return stripMarkdown(value).trim().toLowerCase();
}

function isBlankEvidence(value: string): boolean {
  const normalized = stripMarkdown(value).replace(/\s+/g, " ").trim().toLowerCase();
  return normalized.length === 0 || ["—", "-", "n/a", "na", "none", "tbd"].includes(normalized);
}

function stripMarkdown(value: string): string {
  return value
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1")
    .replace(/\*\*/g, "")
    .trim();
}

function extractSection(markdown: string, heading: string): string {
  const start = markdown.indexOf(heading);
  if (start < 0) return "";
  const afterStart = markdown.slice(start + heading.length);
  const nextHeading = afterStart.search(/^##\s+/m);
  return `${heading}${nextHeading >= 0 ? afterStart.slice(0, nextHeading) : afterStart}`;
}

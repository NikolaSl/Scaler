import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { appendLogEvent, createLogEvent } from "./logging.js";
import { getDebugAttemptsPath, getDebugFailuresPath } from "./paths.js";
import { requestReplan } from "./replanning.js";
import { transitionTask } from "./supervisor.js";
import type { ScalerState } from "./types.js";

export type DebugAttemptResult = "fixed" | "same_failure" | "new_failure" | "partial" | "no_effect" | "worse" | "blocked";

export interface DebugFailureRecord {
  id: string;
  taskId: string;
  fingerprint: string;
  summary?: string;
  validationCommand?: string;
  expectedResult?: string;
  actualResult?: string;
  outputRefs?: string[];
  firstSeenAt: string;
  lastSeenAt: string;
  attemptCount: number;
}

export interface DebugAttemptRecord {
  id: string;
  taskId: string;
  failureId: string;
  hypothesis: string;
  actionSummary: string;
  result: DebugAttemptResult;
  attemptSignature: string;
  failureFingerprint?: string;
  resultingFailureFingerprint?: string;
  changedFiles?: string[];
  commands?: string[];
  evidence?: string[];
  validationRun?: string;
  logRefs?: string[];
  newEvidence?: string;
  cycleDetected?: string;
  timestamp: string;
}

export interface DebugAttemptInput {
  taskId: string;
  failureId: string;
  hypothesis: string;
  actionSummary: string;
  result: DebugAttemptResult | string;
  failureFingerprint?: string;
  resultingFailureFingerprint?: string;
  attemptSignature?: string;
  changedFiles?: string[];
  commands?: string[];
  evidence?: string[];
  validationRun?: string;
  logRefs?: string[];
  newEvidence?: string;
  failureSummary?: string;
  validationCommand?: string;
  expectedResult?: string;
  actualResult?: string;
  outputRefs?: string[];
}

export interface DebugAttemptApplyResult {
  accepted: boolean;
  message: string;
  attempt?: DebugAttemptRecord;
  duplicateAttemptId?: string;
  cycleDetected?: string;
  replanRequestId?: string;
}

interface DebugFailureIndex {
  version: 1;
  failures: DebugFailureRecord[];
}

interface DebugAttemptIndex {
  version: 1;
  attempts: DebugAttemptRecord[];
}

const debugAttemptResults = new Set<DebugAttemptResult>([
  "fixed",
  "same_failure",
  "new_failure",
  "partial",
  "no_effect",
  "worse",
  "blocked",
]);

export function isDebugAttemptResult(value: unknown): value is DebugAttemptResult {
  return typeof value === "string" && debugAttemptResults.has(value as DebugAttemptResult);
}

export async function loadDebugFailures(cwd: string): Promise<DebugFailureRecord[]> {
  return (await readJsonFile<DebugFailureIndex>(getDebugFailuresPath(cwd), { version: 1, failures: [] })).failures;
}

export async function loadDebugAttempts(cwd: string): Promise<DebugAttemptRecord[]> {
  return (await readJsonFile<DebugAttemptIndex>(getDebugAttemptsPath(cwd), { version: 1, attempts: [] })).attempts;
}

export async function recordDebugAttempt(
  cwd: string,
  state: ScalerState,
  input: DebugAttemptInput,
  now = new Date(),
): Promise<DebugAttemptApplyResult> {
  if (!isDebugAttemptResult(input.result)) {
    const message = `Debug attempt rejected: invalid result ${String(input.result)}`;
    await appendLogEvent(cwd, createLogEvent(state, { eventType: "debug", summary: message, taskId: input.taskId, details: input }));
    return { accepted: false, message };
  }

  const attempts = await loadDebugAttempts(cwd);
  const attemptSignature = normalizeSignature(input.attemptSignature ?? `${input.hypothesis} ${input.actionSummary}`);
  const failureFingerprint = normalizeFingerprint(input.failureFingerprint);
  const resultingFailureFingerprint = normalizeFingerprint(input.resultingFailureFingerprint ?? input.failureFingerprint);
  const duplicate = findDuplicateAttempt(attempts, {
    taskId: input.taskId,
    failureId: input.failureId,
    attemptSignature,
    resultingFailureFingerprint,
  });

  if (duplicate && !input.newEvidence?.trim()) {
    const message = `Debug attempt rejected: repeated attempt ${duplicate.id} without new evidence`;
    await appendLogEvent(
      cwd,
      createLogEvent(state, {
        eventType: "debug",
        summary: message,
        taskId: input.taskId,
        details: { input, duplicateAttemptId: duplicate.id },
      }),
    );
    return { accepted: false, message, duplicateAttemptId: duplicate.id };
  }

  const timestamp = now.toISOString();
  const attempt: DebugAttemptRecord = {
    id: randomUUID(),
    taskId: input.taskId,
    failureId: input.failureId,
    hypothesis: input.hypothesis,
    actionSummary: input.actionSummary,
    result: input.result,
    attemptSignature,
    failureFingerprint: failureFingerprint || undefined,
    resultingFailureFingerprint: resultingFailureFingerprint || undefined,
    changedFiles: input.changedFiles,
    commands: input.commands,
    evidence: input.evidence,
    validationRun: input.validationRun,
    logRefs: input.logRefs,
    newEvidence: input.newEvidence,
    timestamp,
  };

  const cycleDetected = detectFingerprintCycle(attempts, attempt);
  if (cycleDetected) attempt.cycleDetected = cycleDetected;

  const failures = upsertFailure(await loadDebugFailures(cwd), input, timestamp, failureFingerprint || resultingFailureFingerprint || "unknown");
  await writeJsonFile(getDebugFailuresPath(cwd), { version: 1, failures } satisfies DebugFailureIndex);
  await writeJsonFile(getDebugAttemptsPath(cwd), { version: 1, attempts: [...attempts, attempt] } satisfies DebugAttemptIndex);

  let finalState = state;
  let replanRequestId: string | undefined;
  if (cycleDetected || input.result === "blocked") {
    const task = state.tasks.find((candidate) => candidate.id === input.taskId);
    if (task?.status === "debugging") {
      finalState = transitionTask(state, input.taskId, "needs_replan", {
        reason: cycleDetected ?? input.failureSummary ?? "Debug attempt blocked; replanning required.",
        now,
      });
    }
    const replan = await requestReplan(cwd, finalState, {
      trigger: cycleDetected ? "debug_cycle" : "debug_blocked",
      reason: cycleDetected ?? input.failureSummary ?? "Debug attempt blocked; replanning required.",
      taskId: input.taskId,
      evidenceRefs: input.evidence,
      requirementRefs: task?.prdRefs,
    }, now);
    finalState = replan.state;
    replanRequestId = replan.request.id;
  }

  const message = cycleDetected
    ? `Debug attempt recorded with cycle detected: ${attempt.id}`
    : `Debug attempt recorded: ${attempt.id}`;
  await appendLogEvent(
    cwd,
    createLogEvent(finalState, {
      eventType: "debug",
      summary: message,
      taskId: input.taskId,
      details: { attempt, replanRequestId },
    }),
  );

  return { accepted: true, message, attempt, cycleDetected, replanRequestId };
}

function findDuplicateAttempt(
  attempts: DebugAttemptRecord[],
  candidate: Pick<DebugAttemptRecord, "taskId" | "failureId" | "attemptSignature"> & { resultingFailureFingerprint: string },
): DebugAttemptRecord | undefined {
  return attempts.find((attempt) => {
    if (attempt.result === "fixed") return false;
    const previousResulting = normalizeFingerprint(attempt.resultingFailureFingerprint ?? attempt.failureFingerprint);
    return (
      attempt.taskId === candidate.taskId &&
      attempt.failureId === candidate.failureId &&
      attempt.attemptSignature === candidate.attemptSignature &&
      previousResulting === candidate.resultingFailureFingerprint
    );
  });
}

function detectFingerprintCycle(attempts: DebugAttemptRecord[], nextAttempt: DebugAttemptRecord): string | undefined {
  const previous = [...attempts]
    .reverse()
    .find((attempt) => attempt.taskId === nextAttempt.taskId && attempt.failureId === nextAttempt.failureId);
  if (!previous) return undefined;

  const previousFrom = normalizeFingerprint(previous.failureFingerprint);
  const previousTo = normalizeFingerprint(previous.resultingFailureFingerprint ?? previous.failureFingerprint);
  const nextFrom = normalizeFingerprint(nextAttempt.failureFingerprint);
  const nextTo = normalizeFingerprint(nextAttempt.resultingFailureFingerprint ?? nextAttempt.failureFingerprint);

  if (previousFrom && previousTo && nextFrom && nextTo && previousFrom === nextTo && previousTo === nextFrom && nextFrom !== nextTo) {
    return `Failure fingerprints cycled ${previousFrom} -> ${previousTo} -> ${nextTo}.`;
  }

  return undefined;
}

function upsertFailure(
  failures: DebugFailureRecord[],
  input: DebugAttemptInput,
  timestamp: string,
  fingerprint: string,
): DebugFailureRecord[] {
  const existing = failures.find((failure) => failure.id === input.failureId && failure.taskId === input.taskId);
  if (!existing) {
    return [
      ...failures,
      {
        id: input.failureId,
        taskId: input.taskId,
        fingerprint,
        summary: input.failureSummary,
        validationCommand: input.validationCommand,
        expectedResult: input.expectedResult,
        actualResult: input.actualResult,
        outputRefs: input.outputRefs,
        firstSeenAt: timestamp,
        lastSeenAt: timestamp,
        attemptCount: 1,
      },
    ];
  }

  return failures.map((failure) =>
    failure === existing
      ? {
          ...failure,
          fingerprint,
          summary: input.failureSummary ?? failure.summary,
          validationCommand: input.validationCommand ?? failure.validationCommand,
          expectedResult: input.expectedResult ?? failure.expectedResult,
          actualResult: input.actualResult ?? failure.actualResult,
          outputRefs: input.outputRefs ?? failure.outputRefs,
          lastSeenAt: timestamp,
          attemptCount: failure.attemptCount + 1,
        }
      : failure,
  );
}

function normalizeSignature(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeFingerprint(value: string | undefined): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\/tmp\/[^\s]+/g, "/tmp/*")
    .replace(/line \d+/g, "line *")
    .replace(/:\d+:\d+/g, ":*:*")
    .replace(/\s+/g, " ");
}

async function readJsonFile<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

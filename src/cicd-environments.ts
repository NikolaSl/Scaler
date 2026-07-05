import { constants } from "node:fs";
import { access, chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getCicdDir, getCicdEnvironmentRecordsPath } from "./paths.js";
import { runSafetyScans, type SafetyScanResult } from "./safety.js";
import type { ValidationEnvironmentKind } from "./validation.js";

export type CicdEnvironmentKind = Exclude<ValidationEnvironmentKind, "host">;
export type CicdEnvironmentProvisionStatus = "planned" | "generated" | "blocked";
export type CicdSafetyCheckStatus = "passed" | "warning" | "blocked";

export interface CicdGeneratedFile {
  path: string;
  purpose: string;
  executable?: boolean;
  action: "planned" | "written";
}

export interface CicdSafetyCheck {
  code: string;
  status: CicdSafetyCheckStatus;
  message: string;
}

export interface CicdStackDetection {
  stack: string;
  packageManager?: string;
  existingTooling: string[];
  defaultCommands: string[];
  limitations: string[];
}

export interface CicdEnvironmentProvisionInput {
  environment?: string;
  taskId?: string;
  commandId?: string;
  stack?: string;
  validationCommand?: string;
  validationCommands?: string[];
  services?: string[];
  acceptanceApproach?: string;
}

export interface CicdEnvironmentProvisionOptions {
  execute?: boolean;
  runScanners?: boolean;
  now?: Date;
}

export interface CicdEnvironmentProvisionRecord {
  version: 1;
  id: string;
  environment: CicdEnvironmentKind;
  taskId?: string;
  commandId?: string;
  status: CicdEnvironmentProvisionStatus;
  stack: string;
  packageManager?: string;
  validationCommands: string[];
  services?: string[];
  acceptanceApproach?: string;
  generatedFiles: CicdGeneratedFile[];
  wrapperCommand: string;
  safetyChecks: CicdSafetyCheck[];
  scannerRecordIds?: string[];
  scannerSummary?: Partial<Record<string, number>>;
  artifactRefs: string[];
  cleanupPlan: string[];
  limitations: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CicdValidationExecutionPreparation {
  record: CicdEnvironmentProvisionRecord;
  executionCommand: string;
  artifactRefs: string[];
}

interface CicdEnvironmentRecordIndex {
  version: 1;
  records: CicdEnvironmentProvisionRecord[];
}

interface GeneratedFilePlan {
  path: string;
  purpose: string;
  content: string;
  executable?: boolean;
}

const cicdEnvironmentAliases: Record<string, CicdEnvironmentKind> = {
  docker: "docker",
  container: "docker",
  containers: "docker",
  compose: "compose",
  docker_compose: "compose",
  dockercompose: "compose",
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

const secretPatterns = [
  /(?:secret|token|password|private[_-]?key)\s*[:=]\s*['\"]?[A-Za-z0-9_./+=-]{8,}/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

const sensitiveWritableMountPatterns = [
  /\/:\/workspace(?::|$)/,
  /:\/workspace:(?:rw|z|delegated|cached)/,
  /\$HOME:\/workspace/,
  /~\/:\/workspace/,
  /\/var\/run\/docker\.sock/,
];

export async function loadCicdEnvironmentRecords(cwd: string): Promise<CicdEnvironmentProvisionRecord[]> {
  try {
    const raw = await readFile(getCicdEnvironmentRecordsPath(cwd), "utf8");
    const parsed = JSON.parse(raw) as Partial<CicdEnvironmentRecordIndex>;
    return Array.isArray(parsed.records) ? parsed.records.map(normalizeCicdRecord).filter((record): record is CicdEnvironmentProvisionRecord => Boolean(record)) : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export function formatCicdEnvironmentRecords(records: CicdEnvironmentProvisionRecord[], limit = 10): string {
  if (!records.length) return "No CI/CD environment records.";
  const sorted = [...records].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const shown = sorted.slice(0, Math.max(1, limit));
  const lines = [`CI/CD environments: records=${records.length} showing=${shown.length}`];
  for (const record of shown) {
    const scanner = record.scannerRecordIds?.length ? ` scanners=${record.scannerRecordIds.length}` : "";
    const files = record.generatedFiles.length ? ` files=${record.generatedFiles.length}` : "";
    lines.push(`- ${record.id} env=${record.environment} status=${record.status} stack=${record.stack}${files}${scanner} wrapper=${record.wrapperCommand}`);
    if (record.limitations.length) lines.push(`  limitations=${record.limitations.join("; ")}`);
  }
  return lines.join("\n");
}

export async function detectCicdStack(cwd: string): Promise<CicdStackDetection> {
  const existingTooling: string[] = [];
  const defaultCommands: string[] = [];
  const limitations: string[] = [];
  let stack = "generic";
  let packageManager: string | undefined;

  const hasPackageJson = await fileExists(cwd, "package.json");
  if (hasPackageJson) {
    stack = "node";
    packageManager = await detectNodePackageManager(cwd);
    existingTooling.push("package.json");
    try {
      const pkg = JSON.parse(await readFile(join(cwd, "package.json"), "utf8")) as { scripts?: Record<string, string> };
      for (const scriptName of ["build", "test", "test:unit", "lint", "typecheck", "test:integration", "smoke", "audit"]) {
        if (pkg.scripts?.[scriptName]) defaultCommands.push(scriptName === "test" ? "npm test" : `npm run ${scriptName}`);
      }
    } catch {
      limitations.push("package.json could not be parsed for default validation scripts.");
    }
  } else if (await fileExists(cwd, "pyproject.toml") || await fileExists(cwd, "requirements.txt")) {
    stack = "python";
    packageManager = await fileExists(cwd, "uv.lock") ? "uv" : await fileExists(cwd, "poetry.lock") ? "poetry" : "pip";
    existingTooling.push(...(await existingFiles(cwd, ["pyproject.toml", "requirements.txt", "uv.lock", "poetry.lock"])));
    defaultCommands.push("python -m pytest");
  } else if (await fileExists(cwd, "Cargo.toml")) {
    stack = "rust";
    packageManager = "cargo";
    existingTooling.push(...(await existingFiles(cwd, ["Cargo.toml", "Cargo.lock"])));
    defaultCommands.push("cargo test");
  } else if (await fileExists(cwd, "go.mod")) {
    stack = "go";
    packageManager = "go";
    existingTooling.push("go.mod");
    defaultCommands.push("go test ./...");
  } else if (await fileExists(cwd, "pom.xml") || await fileExists(cwd, "build.gradle") || await fileExists(cwd, "build.gradle.kts")) {
    stack = "java";
    packageManager = await fileExists(cwd, "pom.xml") ? "maven" : "gradle";
    existingTooling.push(...(await existingFiles(cwd, ["pom.xml", "build.gradle", "build.gradle.kts"])));
    defaultCommands.push(packageManager === "maven" ? "mvn test" : "./gradlew test");
  } else {
    limitations.push("No known package manifest detected; generated wrappers will use a generic base image and caller-supplied commands.");
  }

  existingTooling.push(...(await existingFiles(cwd, ["Dockerfile", "docker-compose.yml", "docker-compose.yaml", ".devcontainer/devcontainer.json", "k8s", "kubernetes"])).filter((item) => !existingTooling.includes(item)));
  return {
    stack,
    packageManager,
    existingTooling,
    defaultCommands: Array.from(new Set(defaultCommands)),
    limitations,
  };
}

export function normalizeCicdEnvironmentKind(value: unknown): CicdEnvironmentKind | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!normalized || normalized === "host" || normalized === "local" || normalized === "native") return undefined;
  return cicdEnvironmentAliases[normalized];
}

export async function provisionCicdEnvironment(
  cwd: string,
  input: CicdEnvironmentProvisionInput = {},
  options: CicdEnvironmentProvisionOptions = {},
): Promise<CicdEnvironmentProvisionRecord> {
  const now = options.now ?? new Date();
  const environment = normalizeCicdEnvironmentKind(input.environment) ?? "local_ci";
  const detection = await detectCicdStack(cwd);
  const stack = normalizeOptionalString(input.stack) ?? detection.stack;
  const validationCommands = normalizeStringList([
    ...(input.validationCommands ?? []),
    ...(input.validationCommand ? [input.validationCommand] : []),
  ]) ?? detection.defaultCommands;
  const id = createCicdRecordId(now, environment, input.taskId, input.commandId);
  const filePlans = generateCicdFilePlans(environment, stack, validationCommands);
  const safetyChecks = evaluateGeneratedFileSafety(environment, filePlans);
  const scanner = options.runScanners === true ? await runSafetyScans(cwd, { execute: false, now }) : undefined;
  if (scanner) safetyChecks.push(...buildScannerSafetyChecks(scanner));
  else safetyChecks.push({ code: "scanner_not_requested", status: "warning", message: "Scanner planning was not requested for this provisioning pass." });

  const status: CicdEnvironmentProvisionStatus = safetyChecks.some((check) => check.status === "blocked")
    ? "blocked"
    : options.execute === true
      ? "generated"
      : "planned";
  const generatedFiles: CicdGeneratedFile[] = filePlans.map((file) => ({
    path: file.path,
    purpose: file.purpose,
    executable: file.executable,
    action: status === "generated" ? "written" : "planned",
  }));

  if (status === "generated") {
    for (const file of filePlans) {
      const absolute = join(cwd, file.path);
      await mkdir(dirname(absolute), { recursive: true });
      await writeFile(absolute, file.content, "utf8");
      if (file.executable) await chmod(absolute, 0o755);
    }
  }

  const record: CicdEnvironmentProvisionRecord = {
    version: 1,
    id,
    environment,
    taskId: normalizeOptionalString(input.taskId),
    commandId: normalizeOptionalString(input.commandId),
    status,
    stack,
    packageManager: detection.packageManager,
    validationCommands,
    services: normalizeStringList(input.services),
    acceptanceApproach: normalizeOptionalString(input.acceptanceApproach),
    generatedFiles,
    wrapperCommand: `${wrapperCommandPrefix(environment)} -- <validation-command>`,
    safetyChecks,
    scannerRecordIds: scanner?.records.map((record) => record.id),
    scannerSummary: scanner?.summary,
    artifactRefs: [".scaler/cicd/logs/", ".scaler/cicd/artifacts/", getCicdEnvironmentRecordsPath(".").replace(/^\.\//, "")],
    cleanupPlan: cleanupPlan(environment),
    limitations: buildLimitations(environment, detection, safetyChecks),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  await appendCicdRecord(cwd, record);
  return record;
}

export async function prepareCicdValidationExecution(
  cwd: string,
  input: { environment: string; taskId?: string; commandId: string; command: string },
  options: CicdEnvironmentProvisionOptions = {},
): Promise<CicdValidationExecutionPreparation> {
  const record = await provisionCicdEnvironment(cwd, {
    environment: input.environment,
    taskId: input.taskId,
    commandId: input.commandId,
    validationCommand: input.command,
  }, { ...options, execute: true, runScanners: options.runScanners ?? false });
  if (record.status === "blocked") {
    throw new Error(`CI/CD environment ${record.environment} provisioning blocked: ${record.safetyChecks.filter((check) => check.status === "blocked").map((check) => check.message).join("; ")}`);
  }
  return {
    record,
    executionCommand: `${wrapperCommandPrefix(record.environment)} -- ${shellQuote(input.command)}`,
    artifactRefs: record.artifactRefs,
  };
}

async function appendCicdRecord(cwd: string, record: CicdEnvironmentProvisionRecord): Promise<void> {
  const records = await loadCicdEnvironmentRecords(cwd);
  const path = getCicdEnvironmentRecordsPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ version: 1, records: [record, ...records] } satisfies CicdEnvironmentRecordIndex, null, 2)}\n`, "utf8");
}

function generateCicdFilePlans(environment: CicdEnvironmentKind, stack: string, commands: string[]): GeneratedFilePlan[] {
  const common = [
    localCiWrapper(),
    { path: ".scaler/cicd/README.md", purpose: "CI/CD sandbox usage notes", content: cicdReadme(environment, stack, commands) },
  ];
  if (environment === "local_ci") return common;
  if (environment === "docker") return [...common, dockerfile(stack), dockerWrapper()];
  if (environment === "compose") return [...common, dockerfile(stack), composeFile(), composeWrapper()];
  if (environment === "devcontainer") return [...common, dockerfile(stack), devcontainerConfig(), devcontainerWrapper()];
  return [...common, dockerfile(stack), minikubeNamespace(), minikubeWrapper()];
}

function localCiWrapper(): GeneratedFilePlan {
  return {
    path: ".scaler/cicd/run-local-ci.sh",
    purpose: "Local CI wrapper with secret environment scrubbing and log references",
    executable: true,
    content: `#!/usr/bin/env bash
set -euo pipefail
LOG_DIR="\${SCALER_CICD_LOG_DIR:-.scaler/cicd/logs}"
ARTIFACT_DIR="\${SCALER_CICD_ARTIFACT_DIR:-.scaler/cicd/artifacts}"
mkdir -p "$LOG_DIR" "$ARTIFACT_DIR"
LOG_FILE="$LOG_DIR/local-ci-$(date -u +%Y%m%dT%H%M%SZ).log"
if [ "\${1:-}" = "--" ]; then shift; fi
if [ "$#" -eq 0 ]; then echo "No validation command supplied." | tee "$LOG_FILE"; exit 2; fi
(
  env \
    -u AWS_SECRET_ACCESS_KEY \
    -u GITHUB_TOKEN \
    -u NPM_TOKEN \
    -u PYPI_TOKEN \
    -u DOCKER_PASSWORD \
    -u KUBECONFIG \
    bash -lc "$*"
) 2>&1 | tee "$LOG_FILE"
status=\${PIPESTATUS[0]}
echo "SCALER local-ci log: $LOG_FILE" >> "$LOG_FILE"
exit "$status"
`,
  };
}

function dockerfile(stack: string): GeneratedFilePlan {
  return {
    path: ".scaler/cicd/Dockerfile.scaler",
    purpose: "Generated local validation image definition",
    content: `# Generated by SCALER for local validation only. Do not place secrets in this image.
${baseImageForStack(stack)}
WORKDIR /workspace
ENV CI=true \
    SCALER_SANDBOX=true
RUN mkdir -p /tmp/scaler && chmod 1777 /tmp/scaler
`,
  };
}

function dockerWrapper(): GeneratedFilePlan {
  return {
    path: ".scaler/cicd/run-docker.sh",
    purpose: "Docker sandbox execution wrapper with project read-only mount, no network, resource limits, logs, and --rm cleanup",
    executable: true,
    content: `#!/usr/bin/env bash
set -euo pipefail
if [ "\${1:-}" = "--" ]; then shift; fi
if [ "$#" -eq 0 ]; then echo "No validation command supplied."; exit 2; fi
LOG_DIR="\${SCALER_CICD_LOG_DIR:-.scaler/cicd/logs}"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/docker-$(date -u +%Y%m%dT%H%M%SZ).log"
IMAGE="\${SCALER_CICD_IMAGE:-scaler-local-ci}"
DOCKERFILE="\${SCALER_CICD_DOCKERFILE:-.scaler/cicd/Dockerfile.scaler}"
docker build --pull=false -f "$DOCKERFILE" -t "$IMAGE" . 2>&1 | tee "$LOG_FILE"
docker run --rm --network none --cpus "2" --memory "2g" --read-only --tmpfs /tmp:rw,noexec,nosuid,size=512m -v "$(pwd):/workspace:ro" -w /workspace "$IMAGE" bash -lc "$*" 2>&1 | tee -a "$LOG_FILE"
exit \${PIPESTATUS[0]}
`,
  };
}

function composeFile(): GeneratedFilePlan {
  return {
    path: ".scaler/cicd/docker-compose.scaler.yml",
    purpose: "Docker Compose sandbox definition for validation services",
    content: `services:
  scaler-ci:
    build:
      context: ../..
      dockerfile: .scaler/cicd/Dockerfile.scaler
    working_dir: /workspace
    command: ["bash", "-lc", "echo SCALER compose sandbox ready"]
    network_mode: "none"
    read_only: true
    tmpfs:
      - /tmp:rw,noexec,nosuid,size=512m
    volumes:
      - ../..:/workspace:ro
    mem_limit: 2g
    cpus: 2
`,
  };
}

function composeWrapper(): GeneratedFilePlan {
  return {
    path: ".scaler/cicd/run-compose.sh",
    purpose: "Docker Compose validation wrapper with cleanup",
    executable: true,
    content: `#!/usr/bin/env bash
set -euo pipefail
if [ "\${1:-}" = "--" ]; then shift; fi
if [ "$#" -eq 0 ]; then echo "No validation command supplied."; exit 2; fi
LOG_DIR="\${SCALER_CICD_LOG_DIR:-.scaler/cicd/logs}"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/compose-$(date -u +%Y%m%dT%H%M%SZ).log"
COMPOSE_FILE="\${SCALER_CICD_COMPOSE_FILE:-.scaler/cicd/docker-compose.scaler.yml}"
cleanup() { docker compose -f "$COMPOSE_FILE" down -v --remove-orphans >> "$LOG_FILE" 2>&1 || true; }
trap cleanup EXIT
docker compose -f "$COMPOSE_FILE" run --rm scaler-ci bash -lc "$*" 2>&1 | tee "$LOG_FILE"
exit \${PIPESTATUS[0]}
`,
  };
}

function devcontainerConfig(): GeneratedFilePlan {
  return {
    path: ".scaler/cicd/devcontainer/devcontainer.json",
    purpose: "Dev-container validation configuration with no-network run args and resource limits",
    content: `{
  "name": "scaler-local-ci",
  "build": {
    "dockerfile": "../Dockerfile.scaler",
    "context": "../../.."
  },
  "workspaceFolder": "/workspace",
  "runArgs": ["--network", "none", "--cpus", "2", "--memory", "2g", "--read-only", "--tmpfs", "/tmp:rw,noexec,nosuid,size=512m"],
  "remoteEnv": {
    "CI": "true",
    "SCALER_SANDBOX": "true"
  }
}
`,
  };
}

function devcontainerWrapper(): GeneratedFilePlan {
  return {
    path: ".scaler/cicd/run-devcontainer.sh",
    purpose: "Dev-container validation wrapper with referenced logs",
    executable: true,
    content: `#!/usr/bin/env bash
set -euo pipefail
if [ "\${1:-}" = "--" ]; then shift; fi
if [ "$#" -eq 0 ]; then echo "No validation command supplied."; exit 2; fi
LOG_DIR="\${SCALER_CICD_LOG_DIR:-.scaler/cicd/logs}"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/devcontainer-$(date -u +%Y%m%dT%H%M%SZ).log"
devcontainer up --workspace-folder "$(pwd)" --config .scaler/cicd/devcontainer/devcontainer.json 2>&1 | tee "$LOG_FILE"
devcontainer exec --workspace-folder "$(pwd)" bash -lc "$*" 2>&1 | tee -a "$LOG_FILE"
exit \${PIPESTATUS[0]}
`,
  };
}

function minikubeNamespace(): GeneratedFilePlan {
  return {
    path: ".scaler/cicd/minikube/namespace.yaml",
    purpose: "Generated namespace for local Kubernetes validation without production secrets",
    content: `apiVersion: v1
kind: Namespace
metadata:
  name: scaler-local-ci
  labels:
    app.kubernetes.io/managed-by: scaler
`,
  };
}

function minikubeWrapper(): GeneratedFilePlan {
  return {
    path: ".scaler/cicd/run-minikube.sh",
    purpose: "Minikube validation wrapper with namespace cleanup and log references",
    executable: true,
    content: `#!/usr/bin/env bash
set -euo pipefail
if [ "\${1:-}" = "--" ]; then shift; fi
if [ "$#" -eq 0 ]; then echo "No validation command supplied."; exit 2; fi
LOG_DIR="\${SCALER_CICD_LOG_DIR:-.scaler/cicd/logs}"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/minikube-$(date -u +%Y%m%dT%H%M%SZ).log"
NAMESPACE="\${SCALER_CICD_NAMESPACE:-scaler-local-ci}"
cleanup() { kubectl delete namespace "$NAMESPACE" --ignore-not-found=true >> "$LOG_FILE" 2>&1 || true; }
trap cleanup EXIT
minikube status 2>&1 | tee "$LOG_FILE"
kubectl apply -f .scaler/cicd/minikube/namespace.yaml 2>&1 | tee -a "$LOG_FILE"
bash -lc "$*" 2>&1 | tee -a "$LOG_FILE"
exit \${PIPESTATUS[0]}
`,
  };
}

function cicdReadme(environment: CicdEnvironmentKind, stack: string, commands: string[]): string {
  return `# SCALER CI/CD Environment

Environment: ${environment}
Stack: ${stack}

Generated wrappers are local validation helpers. They avoid production credentials, write logs under \`.scaler/cicd/logs/\`, and keep generated artifacts under \`.scaler/cicd/artifacts/\`.

Validation commands:
${commands.length ? commands.map((command) => `- \`${command}\``).join("\n") : "- none supplied"}

Use the wrapper selected by the validation manifest; do not place secrets in generated images, Compose files, dev-container config, Kubernetes manifests, or logs.
`;
}

function evaluateGeneratedFileSafety(environment: CicdEnvironmentKind, files: GeneratedFilePlan[]): CicdSafetyCheck[] {
  const combined = files.map((file) => file.content).join("\n---\n");
  const checks: CicdSafetyCheck[] = [];
  checks.push({
    code: "no_production_credentials",
    status: secretPatterns.some((pattern) => pattern.test(combined)) ? "blocked" : "passed",
    message: secretPatterns.some((pattern) => pattern.test(combined))
      ? "Generated CI/CD files appear to contain secret-like material."
      : "Generated CI/CD files do not embed known production credential patterns.",
  });
  checks.push({
    code: "bounded_project_mounts",
    status: sensitiveWritableMountPatterns.some((pattern) => pattern.test(combined)) ? "blocked" : "passed",
    message: sensitiveWritableMountPatterns.some((pattern) => pattern.test(combined))
      ? "Generated CI/CD files include a broad or writable sensitive host mount."
      : "Generated CI/CD files use bounded project mounts without broad writable host-sensitive mounts.",
  });
  checks.push({
    code: "network_policy",
    status: environment === "local_ci" ? "warning" : combined.includes("--network none") || combined.includes("network_mode: \"none\"") ? "passed" : "warning",
    message: environment === "local_ci"
      ? "local_ci runs project-local commands on the host and cannot enforce container network isolation."
      : "Generated sandbox declares an explicit no-network policy where supported.",
  });
  checks.push({
    code: "resource_limits",
    status: environment === "local_ci" ? "warning" : /--cpus|cpus:|mem_limit|--memory/.test(combined) ? "passed" : "warning",
    message: environment === "local_ci"
      ? "local_ci cannot enforce container resource limits."
      : "Generated sandbox declares CPU and memory limits where supported.",
  });
  checks.push({
    code: "cleanup_behavior",
    status: /--rm|trap cleanup|No external resources/.test(combined) || environment === "local_ci" ? "passed" : "warning",
    message: environment === "local_ci"
      ? "local_ci cleanup is limited to referenced logs/artifacts; no external resources are created."
      : "Generated sandbox includes cleanup behavior such as --rm or cleanup traps.",
  });
  checks.push({
    code: "logs_by_reference",
    status: combined.includes(".scaler/cicd/logs") ? "passed" : "warning",
    message: "Generated wrappers store validation logs by reference under .scaler/cicd/logs/.",
  });
  return checks;
}

function buildScannerSafetyChecks(scanner: SafetyScanResult): CicdSafetyCheck[] {
  if (scanner.records.length === 0) {
    return [{ code: "scanner_limitations", status: "warning", message: "No dependency or image scanner candidates were discovered for this project." }];
  }
  return [{
    code: "scanner_records",
    status: scanner.records.some((record) => record.status === "failed") ? "blocked" : scanner.records.some((record) => record.status === "unavailable") ? "warning" : "passed",
    message: `Scanner records captured: planned=${scanner.summary.planned} unavailable=${scanner.summary.unavailable} passed=${scanner.summary.passed} failed=${scanner.summary.failed}.`,
  }];
}

function buildLimitations(environment: CicdEnvironmentKind, detection: CicdStackDetection, checks: CicdSafetyCheck[]): string[] {
  const limitations = [...detection.limitations];
  for (const check of checks) {
    if (check.status !== "passed") limitations.push(`${check.code}: ${check.message}`);
  }
  if (environment === "local_ci") limitations.push("local_ci is reproducible but not container-isolated; use docker/compose/devcontainer/minikube when project validation needs stronger sandboxing.");
  return Array.from(new Set(limitations));
}

function cleanupPlan(environment: CicdEnvironmentKind): string[] {
  if (environment === "local_ci") return ["No external resources are created.", "Validation logs remain under .scaler/cicd/logs/ by reference."];
  if (environment === "docker") return ["docker run uses --rm for container cleanup.", "Generated images should be removed manually if no longer needed."];
  if (environment === "compose") return ["docker compose down -v --remove-orphans runs through a trap after validation."];
  if (environment === "devcontainer") return ["devcontainer CLI manages container lifecycle; remove the generated container/image manually if needed."];
  return ["Minikube namespace scaler-local-ci is deleted through a cleanup trap after validation."];
}

function wrapperCommandPrefix(environment: CicdEnvironmentKind): string {
  switch (environment) {
    case "docker":
      return "bash .scaler/cicd/run-docker.sh";
    case "compose":
      return "bash .scaler/cicd/run-compose.sh";
    case "devcontainer":
      return "bash .scaler/cicd/run-devcontainer.sh";
    case "minikube":
      return "bash .scaler/cicd/run-minikube.sh";
    default:
      return "bash .scaler/cicd/run-local-ci.sh";
  }
}

function baseImageForStack(stack: string): string {
  switch (stack.toLowerCase()) {
    case "node":
      return "FROM node:22-bookworm-slim";
    case "python":
      return "FROM python:3.12-slim";
    case "rust":
      return "FROM rust:1-bookworm";
    case "go":
      return "FROM golang:1.23-bookworm";
    case "java":
      return "FROM eclipse-temurin:21-jdk";
    default:
      return "FROM debian:bookworm-slim\nRUN apt-get update && apt-get install -y --no-install-recommends bash ca-certificates && rm -rf /var/lib/apt/lists/*";
  }
}

async function detectNodePackageManager(cwd: string): Promise<string> {
  if (await fileExists(cwd, "pnpm-lock.yaml")) return "pnpm";
  if (await fileExists(cwd, "yarn.lock")) return "yarn";
  if (await fileExists(cwd, "package-lock.json")) return "npm";
  return "npm";
}

async function existingFiles(cwd: string, paths: string[]): Promise<string[]> {
  const found: string[] = [];
  for (const path of paths) {
    if (await fileExists(cwd, path)) found.push(path);
  }
  return found;
}

async function fileExists(cwd: string, path: string): Promise<boolean> {
  try {
    await access(join(cwd, path), constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function normalizeStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const list = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
  return list.length > 0 ? Array.from(new Set(list)) : undefined;
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function createCicdRecordId(now: Date, environment: CicdEnvironmentKind, taskId?: string, commandId?: string): string {
  const scope = [taskId, commandId, environment].map((part) => normalizeIdPart(part)).filter(Boolean).join("-") || environment;
  return `cicd-${scope}-${now.getTime()}`;
}

function normalizeIdPart(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/[^a-z0-9_-]+/gi, "-").replace(/^-|-$/g, "");
  return normalized || undefined;
}

function normalizeCicdRecord(value: unknown): CicdEnvironmentProvisionRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Partial<CicdEnvironmentProvisionRecord>;
  const environment = normalizeCicdEnvironmentKind(record.environment);
  if (!record.id || !environment || !record.createdAt || !record.updatedAt) return undefined;
  return {
    version: 1,
    id: String(record.id),
    environment,
    taskId: normalizeOptionalString(record.taskId),
    commandId: normalizeOptionalString(record.commandId),
    status: record.status === "generated" || record.status === "blocked" || record.status === "planned" ? record.status : "planned",
    stack: normalizeOptionalString(record.stack) ?? "generic",
    packageManager: normalizeOptionalString(record.packageManager),
    validationCommands: normalizeStringList(record.validationCommands) ?? [],
    services: normalizeStringList(record.services),
    acceptanceApproach: normalizeOptionalString(record.acceptanceApproach),
    generatedFiles: Array.isArray(record.generatedFiles) ? record.generatedFiles.filter(isGeneratedFile) : [],
    wrapperCommand: normalizeOptionalString(record.wrapperCommand) ?? `${wrapperCommandPrefix(environment)} -- <validation-command>`,
    safetyChecks: Array.isArray(record.safetyChecks) ? record.safetyChecks.filter(isSafetyCheck) : [],
    scannerRecordIds: normalizeStringList(record.scannerRecordIds),
    scannerSummary: typeof record.scannerSummary === "object" && record.scannerSummary !== null ? record.scannerSummary : undefined,
    artifactRefs: normalizeStringList(record.artifactRefs) ?? [],
    cleanupPlan: normalizeStringList(record.cleanupPlan) ?? [],
    limitations: normalizeStringList(record.limitations) ?? [],
    createdAt: String(record.createdAt),
    updatedAt: String(record.updatedAt),
  };
}

function isGeneratedFile(value: unknown): value is CicdGeneratedFile {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && typeof (value as CicdGeneratedFile).path === "string" && typeof (value as CicdGeneratedFile).purpose === "string");
}

function isSafetyCheck(value: unknown): value is CicdSafetyCheck {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const status = (value as CicdSafetyCheck).status;
  return typeof (value as CicdSafetyCheck).code === "string" && (status === "passed" || status === "warning" || status === "blocked");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

import { createReadStream, createWriteStream } from "node:fs";
import { lstat, mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { SCALER_DIR, getScalerDir, getStorageIndexPath, getStorageMaintenancePath } from "./paths.js";

export interface StorageFileInventoryEntry {
  path: string;
  sizeBytes: number;
  modifiedAt?: string;
}

export interface StorageTopLevelSummary {
  name: string;
  path: string;
  sizeBytes: number;
  fileCount: number;
  directoryCount: number;
}

export interface StorageInventoryIndex {
  version: 1;
  generatedAt: string;
  rootPath: string;
  totalBytes: number;
  fileCount: number;
  directoryCount: number;
  topLevel: StorageTopLevelSummary[];
  largestFiles: StorageFileInventoryEntry[];
}

export interface StorageInventoryOptions {
  largestFileLimit?: number;
  now?: Date;
}

export type StorageMaintenanceActionType = "compress" | "delete_cache";
export type StorageMaintenanceActionStatus = "planned" | "completed" | "failed" | "skipped";

export interface StorageMaintenanceAction {
  id: string;
  type: StorageMaintenanceActionType;
  path: string;
  targetPath?: string;
  sizeBytes: number;
  reason: string;
  status: StorageMaintenanceActionStatus;
  message?: string;
}

export interface StorageMaintenancePolicy {
  compress: boolean;
  deleteCache: boolean;
  minAgeDays: number;
  minSizeBytes: number;
}

export interface StorageMaintenanceReport {
  version: 1;
  generatedAt: string;
  executed: boolean;
  policy: StorageMaintenancePolicy;
  actions: StorageMaintenanceAction[];
  summary: {
    planned: number;
    completed: number;
    failed: number;
    skipped: number;
    bytesEligible: number;
    bytesCompleted: number;
  };
}

export interface StorageMaintenanceOptions {
  execute?: boolean;
  compress?: boolean;
  deleteCache?: boolean;
  minAgeDays?: number;
  minSizeBytes?: number;
  now?: Date;
}

interface MutableTopLevelSummary extends StorageTopLevelSummary {}

export async function scanScalerStorageInventory(
  cwd: string,
  options: StorageInventoryOptions = {},
): Promise<StorageInventoryIndex> {
  const scalerDir = getScalerDir(cwd);
  const largestFileLimit = Math.max(0, options.largestFileLimit ?? 10);
  const generatedAt = (options.now ?? new Date()).toISOString();
  const topLevel = new Map<string, MutableTopLevelSummary>();
  const largestFiles: StorageFileInventoryEntry[] = [];
  let totalBytes = 0;
  let fileCount = 0;
  let directoryCount = 0;

  async function visit(absolutePath: string): Promise<void> {
    let info;
    try {
      info = await lstat(absolutePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }

    const rel = normalizeRelativeStoragePath(cwd, absolutePath);
    const top = getTopLevelSummary(topLevel, rel, info.isDirectory());

    if (info.isDirectory()) {
      if (rel !== SCALER_DIR) {
        directoryCount += 1;
        if (top) top.directoryCount += 1;
      }
      const entries = await readdir(absolutePath);
      await Promise.all(entries.map((entry) => visit(join(absolutePath, entry))));
      return;
    }

    if (!info.isFile() && !info.isSymbolicLink()) return;

    const sizeBytes = info.size;
    totalBytes += sizeBytes;
    fileCount += 1;
    if (top) {
      top.sizeBytes += sizeBytes;
      top.fileCount += 1;
    }
    if (largestFileLimit > 0) {
      largestFiles.push({ path: rel, sizeBytes, modifiedAt: info.mtime.toISOString() });
      largestFiles.sort((a, b) => b.sizeBytes - a.sizeBytes || a.path.localeCompare(b.path));
      largestFiles.splice(largestFileLimit);
    }
  }

  await visit(scalerDir);

  return {
    version: 1,
    generatedAt,
    rootPath: SCALER_DIR,
    totalBytes,
    fileCount,
    directoryCount,
    topLevel: Array.from(topLevel.values()).sort((a, b) => b.sizeBytes - a.sizeBytes || a.name.localeCompare(b.name)),
    largestFiles,
  };
}

export async function saveStorageInventory(cwd: string, inventory: StorageInventoryIndex): Promise<StorageInventoryIndex> {
  const path = getStorageIndexPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(inventory, null, 2)}\n`, "utf8");
  return inventory;
}

export async function loadStorageInventory(cwd: string): Promise<StorageInventoryIndex | undefined> {
  try {
    return JSON.parse(await readFile(getStorageIndexPath(cwd), "utf8")) as StorageInventoryIndex;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export function formatStorageInventory(inventory: StorageInventoryIndex): string {
  const lines = [
    `Storage: totalBytes=${inventory.totalBytes} files=${inventory.fileCount} dirs=${inventory.directoryCount} generatedAt=${inventory.generatedAt}`,
    "Top-level:",
    ...inventory.topLevel.map((entry) => `- ${entry.path}: bytes=${entry.sizeBytes} files=${entry.fileCount} dirs=${entry.directoryCount}`),
    "Largest files:",
    ...inventory.largestFiles.map((entry) => `- ${entry.path}: bytes=${entry.sizeBytes}`),
  ];
  return lines.join("\n");
}

export async function planStorageMaintenance(cwd: string, options: StorageMaintenanceOptions = {}): Promise<StorageMaintenanceReport> {
  const policy = normalizeMaintenancePolicy(options);
  const generatedAt = (options.now ?? new Date()).toISOString();
  const actions: StorageMaintenanceAction[] = [];
  const cutoffMs = Date.parse(generatedAt) - policy.minAgeDays * 24 * 60 * 60 * 1000;

  async function visit(absolutePath: string): Promise<void> {
    let info;
    try {
      info = await lstat(absolutePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    if (info.isDirectory()) {
      const entries = await readdir(absolutePath);
      await Promise.all(entries.map((entry) => visit(join(absolutePath, entry))));
      return;
    }
    if (!info.isFile()) return;

    const rel = normalizeRelativeStoragePath(cwd, absolutePath);
    if (!isManagedStoragePath(rel) || isStorageMaintenanceArtifact(rel) || rel.endsWith(".gz")) return;
    const oldEnough = info.mtime.getTime() <= cutoffMs;
    const largeEnough = info.size >= policy.minSizeBytes;
    if (!oldEnough && !largeEnough) return;
    const reason = `${oldEnough ? `age>=${policy.minAgeDays}d` : ""}${oldEnough && largeEnough ? "," : ""}${largeEnough ? `size>=${policy.minSizeBytes}` : ""}`;

    if (policy.deleteCache && rel.startsWith(`${SCALER_DIR}/cache/`)) {
      actions.push({
        id: `delete-cache-${actions.length + 1}`,
        type: "delete_cache",
        path: rel,
        sizeBytes: info.size,
        reason,
        status: "planned",
      });
      return;
    }

    if (policy.compress && isCompressibleStoragePath(rel)) {
      actions.push({
        id: `compress-${actions.length + 1}`,
        type: "compress",
        path: rel,
        targetPath: `${rel}.gz`,
        sizeBytes: info.size,
        reason,
        status: "planned",
      });
    }
  }

  await visit(getScalerDir(cwd));
  actions.sort((left, right) => left.type.localeCompare(right.type) || right.sizeBytes - left.sizeBytes || left.path.localeCompare(right.path));
  return buildMaintenanceReport(generatedAt, false, policy, actions);
}

export async function runStorageMaintenance(cwd: string, options: StorageMaintenanceOptions = {}): Promise<StorageMaintenanceReport> {
  const planned = await planStorageMaintenance(cwd, options);
  if (!options.execute) {
    await saveStorageMaintenanceReport(cwd, planned);
    return planned;
  }

  const executedActions: StorageMaintenanceAction[] = [];
  for (const action of planned.actions) {
    try {
      if (action.type === "compress") {
        await compressStorageFile(cwd, action);
        executedActions.push({ ...action, status: "completed", message: `Compressed to ${action.targetPath}` });
      } else if (action.type === "delete_cache") {
        await deleteStorageCacheFile(cwd, action);
        executedActions.push({ ...action, status: "completed", message: "Deleted cache file" });
      } else {
        executedActions.push({ ...action, status: "skipped", message: "Unknown action type" });
      }
    } catch (error) {
      executedActions.push({ ...action, status: "failed", message: error instanceof Error ? error.message : String(error) });
    }
  }

  const report = buildMaintenanceReport(planned.generatedAt, true, planned.policy, executedActions);
  await saveStorageMaintenanceReport(cwd, report);
  await saveStorageInventory(cwd, await scanScalerStorageInventory(cwd, { now: options.now }));
  return report;
}

export async function saveStorageMaintenanceReport(cwd: string, report: StorageMaintenanceReport): Promise<StorageMaintenanceReport> {
  const path = getStorageMaintenancePath(cwd);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

export async function loadStorageMaintenanceReport(cwd: string): Promise<StorageMaintenanceReport | undefined> {
  try {
    return JSON.parse(await readFile(getStorageMaintenancePath(cwd), "utf8")) as StorageMaintenanceReport;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export function formatStorageMaintenanceReport(report: StorageMaintenanceReport): string {
  const lines = [
    `Storage maintenance: executed=${report.executed} planned=${report.summary.planned} completed=${report.summary.completed} failed=${report.summary.failed} skipped=${report.summary.skipped} bytesEligible=${report.summary.bytesEligible} bytesCompleted=${report.summary.bytesCompleted}`,
    `Policy: compress=${report.policy.compress} deleteCache=${report.policy.deleteCache} minAgeDays=${report.policy.minAgeDays} minSizeBytes=${report.policy.minSizeBytes}`,
    ...report.actions.map((action) => `- ${action.status} ${action.type} ${action.path}${action.targetPath ? ` -> ${action.targetPath}` : ""} bytes=${action.sizeBytes} reason=${action.reason}${action.message ? ` message=${action.message}` : ""}`),
  ];
  return lines.join("\n");
}

function normalizeMaintenancePolicy(options: StorageMaintenanceOptions): StorageMaintenancePolicy {
  const minAgeDays = Number.isFinite(options.minAgeDays) && options.minAgeDays !== undefined ? Math.max(0, options.minAgeDays) : 7;
  const minSizeBytes = Number.isFinite(options.minSizeBytes) && options.minSizeBytes !== undefined ? Math.max(1, options.minSizeBytes) : 1024 * 1024;
  return {
    compress: options.compress ?? true,
    deleteCache: options.deleteCache ?? false,
    minAgeDays,
    minSizeBytes,
  };
}

function buildMaintenanceReport(generatedAt: string, executed: boolean, policy: StorageMaintenancePolicy, actions: StorageMaintenanceAction[]): StorageMaintenanceReport {
  return {
    version: 1,
    generatedAt,
    executed,
    policy,
    actions,
    summary: {
      planned: actions.length,
      completed: actions.filter((action) => action.status === "completed").length,
      failed: actions.filter((action) => action.status === "failed").length,
      skipped: actions.filter((action) => action.status === "skipped").length,
      bytesEligible: actions.reduce((total, action) => total + action.sizeBytes, 0),
      bytesCompleted: actions.filter((action) => action.status === "completed").reduce((total, action) => total + action.sizeBytes, 0),
    },
  };
}

async function compressStorageFile(cwd: string, action: StorageMaintenanceAction): Promise<void> {
  if (action.type !== "compress" || !action.targetPath) throw new Error("Invalid compression action.");
  if (!isCompressibleStoragePath(action.path) || !isManagedStoragePath(action.targetPath)) throw new Error("Compression action is outside allowed storage roots.");
  const source = join(cwd, action.path);
  const target = join(cwd, action.targetPath);
  await mkdir(dirname(target), { recursive: true });
  await pipeline(createReadStream(source), createGzip(), createWriteStream(target));
  const compressed = await lstat(target);
  if (!compressed.isFile() || compressed.size <= 0) throw new Error("Compressed output was not written.");
  await unlink(source);
}

async function deleteStorageCacheFile(cwd: string, action: StorageMaintenanceAction): Promise<void> {
  if (action.type !== "delete_cache" || !action.path.startsWith(`${SCALER_DIR}/cache/`)) throw new Error("Cache delete action is outside .scaler/cache.");
  await unlink(join(cwd, action.path));
}

function isManagedStoragePath(rel: string): boolean {
  return rel === SCALER_DIR || rel.startsWith(`${SCALER_DIR}/`);
}

function isStorageMaintenanceArtifact(rel: string): boolean {
  return rel === `${SCALER_DIR}/storage/maintenance.json`;
}

function isCompressibleStoragePath(rel: string): boolean {
  return rel.startsWith(`${SCALER_DIR}/logs/details/`) || rel.startsWith(`${SCALER_DIR}/reports/`) || rel.startsWith(`${SCALER_DIR}/memory/`);
}

function getTopLevelSummary(topLevel: Map<string, MutableTopLevelSummary>, rel: string, isDirectory: boolean): MutableTopLevelSummary | undefined {
  if (rel === SCALER_DIR) return undefined;
  const parts = rel.split("/").filter(Boolean);
  const name = parts.length === 2 && !isDirectory ? "root" : parts[1] ?? "root";
  const path = name === "root" ? `${SCALER_DIR}/root` : `${SCALER_DIR}/${name}`;
  const existing = topLevel.get(name);
  if (existing) return existing;
  const created: MutableTopLevelSummary = { name, path, sizeBytes: 0, fileCount: 0, directoryCount: 0 };
  topLevel.set(name, created);
  return created;
}

function normalizeRelativeStoragePath(cwd: string, absolutePath: string): string {
  const rel = relative(cwd, absolutePath).split(sep).join("/");
  return rel || SCALER_DIR;
}

import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, lstat, mkdir, readFile, readdir, statfs, unlink, writeFile } from "node:fs/promises";
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

export type StorageMaintenanceActionType = "compress" | "delete_cache" | "rotate_active" | "check_free_disk" | "delete_archive";
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
  rotateActive: boolean;
  maxActiveBytes: number;
  minFreeBytes?: number;
  deleteArchives: boolean;
  maxArchiveBytes?: number;
  maxArchiveAgeDays?: number;
}

export interface StorageDiskCheck {
  path: string;
  checkedAt: string;
  minFreeBytes: number;
  freeBytes?: number;
  totalBytes?: number;
  status: "ok" | "below_minimum" | "unavailable";
  message?: string;
}

export interface StorageMaintenanceReport {
  version: 1;
  generatedAt: string;
  executed: boolean;
  policy: StorageMaintenancePolicy;
  disk?: StorageDiskCheck;
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
  rotateActive?: boolean;
  maxActiveBytes?: number;
  minFreeBytes?: number;
  deleteArchives?: boolean;
  maxArchiveBytes?: number;
  maxArchiveAgeDays?: number;
  now?: Date;
}

interface MutableTopLevelSummary extends StorageTopLevelSummary {}

const DEFAULT_MAX_ACTIVE_BYTES = 10 * 1024 * 1024;
const activeReportLedgerNames = new Set([
  "validation-runs.json",
  "validation-checklists.json",
  "validation-handoffs.json",
  "task-agent-runs.json",
  "stage-agent-runs.json",
  "replan-agent-runs.json",
  "research-agent-runs.json",
  "debug-agent-runs.json",
]);

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
    if (!isManagedStoragePath(rel) || isStorageMaintenanceArtifact(rel) || isStorageArchivePath(rel) || rel.endsWith(".gz")) return;

    if (isActiveRotatableStoragePath(rel)) {
      if (policy.rotateActive && info.size >= policy.maxActiveBytes) {
        actions.push({
          id: `rotate-active-${actions.length + 1}`,
          type: "rotate_active",
          path: rel,
          targetPath: buildActiveRotationTargetPath(rel, generatedAt),
          sizeBytes: info.size,
          reason: `size>=${policy.maxActiveBytes}`,
          status: "planned",
        });
      }
      return;
    }

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
  actions.push(...(await planArchiveRetentionActions(cwd, policy, generatedAt, actions.length)));
  const disk = policy.minFreeBytes === undefined ? undefined : await checkStorageDisk(cwd, policy.minFreeBytes, generatedAt);
  if (disk) actions.push(createDiskCheckAction(disk, false));
  actions.sort(compareMaintenanceActions);
  return buildMaintenanceReport(generatedAt, false, policy, actions, disk);
}

export async function runStorageMaintenance(cwd: string, options: StorageMaintenanceOptions = {}): Promise<StorageMaintenanceReport> {
  const planned = await planStorageMaintenance(cwd, options);
  if (!options.execute) {
    await saveStorageMaintenanceReport(cwd, planned);
    return planned;
  }

  const executedActions: StorageMaintenanceAction[] = [];
  const diskCheckActions = planned.actions.filter((action) => action.type === "check_free_disk");
  for (const action of planned.actions.filter((candidate) => candidate.type !== "check_free_disk")) {
    try {
      if (action.type === "compress") {
        await compressStorageFile(cwd, action);
        executedActions.push({ ...action, status: "completed", message: `Compressed to ${action.targetPath}` });
      } else if (action.type === "delete_cache") {
        await deleteStorageCacheFile(cwd, action);
        executedActions.push({ ...action, status: "completed", message: "Deleted cache file" });
      } else if (action.type === "rotate_active") {
        await rotateActiveStorageFile(cwd, action);
        executedActions.push({ ...action, status: "completed", message: `Rotated to ${action.targetPath}` });
      } else if (action.type === "delete_archive") {
        await deleteStorageArchiveFile(cwd, action);
        executedActions.push({ ...action, status: "completed", message: "Deleted archive file" });
      } else {
        executedActions.push({ ...action, status: "skipped", message: "Unknown action type" });
      }
    } catch (error) {
      executedActions.push({ ...action, status: "failed", message: error instanceof Error ? error.message : String(error) });
    }
  }

  const disk = planned.policy.minFreeBytes === undefined ? undefined : await checkStorageDisk(cwd, planned.policy.minFreeBytes, planned.generatedAt);
  executedActions.push(...diskCheckActions.map(() => disk ? createDiskCheckAction(disk, true) : undefined).filter((action): action is StorageMaintenanceAction => Boolean(action)));
  executedActions.sort(compareMaintenanceActions);

  const report = buildMaintenanceReport(planned.generatedAt, true, planned.policy, executedActions, disk);
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
    `Policy: compress=${report.policy.compress} deleteCache=${report.policy.deleteCache} minAgeDays=${report.policy.minAgeDays} minSizeBytes=${report.policy.minSizeBytes} rotateActive=${report.policy.rotateActive} maxActiveBytes=${report.policy.maxActiveBytes}${report.policy.minFreeBytes === undefined ? "" : ` minFreeBytes=${report.policy.minFreeBytes}`} deleteArchives=${report.policy.deleteArchives}${report.policy.maxArchiveBytes === undefined ? "" : ` maxArchiveBytes=${report.policy.maxArchiveBytes}`}${report.policy.maxArchiveAgeDays === undefined ? "" : ` maxArchiveAgeDays=${report.policy.maxArchiveAgeDays}`}`,
    ...(report.disk ? [`Disk: status=${report.disk.status} freeBytes=${report.disk.freeBytes ?? "unknown"} minFreeBytes=${report.disk.minFreeBytes}${report.disk.message ? ` message=${report.disk.message}` : ""}`] : []),
    ...report.actions.map((action) => `- ${action.status} ${action.type} ${action.path}${action.targetPath ? ` -> ${action.targetPath}` : ""} bytes=${action.sizeBytes} reason=${action.reason}${action.message ? ` message=${action.message}` : ""}`),
  ];
  return lines.join("\n");
}

function normalizeMaintenancePolicy(options: StorageMaintenanceOptions): StorageMaintenancePolicy {
  const minAgeDays = Number.isFinite(options.minAgeDays) && options.minAgeDays !== undefined ? Math.max(0, options.minAgeDays) : 7;
  const minSizeBytes = Number.isFinite(options.minSizeBytes) && options.minSizeBytes !== undefined ? Math.max(1, options.minSizeBytes) : 1024 * 1024;
  const maxActiveBytes = Number.isFinite(options.maxActiveBytes) && options.maxActiveBytes !== undefined ? Math.max(1, options.maxActiveBytes) : DEFAULT_MAX_ACTIVE_BYTES;
  const minFreeBytes = Number.isFinite(options.minFreeBytes) && options.minFreeBytes !== undefined ? Math.max(0, options.minFreeBytes) : undefined;
  const maxArchiveBytes = Number.isFinite(options.maxArchiveBytes) && options.maxArchiveBytes !== undefined ? Math.max(0, options.maxArchiveBytes) : undefined;
  const maxArchiveAgeDays = Number.isFinite(options.maxArchiveAgeDays) && options.maxArchiveAgeDays !== undefined ? Math.max(0, options.maxArchiveAgeDays) : undefined;
  return {
    compress: options.compress ?? true,
    deleteCache: options.deleteCache ?? false,
    minAgeDays,
    minSizeBytes,
    rotateActive: options.rotateActive ?? false,
    maxActiveBytes,
    minFreeBytes,
    deleteArchives: options.deleteArchives ?? false,
    maxArchiveBytes,
    maxArchiveAgeDays,
  };
}

function buildMaintenanceReport(
  generatedAt: string,
  executed: boolean,
  policy: StorageMaintenancePolicy,
  actions: StorageMaintenanceAction[],
  disk?: StorageDiskCheck,
): StorageMaintenanceReport {
  return {
    version: 1,
    generatedAt,
    executed,
    policy,
    disk,
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

async function deleteStorageArchiveFile(cwd: string, action: StorageMaintenanceAction): Promise<void> {
  if (action.type !== "delete_archive" || !isStorageArchivePath(action.path)) throw new Error("Archive delete action is outside .scaler/storage/archive.");
  await unlink(join(cwd, action.path));
}

interface StorageArchiveFileCandidate {
  path: string;
  sizeBytes: number;
  modifiedAtMs: number;
}

async function planArchiveRetentionActions(
  cwd: string,
  policy: StorageMaintenancePolicy,
  generatedAt: string,
  startingIndex: number,
): Promise<StorageMaintenanceAction[]> {
  if (!policy.deleteArchives || (policy.maxArchiveBytes === undefined && policy.maxArchiveAgeDays === undefined)) return [];
  const files = await collectStorageArchiveFiles(cwd);
  const selected = new Map<string, { file: StorageArchiveFileCandidate; reasons: string[] }>();
  const addSelected = (file: StorageArchiveFileCandidate, reason: string): void => {
    const existing = selected.get(file.path);
    if (existing) existing.reasons.push(reason);
    else selected.set(file.path, { file, reasons: [reason] });
  };

  if (policy.maxArchiveAgeDays !== undefined) {
    const cutoffMs = Date.parse(generatedAt) - policy.maxArchiveAgeDays * 24 * 60 * 60 * 1000;
    for (const file of files) {
      if (file.modifiedAtMs <= cutoffMs) addSelected(file, `archiveAge>=${policy.maxArchiveAgeDays}d`);
    }
  }

  if (policy.maxArchiveBytes !== undefined) {
    const totalBytes = files.reduce((total, file) => total + file.sizeBytes, 0);
    let selectedBytes = Array.from(selected.values()).reduce((total, entry) => total + entry.file.sizeBytes, 0);
    for (const file of [...files].sort((left, right) => left.modifiedAtMs - right.modifiedAtMs || left.path.localeCompare(right.path))) {
      if (totalBytes - selectedBytes <= policy.maxArchiveBytes) break;
      if (selected.has(file.path)) continue;
      addSelected(file, `archiveBytes>${policy.maxArchiveBytes}`);
      selectedBytes += file.sizeBytes;
    }
  }

  return Array.from(selected.values())
    .sort((left, right) => left.file.modifiedAtMs - right.file.modifiedAtMs || left.file.path.localeCompare(right.file.path))
    .map((entry, index) => ({
      id: `delete-archive-${startingIndex + index + 1}`,
      type: "delete_archive",
      path: entry.file.path,
      sizeBytes: entry.file.sizeBytes,
      reason: Array.from(new Set(entry.reasons)).join(","),
      status: "planned",
    }));
}

async function collectStorageArchiveFiles(cwd: string): Promise<StorageArchiveFileCandidate[]> {
  const root = join(cwd, SCALER_DIR, "storage", "archive");
  const files: StorageArchiveFileCandidate[] = [];
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
    files.push({ path: normalizeRelativeStoragePath(cwd, absolutePath), sizeBytes: info.size, modifiedAtMs: info.mtime.getTime() });
  }
  await visit(root);
  return files.filter((file) => isStorageArchivePath(file.path));
}

async function rotateActiveStorageFile(cwd: string, action: StorageMaintenanceAction): Promise<void> {
  if (action.type !== "rotate_active" || !action.targetPath) throw new Error("Invalid active rotation action.");
  if (!isActiveRotatableStoragePath(action.path) || !isStorageArchivePath(action.targetPath)) throw new Error("Active rotation action is outside allowed storage roots.");
  const source = join(cwd, action.path);
  const target = join(cwd, action.targetPath);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(source, target);
  const archived = await lstat(target);
  if (!archived.isFile() || archived.size !== action.sizeBytes) throw new Error("Rotated archive was not written completely.");
  await writeFile(source, getActiveLedgerResetContent(action.path), "utf8");
}

async function checkStorageDisk(cwd: string, minFreeBytes: number, checkedAt: string): Promise<StorageDiskCheck> {
  try {
    const stats = await statfs(cwd);
    const freeBytes = Number(stats.bavail) * Number(stats.bsize);
    const totalBytes = Number(stats.blocks) * Number(stats.bsize);
    return {
      path: SCALER_DIR,
      checkedAt,
      minFreeBytes,
      freeBytes,
      totalBytes,
      status: freeBytes >= minFreeBytes ? "ok" : "below_minimum",
    };
  } catch (error) {
    return {
      path: SCALER_DIR,
      checkedAt,
      minFreeBytes,
      status: "unavailable",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function createDiskCheckAction(disk: StorageDiskCheck, executed: boolean): StorageMaintenanceAction {
  const ok = disk.status === "ok";
  return {
    id: "check-free-disk",
    type: "check_free_disk",
    path: disk.path,
    sizeBytes: 0,
    reason: `freeBytes=${disk.freeBytes ?? "unknown"} minFreeBytes=${disk.minFreeBytes}`,
    status: ok ? (executed ? "completed" : "planned") : "failed",
    message: ok ? "Free disk check passed" : disk.message ?? `Free disk below minimum: ${disk.freeBytes ?? "unknown"}/${disk.minFreeBytes}`,
  };
}

function compareMaintenanceActions(left: StorageMaintenanceAction, right: StorageMaintenanceAction): number {
  const order: Record<StorageMaintenanceActionType, number> = { rotate_active: 0, compress: 1, delete_cache: 2, delete_archive: 3, check_free_disk: 4 };
  return order[left.type] - order[right.type] || right.sizeBytes - left.sizeBytes || left.path.localeCompare(right.path);
}

function isManagedStoragePath(rel: string): boolean {
  return rel === SCALER_DIR || rel.startsWith(`${SCALER_DIR}/`);
}

function isStorageMaintenanceArtifact(rel: string): boolean {
  return rel === `${SCALER_DIR}/storage/maintenance.json`;
}

function isStorageArchivePath(rel: string): boolean {
  return rel.startsWith(`${SCALER_DIR}/storage/archive/`);
}

function isActiveRotatableStoragePath(rel: string): boolean {
  return rel === `${SCALER_DIR}/logs/events.jsonl` || isActiveReportLedgerPath(rel);
}

function isActiveReportLedgerPath(rel: string): boolean {
  if (!rel.startsWith(`${SCALER_DIR}/reports/`)) return false;
  const parts = rel.split("/");
  return parts.length === 3 && activeReportLedgerNames.has(parts[2] ?? "");
}

function buildActiveRotationTargetPath(rel: string, generatedAt: string): string {
  const parts = rel.split("/");
  const fileName = parts[parts.length - 1] ?? "ledger";
  const dotIndex = fileName.lastIndexOf(".");
  const stem = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
  const extension = dotIndex > 0 ? fileName.slice(dotIndex) : "";
  const category = rel === `${SCALER_DIR}/logs/events.jsonl` ? "logs" : "reports";
  return `${SCALER_DIR}/storage/archive/${category}/${stem}-${formatArchiveTimestamp(generatedAt)}${extension}`;
}

function formatArchiveTimestamp(value: string): string {
  return value.replace(/\D/g, "") || String(Date.now());
}

function getActiveLedgerResetContent(rel: string): string {
  return rel.endsWith(".jsonl") ? "" : "[]\n";
}

function isCompressibleStoragePath(rel: string): boolean {
  if (isActiveRotatableStoragePath(rel)) return false;
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

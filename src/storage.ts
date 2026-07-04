import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { SCALER_DIR, getScalerDir, getStorageIndexPath } from "./paths.js";

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

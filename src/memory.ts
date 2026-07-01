import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";
import { randomUUID } from "node:crypto";
import { getMemoryDir, getMemoryIndexPath } from "./paths.js";

export type MemoryValidity = "active" | "stale" | "obsolete" | "unknown";

export interface MemoryEntry {
  id: string;
  title: string;
  source: string;
  taskId?: string;
  validity: MemoryValidity;
  summary: string;
  path: string;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryIndex {
  version: 1;
  entries: MemoryEntry[];
}

export interface WriteMemoryInput {
  title: string;
  content: string;
  taskId?: string;
  source?: string;
  summary?: string;
  validity?: MemoryValidity;
  now?: Date;
}

export interface RetrievedMemory {
  entry: MemoryEntry;
  content: string;
}

export async function loadMemoryIndex(cwd: string): Promise<MemoryIndex> {
  try {
    const raw = await readFile(getMemoryIndexPath(cwd), "utf8");
    return JSON.parse(raw) as MemoryIndex;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: 1, entries: [] };
    }
    throw error;
  }
}

export async function saveMemoryIndex(cwd: string, index: MemoryIndex): Promise<void> {
  const indexPath = getMemoryIndexPath(cwd);
  await mkdir(getMemoryDir(cwd), { recursive: true });
  await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
}

export async function writeMemory(cwd: string, input: WriteMemoryInput): Promise<MemoryEntry> {
  const timestamp = (input.now ?? new Date()).toISOString();
  const id = createMemoryId(input.title);
  const relativePath = `.scaler/memory/${id}.md`;
  const absolutePath = join(cwd, relativePath);
  const entry: MemoryEntry = {
    id,
    title: input.title,
    source: input.source ?? "scaler",
    taskId: input.taskId,
    validity: input.validity ?? "active",
    summary: input.summary ?? summarize(input.content),
    path: relativePath,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  await mkdir(getMemoryDir(cwd), { recursive: true });
  await writeFile(absolutePath, formatMemoryFile(entry, input.content), "utf8");

  const index = await loadMemoryIndex(cwd);
  await saveMemoryIndex(cwd, { ...index, entries: [...index.entries, entry] });
  return entry;
}

export async function retrieveMemory(cwd: string, idOrPath: string): Promise<RetrievedMemory> {
  const index = await loadMemoryIndex(cwd);
  const entry = index.entries.find((candidate) => candidate.id === idOrPath || candidate.path === idOrPath || basename(candidate.path) === idOrPath);

  if (!entry) {
    throw new Error(`Memory not found: ${idOrPath}`);
  }

  const path = isAbsolute(entry.path) ? entry.path : join(cwd, entry.path);
  const content = await readFile(path, "utf8");
  return { entry, content };
}

function createMemoryId(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "memory";
  return `${slug}-${randomUUID().slice(0, 8)}`;
}

function summarize(content: string): string {
  const singleLine = content.replace(/\s+/g, " ").trim();
  return singleLine.length > 200 ? `${singleLine.slice(0, 197)}...` : singleLine;
}

function formatMemoryFile(entry: MemoryEntry, content: string): string {
  return `---\nid: ${entry.id}\ntitle: ${entry.title}\nsource: ${entry.source}\nvalidity: ${entry.validity}\ncreatedAt: ${entry.createdAt}\nupdatedAt: ${entry.updatedAt}\n---\n\n${content}\n`;
}

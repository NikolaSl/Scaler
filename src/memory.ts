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
  tags?: string[];
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
  tags?: string[];
  summary?: string;
  validity?: MemoryValidity;
  now?: Date;
}

export interface RetrievedMemory {
  entry: MemoryEntry;
  content: string;
}

export interface MemorySearchInput {
  query?: string;
  tags?: string[];
  taskId?: string;
  validity?: MemoryValidity | "any";
  includeObsolete?: boolean;
  limit?: number;
}

export interface MemorySearchResult {
  entry: MemoryEntry;
  score: number;
  matched: string[];
}

export interface MemoryRetrieveOptions {
  scope?: string;
}

export async function loadMemoryIndex(cwd: string): Promise<MemoryIndex> {
  try {
    const raw = await readFile(getMemoryIndexPath(cwd), "utf8");
    return normalizeMemoryIndex(JSON.parse(raw) as MemoryIndex);
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
  await writeFile(indexPath, `${JSON.stringify(normalizeMemoryIndex(index), null, 2)}\n`, "utf8");
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
    tags: normalizeTags(input.tags),
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

export async function retrieveMemory(cwd: string, idOrPath: string, options: MemoryRetrieveOptions = {}): Promise<RetrievedMemory> {
  const index = await loadMemoryIndex(cwd);
  const entry = findMemoryEntry(index, idOrPath);

  if (!entry) {
    throw new Error(`Memory not found: ${idOrPath}`);
  }

  const path = isAbsolute(entry.path) ? entry.path : join(cwd, entry.path);
  const fullContent = await readFile(path, "utf8");
  return { entry, content: selectMemoryContent(entry, fullContent, options.scope) };
}

export async function searchMemory(cwd: string, input: MemorySearchInput = {}): Promise<MemorySearchResult[]> {
  const index = await loadMemoryIndex(cwd);
  return searchMemoryEntries(index.entries, input);
}

export function searchMemoryEntries(entries: MemoryEntry[], input: MemorySearchInput = {}): MemorySearchResult[] {
  const queryTerms = tokenize(input.query ?? "");
  const tags = normalizeTags(input.tags);
  const taskId = input.taskId?.trim();
  const validity = input.validity && input.validity !== "any" ? input.validity : undefined;
  const hasFilter = queryTerms.length > 0 || tags.length > 0 || Boolean(taskId) || Boolean(validity);
  const limit = Math.max(1, Math.min(input.limit ?? 10, 50));

  return entries
    .map((entry) => scoreMemorySearchEntry(normalizeMemoryEntry(entry), { queryTerms, tags, taskId, validity, includeObsolete: input.includeObsolete }))
    .filter(({ entry, score }) => {
      if (!input.includeObsolete && entry.validity === "obsolete") return false;
      if (validity && entry.validity !== validity) return false;
      if (taskId && entry.taskId !== taskId) return false;
      if (tags.length > 0 && !tags.every((tag) => (entry.tags ?? []).includes(tag))) return false;
      return hasFilter ? score > 0 : true;
    })
    .sort((a, b) => b.score - a.score || b.entry.updatedAt.localeCompare(a.entry.updatedAt) || a.entry.id.localeCompare(b.entry.id))
    .slice(0, limit);
}

export function formatMemorySearchResults(results: MemorySearchResult[], input: MemorySearchInput = {}): string {
  if (results.length === 0) return "No memory candidates found.";
  const filterBits = [
    input.query ? `query=${input.query}` : undefined,
    input.tags && input.tags.length > 0 ? `tags=${normalizeTags(input.tags).join(",")}` : undefined,
    input.taskId ? `task=${input.taskId}` : undefined,
    input.validity ? `validity=${input.validity}` : undefined,
  ].filter(Boolean);
  const lines = [`Memory candidates${filterBits.length > 0 ? ` (${filterBits.join(" ")})` : ""}:`];
  for (const result of results) {
    lines.push(formatMemoryReference(result.entry, { score: result.score, matched: result.matched }));
  }
  return lines.join("\n");
}

export function formatMemoryReference(entry: MemoryEntry, details: { score?: number; matched?: string[] } = {}): string {
  const normalized = normalizeMemoryEntry(entry);
  const tags = normalized.tags && normalized.tags.length > 0 ? ` tags=${normalized.tags.join(",")}` : "";
  const task = normalized.taskId ? ` task=${normalized.taskId}` : "";
  const score = details.score !== undefined ? ` score=${details.score}` : "";
  const matched = details.matched && details.matched.length > 0 ? ` matched=${details.matched.join(",")}` : "";
  return `- ${normalized.id}: ${normalized.title}${task}${tags} validity=${normalized.validity}${score}${matched}\n  path=${normalized.path}\n  summary=${normalized.summary}`;
}

export function selectMemoryContent(entry: MemoryEntry, fullContent: string, scope?: string): string {
  const normalizedScope = scope?.trim();
  if (!normalizedScope || /^full(?:-file)?$/i.test(normalizedScope)) return fullContent;
  if (/^(summary|reference|reference-only)$/i.test(normalizedScope)) return formatMemoryReference(entry);

  const sectionName = normalizedScope.replace(/^section:/i, "").trim();
  const section = extractMarkdownSection(fullContent, sectionName);
  if (section) return section;
  return `${formatMemoryReference(entry)}\n  requestedScope=${normalizedScope} (section not found; full memory not injected)`;
}

function normalizeMemoryIndex(index: MemoryIndex): MemoryIndex {
  return { version: 1, entries: (index.entries ?? []).map(normalizeMemoryEntry) };
}

function normalizeMemoryEntry(entry: MemoryEntry): MemoryEntry {
  return {
    ...entry,
    id: entry.id,
    title: entry.title ?? entry.id,
    source: entry.source ?? "unknown",
    tags: normalizeTags(entry.tags),
    validity: entry.validity ?? "unknown",
    summary: entry.summary ?? "",
    path: entry.path,
    createdAt: entry.createdAt ?? entry.updatedAt ?? "",
    updatedAt: entry.updatedAt ?? entry.createdAt ?? "",
  };
}

function findMemoryEntry(index: MemoryIndex, idOrPath: string): MemoryEntry | undefined {
  return index.entries.find((candidate) => candidate.id === idOrPath || candidate.path === idOrPath || basename(candidate.path) === idOrPath);
}

function scoreMemorySearchEntry(
  entry: MemoryEntry,
  input: { queryTerms: string[]; tags: string[]; taskId?: string; validity?: MemoryValidity; includeObsolete?: boolean },
): MemorySearchResult {
  const matched = new Set<string>();
  let score = 0;
  const haystack = [entry.id, entry.title, entry.summary, entry.source, entry.path, entry.taskId, ...(entry.tags ?? [])].filter(Boolean).join(" ").toLowerCase();

  for (const term of input.queryTerms) {
    if (haystack.includes(term)) {
      score += entry.title.toLowerCase().includes(term) ? 3 : 1;
      matched.add(`query:${term}`);
    }
  }
  for (const tag of input.tags) {
    if ((entry.tags ?? []).includes(tag)) {
      score += 4;
      matched.add(`tag:${tag}`);
    }
  }
  if (input.taskId && entry.taskId === input.taskId) {
    score += 4;
    matched.add(`task:${input.taskId}`);
  }
  if (input.validity && entry.validity === input.validity) {
    score += 1;
    matched.add(`validity:${input.validity}`);
  }
  if (entry.validity === "active") score += 1;
  if (entry.validity === "stale") score -= 1;
  if (entry.validity === "obsolete" && !input.includeObsolete) score -= 10;
  return { entry, score, matched: [...matched].sort((a, b) => a.localeCompare(b)) };
}

function tokenize(value: string): string[] {
  return unique(value.toLowerCase().split(/[^a-z0-9._/-]+/).map((term) => term.trim()).filter((term) => term.length >= 2));
}

function normalizeTags(tags: string[] | undefined): string[] {
  return unique((tags ?? []).flatMap((tag) => tag.split(/[;,]/)).map((tag) => tag.toLowerCase().trim()).filter((tag) => tag.length > 0)).sort((a, b) => a.localeCompare(b));
}

function extractMarkdownSection(content: string, requested: string): string | undefined {
  const needle = requested.toLowerCase();
  if (!needle) return undefined;
  const lines = content.split("\n");
  let start = -1;
  let headingLevel = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(lines[index] ?? "");
    if (!match) continue;
    if (match[2]!.toLowerCase().includes(needle)) {
      start = index;
      headingLevel = match[1]!.length;
      break;
    }
  }
  if (start === -1) return undefined;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const match = /^(#{1,6})\s+/.exec(lines[index] ?? "");
    if (match && match[1]!.length <= headingLevel) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join("\n").trim();
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
  const tags = entry.tags && entry.tags.length > 0 ? `\ntags: ${entry.tags.join(",")}` : "";
  const taskId = entry.taskId ? `\ntaskId: ${entry.taskId}` : "";
  return `---\nid: ${entry.id}\ntitle: ${entry.title}\nsource: ${entry.source}${taskId}${tags}\nvalidity: ${entry.validity}\ncreatedAt: ${entry.createdAt}\nupdatedAt: ${entry.updatedAt}\n---\n\n${content}\n`;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

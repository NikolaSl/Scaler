/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { lstat, open, readlink } from "node:fs/promises";
import { join, posix, win32 } from "node:path";
import { fingerprintJson } from "./fingerprints.js";

// Exact paths, not permission prefixes or worker-proposed artifacts. Omitted
// coverage is unknown; [] explicitly binds no filesystem objects.
export function normalizeOutputPaths(value: string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("Invalid outputPaths: declared output paths must be an array.");
  for (const path of value) {
    if (typeof path !== "string" || !path || posix.isAbsolute(path) || win32.isAbsolute(path) || /^[a-z]:/i.test(path)
      || /[\\\0*?\[\]]/.test(path) || path.split("/").some((part) => !part || part === "." || part === ".."
        || part.toLowerCase() === ".git" || part.toLowerCase() === ".scaler")) {
      throw new Error(`Invalid declared output path: ${String(path)}. Use exact project-relative output paths.`);
    }
  }
  return [...new Set(value)].sort();
}

export async function fingerprintDeclaredOutputs(cwd: string, declared: string[] | undefined): Promise<string | null> {
  const paths = normalizeOutputPaths(declared);
  if (paths === undefined) return null;
  const outputs = [];
  for (const path of paths) {
    try {
      const parts = path.split("/");
      for (let depth = 1; depth < parts.length; depth++) {
        const parent = await lstat(join(cwd, ...parts.slice(0, depth)));
        if (!parent.isDirectory()) throw new Error(`Declared output ${path} has a non-directory or symlink ancestor.`);
      }
      const absolute = join(cwd, path);
      const stat = await lstat(absolute);
      if (stat.isSymbolicLink()) outputs.push({ path, kind: "symlink", target: await readlink(absolute) });
      else if (stat.isFile()) {
        outputs.push({ path, kind: "file", ...await fingerprintStableFile(absolute, stat) });
      } else throw new Error(`Declared output ${path} is not a file, symlink or deletion.`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      outputs.push({ path, kind: "deleted" });
    }
  }
  return fingerprintJson(outputs);
}

async function fingerprintStableFile(path: string, expected: Stats): Promise<{ executable: boolean; digest: string }> {
  if (!constants.O_NOFOLLOW) throw new Error("Declared output capture requires a no-follow file-open capability.");
  // Refuse a leaf symlink swap; nonblocking open also prevents a raced FIFO
  // from hanging before fstat can reject its type. Read bytes/mode from one fd.
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`Declared output changed before opening: ${path}`);
    throw error;
  });
  try {
    const before = await file.stat();
    if (!before.isFile() || !sameFile(expected, before)) throw new Error(`Declared output was replaced before reading: ${path}`);
    const hash = createHash("sha256");
    for await (const chunk of file.createReadStream({ autoClose: false })) hash.update(chunk);
    if (!sameFile(before, await file.stat())) throw new Error(`Declared output changed while reading: ${path}`);
    return { executable: (before.mode & 0o111) !== 0, digest: hash.digest("hex") };
  } finally { await file.close(); }
}

function sameFile(first: Stats, second: Stats): boolean {
  return first.dev === second.dev && first.ino === second.ino && first.mode === second.mode
    && first.size === second.size && first.mtimeMs === second.mtimeMs && first.ctimeMs === second.ctimeMs;
}

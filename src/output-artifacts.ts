/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readlink } from "node:fs/promises";
import { join, posix, win32 } from "node:path";
import { fingerprintJson } from "./fingerprints.js";

// Exact paths, not permission prefixes or worker-proposed artifacts. Omitted
// coverage is unknown; [] explicitly binds no filesystem objects.
export function normalizeOutputPaths(value: string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("Declared output paths must be an array.");
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
        const hash = createHash("sha256");
        for await (const chunk of createReadStream(absolute)) hash.update(chunk);
        outputs.push({ path, kind: "file", executable: (stat.mode & 0o111) !== 0, digest: hash.digest("hex") });
      } else throw new Error(`Declared output ${path} is not a file, symlink or deletion.`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      outputs.push({ path, kind: "deleted" });
    }
  }
  return fingerprintJson(outputs);
}

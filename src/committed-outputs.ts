/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readlink } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import { fingerprintJson } from "./fingerprints.js";
import type { CommitReportRecord } from "./git.js";

const exec = promisify(execFile);

// Compare the actual accepted commit's outputs, not its historical HEAD identity.
// No Git mutation, external diff driver, text conversion, or shell interpolation.
export async function verifyCommittedOutputs(cwd: string, report: CommitReportRecord): Promise<string[]> {
  const reject = (reason: string) => [`Committed output evidence rejected: ${reason}`];
  if (!/^[0-9a-f]{7,64}$/.test(report.commitHash)) return reject("invalid commit identity.");
  const paths = report.includedPaths;
  if (!paths.length || paths.some((path) => !path || isAbsolute(path) || path.split("/").includes(".."))) {
    return reject("missing or invalid included paths.");
  }
  const git = (...args: string[]) => exec("git", ["--literal-pathspecs", "-c", "core.filemode=true", ...args], { cwd });
  try {
    const commit = (await git("rev-parse", "--verify", `${report.commitHash}^{commit}`)).stdout.trim();
    await git("merge-base", "--is-ancestor", commit, "HEAD");
    const changed = (await git("diff-tree", "--root", "--no-commit-id", "--name-only", "--no-renames", "-r", "-z", commit)).stdout.split("\0").filter(Boolean).sort();
    if (fingerprintJson(changed) !== fingerprintJson([...paths].sort())) {
      // Status-based reports can contain only rename/copy destinations. Accept
      // that representation, but still verify every actual changed path below,
      // including the deleted source of a rename.
      const statuses = (await git("diff-tree", "--root", "--no-commit-id", "--name-status", "-M", "-C", "-r", "-z", commit)).stdout.split("\0").filter(Boolean);
      const destinations: string[] = [];
      for (let index = 0; index < statuses.length;) {
        const status = statuses[index++]!;
        const path = statuses[index++]!;
        destinations.push(/^[RC]\d+$/.test(status) ? statuses[index++]! : path);
      }
      if (fingerprintJson(destinations.sort()) !== fingerprintJson([...paths].sort())) {
        return reject("reported paths do not match the actual commit.");
      }
    }
    try {
      await git("diff", "--cached", "--quiet", "--no-ext-diff", "--no-textconv", "--ignore-submodules=none", commit, "--", ...changed);
    } catch (error) {
      if ((error as { code?: number }).code === 1) return reject("index/staged outputs differ from the accepted commit.");
      throw error;
    }
    // Read actual bytes: Git diff can hide edits behind assume-unchanged or
    // skip-worktree index flags. A committed deletion must remain absent too.
    const entries = (await git("ls-tree", "-r", "-z", commit, "--", ...changed)).stdout.split("\0").filter(Boolean);
    const present = new Map(entries.map((entry) => {
      const tab = entry.indexOf("\t");
      const [mode, type, oid] = entry.slice(0, tab).split(" ");
      return [entry.slice(tab + 1), { mode, type, oid }] as const;
    }));
    for (const path of changed) {
      const parts = path.split("/");
      for (let depth = 1; depth < parts.length; depth++) {
        try {
          if ((await lstat(join(cwd, ...parts.slice(0, depth)))).isSymbolicLink()) return reject(`symlink ancestor at ${path}.`);
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      }
      const entry = present.get(path);
      try {
        const absolute = join(cwd, path);
        const stat = await lstat(absolute);
        if (!entry) return reject(`accepted deletion ${path} was recreated.`);
        if (entry.type !== "blob" || !entry.oid) return reject(`unsupported committed output type at ${path}.`);
        const mode = stat.isSymbolicLink() ? "120000" : stat.isFile() ? ((stat.mode & 0o111) ? "100755" : "100644") : "unsupported";
        if (mode !== entry.mode) return reject(`output type/mode changed at ${path}.`);
        const hash = createHash(entry.oid.length === 64 ? "sha256" : "sha1");
        if (stat.isSymbolicLink()) {
          const target = await readlink(absolute, { encoding: "buffer" });
          hash.update(`blob ${target.length}\0`).update(target);
        } else {
          hash.update(`blob ${stat.size}\0`);
          for await (const chunk of createReadStream(absolute)) hash.update(chunk);
        }
        if (hash.digest("hex") !== entry.oid) return reject(`output contents changed at ${path}.`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        if (entry) return reject(`accepted output ${path} is missing.`);
      }
    }
    return [];
  } catch {
    return reject("commit is unavailable/outside current history, or its outputs changed; reconcile and revalidate.");
  }
}

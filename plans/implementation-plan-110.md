# PLAN-110 — Declared filesystem output freshness

## Basis and bounded scope

Continue P2.3 / SC-01, SC-10, SC-26 after PLAN-109. Git-less candidate
snapshots currently have no filesystem identity, and completion deliberately
ignores historical Git candidates so independent later commits remain possible.
A command can validate a non-Git result which then changes without invalidating
acceptance. Add explicit `outputPaths` to the existing validation manifest;
capture their physical identity independently of Git before/after validation and
on commit/skip/completion verification. Do not infer this basis from worker reports.

Paths are exact project-relative files, symlinks (link target, not target bytes),
or explicit deletions. No directory traversal, globs, recursive tree snapshots,
runtime metadata or new verifier framework. Stream file hashing and reject
symlink ancestors/unsupported objects. Bind this declared set to policy identity.

An omitted list remains unknown coverage; an empty list binds no filesystem
outputs. This increment does not assert that the declared set is sufficient,
retrofit legacy proof, or claim full skip/non-Git completion correctness.
Admission of a complete expected-output contract and semantic/integration checks
remain follow-ups. No mandatory Git/container/model requirement is introduced.

## Ordered work and acceptance

1. Commit this plan before code. Reproduce non-Git after-check changes and
   Git/non-Git post-skip changes; preserve unchanged-output positive controls.
2. Extend the manifest/tool input and validation snapshot with declared output
   identity, reusing existing receipt comparisons and completion acceptance.
3. Cover bytes, mode, deletion, symlink replacement, mutation during validation,
   policy changes, unsafe paths, independent tasks, and unchanged restart.
4. Run focused tests, build, full unit/mock integration and conformance gate.
5. Separate implementation/tests and evidence/docs commits. Request completed
   Copilot review on the final head; merge only after all valid findings and
   gates are resolved with an expected-head guard. Deadline remains 18:00Z.

No paid model calls, deployment, or arbitrary-writer isolation claim.

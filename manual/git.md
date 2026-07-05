# Scaler Git Progress

Current behavior:

- `/scaler` and `/scaler-git-bootstrap` verify or initialize the git repository and write SCALER runtime ignore rules to `.git/info/exclude`.
- Bootstrap/status evidence is stored in `.scaler/reports/git-bootstrap.json` and audit-logged.
- Before a conductor starts task work, unrelated dirty project changes pause the run and write a `pre-task-dirty-tree` checkpoint.
- `.scaler/` runtime changes are classified separately from project changes.
- Allowed task paths distinguish task changes from unrelated user changes.
- A passed validation does **not** mark a task `validated` while allowed project changes still need commit/skip evidence.
- `/scaler-commit` can commit a validated or validation-passed task with message `TASK-ID: short title`; accepted commits transition validation-passed tasks to `validated`.
- `/scaler-commit-skip [taskId] | <reason>` records explicit skip evidence in `.scaler/reports/commit-skips.json`; accepted skips also transition validation-passed tasks to `validated`.
- Clean or runtime-only trees can record commit-skip evidence instead of empty commits.
- `.scaler/` runtime data is not staged by the commit helper.
- Commits, skipped commits, bootstrap records, dirty blockers, and accepted commit hashes are audit-logged under `.scaler/logs/`.
- Successful commits write `.scaler/reports/commits.json` with task id, commit id, included paths, git safety summary, and latest validation summary.

Use `/scaler-commit`, `/scaler-commit-skip`, `/scaler-commits`, `/scaler-commit-skips`, and `/scaler-git-bootstrap` for the lifecycle.

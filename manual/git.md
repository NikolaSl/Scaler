# Scaler Git Progress

Implemented git support is currently helper-level behavior.

Current behavior:

- Scaler can inspect `git status --porcelain` deterministically.
- `.scaler/` runtime changes are classified separately from project changes.
- Allowed task paths can be supplied to distinguish task changes from unrelated user changes.
- Validated task changes can be committed with message format `TASK-ID: short title`.
- `.scaler/` runtime data is not staged by the commit helper.
- Commit attempts and accepted commit hashes are audit-logged under `.scaler/logs/`.
- Successful commits also write post-commit report records under `.scaler/reports/commits.json` with task id, commit id, included paths, git safety summary, and latest validation summary.
- Commits are refused when unrelated changes are detected, when the task is not validated, or when the directory is not a git repository.

Use `/scaler-commit` to commit a validated task and `/scaler-commits [taskId]` to inspect commit reports.

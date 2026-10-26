# PLAN-200 — Coarse proposal to admitted executable frontier

AC-03 and `specs/replanning.md` require progressive detail: future milestones
may remain coarse, but execution requires an admitted concrete contract. Existing
proposed-plan storage and task-quality/replan admission can express this without
new milestone fields or a second planner call. Test their actual composition.

One configured non-software profile: store a draft proposal alongside a concrete
NOW frontier, preserving NOW and adding only a coarse FUTURE id/title/requirement
ref. Accept NOW through normal scripted conductor/report plus actual file validation.
Storage must not publish runtime FUTURE or replace the active frontier. Attempt
real replan acceptance: reject incomplete contract before current-plan/state/
requirement publication; preserve the draft and refuse downstream dispatch.

Replace only FUTURE's proposal with its concrete scoped file/DoD/validator and
NOW dependency, then accept through the same public replan API. Preserve NOW's
current evidence; only afterward may normal conductor invoke FUTURE. An injected
failed runner proves admission, not completion or an actual external effect.

This profile uses a separate proposed artifact, not mixed-granularity runtime
tasks or automatic milestone expansion. It does not prove semantic coverage,
necessity/CSV scope rejection, all AC-03/P4/P5 or configured model quality.
Prefer zero production changes if existing behavior satisfies these controls.
Before phase acceptance: own focused/build/full exact-head gate, fresh source/
rubric-first independent review and guarded expected-head method merge. Retain
failed evidence; no paid inference/deployment/new automation. Final handoff,
ownership release and mutation stop before 2026-10-26T23:08:20Z.

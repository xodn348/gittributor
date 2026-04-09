# Decisions — gittributor-v2

## [2026-04-08] Atlas: V2 Architecture Decisions
- Multi-type contributions: docs, typo, deps, test, code
- AI-free paths for typo/docs/deps (regex/AST detection)
- Anti-spam guardrails: max 2 PRs/repo/week, 3/hour total
- Trending repos: YAML-primary (repos.yaml), GitHub Search fallback
- Rate limits persisted to: `.gittributor/rate-limits.json`
- History persisted to: `.gittributor/history.json`
- js-yaml dependency added for repos.yaml loading
- CONTRIBUTING.md compliance checked pre-submit (CLA detection, issue-first)
- Manual review required before submit (no auto-submit)
- Sequential pipeline (no parallel repo processing in V2)

## 2026-04-09 F3 CLI QA
- QA verdict set to REJECT because the discovery stage is a core V2 pipeline step and failed in real CLI execution for a functional reason, not a cosmetic/help-text issue.

- [F4 scope fidelity] Final QA decision: reject on scope fidelity because only 5/13 tasks matched the plan closely enough, despite a green Bun test suite.


## [2026-04-09T13:24:45] F4 scope fidelity decision
- Verdict: REJECT for scope fidelity.
- Reason: core V2 modules exist and tests pass, but only 5/13 tasks are 1:1 compliant and the implementation history improperly modified the sacred plan file.

- 2026-04-09 F1 audit decision: anti-spam enforcement now includes both per-repo weekly caps and a global weekly cap (`MAX_GLOBAL_WEEKLY = 10`) in `src/lib/guardrails.ts`; this satisfies the plan guardrail against unlimited weekly PR submission.

## 2026-04-09 13:52:18 — Audit verdict basis
- Final F1 verdict should be APPROVE only when all must-have checks pass, all prohibited patterns are absent, and `bun test` reports 0 failures.
- Current evidence satisfies that threshold: source checks passed and `bun test` finished with 357 pass, 3 skip, 0 fail.

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

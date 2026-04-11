# Decisions — gittributor-redesign

## [2026-04-11] Architectural Decisions
- 2-Phase Analysis: Phase 1 lightweight sweep (all files, regex, seconds) → Phase 2 deep AI (candidates only, minutes)
- Hybrid approach: GitHub issues + AI code review + Static analysis (NO abandoned PR pickup)
- Dynamic repo discovery: 1k-10k★ mid-size repos via GitHub API (NOT hardcoded repos.yaml as primary)
- Bug type priority: Security CVE > NPE/null > resource leak > type error > logic error
- Phase 1 risk threshold: 0.6 → triggers Phase 2
- Phase 2 budget: top 10 candidate files max, 3 LLM calls max per repo
- CodeReduce pattern: extract minimal code slice (function + direct deps), NOT whole file
- TS/JS + Python only for static analysis scope

- 2026-04-11T11:35:10.805285+00:00: Manual QA adapted plan commands to actual exported APIs (`analyzeFileStatic`, `saveState`, `loadState`, `transition`) instead of the older planned names, because the shipped module surface differs from the plan text.

- [2026-04-11 11:36 UTC] Final QA validated the redesign with 10/10 scenario passes, 3/3 integration checks, and 3 edge cases (no repos, no issues, clean code). Pipeline state testing should use `loadState`/`saveState` in a temp workspace to avoid polluting repo state.

- [2026-04-11] Final verification hotfix kept the requested behavior changes minimal: API-first discovery, repo-tree validation for analyzer output, and validator alignment were implemented without changing `AnalysisResult` shape or adding dependencies.

- [2026-04-11T12:11:38.149651+00:00] Final verification hotfix used a local `getFileTree(repoPath)` helper from `src/lib/github.ts` for analyzer validation so repo-tree checks could be added without introducing extra GitHub API calls or new dependencies.
- [2026-04-11T12:11:38.149651+00:00] Kept config defaults unchanged while expanding validators, so new contribution types are accepted without broadening the tool's default contribution mix.

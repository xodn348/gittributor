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

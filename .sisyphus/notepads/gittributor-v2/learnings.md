# Learnings — gittributor-v2

## [2026-04-08] Task: T0
- All V2 types added to src/types/index.ts
- Config extended with V2 fields (all existing fields preserved)
- ESM import pattern: use .js extension for TypeScript imports

## [2026-04-08] Task: T5
- history.ts: loadHistory, saveContribution, updateContributionStatus, getHistoryStats, getRepoHistory
- ID: Date.now() + random suffix (no uuid)
- history.json schema: { contributions: [] }

## [2026-04-08] Atlas: Project Setup
- Project root: `/Users/jnnj92/gittributor`
- Runtime: Bun (not Node.js) — use `bun test`, `bun run`, `bun add`
- Language: TypeScript
- Test framework: bun:test
- Entry: `src/index.ts`
- Commands registered in: `src/commands/`
- Shared lib code in: `src/lib/`
- Types: `src/types/index.ts`
- State persistence: `.gittributor/` directory (JSON files)
- Evidence dir: `.sisyphus/evidence/`
- Notepad dir: `.sisyphus/notepads/gittributor-v2/`

## [2026-04-08] Task: T3
- guardrails.ts: checkRateLimit, checkDuplicateContribution, checkRepoEligibility, recordSubmission
- rate-limits.json schema: hourly array + weekly record
- Graceful on missing JSON (no throw)

## [2026-04-08] Task: T1
- js-yaml used for YAML parsing
- TrendingRepo imported from ../types/index.js
- filterRepoList enforces minStars >= 1000 always

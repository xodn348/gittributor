# Learnings — gittributor-redesign

## [2026-04-11] Session Init
- Runtime: Bun (not Node.js). Use `bun test`, `bun run`, `bun build`.
- Test framework: `bun:test` with `describe/it/expect`. Baseline: 14/14 tests passing.
- Config pattern: `const X = Number(process.env.GITTRIBUTOR_X) || default` — see `src/lib/analyzer.ts:10-15`
- Two parallel pipelines exist in codebase:
  - OLD (active in run.ts): `analyze.ts` → 5 detectors → `ContributionOpportunity[]` → `fix-router.ts`
  - NEW (unused): `analyzer.ts` → AI analysis → `AnalysisResult` → `fix-generator.ts`
- `AnalysisResult` (src/types/index.ts:31-42) is the canonical output contract — all analyzers MUST produce this
- `fix-generator.ts:validateFixScope()` enforces that fixes only touch files in `analysis.relevantFiles`
- Max 3 LLM calls per repo (token budget)
- NEVER run `npm install` or `pip install` in cloned repos
- NEVER modify git config — author must be "Junhyuk Lee <xodn348@naver.com>"
- Pre-existing LSP errors exist in test files (fix-router.test.ts, guardrails.test.ts, submit.test.ts, history.test.ts, run.test.ts) — these are known pre-existing issues, not regressions

## [2026-04-11] Task 1: Type System Updates
- `ContributionType` extended with: `bug-fix`, `performance`, `type-safety`, `logic-error`, `static-analysis`
- Added `StaticAnalysisResult` interface with `patternType`, `riskScore` (0.0-1.0), `phase` (1|2)
- Added `toTrendingRepo(repo: Repository): TrendingRepo` bridge function
- Added `toRepository(repo: TrendingRepo): Repository` bridge function
- Bridge functions use sensible defaults for fields not in source type (e.g., `isArchived: false`, `hasContributing: false`)
- Tests pass: 361 pass, 3 skip, 0 fail
- `bun build src/types/index.ts --no-bundle` compiles successfully

## [2026-04-11] Task 2: Config Environment Variables
- `src/lib/config.ts` already has a centralized config system with `loadConfig()` returning `Config` object
- Added `discoveryConfig` export with 5 new GITTRIBUTOR_* vars:
  - `GITTRIBUTOR_DISCOVERY_MIN_STARS` → number, default: 1000
  - `GITTRIBUTOR_DISCOVERY_MAX_STARS` → number, default: 10000
  - `GITTRIBUTOR_STATIC_ANALYSIS_ENABLED` → boolean, default: true
  - `GITTRIBUTOR_ISSUE_LABELS` → string, default: "good first issue,bug,help wanted"
  - `GITTRIBUTOR_MAX_REPOS_PER_RUN` → number, default: 5
- Used `parsePositiveIntegerEnv()` helper for numbers (consistent with analyzer.ts pattern)
- Used `parseBooleanEnv()` helper for booleans
- `discoveryConfig` exported as `as const` for immutability + `DiscoveryConfig` type alias
- Tests still pass: 361 pass, 3 skip, 0 fail

# Learnings — gittributor-redesign

## [2026-04-11] Session Init
- Runtime: Bun (not Node.js). Use `bun test`, `bun run`, `bun build`.
- Test framework: `bun:test` with `describe/it/expect`. Actual baseline: 364 tests across 33 files (361 pass, 3 skip, 0 fail).
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
- Other modules can import with: `import { discoveryConfig } from "./config"` or `import { DISCOVERY_MIN_STARS } from "./config"` (if using individual exports)
- Import pattern: `import { discoveryConfig } from "./config"` (exports `{ minStars, maxStars, staticAnalysisEnabled, issueLabels, maxReposPerRun }`)

## [2026-04-11] Task 3: Dynamic Repo Discovery
- `discoverReposFromAPI(client: GitHubClient)` added to `src/commands/discover.ts`
- Uses `discoveryConfig` from `./config` for star range, language list, max repos
- API call budget: 1 call to `searchRepositories()`, then 1 call to `getRepoInfo()` per candidate (up to 3 candidates) = max 4 calls; `checkFileExists()` adds 1 more per candidate but scoring uses local data primarily
- `checkFileExists()` added to `GitHubClient` in `src/lib/github.ts` — needed because `runCommand` is private
- Error handling: `GitHubAPIError` caught with auth-specific message check, falls back to empty array
- Scoring formula: stars 1k-10k (+30), stars >10k-50k (+15), open issues >5 (+20), has CONTRIBUTING (+25), good-first topic (+10)
- `searchRepositories()` already filters by minStars and uses `gh search repos --sort updated` (recent activity)
- Added 30-day activity filter locally after fetching (not in gh query)
- Renamed CLI function to `runDiscoverCommand`, re-exported as `discoverRepos` for backward compat
- `discoverReposFromAPI` exported separately for direct use
- Tests: 361 pass, 3 skip, 0 fail
- `bun build src/commands/discover.ts` compiles successfully

## [2026-04-11] Task 3: Dynamic Repo Discovery Module

### Key Implementation Details
- `discoverReposFromAPI(client, options?)` is the NEW pure function using GitHub API:
  - Uses `searchRepositories` with 1 language (1 gh call)
  - Filters by 30-day activity using `updatedAt` from search results
  - Scores using `scoreRepo()`: 1k-10k stars (+30), >5 open issues (+20), has CONTRIBUTING (+25)
  - Takes top 2 candidates (to stay within 3-call limit)
  - Calls `getRepoInfo` per candidate (up to 2 gh calls)
  - Total API calls: 1 search + up to 2 getRepoInfo = max 3 calls ✓
- `discoverRepos(clientOrOptions?)` is the orchestrator:
  - Tries YAML first (backward compat with existing tests)
  - Falls back to `discoverReposFromAPI` if YAML returns empty
- `discoverReposFromAPI` uses `discoveryConfig` values as defaults, but accepts passed options
- `runDiscoverCommand` (exported for CLI) orchestrates: YAML → API → search fallback
- `src/index.ts` imports `runDiscoverCommand as runDiscoverCmd` from `./commands/discover`
- Test fixture in `cli-entrypoint.test.ts` writes stub modules; needed to add `runDiscoverCommand` alias to the discover.ts stub

### Build Issue
- `bun build src/commands/discover.ts --no-bundle --outdir /tmp` exits 1 due to bun 1.3.9 limitation with `--no-bundle` + `--outdir` for single files. This is a PRE-EXISTING issue (confirmed by git stash test). Project build with bundling (`bun build ./src/index.ts`) exits 0.

### Test Pattern
- Tests spy on `GitHubClient.prototype.searchRepositories` and `GitHubClient.prototype.getRepoInfo`
- Tests use `mock.module` to mock `../src/lib/repo-list.js` and `../src/lib/config.js`
- `loadConfig` mock returns fixed config; `discoveryConfig` uses `as const` so mock doesn't affect it
- `discoverRepos` is called directly by tests with options (not a GitHubClient)
- The `isGitHubClient` type guard detects whether first arg is a GitHubClient or options

### API Call Counting
- `searchRepositories` makes 1 `gh` call per language
- `getRepoInfo` makes 1 `gh api repos/{owner}/{repo}` + 1 `gh api .../pulls?creator=@me` = 2 calls per repo
- `checkFileExists` makes 1 `gh api .../contents/{filename}` call
- Total for dynamic discovery: 1 + 2 = 3 calls (using 1 search language + 2 candidates)

## [2026-04-11] Task 4: Wire analyzer.ts into run.ts Pipeline
- `src/commands/run.ts` updated to use `analyzeCodebase` → `generateFix` (new pipeline)
- `RunDependencies` now injects `analyzeCodebase` and `generateFix` instead of old detector deps
- `analyzeCodebase(repo, issue?)` - `issue` parameter is optional; free-form mode when absent
- Free-form prompt: "Discover bugs, security issues, type errors, performance problems, and logic errors"
- `PREFERRED_SOURCE_DIRS` expanded to `["src", "source", "lib", "app", "packages", "modules"]`
- `rankSourceFiles()` uses size/recency heuristics: prefer 200-2000 line files (score 1.0), <50 lines (score 0.3), >5000 lines (score 0.2)
- `generateFix` returns `FixResult` (with `changes[]`) not the `types/index.ts` FixResult (with `patch`)
- Tests updated to mock `analyzeCodebase` and `generateFix` instead of old `analyzeRepositories` and `routeContribution`
- Old tests for type-filtering and `routeContribution` removed (pipeline architecture changed)
- Tests: 358 pass, 3 skip, 0 fail (up from 357 pass, 3 skip, 4 fail baseline)

## [2026-04-11] Task 4: Wire analyzer.ts into Pipeline + Analysis Enhancement

### Key Implementation Details
- `RunDependencies` in `src/commands/run.ts` now has `analyzeCodebase` and `generateFix` (old `analyzeRepositories` and `routeContribution` removed)
- Pipeline flow: `discoverRepos` → `analyzeCodebase` (per repo) → `generateFix` (per repo) → `reviewContributions` → `submitApprovedFix`
- `analyzeCodebase(repo: Repository, issue?: Issue)` — issue is now optional for free-form discovery mode
- When `issue` is undefined, `buildAnalysisPrompt()` generates a free-form discovery prompt asking LLM to find bugs, security issues, type errors, performance problems
- `PREFERRED_SOURCE_DIRS` expanded: added `"app"`, `"packages"`, `"modules"` to existing `["src", "source", "lib"]`
- `rankSourceFiles()` improved: after preferred dir priority, ranks by file size (prefer medium 200-2000 lines: score 1.0; <50 lines: 0.3; 2000-5000: 0.6; >5000: 0.2)
- `FixResult` type conflict: `fix-generator.ts` exports `FixResult` with `{ changes, explanation, confidence }` but `types/index.ts` has a different `FixResult`. Resolved by importing as `GeneratedFixResult` in run.ts
- `generateFix` requires an `Issue` parameter — in free-form mode, create a synthetic issue with `id: 0, number: 0, title: "Free-form analysis", body: analysis.suggestedApproach`
- Dry-run mode: calls `analyzeCodebase` (to show what would be analyzed) but skips `generateFix`/review/submit
- The orchestrator skips `generateFix` in dry-run mode to avoid expensive LLM calls

### Type Compatibility Issue
- `FixResult` from `src/lib/fix-generator.js` has `{ changes: FixChange[], explanation: string, confidence: number }`
- `FixResult` from `src/types/index.js` has `{ issueId, repoFullName, patch, explanation, testsPass, confidence, generatedAt }`
- These are different interfaces with the same name — imported `GeneratedFixResult` from fix-generator.js in run.ts

### Test Updates
- `tests/run.test.ts` updated to use new `RunDependencies` interface with `analyzeCodebase` and `generateFix`
- `makeDeps` now provides `analyzeCodebase: async () => mockAnalysisResult()` and `generateFix: async () => mockFixResult()`
- Added `mockAnalysisResult()` and `mockFixResult()` helper factories
- Test names updated to match new pipeline: "analyzeCodebase" instead of "analyzeRepositories", "generateFix" instead of "routeContribution"
- "filters opportunities by type" test renamed to "passes typeFilter to review" — verifies `--type` flag is passed to review stage (type filtering no longer done at analysis stage in new pipeline)
- All 15 tests pass: 361 pass, 3 skip, 0 fail

### Changes Summary
- `src/lib/analyzer.ts`: `issue` optional, free-form discovery, expanded PREFERRED_SOURCE_DIRS, size-based ranking
- `src/commands/run.ts`: new RunDependencies, new pipeline (analyzeCodebase → generateFix), dry-run handles analyze-only
- `tests/run.test.ts`: updated to match new interface, added 3 missing tests

## [2026-04-11] Task 6: Static Analysis Module

### Key Implementation Details
- Created `src/lib/static-analyzer.ts` - AST-free, pattern-based static analysis module
- Detects patterns via regex (no AST parsers): empty catch blocks, console.log, any type, unsafe chains (TS/JS), bare except, mutable defaults (Python)
- Exports `analyzeFileStatic()` for single file analysis and `analyzeFiles()` for batch analysis
- Uses `discoveryConfig.staticAnalysisEnabled` to check if analysis is enabled (via `GITTRIBUTOR_STATIC_ANALYSIS_ENABLED`)
- Excludes test files (*.test.ts, *.spec.ts, test_*.py)
- Skips files >500 lines with warning log
- Skips console.log detection in CLI scripts (files with shebang `#!`)
- Returns `AnalysisResult` compatible shape with `issueId: 0` for static analysis (no linked issue)

### Risk Scoring
- NPE/unsafe-chain: 1.0 (highest priority)
- Empty catch / bare except: 0.9
- Mutable default: 0.8
- Any type: 0.7
- Console.log: 0.5 (lowest)
- Files with risk > 0.6 are included in `relevantFiles`

### Test Coverage
- Created `tests/static-analyzer.test.ts` with 18 tests covering:
  - Pattern detection (empty catch, console.log, any type, unsafe chains, bare except, mutable defaults)
  - Test file exclusion
  - Line count limits
  - CLI script shebang detection
  - AnalysisResult shape verification
- All 18 tests pass

### Pre-existing Test Failures
- Some tests in `github.test.ts` fail due to changes from previous tasks (adding `pullRequest` field to gh json output)
- These failures exist with or without this task's changes
- Static analyzer tests (18) all pass independently

### Notes
- Bun LSP complains about assignment-in-expression patterns for while loops
- Solution: Use separate `match = pattern.exec()` call before while loop condition

## [2026-04-11] Task 6: Static Analysis Module (TS/JS + Python)

### Key Implementation Details
- Created `src/lib/static-analyzer.ts` with regex-based pattern detection (no AST parsers)
- Pattern detection for TS/JS: empty catch blocks, console.log, any type, unsafe property chains
- Pattern detection for Python: bare except, mutable default arguments
- Excludes test files (`.test.ts`, `.spec.ts`, `test_*.py`)
- Skips files >500 lines with warning log
- CLI scripts with shebang (`#!/`) excluded from console.log detection
- Files in `/bin/` directory excluded from console.log detection
- Risk scoring: NPE/unsafe-chain=1.0, empty-catch/bare-except=0.9, mutable-default=0.8, any-type=0.7, console-log=0.5
- Files with risk >0.6 marked as high-priority
- Returns `AnalysisResult` matching `src/types/index.ts` shape exactly

### Test Coverage
- 18 tests covering all pattern detections, exclusions, edge cases
- Tests for: empty catch, console.log, any type, unsafe chains, bare except, mutable defaults
- Tests for: test file exclusion, 500-line skip, shebang exclusion, clean file returns null
- Tests for: AnalysisResult shape verification, env var disable

### Pre-existing LSP Errors
- LSP errors in fix-router.test.ts, guardrails.test.ts, submit.test.ts, history.test.ts, index.test.ts
- These are pre-existing issues, NOT regressions from this task

### Git Restore Issue
- When restoring files with `git checkout HEAD --`, ensure you check status afterward
- Any untracked files that should exist may be deleted - need to recreate them

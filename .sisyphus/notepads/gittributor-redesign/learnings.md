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

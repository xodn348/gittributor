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

## [2026-04-08] Task: T2 - Discover Rewrite
- PRIMARY path: loadRepoList(config.repoListPath) from repo-list.ts loads YAML curated repos
- FALLBACK path: gh search repos with stars:>1000 pushed:>={30 days ago} if no YAML
- Uses GitHubClient.getRepoInfo() to enrich repos with isArchived, hasOpenUserPR
- checkRepoEligibility() filters out archived repos and repos with <1000 stars
- isActiveRecently() filters repos with 0 activity in 90+ days (openIssues = 0)
- calculateMergeProbability() scores repos by stars, topics, hasContributing, openIssues
- Stores TrendingRepo[] in state via setStateData("trendingRepos", trendingRepos)
- DEFAULT_MIN_STARS = 1000 (changed from 0)
- Removed: DEFAULT_DAYS_BACK=7 and created:>= date filter
- KEEP: --language and --min-stars CLI flags
- buildDiscoverQuery now uses pushed:>= instead of created:>=

## [2026-04-08] Task: T4 - Analyze Rewrite
- contribution-detector.ts: detectTypos, detectDocs, detectDeps, detectTests, detectCode
- analyzeSingleRepo(): shallow clones repo, runs all 5 detectors, returns ContributionOpportunity[]
- analyzeRepositories(): max 10 repos per run, uses checkRepoEligibility()
- MAX_REPOS constant enforces 10 repo limit
- cloneRepoShallow() uses gh repo clone --depth 1
- calculateMergeProbability() weights: type, diffSize, hasTests, contributing guide, maintainerActivity
- sortOpportunities() sorts by mergeProbability.score descending
- setStateData("contributionOpportunities", sorted) stores in pipeline state
- ESM imports require .js extension in all TypeScript imports
- AI-free for typo/docs/deps detection (regex/string matching only)

## [2026-04-08] Task: T2 - Discover Rewrite (Additional)
- Enrich repos using GitHubClient.getRepoInfo() instead of direct gh commands
- getRepoInfo() returns isArchived, hasOpenUserPR, updatedAt from GitHub API
- Filter logic: archived repos → repos with user open PRs → inactive repos (90+ days)
- Real-world test: user has open PRs in many repos, causing all YAML repos to be filtered out
- buildDiscoverQuery uses pushed:>=90days instead of created:>=
- TDD: wrote tests first (RED), then implemented (GREEN), all 12 tests pass

## [2026-04-08] Task: T4 - Implementation Details (Additional)
- detectTests(): compares source file basenames with test file basenames to find untested files
- detectTypos(): scans README.md/docs for common misspellings (teh→the, recieve→receive)
- detectDeps(): checks package.json (npm) and requirements.txt (pip) for outdated deps
- analyze.ts wraps clone in try/catch - if repo doesn't exist, no opportunities found
- Tests mock GitHub client but don't mock file operations - require actual repo content
- TypeScript: use explicit type annotation for map callbacks to avoid implicit any
- DepResult requires description field for merge probability calculation

## [2026-04-08] Task: T12 - V2 Config Schema
- Added V2 fields to loadConfig(): repoListPath, maxPRsPerWeekPerRepo, maxPRsPerHour, contributionTypes, historyPath, dryRun
- Defaults: repoListPath="repos.yaml", maxPRsPerWeekPerRepo=2, maxPRsPerHour=3, contributionTypes=["docs","typo","deps","test","code"], historyPath=".gittributor/history.json", dryRun=false
- Added readProjectConfig() for project-local .gittributorrc.json in CWD
- Merge order: defaults → global (~/.gittributorrc.json) → project-local (.gittributorrc.json)
- Validation: console.warn on unknown fields, throw ConfigError on invalid types
- V1 config preserved exactly (backward compatible)
- Tests: 12 tests covering defaults, V1→V2 defaults, project-local override, validation

## [2026-04-08] Task: T6 - Fix Router + AI-Free Detectors
- fix-router.ts: routeContribution(opportunity) routes by ContributionType
- typo/docs/deps paths: deterministic, no AI calls
- test/code paths: use src/lib/ai.ts abstraction (callModel)
- typo-detector.ts: 430+ common misspellings word list, scans .md/.txt/.rst files
- docs-detector.ts: checks README sections (Installation/Usage/Contributing/License)
- deps-detector.ts: parsePackageJson(), checkOutdatedDeps() with npm registry fetch, generateVersionBump()
- ESM imports: use .js extension in all TypeScript imports
- Tests: all 39 tests pass across fix-router.test.ts, typo-detector.test.ts, docs-detector.test.ts, deps-detector.test.ts

## [2026-04-09] Task: T7 - CONTRIBUTING.md Compliance Checker
- src/lib/contributing-checker.ts: checkContributingCompliance(repoPath) → ComplianceResult
- Detects CLA: regex match on /(?:contributor\s+license\s+agreement|CLA)/i
- Detects issue-first: regex match on /(?:please\s+open\s+an\s+issue|file\s+an\s+issue|issue\s+first)/i
- Finds PR template at .github/PULL_REQUEST_TEMPLATE.md
- Returns permissive defaults when CONTRIBUTING.md missing (no throw)
- Added ComplianceResult interface to src/types/index.ts
- TDD: wrote 9 tests first, all pass

## [2026-04-09] Task: T8 - Review Command for Multi-Type Contributions
- review.ts: added reviewContributions() function for viewing contribution opportunities
- Features implemented:
  - Group by type: Typo (2), Docs (1), etc.
  - Color coding: green (>0.7), yellow (0.4-0.7), red (<0.4) using ANSI escape codes
  - --type filter: reviewContributions({ typeFilter: "typo" })
  - Compliance warnings: CLA and issue-first warnings with yellow color
  - Summary stats: count per type, average merge probability, top recommendation
  - Empty state handling: "No contributions found" message
- Read-only: reviewContributions does NOT modify state (getStateData only)
- Uses ANSI_RESET, ANSI_GREEN, ANSI_YELLOW, ANSI_RED escape codes
- TypeScript: getStateData<T>(key) returns typed data from pipeline state

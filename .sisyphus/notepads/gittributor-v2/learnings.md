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

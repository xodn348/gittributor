# Gittributor V2 — Strategic Redesign for High-Impact OSS Contributions

## TL;DR

> **Quick Summary**: Redesign gittributor's 5-stage pipeline (discover → analyze → fix → review → submit) to target trending/famous repositories with multi-type contributions (docs, typos, deps, tests, code fixes), maximizing PR merge probability for GitHub badges (Pull Shark, Galaxy Brain) and Sponsors eligibility.
> 
> **Deliverables**:
> - Curated YAML repo list + GitHub Search API fallback for trending repo discovery
> - Multi-type contribution analyzer (docs/typos/deps/tests/code — AI-free paths for mechanical fixes)
> - Merge probability scorer based on maintainer activity, repo health, and contribution type
> - Anti-spam guardrails (max 2 PRs/repo/week, 3/hour total, duplicate check)
> - Contribution history tracker with PR outcome feedback loop
> - CONTRIBUTING.md compliance checker
> - Updated type system, state machine, and config for V2 pipeline
> 
> **Estimated Effort**: Large
> **Parallel Execution**: YES — 4 waves
> **Critical Path**: T0 (types) → T2 (discover) → T4 (analyze) → T6 (fix-router) → T8 (review) → T9 (submit) → T10 (run orchestrator)

---

## Context

### Original Request
User wants gittributor to target trending/famous repositories instead of newly-created ones. Goal: get contributions merged into high-visibility repos, earn GitHub badges (Pull Shark, Galaxy Brain, etc.), and become eligible for GitHub Sponsors. Full strategic redesign ("전체 전략 재설계"), not incremental fixes.

### Interview Summary
**Key Discussions**:
- **Contribution strategy**: Multi-type — docs, typos, deps, tests, AND code fixes (not just code)
- **PR volume**: 5-10 PRs/week — focused, high-quality with manual review before submit
- **Old plan**: fix-analyze-filters plan is superseded entirely by this V2 redesign
- **Test strategy**: TDD with bun test (RED-GREEN-REFACTOR)
- **AI providers**: Keep dual-provider (Anthropic + OpenAI) — flexibility retained

**Research Findings**:
- GitHub Trending is purely algorithmic (star velocity) — no official API
- PR merge probability highest with: small diffs, tests included, follows CONTRIBUTING.md, references existing issues
- Contribution laddering: docs/typos → small bugs → features → maintainer status
- AI-free paths viable for typo/docs/deps (regex, AST, version comparison)

### Metis Review
**Identified Gaps** (addressed):
- **Trending data source**: Curated YAML list of 30+ repos + GitHub Search API fallback (stars:>1000, pushed recently)
- **Anti-spam guardrails**: Max 2 PRs/repo/week, 3/hour total, duplicate PR check, CONTRIBUTING.md compliance
- **AI-free paths**: Typo detection (regex/spellcheck), docs (missing sections), deps (outdated version comparison) — no AI tokens needed
- **Edge cases**: Archived repos, CLA-required repos, fork workflow failures, stale contributions, monorepo handling, rate limiting, maintainer responsiveness scoring
- **Scope creep risks**: Locked out web UI, GitHub Actions, multi-language expansion

---

## Work Objectives

### Core Objective
Transform gittributor from a narrow code-fix tool targeting new repos into a strategic contribution engine targeting trending/famous repositories with diverse contribution types, maximizing PR merge rates.

### Concrete Deliverables
- `src/types/index.ts` — V2 type system (ContributionType, TrendingRepo, MergeProbability, ContributionHistory)
- `src/lib/repo-list.ts` + `repos.yaml` — Curated repo list loader + YAML config
- `src/commands/discover.ts` — Rewritten to use curated list + GitHub Search API fallback
- `src/commands/analyze.ts` — Multi-type contribution analyzer with merge probability scoring
- `src/lib/contribution-detector.ts` — AI-free detectors (typo, docs, deps, test gaps)
- `src/lib/fix-router.ts` — Routes to AI or mechanical fix based on contribution type
- `src/lib/guardrails.ts` — Anti-spam + CONTRIBUTING.md compliance
- `src/lib/history.ts` — PR outcome tracking + feedback loop
- `src/commands/review.ts` — Updated for multi-type review
- `src/commands/submit.ts` — Updated with guardrail checks pre-submit
- `src/commands/run.ts` — Updated orchestrator for V2 pipeline
- `src/lib/config.ts` — V2 config schema

### Definition of Done
- [ ] `bun test` — all tests pass (0 failures)
- [ ] `bun run src/index.ts discover` — returns repos from curated list
- [ ] `bun run src/index.ts analyze` — scores contributions across all 5 types
- [ ] Anti-spam guardrails block excess PRs correctly
- [ ] History tracker persists PR outcomes to disk

### Must Have
- Trending/famous repo targeting (curated list + search fallback)
- Multi-type contributions (docs, typos, deps, tests, code)
- Merge probability scoring
- Anti-spam guardrails
- CONTRIBUTING.md compliance check
- PR outcome history tracking
- TDD — all new code has tests

### Must NOT Have (Guardrails)
- Web UI or dashboard
- GitHub Actions / CI integration
- Automatic PR submission without manual review step
- More than 10 PRs/week
- PRs to archived repositories
- PRs that ignore CLA requirements
- Over-abstracted "framework" patterns — keep it a CLI tool
- Generic variable names (data, result, item, temp)
- `as any` or `@ts-ignore` in new code

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: YES (bun test — existing tests, some failing)
- **Automated tests**: TDD (RED-GREEN-REFACTOR)
- **Framework**: bun test
- **If TDD**: Each task follows RED (failing test) → GREEN (minimal impl) → REFACTOR

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **CLI**: Use interactive_bash (tmux) — Run command, send keystrokes, validate output
- **Library/Module**: Use Bash (bun REPL or direct import) — Import, call functions, compare output

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Foundation — types, config, guardrails, repo list):
├── T0: V2 type system [deep]
├── T1: Curated repo YAML + loader [deep]
├── T3: Anti-spam guardrails module [deep]
├── T5: Contribution history tracker [deep]
└── T11: Fix existing failing tests [deep]

Wave 2 (Core pipeline — discover, analyze, detect, fix):
├── T2: Rewrite discover command (depends: T0, T1) [deep]
├── T4: Rewrite analyze command (depends: T0, T3) [deep]
├── T6: Fix router + AI-free detectors (depends: T0) [deep]
└── T12: V2 config schema (depends: T0) [deep]

Wave 3 (Integration — review, submit, orchestrator):
├── T7: CONTRIBUTING.md compliance checker (depends: T3) [deep]
├── T8: Update review command (depends: T0, T4) [deep]
├── T9: Update submit command (depends: T0, T3, T5) [deep]
└── T10: Update run orchestrator (depends: T2, T4, T6, T8, T9) [deep]

Wave FINAL (Verification — 4 parallel reviews):
├── F1: Plan compliance audit (oracle)
├── F2: Code quality review (unspecified-high)
├── F3: Real CLI QA (unspecified-high)
└── F4: Scope fidelity check (deep)
→ Present results → Get explicit user okay
```

### Dependency Matrix

| Task | Depends On | Blocks |
|------|-----------|--------|
| T0   | —         | T2, T4, T6, T8, T9, T10, T12 |
| T1   | —         | T2 |
| T3   | —         | T4, T7, T9 |
| T5   | —         | T9 |
| T11  | —         | (none — housekeeping) |
| T2   | T0, T1    | T10 |
| T4   | T0, T3    | T8, T10 |
| T6   | T0        | T10 |
| T12  | T0        | (config used everywhere but not blocking) |
| T7   | T3        | T9 |
| T8   | T0, T4    | T10 |
| T9   | T0, T3, T5, T7 | T10 |
| T10  | T2, T4, T6, T8, T9 | F1-F4 |

### Agent Dispatch Summary

- **Wave 1**: **5 tasks** — T0 → `deep`, T1 → `deep`, T3 → `deep`, T5 → `deep`, T11 → `deep`
- **Wave 2**: **4 tasks** — T2 → `deep`, T4 → `deep`, T6 → `deep`, T12 → `deep`
- **Wave 3**: **4 tasks** — T7 → `deep`, T8 → `deep`, T9 → `deep`, T10 → `deep`
- **FINAL**: **4 tasks** — F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep`

Critical Path: T0 → T2 → T4 → T8 → T10 → F1-F4 → user okay
Parallel Speedup: ~60% faster than sequential
Max Concurrent: 5 (Wave 1)

---

## TODOs

- [ ] 0. **V2 Type System — New types for multi-type contributions**

  **What to do**:
  - Add `ContributionType` union: `"docs" | "typo" | "deps" | "test" | "code"`
  - Add `TrendingRepo` interface extending `Repository` with: `trendingScore`, `maintainerActivity`, `lastMergedPRAge`, `contributingGuideUrl`
  - Add `MergeProbability` interface: `score` (0-1), `factors` (record of factor name → weight), `recommendation` string
  - Add `ContributionOpportunity` interface: `type: ContributionType`, `description`, `filePath?`, `confidence`, `effort: "trivial" | "small" | "medium"`
  - Add `ContributionHistory` interface: `prUrl`, `repoFullName`, `type: ContributionType`, `status: "open" | "merged" | "closed"`, `submittedAt`, `resolvedAt?`
  - Add `GuardrailCheck` interface: `allowed: boolean`, `reason?: string`, `cooldownUntil?: string`
  - Update `PipelineState` to include `contributionHistory: ContributionHistory[]`
  - Update `Config` to include `repoListPath`, `maxPRsPerWeekPerRepo`, `maxPRsPerHour`
  - Write tests FIRST (RED): import types, assert they exist, create typed objects
  - Make tests pass (GREEN), then refactor if needed

  **Must NOT do**:
  - Remove or rename existing V1 types (backward compat for migration)
  - Add runtime validation here (that's T12's job)

  **Recommended Agent Profile**:
  - **Subagent Type**: `deep`
    - Reason: Type system design requires understanding full pipeline data flow
  - **Skills**: [`test-driven-development`]
    - `test-driven-development`: TDD workflow for type definitions

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with T1, T3, T5, T11)
  - **Blocks**: T2, T4, T6, T8, T9, T10, T12
  - **Blocked By**: None (can start immediately)

  **References**:
  - `src/types/index.ts` — Current V1 type definitions. Extend, don't replace. Key types: `Repository` (line 4-14), `Issue` (16-29), `PipelineState` (85-94), `Config` (96-108)
  - `src/commands/discover.ts:11-14` — Current defaults (DEFAULT_MIN_STARS, DEFAULT_LANGUAGE, DEFAULT_DAYS_BACK) — new types must support these as optional overrides
  - `src/commands/analyze.ts:7` — Current ISSUE_LABELS array — ContributionOpportunity must subsume this pattern
  - `tests/` — Existing test files for bun test patterns

  **Acceptance Criteria**:
  - [ ] Test file: `tests/types.test.ts` created with type instantiation tests
  - [ ] `bun test tests/types.test.ts` → PASS
  - [ ] All new types exported from `src/types/index.ts`
  - [ ] Existing V1 types unchanged (no breaking changes)

  **QA Scenarios**:
  ```
  Scenario: V2 types are importable and usable
    Tool: Bash
    Preconditions: bun installed, project dependencies installed
    Steps:
      1. Run: bun test tests/types.test.ts
      2. Assert exit code 0
      3. Assert output contains "pass" and no "fail"
    Expected Result: All type tests pass
    Failure Indicators: Import errors, type errors, test failures
    Evidence: .sisyphus/evidence/task-0-types-importable.txt

  Scenario: V1 types still work unchanged
    Tool: Bash
    Preconditions: Existing tests exist
    Steps:
      1. Run: bun test tests/
      2. Assert no NEW failures compared to baseline (T11 fixes old ones)
    Expected Result: No regression in existing type usage
    Evidence: .sisyphus/evidence/task-0-v1-compat.txt
  ```

  **Commit**: YES
  - Message: `feat(types): add V2 type system for multi-type contributions`
  - Files: `src/types/index.ts`, `tests/types.test.ts`
  - Pre-commit: `bun test tests/types.test.ts`

- [ ] 1. **Curated Repository YAML List + Loader**

  **What to do**:
  - Create `repos.yaml` at project root with 30+ curated trending/famous repos organized by category:
    - **Web frameworks**: vercel/next.js, facebook/react, sveltejs/svelte, vuejs/core
    - **Runtimes/tools**: denoland/deno, oven-sh/bun, nodejs/node
    - **AI/ML**: langchain-ai/langchain, openai/openai-node, huggingface/transformers
    - **DevTools**: microsoft/vscode, neovim/neovim, typst/typst
    - **Infra**: docker/compose, kubernetes/kubernetes, hashicorp/terraform
    - **Libraries**: tanstack/query, trpc/trpc, drizzle-team/drizzle-orm
  - Each entry: `fullName`, `language`, `categories[]`, `notes` (optional)
  - Create `src/lib/repo-list.ts`:
    - `loadRepoList(path?: string): TrendingRepo[]` — parse YAML, validate entries, return typed array
    - `filterRepoList(repos, filters: { language?, category?, minStars? }): TrendingRepo[]`
    - Use `js-yaml` for parsing (add as dependency)
  - Write tests FIRST: test loading valid YAML, filtering by language, handling missing file, handling malformed YAML

  **Must NOT do**:
  - Scrape GitHub Trending page (fragile, against ToS)
  - Hardcode repos in TypeScript (YAML is the source of truth)
  - Include repos with < 1000 stars

  **Recommended Agent Profile**:
  - **Subagent Type**: `deep`
    - Reason: YAML schema design + loader with error handling
  - **Skills**: [`test-driven-development`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with T0, T3, T5, T11)
  - **Blocks**: T2
  - **Blocked By**: None (can start immediately — uses TrendingRepo type but can define inline temporarily, finalized in T0)

  **References**:
  - `src/types/index.ts` — `TrendingRepo` type (created in T0) for return type
  - `src/lib/github.ts` — Existing GitHub API patterns (gh CLI wrapper) for consistency
  - `package.json` — Check if js-yaml already a dependency; if not, add it

  **Acceptance Criteria**:
  - [ ] `repos.yaml` exists with 30+ repos, all with fullName and language
  - [ ] `src/lib/repo-list.ts` exports `loadRepoList` and `filterRepoList`
  - [ ] `bun test tests/repo-list.test.ts` → PASS
  - [ ] Malformed YAML throws descriptive error (not crash)

  **QA Scenarios**:
  ```
  Scenario: Load curated repo list successfully
    Tool: Bash
    Preconditions: repos.yaml exists with valid content
    Steps:
      1. Run: bun -e "import { loadRepoList } from './src/lib/repo-list'; const repos = loadRepoList(); console.log(JSON.stringify({ count: repos.length, first: repos[0].fullName }))"
      2. Assert output JSON has count >= 30
      3. Assert first repo fullName matches pattern "org/repo"
    Expected Result: Returns 30+ repos with valid fullName format
    Evidence: .sisyphus/evidence/task-1-load-repos.txt

  Scenario: Handle missing YAML file gracefully
    Tool: Bash
    Steps:
      1. Run: bun -e "import { loadRepoList } from './src/lib/repo-list'; try { loadRepoList('/nonexistent.yaml') } catch(e) { console.log('ERROR:', e.message) }"
      2. Assert output contains "ERROR:" and a descriptive message
    Expected Result: Throws descriptive error, not unhandled crash
    Evidence: .sisyphus/evidence/task-1-missing-yaml-error.txt
  ```

  **Commit**: YES
  - Message: `feat(discover): add curated repo YAML list and loader`
  - Files: `repos.yaml`, `src/lib/repo-list.ts`, `tests/repo-list.test.ts`
  - Pre-commit: `bun test tests/repo-list.test.ts`

- [ ] 2. **Rewrite Discover Command for Trending Repos**

  **What to do**:
  - Rewrite `src/commands/discover.ts` to:
    1. PRIMARY: Load repos from curated YAML list via `loadRepoList()`
    2. FALLBACK: If YAML list is empty/missing, use GitHub Search API (`gh search repos`) with `stars:>1000 pushed:>={30 days ago}` filter
    3. For each repo, enrich with GitHub API data: star count, last push date, open issues count, whether archived, whether user already has open PR
    4. Filter out: archived repos, repos where user already has open PR, repos not pushed in 90+ days
    5. Sort by merge probability heuristic: recent push + moderate open issues + active maintainers
    6. Store enriched `TrendingRepo[]` in pipeline state
  - Remove old `DEFAULT_DAYS_BACK = 7` and `created:>=` filter logic
  - Keep `--language` and `--min-stars` CLI flags but change defaults: `DEFAULT_MIN_STARS = 1000`
  - Write tests FIRST: test YAML-primary discovery, test fallback to search API, test archived repo filtering, test already-has-PR filtering

  **Must NOT do**:
  - Remove the `gh` CLI dependency (keep it as the GitHub API client)
  - Add web scraping of github.com/trending
  - Change the CLI command interface (still `gittributor discover`)

  **Recommended Agent Profile**:
  - **Subagent Type**: `deep`
    - Reason: Core pipeline rewrite with multiple data sources and filtering logic
  - **Skills**: [`test-driven-development`]

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2
  - **Blocks**: T10
  - **Blocked By**: T0 (types), T1 (repo list loader)

  **References**:
  - `src/commands/discover.ts` — Current implementation to rewrite. Key: `buildDiscoverQuery()` (line 48+), `discoverRepositories()` main function
  - `src/lib/github.ts` — `searchRepos()` and `getRepoInfo()` functions — reuse these for enrichment
  - `src/lib/repo-list.ts` — Created in T1, provides `loadRepoList()` and `filterRepoList()`
  - `src/types/index.ts` — `TrendingRepo` type from T0
  - `src/lib/state.ts` — State persistence pattern to follow for storing discoveries

  **Acceptance Criteria**:
  - [ ] `bun test tests/discover.test.ts` → PASS
  - [ ] `bun run src/index.ts discover --dry-run` outputs repos with stars > 1000
  - [ ] Archived repos filtered out
  - [ ] Repos with existing user PRs filtered out
  - [ ] Default min stars changed from 0 to 1000

  **QA Scenarios**:
  ```
  Scenario: Discover returns trending repos from curated list
    Tool: interactive_bash (tmux)
    Preconditions: repos.yaml exists, gh CLI authenticated
    Steps:
      1. Run: bun run src/index.ts discover --dry-run 2>&1
      2. Assert output contains repo names matching "org/repo" pattern
      3. Assert all listed repos have stars >= 1000
      4. Assert no repo shows "archived" flag
    Expected Result: Lists 5+ trending repos from curated YAML, all with 1000+ stars
    Failure Indicators: Empty output, repos with < 1000 stars, archived repos appearing
    Evidence: .sisyphus/evidence/task-2-discover-trending.txt

  Scenario: Discover skips repos where user has open PR
    Tool: Bash
    Preconditions: Test with mock/stub that simulates existing open PR
    Steps:
      1. Run discover test that includes a repo with hasOpenUserPR=true
      2. Assert that repo is excluded from results
    Expected Result: Repos with existing open PRs are filtered out
    Evidence: .sisyphus/evidence/task-2-skip-existing-pr.txt
  ```

  **Commit**: YES
  - Message: `feat(discover): rewrite discover for trending repos`
  - Files: `src/commands/discover.ts`, `tests/discover.test.ts`
  - Pre-commit: `bun test tests/discover.test.ts`

- [ ] 3. **Anti-Spam Guardrails Module**

  **What to do**:
  - Create `src/lib/guardrails.ts` with:
    - `checkRateLimit(repoFullName: string): GuardrailCheck` — enforce max 2 PRs/repo/week, 3 PRs/hour total
    - `checkDuplicateContribution(repoFullName: string, type: ContributionType, filePath?: string): GuardrailCheck` — prevent duplicate PRs for same fix
    - `checkRepoEligibility(repo: TrendingRepo): GuardrailCheck` — reject archived repos, repos not pushed in 90+ days
    - Rate limit data persisted in `.gittributor/rate-limits.json` (local project dir)
  - Use `ContributionHistory` from history tracker (T5) for duplicate detection, but guardrails module itself is independent
  - Write tests FIRST: test rate limit enforcement, test duplicate detection, test archived repo rejection, test cooldown calculation

  **Must NOT do**:
  - Hardcode rate limits (use config values from T12)
  - Block based on repo popularity alone (all eligible repos are valid targets)
  - Implement CONTRIBUTING.md compliance here (that's T7)

  **Recommended Agent Profile**:
  - **Subagent Type**: `deep`
  - **Skills**: [`test-driven-development`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with T0, T1, T5, T11)
  - **Blocks**: T4, T7, T9
  - **Blocked By**: None (can start immediately)

  **References**:
  - `src/types/index.ts` — `GuardrailCheck` type (created in T0) for return type
  - `src/lib/state.ts` — File persistence pattern (JSON read/write) to follow for rate-limits.json
  - `src/lib/github.ts` — GitHub API patterns for checking repo archived status

  **Acceptance Criteria**:
  - [ ] `src/lib/guardrails.ts` exports `checkRateLimit`, `checkDuplicateContribution`, `checkRepoEligibility`
  - [ ] `bun test tests/guardrails.test.ts` → PASS
  - [ ] Rate limit: 3rd PR in same hour returns `{ allowed: false, reason: "...", cooldownUntil: "..." }`
  - [ ] Archived repo returns `{ allowed: false, reason: "Repository is archived" }`

  **QA Scenarios**:
  ```
  Scenario: Rate limit blocks excess PRs
    Tool: Bash
    Steps:
      1. Simulate 3 PRs submitted in the last hour by writing rate-limits.json with 3 entries
      2. Call checkRateLimit("some/repo")
      3. Assert result.allowed === false
      4. Assert result.reason contains "rate limit" or "hour"
      5. Assert result.cooldownUntil is a valid ISO date string
    Expected Result: 4th PR blocked with cooldown info
    Evidence: .sisyphus/evidence/task-3-rate-limit-block.txt

  Scenario: Archived repo rejected
    Tool: Bash
    Steps:
      1. Create TrendingRepo object with archived=true
      2. Call checkRepoEligibility(archivedRepo)
      3. Assert result.allowed === false
      4. Assert result.reason contains "archived"
    Expected Result: Archived repos are rejected
    Evidence: .sisyphus/evidence/task-3-archived-reject.txt
  ```

  **Commit**: YES
  - Message: `feat(guardrails): add anti-spam and rate limiting`
  - Files: `src/lib/guardrails.ts`, `tests/guardrails.test.ts`
  - Pre-commit: `bun test tests/guardrails.test.ts`

- [ ] 4. **Rewrite Analyze Command — Multi-Type Contribution Scoring**

  **What to do**:
  - Rewrite `src/commands/analyze.ts` to:
    1. For each discovered repo, clone/shallow-fetch and scan for contribution opportunities across ALL 5 types:
       - **Typo**: Scan README.md, docs/ for common misspellings (regex-based word list)
       - **Docs**: Check for missing README sections (Installation, Usage, Contributing, License), empty docs/
       - **Deps**: Check package.json/requirements.txt for outdated dependencies (compare to npm registry / PyPI)
       - **Test**: Find source files without corresponding test files, low test coverage directories
       - **Code**: Scan for open issues labeled "good first issue", "help wanted", "bug"
    2. Score each opportunity with `MergeProbability`: weighted factors (diff size, type, maintainer activity, has tests, follows contributing guide)
    3. Sort opportunities by merge probability descending
    4. Store `ContributionOpportunity[]` in pipeline state
  - Create `src/lib/contribution-detector.ts` with detector functions for each type (AI-free for typo/docs/deps)
  - Write tests FIRST: test each detector type independently, test scoring algorithm, test sorting

  **Must NOT do**:
  - Use AI for typo/docs/deps detection (must be deterministic)
  - Clone full repo history (shallow clone only: `--depth 1`)
  - Analyze more than 10 repos per run (performance guard)

  **Recommended Agent Profile**:
  - **Subagent Type**: `deep`
  - **Skills**: [`test-driven-development`]

  **Parallelization**:
  - **Can Run In Parallel**: YES (within Wave 2)
  - **Parallel Group**: Wave 2 (with T2, T6, T12)
  - **Blocks**: T8, T10
  - **Blocked By**: T0 (types), T3 (guardrails for eligibility pre-check)

  **References**:
  - `src/commands/analyze.ts` — Current implementation to rewrite. Key: `analyzeRepository()` function, ISSUE_LABELS constant
  - `src/lib/analyzer.ts` — Existing code analysis logic. Reuse clone/checkout pattern
  - `src/lib/github.ts` — `getRepoIssues()` for "good first issue" detection
  - `src/types/index.ts` — `ContributionOpportunity`, `MergeProbability`, `ContributionType` from T0

  **Acceptance Criteria**:
  - [ ] `tests/analyze.test.ts` → PASS
  - [ ] `tests/contribution-detector.test.ts` → PASS
  - [ ] Typo detector finds "teh" → "the" in sample text
  - [ ] Deps detector finds outdated package version
  - [ ] Merge probability returns score 0-1 with factor breakdown
  - [ ] Opportunities sorted by merge probability descending

  **QA Scenarios**:
  ```
  Scenario: Analyze detects typo opportunities
    Tool: Bash
    Steps:
      1. Create temp repo with README.md containing "Teh quick brown fox"
      2. Run typo detector on the repo
      3. Assert returns ContributionOpportunity with type="typo", confidence > 0.8
    Expected Result: Typo detected with high confidence
    Evidence: .sisyphus/evidence/task-4-typo-detection.txt

  Scenario: Merge probability scoring works
    Tool: Bash
    Steps:
      1. Create ContributionOpportunity with type="typo", small diff
      2. Create MergeProbability scorer with active maintainer signals
      3. Assert score > 0.7 (typo + active maintainer = high merge chance)
    Expected Result: High merge probability for typo in active repo
    Evidence: .sisyphus/evidence/task-4-merge-probability.txt
  ```

  **Commit**: YES
  - Message: `feat(analyze): rewrite analyze for multi-type contributions`
  - Files: `src/commands/analyze.ts`, `src/lib/contribution-detector.ts`, `tests/analyze.test.ts`, `tests/contribution-detector.test.ts`
  - Pre-commit: `bun test tests/analyze.test.ts`

- [ ] 5. **Contribution History Tracker**

  **What to do**:
  - Create `src/lib/history.ts` with:
    - `loadHistory(): ContributionHistory[]` — read from `.gittributor/history.json`
    - `saveContribution(entry: ContributionHistory): void` — append to history file
    - `updateContributionStatus(prUrl: string, status: "open" | "merged" | "closed"): void` — update existing entry
    - `getHistoryStats(): { total: number, merged: number, closed: number, open: number, mergeRate: number }` — aggregate stats
    - `getRepoHistory(repoFullName: string): ContributionHistory[]` — filter by repo
  - History file location: `.gittributor/history.json` in project root
  - Auto-create `.gittributor/` directory if missing
  - Write tests FIRST: test load/save cycle, test status update, test stats calculation, test handling of missing/corrupted file

  **Must NOT do**:
  - Use a database (JSON file is sufficient for CLI tool)
  - Auto-sync with GitHub API (manual update via `gittributor sync` — out of scope for V2)
  - Store sensitive data (no tokens, no auth info)

  **Recommended Agent Profile**:
  - **Subagent Type**: `deep`
  - **Skills**: [`test-driven-development`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with T0, T1, T3, T11)
  - **Blocks**: T9
  - **Blocked By**: None (can start immediately)

  **References**:
  - `src/types/index.ts` — `ContributionHistory` type from T0
  - `src/lib/state.ts` — JSON file persistence pattern (readFileSync/writeFileSync with error handling)

  **Acceptance Criteria**:
  - [ ] `src/lib/history.ts` exports `loadHistory`, `saveContribution`, `updateContributionStatus`, `getHistoryStats`, `getRepoHistory`
  - [ ] `bun test tests/history.test.ts` → PASS
  - [ ] Save + load round-trip preserves all fields
  - [ ] Stats calculation returns correct merge rate
  - [ ] Missing `.gittributor/` directory auto-created

  **QA Scenarios**:
  ```
  Scenario: Save and load contribution history
    Tool: Bash
    Steps:
      1. Call saveContribution({ prUrl: "https://github.com/org/repo/pull/1", repoFullName: "org/repo", type: "typo", status: "open", submittedAt: "2024-01-01T00:00:00Z" })
      2. Call loadHistory()
      3. Assert result array length === 1
      4. Assert result[0].prUrl === "https://github.com/org/repo/pull/1"
    Expected Result: History persisted and retrievable
    Evidence: .sisyphus/evidence/task-5-save-load.txt

  Scenario: Stats calculation with mixed statuses
    Tool: Bash
    Steps:
      1. Save 3 contributions: 2 merged, 1 closed
      2. Call getHistoryStats()
      3. Assert result.total === 3, result.merged === 2, result.mergeRate close to 0.67
    Expected Result: Correct stats aggregation
    Evidence: .sisyphus/evidence/task-5-stats.txt
  ```

  **Commit**: YES
  - Message: `feat(history): add PR outcome tracking`
  - Files: `src/lib/history.ts`, `tests/history.test.ts`
  - Pre-commit: `bun test tests/history.test.ts`

- [ ] 6. **Fix Router + AI-Free Detectors**

  **What to do**:
  - Create `src/lib/fix-router.ts` with:
    - `routeContribution(opportunity: ContributionOpportunity): FixResult` — main router function
    - Routes by `ContributionType`:
      - `typo` → Mechanical: regex-based find-and-replace using word list from detector
      - `docs` → Mechanical: template-based section generation (README sections, badges)
      - `deps` → Mechanical: version bump in package.json/requirements.txt (npm/pip registry lookup)
      - `test` → AI-assisted: generate test file skeleton via LLM (Anthropic/OpenAI based on config)
      - `code` → AI-assisted: generate fix patch via LLM with issue context
    - Each route returns `FixResult { patch: string, description: string, confidence: number }`
  - Create `src/lib/detectors/typo-detector.ts` — regex word list (100+ common misspellings), scans .md/.txt/.rst files
  - Create `src/lib/detectors/docs-detector.ts` — checks README structure against template (headings, badges, license)
  - Create `src/lib/detectors/deps-detector.ts` — parses package.json, compares versions to npm registry
  - Write tests FIRST: test each detector independently, test router dispatches correctly per type

  **Must NOT do**:
  - Call AI APIs for typo/docs/deps paths (deterministic only)
  - Modify files outside the target repo's working copy
  - Auto-commit fixes (just generate patches)

  **Recommended Agent Profile**:
  - **Subagent Type**: `deep`
  - **Skills**: [`test-driven-development`]

  **Parallelization**:
  - **Can Run In Parallel**: YES (within Wave 2)
  - **Parallel Group**: Wave 2 (with T2, T4, T12)
  - **Blocks**: T9, T10
  - **Blocked By**: T0 (types), T3 (guardrails)

  **References**:
  - `src/commands/fix.ts` — Current fix command to rewrite. Key: how it invokes AI providers
  - `src/lib/ai.ts` — AI provider abstraction (Anthropic/OpenAI). Reuse for test/code paths
  - `src/types/index.ts` — `ContributionOpportunity`, `ContributionType`, `FixResult` from T0
  - `src/lib/contribution-detector.ts` — Detector outputs consumed by router (from T4)

  **Acceptance Criteria**:
  - [ ] `bun test tests/fix-router.test.ts` → PASS
  - [ ] `bun test tests/detectors/typo-detector.test.ts` → PASS
  - [ ] `bun test tests/detectors/docs-detector.test.ts` → PASS
  - [ ] `bun test tests/detectors/deps-detector.test.ts` → PASS
  - [ ] Typo route produces correct patch for "teh" → "the"
  - [ ] Docs route generates missing README section
  - [ ] Deps route bumps outdated version string
  - [ ] Code/test routes call AI provider (mocked in tests)

  **QA Scenarios**:
  ```
  Scenario: Typo fix router produces correct patch
    Tool: Bash
    Steps:
      1. Create ContributionOpportunity with type="typo", file="README.md", match="teh"
      2. Call routeContribution(opportunity)
      3. Assert result.patch contains s/teh/the/ equivalent
      4. Assert result.confidence > 0.9
    Expected Result: Deterministic typo patch generated without AI
    Evidence: .sisyphus/evidence/task-6-typo-fix.txt

  Scenario: Router dispatches code type to AI
    Tool: Bash
    Steps:
      1. Create ContributionOpportunity with type="code", issueUrl="..."
      2. Mock AI provider
      3. Call routeContribution(opportunity)
      4. Assert AI provider was called with issue context
    Expected Result: Code fixes routed to AI, not mechanical path
    Evidence: .sisyphus/evidence/task-6-ai-routing.txt
  ```

  **Commit**: YES
  - Message: `feat(fix): add fix router with AI-free detectors`
  - Files: `src/lib/fix-router.ts`, `src/lib/detectors/typo-detector.ts`, `src/lib/detectors/docs-detector.ts`, `src/lib/detectors/deps-detector.ts`, `tests/fix-router.test.ts`, `tests/detectors/*.test.ts`
  - Pre-commit: `bun test tests/fix-router.test.ts`

- [ ] 7. **CONTRIBUTING.md Compliance Checker**

  **What to do**:
  - Create `src/lib/contributing-checker.ts` with:
    - `checkContributingCompliance(repoPath: string): ComplianceResult` — main entry
    - Parse CONTRIBUTING.md (if exists) for:
      - CLA requirement detection (regex: "Contributor License Agreement", "CLA", "sign the")
      - Issue-first requirement ("open an issue first", "discuss before PR")
      - PR template requirements (`.github/PULL_REQUEST_TEMPLATE.md` existence)
      - Branch naming conventions (regex extraction from contributing guide)
      - Test requirements ("include tests", "all tests must pass")
    - Return `ComplianceResult { hasCLA: boolean, requiresIssueFirst: boolean, hasPRTemplate: boolean, branchConvention: string | null, requiresTests: boolean, rawRules: string[] }`
  - If no CONTRIBUTING.md exists, return permissive defaults (all false)
  - Write tests FIRST: test with sample CONTRIBUTING.md files, test missing file case, test CLA detection

  **Must NOT do**:
  - Use AI to parse CONTRIBUTING.md (regex/string matching only)
  - Block contributions for repos without CONTRIBUTING.md
  - Auto-sign CLAs or agree to terms

  **Recommended Agent Profile**:
  - **Subagent Type**: `deep`
  - **Skills**: [`test-driven-development`]

  **Parallelization**:
  - **Can Run In Parallel**: YES (within Wave 3)
  - **Parallel Group**: Wave 3 (with T8, T9, T10)
  - **Blocks**: T9 (submit needs compliance check)
  - **Blocked By**: T0 (types)

  **References**:
  - `src/types/index.ts` — `ComplianceResult` type from T0
  - Popular CONTRIBUTING.md examples: facebook/react, microsoft/vscode, vercel/next.js (patterns to detect)

  **Acceptance Criteria**:
  - [ ] `bun test tests/contributing-checker.test.ts` → PASS
  - [ ] Detects CLA requirement in sample with "Contributor License Agreement"
  - [ ] Detects issue-first requirement in sample with "please open an issue"
  - [ ] Returns permissive defaults when CONTRIBUTING.md missing
  - [ ] Finds PR template when `.github/PULL_REQUEST_TEMPLATE.md` exists

  **QA Scenarios**:
  ```
  Scenario: Detects CLA requirement
    Tool: Bash
    Steps:
      1. Create temp directory with CONTRIBUTING.md containing "You must sign our Contributor License Agreement"
      2. Call checkContributingCompliance(tempDir)
      3. Assert result.hasCLA === true
    Expected Result: CLA detected via regex matching
    Evidence: .sisyphus/evidence/task-7-cla-detection.txt

  Scenario: Missing CONTRIBUTING.md returns permissive defaults
    Tool: Bash
    Steps:
      1. Create temp directory with no CONTRIBUTING.md
      2. Call checkContributingCompliance(tempDir)
      3. Assert result.hasCLA === false, result.requiresIssueFirst === false
    Expected Result: No CONTRIBUTING.md = permissive (don't block)
    Evidence: .sisyphus/evidence/task-7-missing-contributing.txt
  ```

  **Commit**: YES
  - Message: `feat(compliance): add CONTRIBUTING.md checker`
  - Files: `src/lib/contributing-checker.ts`, `tests/contributing-checker.test.ts`
  - Pre-commit: `bun test tests/contributing-checker.test.ts`

- [ ] 8. **Update Review Command for Multi-Type Contributions**

  **What to do**:
  - Update `src/commands/review.ts` to:
    1. Display contributions grouped by type (typo, docs, deps, test, code)
    2. Show merge probability score and factor breakdown for each opportunity
    3. Add `--type <type>` filter flag to show only specific contribution types
    4. Show compliance warnings from CONTRIBUTING.md checker (CLA needed, issue-first required)
    5. Color-code by merge probability: green (>0.7), yellow (0.4-0.7), red (<0.4)
    6. Add summary stats: count per type, average merge probability, top recommendation
  - Write tests FIRST: test grouped display, test --type filter, test color thresholds

  **Must NOT do**:
  - Auto-approve or auto-reject contributions (review is informational only)
  - Modify pipeline state (read-only command)

  **Recommended Agent Profile**:
  - **Subagent Type**: `deep`
  - **Skills**: [`test-driven-development`]

  **Parallelization**:
  - **Can Run In Parallel**: YES (within Wave 3)
  - **Parallel Group**: Wave 3 (with T7, T9, T10)
  - **Blocks**: None
  - **Blocked By**: T4 (analyze provides opportunities), T6 (fix provides patches)

  **References**:
  - `src/commands/review.ts` — Current review command to update
  - `src/lib/state.ts` — Pipeline state reading pattern
  - `src/types/index.ts` — `ContributionOpportunity`, `MergeProbability` types from T0

  **Acceptance Criteria**:
  - [ ] `bun test tests/review.test.ts` → PASS
  - [ ] Contributions displayed grouped by type
  - [ ] `--type typo` filter shows only typo contributions
  - [ ] Merge probability shown with color coding
  - [ ] Compliance warnings displayed when CLA/issue-first detected

  **QA Scenarios**:
  ```
  Scenario: Review displays grouped contributions
    Tool: interactive_bash (tmux)
    Steps:
      1. Set up pipeline state with 3 contributions: 1 typo, 1 docs, 1 code
      2. Run `bun run src/index.ts review`
      3. Assert output contains "Typo (1)", "Docs (1)", "Code (1)" section headers
    Expected Result: Contributions grouped by type with counts
    Evidence: .sisyphus/evidence/task-8-grouped-display.txt

  Scenario: Type filter works
    Tool: interactive_bash (tmux)
    Steps:
      1. Set up pipeline state with mixed contribution types
      2. Run `bun run src/index.ts review --type typo`
      3. Assert output contains ONLY typo contributions
      4. Assert output does NOT contain "Docs" or "Code" sections
    Expected Result: Filter restricts display to specified type
    Evidence: .sisyphus/evidence/task-8-type-filter.txt
  ```

  **Commit**: YES
  - Message: `feat(review): update review for multi-type contributions`
  - Files: `src/commands/review.ts`, `tests/review.test.ts`
  - Pre-commit: `bun test tests/review.test.ts`

- [ ] 9. **Update Submit Command with Guardrail Checks**

  **What to do**:
  - Update `src/commands/submit.ts` to:
    1. Run ALL guardrail checks before submission: `checkRateLimit()`, `checkDuplicateContribution()`, `checkRepoEligibility()`, `checkContributingCompliance()`
    2. If any guardrail blocks → abort with clear message explaining why
    3. If CONTRIBUTING.md requires CLA → warn user and abort (they must sign manually)
    4. If CONTRIBUTING.md requires issue first → warn but allow override with `--skip-issue-check`
    5. Generate type-specific PR body templates:
       - **Typo**: "Fix typo: `{original}` → `{replacement}` in `{file}`"
       - **Docs**: "Add missing `{section}` section to README"
       - **Deps**: "Bump `{package}` from `{old}` to `{new}`"
       - **Test/Code**: Use AI-generated description (existing pattern)
    6. Record submission in contribution history via `saveContribution()`
    7. Support `--dry-run` flag to preview PR without submitting
  - Write tests FIRST: test guardrail blocking, test PR body generation per type, test dry-run mode, test history recording

  **Must NOT do**:
  - Auto-submit without user reviewing first (manual approval required)
  - Bypass CLA requirements
  - Submit to archived repos (guardrails should catch this earlier, but double-check)

  **Recommended Agent Profile**:
  - **Subagent Type**: `deep`
  - **Skills**: [`test-driven-development`]

  **Parallelization**:
  - **Can Run In Parallel**: YES (within Wave 3)
  - **Parallel Group**: Wave 3 (with T7, T8, T10)
  - **Blocks**: T10
  - **Blocked By**: T0 (types), T3 (guardrails), T5 (history), T7 (CONTRIBUTING.md compliance)

  **References**:
  - `src/commands/submit.ts` — Current submit implementation. Key: PR creation via `gh pr create`, branch/fork workflow
  - `src/lib/guardrails.ts` — Created in T3, extended in T7. All check functions to call pre-submit
  - `src/lib/history.ts` — Created in T5. `saveContribution()` to record PR submission
  - `src/lib/github.ts` — `createPR()` or `gh pr create` wrapper
  - `src/types/index.ts` — `ContributionOpportunity`, `GuardrailCheck` types from T0

  **Acceptance Criteria**:
  - [ ] `tests/submit.test.ts` → PASS
  - [ ] Guardrail block prevents submission with clear error message
  - [ ] Each contribution type generates appropriate PR body
  - [ ] `--dry-run` shows PR preview without submitting
  - [ ] Submission recorded in history

  **QA Scenarios**:
  ```
  Scenario: Guardrail blocks excess submissions
    Tool: Bash
    Steps:
      1. Set up rate-limits.json to simulate 3 PRs in last hour
      2. Run: bun run src/index.ts submit --dry-run 2>&1
      3. Assert output contains "rate limit" or "blocked"
      4. Assert exit code is non-zero
    Expected Result: Submission blocked with clear rate limit message
    Evidence: .sisyphus/evidence/task-9-guardrail-block.txt

  Scenario: Typo PR body generated correctly
    Tool: Bash
    Steps:
      1. Set up pipeline state with a typo contribution (original="teh", replacement="the", file="README.md")
      2. Run: bun run src/index.ts submit --dry-run 2>&1
      3. Assert PR body contains "Fix typo" and "teh" → "the"
    Expected Result: Type-specific PR body for typo fix
    Evidence: .sisyphus/evidence/task-9-typo-pr-body.txt
  ```

  **Commit**: YES
  - Message: `feat(submit): update submit with guardrail checks`
  - Files: `src/commands/submit.ts`, `tests/submit.test.ts`
  - Pre-commit: `bun test tests/submit.test.ts`

- [ ] 10. **Update Run Orchestrator for V2 Pipeline**

  **What to do**:
  - Update `src/commands/run.ts` to:
    1. Execute full V2 pipeline: discover → analyze → fix → review → submit
    2. Pass V2 types through entire pipeline (TrendingRepo, ContributionOpportunity, etc.)
    3. Add `--dry-run` flag: run discover + analyze but skip fix/review/submit
    4. Add `--stats` flag: show contribution history stats before running
    5. Add `--type` filter: `gittributor run --type=typo` to only process typo contributions
    6. Integrate guardrails at appropriate pipeline stages (pre-analyze eligibility check, pre-submit rate limit)
    7. Display pipeline progress with stage indicators
  - Write tests FIRST: test pipeline stage execution order, test --dry-run stops early, test --type filtering

  **Must NOT do**:
  - Remove existing `run` command interface (keep backward compat where possible)
  - Add parallel repo processing (sequential for V2 — simplicity over speed)
  - Auto-loop (one run = one pass through the pipeline)

  **Recommended Agent Profile**:
  - **Subagent Type**: `deep`
  - **Skills**: [`test-driven-development`]

  **Parallelization**:
  - **Can Run In Parallel**: NO (depends on all other pipeline tasks)
  - **Parallel Group**: Wave 3 (last task, after T7, T8, T9 complete)
  - **Blocks**: F1-F4
  - **Blocked By**: T2, T4, T6, T8, T9

  **References**:
  - `src/commands/run.ts` — Current run orchestrator. Key: pipeline stage execution, state passing between stages
  - `src/commands/discover.ts` — Rewritten in T2, returns TrendingRepo[]
  - `src/commands/analyze.ts` — Rewritten in T4, returns ContributionOpportunity[]
  - `src/lib/fix-router.ts` — Created in T6, routes to appropriate fix strategy
  - `src/commands/review.ts` — Updated in T8, multi-type review
  - `src/commands/submit.ts` — Updated in T9, guardrail-checked submission
  - `src/lib/state.ts` — State persistence between pipeline stages

  **Acceptance Criteria**:
  - [ ] `tests/run.test.ts` → PASS
  - [ ] `bun run src/index.ts run --dry-run` executes discover + analyze, skips fix/review/submit
  - [ ] `bun run src/index.ts run --type=typo` filters to only typo contributions
  - [ ] `bun run src/index.ts run --stats` shows history stats
  - [ ] Pipeline executes stages in correct order

  **QA Scenarios**:
  ```
  Scenario: Dry run executes discover and analyze only
    Tool: interactive_bash (tmux)
    Steps:
      1. Run: bun run src/index.ts run --dry-run 2>&1
      2. Assert output shows "Discovering repos..." stage
      3. Assert output shows "Analyzing contributions..." stage
      4. Assert output does NOT show "Submitting..." stage
      5. Assert output contains summary of found opportunities
    Expected Result: Pipeline stops after analyze in dry-run mode
    Evidence: .sisyphus/evidence/task-10-dry-run.txt

  Scenario: Type filter restricts contributions
    Tool: interactive_bash (tmux)
    Steps:
      1. Run: bun run src/index.ts run --type=typo --dry-run 2>&1
      2. Assert output only shows typo-type contributions
      3. Assert no code/deps/docs/test contributions in output
    Expected Result: Only typo contributions processed
    Evidence: .sisyphus/evidence/task-10-type-filter.txt
  ```

  **Commit**: YES
  - Message: `feat(run): update orchestrator for V2 pipeline`
  - Files: `src/commands/run.ts`, `tests/run.test.ts`
  - Pre-commit: `bun test tests/run.test.ts`

- [ ] 11. **Fix Existing Failing Tests**

  **What to do**:
  - Run `bun test` to identify all currently failing tests
  - Fix each failing test — root cause analysis before fixing (don't just delete tests)
  - Known failing tests from V1 (2 failures): investigate and fix
  - Ensure ALL existing tests pass before V2 work begins (clean baseline)
  - Document what was failing and why in commit message

  **Must NOT do**:
  - Delete failing tests to make suite pass (fix the root cause)
  - Modify test assertions to match broken behavior (fix the code, not the test)
  - Add new tests here (that's each task's TDD responsibility)

  **Recommended Agent Profile**:
  - **Subagent Type**: `deep`
  - **Skills**: [`systematic-debugging`, `test-driven-development`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with T0, T1, T3, T5)
  - **Blocks**: None (housekeeping — gives clean baseline)
  - **Blocked By**: None (can start immediately)

  **References**:
  - `tests/` — All existing test files
  - `package.json` — Test script configuration
  - `src/` — Source files that tests exercise

  **Acceptance Criteria**:
  - [ ] `bun test` → ALL PASS (0 failures)
  - [ ] No tests deleted
  - [ ] Commit message documents what was fixed and why

  **QA Scenarios**:
  ```
  Scenario: All existing tests pass
    Tool: Bash
    Steps:
      1. Run: bun test 2>&1
      2. Assert exit code 0
      3. Assert output shows 0 failures
      4. Count total tests — assert > 0 (tests exist)
    Expected Result: Clean test baseline with 0 failures
    Evidence: .sisyphus/evidence/task-11-all-tests-pass.txt

  Scenario: No tests were deleted
    Tool: Bash
    Steps:
      1. Run: git diff --stat HEAD tests/
      2. Assert no test files show "deleted" status
      3. Only modifications or additions allowed
    Expected Result: Same or more test files than before
    Evidence: .sisyphus/evidence/task-11-no-tests-deleted.txt
  ```

  **Commit**: YES
  - Message: `fix(tests): fix existing failing tests`
  - Files: `tests/`, affected source files
  - Pre-commit: `bun test`

- [ ] 12. **V2 Config Schema**

  **What to do**:
  - Update `src/lib/config.ts` to:
    1. Add V2 config fields with defaults:
       - `repoListPath: string` (default: `"repos.yaml"`)
       - `maxPRsPerWeekPerRepo: number` (default: `2`)
       - `maxPRsPerHour: number` (default: `3`)
       - `contributionTypes: ContributionType[]` (default: `["docs", "typo", "deps", "test", "code"]`)
       - `historyPath: string` (default: `".gittributor/history.json"`)
       - `dryRun: boolean` (default: `false`)
    2. Merge strategy: V1 fields preserved, V2 fields added with defaults if missing
    3. Support project-local config (`.gittributorrc.json` in project root) overriding global (`~/.gittributorrc.json`)
    4. Validate config on load — warn on unknown fields, error on invalid types
  - Write tests FIRST: test default config, test V1 backward compat, test project-local override, test validation

  **Must NOT do**:
  - Break V1 config loading (backward compat is mandatory)
  - Use environment variables for config (JSON file only — keep it simple)
  - Add config migration logic (just merge defaults)

  **Recommended Agent Profile**:
  - **Subagent Type**: `deep`
  - **Skills**: [`test-driven-development`]

  **Parallelization**:
  - **Can Run In Parallel**: YES (within Wave 2)
  - **Parallel Group**: Wave 2 (with T2, T4, T6)
  - **Blocks**: None (config is read lazily by other modules)
  - **Blocked By**: T0 (types)

  **References**:
  - `src/lib/config.ts` — Current config loading. Key: `loadConfig()` function, `~/.gittributorrc.json` path
  - `src/types/index.ts` — `Config` interface (lines 96-108) — V2 fields added in T0

  **Acceptance Criteria**:
  - [ ] `tests/config.test.ts` → PASS
  - [ ] Default config has all V2 fields with sensible values
  - [ ] V1 config file loads without errors (backward compat)
  - [ ] Project-local config overrides global config

  **QA Scenarios**:
  ```
  Scenario: Default config has V2 fields
    Tool: Bash
    Steps:
      1. Delete any existing config files
      2. Call loadConfig()
      3. Assert result.repoListPath === "repos.yaml"
      4. Assert result.maxPRsPerWeekPerRepo === 2
      5. Assert result.maxPRsPerHour === 3
    Expected Result: All V2 defaults present
    Evidence: .sisyphus/evidence/task-12-default-config.txt

  Scenario: V1 config backward compatible
    Tool: Bash
    Steps:
      1. Create config with only V1 fields: { "minStars": 50, "verbose": true }
      2. Call loadConfig()
      3. Assert no errors thrown
      4. Assert result.minStars === 50
      5. Assert result.maxPRsPerWeekPerRepo === 2 (V2 default)
    Expected Result: V1 fields preserved, V2 defaults applied
    Evidence: .sisyphus/evidence/task-12-v1-compat.txt
  ```

  **Commit**: YES
  - Message: `feat(config): add V2 config schema`
  - Files: `src/lib/config.ts`, `tests/config.test.ts`
  - Pre-commit: `bun test tests/config.test.ts`

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, run command). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Run `bun test`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names (data/result/item/temp).
  Output: `Build [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Real CLI QA** — `unspecified-high`
  Start from clean state. Run `bun run src/index.ts discover` — verify trending repos returned. Run `bun run src/index.ts analyze` — verify multi-type contributions scored. Test guardrails: attempt to exceed rate limits, verify blocking. Test with archived repo in list — verify skip. Save evidence to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff (git log/diff). Verify 1:1 — everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance. Detect cross-task contamination.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

Each task gets its own atomic commit:
- **T0**: `feat(types): add V2 type system for multi-type contributions` — `src/types/index.ts`
- **T1**: `feat(discover): add curated repo YAML list and loader` — `repos.yaml`, `src/lib/repo-list.ts`
- **T2**: `feat(discover): rewrite discover for trending repos` — `src/commands/discover.ts`
- **T3**: `feat(guardrails): add anti-spam and rate limiting` — `src/lib/guardrails.ts`
- **T4**: `feat(analyze): rewrite analyze for multi-type contributions` — `src/commands/analyze.ts`
- **T5**: `feat(history): add PR outcome tracking` — `src/lib/history.ts`
- **T6**: `feat(fix): add fix router with AI-free paths` — `src/lib/fix-router.ts`, `src/lib/contribution-detector.ts`
- **T7**: `feat(guardrails): add CONTRIBUTING.md compliance checker` — `src/lib/guardrails.ts`
- **T8**: `feat(review): update review for multi-type contributions` — `src/commands/review.ts`
- **T9**: `feat(submit): update submit with guardrail checks` — `src/commands/submit.ts`
- **T10**: `feat(run): update orchestrator for V2 pipeline` — `src/commands/run.ts`
- **T11**: `fix(tests): fix existing failing tests` — `tests/`
- **T12**: `feat(config): add V2 config schema` — `src/lib/config.ts`
- Pre-commit for all: `bun test`

---

## Success Criteria

### Verification Commands
```bash
bun test                                    # Expected: all pass, 0 failures
bun run src/index.ts discover --dry-run     # Expected: lists trending repos from curated YAML
bun run src/index.ts analyze --dry-run      # Expected: shows multi-type contribution opportunities
```

### Final Checklist
- [ ] Trending/famous repos discovered (not just new repos)
- [ ] All 5 contribution types detected and scored
- [ ] Anti-spam guardrails enforce rate limits
- [ ] CONTRIBUTING.md checked before PR submission
- [ ] PR history persisted and queryable
- [ ] All tests pass with TDD coverage
- [ ] No `as any`, `@ts-ignore`, or generic variable names in new code
- [ ] No web UI, GitHub Actions, or auto-submit without review

# Gittributor Analyze Phase Redesign

## TL;DR

> **Quick Summary**: Replace gittributor's trivial detectors (typos, docs, deps) with a research-backed 2-phase analysis pipeline: Phase 1 scans ALL files with lightweight static patterns (seconds), Phase 2 deep-analyzes candidates with LLM (minutes). Uses hybrid approach: GitHub issues + AI code review + static analysis. Backed by industry practices from Google Tricorder (<10% FP), Meta Infer (diff-only), and CodeReduce (19%→82% fix rate). The core discovery: `analyzer.ts` + `fix-generator.ts` already implement the AI review but are disconnected from the main pipeline.
> 
> **Deliverables**:
> - Rewired pipeline: `run.ts` → `analyzer.ts` → `fix-generator.ts` (replacing old `analyze.ts` → `fix-router.ts`)
> - 2-phase analysis: Phase 1 lightweight sweep (all files) → Phase 2 deep AI analysis (candidates only)
> - Enhanced issue-based discovery with research-backed scoring (Security CVE > NPE > resource leak > type error)
> - Static analysis module for TS/JS + Python repos (NPE/null as top priority per Uber NullAway data)
> - Dynamic repo discovery (1k-10k★ mid-size repos via GitHub API)
> - PR presentation optimized for merge: ≤5 files, ≤200 LOC, one fix per PR, include regression test
> - Type system updates bridging `Repository` ↔ `TrendingRepo`
> - Old detector cleanup (remove typo/docs/deps/test detectors)
> - Bug fixes: `calculateMergeProbability` crash, silent error swallowing
> - Tests (after implementation) using bun:test
> 
> **Estimated Effort**: Large
> **Parallel Execution**: YES - 4 waves
> **Critical Path**: Task 1 (types) → Task 4 (pipeline rewire) → Task 8 (integration test) → Task 10 (e2e verification)

---

## Context

### Original Request
User's exact words: "코드베이스를 직접 분석하고 임팩트가 있는것을 고쳐야되는거 아니야?" — analyze actual source code and fix things with real engineering impact. The current 5 detectors (typos, docs, deps, tests, code) produce either zero results or trivially low-impact suggestions that no maintainer would merge.

### Interview Summary
**Key Discussions**:
- Analysis approach: **Hybrid** (Issue-based + AI code review + Static analysis) — user explicitly excluded "abandoned PR pickup"
- Repo targeting: **Dynamic search** via GitHub API for 1k-10k★ mid-size repos, replacing hardcoded `repos.yaml`
- Test strategy: **Tests after** implementation, using existing bun:test infrastructure (14/14 passing)
- User rejected ALL current detectors AND even "broken links in docs" / "deprecated API docs" as too trivial

**Research Findings**:
- **Critical discovery**: Two parallel pipelines exist in the codebase
  - OLD (active in `run.ts`): `analyze.ts` → 5 detectors → `ContributionOpportunity[]` → `fix-router.ts`
  - NEW (unused): `analyzer.ts` → AI analysis → `AnalysisResult` → `fix-generator.ts`
- The NEW pipeline already does what the user wants but is completely disconnected from `run.ts`
- `analyzer.ts` has full implementation: shallow clone, file ranking, LLM analysis, JSON parsing
- `fix-generator.ts` validates fixes against `analysis.relevantFiles` — new analyzers MUST satisfy this contract
- Existing `discoverIssues()` in `analyze.ts:201-240` is partially reusable for issue-based discovery
- `GitHubClient.searchRepositories()` already supports dynamic repo search by stars/language
- **Industry Best Practices** (from research):
  - Google Tricorder: ≤10% false positive threshold, show findings only on changed lines, ~70% fix rate for high-confidence
  - Meta Infer: diff-time analysis only (not full repo), cap ~5 warnings per diff, cached procedure summaries
  - Microsoft CodeQL + Copilot Autofix: LLM generates fix patches, "majority committable without edits"
  - Uber NullAway: compile-time NPE detection, 10x NPE reduction — NPE/null is #1 priority bug type
  - **Universal rule**: High confidence + changed lines only + one finding per root cause. >10 warnings = developers ignore all.
- **Academic Research**:
  - LLM+Static hybrid eliminates 94-98% of false positives (Tencent study, arXiv:2601.18844)
  - CodeReduce pattern (Snyk/DeepCode): Extract minimal code slice for LLM, not whole file — fix rate 19% → 82%
- **PR Acceptance Research**:
  - Compatibility score <80% = 30% merge rate, >95% = 84% merge rate
  - Optimal: ≤200-400 LOC per review, ≤60-90 min review sessions
  - Bug type priority: Security CVE > NPE/null > resource leak > type error > logic error
  - PR anatomy for merge: ≤5 files, ≤200 LOC, one fix per PR, CI must pass
  - Bot PR acceptance collapsed: 62% peak (2022) → 15.5% (2025) — quality over quantity mandatory
- **2-Phase Analysis Architecture** (decided):
  - Phase 1: Lightweight sweep ALL files (regex patterns, heuristics, file-level risk scoring) — seconds
  - Phase 2: Deep AI analysis on candidate files only (LLM path feasibility, CodeReduce minimal context) — minutes

### Metis Review
**Identified Gaps** (addressed):
- Every analyzer must produce `AnalysisResult` with `relevantFiles` — enforced by `fix-generator.ts:validateFixScope()`
- Validate `relevantFiles` against actual repo file tree via `getFileTree()`
- Reuse `src/lib/ai.ts` for all LLM calls (max 3 per repo)
- Never run `npm install` in cloned repos (security guardrail)
- Follow existing `GITTRIBUTOR_*` env var pattern for new config
- TS/JS + Python only for static analysis scope
- Base codebase: main repo `/Users/jnnj92/gittributor/` (not worktree)

---

## Work Objectives

### Core Objective
Replace gittributor's analyze phase so it finds and fixes real code-level issues (bugs, performance problems, type errors, logic issues) instead of trivial cosmetic changes, by wiring the existing but unused `analyzer.ts` + `fix-generator.ts` into the main pipeline and adding issue-based + static analysis capabilities.

### Concrete Deliverables
- Updated `src/types/index.ts` with extended types and bridge interfaces
- Updated `src/commands/run.ts` wired to new pipeline
- Enhanced `src/lib/analyzer.ts` with static analysis support
- New `src/lib/static-analyzer.ts` for TS/JS + Python linting
- Updated `src/commands/discover.ts` or equivalent with dynamic repo search
- Removed old detectors (`src/lib/detectors/`) and `fix-router.ts`
- Updated config with new `GITTRIBUTOR_*` env vars
- bun:test tests for new modules

### Definition of Done
- [ ] `bun run start` discovers repos dynamically, finds issues, analyzes code, generates fixes
- [ ] Pipeline produces `AnalysisResult` objects (not `ContributionOpportunity`)
- [ ] Old detectors removed, no references remain
- [ ] `bun test` passes with new tests covering analyzers
- [ ] No `calculateMergeProbability` crash, no silent error swallowing

### Must Have
- All analyzers output `AnalysisResult` compatible with `fix-generator.ts`
- `relevantFiles` validated against repo file tree
- Max 3 LLM calls per repo (token budget)
- Dynamic repo discovery (1k-10k★)
- Issue-based analysis (good-first-issue, bug labels)
- AI code review analysis (existing `analyzer.ts`)
- Error propagation (no silent swallowing)

### Must NOT Have (Guardrails)
- No typo/docs/README/dependency-only detectors
- No `npm install` or `pip install` in cloned repos
- No hardcoded mega-repo lists as primary discovery
- No `ContributionOpportunity` type in new pipeline
- No `fix-router.ts` usage in new pipeline
- No `as any` or `@ts-ignore` in new code
- No empty catch blocks
- Never modify git config (author must remain "Junhyuk Lee <xodn348@naver.com>")

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: YES (bun:test, 14/14 passing)
- **Automated tests**: Tests-after
- **Framework**: bun:test (`describe/it/expect`)

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **CLI**: Use Bash — run `bun run` commands, validate stdout/stderr, check exit codes
- **Library/Module**: Use Bash (bun REPL or test runner) — import, call functions, compare output
- **Integration**: Run full pipeline with mock/real GitHub data, verify `AnalysisResult` output

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Foundation — types, config, bridge interfaces):
├── Task 1: Type system updates (extend ContributionType, bridge types) [quick]
├── Task 2: Config updates (new GITTRIBUTOR_* env vars) [quick]
├── Task 3: Dynamic repo discovery module [deep]

Wave 2 (Core modules — analyzers, can all run in parallel):
├── Task 4: Wire analyzer.ts into run.ts pipeline [deep]
├── Task 5: Enhanced issue discovery + scoring [deep]
├── Task 6: Static analysis module (TS/JS + Python) [deep]

Wave 3 (Cleanup + integration):
├── Task 7: Remove old detectors + fix-router + dead code [quick]
├── Task 8: Fix existing bugs (calculateMergeProbability, silent catches) [quick]
├── Task 9: Error handling + logging improvements [quick]

Wave 4 (Tests + verification):
├── Task 10: Fix Generator Integration (depends: 4) [deep]
├── Task 11: PR Submission + Review Pipeline (depends: 5, 6) [deep]
├── Task 12: End-to-end pipeline integration test (depends: 7-11) [deep]

Wave FINAL (4 parallel reviews, then user okay):
├── F1: Plan compliance audit (oracle)
├── F2: Code quality review (unspecified-high)
├── F3: Real manual QA (unspecified-high)
└── F4: Scope fidelity check (deep)
→ Present results → Get explicit user okay
```

### Dependency Matrix

| Task | Blocked By | Blocks |
|------|-----------|--------|
| 1 | None | 3, 4, 5, 6, 7, 10, 11 |
| 2 | None | 3, 4, 5, 6 |
| 3 | 1, 2 | 4, 12 |
| 4 | 1, 2, 3 | 7, 8, 9, 12 |
| 5 | 1, 2 | 4, 11, 12 |
| 6 | 1, 2 | 4, 11, 12 |
| 7 | 4 | 12 |
| 8 | 4 | 12 |
| 9 | 4 | 12 |
| 10 | 4 | 12 |
| 11 | 5, 6 | 12 |
| 12 | 7, 8, 9, 10, 11 | F1-F4 |

### Agent Dispatch Summary

- **Wave 1 (3 tasks)**: T1 → `quick`, T2 → `quick`, T3 → `deep`
- **Wave 2 (3 tasks)**: T4 → `deep`, T5 → `deep`, T6 → `deep`
- **Wave 3 (3 tasks)**: T7 → `quick`, T8 → `quick`, T9 → `quick`
- **Wave 4 (3 tasks)**: T10 → `deep`, T11 → `deep`, T12 → `deep`
- **FINAL (4 tasks)**: F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep`

---

## TODOs

- [x] 1. Type System Updates — Extend types and bridge `Repository` ↔ `TrendingRepo`

  **What to do**:
  - Extend `ContributionType` in `src/types/index.ts:132` to add new types: `"bug-fix" | "performance" | "type-safety" | "logic-error" | "static-analysis"`
  - Create a `toTrendingRepo(repo: Repository): TrendingRepo` bridge function so dynamic discovery results can flow into the existing pipeline
  - Create a `toRepository(repo: TrendingRepo): Repository` reverse bridge
  - Add `StaticAnalysisResult` interface extending core analysis fields
  - Update `ContributionHistory` type to support new `ContributionType` values
  - Ensure `AnalysisResult` (line 31-42) remains the canonical analysis output type — do NOT create alternatives

  **Must NOT do**:
  - Do not remove existing types that other modules depend on yet (removal is Task 7)
  - Do not modify `ContributionOpportunity` — it will be removed entirely in Task 7

  **Recommended Agent Profile**:
  - **Subagent**: `quick`
    - Reason: Type definitions only, single file, well-scoped
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3)
  - **Blocks**: Tasks 3, 4, 5, 6, 7, 10, 11
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `src/types/index.ts:31-42` — `AnalysisResult` interface: the canonical output type all analyzers must produce. Note fields: `relevantFiles`, `suggestedApproach`, `confidence`, `rootCause?`, `affectedFiles?`, `complexity?`, `fileContents?`
  - `src/types/index.ts:132` — Current `ContributionType`: `"typo" | "docs" | "deps" | "test" | "code"` — extend this union
  - `src/types/index.ts:146-159` — `ContributionOpportunity` interface: OLD type, do NOT modify, will be removed in Task 7

  **API/Type References**:
  - `src/lib/github.ts:49-95` — `searchRepositories()` returns objects with shape `{fullName, description, stars, language, ...}` — the bridge function must convert this to `TrendingRepo`
  - `src/types/index.ts:60-80` — `TrendingRepo` interface: has `fullName, description, stars, language, hasContributing, ...`
  - `src/types/index.ts:82-97` — `Repository` interface (if different from TrendingRepo): check exact fields

  **WHY Each Reference Matters**:
  - `AnalysisResult` is the contract that `fix-generator.ts:validateFixScope()` enforces — every analyzer MUST output this
  - The `Repository` ↔ `TrendingRepo` gap blocks the entire pipeline: dynamic discovery produces one type, analyzer expects the other
  - `ContributionType` extension is needed so new analysis types are properly categorized in history/stats

  **Acceptance Criteria**:
  - [ ] `ContributionType` includes at least: `"bug-fix" | "performance" | "type-safety" | "logic-error" | "static-analysis"`
  - [ ] Bridge functions `toTrendingRepo()` and `toRepository()` exist and are exported
  - [ ] `bun test` still passes (existing 14 tests)

  **QA Scenarios**:

  ```
  Scenario: Type compilation check
    Tool: Bash
    Preconditions: Working gittributor repo at /Users/jnnj92/gittributor
    Steps:
      1. Run: bun build src/types/index.ts --no-bundle --outdir /tmp/type-check
      2. Verify exit code is 0
      3. Run: bun test
      4. Verify all 14 existing tests still pass
    Expected Result: Zero compilation errors, 14/14 tests pass
    Failure Indicators: Any TypeScript compilation error, any test failure
    Evidence: .sisyphus/evidence/task-1-type-compilation.txt

  Scenario: Bridge function type safety
    Tool: Bash
    Preconditions: Bridge functions exported from types module
    Steps:
      1. Create a small bun script that imports toTrendingRepo and toRepository
      2. Call toTrendingRepo with a mock Repository object
      3. Verify returned object has all TrendingRepo required fields
      4. Call toRepository with a mock TrendingRepo object
      5. Verify returned object has all Repository required fields
    Expected Result: Both conversions produce valid typed objects without runtime errors
    Failure Indicators: Missing fields, runtime TypeError, undefined values for required fields
    Evidence: .sisyphus/evidence/task-1-bridge-functions.txt
  ```

  **Commit**: YES
  - Message: `refactor(types): extend ContributionType and add Repository↔TrendingRepo bridge`
  - Files: `src/types/index.ts`
  - Pre-commit: `bun test`

- [x] 2. Config Updates — Add new `GITTRIBUTOR_*` environment variables

  **What to do**:
  - Add new env var support to config module for:
    - `GITTRIBUTOR_DISCOVERY_MIN_STARS` (default: 1000)
    - `GITTRIBUTOR_DISCOVERY_MAX_STARS` (default: 10000)
    - `GITTRIBUTOR_STATIC_ANALYSIS_ENABLED` (default: true)
    - `GITTRIBUTOR_ISSUE_LABELS` (default: "good first issue,bug,help wanted")
    - `GITTRIBUTOR_MAX_REPOS_PER_RUN` (default: 5)
  - Follow existing config pattern (check how `GITTRIBUTOR_ANALYZER_MAX_TOKENS`, `GITTRIBUTOR_FIX_MAX_TOKENS`, `GITTRIBUTOR_ANALYZER_MAX_FILES` are read)
  - Export config object or functions for other modules to import

  **Must NOT do**:
  - Do not hardcode values — always read from env with defaults
  - Do not create a new config file format — extend existing pattern

  **Recommended Agent Profile**:
  - **Subagent**: `quick`
    - Reason: Config-only change, follows existing patterns
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3)
  - **Blocks**: Tasks 3, 4, 5, 6
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `src/lib/analyzer.ts:10-15` — Existing config pattern: `const MAX_ANALYZED_FILES = Number(process.env.GITTRIBUTOR_ANALYZER_MAX_FILES) || 3` — follow this exact pattern
  - `src/lib/fix-generator.ts:1-10` — Check how `GITTRIBUTOR_FIX_MAX_TOKENS` is read

  **API/Type References**:
  - `src/lib/github.ts:49-95` — `searchRepositories()` params: `minStars`, `limit`, `languages` — config values feed into these

  **WHY Each Reference Matters**:
  - Must follow the exact `process.env.GITTRIBUTOR_*` pattern so all config is consistent
  - `searchRepositories()` is the consumer of star range config — must match its parameter types

  **Acceptance Criteria**:
  - [ ] All 5 new env vars are read with sensible defaults
  - [ ] Config values are exported and importable by other modules
  - [ ] `bun test` still passes

  **QA Scenarios**:

  ```
  Scenario: Default config values
    Tool: Bash
    Preconditions: No GITTRIBUTOR_DISCOVERY_* env vars set
    Steps:
      1. Run: bun -e "import config from './src/lib/config'; console.log(JSON.stringify(config))"
         (adjust import path based on actual export pattern)
      2. Verify DISCOVERY_MIN_STARS defaults to 1000
      3. Verify DISCOVERY_MAX_STARS defaults to 10000
      4. Verify STATIC_ANALYSIS_ENABLED defaults to true
      5. Verify MAX_REPOS_PER_RUN defaults to 5
    Expected Result: All defaults present and correct types (numbers, booleans)
    Failure Indicators: undefined values, wrong types, import errors
    Evidence: .sisyphus/evidence/task-2-default-config.txt

  Scenario: Custom config override
    Tool: Bash
    Preconditions: Set env vars before running
    Steps:
      1. Run: GITTRIBUTOR_DISCOVERY_MIN_STARS=500 GITTRIBUTOR_DISCOVERY_MAX_STARS=5000 bun -e "import config from './src/lib/config'; console.log(JSON.stringify(config))"
      2. Verify MIN_STARS is 500 and MAX_STARS is 5000
    Expected Result: Env vars override defaults
    Failure Indicators: Values still show defaults despite env vars being set
    Evidence: .sisyphus/evidence/task-2-custom-config.txt
  ```

  **Commit**: YES (groups with Task 1)
  - Message: `feat(config): add discovery and static analysis env vars`
  - Files: `src/lib/config.ts` (or wherever config lives)
  - Pre-commit: `bun test`

- [ ] 3. Dynamic Repo Discovery Module

  **What to do**:
  - Create or update the discover command to use `GitHubClient.searchRepositories()` for dynamic discovery
  - Search criteria: 1k-10k★ repos, filter by configured languages, recently active (pushed within 30 days)
  - Score repos by: star count, issue count, has CONTRIBUTING.md, recently active, language match
  - Replace or supplement the hardcoded `repos.yaml` approach
  - Use config values from Task 2 (star range, max repos per run)
  - Convert discovered repos to `TrendingRepo` using bridge from Task 1
  - Filter out repos where user already has open PRs (use `getRepoInfo()` which checks this)

  **Must NOT do**:
  - Do not delete `repos.yaml` entirely — keep as fallback/supplement
  - Do not search for mega-repos (100k+★) — they have too much review friction
  - Do not make more than 3 GitHub API calls for discovery per run

  **Recommended Agent Profile**:
  - **Subagent**: `deep`
    - Reason: Complex logic with scoring, API integration, and filtering
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2) — but depends on their outputs
  - **Blocks**: Tasks 4, 12
  - **Blocked By**: Tasks 1, 2

  **References**:

  **Pattern References**:
  - `src/commands/discover.ts` (or equivalent) — Current discovery logic, if it exists
  - `src/commands/analyze.ts:201-240` — `discoverIssues()`: existing issue scoring with `REPRODUCTION_PATTERNS`, `SMALL_SCOPE_PATTERNS`, `IMPACT_PATTERNS` — reuse these scoring patterns for repo quality scoring

  **API/Type References**:
  - `src/lib/github.ts:49-95` — `searchRepositories(options)`: already supports `minStars`, `languages`, `limit` — this is the primary API to use
  - `src/lib/github.ts:300-332` — `getRepoInfo()`: returns `hasOpenPR` flag — use to filter out repos where user already contributed
  - `src/types/index.ts` — `TrendingRepo` interface: the output type (use bridge from Task 1)

  **WHY Each Reference Matters**:
  - `searchRepositories()` already does 80% of what we need — don't rebuild
  - `discoverIssues()` scoring patterns are battle-tested heuristics for finding good contribution targets
  - `getRepoInfo().hasOpenPR` prevents duplicate contributions to the same repo

  **Acceptance Criteria**:
  - [ ] Discovery returns 3-5 repos per run (configurable)
  - [ ] All returned repos are 1k-10k★ range
  - [ ] Repos are scored and sorted by contribution-friendliness
  - [ ] Repos with existing user PRs are filtered out
  - [ ] Returns `TrendingRepo[]` compatible with pipeline

  **QA Scenarios**:

  ```
  Scenario: Dynamic discovery returns repos in star range
    Tool: Bash
    Preconditions: Valid GITHUB_TOKEN set, network available
    Steps:
      1. Run discovery module with default config (1k-10k★)
      2. Capture returned repo list
      3. For each repo, verify stars >= 1000 and stars <= 10000
      4. Verify at least 1 repo returned (assuming GitHub is accessible)
      5. Verify repos are sorted by score (highest first)
    Expected Result: 1-5 repos returned, all in star range, sorted by score
    Failure Indicators: Zero repos, repos outside star range, unsorted results
    Evidence: .sisyphus/evidence/task-3-dynamic-discovery.txt

  Scenario: Discovery with no GitHub token
    Tool: Bash
    Preconditions: GITHUB_TOKEN unset or empty
    Steps:
      1. Run discovery module without GitHub token
      2. Capture error output
    Expected Result: Clear error message about missing token, not a crash
    Failure Indicators: Unhandled exception, cryptic error, silent failure
    Evidence: .sisyphus/evidence/task-3-no-token-error.txt
  ```

  **Commit**: YES
  - Message: `feat(discover): add dynamic repo discovery via GitHub API`
  - Files: `src/commands/discover.ts` (or new file), `src/lib/github.ts` (if minor updates needed)
  - Pre-commit: `bun test`

- [ ] 4. Wire analyzer.ts into run.ts Pipeline + Analysis Enhancement

  **What to do**:
  - Replace the old pipeline in `run.ts`: instead of calling `analyzeSingleRepo()` → `fix-router.ts`, call `analyzeCodebase()` → `fix-generator.ts`
  - Update `RunDependencies` interface to inject `analyzeCodebase` and `generateFix` instead of old detector functions
  - Make `analyzeCodebase()` the central analysis entry point that orchestrates: issue-based analysis, AI code review, and static analysis
  - **2-Phase Analysis Architecture** (research-backed — CodeReduce 19%→82% fix rate, Tencent LLM+Static 94-98% FP elimination):
    - **Phase 1 (Lightweight Sweep — ALL files, seconds)**: Regex-based pattern scan across entire codebase. Detects: empty catches, `any` type, bare `except:`, mutable defaults, console.log in prod, NPE-risk patterns (unchecked `.` chains, missing null guards). Produces per-file risk scores. No LLM calls.
    - **Phase 2 (Deep AI Analysis — candidates only, minutes)**: Takes top-N candidate files from Phase 1. Uses CodeReduce pattern: extract minimal code slice (function + direct dependencies, not whole file) for LLM context. LLM validates if pattern is true positive, assesses fix feasibility, generates `AnalysisResult`. Eliminates false positives identified by Phase 1's regex.
    - **Transition threshold**: Phase 1 risk score > configurable threshold (default: 0.6) triggers Phase 2
    - **Budget**: Phase 2 limited to top 10 candidate files max, 3 LLM calls max per repo
  - **Free-form analysis mode**: Make the `issue` parameter optional in `analyzeCodebase(repo, issue?)`. When no issue is provided, run Phase 1 sweep → Phase 2 deep analysis pipeline instead of issue-specific analysis
  - Expand `PREFERRED_SOURCE_DIRS` beyond just `["src", "source", "lib"]` — also include root-level source files and common dirs like `app/`, `packages/`, `modules/`
  - Improve `rankSourceFiles()`: instead of alphabetical fallback, rank by Phase 1 risk score, then by file size (medium > tiny/huge), recency (git blame), and import centrality
  - Ensure pipeline produces `AnalysisResult` objects that satisfy `fix-generator.ts:validateFixScope()` contract
  - Convert `TrendingRepo` (from discovery) to the `Repository` shape expected by `analyzeCodebase()`

  **Must NOT do**:
  - Do not delete `analyzer.ts` or `fix-generator.ts` — enhance them
  - Do not remove the issue-based mode — free-form is ADDITIONAL, not replacement
  - Do not exceed 3 LLM calls per repo even with enhanced token budget
  - Do not run `npm install` in cloned repos

  **Recommended Agent Profile**:
  - **Subagent**: `deep`
    - Reason: Core pipeline rewiring + analysis enhancement requires understanding full data flow
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO (other Wave 2 tasks depend on this)
  - **Parallel Group**: Wave 2 (but sequential within — Tasks 5, 6 can run parallel AFTER this)
  - **Blocks**: Tasks 5, 6, 7, 8, 9, 12
  - **Blocked By**: Tasks 1, 2, 3

  **References**:

  **Pattern References**:
  - `src/commands/run.ts:18-26` — `RunDependencies` interface: THIS is where old → new pipeline swap happens
  - `src/commands/run.ts:30-245` — `runOrchestrator()`: main pipeline flow to modify
  - `src/commands/analyze.ts:246-367` — `analyzeSingleRepo()`: OLD function being replaced — study its flow to ensure new pipeline covers same stages

  **API/Type References**:
  - `src/lib/analyzer.ts:332-362` — `analyzeCodebase(repo, issue)`: entry point to enhance with optional issue + higher limits
  - `src/lib/analyzer.ts:169-199` — `rankSourceFiles()`: file prioritization to improve
  - `src/lib/analyzer.ts:210-232` — `buildAnalysisPrompt()`: prompt to enhance for free-form mode
  - `src/lib/analyzer.ts:43` — `SUPPORTED_SOURCE_EXTENSION_PATTERN`: already supports 17 languages
  - `src/lib/analyzer.ts:167` — `PREFERRED_SOURCE_DIRS = ["src", "source", "lib"]`: expand this
  - `src/lib/fix-generator.ts:111-129` — `validateFixScope()`: constraint that fixes must only touch `relevantFiles`
  - `src/lib/fix-generator.ts:196-248` — `generateFix()`: downstream consumer of `AnalysisResult`
  - `src/types/index.ts:31-42` — `AnalysisResult`: the output contract
  - `src/types/index.ts:99-108` — `PipelineState`: state machine to update

  **WHY Each Reference Matters**:
  - `RunDependencies` is the single injection point — swap old deps for new ones here
  - `analyzeCodebase()` already does 80% of what's needed — enhance, don't rewrite
  - `validateFixScope()` is the critical safety gate — all changes must satisfy it
  - `rankSourceFiles()` currently sorts alphabetically after preferred dirs — this is why analysis misses important files

  **Acceptance Criteria**:
  - [ ] `run.ts` calls `analyzeCodebase()` → `generateFix()` (not old `analyzeSingleRepo()`)
  - [ ] `analyzeCodebase(repo)` works without issue parameter (free-form mode)
  - [ ] `MAX_ANALYZED_FILES` default is 10, `ANALYZER_MAX_TOKENS` default is 2048
  - [ ] `rankSourceFiles()` uses size/recency heuristics, not alphabetical
  - [ ] Pipeline produces valid `AnalysisResult` objects
  - [ ] `bun test` passes

  **QA Scenarios**:

  ```
  Scenario: Pipeline uses new analyzer instead of old detectors
    Tool: Bash
    Preconditions: Pipeline rewired
    Steps:
      1. Run: grep -n "analyzeSingleRepo\|fix-router\|ContributionOpportunity" src/commands/run.ts
      2. Verify zero matches (old pipeline fully removed from run.ts)
      3. Run: grep -n "analyzeCodebase\|generateFix\|AnalysisResult" src/commands/run.ts
      4. Verify matches exist (new pipeline wired in)
    Expected Result: Zero old references, multiple new references in run.ts
    Failure Indicators: Old function names still present, new ones missing
    Evidence: .sisyphus/evidence/task-4-pipeline-wiring.txt

  Scenario: Free-form analysis works without issue
    Tool: Bash
    Preconditions: Task 4 complete
    Steps:
      1. Write a small test script that calls analyzeCodebase(mockRepo) without an issue parameter
      2. Mock callModel() to return a valid AnalysisResult JSON
      3. Verify the function returns without error and produces AnalysisResult
      4. Verify the prompt sent to LLM asks for bug/issue discovery (not issue-specific analysis)
    Expected Result: analyzeCodebase works without issue, prompt is free-form discovery
    Failure Indicators: TypeError for missing issue, prompt still references issue context
    Evidence: .sisyphus/evidence/task-4-freeform-analysis.txt
  ```

  **Commit**: YES
  - Message: `feat(pipeline): wire analyzer.ts into run.ts and add free-form analysis mode`
  - Files: `src/commands/run.ts`, `src/lib/analyzer.ts`
  - Pre-commit: `bun test`

- [x] 5. Enhanced Issue Discovery + Scoring

  **What to do**:
  - Extract and enhance `discoverIssues()` from old `analyze.ts` into a standalone module or enhance it in place
  - Search for issues with labels: `good-first-issue`, `bug`, `help-wanted`, `enhancement`, `hacktoberfest`
  - Score issues by: **bug type priority (Security CVE > NPE/null > resource leak > type error > logic error > enhancement)**, age (recent > stale), comment count (low > high = contested), has reproduction steps, scope indicators (small file changes mentioned)
  - Filter out: issues older than 6 months, issues with 10+ comments (contested), issues already assigned, issues with linked PRs
  - Reuse existing scoring patterns from `analyze.ts:201-240` (`REPRODUCTION_PATTERNS`, `SMALL_SCOPE_PATTERNS`, `IMPACT_PATTERNS`)
  - Return top 3 scored issues per repo as candidates for `analyzeCodebase(repo, issue)`
  - Handle rate limiting gracefully (GitHub API 403 → skip repo, don't crash)

  **Must NOT do**:
  - Do not make more than 2 GitHub API calls per repo for issue discovery
  - Do not fetch issue comments (too expensive) — score based on issue metadata only
  - Do not hardcode specific repo issue URLs

  **Recommended Agent Profile**:
  - **Subagent**: `deep`
    - Reason: Scoring algorithm with multiple heuristics requires careful implementation
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 6, after Task 4)
  - **Parallel Group**: Wave 2b (with Task 6)
  - **Blocks**: Tasks 11, 12
  - **Blocked By**: Tasks 1, 2, 4

  **References**:

  **Pattern References**:
  - `src/commands/analyze.ts:201-240` — `discoverIssues()`: existing issue scoring with `REPRODUCTION_PATTERNS`, `SMALL_SCOPE_PATTERNS`, `IMPACT_PATTERNS` — reuse and enhance these
  - `src/commands/analyze.ts:129-199` — Issue filtering logic: labels, age, assignment checks

  **API/Type References**:
  - `src/lib/github.ts:97-130` — `searchIssues(owner, repo, options)`: primary API — supports label filtering, state, sort
  - `src/lib/github.ts:130-150` — Rate limit handling in `searchIssues()` — intentional, don't modify
  - `src/types/index.ts` — May need `ScoredIssue` type or similar for ranked results

  **WHY Each Reference Matters**:
  - `discoverIssues()` has battle-tested heuristics — don't reinvent, enhance
  - `searchIssues()` is the GitHub API wrapper — understand its options before calling
  - Rate limit handling is intentionally silent retry — don't add conflicting error handling

  **Acceptance Criteria**:
  - [ ] Issue discovery returns top 3 scored issues per repo
  - [ ] Issues older than 6 months are filtered out
  - [ ] Issues with 10+ comments are filtered out
  - [ ] Rate limiting doesn't crash the pipeline
  - [ ] Scoring uses label, age, comment count, scope indicators

  **QA Scenarios**:

  ```
  Scenario: Issue discovery scores and ranks correctly
    Tool: Bash
    Preconditions: Mock GitHub API responses with 5 issues of varying quality
    Steps:
      1. Create mock issues: 1 bug+recent+low-comments, 1 enhancement+old, 1 bug+high-comments, 1 good-first-issue+recent, 1 assigned+bug
      2. Run issue discovery against mock data
      3. Verify ranking: bug+recent first, good-first-issue second, enhancement third
      4. Verify filtered: high-comments and assigned issues excluded
    Expected Result: Top 3 returned in correct score order, filtered issues absent
    Failure Indicators: Wrong order, filtered issues included, more than 3 returned
    Evidence: .sisyphus/evidence/task-5-issue-scoring.txt

  Scenario: Rate limiting handled gracefully
    Tool: Bash
    Preconditions: Mock GitHub API to return 403 rate limit response
    Steps:
      1. Configure mock to return 403 for searchIssues
      2. Run issue discovery
      3. Verify function returns empty array (not crash)
      4. Verify error is logged
    Expected Result: Empty array returned, error logged, no crash
    Failure Indicators: Unhandled exception, silent failure without logging
    Evidence: .sisyphus/evidence/task-5-rate-limit.txt
  ```

  **Commit**: YES
  - Message: `feat(analyze): add enhanced issue discovery with multi-factor scoring`
  - Files: `src/commands/analyze.ts` (or new `src/lib/issue-discovery.ts`)
  - Pre-commit: `bun test`

- [x] 6. Static Analysis Module (TS/JS + Python)

  **What to do**:
  - Create `src/lib/static-analyzer.ts` — AST-free pattern-based static analysis
  - **NPE/null patterns (TOP PRIORITY — per Uber NullAway data, 10x NPE reduction)**: unchecked optional chaining risks (`obj.prop.nested` without null guard), missing null checks before `.` access, uninitialized variables used before assignment
  - **TS/JS patterns**: empty catch blocks (`catch (e) {}`), `console.log` in non-test files, `any` type usage, unreachable code after return, unused imports (basic heuristic)
  - **Python patterns**: bare `except:` (catches everything), mutable default arguments (`def f(x=[])`), unused imports, `print()` in non-test files
  - **Risk scoring**: Each pattern has severity weight. NPE/null = 1.0, empty catch = 0.9, `any` type = 0.7, console.log = 0.5. Per-file risk = max(pattern_severities). Files with risk > 0.6 are Phase 2 candidates
  - Use regex patterns (not AST parsing) for simplicity and speed
  - Output: `AnalysisResult` compatible with `fix-generator.ts` — set `relevantFiles` to files with findings, `confidence` based on pattern severity, `suggestedApproach` describing the fixes
  - Integrate with `analyzeCodebase()` as an additional analysis source (Task 4 wires this in)
  - Configurable via `GITTRIBUTOR_STATIC_ANALYSIS_ENABLED` env var (default: true)

  **Must NOT do**:
  - Do not install or require AST parsers (no `typescript` compiler API, no `babel`)
  - Do not analyze files larger than 500 lines (skip with warning)
  - Do not report patterns in test files (`*.test.ts`, `*.spec.ts`, `test_*.py`)
  - Do not produce false positives for `console.log` in CLI tools (check if file is in `bin/` or has shebang)

  **Recommended Agent Profile**:
  - **Subagent**: `deep`
    - Reason: Pattern matching with false positive avoidance requires careful regex and heuristics
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 5, after Task 4)
  - **Parallel Group**: Wave 2b (with Task 5)
  - **Blocks**: Tasks 11, 12
  - **Blocked By**: Tasks 1, 2

  **References**:

  **Pattern References**:
  - `src/lib/analyzer.ts:43` — `SUPPORTED_SOURCE_EXTENSION_PATTERN`: reuse for file filtering
  - `src/lib/analyzer.ts:167` — `PREFERRED_SOURCE_DIRS`: reuse for directory targeting

  **API/Type References**:
  - `src/types/index.ts:31-42` — `AnalysisResult`: output must match this shape exactly
  - `src/lib/fix-generator.ts:111-129` — `validateFixScope()`: output `relevantFiles` must pass this validation

  **WHY Each Reference Matters**:
  - `SUPPORTED_SOURCE_EXTENSION_PATTERN`: don't re-invent file type detection
  - `AnalysisResult`: the contract — if output doesn't match, `fix-generator.ts` will reject it
  - `validateFixScope()`: files listed in `relevantFiles` must actually exist in the repo

  **Acceptance Criteria**:
  - [ ] Static analyzer detects: empty catches, console.log, `any` type, bare except, mutable defaults
  - [ ] Output is valid `AnalysisResult` with correct `relevantFiles`
  - [ ] Test files are excluded from analysis
  - [ ] Files > 500 lines are skipped
  - [ ] Can be disabled via env var

  **QA Scenarios**:

  ```
  Scenario: Static analysis finds issues in TS/JS repo
    Tool: Bash
    Preconditions: Create temp dir with sample TS files containing known issues
    Steps:
      1. Create temp directory with: empty catch block, console.log, `any` type usage
      2. Run static analyzer against the temp directory
      3. Verify output is valid AnalysisResult with relevantFiles pointing to files with issues
      4. Verify confidence is "high" for empty catch, "medium" for console.log
      5. Verify suggestedApproach describes the fix
    Expected Result: AnalysisResult with 1-3 relevant files, appropriate confidence, clear approach
    Failure Indicators: Empty relevantFiles, wrong confidence, missing suggestedApproach
    Evidence: .sisyphus/evidence/task-6-static-ts.txt

  Scenario: Static analysis handles clean repo gracefully
    Tool: Bash
    Preconditions: Create temp directory with clean, well-written TS files
    Steps:
      1. Create temp directory with properly typed, no-console, proper-error-handling TS files
      2. Run static analyzer
      3. Verify output indicates no findings (null result or empty relevantFiles)
    Expected Result: Graceful "no issues found" result, not a false positive
    Failure Indicators: False positives, crashes, non-empty relevantFiles for clean code
    Evidence: .sisyphus/evidence/task-6-static-clean.txt
  ```

  **Commit**: YES
  - Message: `feat(analyze): add static analysis module for TS/JS and Python`
  - Files: `src/lib/static-analyzer.ts` (new)
  - Pre-commit: `bun test`

- [x] 7. Remove Old Detectors + fix-router + Dead Code

  **What to do**:
  - Delete `src/lib/detectors/` directory entirely (typo-detector, docs-detector, deps-detector, etc.)
  - Delete `src/lib/fix-router.ts`
  - Remove all imports of old detectors and fix-router from other files
  - Remove `ContributionOpportunity` type from `src/types/index.ts` (and old `ContributionType` values if fully replaced)
  - Remove old `analyzeSingleRepo()` function from `src/commands/analyze.ts` (keep `discoverIssues()` if still used by Task 5)
  - Update any remaining references to old pipeline types
  - Clean up `src/commands/analyze.ts` — either gut it or delete if fully replaced by new pipeline in `run.ts`

  **Must NOT do**:
  - Do not delete `analyzer.ts` or `fix-generator.ts` — those are the NEW pipeline
  - Do not delete reusable scoring patterns (`REPRODUCTION_PATTERNS`, etc.) if Task 5 uses them
  - Do not break existing tests — update or remove tests that reference deleted code

  **Recommended Agent Profile**:
  - **Subagent**: `quick`
    - Reason: Deletion and import cleanup, no new logic
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 8, 9)
  - **Blocks**: Task 12
  - **Blocked By**: Task 4

  **References**:

  **Pattern References**:
  - `src/lib/fix-router.ts` — Entire file to delete. Currently imports from `./detectors/typo-detector.js`, `./detectors/docs-detector.js`, `./detectors/deps-detector.js`
  - `src/lib/detectors/` — Entire directory to delete
  - `src/commands/analyze.ts:246-367` — `analyzeSingleRepo()`: old analysis function to remove

  **API/Type References**:
  - `src/types/index.ts:146-159` — `ContributionOpportunity` interface to delete
  - `src/types/index.ts:132` — Old `ContributionType` values (`"typo" | "docs" | "deps" | "test" | "code"`) to remove (replaced by Task 1's new values)
  - `tests/fix-router.test.ts` — Test file for deleted module — delete or rewrite

  **WHY Each Reference Matters**:
  - All these files are the OLD pipeline being replaced — leaving them creates confusion and dead code
  - Test files referencing deleted code will fail — must be cleaned up
  - `ContributionOpportunity` removal ensures no one accidentally uses the old type

  **Acceptance Criteria**:
  - [ ] `src/lib/detectors/` directory does not exist
  - [ ] `src/lib/fix-router.ts` does not exist
  - [ ] No imports of deleted files remain in codebase (grep for `fix-router`, `typo-detector`, etc.)
  - [ ] `ContributionOpportunity` type no longer exists
  - [ ] `bun test` passes (tests updated or removed)

  **QA Scenarios**:

  ```
  Scenario: No dead imports remain
    Tool: Bash
    Preconditions: Cleanup complete
    Steps:
      1. Run: grep -r "fix-router" src/ --include="*.ts" (should return empty)
      2. Run: grep -r "typo-detector" src/ --include="*.ts" (should return empty)
      3. Run: grep -r "docs-detector" src/ --include="*.ts" (should return empty)
      4. Run: grep -r "deps-detector" src/ --include="*.ts" (should return empty)
      5. Run: grep -r "ContributionOpportunity" src/ --include="*.ts" (should return empty)
      6. Run: bun test
    Expected Result: All greps return empty, all tests pass
    Failure Indicators: Any grep finds matches, test failures
    Evidence: .sisyphus/evidence/task-7-dead-imports.txt

  Scenario: Deleted directories don't exist
    Tool: Bash
    Preconditions: Cleanup complete
    Steps:
      1. Run: ls src/lib/detectors/ 2>&1 (should error "No such file or directory")
      2. Run: ls src/lib/fix-router.ts 2>&1 (should error)
    Expected Result: Both paths return "No such file or directory"
    Failure Indicators: Files still exist
    Evidence: .sisyphus/evidence/task-7-deleted-dirs.txt
  ```

  **Commit**: YES
  - Message: `refactor(cleanup): remove old detectors, fix-router, and ContributionOpportunity`
  - Files: deleted files + updated imports
  - Pre-commit: `bun test`

- [x] 8. Fix Existing Bugs — `calculateMergeProbability` crash + silent error swallowing

  **What to do**:
  - **Bug 1**: `calculateMergeProbability` crash at `analyze.ts:269,288,309,327` — passes `{} as ContributionOpportunity` which crashes on `.type` and `.repo.hasContributing` access. If `calculateMergeProbability` is still used in the new pipeline, fix the empty object. If not used (replaced by `AnalysisResult.confidence`), remove it entirely.
  - **Bug 2**: Silent error swallowing at `analyze.ts:356` — `catch (error) { debug(...) }` silently swallows ALL errors. Replace with proper error propagation: log the error AND re-throw or return an error result.
  - Check all catch blocks in the codebase for silent swallowing pattern: `catch (e) { /* only logs or does nothing */ }`
  - Ensure new pipeline in `run.ts` (from Task 4) has proper error handling — errors should propagate up with context

  **Must NOT do**:
  - Do not add excessive try/catch — only fix genuinely silent swallowing
  - Do not change error handling in `github.ts` rate limit retry logic (that's intentional)

  **Recommended Agent Profile**:
  - **Subagent**: `quick`
    - Reason: Targeted bug fixes in specific locations
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 7, 9)
  - **Blocks**: Task 12
  - **Blocked By**: Task 4

  **References**:

  **Pattern References**:
  - `src/commands/analyze.ts:269` — First `calculateMergeProbability({} as ContributionOpportunity, {...})` call
  - `src/commands/analyze.ts:356` — `catch (error) { debug("Error analyzing...") }` — the silent swallowing bug
  - `src/lib/github.ts:130-150` — Rate limit retry in `searchIssues()` — this catch IS intentional, do NOT modify

  **WHY Each Reference Matters**:
  - Empty object crash causes the entire analyze phase to silently fail, producing zero results
  - Silent error swallowing is why the user sees "nothing to do" — errors are hidden
  - Must distinguish intentional catches (rate limit retry) from bugs (swallowed errors)

  **Acceptance Criteria**:
  - [ ] No `{} as ContributionOpportunity` patterns remain
  - [ ] No silent `catch (error) { debug(...) }` blocks (except intentional rate limit handling)
  - [ ] Errors propagate with context (repo name, issue ID, error message)
  - [ ] `bun test` passes

  **QA Scenarios**:

  ```
  Scenario: Errors propagate instead of being swallowed
    Tool: Bash
    Preconditions: Working gittributor repo
    Steps:
      1. Run: grep -n "catch.*error.*{" src/commands/analyze.ts src/commands/run.ts src/lib/analyzer.ts
      2. For each catch block found, verify it either re-throws, returns error result, or has explicit comment explaining why it's intentional
      3. Verify no catch block only contains debug() or console.log()
    Expected Result: Zero silent catch blocks in analyze pipeline
    Failure Indicators: catch blocks that only log without re-throwing or returning error
    Evidence: .sisyphus/evidence/task-8-error-handling.txt

  Scenario: No empty object casting remains
    Tool: Bash
    Preconditions: Bug fixes applied
    Steps:
      1. Run: grep -n "{} as" src/ -r --include="*.ts"
      2. Verify zero results (or only legitimate empty object casts with comment)
    Expected Result: No `{} as SomeType` patterns in analyze pipeline
    Failure Indicators: Any `{} as` pattern found without justification
    Evidence: .sisyphus/evidence/task-8-empty-cast.txt
  ```

  **Commit**: YES (groups with Task 7)
  - Message: `fix(analyze): fix calculateMergeProbability crash and silent error swallowing`
  - Files: `src/commands/analyze.ts`, `src/commands/run.ts`
  - Pre-commit: `bun test`

- [x] 9. Error Handling + Logging Improvements

  **What to do**:
  - Add structured logging to the new pipeline stages:
    - Discovery: log repos found, star counts, languages
    - Issue finding: log issues found per repo, scores
    - Analysis: log which files are analyzed, LLM call count, confidence scores
    - Fix generation: log fix scope, files modified, validation result
  - Use existing `debug()` utility pattern for verbose logging
  - Add a pipeline summary at the end: "Analyzed N repos, found M issues, generated K fixes"
  - Ensure all async operations have timeout handling (max 30s per LLM call, max 60s per repo)
  - Add graceful degradation: if one repo fails, continue with others (don't abort entire run)

  **Must NOT do**:
  - Do not add a logging library — use existing debug/console patterns
  - Do not add verbose logging that runs in non-debug mode
  - Do not add retry logic for LLM calls (keep simple for now)

  **Recommended Agent Profile**:
  - **Subagent**: `quick`
    - Reason: Adding log statements and timeout guards, no complex logic
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 7, 8)
  - **Blocks**: Task 12
  - **Blocked By**: Task 4

  **References**:

  **Pattern References**:
  - `src/commands/run.ts` — Existing logging pattern in `runOrchestrator()`. Follow same style.
  - `src/lib/analyzer.ts:284-317` — `requestAnalysis()`: existing LLM call pattern. Add timeout here.

  **API/Type References**:
  - `src/lib/ai.ts:1-45` — `callModel()`: check if it already has timeout support. If not, wrap with `Promise.race()`.

  **WHY Each Reference Matters**:
  - Consistent logging style is important — don't introduce new patterns
  - `callModel()` timeout prevents infinite hangs on LLM calls
  - Pipeline summary gives user confidence the tool actually did something

  **Acceptance Criteria**:
  - [ ] Pipeline prints summary: repos analyzed, issues found, fixes generated
  - [ ] LLM calls have 30s timeout
  - [ ] Single repo failure doesn't abort entire run
  - [ ] Debug mode shows detailed per-stage logging

  **QA Scenarios**:

  ```
  Scenario: Pipeline prints summary
    Tool: Bash
    Preconditions: Valid GITHUB_TOKEN, working repo
    Steps:
      1. Run: bun run start (or equivalent pipeline command)
      2. Capture stdout
      3. Verify output contains summary line with repo count, issue count, fix count
    Expected Result: Summary line present: "Analyzed N repos, found M issues, generated K fixes"
    Failure Indicators: No summary, only raw debug output, no indication of what happened
    Evidence: .sisyphus/evidence/task-9-pipeline-summary.txt

  Scenario: Single repo failure doesn't abort run
    Tool: Bash
    Preconditions: Pipeline configured with multiple repos
    Steps:
      1. Mock or configure one repo to fail (e.g., non-existent repo name)
      2. Run pipeline with 2+ repos where one will fail
      3. Verify pipeline continues to next repo after failure
      4. Verify error is logged for failed repo
      5. Verify successful repos still produce results
    Expected Result: Pipeline completes, failed repo logged, other repos processed
    Failure Indicators: Pipeline aborts on first failure, no error logged, zero results
    Evidence: .sisyphus/evidence/task-9-graceful-degradation.txt
  ```

  **Commit**: YES (groups with Tasks 7, 8)
  - Message: `feat(pipeline): add structured logging, timeouts, and graceful degradation`
  - Files: `src/commands/run.ts`, `src/lib/analyzer.ts`, `src/lib/ai.ts`
  - Pre-commit: `bun test`

- [x] 10. Fix Generator Integration — Wire fix-generator.ts with enhanced analyzer output

  **What to do**:
  - Update `fix-generator.ts` to handle new `ContributionType` values (`"bug-fix"`, `"performance"`, `"type-safety"`, `"logic-error"`, `"static-analysis"`)
  - Ensure `generateFix()` constructs appropriate prompts for each new analysis type (issue-based fixes vs static analysis fixes require different prompt strategies)
  - Update `validateFixScope()` (line 111-129) to properly validate files from enhanced analyzer output (more files now — up to 10)
  - Verify fix-generator properly reads `fileContents` from `AnalysisResult` when available (enhanced analyzer now sends file contents)
  - Add prompt context: when `AnalysisResult` includes `rootCause` and `affectedFiles`, incorporate them into the fix prompt for better-targeted fixes
  - Test integration: analyzer output → fix-generator input → valid fix output

  **Must NOT do**:
  - Do not change the `AnalysisResult` type (that's Task 1)
  - Do not modify the analyzer itself (that's Task 4)
  - Do not add new AI provider support — use existing `callModel()` from `src/lib/ai.ts`

  **Recommended Agent Profile**:
  - **Subagent**: `deep`
    - Reason: Requires understanding data flow between analyzer and fix-generator, prompt engineering for different fix types
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 7, 8, 9)
  - **Blocks**: Task 12
  - **Blocked By**: Task 4

  **References**:

  **Pattern References**:
  - `src/lib/fix-generator.ts:1-250` — Full file: `generateFix()` builds prompts and calls `callModel()`, `validateFixScope()` ensures fixes only touch analyzed files
  - `src/lib/fix-generator.ts:111-129` — `validateFixScope()`: validates every fix file is in `analysis.relevantFiles` — this is the key safety check

  **API/Type References**:
  - `src/types/index.ts:31-42` — `AnalysisResult`: fields `relevantFiles`, `suggestedApproach`, `confidence`, `rootCause?`, `affectedFiles?`, `complexity?`, `fileContents?`
  - `src/lib/ai.ts:1-45` — `callModel()` API: the only way to call LLM, supports Anthropic + OpenAI

  **WHY Each Reference Matters**:
  - `fix-generator.ts` is the module being modified — executor needs full context of its current behavior
  - `validateFixScope()` is the critical safety check — must work with expanded file lists (10 files instead of 3)
  - `AnalysisResult` contract must be respected exactly — fix-generator consumes it, cannot change it

  **Acceptance Criteria**:
  - [ ] `generateFix()` handles all new `ContributionType` values without errors
  - [ ] `validateFixScope()` works with up to 10 relevant files
  - [ ] Fix prompts include `rootCause` and `affectedFiles` when present in `AnalysisResult`
  - [ ] `bun test` passes

  **QA Scenarios**:

  ```
  Scenario: Fix generation for bug-fix type
    Tool: Bash
    Preconditions: Tasks 1 and 4 complete, analyzer produces AnalysisResult with type "bug-fix"
    Steps:
      1. Create a test script that calls generateFix() with a mock AnalysisResult of type "bug-fix" containing rootCause and affectedFiles
      2. Run: bun run test-script.ts
      3. Verify the generated fix prompt includes the rootCause text
      4. Verify the fix targets only files in relevantFiles
    Expected Result: Fix generated successfully, prompt includes rootCause, all files in scope
    Failure Indicators: Error thrown, prompt missing rootCause, fix targets files outside relevantFiles
    Evidence: .sisyphus/evidence/task-10-bugfix-generation.txt

  Scenario: Scope validation with expanded file list
    Tool: Bash
    Preconditions: fix-generator.ts updated
    Steps:
      1. Create mock AnalysisResult with 10 relevantFiles
      2. Call validateFixScope() with a fix that touches 3 of those 10 files
      3. Verify validation passes
      4. Call validateFixScope() with a fix that touches a file NOT in relevantFiles
      5. Verify validation rejects it
    Expected Result: Valid fixes pass, out-of-scope fixes rejected
    Failure Indicators: False positive (accepts out-of-scope), false negative (rejects valid)
    Evidence: .sisyphus/evidence/task-10-scope-validation.txt
  ```

  **Commit**: YES
  - Message: `feat(fix-generator): integrate with enhanced analyzer output and new contribution types`
  - Files: `src/lib/fix-generator.ts`
  - Pre-commit: `bun test`

- [x] 11. PR Submission + Review Pipeline — Wire review and submit phases

  **What to do**:
  - Update `src/commands/run.ts` to complete the full pipeline: analyze → fix → **create PR**
  - Use existing `src/lib/github.ts` functions to:
    - Fork target repo (or use existing fork)
    - Create a branch with descriptive name based on the analysis type
    - Commit the fix
    - Open a PR with a well-structured description explaining the fix, referencing the issue if one exists
  - **PR presentation optimized for merge** (research: ≤5 files + ≤200 LOC = 84% merge rate; >10 files = 30%):
    - Limit to ≤5 files and ≤200 LOC per PR — if fix is larger, split into multiple PRs
    - One fix per PR (no bundling unrelated changes)
    - PR description template: what was found, why it matters (with data/evidence), what the fix does, how to verify, before/after if applicable
    - Include regression test or verification command in PR body
    - CI must pass before PR is created (run `bun test` or equivalent on fix)
  - When analysis was issue-based (from Task 5's issue discovery), reference the issue number in PR title and body (`Fixes #N`)
  - Add dry-run mode (env: `GITTRIBUTOR_DRY_RUN=true`) that logs what WOULD be submitted without actually creating PRs
  - Handle rate limits gracefully — if PR creation fails due to rate limit, log and continue to next repo

  **Must NOT do**:
  - Do not auto-merge PRs
  - Do not modify the fix-generator logic (that's Task 10)
  - Do not add GitHub App authentication — use existing PAT-based auth from `github.ts`

  **Recommended Agent Profile**:
  - **Subagent**: `deep`
    - Reason: Requires understanding GitHub API flow, PR creation, error handling for network operations
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 7, 8, 9, 10)
  - **Blocks**: Task 12
  - **Blocked By**: Tasks 5, 6

  **References**:

  **Pattern References**:
  - `src/commands/run.ts:1-245` — Main pipeline orchestrator: `RunDependencies` (line 18-26), current pipeline flow
  - `src/lib/github.ts:1-349` — GitHub API client: `searchRepositories()`, `getRepoIssues()`, existing Octokit setup

  **API/Type References**:
  - `src/types/index.ts:99-108` — `PipelineState`: tracks pipeline progress, may need `prUrl?` field
  - `src/lib/github.ts` — Check for existing fork/branch/PR creation functions; if missing, they need to be added here

  **WHY Each Reference Matters**:
  - `run.ts` is where the pipeline is orchestrated — PR submission is the final step
  - `github.ts` has the Octokit client already configured — must reuse it, not create a new one
  - `PipelineState` may need extension to track PR URLs for reporting

  **Acceptance Criteria**:
  - [ ] Pipeline can execute: discover → analyze → fix → create PR (in dry-run mode)
  - [ ] PR description includes analysis summary and issue reference (when applicable)
  - [ ] Dry-run mode logs PR details without creating actual PRs
  - [ ] Rate limit errors are caught and logged, pipeline continues
  - [ ] `bun test` passes

  **QA Scenarios**:

  ```
  Scenario: Dry-run PR creation
    Tool: Bash
    Preconditions: GITTRIBUTOR_DRY_RUN=true, valid GITHUB_TOKEN
    Steps:
      1. Run: GITTRIBUTOR_DRY_RUN=true bun run src/index.ts run
      2. Check stdout/stderr for "[DRY RUN] Would create PR:" messages
      3. Verify the log includes: repo name, branch name, PR title, PR body summary
      4. Verify NO actual GitHub API calls for PR creation were made (no PR URL in output)
    Expected Result: Pipeline completes, logs PR details, no actual PRs created
    Failure Indicators: Actual PR created, crash, missing PR details in log
    Evidence: .sisyphus/evidence/task-11-dry-run.txt

  Scenario: Rate limit handling
    Tool: Bash
    Preconditions: Pipeline running
    Steps:
      1. Mock or trigger a GitHub rate limit response (403 with rate limit headers)
      2. Verify pipeline logs the rate limit error with retry-after info
      3. Verify pipeline continues to next repo instead of crashing
    Expected Result: Graceful degradation — error logged, pipeline continues
    Failure Indicators: Unhandled exception, pipeline abort, no error message
    Evidence: .sisyphus/evidence/task-11-rate-limit.txt
  ```

  **Commit**: YES
  - Message: `feat(pipeline): add PR submission with dry-run mode and rate limit handling`
  - Files: `src/commands/run.ts`, `src/lib/github.ts`
  - Pre-commit: `bun test`

- [x] 12. E2E Integration Test — Full pipeline smoke test

  **What to do**:
  - Create `tests/e2e/pipeline.test.ts` with an end-to-end integration test
  - Test the full pipeline: dynamic discovery → analyzer → fix-generator → PR submission (dry-run)
  - Mock external calls (GitHub API, LLM) to make tests deterministic and fast
  - Test scenarios:
    - Happy path: 1 repo found, 1 issue analyzed, fix generated, dry-run PR logged
    - No repos found: pipeline exits gracefully with message
    - Analyzer finds no issues: pipeline skips fix generation, logs reason
    - Fix generation fails: pipeline logs error, continues to next repo
    - Static analysis path: repo has TS/JS files, static analyzer finds empty catch, fix generated
  - Verify all new modules work together through the actual pipeline code path, not isolated unit tests
  - Add `bun test tests/e2e/` as a separate test command in package.json scripts

  **Must NOT do**:
  - Do not make real API calls — all external services must be mocked
  - Do not modify existing unit tests in `tests/` — add new E2E tests alongside them
  - Do not create flaky tests that depend on timing or network

  **Recommended Agent Profile**:
  - **Subagent**: `deep`
    - Reason: Integration testing requires understanding the full pipeline, mocking strategy, and verifying data flows across all modules
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 4 (sequential — depends on ALL prior tasks)
  - **Blocks**: F1-F4
  - **Blocked By**: Tasks 7, 8, 9, 10, 11

  **References**:

  **Pattern References**:
  - `tests/` directory — Existing test patterns using `bun:test` with `describe/it/expect`
  - `src/commands/run.ts` — The orchestrator function that runs the full pipeline

  **API/Type References**:
  - `src/lib/ai.ts:callModel()` — Must be mocked to return deterministic analysis/fix results
  - `src/lib/github.ts` — Must be mocked: `searchRepositories()` returns mock repos, `getRepoIssues()` returns mock issues

  **Test References**:
  - Existing tests in `tests/` — Follow same `describe/it/expect` pattern, same mock conventions
  - `package.json` scripts — Add `"test:e2e": "bun test tests/e2e/"` script

  **WHY Each Reference Matters**:
  - Existing test patterns ensure consistency with the 14 passing tests
  - `run.ts` is the integration point — E2E tests exercise the real pipeline code
  - Mocking `callModel()` and `github.ts` prevents flaky external calls

  **Acceptance Criteria**:
  - [ ] E2E test file exists at `tests/e2e/pipeline.test.ts`
  - [ ] At least 5 test scenarios covering happy path + error cases
  - [ ] All mocks properly isolate from external services
  - [ ] `bun test` passes (all existing + new E2E tests)
  - [ ] `bun test tests/e2e/` runs independently

  **QA Scenarios**:

  ```
  Scenario: Full E2E test suite passes
    Tool: Bash
    Preconditions: All Tasks 1-11 complete
    Steps:
      1. Run: bun test tests/e2e/pipeline.test.ts
      2. Verify all test scenarios pass
      3. Run: bun test (full suite)
      4. Verify all existing 14 tests + new E2E tests pass
    Expected Result: All tests pass, zero failures
    Failure Indicators: Any test failure, import errors, mock setup issues
    Evidence: .sisyphus/evidence/task-12-e2e-tests.txt

  Scenario: E2E tests are properly isolated
    Tool: Bash
    Preconditions: E2E test file exists
    Steps:
      1. Run E2E tests with GITHUB_TOKEN unset
      2. Verify tests still pass (proving mocks are active, not real API calls)
      3. Run E2E tests with no network (if possible, or verify no HTTP requests in test output)
    Expected Result: Tests pass without any real API credentials or network
    Failure Indicators: Tests fail without GITHUB_TOKEN, HTTP connection errors
    Evidence: .sisyphus/evidence/task-12-isolation.txt
  ```

  **Commit**: YES
  - Message: `test(e2e): add full pipeline integration tests with mocked externals`
  - Files: `tests/e2e/pipeline.test.ts`, `package.json`
  - Pre-commit: `bun test`

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, run command). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in `.sisyphus/evidence/`. Compare deliverables against plan. Verify: pipeline uses `analyzer.ts` not `analyze.ts`, old detectors deleted, dynamic repo search active, `bun test` passes.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Run `bun test` (all tests pass). Review all changed files for: `as any`/`@ts-ignore`, empty catches, `console.log` in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names (data/result/item/temp). Verify no dead code from old pipeline remains.
  Output: `Build [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Real Manual QA** — `unspecified-high`
  Start from clean state. Execute EVERY QA scenario from EVERY task — follow exact steps, capture evidence. Test cross-task integration: dynamic discovery → analyzer → fix-generator → dry-run PR (full pipeline). Test edge cases: no repos found, analyzer returns no issues, LLM timeout. Save to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff (git log/diff). Verify 1:1 — everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance. Detect cross-task contamination: Task N touching Task M's files. Verify old pipeline code (`analyze.ts`, `fix-router.ts`, detectors) is actually deleted, not just unused.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

| Wave | Commit Message | Files | Pre-commit |
|------|---------------|-------|------------|
| 1 | `refactor(types): update ContributionType and AnalysisResult for new analysis pipeline` | `src/types/index.ts` | `bun test` |
| 1 | `refactor(types): add Repository↔TrendingRepo adapter` | `src/types/index.ts` | `bun test` |
| 2 | `feat(analyzer): enhance with free-form mode, expanded file limits, broader directory scanning` | `src/lib/analyzer.ts` | `bun test` |
| 2 | `feat(discovery): add GitHub issue discovery with smart scoring` | `src/lib/issue-discovery.ts` | `bun test` |
| 2 | `feat(analysis): add static analysis module for TS/JS and Python` | `src/lib/static-analyzer.ts` | `bun test` |
| 3 | `refactor(pipeline): rewire run.ts to use analyzer.ts + fix-generator.ts, delete old pipeline` | `src/commands/run.ts`, `src/commands/analyze.ts`, `src/lib/fix-router.ts`, detectors | `bun test` |
| 3 | `feat(discovery): replace hardcoded repos with dynamic GitHub search` | `src/lib/github.ts`, `repos.yaml` | `bun test` |
| 3 | `fix(pipeline): fix calculateMergeProbability crash and silent error swallowing` | `src/commands/run.ts`, `src/lib/analyzer.ts` | `bun test` |
| 3 | `feat(fix-generator): integrate with enhanced analyzer output and new contribution types` | `src/lib/fix-generator.ts` | `bun test` |
| 3 | `feat(pipeline): add PR submission with dry-run mode and rate limit handling` | `src/commands/run.ts`, `src/lib/github.ts` | `bun test` |
| 4 | `test(e2e): add full pipeline integration tests with mocked externals` | `tests/e2e/pipeline.test.ts`, `package.json` | `bun test` |

---

## Success Criteria

### Verification Commands
```bash
bun test                          # Expected: ALL tests pass (14 existing + new E2E)
bun test tests/e2e/               # Expected: E2E pipeline tests pass independently
GITTRIBUTOR_DRY_RUN=true bun run src/index.ts run  # Expected: Discovers repos, analyzes, generates fixes, logs dry-run PRs
```

### Industry-Standard Metrics
- **False Positive Rate**: <10% (Google Tricorder standard — above this, developers ignore findings)
- **Analysis scope**: Diff-only / changed-lines-only where possible (Meta Infer pattern)
- **Findings per repo**: Cap at ~5 high-confidence findings (>10 = ignored)
- **Fix rate**: Target >50% of findings are auto-fixable (CodeReduce benchmark: 82%)
- **PR merge rate**: Target >60% (research baseline: 84% at compatibility >95%)

### Final Checklist
- [ ] Pipeline uses `analyzer.ts` + `fix-generator.ts` (not old `analyze.ts` + `fix-router.ts`)
- [ ] Old detectors deleted: `typo-detector.ts`, `docs-detector.ts`, `deps-detector.ts`, `test-detector.ts`, `code-detector.ts`
- [ ] Old pipeline files deleted: `src/commands/analyze.ts`, `src/lib/fix-router.ts`
- [ ] Dynamic repo discovery via GitHub API (no hardcoded `repos.yaml` dependency)
- [ ] **2-phase analysis works**: Phase 1 scans ALL files (lightweight, seconds) → Phase 2 deep-analyzes candidates (LLM, minutes)
- [ ] **NPE/null patterns are top priority** in static analysis (per Uber NullAway data)
- [ ] Static analysis module finds real issues (NPE risks, empty catches, type safety) with <10% FP rate
- [ ] Issue-based discovery scores by bug type priority (Security CVE > NPE > resource leak > type > logic)
- [ ] **PRs follow merge-optimized format**: ≤5 files, ≤200 LOC, one fix per PR, includes verification
- [ ] `calculateMergeProbability` crash fixed
- [ ] Silent error swallowing fixed — errors are logged
- [ ] Dry-run mode works end-to-end
- [ ] All `bun test` tests pass
- [ ] No `as any`, empty catches, or `console.log` in production code


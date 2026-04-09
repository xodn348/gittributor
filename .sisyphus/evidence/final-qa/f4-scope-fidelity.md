# F4 Scope Fidelity Review — gittributor-v2

Reviewed at: 2026-04-09 18:23 UTC
Reviewer: F4 Scope Fidelity

## Evidence gathered
- Plan reviewed: `.sisyphus/plans/gittributor-v2.md`
- Git history reviewed: `GIT_MASTER=1 git log --oneline -30`
- Source tree checked: `ls src/`
- Test status: `bun test` → **357 pass / 3 skip / 0 fail**
- Extra validation: `bun run typecheck` → **FAIL** (multiple test/type mismatches)
- Forbidden pattern scan:
  - `@ts-ignore` / `as any` in `src/` → none found
  - `--force` / `force-with-lease` / `github.com/trending` → none found
  - `openai|OPENAI` in `src/commands` → only AI disclosure string in `src/commands/submit.ts`

## Task-by-task scope verdict

### T0 — V2 type system
**Verdict: NOT COMPLIANT**
- `src/types/index.ts:77-178` adds V2-ish types, but several contracts do not match the plan.
- `TrendingRepo` is not `Repository` + `trendingScore/maintainerActivity/lastMergedPRAge/contributingGuideUrl`; it instead defines a different shape (`owner`, `name`, `isArchived`, `topics`, etc.).
- `MergeProbability` exposes `label/reasons`, not `factors/recommendation`.
- `ContributionOpportunity` lacks required `confidence` and `effort` fields.
- `ContributionHistory` / `GuardrailCheck` / `PipelineState` shapes differ materially from spec.

### T1 — Curated repository YAML + loader
**Verdict: NOT COMPLIANT**
- `repos.yaml` exists and has 30 entries, and `package.json` adds `js-yaml`.
- But the YAML schema is `owner/name/stars/language/description/topics/defaultBranch`, not plan-specified `fullName/language/categories[]/notes?`.
- `src/lib/repo-list.ts` exports `loadRepoList(repoListPath: string)` and `filterRepoList(...)`, but filtering is by `languages/topics/excludeRepos`, not `language/category/minStars`.

### T2 — Discover rewrite
**Verdict: NOT COMPLIANT**
- `src/commands/discover.ts` does use YAML first and GitHub search fallback, and default stars are 1000.
- The fallback query uses a 90-day pushed window (`buildDiscoverQuery`, lines 45-54) instead of the planned 30-day filter.
- Repo enrichment is incomplete/misaligned: open issue enrichment is wrong (`openIssues` derived from `stargazerCount` in lines 129-136), and the sorter does not use the planned maintainer-activity heuristic.
- Cross-task spillover: commits for discover also touched `src/index.ts` and `src/lib/github.ts`.

### T3 — Guardrails module
**Verdict: NOT COMPLIANT**
- `src/lib/guardrails.ts` exists with the requested function names.
- API and behavior do not match spec: functions require explicit file paths, `GuardrailCheck` returns `passed/reason` instead of `allowed/reason/cooldownUntil`, and `checkRepoEligibility` checks archive + star threshold rather than archive + stale push.
- Hardcoded constants `MAX_HOURLY` and `MAX_WEEKLY_PER_REPO` violate the plan’s “use config values from T12” rule.

### T4 — Analyze rewrite
**Verdict: COMPLIANT (pragmatic)**
- `src/commands/analyze.ts` plus `src/lib/contribution-detector.ts` implement all five contribution types, merge-probability scoring, shallow cloning, state persistence, and the 10-repo cap.
- It is not a perfect 1:1 implementation (for example, typo scanning is centered on README content in `analyze.ts`), but the core V2 analyzer described in the plan is present.

### T5 — Contribution history tracker
**Verdict: NOT COMPLIANT**
- `src/lib/history.ts` exists and persists JSON to `.gittributor/history.json`.
- The API shape differs materially: all functions require `historyPath`, `updateContributionStatus` updates by internal `id` rather than `prUrl`, and stats return `byType/byStatus` instead of `{ total, merged, closed, open, mergeRate }`.
- The history schema in `src/types/index.ts:163-176` is also different from the plan contract.

### T6 — Fix router + AI-free detectors
**Verdict: COMPLIANT**
- `src/lib/fix-router.ts` routes by contribution type, using deterministic paths for typo/docs/deps and AI-backed paths for test/code.
- Detector modules exist at `src/lib/detectors/typo-detector.ts`, `docs-detector.ts`, and `deps-detector.ts`, and the router does not auto-commit.

### T7 — CONTRIBUTING.md compliance checker
**Verdict: NOT COMPLIANT**
- `src/lib/contributing-checker.ts` checks CLA, issue-first, and PR-template existence.
- It does not implement branch naming extraction, test requirements detection, or `rawRules`, and `ComplianceResult` in `src/types/index.ts:178-183` is missing planned fields.

### T8 — Review command
**Verdict: COMPLIANT**
- `src/commands/review.ts:217-377` adds grouped contribution display, `--type` filtering, color-coded merge scores, compliance warnings, and summary stats.
- This matches the V2 review surface area the plan asked for.

### T9 — Submit command
**Verdict: NOT COMPLIANT**
- `src/commands/submit.ts` runs rate-limit/duplicate/archive checks, supports dry-run, generates type-specific PR bodies, and records history.
- But `checkContributingCompliance()` runs only after fork/clone and is skipped entirely in dry-run.
- The issue-first rule is inverted: plan says “warn but allow override with `--skip-issue-check`”; actual code warns and proceeds even without the override (`lines 443-445`).

### T10 — Run orchestrator
**Verdict: COMPLIANT (pragmatic)**
- `src/commands/run.ts` adds `--dry-run`, `--stats`, `--type`, sequential stage execution, and progress output.
- The end-to-end control flow matches the V2 orchestrator shape, even though some deeper handoff details remain rough.

### T11 — Fix existing failing tests
**Verdict: COMPLIANT**
- There are dedicated `fix(tests)` commits and the current suite passes: `bun test` → 357 pass / 0 fail.
- No evidence of deleted tests was observed from the current tree and recent history.

### T12 — V2 config schema
**Verdict: NOT COMPLIANT**
- `src/lib/config.ts` adds the requested V2 fields, default values, project-local override, and validation.
- However it still relies on environment variables for configuration (`loadConfig`, lines 201-237), which violates the task’s “JSON file only” rule.

## Cross-task contamination
1. **Sacred plan file was modified**, which the work context explicitly forbids.
   - `GIT_MASTER=1 git log --oneline -- .sisyphus/plans/gittributor-v2.md` shows commits `e209002` and `6f40a3c` touched the plan.
2. **Discover work spilled into unrelated files**:
   - T2-related commits touched `src/index.ts` and `src/lib/github.ts` in addition to `src/commands/discover.ts`.
3. **Type task spilled into extra type-guard work**:
   - T0-related history touched `src/types/guards.ts`, which was not part of the task spec.
4. **Compliance task mutated the shared type file**:
   - T7-related commit `f5079bd` touched `src/types/index.ts` as well as `src/lib/contributing-checker.ts`.

## Unaccounted / beyond-spec files touched in V2 task commits
- `src/index.ts`
- `src/lib/github.ts`
- `src/types/guards.ts`
- `.sisyphus/plans/gittributor-v2.md`

## Must-NOT-do checks
- No `github.com/trending` scraping found.
- No `--force` / `force-with-lease` usage found in source or config.
- No `@ts-ignore` / `as any` found in `src/`.
- No direct OpenAI call from command-layer code found; only provider selection/disclosure strings appear in `src/commands/submit.ts`.
- However, the sacred-plan-file rule **was violated** by prior commits.

## Bottom line
Core V2 modules exist and the Bun test suite is green, but scope fidelity is not 1:1. Several foundational tasks (T0, T1, T3, T5, T7, T9, T12) diverge materially from the plan contract, and the read-only plan file was modified during implementation.

## Final tally
- Tasks compliant: **5 / 13**
- Contamination issues: **4**
- Unaccounted files: **4**
- Recommended verdict: **REJECT**
# F4 Scope Fidelity Review

Generated: 2026-04-09T13:24:45
Reviewer: F4 (Scope Fidelity)

## Commands / evidence gathered
- Read plan: `.sisyphus/plans/gittributor-v2.md`
- Git history: `GIT_MASTER=1 git log --oneline -30`
- Source tree: `ls src/`, `glob src/**/*`, `glob tests/**/*`
- Verification: `bun test` → `357 pass, 3 skip, 0 fail`
- CLI flag probes:
  - `bun run src/index.ts review --type typo` → `Unexpected argument for review: typo`
  - `bun run src/index.ts submit --dry-run` → `Unknown option for submit: --dry-run`
- Git history review of V2 commits: `GIT_MASTER=1 git log --reverse --format='%h %s' --name-only 338f990^..18e1864`
- Working tree status at review time: dirty on `src/commands/analyze.ts`, `src/commands/run.ts`, `src/commands/submit.ts`, `src/index.ts`, `src/lib/guardrails.ts`, `tests/cli-entrypoint.test.ts`

## Task-by-task scope check
- **T0 — REJECT**: `src/types/index.ts` does not match the planned V2 contracts. Missing/renamed fields include `TrendingRepo.trendingScore`, `maintainerActivity`, `lastMergedPRAge`, `contributingGuideUrl`; `MergeProbability.factors/recommendation`; `ContributionOpportunity.confidence/effort`; `PipelineState.contributionHistory`; `GuardrailCheck.allowed/cooldownUntil`.
- **T1 — REJECT**: `repos.yaml` and `src/lib/repo-list.ts` exist, but YAML schema is owner/name based instead of planned `fullName + categories + notes`; loader signature is not `loadRepoList(path?)`; filter shape differs from planned `{ language?, category?, minStars? }`.
- **T2 — REJECT**: `src/commands/discover.ts` exists and does YAML-first + fallback, but enrichment/sort contract is incomplete versus spec (no maintainer activity / last merged PR age / contributing guide URL fields, incomplete enriched repo shape).
- **T3 — REJECT**: `src/lib/guardrails.ts` exists, but it hardcodes limits, uses `passed` instead of planned `allowed`, omits cooldown timestamps, and blocks by star threshold even though plan explicitly said not to block by repo popularity alone.
- **T4 — APPROVE (pragmatic)**: `src/commands/analyze.ts` + `src/lib/contribution-detector.ts` exist, cover all 5 contribution types, use shallow clone, cap at 10 repos, score/sort opportunities, and tests pass.
- **T5 — REJECT**: `src/lib/history.ts` exists, but API and data model do not match plan (`loadHistory()`/`saveContribution(entry)`/`updateContributionStatus(prUrl, status)` contract not implemented as specified).
- **T6 — APPROVE (pragmatic)**: `src/lib/fix-router.ts` and detector modules exist, mechanical paths are separate from AI paths, and tests are present for router + detectors.
- **T7 — REJECT**: `src/lib/contributing-checker.ts` exists, but `ComplianceResult` is missing planned fields such as `branchConvention`, `requiresTests`, and `rawRules`; checker only handles a subset of the planned output.
- **T8 — REJECT**: `src/commands/review.ts` contains multi-type review helpers, but the CLI still routes `review` to legacy `reviewFix` in `src/index.ts`, and `review --type <type>` is not wired (`Unexpected argument for review: typo`).
- **T9 — REJECT**: `src/commands/submit.ts` has guardrail-aware logic and PR templates, but CLI `submit --dry-run` is not exposed, and `requiresIssueFirst` warns then proceeds by default instead of making `--skip-issue-check` meaningful.
- **T10 — APPROVE (pragmatic)**: `src/commands/run.ts` exists with `--dry-run`, `--stats`, `--type`, sequential stage execution, and passing tests.
- **T11 — APPROVE**: `bun test` passes (`357 pass, 3 skip, 0 fail`), and no deleted test files were found in V2 commit history.
- **T12 — APPROVE**: `src/lib/config.ts` adds V2 fields/defaults, preserves V1 fields, supports project-local override, and validates config input; tests exist and pass.

## Must-NOT / contamination findings
1. **Sacred plan file was modified in implementation commits**: `e209002` and `6f40a3c` both include `.sisyphus/plans/gittributor-v2.md`, violating the read-only plan rule.
2. **V1/V2 CLI contamination remains**: `src/index.ts` still wires `review` to legacy `reviewFix`, while new V2 review functionality lives separately in `src/commands/review.ts`.
3. **Submit flag contamination**: V2 `submit` function supports `dryRun` / issue-check behavior, but CLI validation still rejects `submit --dry-run`, so module-level scope landed without CLI integration.

## Unaccounted / beyond-spec files
- `.sisyphus/plans/gittributor-v2.md` was changed in V2 task commits even though it was explicitly out of bounds.

## Verdict
- Tasks compliant: **5 / 13**
- Contamination: **3 issues**
- Unaccounted files: **1**
- Final verdict: **REJECT**

Core V2 modules exist and the test suite is green, but there are still real scope-fidelity misses in the type contracts, repo-list/guardrail/history/compliance shapes, CLI wiring for review/submit, and the plan-file mutation violation.

# Fix Gittributor End-to-End Pipeline

## TL;DR

> **Quick Summary**: Fix 2 critical pipeline blockers (GITHUB_TOKEN resolution and review stdin blocking) plus 2 quality improvements (PR size guard logging and fix-generator resilience) so gittributor can automatically discover → analyze → fix → review → submit PRs without human intervention.
> 
> **Deliverables**:
> - `getGitHubToken()` with `gh auth token` fallback
> - Auto-approve review in automated `run` command
> - Explicit logging when PR size guard triggers
> - Improved fix-generator JSON parsing resilience
> 
> **Estimated Effort**: Short (2-3 hours)
> **Parallel Execution**: YES - 2 waves
> **Critical Path**: Task 1 + Task 2 (parallel) → Task 3 + Task 4 (parallel) → Final Verification

---

## Context

### Original Request
User said: "자동으로 고쳐서 PR까지해야되는데. 안되고있어" (It should automatically fix and create PRs, but it's not working). The gittributor pipeline silently fails at two critical points: token resolution and review approval.

### Interview Summary
**Key Discussions**:
- Pipeline runs but never submits PRs — fails silently
- User has `gh auth login` configured with `repo` scope but no `GITHUB_TOKEN` env var
- Previous session already fixed LLM timeout (30s→120s with retry logic in `src/lib/ai.ts`)

**Research Findings**:
- `run.ts:493` passes `autoApprove: options.dryRun` — in non-dry-run mode this is falsy, causing `readDecision(io)` to block on stdin
- `getGitHubToken()` at `run.ts:115-117` only reads `Bun.env.GITHUB_TOKEN` with no fallback
- PR size guard at `run.ts:139-142` silently skips large fixes with no explanation
- Fix generator scope validation at `fix-generator.ts:111-123` rejects valid fixes when LLM suggests adjacent files

### Metis Review
**Identified Gaps** (addressed):
- `Bun.spawnSync` for `gh auth token` must check exit code and handle non-interactive environments
- `--dry-run` behavior must be preserved exactly — autoApprove change must not affect dry-run review flow
- PR size guard needs explicit logging so users understand why PRs aren't submitted
- Token should be validated upfront, not per-repo, to avoid wasted computation

---

## Work Objectives

### Core Objective
Make the gittributor `run` command work end-to-end in automated mode: discover repos → analyze issues → generate fixes → auto-approve review → submit PRs via GitHub API.

### Concrete Deliverables
- Modified `src/commands/run.ts` — token fallback + autoApprove fix + PR guard logging
- Modified `src/commands/review.ts` — no changes needed (already supports `autoApprove` flag)
- Modified `src/lib/fix-generator.ts` — improved JSON parsing resilience

### Definition of Done
- [ ] `bun run gittributor run` resolves GitHub token from `gh auth token` when `GITHUB_TOKEN` is unset
- [ ] `bun run gittributor run` does NOT block on stdin for review approval
- [ ] `bun run gittributor run --dry-run` still shows review output without auto-approving
- [ ] PR size guard logs explicit reason when skipping
- [ ] `bunx tsc --noEmit` passes with zero errors
- [ ] No new dependencies added

### Must Have
- `GITHUB_TOKEN` env var remains the PRIMARY token source
- `gh auth token` is FALLBACK ONLY (subprocess call)
- `Bun.spawnSync` exit code checked — graceful fallback if `gh` not installed
- `autoApprove: true` in automated `run` pipeline (non-dry-run)
- `--dry-run` preserves current review behavior exactly
- Explicit log message when PR size guard triggers

### Must NOT Have (Guardrails)
- ❌ New CLI flags (no `--auto-approve`)
- ❌ New configuration files or config schema
- ❌ Token caching/refresh mechanism
- ❌ Changes to discover, analyze, or ai.ts logic
- ❌ New dependencies
- ❌ Refactoring of pipeline orchestration structure in `run.ts`
- ❌ JSDoc/documentation additions
- ❌ New utility/helper files — all changes inline in existing files
- ❌ Changes to `src/lib/ai.ts` (already fixed in previous session)

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: YES (bun test)
- **Automated tests**: None for these specific changes (existing tests should pass)
- **Framework**: bun test

### QA Policy
Every task includes agent-executed QA scenarios using Bash/tmux.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **CLI tool**: Use Bash — run commands, validate stdout/stderr, check exit codes
- **Static analysis**: Use Bash — `bunx tsc --noEmit`, `bun test`

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately — 4 independent fixes):
├── Task 1: Fix GITHUB_TOKEN fallback with gh auth token [quick]
├── Task 2: Fix autoApprove in automated run pipeline [quick]
├── Task 3: Add explicit PR size guard logging [quick]
└── Task 4: Improve fix-generator JSON parsing resilience [quick]

Wave FINAL (After ALL tasks — 4 parallel reviews, then user okay):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Real CLI QA (unspecified-high)
└── Task F4: Scope fidelity check (deep)
→ Present results → Get explicit user okay
```

### Dependency Matrix

| Task | Depends On | Blocks |
|------|-----------|--------|
| 1 | None | F1-F4 |
| 2 | None | F1-F4 |
| 3 | None | F1-F4 |
| 4 | None | F1-F4 |
| F1-F4 | 1, 2, 3, 4 | None |

### Agent Dispatch Summary

- **Wave 1**: **4 agents** — T1→`quick`, T2→`quick`, T3→`quick`, T4→`quick`
- **Wave FINAL**: **4 agents** — F1→`oracle`, F2→`unspecified-high`, F3→`unspecified-high`, F4→`deep`

---

## TODOs

- [x] 1. Fix GITHUB_TOKEN Resolution with `gh auth token` Fallback

  **What to do**:
  - Modify `getGitHubToken()` in `src/commands/run.ts:115-117`
  - Keep `Bun.env.GITHUB_TOKEN?.trim()` as the PRIMARY source
  - Add fallback: if env var is empty/undefined, call `Bun.spawnSync(["gh", "auth", "token"])`
  - Check `exitCode === 0` from spawnSync result before using stdout
  - Trim the stdout output (token string)
  - If both fail, return `undefined` (existing behavior — triggers warning at line 127-130)
  - Also add upfront token validation at the START of the `run` command (before processing repos) — if no token is available AND not in dry-run mode, log a clear error and exit early instead of processing repos only to fail at submit

  **Must NOT do**:
  - Do NOT create a new utility file — keep the change inline in `getGitHubToken()`
  - Do NOT add token caching or refresh logic
  - Do NOT change the function signature (still returns `string | undefined`)
  - Do NOT add new dependencies
  - Do NOT touch any file other than `src/commands/run.ts`

  **Recommended Agent Profile**:
  - **Subagent Type**: `quick`
    - Reason: Single-file, <15 lines change, straightforward subprocess fallback
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3, 4)
  - **Blocks**: F1-F4
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - `src/commands/run.ts:115-117` — Current `getGitHubToken()` implementation. Only reads `Bun.env.GITHUB_TOKEN?.trim()`. This is what you're extending with the fallback.
  - `src/commands/run.ts:127-130` — The token check that logs "GITHUB_TOKEN not set" and returns false. This existing error handling pattern stays — your fallback runs BEFORE this check.
  - `src/commands/run.ts:111-113` — `isDryRun()` pattern. Shows how env vars are read in this file — follow same style.

  **API/Type References**:
  - Bun.spawnSync API: `Bun.spawnSync(["gh", "auth", "token"])` returns `{ exitCode: number, stdout: Buffer, stderr: Buffer }`. Use `result.stdout.toString().trim()` for the token string.

  **WHY Each Reference Matters**:
  - `run.ts:115-117`: The exact function being modified
  - `run.ts:127-130`: Downstream consumer — shows what happens when token is undefined
  - `run.ts:111-113`: Code style reference — follow same pattern

  **Acceptance Criteria**:
  - [ ] `getGitHubToken()` first tries `Bun.env.GITHUB_TOKEN`
  - [ ] If env var empty, calls `Bun.spawnSync(["gh", "auth", "token"])`
  - [ ] Checks `exitCode === 0` before using stdout
  - [ ] Returns `undefined` if both fail (no crash)
  - [ ] `bunx tsc --noEmit` passes (ignore pre-existing errors in test files)
  - [ ] No new files created

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Token resolved from gh auth when GITHUB_TOKEN unset
    Tool: Bash
    Preconditions: User has `gh auth login` configured
    Steps:
      1. Run: GITHUB_TOKEN="" bun run -e "const mod = await import('./src/commands/run.ts'); console.log(typeof mod)"
         - Verifies the module loads without crash
      2. Run: gh auth token
         - Capture output, confirm non-empty string
      3. Grep src/commands/run.ts for "spawnSync" or "gh.*auth.*token"
         - Confirm the fallback code exists
    Expected Result: Module loads without error; `gh auth token` returns valid token; fallback code present
    Failure Indicators: Module import crashes; no spawnSync in source
    Evidence: .sisyphus/evidence/task-1-token-fallback.txt

  Scenario: Graceful fallback when gh is not available
    Tool: Bash
    Preconditions: None
    Steps:
      1. Run: GITHUB_TOKEN="" PATH="" bun run -e "const mod = await import('./src/commands/run.ts'); console.log('loaded')"
         - With empty PATH, `gh` binary won't be found
      2. Verify the module still loads (no unhandled exception)
    Expected Result: Module loads, no crash. Token will be undefined.
    Failure Indicators: Unhandled exception, process crash
    Evidence: .sisyphus/evidence/task-1-no-gh-fallback.txt
  ```

  **Commit**: YES
  - Message: `fix(run): add gh auth token fallback for GITHUB_TOKEN resolution`
  - Files: `src/commands/run.ts`
  - Pre-commit: `bunx tsc --noEmit`

- [x] 2. Fix Auto-Approve Review in Automated Pipeline Mode

  **What to do**:
  - Change line 493 in `src/commands/run.ts` from `await review({ autoApprove: options.dryRun })` to `await review({ autoApprove: true })`
  - This ensures the automated `run` command always auto-approves reviews (no stdin blocking)
  - Verify that the dry-run path at line 432 (`await review({ autoApprove: true })`) is NOT affected
  - Verify the `review` function signature in `src/commands/review.ts:160-213` — confirm `autoApprove` parameter is already supported

  **Must NOT do**:
  - Do NOT add a new `--auto-approve` CLI flag
  - Do NOT modify `src/commands/review.ts` (it already supports `autoApprove`)
  - Do NOT change the dry-run path (line 432 already passes `autoApprove: true`)

  **Recommended Agent Profile**:
  - **Subagent Type**: `quick`
    - Reason: Single-line change in one file, exact location known
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3, 4)
  - **Blocks**: F1-F4
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - `src/commands/run.ts:493` — THE line to change: `await review({ autoApprove: options.dryRun })`. Change `options.dryRun` to `true`.
  - `src/commands/run.ts:432` — Dry-run path already passes `autoApprove: true`. This is the CORRECT pattern to follow.
  - `src/commands/review.ts:160-213` — The `reviewFixes()` function. Confirms `autoApprove` is already supported.
  - `src/commands/review.ts:176-180` — The `readDecision(io)` call that blocks on stdin. This is what `autoApprove: true` bypasses.

  **API/Type References**:
  - `src/commands/run.ts:28` — Pipeline dependency injection: `reviewFix: (options?: { autoApprove?: boolean }) => Promise<number>`.

  **WHY Each Reference Matters**:
  - `run.ts:493`: The exact line being changed
  - `run.ts:432`: Proves the pattern already exists for dry-run
  - `review.ts:160-213`: Confirms no changes needed in review.ts

  **Acceptance Criteria**:
  - [ ] Line 493 passes `autoApprove: true` instead of `autoApprove: options.dryRun`
  - [ ] `bunx tsc --noEmit` passes
  - [ ] `review.ts` is NOT modified
  - [ ] Dry-run path (line 432) unchanged

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Automated run does not block on stdin
    Tool: Bash
    Preconditions: gittributor project built
    Steps:
      1. Run: grep -n "autoApprove" src/commands/run.ts
         - Verify line ~493 shows `autoApprove: true` (not `options.dryRun`)
         - Verify line ~432 still shows `autoApprove: true` (unchanged)
      2. Run: timeout 5 bun run gittributor run --help 2>&1 || true
         - Verify the command doesn't hang
    Expected Result: Line 493 has `autoApprove: true`; line 432 unchanged; command exits cleanly
    Failure Indicators: Line 493 still has `options.dryRun`; command hangs
    Evidence: .sisyphus/evidence/task-2-auto-approve.txt

  Scenario: Dry-run path preserved
    Tool: Bash
    Preconditions: None
    Steps:
      1. Run: grep -n "autoApprove.*true" src/commands/run.ts
         - Should show TWO lines: one at ~432 and one at ~493
      2. Run: grep -n "dryRun" src/commands/run.ts | head -20
         - Verify `dryRun` is still used elsewhere
    Expected Result: Both lines show `autoApprove: true`; dryRun still used in other contexts
    Failure Indicators: Only one match; dryRun references removed
    Evidence: .sisyphus/evidence/task-2-dry-run-preserved.txt
  ```

  **Commit**: YES
  - Message: `fix(run): auto-approve review in automated pipeline mode`
  - Files: `src/commands/run.ts`
  - Pre-commit: `bunx tsc --noEmit`

- [x] 3. Add Explicit Logging When PR Size Guard Triggers

  **What to do**:
  - At `src/commands/run.ts:139-142`, enhance the PR size guard logging
  - Add a `warn()` call (using the existing `warn` import) for colored warning format
  - Include the repo name in the message so user knows WHICH repo was skipped
  - Check if there are other silent skip points in `submitPRForResult` that lack logging

  **Must NOT do**:
  - Do NOT change the threshold values (5 files, 200 LOC)
  - Do NOT add new imports — `warn` is already imported
  - Do NOT touch any file other than `src/commands/run.ts`

  **Recommended Agent Profile**:
  - **Subagent Type**: `quick`
    - Reason: Tiny enhancement, single file, <5 lines changed
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 4)
  - **Blocks**: F1-F4
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - `src/commands/run.ts:139-142` — Current PR size guard. Uses `process.stdout.write` instead of `warn()`. Enhance to use `warn()` for consistency.
  - `src/commands/run.ts:128` — Example of `warn()` usage: `warn("GITHUB_TOKEN not set. Skipping PR submission.")`. Follow this pattern.
  - `src/commands/run.ts:119-130` — The `submitPRForResult` function. Check all early-return paths for adequate logging.

  **WHY Each Reference Matters**:
  - `run.ts:139-142`: The exact code to enhance
  - `run.ts:128`: Shows existing `warn()` pattern to follow
  - `run.ts:119-130`: Full function context to check for other silent skips

  **Acceptance Criteria**:
  - [ ] PR size guard uses `warn()` for colored warning output
  - [ ] Message includes repo name (available from function parameter `repoFullName`)
  - [ ] `bunx tsc --noEmit` passes
  - [ ] No threshold values changed

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: PR size guard log includes repo name
    Tool: Bash
    Preconditions: None
    Steps:
      1. Run: grep -n "too large\|SKIP.*Fix\|size guard" src/commands/run.ts
         - Verify the warning message includes repo name reference
      2. Run: grep -n "warn(" src/commands/run.ts
         - Verify warn() is used for the size guard message
    Expected Result: Size guard message references repoFullName; warn() is used
    Failure Indicators: Message doesn't include repo name; still using only process.stdout.write
    Evidence: .sisyphus/evidence/task-3-pr-guard-logging.txt

  Scenario: Threshold values unchanged
    Tool: Bash
    Preconditions: None
    Steps:
      1. Run: grep -n "fileCount > 5\|totalLinesChanged > 200" src/commands/run.ts
         - Verify both thresholds still present with original values
    Expected Result: Both `> 5` and `> 200` thresholds present unchanged
    Failure Indicators: Threshold values modified or missing
    Evidence: .sisyphus/evidence/task-3-thresholds-unchanged.txt
  ```

  **Commit**: YES
  - Message: `fix(run): improve PR size guard logging with repo name and warn()`
  - Files: `src/commands/run.ts`
  - Pre-commit: `bunx tsc --noEmit`

- [x] 4. Improve Fix-Generator JSON Parsing Resilience

  **What to do**:
  - In `src/lib/fix-generator.ts`, improve JSON parsing of LLM responses:
    1. Strip markdown code fences before `JSON.parse()`
    2. Add try/catch with informative error message
    3. Filter out changes with empty `modified` field before validation
  - In `src/lib/anthropic.ts:163-165`:
    1. Default `relevantFiles` to `[]` if undefined/null
    2. Filter out non-string entries from `relevantFiles` array
  - Keep `validateFixScope()` at `fix-generator.ts:111-123` strict

  **Must NOT do**:
  - Do NOT relax `validateFixScope()` — scope validation stays strict
  - Do NOT change LLM prompts (system prompt at line 141 or analysis prompt at line 151)
  - Do NOT add new dependencies
  - Do NOT change timeout/retry logic in `ai.ts`
  - Do NOT create new files

  **Recommended Agent Profile**:
  - **Subagent Type**: `quick`
    - Reason: Small defensive-coding changes in 2 files, well-scoped
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 3)
  - **Blocks**: F1-F4
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - `src/lib/fix-generator.ts:111-123` — `validateFixScope()`. Do NOT modify — scope validation stays strict.
  - `src/lib/fix-generator.ts` (find JSON.parse call) — Where LLM response is parsed. Add code fence stripping and try/catch here.
  - `src/lib/anthropic.ts:163-165` — Where `relevantFiles` is extracted. Add null fallback and type filtering.
  - `src/lib/anthropic.ts:151` — Analysis prompt. Do NOT modify, just handle bad responses gracefully.

  **WHY Each Reference Matters**:
  - `fix-generator.ts:111-123`: Scope validation — executor must understand what it expects
  - `fix-generator.ts` JSON parse: The exact location to add resilience
  - `anthropic.ts:163-165`: Where relevantFiles parsing happens — add null safety
  - `anthropic.ts:151`: Context for expected response format (DO NOT MODIFY)

  **Acceptance Criteria**:
  - [ ] JSON parsing strips markdown code fences before `JSON.parse()`
  - [ ] JSON parsing has try/catch with informative error
  - [ ] Empty `modified` content changes filtered out before scope validation
  - [ ] `relevantFiles` defaults to `[]` if undefined/null
  - [ ] `relevantFiles` entries filtered to strings only
  - [ ] `validateFixScope()` logic unchanged
  - [ ] LLM prompts unchanged
  - [ ] `bunx tsc --noEmit` passes

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Code fence stripping present in fix-generator
    Tool: Bash
    Preconditions: None
    Steps:
      1. Run: grep -n "replace\|fence\|strip\|\`\`\`" src/lib/fix-generator.ts
         - Verify code fence stripping logic exists
      2. Run: grep -n "try\|catch\|JSON.parse" src/lib/fix-generator.ts
         - Verify JSON.parse is wrapped in try/catch
    Expected Result: Code fence stripping and try/catch around JSON.parse present
    Failure Indicators: No code fence handling; JSON.parse without try/catch
    Evidence: .sisyphus/evidence/task-4-json-resilience.txt

  Scenario: relevantFiles null safety in anthropic.ts
    Tool: Bash
    Preconditions: None
    Steps:
      1. Run: grep -n "relevantFiles" src/lib/anthropic.ts
         - Verify there's a fallback (|| [], ?? []) for relevantFiles
      2. Run: grep -n "filter\|typeof.*string" src/lib/anthropic.ts
         - Verify string-type filtering exists
    Expected Result: Null fallback and type filtering present
    Failure Indicators: No fallback; no type filter
    Evidence: .sisyphus/evidence/task-4-relevant-files-safety.txt

  Scenario: validateFixScope unchanged
    Tool: Bash
    Preconditions: None
    Steps:
      1. Run: grep -A 15 "validateFixScope" src/lib/fix-generator.ts
         - Compare with known implementation
    Expected Result: validateFixScope logic identical to original
    Failure Indicators: Scope check relaxed or modified
    Evidence: .sisyphus/evidence/task-4-scope-unchanged.txt
  ```

  **Commit**: YES
  - Message: `fix(fix-generator): improve JSON parsing resilience for LLM responses`
  - Files: `src/lib/fix-generator.ts`, `src/lib/anthropic.ts`
  - Pre-commit: `bunx tsc --noEmit`

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.

- [x] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, grep for pattern). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in `.sisyphus/evidence/`. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **Code Quality Review** — `unspecified-high`
  Run `bunx tsc --noEmit` + `bun test`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names.
  Output: `Build [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [x] F3. **Real CLI QA** — `unspecified-high`
  Execute EVERY QA scenario from EVERY task. For token: test with/without GITHUB_TOKEN. For review: verify no stdin blocking. For PR guard: verify log output. Save evidence to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | VERDICT`

- [x] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff. Verify nothing beyond spec was built. Check "Must NOT do" compliance. Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **Task 1**: `fix(run): add gh auth token fallback for GITHUB_TOKEN resolution` — `src/commands/run.ts`
- **Task 2**: `fix(run): auto-approve review in automated pipeline mode` — `src/commands/run.ts`
- **Task 3**: `fix(run): add explicit logging when PR size guard triggers` — `src/commands/run.ts`
- **Task 4**: `fix(fix-generator): improve JSON parsing resilience for LLM responses` — `src/lib/fix-generator.ts`
- Pre-commit for all: `bunx tsc --noEmit && bun test`

---

## Success Criteria

### Verification Commands
```bash
bunx tsc --noEmit                    # Expected: no errors
bun test                             # Expected: all tests pass
gh auth token                        # Expected: outputs valid token
GITHUB_TOKEN="" bun run gittributor run --dry-run  # Expected: resolves token via gh, no stdin blocking
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] All tests pass
- [ ] Pipeline completes without stdin blocking


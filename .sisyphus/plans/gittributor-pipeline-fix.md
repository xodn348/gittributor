# Fix Gittributor Pipeline — Multi-Label Search & Repo Iteration

## TL;DR

> **Quick Summary**: Fix 2 remaining bugs preventing `bun run src/index.ts run` from completing: (1) `searchIssues()` ignores `opts.labels` and hardcodes `"good first issue"`, (2) `selectRepositoryForAnalysis()` only tries `repositories[0]`. Also commit the already-fixed Bug 3 (isUnassigned filter removal).
> 
> **Deliverables**:
> - `src/lib/github.ts` — multi-label search with dedup
> - `src/index.ts` — repo iteration fallback
> - `tests/github.test.ts` — updated + new tests for multi-label behavior
> - `src/commands/analyze.ts` — commit existing Bug 3 fix
> - 3 atomic commits
> 
> **Estimated Effort**: Short
> **Parallel Execution**: YES — 2 waves + final
> **Critical Path**: Task 1 + Task 2 (parallel) → Task 3 + Task 4 (parallel) → Task 5 (commit)

---

## Context

### Original Request
User: "bun run gittributor run 이걸로 왜 e2e 파이프라인이 실행 안되는지 확인해. 그리고 어디 고쳐야될지, 전체 코드베이스 탐색해, 버그 수정해." (Check why the e2e pipeline doesn't run, explore codebase, fix bugs.)

### Interview Summary
**Key Discussions**:
- Root cause traced across 8+ sessions with multiple explore agents
- 5 bugs identified total, 3 already fixed (2 committed as ea69a00, 1 on disk uncommitted)
- Pipeline fails at "No issues available. Run 'analyze' first." because analyze finds 0 issues
- freeCodeCamp (repos[0]) uses label "first timers only", not "good first issue"

**Research Findings**:
- `gh search issues` uses AND logic for multiple `--label` flags — must search one label at a time
- `ISSUE_LABELS = ["good first issue", "good-first-issue", "beginner", "help wanted"]` already defined but ignored
- Existing tests at `tests/github.test.ts` actively ASSERT the broken behavior (3 tests will break)
- `getIssueReactions` is called per issue — dedup must happen BEFORE reaction fetching to avoid wasted API calls

### Metis Review
**Identified Gaps** (addressed):
- Tests assert broken behavior → Plan includes test updates as prerequisite tasks
- Dedup must happen before `getIssueReactions` → Specified in implementation task
- Empty labels fallback needed → Default to `["good first issue"]` when `opts.labels` is empty
- All-repos-fail case unaddressed → Throw descriptive `CLIEntrypointError`
- Rate limiting risk with 4 labels × N repos → Accepted; sequential search mitigates

---

## Work Objectives

### Core Objective
Make `bun run src/index.ts run` complete the discover → analyze pipeline by searching across all configured labels and iterating repos until issues are found.

### Concrete Deliverables
- `src/lib/github.ts:searchIssues()` iterates `opts.labels` and deduplicates
- `src/index.ts:selectRepositoryForAnalysis()` or `runAnalyzeCommand()` iterates repos
- `tests/github.test.ts` updated for new behavior + new dedup test
- 3 atomic git commits (Bug 3, Bug 4, Bug 5)

### Definition of Done
- [ ] `bun test` passes all tests in `/Users/jnnj92/gittributor`
- [ ] `grep -n "good first issue" src/lib/github.ts` returns 0 matches (hardcoded label gone)
- [ ] `grep -c "opts.labels" src/lib/github.ts` returns ≥ 1

### Must Have
- `searchIssues()` uses ALL labels from `opts.labels`, one `gh search` per label
- Deduplication by issue number BEFORE `getIssueReactions` calls
- Fallback to `["good first issue"]` when `opts.labels` is empty
- Repo iteration: try next repo when current yields 0 issues
- Descriptive error when ALL repos yield 0 issues
- All existing + new tests pass

### Must NOT Have (Guardrails)
- DO NOT change `ISSUE_LABELS` array contents (no adding "first timers only")
- DO NOT change `discoverIssues()` function
- DO NOT change `searchIssues` function signature
- DO NOT add parallel label searches (sequential is fine for 4 labels)
- DO NOT add new dependencies or config options
- DO NOT add progress indicators or logging changes
- DO NOT refactor beyond the specific bug fixes
- DO NOT touch scoring logic, filter logic, or state management

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: YES — `bun test` with tests in `tests/` directory
- **Automated tests**: YES (TDD) — write/update tests first, then implement
- **Framework**: `bun test`
- Each task follows RED (failing test) → GREEN (minimal impl) → REFACTOR

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **CLI**: Use Bash — run `bun test`, capture exit code and output
- **Code verification**: Use Grep — verify patterns present/absent in source

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately — TDD: write failing tests):
├── Task 1: Update/add tests for multi-label searchIssues (Bug 4)
└── Task 2: Add test for repo iteration fallback (Bug 5)

Wave 2 (After Wave 1 — implement fixes):
├── Task 3: Implement multi-label search in searchIssues (Bug 4)
└── Task 4: Implement repo iteration in selectRepositoryForAnalysis (Bug 5)

Wave 3 (After Wave 2 — commit + verify):
└── Task 5: Commit all changes atomically + final verification

Wave FINAL (After ALL tasks):
├── Task F1: Plan compliance audit
├── Task F2: Code quality review
├── Task F3: Real QA — run bun test, verify grep assertions
└── Task F4: Scope fidelity check
→ Present results → Get explicit user okay
```

### Dependency Matrix

| Task | Blocked By | Blocks |
|------|-----------|--------|
| 1 | None | 3 |
| 2 | None | 4 |
| 3 | 1 | 5 |
| 4 | 2 | 5 |
| 5 | 3, 4 | F1-F4 |
| F1-F4 | 5 | None |

### Agent Dispatch Summary

- **Wave 1**: 2 tasks → T1 `unspecified-low`, T2 `unspecified-low`
- **Wave 2**: 2 tasks → T3 `unspecified-high`, T4 `unspecified-high`
- **Wave 3**: 1 task → T5 `unspecified-low`
- **FINAL**: 4 tasks → F1 `oracle`, F2 `unspecified-high`, F3 `unspecified-high`, F4 `deep`

---

## TODOs

- [x] 1. TDD: Update/add tests for multi-label searchIssues (Bug 4)

  **What to do**:
  - In `tests/github.test.ts`, find and update 3 existing tests that assert the hardcoded `"good first issue"` behavior:
    - ~Line 102: Main `searchIssues` test — update to assert that EACH label in `opts.labels` triggers a separate `gh search issues` command
    - ~Line 171: Empty labels test — update to assert fallback to `["good first issue"]` when `opts.labels` is `[]`
    - ~Line 303: The test titled `"searchIssues ignores additional labels and only queries good first issue"` — RENAME and rewrite to assert the OPPOSITE: that each label IS used
  - Add 1 NEW test: "searchIssues deduplicates issues across label searches"
    - Mock 2 label searches returning overlapping issue numbers (e.g., issue #42 appears in both)
    - Assert final result contains #42 only once
    - Assert `getIssueReactions` is called only once for #42 (not twice)
  - After writing tests, run `bun test tests/github.test.ts` — tests should FAIL (RED phase)

  **Must NOT do**:
  - Do NOT modify `src/lib/github.ts` — only test files
  - Do NOT change the `searchIssues` function signature in tests

  **Recommended Agent Profile**:
  - **Subagent**: `hephaestus`
    - Reason: Autonomous worker that can explore test patterns, write tests, and verify they fail
  - **Skills**: [`test-driven-development`]
    - `test-driven-development`: This IS the RED phase of TDD — writing failing tests first

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Task 2)
  - **Blocks**: Task 3
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - `tests/github.test.ts:102-160` — Existing `searchIssues` test showing mock pattern with `spyOn(Bun, "spawn")` and `createMockProcess()`. The executor must understand this mock pattern to write new tests correctly.
  - `tests/github.test.ts:171-199` — Empty labels test showing how `opts.labels: []` is tested. Must be updated for new fallback behavior.
  - `tests/github.test.ts:303` — The test asserting labels are IGNORED. This test must be completely rewritten to assert the opposite.

  **API/Type References**:
  - `src/lib/github.ts:77-95` — Current `searchIssues` signature: `(repoFullName: string, opts: { labels: string[]; limit: number }): Promise<Issue[]>`. Tests must match this signature.
  - `src/types/index.ts:16-29` — `Issue` interface defining the shape of returned objects. Tests need mock data matching this shape.

  **WHY Each Reference Matters**:
  - `tests/github.test.ts:102-160`: Copy this exact mock pattern (`spyOn`, `createMockProcess`, mock JSON response) for new tests. The executor CANNOT write correct tests without understanding how `Bun.spawn` is mocked in this project.
  - `tests/github.test.ts:303`: This is the test that ENFORCES the bug. Must be found and rewritten.
  - `src/lib/github.ts:77-95`: Need to know the function signature to write tests that will pass after Bug 4 implementation.

  **Acceptance Criteria**:
  - [ ] 3 existing tests updated to assert multi-label behavior
  - [ ] 1 new dedup test added
  - [ ] `bun test tests/github.test.ts` runs (tests FAIL is expected — RED phase)
  - [ ] No changes to any `src/` files

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Tests exist and run (RED phase — failures expected)
    Tool: Bash
    Preconditions: Working directory is /Users/jnnj92/gittributor
    Steps:
      1. Run: bun test tests/github.test.ts 2>&1
      2. Assert: exit code is non-zero (tests should FAIL because implementation hasn't changed yet)
      3. Assert: output contains test names matching "deduplicates issues" or "multi-label" or similar
      4. Run: grep -c "opts.labels" tests/github.test.ts
      5. Assert: count is ≥ 3 (tests reference opts.labels)
    Expected Result: Tests run but fail. Grep confirms multi-label test patterns exist.
    Failure Indicators: Tests pass (means tests don't actually test the new behavior), or tests don't compile
    Evidence: .sisyphus/evidence/task-1-red-phase.txt

  Scenario: Old hardcoded assertion removed
    Tool: Bash
    Preconditions: Task 1 complete
    Steps:
      1. Run: grep -n "ignores additional labels" tests/github.test.ts
      2. Assert: 0 matches (old test name removed)
      3. Run: grep -c "good first issue" tests/github.test.ts
      4. Assert: count decreased from original (some references remain for fallback test, but not as the ONLY label)
    Expected Result: The test asserting labels are ignored no longer exists
    Failure Indicators: Old test name still present
    Evidence: .sisyphus/evidence/task-1-old-test-removed.txt
  ```

  **Commit**: NO (groups with Task 3)

- [x] 2. TDD: Add test for repo iteration fallback (Bug 5)

  **What to do**:
  - Determine where `selectRepositoryForAnalysis` is tested. Check `tests/` for existing tests of this function. If none exist, create a new test in the appropriate test file.
  - The current function signature is `(repositories: Repository[]): Repository` — it takes repos and returns one. The Bug 5 fix will change the calling code in `runAnalyzeCommand` to iterate repos and call `discoverIssues` on each. The test should reflect this new behavior.
  - Write tests for the NEW behavior (the iteration logic, wherever it ends up):
    - Test 1: "skips repos with no issues and picks first repo with results" — pass 3 repos, mock `discoverIssues` to return `[]` for first, issues for second. Assert second repo is selected.
    - Test 2: "throws CLIEntrypointError when all repos yield 0 issues" — pass 3 repos, mock `discoverIssues` to return `[]` for all. Assert error message: `"No issues found across all repositories."` or similar.
  - Run `bun test` on the test file — tests should FAIL (RED phase)

  **Must NOT do**:
  - Do NOT modify `src/index.ts` — only test files
  - Do NOT add repo ranking or scoring logic in tests

  **Recommended Agent Profile**:
  - **Subagent**: `hephaestus`
    - Reason: Autonomous worker that can explore test structure and write failing tests
  - **Skills**: [`test-driven-development`]
    - `test-driven-development`: RED phase — writing failing tests for behavior that doesn't exist yet

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Task 1)
  - **Blocks**: Task 4
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - `src/index.ts:299-307` — Current `selectRepositoryForAnalysis` implementation. Only picks `repositories[0]`. The test should test the NEW iteration behavior that will replace this.
  - `src/index.ts:388-402` — `runAnalyzeCommand` which calls `selectRepositoryForAnalysis` and then `discoverIssues`. The iteration logic may end up here instead of in `selectRepositoryForAnalysis`. Tests should be flexible.
  - `tests/github.test.ts` — Look at the test patterns used here (mock setup, assertion style) and follow the same conventions.

  **API/Type References**:
  - `src/types/index.ts:1-14` — `Repository` interface shape. Test mock data must match.
  - `src/types/index.ts:16-29` — `Issue` interface shape. Mock issue data must match.
  - `src/index.ts:309-317` — `selectIssueForFix` — similar pattern to `selectRepositoryForAnalysis`. Shows the error throwing convention.

  **WHY Each Reference Matters**:
  - `src/index.ts:299-307`: The executor must understand the CURRENT behavior to know what the test should assert INSTEAD.
  - `src/index.ts:388-402`: The iteration logic may modify this function rather than `selectRepositoryForAnalysis`. Tests must be written to verify the observable behavior (correct repo selected) regardless of WHERE the iteration happens.
  - `src/types/index.ts:1-14`: Mock `Repository` objects in tests must have the correct shape.

  **Acceptance Criteria**:
  - [ ] 2 new tests for repo iteration behavior
  - [ ] Tests run but FAIL (RED phase — implementation not done yet)
  - [ ] No changes to any `src/` files

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Repo iteration tests exist and fail (RED phase)
    Tool: Bash
    Preconditions: Working directory is /Users/jnnj92/gittributor
    Steps:
      1. Find the test file: ls tests/ | grep -i "index\|cli\|entrypoint\|analyze"
      2. Run: bun test <found-test-file> 2>&1
      3. Assert: exit code is non-zero (tests FAIL)
      4. Assert: output mentions repo iteration or repository selection test names
    Expected Result: Tests exist, compile, run, and fail because implementation hasn't changed
    Failure Indicators: Tests pass (wrong — means they're not testing new behavior), or file not found
    Evidence: .sisyphus/evidence/task-2-red-phase.txt

  Scenario: Error case test exists
    Tool: Bash
    Preconditions: Task 2 complete
    Steps:
      1. Run: grep -n "CLIEntrypointError\|No issues found" tests/*.test.ts
      2. Assert: at least 1 match in a test file (error case is tested)
    Expected Result: Error case test asserts CLIEntrypointError is thrown
    Failure Indicators: No grep matches
    Evidence: .sisyphus/evidence/task-2-error-test.txt
  ```

  **Commit**: NO (groups with Task 4)

- [x] 3. Implement multi-label search in searchIssues (Bug 4)

  **What to do**:
  - In `src/lib/github.ts`, modify `searchIssues()` (lines 77-115) to:
    1. If `opts.labels` is empty, default to `["good first issue"]`
    2. Loop over each label in `opts.labels` and run a SEPARATE `gh search issues` command per label
    3. Collect all results into a `Map<number, IssueSearchResult>` keyed by issue number for deduplication
    4. AFTER the loop (dedup complete), call `getIssueReactions` on each unique issue
    5. Return the deduplicated array of `Issue` objects
  - Remove the hardcoded `--label "good first issue"` string (lines 87-88)
  - Replace with dynamic label from the loop iteration
  - The dedup MUST happen BEFORE `getIssueReactions` calls (currently at lines 97-114) to avoid wasted API calls
  - Keep the existing `--limit` flag behavior (apply per-label search, not globally)
  - After implementation, run `bun test tests/github.test.ts` — tests from Task 1 should now PASS (GREEN phase)

  **Must NOT do**:
  - Do NOT change the `searchIssues` function signature
  - Do NOT add parallel label searches (use sequential `for...of` loop)
  - Do NOT change `getIssueReactions` implementation
  - Do NOT add logging or progress indicators

  **Recommended Agent Profile**:
  - **Subagent**: `hephaestus`
    - Reason: Autonomous worker for focused implementation with test verification
  - **Skills**: [`test-driven-development`]
    - `test-driven-development`: GREEN phase — make failing tests from Task 1 pass

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Task 4)
  - **Blocks**: Task 5
  - **Blocked By**: Task 1

  **References**:

  **Pattern References**:
  - `src/lib/github.ts:77-115` — Current `searchIssues` implementation. Lines 87-88 have the hardcoded `--label "good first issue"`. Lines 97-114 have the `Promise.all(data.map(...))` with `getIssueReactions`. Dedup must be inserted BETWEEN the search loop and `getIssueReactions`.
  - `src/commands/analyze.ts:7` — `ISSUE_LABELS = ["good first issue", "good-first-issue", "beginner", "help wanted"]` — these are the labels that `opts.labels` will contain at runtime.

  **API/Type References**:
  - `src/lib/github.ts:77` — Function signature: `async searchIssues(repoFullName: string, opts: { labels: string[]; limit: number }): Promise<Issue[]>` — DO NOT CHANGE
  - `src/types/index.ts:16-29` — `Issue` interface shape that must be returned
  - `src/lib/github.ts:97-114` — `getIssueReactions` call pattern — dedup must happen before this block

  **WHY Each Reference Matters**:
  - `src/lib/github.ts:87-88`: This is the EXACT line to replace. The executor must find the hardcoded label string and replace it with dynamic label iteration.
  - `src/lib/github.ts:97-114`: The executor must understand WHERE to insert dedup logic — between the search results collection and the `getIssueReactions` mapping.
  - `src/commands/analyze.ts:7`: Shows what labels will actually be passed. Confirms the implementation needs to handle 4 labels.

  **Acceptance Criteria**:
  - [ ] `bun test tests/github.test.ts` → PASS (GREEN phase — tests from Task 1 now pass)
  - [ ] `grep -n "good first issue" src/lib/github.ts` → 0 matches (hardcoded label removed)
  - [ ] `grep -c "opts.labels" src/lib/github.ts` → ≥ 1 (dynamic labels used)
  - [ ] Dedup logic uses `Map<number, ...>` or equivalent keyed by issue number

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Multi-label tests pass (GREEN phase)
    Tool: Bash
    Preconditions: Task 1 tests written (RED), working directory /Users/jnnj92/gittributor
    Steps:
      1. Run: bun test tests/github.test.ts 2>&1
      2. Assert: exit code is 0 (all tests pass)
      3. Assert: output shows 0 failures
    Expected Result: All searchIssues tests pass including dedup test
    Failure Indicators: Any test failure, non-zero exit code
    Evidence: .sisyphus/evidence/task-3-green-phase.txt

  Scenario: Hardcoded label removed from source
    Tool: Bash
    Preconditions: Task 3 implementation complete
    Steps:
      1. Run: grep -rn "good first issue" src/lib/github.ts
      2. Assert: 0 matches (no hardcoded label string)
      3. Run: grep -n "opts.labels" src/lib/github.ts
      4. Assert: ≥ 1 match (dynamic labels referenced)
      5. Run: grep -n "Map\|dedup\|seen" src/lib/github.ts
      6. Assert: ≥ 1 match (deduplication logic present)
    Expected Result: Source uses opts.labels dynamically with dedup
    Failure Indicators: Hardcoded "good first issue" still in source, or no dedup logic
    Evidence: .sisyphus/evidence/task-3-no-hardcoded-label.txt
  ```

  **Commit**: NO (groups with Task 5)

- [x] 4. Implement repo iteration in runAnalyzeCommand (Bug 5)

  **What to do**:
  - In `src/index.ts`, modify `runAnalyzeCommand()` (lines 388-402) or `selectRepositoryForAnalysis()` (lines 299-307) to:
    1. Instead of blindly picking `repositories[0]`, iterate through ALL repositories
    2. For each repo, call `discoverIssues()` (or `searchIssues` via the existing flow)
    3. If issues are found (length > 0), use THAT repo and continue
    4. If no issues found, try the next repo
    5. If ALL repos yield 0 issues, throw `CLIEntrypointError` with message like `"No issues found across all repositories."`
  - The simplest approach: modify `runAnalyzeCommand` to loop through `repositories` and call the analysis flow for each, stopping at the first success
  - Keep `selectRepositoryForAnalysis` simple or remove it if the loop replaces its purpose
  - After implementation, run `bun test` — tests from Task 2 should now PASS (GREEN phase)

  **Must NOT do**:
  - Do NOT add repo ranking or scoring logic
  - Do NOT add parallel repo searches
  - Do NOT modify `discoverIssues()` function
  - Do NOT change the pipeline state machine

  **Recommended Agent Profile**:
  - **Subagent**: `hephaestus`
    - Reason: Autonomous worker for focused implementation with test verification
  - **Skills**: [`test-driven-development`]
    - `test-driven-development`: GREEN phase — make failing tests from Task 2 pass

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Task 3)
  - **Blocks**: Task 5
  - **Blocked By**: Task 2

  **References**:

  **Pattern References**:
  - `src/index.ts:299-307` — Current `selectRepositoryForAnalysis` implementation. Only returns `repositories[0]`. This is the function to modify or replace with iteration logic.
  - `src/index.ts:388-402` — `runAnalyzeCommand` which calls `selectRepositoryForAnalysis` then `discoverIssues`. The iteration loop may be better placed here.
  - `src/index.ts:309-317` — `selectIssueForFix` — shows the error-throwing pattern (`CLIEntrypointError`). Follow same pattern for all-repos-empty error.

  **API/Type References**:
  - `src/types/index.ts:1-14` — `Repository` interface shape
  - `src/commands/analyze.ts:235-275` — `discoverIssues()` function that gets called per repo. DO NOT modify this function.
  - `src/index.ts:309-317` — `CLIEntrypointError` usage pattern for error throwing

  **WHY Each Reference Matters**:
  - `src/index.ts:299-307`: The executor must see the current blind `repositories[0]` pick to understand what needs to change.
  - `src/index.ts:388-402`: The iteration loop may work better here because this function orchestrates repo selection AND issue discovery together. The executor should decide whether to modify `selectRepositoryForAnalysis` or `runAnalyzeCommand`.
  - `src/index.ts:309-317`: Copy this error-throwing pattern for the all-repos-empty case.

  **Acceptance Criteria**:
  - [ ] `bun test` on repo iteration tests → PASS (GREEN phase)
  - [ ] `grep -n "repositories\[0\]" src/index.ts` → 0 matches OR wrapped in iteration logic
  - [ ] `grep -n "No issues found" src/index.ts` → ≥ 1 match (error message exists)

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Repo iteration tests pass (GREEN phase)
    Tool: Bash
    Preconditions: Task 2 tests written (RED), working directory /Users/jnnj92/gittributor
    Steps:
      1. Run: bun test 2>&1
      2. Assert: exit code is 0 (all tests pass including repo iteration tests)
      3. Assert: output shows 0 failures
    Expected Result: All tests pass including new repo iteration tests
    Failure Indicators: Any test failure, non-zero exit code
    Evidence: .sisyphus/evidence/task-4-green-phase.txt

  Scenario: No blind repository selection
    Tool: Bash
    Preconditions: Task 4 implementation complete
    Steps:
      1. Run: grep -n "selectRepositoryForAnalysis\|repositories\[0\]" src/index.ts
      2. Assert: the selectRepositoryForAnalysis function no longer has a blind repositories[0] pick (may still exist but wrapped in iteration logic)
      3. Run: grep -n "No issues found" src/index.ts
      4. Assert: at least 1 match (error message for all-repos-empty case)
    Expected Result: Iteration logic replaces blind selection
    Failure Indicators: Only repositories[0] with no iteration
    Evidence: .sisyphus/evidence/task-4-no-blind-select.txt
  ```

  **Commit**: NO (groups with Task 5)

- [x] 5. Commit all changes atomically + final verification

  **What to do**:
  - Step 1: Commit Bug 3 fix (already on disk, uncommitted):
    - `git add src/commands/analyze.ts`
    - `git commit -m "fix(analyze): remove isUnassigned filter that excluded most beginner issues"`
  - Step 2: Run `bun test` to verify Bug 3 commit doesn't break anything
  - Step 3: Commit Bug 4 fix:
    - `git add src/lib/github.ts tests/github.test.ts`
    - `git commit -m "fix(github): iterate all configured labels in searchIssues instead of hardcoding"`
  - Step 4: Run `bun test` to verify
  - Step 5: Commit Bug 5 fix:
    - `git add src/index.ts` (and any new/modified test files for Bug 5)
    - `git commit -m "fix(cli): iterate repositories in analysis to skip repos with no matching issues"`
  - Step 6: Run full `bun test` final verification
  - Step 7: Verify with `git log --oneline -3` that 3 atomic commits exist
  - IMPORTANT: Do NOT modify git config user.name or user.email. Use existing global config.

  **Must NOT do**:
  - Do NOT squash commits — keep 3 separate atomic commits
  - Do NOT push to remote
  - Do NOT modify git config identity
  - Do NOT commit any `.sisyphus/` files

  **Recommended Agent Profile**:
  - **Subagent**: `hephaestus`
    - Reason: Autonomous git operations with verification
  - **Skills**: [`verification-before-completion`]
    - `verification-before-completion`: Must verify each commit and final test pass

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3 (sequential after Wave 2)
  - **Blocks**: F1-F4
  - **Blocked By**: Tasks 3, 4

  **References**:

  **Pattern References**:
  - `git log --oneline -5` — Check existing commit style for message format
  - Previous commit `ea69a00` — Bug 1 & 2 fixes already committed with similar fix() convention

  **Acceptance Criteria**:
  - [ ] `bun test` in `/Users/jnnj92/gittributor` → exit code 0, all tests pass
  - [ ] `git log --oneline -3` → shows 3 commits with fix() messages
  - [ ] `git diff HEAD` → clean working tree (no uncommitted changes in src/)

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: All tests pass after all commits
    Tool: Bash
    Preconditions: All 3 commits made, working directory /Users/jnnj92/gittributor
    Steps:
      1. Run: bun test 2>&1
      2. Assert: exit code 0
      3. Assert: output shows all test suites pass, 0 failures
    Expected Result: Full test suite passes
    Failure Indicators: Any test failure, non-zero exit
    Evidence: .sisyphus/evidence/task-5-final-tests.txt

  Scenario: 3 atomic commits exist with correct messages
    Tool: Bash
    Preconditions: All commits made
    Steps:
      1. Run: git log --oneline -3
      2. Assert: 3 lines, each starting with a hash and containing "fix("
      3. Assert: messages reference "analyze", "github", "cli" scopes
      4. Run: git diff HEAD
      5. Assert: empty output (clean working tree)
    Expected Result: 3 clean fix() commits, no uncommitted changes
    Failure Indicators: Wrong number of commits, dirty working tree
    Evidence: .sisyphus/evidence/task-5-commits.txt
  ```

  **Commit**: YES (this IS the commit task)
  - Commit 1: `fix(analyze): remove isUnassigned filter that excluded most beginner issues` — `src/commands/analyze.ts`
  - Commit 2: `fix(github): iterate all configured labels in searchIssues instead of hardcoding` — `src/lib/github.ts`, `tests/github.test.ts`
  - Commit 3: `fix(cli): iterate repositories in analysis to skip repos with no matching issues` — `src/index.ts`, test files
  - Pre-commit: `bun test` after each commit

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists. For each "Must NOT Have": search codebase for forbidden patterns. Check evidence files exist.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Run `bun test` in `/Users/jnnj92/gittributor`. Review `src/lib/github.ts` and `src/index.ts` for: `as any`, empty catches, console.log in prod, commented-out code, unused imports.
  Output: `Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Real QA** — `unspecified-high`
  Execute: `bun test` in `/Users/jnnj92/gittributor`. Verify `grep -rn "good first issue" src/lib/github.ts` returns empty. Verify `grep -c "opts.labels" src/lib/github.ts` returns ≥ 1.
  Output: `Tests [PASS/FAIL] | Grep assertions [N/N] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff (`git diff HEAD~3`). Verify 1:1 correspondence. Check "Must NOT do" compliance. Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **Commit 1**: `fix(analyze): remove isUnassigned filter that excluded most beginner issues` — `src/commands/analyze.ts`
- **Commit 2**: `fix(github): iterate all configured labels in searchIssues instead of hardcoding` — `src/lib/github.ts`, `tests/github.test.ts`
- **Commit 3**: `fix(cli): iterate repositories in analysis to skip repos with no matching issues` — `src/index.ts`
- Pre-commit for each: `bun test` in `/Users/jnnj92/gittributor`

---

## Success Criteria

### Verification Commands
```bash
cd /Users/jnnj92/gittributor && bun test  # Expected: all tests pass, exit code 0
grep -rn "good first issue" src/lib/github.ts  # Expected: 0 matches
grep -c "opts.labels" src/lib/github.ts  # Expected: ≥ 1
git log --oneline -3  # Expected: 3 atomic commits for Bug 3, 4, 5
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] All tests pass
- [ ] 3 atomic commits with descriptive messages

# Fix Zero Contribution Opportunities Bug

## TL;DR

> **Quick Summary**: Fix case-sensitive language comparison in `filterRepoList()` that causes all 30 curated repos to be filtered out, resulting in 0 contribution opportunities. The fix normalizes case at comparison time.
> 
> **Deliverables**:
> - Fixed `src/lib/repo-list.ts:70` — case-insensitive language filtering
> - New test cases in `tests/repo-list.test.ts` for case-insensitive matching
> 
> **Estimated Effort**: Quick (~15 minutes)
> **Parallel Execution**: NO — sequential (1 task)
> **Critical Path**: Task 1 → Verify

---

## Context

### Original Request
User ran `bun run gittributor run` and got 0 contribution opportunities across all 3 languages (typescript, javascript, python). User asked to investigate and fix.

### Interview Summary
**Key Discussions**:
- Root cause traced through full pipeline: `config.ts` → `run.ts` → `discover.ts` → `repo-list.ts`
- Bug confirmed at `repo-list.ts:70`: case-sensitive `.includes()` comparing lowercase config values against Title Case YAML values

**Research Findings**:
- `config.ts:11` — `DEFAULT_CONFIG.targetLanguages` = `["typescript", "javascript", "python"]` (lowercase)
- `repos.yaml` — language fields use Title Case: `"TypeScript"`, `"JavaScript"`, `"Python"`
- `repo-list.ts:70` — `options.languages!.includes(r.language)` does exact match → always `false`
- `getTargetLanguages()` at `config.ts:246` returns `[...config.targetLanguages]` without case transformation

### Metis Review
**Identified Gaps** (addressed):
- Verify no other callers of `filterRepoList` rely on exact-match behavior → addressed in guardrails (normalize at comparison time only, don't mutate data)
- Run `bun test` BEFORE changes to establish baseline → added to acceptance criteria
- Handle mixed-case user config overrides (e.g., `["TypeScript"]`) → `.toLowerCase()` on both sides handles all directions
- Check for empty string language fields → existing `r.language &&` guard covers falsy values

---

## Work Objectives

### Core Objective
Fix the case-sensitive language comparison in `filterRepoList()` so that lowercase config values match Title Case YAML values, restoring repo discovery.

### Concrete Deliverables
- `src/lib/repo-list.ts` — case-insensitive filter at line 70
- `tests/repo-list.test.ts` — new test cases for case-insensitive matching (if test file exists, else add to nearest test)

### Definition of Done
- [ ] `bun test` passes (all existing + new tests)
- [ ] `bun run gittributor run 2>&1 | head -20` shows >0 repos discovered for at least 1 language

### Must Have
- Case-insensitive language comparison in `filterRepoList()`
- Test coverage for the fix
- All existing tests still pass

### Must NOT Have (Guardrails)
- MUST NOT touch `repos.yaml` — YAML matches GitHub API convention, it's correct
- MUST NOT modify `DEFAULT_CONFIG.targetLanguages` casing in `config.ts`
- MUST NOT create utility functions or abstractions — inline `.toLowerCase()` is sufficient
- MUST NOT fix `analyze.ts:356` silent error swallowing — separate concern, separate PR
- MUST NOT refactor the language pipeline (e.g., normalize at config load time)
- MUST NOT add excessive comments or JSDoc

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: YES
- **Automated tests**: YES (Tests-after — add test cases for the fix)
- **Framework**: `bun test`

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **CLI**: Use Bash — run `bun run gittributor run`, capture output, assert >0 repos

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Single task — fix + test + verify):
└── Task 1: Fix case-insensitive comparison + add tests [quick]

Wave FINAL (After Task 1):
├── F1: Plan compliance audit (oracle)
├── F2: Code quality review (unspecified-high)
├── F3: Real CLI QA (unspecified-high)
└── F4: Scope fidelity check (deep)
→ Present results → Get explicit user okay
```

### Dependency Matrix
- **T1**: None → F1-F4
- **F1-F4**: T1 → Done

### Agent Dispatch Summary
- **Wave 1**: **1 task** — T1 → `quick`
- **FINAL**: **4 tasks** — F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep`

---

## TODOs

- [x] 1. Fix case-insensitive comparison in filterRepoList + add tests

  **What to do**:
  1. Run `bun test` to establish baseline (all existing tests must pass before changes)
  2. In `src/lib/repo-list.ts`, line 70, change:
     ```typescript
     filtered = filtered.filter((r) => r.language && options.languages!.includes(r.language))
     ```
     to:
     ```typescript
     filtered = filtered.filter((r) => r.language && options.languages!.map(l => l.toLowerCase()).includes(r.language.toLowerCase()))
     ```
  3. Add test cases to the appropriate test file (`tests/repo-list.test.ts` if it exists, otherwise find the nearest relevant test file):
     - Test: lowercase config `["typescript"]` matches Title Case YAML `"TypeScript"` → returns match
     - Test: lowercase config `["python"]` matches Title Case YAML `"Python"` → returns match
     - Test: mixed case `["JAVASCRIPT"]` matches `"JavaScript"` → returns match
     - Test: exact match still works `["TypeScript"]` matches `"TypeScript"` → returns match
     - Test: non-matching language `["rust"]` does NOT match `"TypeScript"` → filtered out
  4. Run `bun test` — all tests must pass
  5. Run `bun run gittributor run 2>&1 | head -30` — verify >0 repos discovered

  **Must NOT do**:
  - DO NOT touch `repos.yaml`
  - DO NOT modify `config.ts` (no DEFAULT_CONFIG changes)
  - DO NOT extract a utility function — inline `.toLowerCase()` only
  - DO NOT fix `analyze.ts:356`
  - DO NOT add JSDoc or excessive comments
  - DO NOT normalize at config load time — only at comparison time

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single-file bug fix with straightforward test additions. No architectural complexity.
  - **Skills**: []
    - No special skills needed — standard TypeScript editing and test writing.

  **Parallelization**:
  - **Can Run In Parallel**: NO (only task)
  - **Parallel Group**: Wave 1 (solo)
  - **Blocks**: F1, F2, F3, F4
  - **Blocked By**: None (can start immediately)

  **References** (CRITICAL):

  **Pattern References**:
  - `src/lib/repo-list.ts:58-88` — `filterRepoList()` function, the bug is at line 70 inside the `.filter()` callback
  - `src/lib/repo-list.ts:70` — THE BUG LINE: `options.languages!.includes(r.language)` — case-sensitive comparison

  **API/Type References**:
  - `src/lib/config.ts:11` — `DEFAULT_CONFIG.targetLanguages = ["typescript", "javascript", "python"]` — these are the lowercase values coming in
  - `repos.yaml` — language fields use Title Case (`language: TypeScript`, `language: JavaScript`, `language: Python`)

  **Test References**:
  - `tests/` directory — check for existing `repo-list.test.ts`; if absent, check test patterns in other test files (e.g., `tests/run.test.ts`) for import/describe/it conventions

  **WHY Each Reference Matters**:
  - `repo-list.ts:70` — This is the exact line to change. The executor needs to see the current code to apply `.toLowerCase()` correctly
  - `config.ts:11` — Shows why the left side of comparison is lowercase
  - `repos.yaml` — Shows why the right side of comparison is Title Case
  - Test files — Executor needs to follow existing test conventions (import style, describe nesting, assertion library)

  **Acceptance Criteria**:

  - [ ] `bun test` passes before changes (baseline)
  - [ ] `src/lib/repo-list.ts` line 70 uses `.toLowerCase()` on both sides
  - [ ] Test file contains ≥4 new test cases for case-insensitive matching
  - [ ] `bun test` passes after changes (all existing + new)
  - [ ] `bun run gittributor run 2>&1 | head -30` shows >0 repos

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: CLI discovers repos after fix (happy path)
    Tool: Bash
    Preconditions: Fix applied to repo-list.ts
    Steps:
      1. Run: bun run gittributor run 2>&1 | head -30
      2. Assert: output contains a number > 0 before "contribution opportunities" or "repos"
      3. Assert: output does NOT contain "0 contribution opportunities" for all 3 languages
    Expected Result: At least one language shows >0 repos discovered
    Failure Indicators: "0 contribution opportunities" appears for ALL languages, or command errors
    Evidence: .sisyphus/evidence/task-1-cli-discovers-repos.txt

  Scenario: Unit tests for case-insensitive matching (happy path)
    Tool: Bash
    Preconditions: New test cases added
    Steps:
      1. Run: bun test tests/repo-list.test.ts (or wherever tests were added)
      2. Assert: exit code 0
      3. Assert: output shows all new tests passing
    Expected Result: 0 failures, ≥4 new test cases pass
    Failure Indicators: Any test failure or non-zero exit code
    Evidence: .sisyphus/evidence/task-1-unit-tests-pass.txt

  Scenario: Non-matching language is still filtered out (negative case)
    Tool: Bash
    Preconditions: Test includes negative case
    Steps:
      1. Run: bun test — look for test case where language "rust" does not match "TypeScript"
      2. Assert: filterRepoList returns 0 results for non-matching language
    Expected Result: Non-matching languages are correctly excluded
    Failure Indicators: Test for non-matching language fails or is missing
    Evidence: .sisyphus/evidence/task-1-negative-filter.txt
  ```

  **Evidence to Capture:**
  - [ ] `task-1-cli-discovers-repos.txt` — CLI output showing >0 repos
  - [ ] `task-1-unit-tests-pass.txt` — bun test output with all passing
  - [ ] `task-1-negative-filter.txt` — evidence of negative test case

  **Commit**: YES
  - Message: `fix(repo-list): use case-insensitive language comparison in filterRepoList`
  - Files: `src/lib/repo-list.ts`, `tests/repo-list.test.ts`
  - Pre-commit: `bun test`

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. Verify `repo-list.ts` fix exists. Verify no forbidden files were touched (`repos.yaml`, `config.ts`, `analyze.ts`). Check evidence files exist in `.sisyphus/evidence/`. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Run `bun test`. Review `repo-list.ts` changes for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, utility function extraction.
  Output: `Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Real CLI QA** — `unspecified-high`
  Run `bun run gittributor run 2>&1 | head -30`. Verify output shows >0 repos for at least one language. Save output to `.sisyphus/evidence/final-qa/cli-run.txt`.
  Output: `Scenarios [N/N pass] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  Check git diff — only `repo-list.ts` and test file(s) should be changed. No files outside scope. No unaccounted changes.
  Output: `Tasks [N/N compliant] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **Task 1**: `fix(repo-list): use case-insensitive language comparison in filterRepoList`
  - Files: `src/lib/repo-list.ts`, `tests/repo-list.test.ts`
  - Pre-commit: `bun test`

---

## Success Criteria

### Verification Commands
```bash
bun test  # Expected: all tests pass (existing + new)
bun run gittributor run 2>&1 | head -20  # Expected: >0 repos discovered
```

### Final Checklist
- [ ] Case-insensitive comparison in `filterRepoList()` at line 70
- [ ] New test: `filterRepoList([{language: "TypeScript"}], {languages: ["typescript"]})` returns 1 result
- [ ] New test: `filterRepoList([{language: "Python"}], {languages: ["python"]})` returns 1 result
- [ ] All existing tests pass
- [ ] No forbidden files touched
- [ ] `bun run gittributor run` returns >0 repos

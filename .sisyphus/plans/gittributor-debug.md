# Fix All 5 Detectors Returning Zero Contribution Opportunities

## TL;DR

> **Quick Summary**: After the case-insensitive language fix (commit `77f374a`), repos are discovered successfully but ALL 5 detectors in `analyzeSingleRepo()` return empty arrays. Root causes: silent try/catch swallowing clone failures, `detectDocs()` receiving wrong `readmePaths` argument, `detectTypos()` only checking README (too narrow for 1000+ star repos), `detectDeps()` potentially timing out on large dependency lists, and `detectCode()` GitHub issue search returning empty due to label mismatch. Fix each detector independently with proper error surfacing and add one bun:test per detector.
> 
> **Deliverables**:
> - Fixed `src/commands/analyze.ts` — proper error logging, correct data flow to detectors
> - Fixed `src/lib/contribution-detector.ts` — 5 detector functions made robust
> - New test file `tests/contribution-detector.test.ts` — one test per detector proving detection works on known input
> - Debug logging throughout analysis pipeline
> 
> **Estimated Effort**: Medium (~2-3 hours)
> **Parallel Execution**: YES - 3 waves
> **Critical Path**: Task 1 (diagnostic logging) → Tasks 2-6 (parallel detector fixes) → Task 7 (integration test) → F1-F4

---

## Context

### Original Request
User ran `bun run gittributor run` and got 0 contribution opportunities. Previous fix (case-insensitive language filtering) restored repo discovery (7 repos found, >1000 stars, 3 languages), but the analysis phase produces zero results across ALL 5 detector types (typo, docs, deps, test, code).

User's exact words: "코드베이스 전체 디버깅한번하자. 그리고 지금 실제적으로 아무것도 도움이 안되고있어. 내 깃헙 contribution 어떻게 높일거냐고" — Full debugging needed, tool is providing zero practical value.

### Interview Summary
**Key Discussions**:
- Previous session confirmed repos ARE discovered (7 repos), but `analyzeSingleRepo()` returns empty for every repo
- All 5 detectors (`detectTypos`, `detectDocs`, `detectDeps`, `detectTests`, `detectCode`) return `[]`
- Outer try/catch at `analyze.ts:356` uses `debug()` (invisible without debug mode) — errors are silently swallowed

**Research Findings**:
- `analyze.ts:257-258` — `filePaths` is computed via top-level `readdirSync(tempPath)` then passed as `readmePaths` to `detectDocs()` — semantically wrong parameter name but functionally only affects the `filePath` field in results, not detection logic
- `analyze.ts:356` — `catch (error) { debug(...) }` silently swallows ALL errors including clone failures
- `analyze.ts:392-394` — local `readdirSync()` function shadows the `node:fs` import (line 1 doesn't import `readdirSync`)
- `contribution-detector.ts:112-134` — `detectTypos()` only searches README content; well-maintained 1000+ star repos rarely have basic typos in README
- `contribution-detector.ts:206-257` — `detectDeps()` spawns `npm view` for EVERY dependency — can timeout or fail silently
- `contribution-detector.ts:380-401` — `detectCodeIssues()` catches all errors silently
- `github.ts:97-100` — `searchIssues()` uses `gh` CLI — requires auth, rate limits apply
- `contribution-detector.ts:309-376` — `detectTests()` logic seems correct but returns results that never reach the user

### Metis Review
**Identified Gaps** (addressed):
- Clone failures are invisible — add `info()` level logging for clone success/failure
- `detectTypos` is too narrow for polished repos — also scan `.md` files beyond README (use `detectTyposInRepo` which already exists)
- `detectDeps` has no timeout — add subprocess timeout
- `detectCode` silently catches errors — surface them
- Existing 14 tests may not test detector logic directly — add unit tests with synthetic input
- `calculateMergeProbability` receives `{} as ContributionOpportunity` — crashes if it accesses `opportunity.type` (line 454)

---

## Work Objectives

### Core Objective
Make all 5 detectors in the analysis pipeline actually find and return contribution opportunities, with visible error logging when they fail.

### Concrete Deliverables
- `src/commands/analyze.ts` — error surfacing, correct data flow, use `detectTyposInRepo` instead of `detectTypos`
- `src/lib/contribution-detector.ts` — robust error handling in each detector, timeout for subprocess calls
- `tests/contribution-detector.test.ts` — one test per detector with synthetic known-good input
- Visible `info()` logging for each detector's result count

### Definition of Done
- [ ] `bun test` passes (all existing 14 + new detector tests)
- [ ] `bun run gittributor run --dry-run 2>&1` shows >0 contribution opportunities for at least 1 repo
- [ ] Each detector logs its result count via `info()` (visible without debug mode)

### Must Have
- All 5 detectors produce results when applicable (not all empty)
- Visible error messages when a detector fails (not swallowed by catch)
- At least one bun:test per detector proving it works on known input
- `calculateMergeProbability` receives valid `ContributionOpportunity` (not `{} as ...`)

### Must NOT Have (Guardrails)
- MUST NOT touch `src/lib/repo-list.ts` — already fixed in previous PR
- MUST NOT touch `src/lib/guardrails.ts` — star threshold is not the issue
- MUST NOT change CLI interface or command structure
- MUST NOT add new detector types — fix existing 5 only
- MUST NOT refactor architecture (no new abstractions, no detector registry pattern)
- MUST NOT modify `repos.yaml`
- MUST NOT change `config.ts` defaults
- MUST NOT add excessive JSDoc or comments — inline only where error handling is non-obvious

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: YES (bun:test, 14/14 passing)
- **Automated tests**: YES (Tests-after — add test per detector with synthetic input)
- **Framework**: `bun test`

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **CLI**: Use Bash — run `bun run gittributor run --dry-run`, capture output, verify >0 opportunities
- **Unit**: Use Bash — run `bun test`, verify all pass

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately — foundation):
└── Task 1: Add diagnostic info() logging + fix calculateMergeProbability crash [quick]

Wave 2 (After Wave 1 — fix all 5 detectors in PARALLEL):
├── Task 2: Fix detectTypos — use detectTyposInRepo instead [quick]
├── Task 3: Fix detectDocs — correct readmePaths parameter [quick]
├── Task 4: Fix detectDeps — add timeout, surface errors [quick]
├── Task 5: Fix detectTests — verify it produces results [quick]
└── Task 6: Fix detectCode — surface GitHub API errors [quick]

Wave 3 (After Wave 2 — integration + tests):
└── Task 7: Add bun:test per detector + end-to-end dry-run verification [deep]

Wave FINAL (After ALL tasks — 4 parallel reviews):
├── F1: Plan compliance audit (oracle)
├── F2: Code quality review (unspecified-high)
├── F3: Real CLI QA (unspecified-high)
└── F4: Scope fidelity check (deep)
→ Present results → Get explicit user okay
```

### Dependency Matrix
- **T1**: None → T2, T3, T4, T5, T6
- **T2**: T1 → T7
- **T3**: T1 → T7
- **T4**: T1 → T7
- **T5**: T1 → T7
- **T6**: T1 → T7
- **T7**: T2, T3, T4, T5, T6 → F1-F4
- **F1-F4**: T7 → Done

### Agent Dispatch Summary
- **Wave 1**: **1 task** — T1 → `quick` (subagent_type)
- **Wave 2**: **5 tasks** — T2-T6 → `quick` (subagent_type) each, ALL PARALLEL
- **Wave 3**: **1 task** — T7 → `deep` (subagent_type)
- **FINAL**: **4 tasks** — F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep`

---

## TODOs

- [ ] 1. Add diagnostic info() logging + fix calculateMergeProbability crash

  **What to do**:
  1. In `src/commands/analyze.ts`, at the outer try/catch (~line 356):
     - Change `catch (error) { debug(...) }` to `catch (error) { warn(\`[analyze] Failed to analyze ${repo.fullName}: ${error}\`) }`
     - This makes clone failures and other errors VISIBLE without debug mode
  2. Add `info()` logging after each detector call to show result counts:
     - After detectTypos: `info(\`[detectTypos] Found ${typoResults.length} typos in ${repo.fullName}\`)`
     - After detectDocs: `info(\`[detectDocs] Found ${docResults.length} doc gaps in ${repo.fullName}\`)`
     - After detectDeps: `info(\`[detectDeps] Found ${depResults.length} outdated deps in ${repo.fullName}\`)`
     - After detectTests: `info(\`[detectTests] Found ${testResults.length} missing tests in ${repo.fullName}\`)`
     - After detectCode: `info(\`[detectCode] Found ${codeResults.length} code issues in ${repo.fullName}\`)`
  3. Fix `calculateMergeProbability` calls (~lines 269, 288, 309, 327):
     - Currently passes `{} as ContributionOpportunity` — crashes when accessing `.type` (line 454) and `.repo.hasContributing` (line 480)
     - Build a proper partial opportunity object with at least `{ type, repo: { hasContributing } }` before passing
     - Or restructure to call `calculateMergeProbability` AFTER the opportunity object is fully constructed
  4. Run `bun test`

  **Must NOT do**:
  - DO NOT change the detector functions themselves (that's T2-T6)
  - DO NOT add new imports beyond what's needed for logging
  - DO NOT refactor the analysis pipeline structure

  **Recommended Agent Profile**:
  - **Subagent Type**: `quick` (via subagent_type, NEVER category)
    - Reason: Logging changes + parameter fix in one file
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO (foundation task)
  - **Parallel Group**: Wave 1 (solo)
  - **Blocks**: T2, T3, T4, T5, T6
  - **Blocked By**: None

  **References**:
  - `src/commands/analyze.ts:356` — The silent catch block using `debug()` — change to `warn()`
  - `src/commands/analyze.ts:269,288,309,327` — `calculateMergeProbability({} as ContributionOpportunity, {...})` calls
  - `src/lib/contribution-detector.ts:434-494` — `calculateMergeProbability()` function — accesses `opportunity.type` at line 454, `opportunity.repo.hasContributing` at line 480
  - `src/commands/analyze.ts:246-367` — `analyzeSingleRepo()` function — the full analysis pipeline

  **WHY Each Reference Matters**:
  - `analyze.ts:356` — THE critical silent catch that hides all errors — executor must change `debug()` to `warn()`
  - `analyze.ts:269,288,309,327` — Four places where `calculateMergeProbability` is called with empty object — executor needs to see all call sites
  - `contribution-detector.ts:434-494` — The function that crashes — executor needs to see what properties it accesses to know what to provide

  **Acceptance Criteria**:
  - [ ] Catch block at ~line 356 uses `warn()` not `debug()`
  - [ ] Each detector call has an `info()` log showing result count
  - [ ] `calculateMergeProbability` receives an object with at least `type` and `repo.hasContributing` fields
  - [ ] `bun test` passes

  **QA Scenarios:**

  ```
  Scenario: Error logging is visible (happy path)
    Tool: Bash
    Preconditions: Changes applied
    Steps:
      1. Run: grep -n "warn\|info" src/commands/analyze.ts | grep -i "analyze\|detect\|found"
      2. Assert: at least 6 matches (1 catch block + 5 detector logs)
    Expected Result: Logging statements present for catch block and all 5 detectors
    Failure Indicators: Fewer than 6 matches or debug() still used in catch
    Evidence: .sisyphus/evidence/task-1-logging-check.txt

  Scenario: calculateMergeProbability receives valid object (crash prevention)
    Tool: Bash
    Preconditions: Changes applied
    Steps:
      1. Run: grep -n "calculateMergeProbability" src/commands/analyze.ts
      2. Assert: NO occurrences of `{} as ContributionOpportunity`
      3. Assert: all calls pass an object with `type` property
    Expected Result: No empty object casts remain
    Failure Indicators: `{} as ContributionOpportunity` still present
    Evidence: .sisyphus/evidence/task-1-merge-prob-fix.txt
  ```

  **Commit**: YES
  - Message: `fix(analyze): add diagnostic logging and fix calculateMergeProbability crash`
  - Files: `src/commands/analyze.ts`
  - Pre-commit: `bun test`

- [ ] 2. Fix detectTypos — use detectTyposInRepo instead of detectTypos

  **What to do**:
  1. In `src/commands/analyze.ts`, at the `detectTypos` call (~line 260):
     - Currently calls `detectTypos(readmeContent)` which only checks README text — too narrow for well-maintained repos
     - Replace with `detectTyposInRepo(tempPath)` which already exists at `contribution-detector.ts:136-165` and recursively scans ALL `.md` files
     - Update the import if needed to include `detectTyposInRepo`
  2. Verify `detectTyposInRepo` is exported from `contribution-detector.ts`
  3. Run `bun test`

  **Must NOT do**:
  - DO NOT modify `detectTypos()` or `detectTyposInRepo()` functions themselves
  - DO NOT add new typo patterns
  - DO NOT change the typo detection algorithm

  **Recommended Agent Profile**:
  - **Subagent Type**: `quick` (via subagent_type, NEVER category)
    - Reason: Single function call swap in one file
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with T3, T4, T5, T6)
  - **Blocks**: T7
  - **Blocked By**: T1

  **References**:
  - `src/commands/analyze.ts:260` — Current `detectTypos(readmeContent)` call — replace with `detectTyposInRepo(tempPath)`
  - `src/lib/contribution-detector.ts:112-134` — `detectTypos(content)` — the narrow function being replaced
  - `src/lib/contribution-detector.ts:136-165` — `detectTyposInRepo(repoPath)` — the broader function to use instead
  - `src/commands/analyze.ts:1-15` — Import section — may need to add `detectTyposInRepo` to imports

  **WHY Each Reference Matters**:
  - `analyze.ts:260` — The exact line to change — executor swaps the function call
  - `contribution-detector.ts:112-134` — The old narrow function — executor understands why it's insufficient
  - `contribution-detector.ts:136-165` — The replacement function — executor verifies it exists and is exported
  - `analyze.ts:1-15` — Import section — executor may need to update imports

  **Acceptance Criteria**:
  - [ ] `detectTyposInRepo(tempPath)` is called instead of `detectTypos(readmeContent)`
  - [ ] `detectTyposInRepo` is properly imported
  - [ ] `bun test` passes

  **QA Scenarios:**

  ```
  Scenario: detectTyposInRepo is used instead of detectTypos (happy path)
    Tool: Bash
    Preconditions: Changes applied
    Steps:
      1. Run: grep -n "detectTypos" src/commands/analyze.ts
      2. Assert: contains "detectTyposInRepo" call with tempPath argument
      3. Assert: does NOT contain "detectTypos(readmeContent)" (the old narrow call)
    Expected Result: Function swap completed
    Failure Indicators: Old detectTypos(readmeContent) call still present
    Evidence: .sisyphus/evidence/task-2-typo-swap.txt

  Scenario: Import is correct (edge case)
    Tool: Bash
    Preconditions: Changes applied
    Steps:
      1. Run: grep -n "import.*detectTypos" src/commands/analyze.ts
      2. Assert: import includes detectTyposInRepo
    Expected Result: detectTyposInRepo is imported
    Failure Indicators: Missing import would cause runtime error
    Evidence: .sisyphus/evidence/task-2-import-check.txt
  ```

  **Commit**: YES (groups with T3, T4, T5, T6)
  - Message: `fix(detectors): make all 5 contribution detectors produce results`
  - Files: `src/commands/analyze.ts`
  - Pre-commit: `bun test`

- [ ] 3. Fix detectDocs — correct readmePaths parameter and broaden detection

  **What to do**:
  1. In `src/commands/analyze.ts`, at the `detectDocs()` call (~line 279), fix the `readmePaths` argument:
     - Currently `filePaths` (from `readdirSync(tempPath)`) is passed as `readmePaths` — this is semantically wrong
     - Filter `filePaths` to only include files matching `*.md` pattern, then pass those as `readmePaths`
     - This ensures `detectDocs` receives actual markdown file paths, improving the `filePath` field in results
  2. In `src/lib/contribution-detector.ts`, in `detectDocs()` (~line 167-204):
     - Verify the section detection logic works: it checks for Installation, Usage, Contributing, License sections
     - Add `warn()` logging if the function catches errors internally
     - If README content is empty string, log a warning and return early (don't silently return `[]`)
  3. Run `bun test`

  **Must NOT do**:
  - DO NOT change which sections are detected (Installation, Usage, Contributing, License)
  - DO NOT add new section types
  - DO NOT refactor the function signature

  **Recommended Agent Profile**:
  - **Subagent Type**: `quick` (via subagent_type, NEVER category)
    - Reason: Small fixes across 2 files, straightforward parameter correction
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with T2, T4, T5, T6)
  - **Blocks**: T7
  - **Blocked By**: T1

  **References**:
  - `src/commands/analyze.ts:257-258` — `filePaths` computed via `readdirSync(tempPath)` then passed to `detectDocs` as `readmePaths`
  - `src/commands/analyze.ts:279` — The `detectDocs(readmeContent, filePaths, tempPath)` call
  - `src/lib/contribution-detector.ts:167-204` — `detectDocs()` function — checks for missing doc sections
  - `src/commands/analyze.ts:392-394` — Local `readdirSync()` function that shadows `node:fs` import

  **WHY Each Reference Matters**:
  - `analyze.ts:257-258` — Shows the wrong variable being passed as `readmePaths`
  - `contribution-detector.ts:167-204` — The function receiving the wrong parameter — executor needs to see what it expects
  - `analyze.ts:392-394` — The local `readdirSync` wrapper — executor should use this, not import from `node:fs`

  **Acceptance Criteria**:
  - [ ] `detectDocs` receives filtered `.md` file paths as `readmePaths` (not raw directory listing)
  - [ ] Empty README content triggers a `warn()` log
  - [ ] `bun test` passes

  **QA Scenarios:**

  ```
  Scenario: readmePaths contains only .md files (happy path)
    Tool: Bash
    Preconditions: Changes applied
    Steps:
      1. Run: grep -A3 "detectDocs" src/commands/analyze.ts | grep -v "import"
      2. Assert: the readmePaths argument is filtered (contains .md filter logic)
    Expected Result: Only markdown files passed as readmePaths
    Failure Indicators: Raw filePaths still passed without filtering
    Evidence: .sisyphus/evidence/task-3-readmepaths-fix.txt

  Scenario: Empty README triggers warning (edge case)
    Tool: Bash
    Preconditions: Changes applied
    Steps:
      1. Run: grep -n "warn" src/lib/contribution-detector.ts | grep -i "readme\|empty\|content"
      2. Assert: at least 1 match showing empty-content warning
    Expected Result: Warning log exists for empty README case
    Failure Indicators: No warning for empty content
    Evidence: .sisyphus/evidence/task-3-empty-readme-warn.txt
  ```

  **Commit**: YES (groups with T2, T4, T5, T6)
  - Message: `fix(detectors): make all 5 contribution detectors produce results`
  - Files: `src/commands/analyze.ts`, `src/lib/contribution-detector.ts`
  - Pre-commit: `bun test`

- [ ] 4. Fix detectDeps — add subprocess timeout, surface errors

  **What to do**:
  1. In `src/lib/contribution-detector.ts`, in `detectDeps()` (~line 206-257):
     - The function spawns `npm view <package> version` for every dependency — this can hang or timeout
     - Add a timeout (10 seconds) to each subprocess call using `AbortSignal.timeout(10000)` or Bun's subprocess timeout option
     - In the catch block at ~line 226, change silent catch to `warn(\`[detectDeps] Failed to check ${dep}: ${error}\`)`
     - Add `info(\`[detectDeps] Checking ${Object.keys(deps).length} dependencies\`)` at the start
  2. If the repo has no `package.json`, `detectDeps` should return `[]` with an `info()` log, not silently return empty
  3. Run `bun test`

  **Must NOT do**:
  - DO NOT change what constitutes an "outdated" dependency
  - DO NOT add new dependency checking logic beyond what exists
  - DO NOT switch from `npm view` to another tool

  **Recommended Agent Profile**:
  - **Subagent Type**: `quick` (via subagent_type, NEVER category)
    - Reason: Adding timeout + error logging to one function
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with T2, T3, T5, T6)
  - **Blocks**: T7
  - **Blocked By**: T1

  **References**:
  - `src/lib/contribution-detector.ts:206-257` — `detectDeps()` function — spawns `npm view` per dependency
  - `src/lib/contribution-detector.ts:226` — Silent catch block that swallows subprocess errors
  - `src/lib/contribution-detector.ts:210-215` — Where `package.json` is read — if missing, returns `[]` silently

  **WHY Each Reference Matters**:
  - `contribution-detector.ts:206-257` — The full function — executor needs to see subprocess spawning pattern to add timeout
  - `contribution-detector.ts:226` — The silent catch to fix — change to `warn()`
  - `contribution-detector.ts:210-215` — The package.json check — add logging for "no package.json" case

  **Acceptance Criteria**:
  - [ ] Each `npm view` subprocess has a timeout (≤15 seconds)
  - [ ] Catch block at ~line 226 uses `warn()` not silent catch
  - [ ] Missing `package.json` logs an `info()` message
  - [ ] `bun test` passes

  **QA Scenarios:**

  ```
  Scenario: Subprocess timeout is set (happy path)
    Tool: Bash
    Preconditions: Changes applied
    Steps:
      1. Run: grep -n "timeout\|abort\|signal" src/lib/contribution-detector.ts | head -10
      2. Assert: at least 1 match near the npm view subprocess call
    Expected Result: Timeout mechanism present
    Failure Indicators: No timeout found — subprocess can hang indefinitely
    Evidence: .sisyphus/evidence/task-4-timeout-check.txt

  Scenario: Errors are surfaced not swallowed (negative prevention)
    Tool: Bash
    Preconditions: Changes applied
    Steps:
      1. Run: grep -B2 -A2 "catch" src/lib/contribution-detector.ts | grep -A2 "detectDeps\|npm view"
      2. Assert: catch blocks contain warn() or info(), not empty or debug-only
    Expected Result: Error logging visible in catch blocks
    Failure Indicators: Empty catch or debug-only logging
    Evidence: .sisyphus/evidence/task-4-error-surfacing.txt
  ```

  **Commit**: YES (groups with T2, T3, T5, T6)
  - Message: `fix(detectors): make all 5 contribution detectors produce results`
  - Files: `src/lib/contribution-detector.ts`
  - Pre-commit: `bun test`

- [ ] 5. Fix detectTests — verify logic produces results, surface errors

  **What to do**:
  1. In `src/lib/contribution-detector.ts`, in `detectTests()` (~line 309-376):
     - The logic finds source files without corresponding test files — this should work for most repos
     - Add `info(\`[detectTests] Found ${sourceFiles.length} source files, ${results.length} without tests\`)` after detection
     - If any internal try/catch blocks silently swallow errors, change to `warn()`
     - Verify the function handles repos with NO `src/` directory gracefully (returns `[]` with info log, not crash)
  2. In `src/commands/analyze.ts`, verify the `detectTests` call passes correct arguments (should be `tempPath`)
  3. Run `bun test`

  **Must NOT do**:
  - DO NOT change what constitutes "missing test" logic
  - DO NOT add new test file patterns beyond what exists

  **Recommended Agent Profile**:
  - **Subagent Type**: `quick` (via subagent_type, NEVER category)
    - Reason: Adding logging + error surfacing to one function
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with T2, T3, T4, T6)
  - **Blocks**: T7
  - **Blocked By**: T1

  **References**:
  - `src/lib/contribution-detector.ts:309-376` — `detectTests()` function — finds source files without test files
  - `src/commands/analyze.ts:295-310` — Where `detectTests` is called in the analysis pipeline

  **WHY Each Reference Matters**:
  - `contribution-detector.ts:309-376` — The full function to add logging to
  - `analyze.ts:295-310` — Verify it's called correctly and results are properly collected

  **Acceptance Criteria**:
  - [ ] `detectTests` has `info()` logging for result count
  - [ ] Silent catch blocks changed to `warn()`
  - [ ] Missing `src/` directory handled gracefully
  - [ ] `bun test` passes

  **QA Scenarios:**

  ```
  Scenario: detectTests has info logging (happy path)
    Tool: Bash
    Preconditions: Changes applied
    Steps:
      1. Run: grep -n "info\|warn" src/lib/contribution-detector.ts | grep -i "test\|source"
      2. Assert: at least 1 match showing logging in detectTests area (lines 309-376)
    Expected Result: Logging present in detectTests function
    Failure Indicators: No logging found in the detectTests function range
    Evidence: .sisyphus/evidence/task-5-detecttests-logging.txt

  Scenario: No silent catches in detectTests (negative prevention)
    Tool: Bash
    Preconditions: Changes applied
    Steps:
      1. Run: awk '/detectTests/,/^}/' src/lib/contribution-detector.ts | grep -c "catch.*{[[:space:]]*}"
      2. Assert: result is 0 (no empty catch blocks)
    Expected Result: Zero empty catch blocks in detectTests
    Failure Indicators: Any empty catch block found
    Evidence: .sisyphus/evidence/task-5-no-silent-catch.txt
  ```

  **Commit**: YES (groups with T2, T3, T4, T6)
  - Message: `fix(detectors): make all 5 contribution detectors produce results`
  - Files: `src/lib/contribution-detector.ts`
  - Pre-commit: `bun test`

- [ ] 6. Fix detectCode — surface GitHub API errors, improve issue search

  **What to do**:
  1. In `src/lib/contribution-detector.ts`, in `detectCodeIssues()` (~line 380-401):
     - The catch block at ~line 396 silently swallows ALL GitHub API errors
     - Change to `warn(\`[detectCode] GitHub issue search failed for ${repoFullName}: ${error}\`)`
     - Add `info(\`[detectCode] Found ${issues.length} issues for ${repoFullName}\`)` after successful search
  2. In `detectCode()` (~line 403-432):
     - This function maps GitHub issues to contribution opportunities
     - If `searchIssues()` returns empty (rate limit, auth failure, no matching labels), the function returns `[]` silently
     - Add `info()` logging for the input issue count and output opportunity count
  3. In `src/lib/github.ts`, in `searchIssues()` (~line 97+):
     - Verify the search query uses labels that actually exist on target repos (e.g., "good first issue", "help wanted")
     - If the `gh` CLI returns an error, log it via `warn()` instead of silently catching
  4. Run `bun test`

  **Must NOT do**:
  - DO NOT change the issue-to-opportunity mapping logic
  - DO NOT add new label types beyond what exists
  - DO NOT modify GitHub authentication

  **Recommended Agent Profile**:
  - **Subagent Type**: `quick` (via subagent_type, NEVER category)
    - Reason: Error surfacing in 2 files, no logic changes
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with T2, T3, T4, T5)
  - **Blocks**: T7
  - **Blocked By**: T1

  **References**:
  - `src/lib/contribution-detector.ts:380-401` — `detectCodeIssues()` — silent catch at line 396
  - `src/lib/contribution-detector.ts:403-432` — `detectCode()` — maps issues to opportunities
  - `src/lib/github.ts:97-130` — `searchIssues()` — uses `gh` CLI for issue search
  - `src/lib/github.ts:85` — Where `language` field is set in search results

  **WHY Each Reference Matters**:
  - `contribution-detector.ts:380-401` — The silent catch to fix
  - `contribution-detector.ts:403-432` — Needs logging to show mapping results
  - `github.ts:97-130` — The upstream function that may be failing silently — executor needs to check its error handling too

  **Acceptance Criteria**:
  - [ ] `detectCodeIssues` catch block uses `warn()` not silent catch
  - [ ] `detectCode` has `info()` logging for issue count and opportunity count
  - [ ] `searchIssues` errors are logged via `warn()`
  - [ ] `bun test` passes

  **QA Scenarios:**

  ```
  Scenario: GitHub API errors are surfaced (happy path)
    Tool: Bash
    Preconditions: Changes applied
    Steps:
      1. Run: grep -n "warn\|info" src/lib/contribution-detector.ts | grep -i "code\|issue\|github"
      2. Assert: at least 2 matches (one in detectCodeIssues, one in detectCode)
    Expected Result: Logging present in both functions
    Failure Indicators: Missing logging in either function
    Evidence: .sisyphus/evidence/task-6-detectcode-logging.txt

  Scenario: searchIssues errors are logged (edge case)
    Tool: Bash
    Preconditions: Changes applied
    Steps:
      1. Run: grep -A5 "catch" src/lib/github.ts | grep -c "warn\|error\|info"
      2. Assert: result > 0 (catch blocks have logging)
    Expected Result: Error logging present in github.ts catch blocks
    Failure Indicators: Silent catches remain
    Evidence: .sisyphus/evidence/task-6-github-error-logging.txt
  ```

  **Commit**: YES (groups with T2, T3, T4, T5)
  - Message: `fix(detectors): make all 5 contribution detectors produce results`
  - Files: `src/lib/contribution-detector.ts`, `src/lib/github.ts`
  - Pre-commit: `bun test`

- [ ] 7. Add bun:test per detector + end-to-end dry-run verification

  **What to do**:
  1. Create `tests/contribution-detector.test.ts` with one test per detector:
     - `detectTyposInRepo`: Create temp dir with a `.md` file containing known typos (e.g., "teh", "recieve"), assert returns ≥1 result
     - `detectDocs`: Pass README content missing "Installation" section, assert returns ≥1 result with type "docs"
     - `detectDeps`: Create temp dir with `package.json` containing an old dependency, assert function doesn't crash (may return `[]` if npm view fails in test — that's OK, test it doesn't throw)
     - `detectTests`: Create temp dir with `src/index.ts` but no `tests/` dir, assert returns ≥1 result
     - `detectCode`: Mock or skip if it requires GitHub API — test with empty issues array, assert returns `[]` without crash
  2. Run `bun test` to verify all existing + new tests pass
  3. Run `bun run gittributor run --dry-run 2>&1` and capture output to verify >0 opportunities appear

  **Must NOT do**:
  - DO NOT modify existing test files
  - DO NOT add tests for functions not in scope (e.g., guardrails, repo-list)
  - DO NOT mock internal functions excessively — use real filesystem temp dirs where possible

  **Recommended Agent Profile**:
  - **Subagent Type**: `deep` (via subagent_type, NEVER category)
    - Reason: Creating comprehensive test file + end-to-end verification requires deeper reasoning
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO (depends on all Wave 2 tasks)
  - **Parallel Group**: Wave 3 (solo)
  - **Blocks**: F1-F4
  - **Blocked By**: T2, T3, T4, T5, T6

  **References**:
  - `tests/` directory — Existing test files for pattern reference
  - `src/lib/contribution-detector.ts:112-165` — `detectTypos` and `detectTyposInRepo` — test targets
  - `src/lib/contribution-detector.ts:167-204` — `detectDocs` — test target
  - `src/lib/contribution-detector.ts:206-257` — `detectDeps` — test target
  - `src/lib/contribution-detector.ts:309-376` — `detectTests` — test target
  - `src/lib/contribution-detector.ts:380-432` — `detectCode`/`detectCodeIssues` — test target
  - `package.json` — Check `bun test` script and test configuration

  **WHY Each Reference Matters**:
  - `tests/` — Follow existing test patterns (import style, describe/it structure, assertion patterns)
  - Each detector function reference — The executor needs to know function signatures and return types to write correct tests
  - `package.json` — Verify test configuration supports the new test file location

  **Acceptance Criteria**:
  - [ ] `tests/contribution-detector.test.ts` exists with ≥5 test cases (one per detector)
  - [ ] `bun test` passes (all existing 14 + new ~5 tests)
  - [ ] End-to-end: `bun run gittributor run --dry-run 2>&1` shows detector log lines and >0 opportunities for at least 1 repo

  **QA Scenarios:**

  ```
  Scenario: All tests pass including new detector tests (happy path)
    Tool: Bash
    Preconditions: All Wave 1-2 changes applied, new test file created
    Steps:
      1. Run: bun test 2>&1
      2. Assert: exit code 0
      3. Assert: output contains "contribution-detector" test suite
      4. Assert: output shows ≥19 tests passing (14 existing + ≥5 new)
    Expected Result: All tests pass
    Failure Indicators: Any test failure or missing test suite
    Evidence: .sisyphus/evidence/task-7-test-results.txt

  Scenario: End-to-end dry-run shows opportunities (integration)
    Tool: Bash
    Preconditions: All changes applied
    Steps:
      1. Run: bun run gittributor run --dry-run 2>&1 | tee .sisyphus/evidence/task-7-dryrun.txt
      2. Assert: output contains detector log lines (e.g., "detectTypos:", "detectDocs:")
      3. Assert: output does NOT contain "0 contribution opportunities" or "No contribution opportunities found"
    Expected Result: >0 opportunities found, detector logs visible
    Failure Indicators: Still shows 0 opportunities, or no detector logs
    Evidence: .sisyphus/evidence/task-7-dryrun.txt

  Scenario: Dry-run doesn't crash with errors (negative)
    Tool: Bash
    Preconditions: All changes applied
    Steps:
      1. Run: bun run gittributor run --dry-run 2>&1
      2. Assert: exit code is 0
      3. Assert: output does NOT contain "TypeError", "ReferenceError", or "Cannot read properties of undefined"
    Expected Result: Clean execution without runtime errors
    Failure Indicators: Any unhandled error in output
    Evidence: .sisyphus/evidence/task-7-no-errors.txt
  ```

  **Commit**: YES
  - Message: `test(detectors): add unit tests for all 5 contribution detectors`
  - Files: `tests/contribution-detector.test.ts`
  - Pre-commit: `bun test`

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.

- [ ] F1. **Plan Compliance Audit** — `oracle` (subagent_type)
  Read the plan end-to-end. For each "Must Have": verify implementation exists. For each "Must NOT Have": search codebase for forbidden changes. Check evidence files in `.sisyphus/evidence/`. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high` (subagent_type)
  Run `bun test`. Review changed files for: `as any`/`@ts-ignore`, empty catches that should log, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction.
  Output: `Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Real CLI QA** — `unspecified-high` (subagent_type)
  Run `bun run gittributor run --dry-run 2>&1`. Verify output shows >0 opportunities for at least 1 repo. Check each detector type appears at least once in output. Save to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep` (subagent_type)
  Check git diff — only `analyze.ts`, `contribution-detector.ts`, and new test file should be changed. No files outside scope. No unaccounted changes.
  Output: `Tasks [N/N compliant] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **Wave 1 (T1)**: `fix(analyze): add diagnostic logging and fix calculateMergeProbability crash`
- **Wave 2 (T2-T6)**: `fix(detectors): make all 5 contribution detectors produce results`
- **Wave 3 (T7)**: `test(detectors): add unit tests for all 5 contribution detectors`

---

## Success Criteria

### Verification Commands
```bash
bun test  # Expected: all tests pass (14 existing + ~5 new)
bun run gittributor run --dry-run 2>&1 | grep -c "contribution opportunities"  # Expected: number > 0
bun run gittributor run --dry-run 2>&1 | grep "Found"  # Expected: "Found N contribution opportunities" where N > 0
```

### Final Checklist
- [ ] All 5 detectors return non-empty results when applicable
- [ ] No silent error swallowing — all catch blocks log via `info()` or `warn()`
- [ ] `calculateMergeProbability` receives valid opportunity objects
- [ ] Each detector has at least 1 bun:test proving it works
- [ ] `bun run gittributor run --dry-run` shows >0 opportunities
- [ ] No forbidden files touched (repo-list.ts, guardrails.ts, repos.yaml, config.ts)

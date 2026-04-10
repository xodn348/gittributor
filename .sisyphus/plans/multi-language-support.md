# Multi-Language Support for gittributor

## TL;DR

> **Quick Summary**: Make `gittributor run` iterate over ALL configured `targetLanguages` (TypeScript, JavaScript, Python) instead of only using the first/default language, maximizing GitHub contribution opportunities across multiple language ecosystems.
> 
> **Deliverables**:
> - Updated `runOrchestrator` with language loop over `targetLanguages`
> - `--language` CLI flag for single-language override
> - State reset between language iterations
> - Guardrail check before each language iteration
> - Per-language logging output
> - Updated tests
> 
> **Estimated Effort**: Medium
> **Parallel Execution**: YES - 3 waves
> **Critical Path**: Task 1 → Task 3 → Task 5 → Task 7 → Task 8

---

## Context

### Original Request
User wants multi-language support so `gittributor run` processes ALL languages in `targetLanguages` array, not just the first one. Ultimate goal: maximize GitHub contributions and open source credit — more languages = more repos = more green squares.

### Interview Summary
**Key Discussions**:
- **Execution mode**: Sequential iteration (not parallel) to avoid GitHub API rate limits
- **Language override**: `--language` flag overrides to single language for backward compat
- **Guardrails**: Global `MAX_GLOBAL_WEEKLY=10` stays global, not per-language
- **State management**: Global state needs reset to `idle` between language iterations
- **Fix strategy**: Same AI fix flow for all languages (no language-specific strategies)
- **Test strategy**: Tests-after approach; `bun test` infrastructure exists (357 pass baseline)

**Research Findings**:
- `src/commands/run.ts:149` calls `discover({})` with no language — root cause
- `src/commands/discover.ts:17` has `DEFAULT_LANGUAGE = "TypeScript"` hardcoded fallback
- `src/lib/state.ts` has global state with `VALID_TRANSITIONS` map — must reset between iterations
- `src/lib/guardrails.ts` has `MAX_GLOBAL_WEEKLY=10` — shared across all languages
- `src/lib/config.ts:11` defines `targetLanguages: ["typescript", "javascript", "python"]`
- Old CLI path in `src/index.ts:404` uses `targetLanguages?.[0]` — needs updating too

### Metis Review
**Identified Gaps** (addressed):
- **State reset risk**: Resetting global state between iterations could lose in-flight data → Addressed by ensuring pipeline completes fully (or fails) before reset
- **Error handling between languages**: Pipeline failure mid-language needs strategy → Default: log error, continue to next language (fail-forward)
- **Old CLI path**: `runDiscoverCommand`/`runPipelineCommand` in `src/index.ts` also hardcoded → Include in scope for consistency
- **Process-level concerns**: Multiple pipeline iterations in one process → No known memory leak risk in current codebase, but add cleanup note

---

## Work Objectives

### Core Objective
Make `gittributor run` iterate over all configured `targetLanguages`, running the full discover→analyze→fix→review→submit pipeline for each language sequentially, to maximize contribution opportunities across language ecosystems.

### Concrete Deliverables
- Modified `src/commands/run.ts` — language loop in `runOrchestrator`, `--language` flag
- Modified `src/commands/discover.ts` — no behavior change, just receives language from caller
- Modified `src/lib/state.ts` — expose `resetState()` function for inter-iteration reset
- Modified `src/index.ts` — update old CLI paths to use `targetLanguages` properly
- New/updated test files covering multi-language orchestration
- Updated `src/types/index.ts` if `RunOptions` type changes needed

### Definition of Done
- [ ] `bun run src/index.ts run` processes TypeScript, JavaScript, AND Python sequentially
- [ ] `bun run src/index.ts run --language python` processes only Python
- [ ] `bun test` passes with ≥357 tests (baseline) + new tests
- [ ] Global guardrail cap respected across all language iterations
- [ ] State resets to idle between language iterations

### Must Have
- Sequential iteration over all `targetLanguages` in `runOrchestrator`
- `--language` flag for single-language override
- State reset between iterations
- Guardrail check before each iteration (bail if cap reached)
- Per-language console output (which language is being processed)
- Error handling: fail-forward (log error, continue to next language)

### Must NOT Have (Guardrails)
- No parallel language execution (sequential only — API rate limits)
- No per-language state files (global state stays global)
- No per-language guardrail caps (global cap stays global)
- No new language-specific fix strategies
- No changes to the discover/analyze/fix/review/submit pipeline internals
- No over-abstraction: keep the loop simple and inline in `runOrchestrator`

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: YES (`bun test`, 357 pass baseline)
- **Automated tests**: YES (Tests-after)
- **Framework**: bun test
- **Baseline**: 357 pass, 3 skip, 0 fail

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **CLI**: Use Bash — run `bun run src/index.ts run` variants, validate stdout output
- **Unit tests**: Use Bash — run `bun test` with specific test files, assert pass counts
- **Library/Module**: Use Bash (bun REPL) — import and call functions, compare output

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Foundation — types + state reset + config loading):
├── Task 1: Add language to RunOptions + parseRunFlags [quick]
├── Task 2: Add resetState() to state.ts [quick]
└── Task 3: Add getTargetLanguages() helper to config [quick]

Wave 2 (Core implementation — depends on Wave 1):
├── Task 4: Multi-language loop in runOrchestrator (depends: 1, 2, 3) [deep]
├── Task 5: Update old CLI paths in index.ts (depends: 1, 3) [quick]
└── Task 6: Per-language logging + error handling (depends: 4) [quick]

Wave 3 (Testing + verification — depends on Wave 2):
├── Task 7: Unit tests for multi-language orchestration (depends: 4, 6) [unspecified-high]
├── Task 8: Integration test — full CLI run (depends: 4, 5, 6) [unspecified-high]
└── Task 9: Existing test regression check (depends: all) [quick]

Wave FINAL (After ALL tasks — 4 parallel reviews, then user okay):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Real manual QA (unspecified-high)
└── Task F4: Scope fidelity check (deep)
→ Present results → Get explicit user okay
```

### Dependency Matrix

| Task | Depends On | Blocks | Wave |
|------|-----------|--------|------|
| 1 | - | 4, 5 | 1 |
| 2 | - | 4 | 1 |
| 3 | - | 4, 5 | 1 |
| 4 | 1, 2, 3 | 6, 7, 8 | 2 |
| 5 | 1, 3 | 8 | 2 |
| 6 | 4 | 7, 8 | 2 |
| 7 | 4, 6 | 9 | 3 |
| 8 | 4, 5, 6 | 9 | 3 |
| 9 | 7, 8 | F1-F4 | 3 |

### Agent Dispatch Summary

- **Wave 1**: 3 tasks → T1 `quick`, T2 `quick`, T3 `quick`
- **Wave 2**: 3 tasks → T4 `deep`, T5 `quick`, T6 `quick`
- **Wave 3**: 3 tasks → T7 `unspecified-high`, T8 `unspecified-high`, T9 `quick`
- **FINAL**: 4 tasks → F1 `oracle`, F2 `unspecified-high`, F3 `unspecified-high`, F4 `deep`

---

## TODOs

- [x] 1. Add `language` field to RunOptions and `--language` flag to parseRunFlags

  **What to do**:
  - Add `language?: string` field to the `RunOptions` interface in `src/commands/run.ts`
  - Add `--language` flag parsing in `parseRunFlags` function — extract from `commandArgs` using same pattern as `--type`
  - When `--language` is provided, it should be a single string (e.g., `"python"`)
  - Do NOT add the language loop yet — that's Task 4

  **Must NOT do**:
  - Do not modify `runOrchestrator` logic yet
  - Do not add language loop
  - Do not touch `discover.ts`

  **Recommended Agent Profile**:
  - **Subagent**: `quick`
    - Reason: Single-file change, straightforward interface extension + flag parsing
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3)
  - **Blocks**: Tasks 4, 5
  - **Blocked By**: None (can start immediately)

  **References**:
  - `src/commands/run.ts:1-30` — `RunOptions` interface definition and `parseRunFlags` function. Follow the existing pattern for `--type` flag parsing to add `--language`.
  - `src/commands/run.ts:40-60` — `parseRunFlags` implementation showing how flags are extracted from `commandArgs` array
  - `src/types/index.ts:120` — `targetLanguages: string[]` type definition confirming language is a string

  **Acceptance Criteria**:
  - [ ] `RunOptions` has `language?: string` field
  - [ ] `parseRunFlags(["--language", "python"])` returns `{ language: "python" }`
  - [ ] `parseRunFlags([])` returns `{ language: undefined }`
  - [ ] `bun test` still passes (≥357 tests, 0 new failures)

  **QA Scenarios**:
  ```
  Scenario: parseRunFlags extracts --language flag
    Tool: Bash
    Preconditions: Working directory is /Users/jnnj92/gittributor
    Steps:
      1. Run: bun -e "import { parseRunFlags } from './src/commands/run.js'; console.log(JSON.stringify(parseRunFlags(['--language', 'python'])))"
      2. Assert output contains: "language":"python"
    Expected Result: JSON output includes language field set to "python"
    Failure Indicators: Output missing "language" key, or value is undefined/null
    Evidence: .sisyphus/evidence/task-1-parse-language-flag.txt

  Scenario: parseRunFlags without --language returns undefined
    Tool: Bash
    Preconditions: Working directory is /Users/jnnj92/gittributor
    Steps:
      1. Run: bun -e "import { parseRunFlags } from './src/commands/run.js'; const r = parseRunFlags([]); console.log('language' in r, r.language)"
      2. Assert output shows language is undefined
    Expected Result: language field is undefined when flag not provided
    Evidence: .sisyphus/evidence/task-1-no-language-flag.txt
  ```

  **Commit**: YES
  - Message: `feat(run): add language to RunOptions and --language flag parsing`
  - Files: `src/commands/run.ts`
  - Pre-commit: `bun test`

- [x] 2. Add `resetState()` function to state.ts

  **What to do**:
  - Add a new exported `resetState()` function to `src/lib/state.ts`
  - This function must reset the global pipeline state back to `idle` status
  - It should clear the `repos` array and reset `currentStep` to idle
  - Must use the existing state file path and write pattern (look at how `updateState` works)
  - Add a test for `resetState` in the existing test file or a new test

  **Must NOT do**:
  - Do not create per-language state files
  - Do not modify existing state transition logic
  - Do not change the `VALID_TRANSITIONS` map

  **Recommended Agent Profile**:
  - **Subagent**: `quick`
    - Reason: Single function addition to existing module, straightforward
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3)
  - **Blocks**: Task 4
  - **Blocked By**: None (can start immediately)

  **References**:
  - `src/lib/state.ts:1-188` — Full state module. Study `updateState()` and `loadState()` patterns. `resetState()` should write a clean idle state using the same file I/O pattern.
  - `src/lib/state.ts:10-20` — `VALID_TRANSITIONS` map showing `idle` as the starting state
  - `src/lib/state.ts:30-50` — `PipelineState` interface definition showing the shape to reset to

  **Acceptance Criteria**:
  - [ ] `resetState()` is exported from `src/lib/state.ts`
  - [ ] Calling `resetState()` sets state to `{ status: "idle", repos: [] }` (or equivalent clean state)
  - [ ] `bun test` passes

  **QA Scenarios**:
  ```
  Scenario: resetState resets pipeline to idle
    Tool: Bash
    Preconditions: Working directory is /Users/jnnj92/gittributor
    Steps:
      1. Run: bun -e "import { resetState, loadState } from './src/lib/state.js'; await resetState(); const s = await loadState(); console.log(JSON.stringify(s))"
      2. Assert output contains: "status":"idle"
    Expected Result: State object has status "idle" after reset
    Failure Indicators: Status is not "idle", or function throws
    Evidence: .sisyphus/evidence/task-2-reset-state.txt

  Scenario: resetState is idempotent
    Tool: Bash
    Preconditions: Working directory is /Users/jnnj92/gittributor
    Steps:
      1. Run: bun -e "import { resetState, loadState } from './src/lib/state.js'; await resetState(); await resetState(); const s = await loadState(); console.log(s.status)"
      2. Assert output is: idle
    Expected Result: Calling resetState twice still results in idle state
    Evidence: .sisyphus/evidence/task-2-reset-idempotent.txt
  ```

  **Commit**: YES
  - Message: `feat(state): add resetState function for inter-language pipeline reset`
  - Files: `src/lib/state.ts`
  - Pre-commit: `bun test`

- [x] 3. Add `getTargetLanguages()` config helper

  **What to do**:
  - Add a `getTargetLanguages(overrideLanguage?: string): string[]` helper function
  - If `overrideLanguage` is provided, return `[overrideLanguage]` (single-element array)
  - If not, load config and return `runtimeConfig.targetLanguages` (defaults to `["typescript", "javascript", "python"]`)
  - Place this in `src/lib/config.ts` or as a helper in `src/commands/run.ts` (wherever makes more sense given existing patterns)

  **Must NOT do**:
  - Do not change the default `targetLanguages` config values
  - Do not add validation for language names yet

  **Recommended Agent Profile**:
  - **Subagent**: `quick`
    - Reason: Small helper function, single file
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2)
  - **Blocks**: Tasks 4, 5
  - **Blocked By**: None (can start immediately)

  **References**:
  - `src/lib/config.ts:11` — `targetLanguages: ["typescript", "javascript", "python"]` default config. This is the array to return when no override.
  - `src/lib/config.ts:1-50` — Config loading pattern. Follow the existing `loadConfig`/`getRuntimeConfig` pattern for accessing config values.
  - `src/types/index.ts:120` — Type definition confirming `targetLanguages: string[]`

  **Acceptance Criteria**:
  - [ ] `getTargetLanguages()` returns `["typescript", "javascript", "python"]` (or whatever config says)
  - [ ] `getTargetLanguages("python")` returns `["python"]`
  - [ ] `bun test` passes

  **QA Scenarios**:
  ```
  Scenario: getTargetLanguages returns all configured languages
    Tool: Bash
    Preconditions: Working directory is /Users/jnnj92/gittributor
    Steps:
      1. Run: bun -e "import { getTargetLanguages } from './src/lib/config.js'; console.log(JSON.stringify(getTargetLanguages()))"
      2. Assert output contains: ["typescript","javascript","python"]
    Expected Result: Returns the full default array of 3 languages
    Failure Indicators: Missing languages, empty array, or error
    Evidence: .sisyphus/evidence/task-3-all-languages.txt

  Scenario: getTargetLanguages with override returns single language
    Tool: Bash
    Preconditions: Working directory is /Users/jnnj92/gittributor
    Steps:
      1. Run: bun -e "import { getTargetLanguages } from './src/lib/config.js'; console.log(JSON.stringify(getTargetLanguages('python')))"
      2. Assert output is: ["python"]
    Expected Result: Single-element array with the override language
    Evidence: .sisyphus/evidence/task-3-override-language.txt
  ```

  **Commit**: YES
  - Message: `feat(config): add getTargetLanguages helper with override support`
  - Files: `src/lib/config.ts`
  - Pre-commit: `bun test`

- [x] 4. Multi-language loop in runOrchestrator

  **What to do**:
  - Modify `runOrchestrator` in `src/commands/run.ts` to iterate over ALL languages from `getTargetLanguages()`
  - Add `language` field to `RunOptions` interface
  - For each language in the array: call `resetState()` (from Task 2), then call `discover({ language })` instead of `discover({})`
  - Continue through the full pipeline (analyze → fix → review → submit) for each language before moving to next
  - Implement fail-forward error handling: if one language fails, log the error and continue to next language
  - Print a summary at the end showing results per language (repos discovered, PRs submitted, errors)
  - Respect `MAX_GLOBAL_WEEKLY=10` across ALL languages combined (not per-language)

  **Must NOT do**:
  - Do NOT change `MAX_GLOBAL_WEEKLY` value or make it per-language
  - Do NOT run languages in parallel — sequential iteration to avoid GitHub API rate limits
  - Do NOT modify the discover/analyze/fix/review/submit pipeline internals — only the orchestrator loop

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Core orchestration logic requiring careful state management and error handling across iteration boundaries
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - `test-driven-development`: Tests are a separate task (Task 7)

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2 (sequential — this is the critical path)
  - **Blocks**: Tasks 5, 6, 7, 8
  - **Blocked By**: Tasks 1, 2, 3

  **References**:

  **Pattern References**:
  - `src/commands/run.ts:140-198` — Current `runOrchestrator` function. This is THE primary target. Currently calls `discover({})` at line 149 with no language param
  - `src/commands/run.ts:1-20` — `RunOptions` interface definition. Add `language?: string` field here
  - `src/commands/run.ts:130-138` — `parseRunFlags` function. Add `--language` flag parsing here

  **API/Type References**:
  - `src/commands/discover.ts:19-30` — `DiscoverOptions` interface with `language?: string` field — this is what `discover()` accepts
  - `src/lib/state.ts` — State management module. `resetState()` will be added by Task 2
  - `src/lib/guardrails.ts:15-20` — `MAX_GLOBAL_WEEKLY=10` constant — check remaining budget before each language iteration
  - `src/lib/config.ts` — `getTargetLanguages()` will be added by Task 3

  **Test References**:
  - `src/commands/__tests__/run.test.ts` — Existing run command tests (if present), follow same patterns

  **WHY Each Reference Matters**:
  - `run.ts:140-198`: The exact function to modify — executor must understand current flow before wrapping it in a language loop
  - `discover.ts:19-30`: Shows the `language` parameter contract that `discover()` already accepts
  - `guardrails.ts:15-20`: Must check `getWeeklySubmissionCount()` before each language to avoid exceeding global cap
  - `state.ts`: Must call `resetState()` between languages to reset pipeline from `submitted` back to `idle`

  **Acceptance Criteria**:
  - [ ] `bun test` passes (357+ pass, 0 fail)
  - [ ] `RunOptions` interface includes `language?: string`
  - [ ] `runOrchestrator` iterates over all languages from config

  **QA Scenarios**:

  ```
  Scenario: Multi-language iteration with dry-run
    Tool: Bash
    Preconditions: Working directory is /Users/jnnj92/gittributor, config has targetLanguages: ["typescript", "javascript", "python"]
    Steps:
      1. Run: bun run src/index.ts run --dry-run 2>&1
      2. Assert output contains "typescript" (or "TypeScript")
      3. Assert output contains "javascript" (or "JavaScript")
      4. Assert output contains "python" (or "Python")
    Expected Result: All three languages appear in output, showing iteration over each
    Failure Indicators: Only "TypeScript" appears, or command errors out
    Evidence: .sisyphus/evidence/task-4-multi-lang-dryrun.txt

  Scenario: Fail-forward on language error
    Tool: Bash
    Preconditions: Working directory is /Users/jnnj92/gittributor
    Steps:
      1. Run with a config that includes an invalid language: bun run src/index.ts run --dry-run --language invalid_lang 2>&1
      2. Assert process exits without crashing (exit code 0 or graceful error message)
    Expected Result: Graceful error handling, not an unhandled exception crash
    Failure Indicators: Unhandled promise rejection, stack trace without error context
    Evidence: .sisyphus/evidence/task-4-fail-forward.txt
  ```

  **Commit**: YES
  - Message: `feat(run): iterate over all target languages in runOrchestrator`
  - Files: `src/commands/run.ts`
  - Pre-commit: `bun test`

- [ ] 5. Update old CLI paths in index.ts

  **What to do**:
  - Update `runDiscoverCommand` in `src/index.ts` (around line 404) to use `getTargetLanguages()` instead of `targetLanguages?.[0]`
  - Update `runPipelineCommand` if it also hardcodes first language
  - Ensure the old CLI paths (`gittributor discover`, `gittributor pipeline`) also iterate over all languages, consistent with the new `run` command behavior
  - Import `getTargetLanguages` from `src/lib/config.ts`

  **Must NOT do**:
  - Do NOT refactor the old CLI commands into the new `run` command — just update the language selection
  - Do NOT change command signatures or remove existing flags

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Straightforward find-and-replace of language selection logic in existing code paths
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - `librarian`: Not needed — exact file locations already known

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 6)
  - **Parallel Group**: Wave 2 (after Task 4 completes)
  - **Blocks**: Task 8
  - **Blocked By**: Tasks 1, 3, 4

  **References**:

  **Pattern References**:
  - `src/index.ts:404-450` — `runDiscoverCommand` function. Line ~404 uses `targetLanguages?.[0]` — replace with `getTargetLanguages()` iteration
  - `src/index.ts:653-658` — `run` command registration. Delegates to `src/commands/run.ts`

  **API/Type References**:
  - `src/lib/config.ts` — `getTargetLanguages()` helper from Task 3
  - `src/types/index.ts:120` — `targetLanguages: string[]` type definition

  **WHY Each Reference Matters**:
  - `index.ts:404`: THE line with `targetLanguages?.[0]` that causes the single-language bug in the old CLI path
  - `index.ts:653-658`: Shows the new `run` command delegation — old paths must be consistent with this

  **Acceptance Criteria**:
  - [ ] `bun test` passes (357+ pass, 0 fail)
  - [ ] No remaining `targetLanguages?.[0]` in codebase (grep returns empty)

  **QA Scenarios**:

  ```
  Scenario: No more hardcoded first-language references
    Tool: Bash
    Preconditions: Working directory is /Users/jnnj92/gittributor
    Steps:
      1. Run: grep -rn "targetLanguages\??\.\[0\]" src/ || echo "CLEAN"
      2. Assert output is "CLEAN"
    Expected Result: Zero occurrences of targetLanguages?.[0] in source
    Failure Indicators: Any file:line matches found
    Evidence: .sisyphus/evidence/task-5-no-hardcoded-lang.txt

  Scenario: Old discover command uses multi-language
    Tool: Bash
    Preconditions: Working directory is /Users/jnnj92/gittributor
    Steps:
      1. Run: grep -n "getTargetLanguages" src/index.ts
      2. Assert at least one match exists (showing the import and usage)
    Expected Result: getTargetLanguages is imported and used in index.ts
    Failure Indicators: No matches — old code path still uses direct array access
    Evidence: .sisyphus/evidence/task-5-old-cli-updated.txt
  ```

  **Commit**: YES
  - Message: `fix(cli): update legacy CLI paths to use multi-language iteration`
  - Files: `src/index.ts`
  - Pre-commit: `bun test`

---

- [ ] 6. Per-language logging and summary output

  **What to do**:
  - Add structured logging at the start/end of each language iteration in `runOrchestrator`
  - Log format: `[language N/total] Starting discovery for {language}...`
  - After each language completes, log: `[language N/total] {language}: discovered={count}, submitted={count}, errors={count}`
  - At the end of the full run, print a summary table:
    ```
    === Multi-Language Run Summary ===
    Language    | Discovered | Submitted | Errors
    typescript  |     5      |     2     |   0
    javascript  |     3      |     1     |   1
    python      |     4      |     0     |   0
    TOTAL       |    12      |     3     |   1
    Global weekly budget remaining: 7/10
    ```
  - Use existing logger utility (check `src/lib/logger.ts` or console patterns in codebase)
  - Track per-language stats in a simple `Map<string, { discovered: number, submitted: number, errors: number }>`

  **Must NOT do**:
  - Don't add external logging libraries
  - Don't persist stats to disk (runtime only)
  - Don't change guardrail logic — this is display only

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Simple logging additions, no architectural complexity
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - `oracle`: No debugging needed, straightforward addition

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2 (after Task 4)
  - **Blocks**: Tasks 7, 8
  - **Blocked By**: Task 4

  **References**:

  **Pattern References**:
  - `src/commands/run.ts` — `runOrchestrator` function where the multi-language loop lives (from Task 4)
  - `src/lib/guardrails.ts:MAX_GLOBAL_WEEKLY` — reference for budget remaining calculation

  **API/Type References**:
  - `src/lib/state.ts` — state getters to count discovered/submitted repos per iteration

  **WHY Each Reference Matters**:
  - `run.ts`: The loop from Task 4 is where logging hooks in — before/after each iteration
  - `guardrails.ts`: Need to read remaining weekly budget for summary display
  - `state.ts`: Count pipeline stages to populate per-language stats

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Multi-language run produces per-language log lines
    Tool: Bash
    Preconditions: Working directory is /Users/jnnj92/gittributor, Task 4 complete
    Steps:
      1. Run: bun run src/index.ts run --dry-run 2>&1 | grep -E "^\[language"
      2. Assert output contains lines like "[language 1/3] Starting discovery for typescript"
      3. Assert output contains lines like "[language 1/3] typescript: discovered="
    Expected Result: Each configured language has start and completion log lines
    Failure Indicators: No "[language" prefix lines in output
    Evidence: .sisyphus/evidence/task-6-per-language-logs.txt

  Scenario: Summary table prints after all languages complete
    Tool: Bash
    Preconditions: Working directory is /Users/jnnj92/gittributor, dry-run mode
    Steps:
      1. Run: bun run src/index.ts run --dry-run 2>&1 | grep -A 10 "Multi-Language Run Summary"
      2. Assert table headers present: "Language", "Discovered", "Submitted", "Errors"
      3. Assert "TOTAL" row exists
      4. Assert "Global weekly budget remaining" line exists
    Expected Result: Summary table with all languages and totals displayed
    Failure Indicators: No summary table or missing columns
    Evidence: .sisyphus/evidence/task-6-summary-table.txt
  ```

  **Commit**: YES
  - Message: `feat(run): add per-language logging and summary output`
  - Files: `src/commands/run.ts`
  - Pre-commit: `bun test`

---

- [ ] 7. Unit tests for multi-language orchestration

  **What to do**:
  - Create test file `src/commands/__tests__/run.multi-lang.test.ts`
  - Test cases:
    1. **Iterates all configured languages**: Mock discover/analyze/fix/review/submit. Assert each is called once per language in `targetLanguages`
    2. **Resets state between languages**: Assert `resetState()` is called between each language iteration
    3. **Passes language to discover**: Assert `discover()` receives `{ language: "typescript" }`, then `{ language: "javascript" }`, etc.
    4. **Fail-forward on error**: Mock discover to throw for one language. Assert remaining languages still execute
    5. **Respects MAX_GLOBAL_WEEKLY across languages**: Mock state to show 9/10 weekly used. Assert second language iteration checks budget and stops early if exhausted
    6. **Empty targetLanguages**: Assert graceful exit with warning message
    7. **Single language**: Assert works identically to old behavior (regression)
  - Use existing test patterns from `src/commands/__tests__/` directory
  - Mock external dependencies (GitHub API, file system) — test orchestration logic only

  **Must NOT do**:
  - Don't test discover/analyze/fix internals — only test orchestration
  - Don't make network calls — all mocked
  - Don't modify existing test files

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Multiple test scenarios requiring careful mocking and assertion design
  - **Skills**: [`test-driven-development`]
    - `test-driven-development`: Test design patterns, assertion best practices
  - **Skills Evaluated but Omitted**:
    - `oracle`: Not debugging, writing new tests

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3 (after Tasks 4, 6)
  - **Blocks**: Task 9
  - **Blocked By**: Tasks 4, 6

  **References**:

  **Pattern References**:
  - `src/commands/__tests__/` — existing test directory for command tests, follow same patterns
  - `src/commands/run.ts` — the `runOrchestrator` function being tested

  **API/Type References**:
  - `src/lib/state.ts:resetState` — function to verify is called between iterations
  - `src/lib/config.ts:getTargetLanguages` — function to mock for language list
  - `src/lib/guardrails.ts:MAX_GLOBAL_WEEKLY` — constant to test budget exhaustion

  **Test References**:
  - `src/commands/__tests__/discover.test.ts` — existing test patterns for command testing (mocking, assertions)

  **WHY Each Reference Matters**:
  - `__tests__/` directory: Must follow existing file naming and import patterns
  - `run.ts`: The exact function signatures to mock and test
  - `state.ts/config.ts/guardrails.ts`: Dependencies that need mocking

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: All multi-language orchestration tests pass
    Tool: Bash
    Preconditions: Working directory is /Users/jnnj92/gittributor, Tasks 4 and 6 complete
    Steps:
      1. Run: bun test src/commands/__tests__/run.multi-lang.test.ts
      2. Assert exit code 0
      3. Assert output shows 7 passing tests (one per test case listed above)
      4. Assert 0 failures
    Expected Result: 7 pass, 0 fail, 0 skip
    Failure Indicators: Any test failure or file not found error
    Evidence: .sisyphus/evidence/task-7-unit-tests.txt

  Scenario: Tests actually verify fail-forward behavior
    Tool: Bash
    Preconditions: Test file exists
    Steps:
      1. Run: grep -n "throw\|error\|fail-forward\|continues" src/commands/__tests__/run.multi-lang.test.ts
      2. Assert at least one test explicitly throws an error in a mock and verifies subsequent languages still run
    Expected Result: Fail-forward test case exists with explicit error injection
    Failure Indicators: No error injection patterns found in test file
    Evidence: .sisyphus/evidence/task-7-fail-forward-verify.txt
  ```

  **Commit**: YES
  - Message: `test(run): add unit tests for multi-language orchestration`
  - Files: `src/commands/__tests__/run.multi-lang.test.ts`
  - Pre-commit: `bun test`

---

- [ ] 8. Integration Test — Full CLI Dry-Run with Multiple Languages

  **What to do**:
  - Create `src/commands/__tests__/run.integration.test.ts`
  - Test the full `runOrchestrator` flow end-to-end with mocked GitHub API
  - Mock `discover()`, `analyze()`, `fix()`, `review()`, `submit()` at module level
  - Test with config `targetLanguages: ["typescript", "javascript", "python"]`
  - Verify: discover is called 3 times with correct language parameter each time
  - Verify: state is reset between languages (resetState called between iterations)
  - Verify: MAX_GLOBAL_WEEKLY budget is shared across all languages
  - Verify: summary output includes per-language stats
  - Verify: if one language errors, others still complete (fail-forward at integration level)

  **Must NOT do**:
  - Make real GitHub API calls
  - Modify any production source files
  - Test individual pipeline steps in isolation (that's Task 7's job)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Integration testing requires understanding full system flow and careful mock setup
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 9)
  - **Parallel Group**: Wave 3 (with Tasks 7, 9)
  - **Blocks**: F1, F2, F3, F4
  - **Blocked By**: Tasks 4, 5, 6

  **References**:

  **Pattern References**:
  - `src/commands/__tests__/` — Existing test directory structure and conventions
  - `src/commands/run.ts:runOrchestrator` — The function under test; trace its full call chain

  **API/Type References**:
  - `src/commands/run.ts:RunOptions` — Interface for orchestrator options (will include `language` after Task 1)
  - `src/lib/state.ts:resetState` — State reset function (created in Task 2)
  - `src/lib/guardrails.ts:MAX_GLOBAL_WEEKLY` — Budget cap at line ~15

  **Test References**:
  - `src/commands/__tests__/run.multi-lang.test.ts` — Unit test patterns from Task 7; follow same mock style

  **External References**:
  - Bun test docs: `https://bun.sh/docs/cli/test` — mock.module() for mocking imports

  **WHY Each Reference Matters**:
  - `runOrchestrator` is the exact function being integration-tested — need its full signature and call chain
  - `resetState` must be verified as called between iterations — need its export path
  - `MAX_GLOBAL_WEEKLY` is the cross-language budget — integration test must verify it's respected

  **Acceptance Criteria**:
  - [ ] Test file created: `src/commands/__tests__/run.integration.test.ts`
  - [ ] `bun test src/commands/__tests__/run.integration.test.ts` → PASS (all tests, 0 failures)
  - [ ] At least 4 test cases: multi-lang iteration, state reset verification, budget sharing, fail-forward

  **QA Scenarios**:

  ```
  Scenario: Integration tests pass
    Tool: Bash
    Preconditions: Tasks 4-7 complete, all source changes in place
    Steps:
      1. Run: bun test src/commands/__tests__/run.integration.test.ts
      2. Capture stdout
      3. Assert exit code 0
      4. Assert 0 failures in output
    Expected Result: All integration tests pass (4+ tests, 0 fail)
    Failure Indicators: Any test failure, import errors, or mock setup errors
    Evidence: .sisyphus/evidence/task-8-integration-tests.txt

  Scenario: Integration tests cover cross-language budget
    Tool: Bash
    Preconditions: Test file exists
    Steps:
      1. Run: grep -n "MAX_GLOBAL_WEEKLY\|budget\|global.*week" src/commands/__tests__/run.integration.test.ts
      2. Assert at least one test verifies budget is shared across languages
    Expected Result: Budget-related assertions exist in integration tests
    Failure Indicators: No budget verification found
    Evidence: .sisyphus/evidence/task-8-budget-verify.txt
  ```

  **Commit**: YES
  - Message: `test(run): add integration tests for multi-language CLI flow`
  - Files: `src/commands/__tests__/run.integration.test.ts`
  - Pre-commit: `bun test`

---

- [ ] 9. Existing Test Regression Check

  **What to do**:
  - Run the full existing test suite: `bun test`
  - Baseline: 357 pass, 3 skip, 0 fail
  - Verify no regressions from Tasks 1-8 changes
  - If any existing test fails, fix the root cause (likely a type change or import path)
  - Do NOT modify existing test assertions — fix the source code to maintain backward compatibility

  **Must NOT do**:
  - Skip or disable existing tests
  - Modify existing test expectations to match new behavior
  - Add new tests (that's Tasks 7-8)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Simple verification task — run tests, check output, fix if needed
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO (must run after all implementation tasks)
  - **Parallel Group**: Wave 3 (sequential after Tasks 7, 8)
  - **Blocks**: F1, F2, F3, F4
  - **Blocked By**: Tasks 1-8 (all)

  **References**:

  **Pattern References**:
  - `src/commands/__tests__/` — All existing test files
  - `src/lib/__tests__/` — All existing lib test files

  **Test References**:
  - Baseline: `bun test` output showing 357 pass, 3 skip, 0 fail

  **WHY Each Reference Matters**:
  - Need to compare post-change test results against the 357/3/0 baseline
  - Any delta indicates a regression caused by multi-language changes

  **Acceptance Criteria**:
  - [ ] `bun test` → 357+ pass, 3 skip, 0 fail (new tests may increase pass count)
  - [ ] Zero regressions in existing tests
  - [ ] If fixes needed, they maintain backward compatibility

  **QA Scenarios**:

  ```
  Scenario: Full test suite passes with no regressions
    Tool: Bash
    Preconditions: All Tasks 1-8 complete
    Steps:
      1. Run: bun test 2>&1
      2. Capture full output
      3. Parse: extract pass/skip/fail counts
      4. Assert: pass >= 357, skip == 3, fail == 0
    Expected Result: 357+ pass, 3 skip, 0 fail
    Failure Indicators: fail > 0 or pass < 357
    Evidence: .sisyphus/evidence/task-9-regression-check.txt

  Scenario: No tests were modified or deleted
    Tool: Bash
    Preconditions: Git working tree has all changes
    Steps:
      1. Run: git diff --name-only HEAD | grep -E "\.test\.(ts|js)$" | grep -v "run.multi-lang\|run.integration"
      2. Assert empty output (no existing test files were modified)
    Expected Result: No existing test files appear in diff
    Failure Indicators: Any existing test file shows up as modified
    Evidence: .sisyphus/evidence/task-9-no-test-modifications.txt
  ```

  **Commit**: NO (groups with prior task if fixes needed, otherwise no commit)

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
>
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, run command). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in `.sisyphus/evidence/`. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [9/9] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Run `bun test`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, `console.log` in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names (data/result/item/temp).
  Output: `Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Real Manual QA** — `unspecified-high`
  Start from clean state. Execute EVERY QA scenario from EVERY task — follow exact steps, capture evidence. Test cross-task integration (multi-language iteration + state reset + budget + logging all working together). Save to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff (`git diff`). Verify 1:1 — everything in spec was built, nothing beyond spec was built. Check "Must NOT do" compliance. Detect cross-task contamination. Flag unaccounted changes.
  Output: `Tasks [9/9 compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

| Task | Message | Files | Pre-commit |
|------|---------|-------|------------|
| 1 | `feat(types): add language field to RunOptions and DiscoverOptions` | `src/commands/run.ts`, `src/commands/discover.ts` | `bun test` |
| 2 | `feat(state): add resetState function for multi-language iteration` | `src/lib/state.ts` | `bun test` |
| 3 | `feat(config): add getTargetLanguages helper` | `src/lib/config.ts` | `bun test` |
| 4 | `feat(run): implement multi-language loop in runOrchestrator` | `src/commands/run.ts` | `bun test` |
| 5 | `refactor(cli): replace targetLanguages[0] with multi-language iteration` | `src/index.ts` | `bun test` |
| 6 | `feat(run): add per-language logging and summary output` | `src/commands/run.ts` | `bun test` |
| 7 | `test(run): add unit tests for multi-language orchestration` | `src/commands/__tests__/run.multi-lang.test.ts` | `bun test` |
| 8 | `test(run): add integration tests for multi-language CLI flow` | `src/commands/__tests__/run.integration.test.ts` | `bun test` |
| 9 | (no commit — regression check only) | — | `bun test` |

---

## Success Criteria

### Verification Commands
```bash
# 1. All tests pass (baseline + new)
bun test  # Expected: 364+ pass, 3 skip, 0 fail

# 2. Multi-language config is respected
grep -n "getTargetLanguages" src/lib/config.ts  # Expected: function exists

# 3. State reset exists
grep -n "resetState" src/lib/state.ts  # Expected: exported function

# 4. runOrchestrator iterates languages
grep -n "for.*language\|forEach.*language" src/commands/run.ts  # Expected: iteration loop

# 5. Old single-language path replaced
grep -n "targetLanguages\?\.\[0\]" src/index.ts  # Expected: NO matches (replaced)

# 6. MAX_GLOBAL_WEEKLY is shared (not per-language)
grep -n "MAX_GLOBAL_WEEKLY" src/commands/run.ts  # Expected: checked outside inner loop
```

### Final Checklist
- [ ] All "Must Have" present: multi-language iteration, state reset, fail-forward, budget sharing
- [ ] All "Must NOT Have" absent: no per-language budget caps, no new config schema, no DB changes
- [ ] All tests pass: `bun test` → 0 failures
- [ ] `targetLanguages?.[0]` pattern eliminated from codebase
- [ ] Each language gets its own discover→analyze→fix→review→submit cycle
- [ ] MAX_GLOBAL_WEEKLY=10 respected across ALL languages combined
- [ ] Summary output shows per-language contribution stats

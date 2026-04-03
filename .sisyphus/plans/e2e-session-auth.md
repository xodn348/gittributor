# End-to-End Pipeline + OAuth Dual Auth + Remove GITHUB_TOKEN

## TL;DR

> **Quick Summary**: Add a `run` command that chains discover→analyze→fix→review→submit as the default pipeline with auto-approve, support OAuth 2.0 PKCE tokens (`CLAUDE_CODE_OAUTH_TOKEN`) alongside existing `ANTHROPIC_API_KEY`, and remove `GITHUB_TOKEN` requirement (already uses `gh` CLI).
> 
> **Deliverables**:
> - `run` command with end-to-end pipeline and auto-approve
> - Dual auth: `ANTHROPIC_API_KEY` (x-api-key) + `CLAUDE_CODE_OAUTH_TOKEN` (Bearer + anthropic-beta header)
> - `GITHUB_TOKEN` removed from config validation
> - Updated README with simple setup commands
> - All existing tests updated
> 
> **Estimated Effort**: Medium
> **Parallel Execution**: YES - 4 waves
> **Critical Path**: Task 1 (types) → Task 5 (callAnthropic dual auth) → Task 9 (run command) → Task 11 (test updates)

---

## Context

### Original Request
User requested: "기본적으로 end-to-end로 되게하고. api말고 세션키만 있어도 되도록 수정해" and "세션쿠키. 깃헙 토큰이 뭔데. 세팅하는것도 readme에 간단하게 명령어만 둬"

Translation: Make it end-to-end by default. Allow session cookie auth instead of just API key. Remove GitHub token requirement. Keep README setup simple.

### Interview Summary
**Key Discussions**:
- **Session cookie → OAuth pivot**: Metis research revealed session cookies (`sk-ant-sid01-...`) are dead — Anthropic blocked non-browser traffic. Viable alternative: OAuth 2.0 PKCE tokens (`sk-ant-oat01-...`) used by Claude Code
- **Same endpoint**: OAuth tokens use the SAME `api.anthropic.com/v1/messages` endpoint — only headers change
- **GitHub token unnecessary**: `GITHUB_TOKEN` is validated in config but never used — all GitHub ops use `gh` CLI via Bun.spawn
- **Dual auth**: Support both `ANTHROPIC_API_KEY` and `CLAUDE_CODE_OAUTH_TOKEN` for backward compatibility

**Research Findings**:
- `Explosion-Scratch/claude-unofficial-api` confirms session cookies are blocked
- OAuth tokens use `Authorization: Bearer` + `anthropic-beta: oauth-2025-04-20` headers
- When both tokens are set, OAuth takes priority
- Token type can be inferred from prefix: `sk-ant-oat01-` = OAuth, anything else = API key

### Metis Review
**Identified Gaps** (addressed):
- Session cookie auth is dead → Pivoted to OAuth 2.0 PKCE tokens
- Need backward compatibility → Dual auth support with token prefix detection
- `GITHUB_TOKEN` only validated, never used → Clean removal confirmed safe

---

## Work Objectives

### Core Objective
Add end-to-end `run` command, support OAuth tokens alongside API keys, remove unused `GITHUB_TOKEN`, and simplify README setup.

### Concrete Deliverables
- `src/commands/run.ts` — new `run` command implementation
- Modified `src/lib/anthropic.ts` — dual auth header branching in `callAnthropic()`
- Modified `src/lib/config.ts` — `CLAUDE_CODE_OAUTH_TOKEN` support, `GITHUB_TOKEN` removed
- Modified `src/types/index.ts` — `Config` interface updated, `CommandName` includes `"run"`
- Modified `src/types/guards.ts` — type guards updated
- Modified `src/commands/cli.ts` — parser handles `"run"`
- Modified `src/commands/review.ts` — auto-approve mode
- Modified `src/lib/analyzer.ts` — use config instead of direct env read
- Modified `src/lib/fix-generator.ts` — use config instead of direct env read
- Updated `README.md` — simple setup with `gh auth login` + OAuth token
- Updated test files — all references to `ANTHROPIC_API_KEY` and `GITHUB_TOKEN`

### Definition of Done
- [ ] `bun test` passes with 0 failures
- [ ] `bun run build` succeeds (if applicable)
- [ ] `CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-test bun run src/index.ts run --help` shows run command
- [ ] `ANTHROPIC_API_KEY=test bun run src/index.ts run --help` still works (backward compat)
- [ ] No references to `GITHUB_TOKEN` in source code (tests may mock its absence)
- [ ] README contains only simple setup commands

### Must Have
- Dual auth: both `ANTHROPIC_API_KEY` and `CLAUDE_CODE_OAUTH_TOKEN` work
- `run` command chains all 5 steps with auto-approve on review
- `GITHUB_TOKEN` completely removed from config validation
- Existing tests pass after updates

### Must NOT Have (Guardrails)
- MUST NOT add session cookie support (`sk-ant-sid01-...`), User-Agent spoofing, or Cloudflare bypass
- MUST NOT add token refresh logic, setup wizard, retry logic, progress bars, or `--dry-run` flag
- MUST NOT change the API endpoint (`api.anthropic.com/v1/messages`)
- MUST NOT add new npm/bun dependencies
- MUST NOT modify pipeline state machine logic beyond adding `run` command flow
- MUST NOT over-abstract — no `AuthStrategy` class hierarchy or factory patterns
- MUST NOT add excessive JSDoc or inline comments beyond what exists

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: YES (bun test, 14+ test files)
- **Automated tests**: Tests-after — update existing tests to work with new auth
- **Framework**: bun test

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **CLI**: Use interactive_bash (tmux) — Run command, validate output, check exit code
- **Library/Module**: Use Bash (bun test) — Run specific test files, compare output

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately — types + config foundation):
├── Task 1: Update types (CommandName, Config, ParsedSubcommand) [quick]
├── Task 2: Update type guards (isCommandName, isConfig) [quick]
├── Task 3: Remove GITHUB_TOKEN from config.ts [quick]
└── Task 4: Update CLI parser for "run" command [quick]

Wave 2 (After Wave 1 — core auth + module fixes):
├── Task 5: Dual auth in callAnthropic() [deep]
├── Task 6: Update config.ts loadConfig() for dual env vars [quick]
├── Task 7: Update analyzer.ts — use config instead of direct env [quick]
└── Task 8: Update fix-generator.ts — use config instead of direct env [quick]

Wave 3 (After Wave 2 — run command + README):
├── Task 9: Implement run command with auto-approve [deep]
└── Task 10: Rewrite README.md [writing]

Wave 4 (After Wave 3 — test updates):
├── Task 11: Update tests/config.test.ts [quick]
├── Task 12: Update tests/cli-entrypoint.test.ts [quick]
└── Task 13: Update tests/index.test.ts + remaining test files [quick]

Wave FINAL (After ALL tasks):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Real manual QA (unspecified-high)
└── Task F4: Scope fidelity check (deep)
-> Present results -> Get explicit user okay

Critical Path: Task 1 → Task 5 → Task 9 → Task 11 → F1-F4 → user okay
Parallel Speedup: ~60% faster than sequential
Max Concurrent: 4 (Wave 1)
```

### Dependency Matrix

| Task | Depends On | Blocks |
|------|-----------|--------|
| 1 | — | 2, 4, 5, 6, 7, 8, 9 |
| 2 | 1 | 6, 9, 11 |
| 3 | — | 6, 11 |
| 4 | 1 | 9, 12 |
| 5 | 1 | 9, 11, 12 |
| 6 | 1, 2, 3 | 9, 11 |
| 7 | 1 | 13 |
| 8 | 1 | 13 |
| 9 | 4, 5, 6 | 12 |
| 10 | — | — |
| 11 | 2, 3, 5, 6 | — |
| 12 | 4, 5, 9 | — |
| 13 | 7, 8 | — |

### Agent Dispatch Summary

- **Wave 1**: **4 tasks** — T1 → `quick`, T2 → `quick`, T3 → `quick`, T4 → `quick`
- **Wave 2**: **4 tasks** — T5 → `deep`, T6 → `quick`, T7 → `quick`, T8 → `quick`
- **Wave 3**: **2 tasks** — T9 → `deep`, T10 → `writing`
- **Wave 4**: **3 tasks** — T11 → `quick`, T12 → `quick`, T13 → `quick`
- **FINAL**: **4 tasks** — F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep`

---

## TODOs

- [ ] 1. Update Type Definitions (CommandName, Config, ParsedSubcommand)

  **What to do**:
  - In `src/types/index.ts`: Add `"run"` to `CommandName` type union (line 2)
  - In `src/types/index.ts`: Update `Config` interface (line 96-103) — change `anthropicApiKey: string` to `anthropicApiKey?: string` and add `oauthToken?: string`. At least one must be present (validated at runtime in config.ts, not in type)
  - In `src/commands/cli.ts`: Add `"run"` to `ParsedSubcommand` type union (line 3)

  **Must NOT do**:
  - Do NOT add `AuthStrategy` class or factory pattern — keep it simple with optional fields
  - Do NOT add any new types beyond what's listed

  **Recommended Agent Profile**:
  - **Subagent Type**: `quick`
    - Reason: Simple type changes across 2 files, ~10 lines total
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3, 4)
  - **Blocks**: Tasks 2, 4, 5, 6, 7, 8, 9
  - **Blocked By**: None (can start immediately)

  **References**:
  - `src/types/index.ts:2` — Current `CommandName` type: `"discover" | "analyze" | "fix" | "review" | "submit"` — add `"run"`
  - `src/types/index.ts:96-103` — Current `Config` interface with `anthropicApiKey: string` — make optional + add `oauthToken?: string`
  - `src/commands/cli.ts:3` — Current `ParsedSubcommand` type — add `"run"`

  **Acceptance Criteria**:
  - [ ] `CommandName` includes `"run"` literal
  - [ ] `Config` has both `anthropicApiKey?: string` and `oauthToken?: string`
  - [ ] `ParsedSubcommand` includes `"run"` literal
  - [ ] No TypeScript errors: `bunx tsc --noEmit` (may have downstream errors until other tasks complete)

  **QA Scenarios**:
  ```
  Scenario: Type definitions compile
    Tool: Bash
    Preconditions: Tasks 1 files saved
    Steps:
      1. Run: grep -n '"run"' src/types/index.ts
      2. Assert: output contains "run" in CommandName union
      3. Run: grep -n 'oauthToken' src/types/index.ts
      4. Assert: output shows oauthToken field in Config
    Expected Result: Both "run" and "oauthToken" present in types
    Evidence: .sisyphus/evidence/task-1-types-compile.txt
  ```

  **Commit**: YES (groups with Wave 1)
  - Message: `refactor(types): add run command type and dual auth config fields`
  - Files: `src/types/index.ts`, `src/commands/cli.ts`

- [ ] 2. Update Type Guards (isCommandName, isConfig)

  **What to do**:
  - In `src/types/guards.ts`: Add `"run"` to `isCommandName()` function (line 22-29) — add to the checked values array
  - In `src/types/guards.ts`: Update `isConfig()` function (line 146-157) — validate that at least one of `anthropicApiKey` or `oauthToken` is a non-empty string (instead of requiring `anthropicApiKey`)

  **Must NOT do**:
  - Do NOT add complex validation logic — simple `||` check is sufficient
  - Do NOT add token format validation (prefix checking) here — that belongs in config.ts

  **Recommended Agent Profile**:
  - **Subagent Type**: `quick`
    - Reason: Small changes to 2 functions in 1 file
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3, 4)
  - **Blocks**: Tasks 6, 9, 11
  - **Blocked By**: Task 1 (needs updated Config type)

  **References**:
  - `src/types/guards.ts:22-29` — `isCommandName()` checks 5 string values — add `"run"` as 6th
  - `src/types/guards.ts:146-157` — `isConfig()` validates `anthropicApiKey` as required string — change to: at least one of `anthropicApiKey` or `oauthToken` must be non-empty string

  **Acceptance Criteria**:
  - [ ] `isCommandName("run")` returns `true`
  - [ ] `isConfig({ oauthToken: "sk-ant-oat01-test" })` returns `true` (no anthropicApiKey)
  - [ ] `isConfig({ anthropicApiKey: "sk-ant-api-test" })` returns `true` (no oauthToken)
  - [ ] `isConfig({})` returns `false` (neither token)

  **QA Scenarios**:
  ```
  Scenario: isCommandName accepts "run"
    Tool: Bash
    Preconditions: Task 2 changes applied
    Steps:
      1. Run: bun -e "import { isCommandName } from './src/types/guards'; console.log(isCommandName('run'))"
      2. Assert: output is "true"
    Expected Result: true
    Evidence: .sisyphus/evidence/task-2-command-name-guard.txt

  Scenario: isConfig accepts oauthToken without apiKey
    Tool: Bash
    Preconditions: Task 2 changes applied
    Steps:
      1. Run: bun -e "import { isConfig } from './src/types/guards'; console.log(isConfig({ oauthToken: 'test' }))"
      2. Assert: output is "true"
      3. Run: bun -e "import { isConfig } from './src/types/guards'; console.log(isConfig({}))"
      4. Assert: output is "false"
    Expected Result: true for oauthToken-only, false for empty
    Evidence: .sisyphus/evidence/task-2-config-guard.txt
  ```

  **Commit**: YES (groups with Wave 1)
  - Message: `refactor(guards): support run command and dual auth in type guards`
  - Files: `src/types/guards.ts`

- [ ] 3. Remove GITHUB_TOKEN from Config Validation

  **What to do**:
  - In `src/lib/config.ts`: Remove `GITHUB_TOKEN` validation from `loadConfig()` (line 93, and lines 99-101 where it throws if missing)
  - Remove any `githubToken` field from config object construction if present
  - Keep the rest of `loadConfig()` intact

  **Must NOT do**:
  - Do NOT remove `gh` CLI usage anywhere — only remove env var validation
  - Do NOT touch `DEFAULT_CONFIG` unless it references githubToken

  **Recommended Agent Profile**:
  - **Subagent Type**: `quick`
    - Reason: Removing ~5 lines from one function in one file
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 4)
  - **Blocks**: Tasks 6, 11
  - **Blocked By**: None (can start immediately)

  **References**:
  - `src/lib/config.ts:91-122` — `loadConfig()` function — line 93 reads `GITHUB_TOKEN`, lines 99-101 throw if missing
  - `src/lib/github.ts` — Confirms GitHub operations use `gh` CLI, NOT `GITHUB_TOKEN` env var directly

  **Acceptance Criteria**:
  - [ ] `grep -r "GITHUB_TOKEN" src/lib/config.ts` returns no matches
  - [ ] `loadConfig()` no longer throws when `GITHUB_TOKEN` is unset

  **QA Scenarios**:
  ```
  Scenario: Config loads without GITHUB_TOKEN
    Tool: Bash
    Preconditions: GITHUB_TOKEN unset, ANTHROPIC_API_KEY set
    Steps:
      1. Run: ANTHROPIC_API_KEY=test bun -e "import { loadConfig } from './src/lib/config'; const c = loadConfig(); console.log('ok')"
      2. Assert: output is "ok" (no error thrown)
    Expected Result: Config loads successfully without GITHUB_TOKEN
    Evidence: .sisyphus/evidence/task-3-no-github-token.txt

  Scenario: No GITHUB_TOKEN references in config source
    Tool: Bash
    Steps:
      1. Run: grep -c "GITHUB_TOKEN" src/lib/config.ts
      2. Assert: output is "0"
    Expected Result: Zero references to GITHUB_TOKEN
    Evidence: .sisyphus/evidence/task-3-grep-github-token.txt
  ```

  **Commit**: YES (groups with Wave 1)
  - Message: `refactor(config): remove unused GITHUB_TOKEN validation`
  - Files: `src/lib/config.ts`

  - [ ] Neither set → throws error

  **QA Scenarios**:
  ```
  Scenario: Config loads with OAuth token only
    Tool: Bash
    Steps:
      1. Run: CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-test bun -e "import { loadConfig } from './src/lib/config'; const c = loadConfig(); console.log(c.oauthToken || 'missing')"
      2. Assert: output is "sk-ant-oat01-test"
    Expected Result: OAuth token loaded into config
    Evidence: .sisyphus/evidence/task-6-oauth-config.txt

  Scenario: Config throws when no auth token provided
    Tool: Bash
    Preconditions: No ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN set
    Steps:
      1. Run: env -u ANTHROPIC_API_KEY -u CLAUDE_CODE_OAUTH_TOKEN bun -e "import { loadConfig } from './src/lib/config'; try { loadConfig(); } catch(e) { console.log('error:', e.message); }"
      2. Assert: output contains "error:" (validation threw)
    Expected Result: Error thrown when no auth token available
    Evidence: .sisyphus/evidence/task-6-no-auth-error.txt
  ```

  **Commit**: YES (groups with Wave 2)
  - Message: `feat(config): support CLAUDE_CODE_OAUTH_TOKEN env var`
  - Files: `src/lib/config.ts`

- [ ] 7. Update analyzer.ts — Use Config Instead of Direct Env Read

  **What to do**:
  - In `src/lib/analyzer.ts`: Remove direct `process.env.ANTHROPIC_API_KEY` read at line 278
  - Instead, accept the API key/OAuth token from the config object passed through the call chain
  - Ensure the token is passed to `analyzeCodeForIssue()` calls correctly (either `apiKey` or `oauthToken`)

  **Must NOT do**:
  - Do NOT restructure the analyzer beyond the auth change
  - Do NOT add new parameters beyond what's needed for dual auth

  **Recommended Agent Profile**:
  - **Subagent Type**: `quick`
    - Reason: Single line change + parameter threading in 1 file
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 5, 6, 8)
  - **Blocks**: Task 13
  - **Blocked By**: Task 1 (needs updated Config type)

  **References**:
  - `src/lib/analyzer.ts:278` — Direct `process.env.ANTHROPIC_API_KEY` read — replace with config pass-through
  - `src/lib/anthropic.ts:159` — `analyzeCodeForIssue()` signature (updated by Task 5 to accept oauthToken)

  **Acceptance Criteria**:
  - [ ] `grep "process.env.ANTHROPIC_API_KEY" src/lib/analyzer.ts` returns no matches
  - [ ] Analyzer receives token from config, not env directly

  **QA Scenarios**:
  ```
  Scenario: No direct env reads in analyzer
    Tool: Bash
    Steps:
      1. Run: grep -c "process.env.ANTHROPIC_API_KEY" src/lib/analyzer.ts
      2. Assert: output is "0"
    Expected Result: Zero direct env reads
    Evidence: .sisyphus/evidence/task-7-no-env-read.txt
  ```

  **Commit**: YES (groups with Wave 2)
  - Message: `refactor(analyzer): use config for auth token instead of direct env read`
  - Files: `src/lib/analyzer.ts`

- [ ] 8. Update fix-generator.ts — Use Config Instead of Direct Env Read

  **What to do**:
  - In `src/lib/fix-generator.ts`: Remove direct `process.env.ANTHROPIC_API_KEY` read at line 210
  - Instead, accept the API key/OAuth token from the config object passed through the call chain
  - Ensure the token is passed to `generateFix()` calls correctly

  **Must NOT do**:
  - Do NOT restructure the fix generator beyond the auth change

  **Recommended Agent Profile**:
  - **Subagent Type**: `quick`
    - Reason: Single line change + parameter threading in 1 file
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 5, 6, 7)
  - **Blocks**: Task 13
  - **Blocked By**: Task 1 (needs updated Config type)

  **References**:
  - `src/lib/fix-generator.ts:210` — Direct `process.env.ANTHROPIC_API_KEY` read — replace with config pass-through
  - `src/lib/anthropic.ts:199` — `generateFix()` signature (updated by Task 5)

  **Acceptance Criteria**:
  - [ ] `grep "process.env.ANTHROPIC_API_KEY" src/lib/fix-generator.ts` returns no matches

  **QA Scenarios**:
  ```
  Scenario: No direct env reads in fix-generator
    Tool: Bash
    Steps:
      1. Run: grep -c "process.env.ANTHROPIC_API_KEY" src/lib/fix-generator.ts
      2. Assert: output is "0"
    Expected Result: Zero direct env reads
    Evidence: .sisyphus/evidence/task-8-no-env-read.txt
  ```

  **Commit**: YES (groups with Wave 2)
  - Message: `refactor(fix-generator): use config for auth token instead of direct env read`
  - Files: `src/lib/fix-generator.ts`

- [ ] 9. Implement Run Command with Auto-Approve

  **What to do**:
  - Create `src/commands/run.ts` — new file implementing the `run` command
  - Chain the 5 pipeline steps in sequence: `discover → analyze → fix → review → submit`
  - Import and call existing command functions: `discoverIssues`, `analyzeIssues`, `generateFixes`, `reviewFixes`, `submitFixes` (or their equivalents)
  - For the review step: pass an `autoApprove: true` flag (or equivalent) to skip the interactive stdin prompt
  - In `src/commands/review.ts`: Modify `readDecision()` (line 62-71) to accept an `autoApprove` parameter — when true, return `"approve"` without prompting
  - Wire the `run` command into the main entry point (`src/index.ts` or `bin/gittributor.ts`) so that when CLI parses `"run"`, it calls this function
  - Handle errors: if any step fails, stop the pipeline and report which step failed

  **Must NOT do**:
  - MUST NOT add `--dry-run` flag
  - MUST NOT add progress bars or spinners
  - MUST NOT add retry logic between steps
  - MUST NOT modify pipeline state machine beyond what's needed

  **Recommended Agent Profile**:
  - **Subagent Type**: `deep`
    - Reason: New file creation + wiring into existing pipeline, touches 3 files
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Task 10)
  - **Blocks**: Task 12
  - **Blocked By**: Tasks 4 (CLI parser), 5 (dual auth), 6 (config)

  **References**:
  - `src/commands/review.ts:62-71` — `readDecision()` interactive prompt — add `autoApprove` bypass
  - `src/commands/review.ts:158` — `reviewFixes()` entry point
  - `src/index.ts` — Main entry, see how other commands are dispatched — follow same pattern for `run`
  - `src/commands/discover.ts` — Discover command pattern to follow
  - `src/commands/analyze.ts` — Analyze command pattern
  - `src/commands/fix.ts` — Fix command pattern
  - `src/commands/submit.ts` — Submit command pattern
  - `src/lib/state.ts` — Pipeline state management — `run` must transition through states correctly

  **Acceptance Criteria**:
  - [ ] `src/commands/run.ts` exists and exports a `runPipeline()` function
  - [ ] `review.ts` `readDecision()` accepts `autoApprove` param
  - [ ] CLI dispatches `"run"` subcommand to `runPipeline()`
  - [ ] Pipeline stops on first error with clear error message

  **QA Scenarios**:
  ```
  Scenario: Run command is wired and callable
    Tool: interactive_bash (tmux)
    Steps:
      1. Run: ANTHROPIC_API_KEY=test bun run src/index.ts run --help 2>&1 || true
      2. Assert: output does NOT contain "Unknown command" or "invalid subcommand"
      3. Assert: output contains "run" or "pipeline" or usage info
    Expected Result: run command recognized by CLI
    Evidence: .sisyphus/evidence/task-9-run-help.txt

  Scenario: Run command fails gracefully without valid API connection
    Tool: Bash
    Steps:
      1. Run: ANTHROPIC_API_KEY=fake-key bun run src/index.ts run 2>&1 || true
      2. Assert: output contains error message (not a crash/stack trace)
    Expected Result: Graceful error about missing repos or API failure
    Evidence: .sisyphus/evidence/task-9-run-error.txt
  ```

  **Commit**: YES (groups with Wave 3)
  - Message: `feat(cli): add run command for end-to-end pipeline with auto-approve`
  - Files: `src/commands/run.ts`, `src/commands/review.ts`, `src/index.ts`

- [ ] 10. Rewrite README.md with Simple Setup

  **What to do**:
  - Rewrite `README.md` to include simple setup commands only:
    - `gh auth login` for GitHub authentication
    - `export CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-...` (primary) or `export ANTHROPIC_API_KEY=sk-ant-api...` (alternative)
    - `bun install` and basic usage
    Tool: Bash
    Steps:
      1. Run: grep -rc "process.env.ANTHROPIC_API_KEY" src/
      2. Assert: all counts are "0"
    Expected Result: Zero direct env reads for ANTHROPIC_API_KEY in src/
    Evidence: .sisyphus/evidence/task-13-no-env-reads.txt
  ```

  **Commit**: YES (groups with Wave 4)
  - Message: `test: update remaining tests for dual auth`
  - Files: `tests/index.test.ts`, other affected test files
  - Pre-commit: `bun test`

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, run command). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Run `bun test`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names.
  Output: `Build [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Real Manual QA** — `unspecified-high`
  Start from clean state. Test CLI with `CLAUDE_CODE_OAUTH_TOKEN` only, `ANTHROPIC_API_KEY` only, both set, neither set. Test `run` command. Test `--help`. Verify no `GITHUB_TOKEN` validation. Save evidence to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff. Verify 1:1. Check "Must NOT do" compliance. Detect cross-task contamination. Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **Wave 1**: `refactor(types): add run command type and update Config for dual auth` — src/types/index.ts, src/types/guards.ts, src/lib/config.ts, src/commands/cli.ts
- **Wave 2**: `feat(auth): support OAuth PKCE tokens alongside API keys` — src/lib/anthropic.ts, src/lib/config.ts, src/lib/analyzer.ts, src/lib/fix-generator.ts
- **Wave 3**: `feat(cli): add run command for end-to-end pipeline` — src/commands/run.ts, src/commands/review.ts, README.md
- **Wave 4**: `test: update tests for dual auth and run command` — tests/*.test.ts
- Pre-commit for all: `bun test`

---

## Success Criteria

### Verification Commands
```bash
bun test                                    # Expected: all tests pass
CLAUDE_CODE_OAUTH_TOKEN=test bun run src/index.ts --help  # Expected: shows run command
ANTHROPIC_API_KEY=test bun run src/index.ts --help        # Expected: same output (backward compat)
grep -r "GITHUB_TOKEN" src/                 # Expected: no matches
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] All tests pass
- [ ] README contains only simple setup commands
- [ ] Both auth methods work

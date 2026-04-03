# Rewrite README.md — Concise English with Usage Essentials

## TL;DR

> **Quick Summary**: Rewrite gittributor's README.md to be concise, English-only, and focused on essentials — under 80 lines covering project description, prerequisites, install, usage, and env vars.
> 
> **Deliverables**:
> - Rewritten `README.md` (under 80 lines)
> - Git commit: `docs: rewrite README.md — concise English with usage essentials`
> 
> **Estimated Effort**: Quick
> **Parallel Execution**: NO — single task
> **Critical Path**: Task 1 → Done

---

## Context

### Original Request
User said: "readme에 영어로 다 적어줘. 사용법도 간단하게. 그리고 핵심만"
Translation: "Write everything in the README in English. Include usage simply. And only the essentials."

### Interview Summary
**Key Discussions**:
- Existing README is 147 lines — too verbose for user's taste
- Recent commit `5db8055` added impact scoring, `getFileTree()`, and `fileContents` to the fix pipeline
- User wants concise documentation, not comprehensive

**Research Findings**:
- Project is a Bun-based CLI with 5 sequential commands: discover → analyze → fix → review → submit
- Uses `gh` CLI for GitHub API, Anthropic API for AI analysis
- State persisted in `.gittributor/` directory between commands

### Metis Review
**Identified Gaps** (addressed):
- Line count target: Set to under 80 lines
- Scope creep prevention: No FAQ, Architecture, Contributing, or Roadmap sections
- Source verification: Executor must verify current command names/flags from CLI source before writing
- Acceptance criteria: Added concrete grep/wc assertions

---

## Work Objectives

### Core Objective
Rewrite `README.md` to be a concise, English-only reference with simple usage instructions — essentials only, under 80 lines.

### Concrete Deliverables
- `README.md` — rewritten, under 80 lines

### Definition of Done
- [ ] `wc -l README.md` returns < 80
- [ ] All 5 commands mentioned (discover, analyze, fix, review, submit)
- [ ] Env vars documented (GITHUB_TOKEN, ANTHROPIC_API_KEY)
- [ ] No Korean characters in README
- [ ] `bun test` still passes (no regressions)

### Must Have
- Title + one-line project description
- Prerequisites (Bun, GitHub token, Anthropic API key)
- Installation (1-2 lines)
- Usage: one line per command + one end-to-end workflow example
- Environment variables section
- Under 80 total lines

### Must NOT Have (Guardrails)
- No Architecture section
- No Contributing section
- No FAQ or Troubleshooting
- No Roadmap
- No verbose per-command parameter documentation (one-liner each)
- No ASCII art or fancy formatting
- No Korean text
- No new files created — only README.md modified
- No JSDoc-style parameter tables

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed.

### Test Decision
- **Infrastructure exists**: YES (bun test — 158 tests)
- **Automated tests**: None needed — documentation only
- **Framework**: N/A

### QA Policy
Agent-executed verification via Bash commands after writing README.

---

## Execution Strategy

### Single Wave (Documentation Task)

```
Wave 1 (Single Task):
└── Task 1: Rewrite README.md [writing]

Critical Path: Task 1 → Done
```

### Dependency Matrix
- **Task 1**: No dependencies, no blockers

### Agent Dispatch Summary
- **Wave 1**: 1 task → `hephaestus` (autonomous deep worker)

---

## TODOs

- [x] 1. Rewrite README.md — concise English with usage essentials

  **What to do**:
  1. Read current CLI source (`src/index.ts`, `src/commands/*.ts`) to verify: command names, flags, env vars, prerequisites
  2. Read current `README.md` to identify any valid external links to preserve
  3. Write new `README.md` under 80 lines with these sections:
     - **Title + one-liner**: `gittributor` — AI-powered open-source contribution CLI
     - **Prerequisites**: Bun, GITHUB_TOKEN, ANTHROPIC_API_KEY (3 bullets)
     - **Install**: `bun install` (2-3 lines)
     - **Usage**: One line per command (discover, analyze, fix, review, submit) + one end-to-end workflow block
     - **Options**: Brief — global flags + discover flags only, compact format
     - **Environment Variables**: Simple 2-row list
     - **Development**: `bun test`, `bun run build`, `bun run typecheck` — 3-4 lines max
  4. Mention impact scoring briefly as a feature note (1 line), not a full section
  5. Run acceptance checks (see QA Scenarios below)
  6. Commit: `docs: rewrite README.md — concise English with usage essentials`

  **Must NOT do**:
  - Add Architecture, Contributing, FAQ, Troubleshooting, or Roadmap sections
  - Exceed 80 lines
  - Include Korean text
  - Create or modify any file other than README.md
  - Add verbose parameter documentation

  **Recommended Agent Profile**:
  - **Subagent Type**: `hephaestus`
    - Reason: Autonomous deep worker — single deliverable requiring source reading + writing + verification end-to-end
  - **Skills**: [`hephaestus`]
    - `hephaestus`: Autonomous execution without hand-holding — reads source, writes docs, verifies, commits

  **Parallelization**:
  - **Can Run In Parallel**: N/A (only task)
  - **Parallel Group**: Wave 1 (solo)
  - **Blocks**: None
  - **Blocked By**: None (can start immediately)

  **References** (CRITICAL):

  **Pattern References**:
  - `README.md` (current, 147 lines) — Existing structure to trim. Preserve valid content, remove bloat.

  **API/Type References**:
  - `src/index.ts:15-33` — USAGE_TEXT constant defines the canonical command list and flag descriptions. Use this as the source of truth for what to document.
  - `src/index.ts:47` — `SupportedCommand` type lists all valid commands
  - `src/commands/cli.ts` — CLI argument parsing, flag definitions

  **Source of Truth for Features**:
  - `src/commands/analyze.ts` — Contains `IMPACT_PATTERNS` array and `scoreImpact()` function (impact scoring feature)
  - `src/lib/github.ts` — Contains `getFileTree()` method (file tree fetching)
  - `src/lib/fix-generator.ts` — Contains `buildFileContentsSection()` (file contents in LLM prompts)
  - `src/lib/analyzer.ts` — Contains `fileContents` population in `requestAnalysis()`

  **WHY Each Reference Matters**:
  - `src/index.ts:15-33`: The USAGE_TEXT is the CLI's own help output — README commands section should match it exactly
  - `src/commands/analyze.ts`: Impact scoring is a new feature worth a brief mention in README
  - `package.json:10-14`: Scripts section defines available dev commands (test, typecheck, build)

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: README line count is under 80
    Tool: Bash
    Preconditions: README.md has been rewritten
    Steps:
      1. Run: wc -l /Users/jnnj92/gittributor/README.md
      2. Assert: line count < 80
    Expected Result: Line count is between 40-80
    Failure Indicators: Line count >= 80 or < 20 (too short)
    Evidence: .sisyphus/evidence/task-1-line-count.txt

  Scenario: All 5 commands are documented
    Tool: Bash
    Preconditions: README.md has been rewritten
    Steps:
      1. Run: grep -c -E "discover|analyze|fix|review|submit" /Users/jnnj92/gittributor/README.md
      2. Assert: count >= 5
    Expected Result: At least 5 matches (one per command minimum)
    Failure Indicators: Any of the 5 commands missing
    Evidence: .sisyphus/evidence/task-1-commands-check.txt

  Scenario: Environment variables are documented
    Tool: Bash
    Preconditions: README.md has been rewritten
    Steps:
      1. Run: grep -q "ANTHROPIC_API_KEY" /Users/jnnj92/gittributor/README.md && echo "FOUND" || echo "MISSING"
      2. Run: grep -q "GITHUB_TOKEN" /Users/jnnj92/gittributor/README.md && echo "FOUND" || echo "MISSING"
      3. Assert: Both print "FOUND"
    Expected Result: Both env vars mentioned in README
    Failure Indicators: Either prints "MISSING"
    Evidence: .sisyphus/evidence/task-1-env-vars.txt

  Scenario: No Korean characters in README (English-only)
    Tool: Bash
    Preconditions: README.md has been rewritten
    Steps:
      1. Run: grep -P '[\xEA-\xED][\x80-\xBF]{2}' /Users/jnnj92/gittributor/README.md || echo "CLEAN"
      2. Assert: Output is "CLEAN" (no Korean found)
    Expected Result: No Korean Unicode characters present
    Failure Indicators: Any Korean text appears in output
    Evidence: .sisyphus/evidence/task-1-no-korean.txt

  Scenario: Tests still pass after README change
    Tool: Bash
    Preconditions: README.md has been rewritten
    Steps:
      1. Run: cd /Users/jnnj92/gittributor && bun test
      2. Assert: Exit code 0, "158 pass" or similar in output
    Expected Result: All tests pass (documentation change should not break tests)
    Failure Indicators: Any test failure or non-zero exit code
    Evidence: .sisyphus/evidence/task-1-tests-pass.txt
  ```

  **Evidence to Capture:**
  - [ ] task-1-line-count.txt
  - [ ] task-1-commands-check.txt
  - [ ] task-1-env-vars.txt
  - [ ] task-1-no-korean.txt
  - [ ] task-1-tests-pass.txt

  **Commit**: YES
  - Message: `docs: rewrite README.md — concise English with usage essentials`
  - Files: `README.md`
  - Pre-commit: `bun test`

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> Single task = simplified verification. One reviewer confirms the deliverable.

- [x] F1. **Documentation Quality Check** — `explore`
  Read the final README.md. Verify: under 80 lines, all 5 commands present, env vars documented, no Korean text, no bloat sections (FAQ/Architecture/Contributing). Verify commit exists with correct message. Run `bun test` to confirm no regressions.
  Output: `Line Count [PASS/FAIL] | Commands [5/5] | Env Vars [PASS/FAIL] | No Korean [PASS/FAIL] | No Bloat [PASS/FAIL] | Tests [PASS/FAIL] | VERDICT`

---

## Commit Strategy

- **Task 1**: `docs: rewrite README.md — concise English with usage essentials` — README.md, `bun test`

---

## Success Criteria

### Verification Commands
```bash
wc -l README.md                    # Expected: < 80
grep -c "discover\|analyze\|fix\|review\|submit" README.md  # Expected: >= 5
grep -q "ANTHROPIC_API_KEY" README.md && echo OK  # Expected: OK
grep -q "GITHUB_TOKEN" README.md && echo OK       # Expected: OK
bun test                           # Expected: 158 pass, 0 fail
```

### Final Checklist
- [ ] README.md under 80 lines
- [ ] All 5 commands documented
- [ ] Both env vars mentioned
- [ ] English only — no Korean
- [ ] No bloat sections (FAQ, Architecture, Contributing, Roadmap)
- [ ] Tests pass
- [ ] Commit created with correct message

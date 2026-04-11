# Decisions — gittributor-pipeline-fix

## 2026-04-03 Task: init
- Bug 4 fix: Use sequential `for...of` loop over `opts.labels` (not parallel) — accepted rate-limit tradeoff
- Bug 4 fix: Dedup BEFORE getIssueReactions to avoid wasted API calls — use Map<number, result> keyed by issue number
- Bug 4 fix: Empty labels fallback → default to `["good first issue"]`
- Bug 5 fix: Iterate repos in `runAnalyzeCommand` (not `selectRepositoryForAnalysis`) — cleaner orchestration
- Bug 5 fix: Throw CLIEntrypointError("No issues found across all repositories.") if all repos empty
- TDD approach: Write failing tests FIRST (RED), then implement (GREEN)
- T1 writes to existing `tests/github.test.ts`; T2 creates NEW test file (e.g., `tests/index.test.ts` or similar)
- 3 atomic commits: Bug3(analyze.ts), Bug4(github.ts + tests), Bug5(index.ts + new test file)

## 2026-04-03 Task: task-5-atomic-commits
- Commit order locked to Bug3 → Bug4 → Bug5 with exact `fix(scope): ...` messages to preserve traceability between each bug and its patch.
- `src/cli.ts` intentionally excluded from Commit 3 after inspection; no repo-iteration logic resides there, so including it would violate atomic scope.
- Evidence artifacts stored in `.sisyphus/evidence/task-5-final-tests.txt` and `.sisyphus/evidence/task-5-commits.txt` and intentionally left uncommitted.

## 2026-04-03 Task: task-5-atomic-commits-verification
- Accepted post-hoc validation strategy: because all 3 required commits already existed, preserve history and verify by running tests on each commit snapshot rather than rewriting history.

## 2026-04-05 Task: rate-limit-403-pipeline-continue
- Implemented rate-limit handling at `src/lib/github.ts::searchIssues` instead of pipeline-level catch so issue discovery degrades to an empty candidate set before orchestration, matching existing "skip and continue" semantics.
- Added explicit WARN log at the point of fallback (`Skipping <repo> because GitHub API rate limit was exceeded while searching issues.`) to mirror oversized-repo observability style.
- Added regression tests in `tests/github.test.ts` for three paths: HTTP 403 rate-limit fallback, exit-code-1 with rate-limit text fallback, and non-rate-limit error propagation.

- [2026-04-05T16:59:05] Kept non-rate-limit errors propagating from `searchIssues`; only rate-limit signature is downgraded to warn-and-skip to preserve fail-fast behavior for real failures.

## 2026-04-11 Task: github-test-stale-assertions-audit
- Made no changes to tests/github.test.ts after inspection because the supposed stale gh api repos/owner/repo/issues/8 expectation still corresponds to the active reactions lookup in searchIssues.
- Used focused verification (bun test tests/github.test.ts) to confirm the target file is already green before reporting broader unrelated suite failures from full bun test.

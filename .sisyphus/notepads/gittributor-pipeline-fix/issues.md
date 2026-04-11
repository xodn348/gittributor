# Issues — gittributor-pipeline-fix

## 2026-04-03 Task: init
- T1 RED phase: After writing tests, bun test SHOULD fail (expected). If it passes, tests don't actually test new behavior.
- T2 RED phase: Same — tests must fail until T4 implements the fix.
- T2 challenge: `runAnalyzeCommand` calls `loadState()` internally which reads from disk. Tests may need to mock this.
- The test at tests/github.test.ts:303 ("searchIssues ignores additional labels") ASSERTS THE BUG — must be rewritten to assert the opposite.

## 2026-04-03 Task: task-5-atomic-commits
- Global `bun test` is not green in current baseline due pre-existing failures outside Bug 3/4/5 scope (`tests/submit.test.ts`, `tests/issues.test.ts`, `tests/state.test.ts`).
- Because of the above baseline, commit verification used both full-suite snapshots and focused regression checks for affected files (`tests/github.test.ts`, `tests/index.test.ts`).

## 2026-04-03 Task: task-5-atomic-commits-verification
- Attempting to create Commit 1 can no-op if it was already committed in a previous session; verify this explicitly with `git diff` for that file + `git log` before retrying commit actions.

## 2026-04-05 Task: rate-limit-403-pipeline-continue
- The requested reference file `src/commands/run.ts` does not exist in current repository layout; equivalent pipeline control flow is implemented in `src/index.ts` (`runPipelineCommand`).
- Full-suite pass count changed from prior baseline because new regression coverage was added in `tests/github.test.ts`.

- [2026-04-05T16:59:05] `src/commands/run.ts` does not exist in this repo; equivalent pipeline loop lives in `src/index.ts` (`runPipelineCommand`).

## 2026-04-11 Task: github-test-stale-assertions-audit
- The requested cleanup conflicts with the live implementation: removing the repos/owner/repo/issues/8 mock/assertion would make the test inconsistent because searchIssues still fetches reactions for each unique issue.
- Full bun test remains red for unrelated baseline problems outside tests/github.test.ts, including SyntaxError: Export named getFileTree not found and multiple suites making real gh search issues calls.

# Issues — gittributor-v2

## [2026-04-08] Atlas: Known Issues at Start
- `.gittributor/discoveries.json` has a JSON syntax error (LSP: "End of file expected" at line 17:3) — pre-existing, not our problem
- V1 has 2 known failing tests — T11 must fix without deleting them
- No notepad entries yet — Wave 1 agents will populate this file

## [2026-04-08] Task: T11
Initial failures: 3 tests + 1 error (guardrails module not found)
Root causes: 
- discover.ts parseCreatedAfter not zeroing time component - comparing exact timestamps instead of dates only
- guardrails module error was pre-existing (not a real failure in current test run)
All tests passing: yes
- Fixed by adding defaultDate.setHours(0, 0, 0, 0) to zero out time component in date comparison

## 2026-04-09 F3 CLI QA
- Blocking: `src/lib/github.ts` uses `gh api repos/<repo>/pulls?state=open&creator=@me` in `hasOpenUserPR()`. Live QA showed the endpoint returns PRs from other users, so `discover` can filter valid repos as if the current user already has an open PR.
- Non-blocking: top-level help lists `run` twice.
- Non-blocking: `discover --help` is generic instead of command-specific.
- Non-blocking: `discover --dry-run` is rejected even though config exposes `dryRun`.

- [F4 scope fidelity] The sacred plan file `.sisyphus/plans/gittributor-v2.md` was modified by commits `e209002` and `6f40a3c`, violating the read-only rule.
- [F4 scope fidelity] Cross-task contamination showed up in `src/index.ts`, `src/lib/github.ts`, and `src/types/guards.ts`.


## [2026-04-09T13:24:45] F4 scope fidelity review
- Sacred plan file was modified in commits `e209002` and `6f40a3c`; this violates the read-only plan rule.
- `review --type` and `submit --dry-run` are not wired through `src/index.ts`, so T8/T9 landed only partially at the CLI boundary.
- `src/types/index.ts`, `src/lib/repo-list.ts`, `src/lib/guardrails.ts`, `src/lib/history.ts`, and `src/lib/contributing-checker.ts` diverge from the plan's contract shapes.

## 2026-04-09 F1 re-audit
- `autoApprove: true` no longer appears under `src/` and the pipeline path in `src/index.ts:580-585` now gates submit behind `reviewFix()` before `submitApprovedFix()`.
- `src/lib/guardrails.ts:14,69-81` enforces a global weekly cap via `MAX_GLOBAL_WEEKLY = 10` plus a cross-repo counting loop.
- Remaining generic local names still exist in `src/commands/submit.ts:189` (`data` param), `src/lib/state.ts:175` (`data` param), `src/lib/fix-generator.ts:168,237` (`result` param/local), `src/lib/config.ts:131,169` (`item` lambda), and `src/types/guards.ts:24` (`item` lambda). This keeps Must NOT Have from fully passing.

- 2026-04-09 F1 re-audit: automatic submission is fixed (no `autoApprove: true` call sites; `src/index.ts` runs review before submit), and `src/lib/guardrails.ts` now enforces `MAX_GLOBAL_WEEKLY = 10`; however generic local names still remain in `src/lib/fix-generator.ts` (`result`) and callback params named `item` remain in `src/lib/config.ts` and `src/types/guards.ts`, so Must NOT Have is still not fully compliant.

- 2026-04-09 F1 final re-review: no blocking compliance issues found; previous reject items (auto-approve removal, global weekly cap, generic param renames) verified as fixed.

## 2026-04-09 13:52:18 — F1 audit notes
- No blocking compliance violations found in the final re-review.
- `autoApprove: true` is absent from source; direct submission remains guarded by review approval and rate-limit checks before `git push`.

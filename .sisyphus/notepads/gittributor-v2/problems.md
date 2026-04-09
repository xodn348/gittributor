# Problems — gittributor-v2

## [2026-04-08] Atlas: Unresolved Blockers at Start
- None. Wave 1 can start immediately (T0, T1, T3, T5, T11 all have no blockers).

## 2026-04-09 F3 CLI QA
- Unresolved: replace or harden the open-PR detection strategy in `hasOpenUserPR()` so it filters by the authenticated user correctly before relying on it in `discover`.

- [F4 scope fidelity] Type contracts and guardrail/history/compliance APIs diverged from the plan, so later tasks built on mismatched foundations.
- [F4 scope fidelity] `bun run typecheck` fails, indicating the green test suite is masking contract drift between implementation and tests.

- 2026-04-09 F1 final re-review: no unresolved F1 compliance problems remain after verification and `bun test` returned 0 failures.

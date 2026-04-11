# Problems — gittributor-redesign

## [2026-04-11] Active Blockers
(none yet — plan execution just started)

- 2026-04-11 unresolved: exact evidence filenames promised in the plan are mostly missing; only `task-1-type-compilation.txt` matches the listed task evidence paths exactly.
- 2026-04-11 unresolved: `src/lib/issue-discovery.ts` still has a silent `catch { return []; }`, so the “silent error swallowing fixed” checklist item is not fully satisfied.

- F4 scope audit: reject. Major gaps in Tasks 1, 3, 4, 5, 6, 8, 9, 10, 11, 12.
- Key blockers: plan file was modified during Task 11/12 commits; run.ts bypasses issue discovery and uses duplicate submission paths; analyzer defaults and phase architecture do not match plan; static analyzer and discovery are only partially implemented.
- Verified cleanup success: src/commands/analyze.ts, src/lib/fix-router.ts, and src/lib/detectors/ are deleted; no remaining references to old detector pipeline symbols.

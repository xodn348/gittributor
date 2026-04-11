# Issues — gittributor-redesign

## [2026-04-11] Pre-existing Issues (Do NOT treat as regressions)
- tests/fix-router.test.ts: `.ts` extension import errors (allowImportingTsExtensions)
- tests/guardrails.test.ts: `"fix"` not in ContributionType, wrong arg count
- tests/submit.test.ts: type errors with Bun.spawn signature
- tests/history.test.ts: ContributionHistory missing fields (filePath, description, branchName), old type usage
- tests/run.test.ts: `setStateData` not in RunDependencies, `"typo"` type error
- These will be addressed in Task 7 (detector removal) and Task 8 (bug fixes)

- 2026-04-11 compliance audit: `src/commands/analyze.ts` still exists, which violates the plan requirement to delete the old pipeline file.
- 2026-04-11 compliance audit: `src/commands/discover.ts` still prefers YAML/repo-list discovery when `repos.yaml` exists, so dynamic GitHub discovery is not the active primary path.
- 2026-04-11 compliance audit: plan TODOs 1-4 remain unchecked in `.sisyphus/plans/gittributor-redesign.md`; only tasks 5-12 are marked complete.

- 2026-04-11T11:35:10.805285+00:00: QA note — plan examples still reference non-exported names (`runStaticAnalysisPhase`, `savePipelineState`, `loadPipelineState`); future QA scripts should use current exports from `src/lib/static-analyzer.ts` and `src/lib/state.ts`.

- [2026-04-11] Test maintenance note: `tests/analyzer.test.ts` assumed the previous 6-file analyzer default and had to be updated to 10 files to match the requested runtime change.

- [2026-04-11T12:11:38.149651+00:00] Fixed reviewer-reported silent catches in analyzer/discover/github with debug logging; no new blockers were introduced during the verification pass.

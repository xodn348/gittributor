# Issues — gittributor-redesign

## [2026-04-11] Pre-existing Issues (Do NOT treat as regressions)
- tests/fix-router.test.ts: `.ts` extension import errors (allowImportingTsExtensions)
- tests/guardrails.test.ts: `"fix"` not in ContributionType, wrong arg count
- tests/submit.test.ts: type errors with Bun.spawn signature
- tests/history.test.ts: ContributionHistory missing fields (filePath, description, branchName), old type usage
- tests/run.test.ts: `setStateData` not in RunDependencies, `"typo"` type error
- These will be addressed in Task 7 (detector removal) and Task 8 (bug fixes)

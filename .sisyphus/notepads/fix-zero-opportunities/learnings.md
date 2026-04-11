## [2026-04-10] Task: T1
- `.map(l => l.toLowerCase()).includes(r.language.toLowerCase())` is the correct inline fix for case-insensitive array membership in TypeScript
- GitHub API returns Title Case language names ("TypeScript") while config/normalization typically uses lowercase ("typescript")
- Always run `bun test` baseline before making changes to establish a comparison point
- Evidence files should capture both test output (tail -5) and CLI discovery output (head -30)
- bun test ran in ~7s for this codebase — fast enough to run before and after changes

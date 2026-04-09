# F3 Real CLI QA

Date: 2026-04-09
Reviewer: F3

## Verdict

REJECT

## Summary

The V2 CLI surface is present, tests pass locally (`357 pass`, `3 skip`, `0 fail`), and the guardrail/YAML config code exists. However, real `discover` execution is functionally broken in this environment because the open-PR filter marks unrelated repositories as already having an open PR from the current user, so the curated discovery path returns zero repositories.

## Evidence

### 1) Main CLI help
Command:
`bun run src/index.ts --help`

Observed:
- Commands listed: `discover`, `analyze`, `fix`, `review`, `submit`
- `run` is also listed
- Minor cosmetic issue: `run` appears twice in help output

### 2) Discover help
Command:
`bun run src/index.ts discover --help`

Observed:
- CLI falls back to top-level usage text
- Discover options are still visible in usage output:
  - `--min-stars=<number>`
  - `--language=<name>`
  - `--max-results=<number>`

### 3) Real discover invocation
Command:
`bun run src/index.ts --verbose discover --language=TypeScript --max-results=1`

Observed:
- `Loaded 30 curated repos from YAML`
- `Filtered curated repos to 6 by language/minStars`
- Every repo was filtered with `hasOpenPR=true`
- Final output: `No repositories found matching criteria.`

Representative lines:
- `Enriched angular/angular: isArchived=false, lastUpdated=..., hasOpenPR=true`
- `Filtered out angular/angular: user already has open PR`
- Same behavior for `microsoft/vscode`, `microsoft/TypeScript`, `microsoft/playwright`, `vitejs/vite`, `denoland/deno`

This means the V2 curated discover path does not return repositories end-to-end.

### 4) Root cause check for open-PR guardrail
Authenticated user:
`gh auth status` → `Logged in to github.com account xodn348`

Code path:
- `src/lib/github.ts:334-345` uses:
  - `gh api repos/<repo>/pulls?state=open&creator=@me`

Live API check:
`gh api "repos/angular/angular/pulls?state=open&creator=@me"`

Observed:
- Response was a large list of open PRs
- First returned PR user was `thePunderWoman`, not `xodn348`

Conclusion:
- The `creator=@me` filter is not being honored on that endpoint
- `hasOpenUserPR()` can return true for repositories that merely have open PRs from other people
- `discover` then incorrectly filters valid repositories out

### 5) Test suite
Command:
`bun test`

Observed final lines:
- `357 pass`
- `3 skip`
- `0 fail`
- `851 expect() calls`
- `Ran 360 tests across 33 files.`

### 6) Guardrails / rate limiting code exists
Relevant files:
- `src/lib/guardrails.ts`
- `src/lib/rate-limiter.ts`
- `src/commands/submit.ts`
- `src/lib/config.ts`

Verified:
- `src/lib/guardrails.ts:31-70` enforces hourly + weekly limits
- `src/lib/config.ts:13-18, 232-236` exposes `maxPRsPerWeekPerRepo`, `maxPRsPerHour`, and `dryRun`
- `src/commands/submit.ts:394-407, 489` checks rate limits / duplicate submissions and records submissions
- `src/lib/rate-limiter.ts` contains additional daily/per-repo submission persistence logic

### 7) Archived repo handling exists
Relevant files:
- `src/lib/guardrails.ts:117-138`
- `src/lib/github.ts:308-330`
- `src/commands/discover.ts:151-167`
- `src/lib/rate-limiter.ts:277-306`

Verified:
- GitHub repo enrichment reads `archived` into `isArchived`
- Discover filters archived repositories via `checkRepoEligibility(...)`
- Safety checker also blocks archived repositories before submission

### 8) YAML config loader works
Relevant files:
- `src/lib/repo-list.ts`
- `src/commands/discover.ts:237-288`
- `src/lib/config.ts`

Verified:
- `src/lib/repo-list.ts:1-56` uses `js-yaml` and `yaml.load(...)` to load `repos.yaml`
- Real discover execution printed `Loaded 30 curated repos from YAML`
- Runtime config loader is JSON-based (`.gittributorrc.json`), while curated repo loading is YAML-based via `repoListPath`

### 9) No-arg CLI behavior
Command:
`bun run src/index.ts`

Observed:
- Prints helpful usage text
- No crash on empty invocation

## Non-blocking issues

1. `run` is duplicated in the help text
2. `discover --help` is generic rather than subcommand-specific
3. `discover --dry-run` is rejected as an unknown option even though config includes `dryRun`

## Blocking issue

- `discover` can incorrectly return zero repositories because `hasOpenUserPR()` relies on `gh api repos/<repo>/pulls?state=open&creator=@me`, which returns PRs from other users. That breaks the core V2 pipeline's discovery stage in real CLI execution.

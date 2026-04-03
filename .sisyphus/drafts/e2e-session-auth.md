# Draft: End-to-End Pipeline + Session Cookie Auth

## Requirements (confirmed)
- **End-to-end flow**: "기본적으로 end-to-end로 되게하고" — add a `run` command that chains discover → analyze → fix → review → submit
- **Session cookie auth**: "세션쿠키" — replace ANTHROPIC_API_KEY with Claude.ai session cookie authentication
- **No GitHub token**: "깃헙 토큰이 뭔데" — remove GITHUB_TOKEN requirement, use `gh auth login` instead (already uses `gh` CLI)
- **README update**: "세팅하는것도 readme에 간단하게 명령어만 둬" — simple setup commands only

## Technical Decisions
- **GitHub auth**: Already uses `gh` CLI for all GitHub operations — just remove GITHUB_TOKEN validation from config.ts
- **Anthropic auth**: Replace direct API calls (`https://api.anthropic.com/v1/messages`) with Claude.ai session cookie approach
- **Session cookie mechanism**: Use Claude.ai web interface session cookie to authenticate — send requests to claude.ai API instead of api.anthropic.com
- **End-to-end command**: Add `run` subcommand to CLI that chains all 5 steps with auto-approve for review step

## Research Findings (from codebase exploration)

### Architecture Map
- **Entry points**: `bin/gittributor.ts` (simpler) and `src/index.ts` (full pipeline)
- **CLI parser**: `src/commands/cli.ts` — parseArgs with 6 subcommands
- **Config**: `src/lib/config.ts` — loadConfig() validates ANTHROPIC_API_KEY and GITHUB_TOKEN
- **Anthropic client**: `src/lib/anthropic.ts` — callAnthropic() does fetch to api.anthropic.com with x-api-key header
- **GitHub client**: `src/lib/github.ts` — GitHubClient class uses `gh` CLI (Bun.spawn)
- **Analyzer**: `src/lib/analyzer.ts:278` — reads ANTHROPIC_API_KEY directly
- **Fix generator**: `src/lib/fix-generator.ts:210` — reads ANTHROPIC_API_KEY directly
- **State**: `src/lib/state.ts` — .gittributor/ directory for pipeline state
- **Types**: `src/types/index.ts` — Config interface has `anthropicApiKey: string`

### Files that reference ANTHROPIC_API_KEY (need modification)
1. `src/lib/config.ts:92-96` — validation
2. `src/lib/analyzer.ts:278` — direct read
3. `src/lib/fix-generator.ts:210` — direct read
4. `src/lib/anthropic.ts:102-140` — callAnthropic uses apiKey param
5. `README.md:9,46` — documentation
6. `tests/config.test.ts` — 10+ references
7. `tests/cli-entrypoint.test.ts` — 15+ references
8. `tests/index.test.ts` — 4 references

### Files that reference GITHUB_TOKEN (need modification)
1. `src/lib/config.ts:93,99-101` — validation
2. `README.md:8,45` — documentation
3. `tests/config.test.ts` — 6+ references
4. `tests/cli-entrypoint.test.ts` — 8+ references
5. `tests/index.test.ts` — 2 references

### GitHub API usage (already uses `gh` CLI — no GITHUB_TOKEN in API calls!)
- `src/lib/github.ts` — ALL methods use `gh` CLI via Bun.spawn
- `src/lib/analyzer.ts` — uses `gh repo view`, `gh repo clone`
- `src/commands/submit.ts` — uses `gh repo fork`, `gh pr create`

## Scope Boundaries
- **INCLUDE**: Replace anthropic API key with session cookie, remove GITHUB_TOKEN requirement, add `run` command, update tests, update README
- **EXCLUDE**: No new features beyond auth change and e2e, no UI changes, no new dependencies beyond what's needed for session cookie

## Test Strategy Decision
- **Infrastructure exists**: YES (bun test, 14+ test files)
- **Automated tests**: YES (tests-after) — update existing tests to work with new auth
- **Framework**: bun test
- **Agent-Executed QA**: ALWAYS (CLI scenarios with tmux)

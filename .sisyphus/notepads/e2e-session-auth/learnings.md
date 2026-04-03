# Learnings — e2e-session-auth

## Codebase Conventions
- Runtime: Bun (use `Bun.env` not `process.env`, `Bun.file` not fs, `bun test` not jest)
- Language: TypeScript strict
- Pattern: No class hierarchies for auth — keep flat optional fields
- Error classes: ConfigError, CLIArgumentError, CLIEntrypointError, AnthropicAPIError
- All async fns return Promise<T>, no callbacks
- Git identity: NEVER change git config. Commit author must be "Junhyuk Lee <xodn348@naver.com>"

## Key File Locations
- Types: src/types/index.ts (line 2 = CommandName, lines 96-103 = Config)
- Guards: src/types/guards.ts (lines 22-29 = isCommandName, lines 146-157 = isConfig)
- Config: src/lib/config.ts (loadConfig async fn at line 91)
- CLI parser: src/commands/cli.ts (ParsedSubcommand line 3, parseArgs fn)
- Anthropic: src/lib/anthropic.ts (callAnthropic at line 102, analyzeCodeForIssue at 159, generateFix at 199)
- Analyzer: src/lib/analyzer.ts (direct env read at line 277-278 `apiKey: Bun.env.ANTHROPIC_API_KEY ?? ""`)
- Fix-generator: src/lib/fix-generator.ts (direct env read at line 210 `const apiKey = Bun.env.ANTHROPIC_API_KEY ?? ""`)
- Review: src/commands/review.ts (readDecision fn at lines 62-72, takes ReviewCommandIO)
- Entry: src/index.ts (SupportedCommand line 47, isSupportedCommand line 114, switch at line 473)

## Auth Architecture Decision
- OAuth token (sk-ant-oat01-...) → `Authorization: Bearer <token>` + `anthropic-beta: oauth-2025-04-20` headers
- API key (anything else) → `x-api-key: <key>` header (existing behavior)
- Same endpoint: https://api.anthropic.com/v1/messages
- When both set: OAuth takes priority
- callAnthropic() will accept `{ apiKey?: string; oauthToken?: string }` — at least one required
- Config.anthropicApiKey becomes optional, Config.oauthToken added as optional
- isConfig() must require AT LEAST ONE of the two fields

## State / Pipeline
- index.ts has individual run*Command functions for each pipeline step
- review.ts readDecision() prompts stdin — must add autoApprove bypass
- run command chains: discover → analyze → fix → review → submit in sequence
- Each step can throw — run command stops at first error with clear message

## File Conflict Notes
- T1 and T4 both touch src/commands/cli.ts — handle in ONE delegation
- T3 and T6 both touch src/lib/config.ts — handle in ONE delegation
- Decided to do a single comprehensive hephaestus delegation for all 13 tasks

# Issues / Gotchas — e2e-session-auth

## Plan file is partially damaged
- Tasks 4, 5, 6, 11, 12, 13 full descriptions were lost during deduplication fix
- Full task context reconstructed from source file analysis and plan summary section
- Dependency matrix and wave structure are intact in plan lines 148-163

## File conflicts to avoid
- src/commands/cli.ts: touched by T1 (ParsedSubcommand) AND T4 (parser logic) — must serialize
- src/lib/config.ts: touched by T3 (remove GITHUB_TOKEN) AND T6 (add OAuth) — must serialize

## index.ts has its own SupportedCommand type
- SupportedCommand (line 47) is separate from CommandName in types/index.ts
- isSupportedCommand() (line 114) also needs "run" added
- validateCommandShape allowedFlagPrefixesByCommand (lines 134-141) needs run: [] entry

## analyzer.ts and fix-generator.ts direct env reads
- analyzer.ts line 277: callAnthropic({ apiKey: Bun.env.ANTHROPIC_API_KEY ?? "" })
- fix-generator.ts line 210: const apiKey = Bun.env.ANTHROPIC_API_KEY ?? ""
- Both need to receive token from caller context, not read env directly
- The callAnthropic() signature change must be backward-compatible OR update all callers

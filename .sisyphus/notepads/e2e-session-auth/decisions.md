# Decisions — e2e-session-auth

## Auth approach
- OAuth PKCE token (sk-ant-oat01-...) supported via CLAUDE_CODE_OAUTH_TOKEN env var
- Both ANTHROPIC_API_KEY and CLAUDE_CODE_OAUTH_TOKEN accepted
- OAuth takes priority when both set
- Same endpoint for both: api.anthropic.com/v1/messages

## GITHUB_TOKEN removal
- Confirmed safe: GITHUB_TOKEN only validated in config.ts but NEVER used in actual API calls
- All GitHub ops use `gh` CLI via Bun.spawn
- Remove both read and validation from loadConfig()

## run command
- Auto-approves review step (passes autoApprove=true to readDecision)
- Stops on first error with clear step name in message
- No retry, no dry-run, no progress bars

## Delegation strategy
- Single hephaestus delegation for all 13 tasks (avoids file conflict coordination overhead)
- Verify all changes after completion

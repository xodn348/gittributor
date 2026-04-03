# gittributor

Bun-based CLI for automating open-source contributions: discover repos, analyze issues, generate AI-assisted fixes, review, and submit as pull requests.

## Setup

```bash
# 1. Install dependencies
bun install

# 2. Authenticate with GitHub
gh auth login

# 3. Set your Anthropic auth (pick one)
export ANTHROPIC_API_KEY="sk-ant-..."          # API key
export CLAUDE_CODE_OAUTH_TOKEN="sk-ant-oat01-..." # OAuth token (takes priority)
```

## Usage

One command to do everything:

```bash
bun run gittributor run    # discover → analyze → fix → review → submit
```

Or step by step:

```bash
bun run gittributor discover    # Find repositories with approachable issues
bun run gittributor analyze     # Discover issues for current repo selection
bun run gittributor fix         # Analyze top issue and generate fix
bun run gittributor review      # Review generated fix payload
bun run gittributor submit      # Submit approved fix as pull request
```

## Options

Global: `--help`, `--version`, `--verbose`, `--config <path>`

discover: `--min-stars=<number> --language=<name> --max-results=<number>`

## Development

```bash
bun test
bun run typecheck
bun run build
```
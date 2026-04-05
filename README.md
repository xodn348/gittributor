# gittributor

Bun-based CLI for automating open-source contributions: discover repos, analyze issues, generate AI-assisted fixes, review, and submit as pull requests.

## Setup

```bash
# 1. Install dependencies
bun install

# 2. Authenticate with GitHub
gh auth login
```

See `.env.example` for a complete env template.

### AI Provider Configuration

Select which AI provider to use (default: `anthropic`):

```bash
GITTRIBUTOR_AI_PROVIDER=anthropic  # or "openai"
```

Anthropic (default):

```bash
CLAUDE_CODE_OAUTH_TOKEN=your_oauth_token  # preferred
# OR
ANTHROPIC_API_KEY=your_api_key
```

OpenAI:

```bash
OPENAI_OAUTH_TOKEN=your_oauth_token  # preferred
# OR
OPENAI_API_KEY=your_api_key
OPENAI_MODEL=gpt-4o-mini  # optional, defaults to gpt-4o-mini
```

Optional tuning:

```bash
GITTRIBUTOR_ANALYZER_MAX_TOKENS=700  # default: 700
GITTRIBUTOR_FIX_MAX_TOKENS=1024      # default: 1024
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

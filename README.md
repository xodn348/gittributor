# gittributor

Bun-based CLI for automating open-source contributions: discover repos, analyze issues, generate AI-assisted fixes, review, and submit as pull requests.

## Prerequisites

- [Bun](https://bun.sh)
- `GITHUB_TOKEN` — GitHub personal access token
- `ANTHROPIC_API_KEY` — Anthropic API key for AI analysis

## Install

```bash
bun install
```

## Usage

```bash
bun run gittributor discover    # Find repositories with approachable issues
bun run gittributor analyze     # Discover issues for current repo selection
bun run gittributor fix         # Analyze top issue and generate fix (scores by impact)
bun run gittributor review      # Review generated fix payload
bun run gittributor submit      # Submit approved fix as pull request
```

End-to-end workflow:

```bash
bun run gittributor discover --language=TypeScript --min-stars=100 --max-results=10
bun run gittributor analyze
bun run gittributor fix
bun run gittributor review
bun run gittributor submit
```

## Options

Global: `--help`, `--version`, `--verbose`, `--config <path>`

discover: `--min-stars=<number> --language=<name> --max-results=<number>`

## Environment Variables

- `GITHUB_TOKEN` — GitHub discovery and PR submission
- `ANTHROPIC_API_KEY` — AI-powered analysis and fix generation

## Development

```bash
bun test
bun run typecheck
bun run build
```
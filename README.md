# gittributor

`gittributor` is a Bun-based CLI for automating an open-source contribution workflow: discover repositories, analyze issues, generate an AI-assisted fix, review the result, and submit an approved pull request. The CLI is stateful, so the commands are intended to run in order.

## Overview

The core pipeline is:

1. `discover` — find repositories with approachable issues
2. `analyze` — discover issues for the current repository selection
3. `fix` — analyze the top issue and generate a fix payload
4. `review` — review the generated fix payload
5. `submit` — submit the approved fix as a pull request

## Prerequisites

- [Bun](https://bun.sh) installed
- A GitHub token exported as `GITHUB_TOKEN`
- An Anthropic API key exported as `ANTHROPIC_API_KEY`

## Installation

Install dependencies from the project root:

```bash
bun install
```

Check that the CLI is available:

```bash
bun run gittributor --help
bun run gittributor --version
```

`--version` prints the current CLI version (`0.1.0`).

## Commands

### `discover`

Find repositories with approachable issues.

```bash
bun run gittributor discover
bun run gittributor discover --language=TypeScript --min-stars=100 --max-results=10
```

### `analyze`

Discover issues for the repository currently selected by `discover`.

```bash
bun run gittributor analyze
```

### `fix`

Analyze the top discovered issue and generate a fix payload.

```bash
bun run gittributor fix
```

### `review`

Review the generated fix payload before submission.

```bash
bun run gittributor review
```

### `submit`

Submit the approved fix as a GitHub pull request.

```bash
bun run gittributor submit
```

### End-to-end workflow

```bash
bun run gittributor discover --language=TypeScript --min-stars=100 --max-results=10
bun run gittributor analyze
bun run gittributor fix
bun run gittributor review
bun run gittributor submit
```

## Options

Global options:

- `--help` — show usage information
- `--version` — print the CLI version
- `--verbose` — enable verbose logging
- `--config <path>` — load configuration overrides from a JSON file

`discover` command options:

- `--min-stars=<number>`
- `--language=<name>`
- `--max-results=<number>`

Example with a config file:

```bash
bun run gittributor --config ./gittributor.config.json discover
```

Supported JSON override keys are `minStars`, `maxPRsPerDay`, `maxPRsPerRepo`, `targetLanguages`, and `verbose`.

## Environment Variables

The CLI requires both environment variables below:

```bash
export GITHUB_TOKEN=your_github_token
export ANTHROPIC_API_KEY=your_anthropic_api_key
```

- `GITHUB_TOKEN` — required for GitHub discovery and pull request submission
- `ANTHROPIC_API_KEY` — required for AI-powered analysis and fix generation

## Development

Install dependencies:

```bash
bun install
```

Useful project scripts:

```bash
bun run typecheck
bun run build
```

## Testing

Run the test suite with Bun:

```bash
bun test
```

#!/usr/bin/env bun
// gittributor CLI entry point

import { CLIArgumentError, parseArgs } from "../src/commands/cli";
import { discoverRepos } from "../src/commands/discover";
import { discoverIssues } from "../src/lib/issue-discovery.js";
import { reviewFixes } from "../src/commands/review";
import { submitApprovedFix } from "../src/commands/submit";
import { isCommandName } from "../src/types/guards";
import type { Repository } from "../src/types/index";

const VERSION = "0.1.0";

const HELP_TEXT = `gittributor v${VERSION}

A CLI tool to discover open-source repositories and submit fixes.

Usage:
  gittributor <command> [options]

Commands:
  discover    Find repositories with beginner-friendly issues
  review      Review an AI-generated fix interactively
  submit      Submit an approved fix as a pull request
  fix         (not yet implemented)
  help        Show this help message

Options:
  --min-stars=<n>      Minimum star count for discovery (default: 50)
  --language=<lang>    Programming language filter (default: TypeScript)
  --max-results=<n>    Maximum number of results to return
  --verbose            Enable verbose output
  --help               Show this help message
  --version            Show version number

Examples:
  gittributor discover --language=TypeScript --min-stars=100
  gittributor review
  gittributor submit`;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  // Handle --version before any other processing
  if (argv.includes("--version")) {
    console.log(`gittributor v${VERSION}`);
    process.exit(0);
  }

  // Parse CLI arguments, catching any validation errors
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs(argv);
  } catch (err) {
    if (err instanceof CLIArgumentError) {
      process.stderr.write(`Error: ${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }

  const { command, flags, positionals } = parsed;

  // Detect unknown commands: first non-flag arg was provided, is not a valid
  // command name or "help", and parseArgs silently fell through to help.
  const firstNonFlag = argv.find((arg) => !arg.startsWith("--"));
  if (
    firstNonFlag !== undefined &&
    firstNonFlag !== "help" &&
    !isCommandName(firstNonFlag) &&
    command === "help" &&
    !argv.includes("--help")
  ) {
    process.stderr.write(
      `Unknown command: '${firstNonFlag}'. Run 'gittributor help' for usage.\n`,
    );
    process.exit(1);
  }

  switch (command) {
    case "help": {
      console.log(HELP_TEXT);
      break;
    }

    case "discover": {
      const repos = await discoverRepos({
        language: flags.language,
        minStars: flags.minStars,
        limit: flags.maxResults,
      });
      console.log(`Found ${repos.length} repository(s).`);
      break;
    }

    case "fix": {
      process.stderr.write("Error: 'fix' command is not yet implemented.\n");
      process.exit(1);
      break;
    }

    case "review": {
      const exitCode = await reviewFixes();
      process.exit(exitCode);
      break;
    }

    case "submit": {
      const exitCode = await submitApprovedFix();
      process.exit(exitCode);
      break;
    }

    default: {
      console.log(HELP_TEXT);
    }
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

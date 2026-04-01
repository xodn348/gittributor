import { isCommandName } from "../types/guards";

export type ParsedSubcommand = "discover" | "analyze" | "fix" | "review" | "submit" | "help";

export interface ParsedFlags {
  minStars?: number;
  language?: string;
  maxResults?: number;
  verbose: boolean;
  help: boolean;
}

export interface ParsedArgs {
  command: ParsedSubcommand;
  flags: ParsedFlags;
  positionals: string[];
}

const parseNumberFlag = (name: string, value: string): number => {
  const parsedValue = Number(value);

  if (!Number.isInteger(parsedValue)) {
    throw new Error(`Invalid value for ${name}: ${value}`);
  }

  return parsedValue;
};

export const parseArgs = (argv: string[]): ParsedArgs => {
  const flags: ParsedFlags = {
    verbose: false,
    help: false,
  };

  const positionals: string[] = [];

  for (const argument of argv) {
    if (!argument.startsWith("--")) {
      positionals.push(argument);
      continue;
    }

    if (argument === "--verbose") {
      flags.verbose = true;
      continue;
    }

    if (argument === "--help") {
      flags.help = true;
      continue;
    }

    if (argument.startsWith("--min-stars=")) {
      const value = argument.slice("--min-stars=".length);
      flags.minStars = parseNumberFlag("--min-stars", value);
      continue;
    }

    if (argument.startsWith("--language=")) {
      flags.language = argument.slice("--language=".length);
      continue;
    }

    if (argument.startsWith("--max-results=")) {
      const value = argument.slice("--max-results=".length);
      flags.maxResults = parseNumberFlag("--max-results", value);
      continue;
    }
  }

  const firstPositional = positionals[0];

  if (flags.help || firstPositional === undefined) {
    return { command: "help", flags: { ...flags, help: true }, positionals };
  }

  if (firstPositional === "help") {
    return { command: "help", flags: { ...flags, help: true }, positionals };
  }

  if (isCommandName(firstPositional)) {
    return { command: firstPositional, flags, positionals };
  }

  return { command: "help", flags: { ...flags, help: true }, positionals };
};

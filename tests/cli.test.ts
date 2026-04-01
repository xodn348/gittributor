import { describe, expect, test } from "bun:test";
import { parseArgs } from "../src/commands/cli";

describe("parseArgs", () => {
  test("parses discover subcommand with numeric and string flags", () => {
    const parsed = parseArgs([
      "discover",
      "--min-stars=200",
      "--language=typescript",
      "--max-results=20",
      "--verbose",
    ]);

    expect(parsed.command).toBe("discover");
    expect(parsed.flags.minStars).toBe(200);
    expect(parsed.flags.language).toBe("typescript");
    expect(parsed.flags.maxResults).toBe(20);
    expect(parsed.flags.verbose).toBe(true);
    expect(parsed.flags.help).toBe(false);
  });

  test("parses help from --help even without command", () => {
    const parsed = parseArgs(["--help"]);

    expect(parsed.command).toBe("help");
    expect(parsed.flags.help).toBe(true);
  });

  test("parses help subcommand", () => {
    const parsed = parseArgs(["help"]);

    expect(parsed.command).toBe("help");
    expect(parsed.flags.help).toBe(true);
  });

  test("defaults to help when command is missing", () => {
    const parsed = parseArgs([]);

    expect(parsed.command).toBe("help");
    expect(parsed.flags.help).toBe(true);
  });

  test("accepts all supported subcommands", () => {
    const commands = ["discover", "analyze", "fix", "review", "submit", "help"] as const;

    for (const command of commands) {
      const parsed = parseArgs([command]);
      expect(parsed.command).toBe(command);
    }
  });

  test("throws when --language is provided with an empty value", () => {
    expect(() => parseArgs(["discover", "--language="])).toThrow(
      "Invalid value for --language",
    );
  });
});

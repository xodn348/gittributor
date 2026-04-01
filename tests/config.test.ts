import { afterEach, describe, expect, test } from "bun:test";
import { join } from "path";
import { loadConfig, ConfigError } from "../src/lib/config";

const originalEnv = { ...Bun.env };

const resetEnv = () => {
  for (const key of Object.keys(Bun.env)) {
    if (!(key in originalEnv)) {
      delete Bun.env[key];
    }
  }

  Object.assign(Bun.env, originalEnv);
};

afterEach(async () => {
  resetEnv();
});

describe("loadConfig", () => {
  test("loads defaults when required env vars are present", async () => {
    Bun.env.ANTHROPIC_API_KEY = "anthropic-key";
    Bun.env.GITHUB_TOKEN = "gh-token";

    const config = await loadConfig();

    expect(config).toEqual({
      anthropicApiKey: "anthropic-key",
      minStars: 50,
      maxPRsPerDay: 5,
      maxPRsPerRepo: 1,
      targetLanguages: ["typescript", "javascript", "python"],
      verbose: false,
    });
  });

  test("does not share default targetLanguages array across calls", async () => {
    Bun.env.ANTHROPIC_API_KEY = "anthropic-key";
    Bun.env.GITHUB_TOKEN = "gh-token";

    const first = await loadConfig();
    first.targetLanguages.push("go");

    const second = await loadConfig();

    expect(second.targetLanguages).toEqual(["typescript", "javascript", "python"]);
  });

  test("loads overrides from ~/.gittributorrc.json", async () => {
    const tempHome = await Bun.$`mktemp -d`.text();
    const homeDir = tempHome.trim();

    Bun.env.HOME = homeDir;
    Bun.env.ANTHROPIC_API_KEY = "anthropic-key";
    Bun.env.GITHUB_TOKEN = "gh-token";

    await Bun.write(
      join(homeDir, ".gittributorrc.json"),
      JSON.stringify({
        minStars: 150,
        maxPRsPerDay: 2,
        maxPRsPerRepo: 3,
        targetLanguages: ["rust", "go"],
        verbose: true,
      }),
    );

    const config = await loadConfig();

    expect(config.minStars).toBe(150);
    expect(config.maxPRsPerDay).toBe(2);
    expect(config.maxPRsPerRepo).toBe(3);
    expect(config.targetLanguages).toEqual(["rust", "go"]);
    expect(config.verbose).toBe(true);
  });

  test("throws ConfigError when ANTHROPIC_API_KEY is missing", async () => {
    delete Bun.env.ANTHROPIC_API_KEY;
    Bun.env.GITHUB_TOKEN = "gh-token";

    try {
      await loadConfig();
      throw new Error("Expected loadConfig to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);

      if (error instanceof Error) {
        expect(error.message).toContain("ANTHROPIC_API_KEY");
      }
    }
  });

  test("throws ConfigError when GITHUB_TOKEN is missing", async () => {
    Bun.env.ANTHROPIC_API_KEY = "anthropic-key";
    delete Bun.env.GITHUB_TOKEN;

    try {
      await loadConfig();
      throw new Error("Expected loadConfig to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);

      if (error instanceof Error) {
        expect(error.message).toContain("GITHUB_TOKEN");
      }
    }
  });
});

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

  test("loads defaults when CLAUDE_CODE_OAUTH_TOKEN is set", async () => {
    delete Bun.env.ANTHROPIC_API_KEY;
    Bun.env.CLAUDE_CODE_OAUTH_TOKEN = "sk-ant-oat01-test-token";

    const config = await loadConfig();

    expect(config.oauthToken).toBe("sk-ant-oat01-test-token");
    expect(config.anthropicApiKey).toBeUndefined();
    expect(config.minStars).toBe(50);
    expect(config.maxPRsPerDay).toBe(5);
  });

  test("does not share default targetLanguages array across calls", async () => {
    Bun.env.ANTHROPIC_API_KEY = "anthropic-key";

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

  test("throws ConfigError when neither ANTHROPIC_API_KEY nor CLAUDE_CODE_OAUTH_TOKEN is set", async () => {
    delete Bun.env.ANTHROPIC_API_KEY;
    delete Bun.env.CLAUDE_CODE_OAUTH_TOKEN;

    try {
      await loadConfig();
      throw new Error("Expected loadConfig to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);

      if (error instanceof Error) {
        expect(error.message).toContain("CLAUDE_CODE_OAUTH_TOKEN");
        expect(error.message).toContain("ANTHROPIC_API_KEY");
      }
    }
  });
});

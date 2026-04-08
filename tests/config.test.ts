import { afterEach, describe, expect, test, mock } from "bun:test";
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
    delete Bun.env.CLAUDE_CODE_OAUTH_TOKEN;
    delete Bun.env.OPENAI_OAUTH_TOKEN;
    delete Bun.env.OPENAI_API_KEY;
    Bun.env.ANTHROPIC_API_KEY = "anthropic-key";

    const config = await loadConfig();

    expect(config).toEqual({
      aiProvider: "anthropic",
      anthropicApiKey: "anthropic-key",
      openaiModel: "gpt-5-mini",
      minStars: 50,
      maxPRsPerDay: 5,
      maxPRsPerRepo: 1,
      targetLanguages: ["typescript", "javascript", "python"],
      verbose: false,
      repoListPath: "repos.yaml",
      maxPRsPerWeekPerRepo: 2,
      maxPRsPerHour: 3,
      contributionTypes: ["docs", "typo", "deps", "test", "code"],
      historyPath: ".gittributor/history.json",
      dryRun: false,
    });
  });

  test("loads defaults when CLAUDE_CODE_OAUTH_TOKEN is set", async () => {
    delete Bun.env.ANTHROPIC_API_KEY;
    Bun.env.CLAUDE_CODE_OAUTH_TOKEN = "sk-ant-oat01-test-token";

    const config = await loadConfig();

    expect(config.aiProvider).toBe("anthropic");
    expect(config.openaiModel).toBe("gpt-5-mini");
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
        aiProvider: "openai",
        openaiModel: "gpt-5-mini",
        minStars: 150,
        maxPRsPerDay: 2,
        maxPRsPerRepo: 3,
        targetLanguages: ["rust", "go"],
        verbose: true,
      }),
    );

    const config = await loadConfig();

    expect(config.aiProvider).toBe("openai");
    expect(config.openaiModel).toBe("gpt-5-mini");
    expect(config.minStars).toBe(150);
    expect(config.maxPRsPerDay).toBe(2);
    expect(config.maxPRsPerRepo).toBe(3);
    expect(config.targetLanguages).toEqual(["rust", "go"]);
    expect(config.verbose).toBe(true);
  });

  test("loads config when neither ANTHROPIC_API_KEY nor CLAUDE_CODE_OAUTH_TOKEN is set", async () => {
    delete Bun.env.ANTHROPIC_API_KEY;
    delete Bun.env.CLAUDE_CODE_OAUTH_TOKEN;

    const config = await loadConfig();

    expect(config.aiProvider).toBe("anthropic");
    expect(config.openaiModel).toBe("gpt-5-mini");
    expect(config.oauthToken).toBeUndefined();
    expect(config.anthropicApiKey).toBeUndefined();
    expect(config.minStars).toBe(50);
    expect(config.maxPRsPerDay).toBe(5);
    expect(config.maxPRsPerRepo).toBe(1);
    expect(config.targetLanguages).toEqual(["typescript", "javascript", "python"]);
  });

  test("loads OpenAI OAuth and provider from env", async () => {
    delete Bun.env.ANTHROPIC_API_KEY;
    delete Bun.env.CLAUDE_CODE_OAUTH_TOKEN;
    Bun.env.GITTRIBUTOR_AI_PROVIDER = "openai";
    Bun.env.OPENAI_OAUTH_TOKEN = "sess-openai-test";
    Bun.env.OPENAI_MODEL = "gpt-5-mini";

    const config = await loadConfig();

    expect(config.aiProvider).toBe("openai");
    expect(config.openaiOauthToken).toBe("sess-openai-test");
    expect(config.openaiModel).toBe("gpt-5-mini");
  });

  test("V1 config file loads V2 defaults when only V1 fields present", async () => {
    const tempHome = await Bun.$`mktemp -d`.text();
    const homeDir = tempHome.trim();

    Bun.env.HOME = homeDir;
    Bun.env.ANTHROPIC_API_KEY = "anthropic-key";

    await Bun.write(
      join(homeDir, ".gittributorrc.json"),
      JSON.stringify({
        aiProvider: "openai",
        minStars: 100,
        maxPRsPerDay: 3,
      }),
    );

    const config = await loadConfig();

    expect(config.aiProvider).toBe("openai");
    expect(config.minStars).toBe(100);
    expect(config.maxPRsPerDay).toBe(3);
    expect(config.repoListPath).toBe("repos.yaml");
    expect(config.maxPRsPerWeekPerRepo).toBe(2);
    expect(config.maxPRsPerHour).toBe(3);
    expect(config.contributionTypes).toEqual(["docs", "typo", "deps", "test", "code"]);
    expect(config.historyPath).toBe(".gittributor/history.json");
    expect(config.dryRun).toBe(false);
  });

  test("project-local .gittributorrc.json overrides global config", async () => {
    const tempHome = await Bun.$`mktemp -d`.text();
    const homeDir = tempHome.trim();
    const tempCwd = await Bun.$`mktemp -d`.text();
    const cwd = tempCwd.trim();

    Bun.env.HOME = homeDir;
    Bun.env.ANTHROPIC_API_KEY = "anthropic-key";

    await Bun.write(
      join(homeDir, ".gittributorrc.json"),
      JSON.stringify({
        minStars: 100,
        maxPRsPerDay: 3,
        repoListPath: "global-repos.yaml",
        maxPRsPerHour: 5,
      }),
    );

    await Bun.write(
      join(cwd, ".gittributorrc.json"),
      JSON.stringify({
        minStars: 200,
        verbose: true,
        dryRun: true,
      }),
    );

    const originalCwd = process.cwd();
    try {
      process.chdir(cwd);
      const config = await loadConfig();

      expect(config.minStars).toBe(200);
      expect(config.verbose).toBe(true);
      expect(config.dryRun).toBe(true);
      expect(config.maxPRsPerDay).toBe(3);
      expect(config.repoListPath).toBe("global-repos.yaml");
      expect(config.maxPRsPerHour).toBe(5);
    } finally {
      process.chdir(originalCwd);
    }
  });

  test("V2 fields in project-local config override global V2 fields", async () => {
    const tempHome = await Bun.$`mktemp -d`.text();
    const homeDir = tempHome.trim();
    const tempCwd = await Bun.$`mktemp -d`.text();
    const cwd = tempCwd.trim();

    Bun.env.HOME = homeDir;
    Bun.env.ANTHROPIC_API_KEY = "anthropic-key";

    await Bun.write(
      join(homeDir, ".gittributorrc.json"),
      JSON.stringify({
        repoListPath: "global-repos.yaml",
        maxPRsPerWeekPerRepo: 10,
        contributionTypes: ["code"],
      }),
    );

    await Bun.write(
      join(cwd, ".gittributorrc.json"),
      JSON.stringify({
        repoListPath: "local-repos.yaml",
        maxPRsPerWeekPerRepo: 5,
      }),
    );

    const originalCwd = process.cwd();
    try {
      process.chdir(cwd);
      const config = await loadConfig();

      expect(config.repoListPath).toBe("local-repos.yaml");
      expect(config.maxPRsPerWeekPerRepo).toBe(5);
      expect(config.contributionTypes).toEqual(["code"]);
    } finally {
      process.chdir(originalCwd);
    }
  });

  test("throws ConfigError for invalid type in config file", async () => {
    const tempHome = await Bun.$`mktemp -d`.text();
    const homeDir = tempHome.trim();

    Bun.env.HOME = homeDir;
    Bun.env.ANTHROPIC_API_KEY = "anthropic-key";

    await Bun.write(
      join(homeDir, ".gittributorrc.json"),
      JSON.stringify({
        minStars: "not a number",
      }),
    );

    await expect(loadConfig()).rejects.toThrow(ConfigError);
  });

  test("throws ConfigError for invalid contributionTypes", async () => {
    const tempHome = await Bun.$`mktemp -d`.text();
    const homeDir = tempHome.trim();

    Bun.env.HOME = homeDir;
    Bun.env.ANTHROPIC_API_KEY = "anthropic-key";

    await Bun.write(
      join(homeDir, ".gittributorrc.json"),
      JSON.stringify({
        contributionTypes: ["invalid-type"],
      }),
    );

    await expect(loadConfig()).rejects.toThrow(ConfigError);
  });

  test("warns on unknown fields in config file", async () => {
    const consoleSpy = mock(() => {});
    const tempHome = await Bun.$`mktemp -d`.text();
    const homeDir = tempHome.trim();

    Bun.env.HOME = homeDir;
    Bun.env.ANTHROPIC_API_KEY = "anthropic-key";

    await Bun.write(
      join(homeDir, ".gittributorrc.json"),
      JSON.stringify({
        unknownField: "should be warned",
        anotherUnknown: 123,
      }),
    );

    const config = await loadConfig();

    expect(config.minStars).toBe(50);
  });
});
import { join } from "path";
import { isConfig } from "../types/guards";
import type { Config } from "../types";

const DEFAULT_CONFIG: Omit<Config, "anthropicApiKey"> = {
  minStars: 50,
  maxPRsPerDay: 5,
  maxPRsPerRepo: 1,
  targetLanguages: ["typescript", "javascript", "python"],
  verbose: false,
};

interface ConfigFileOverrides {
  minStars?: number;
  maxPRsPerDay?: number;
  maxPRsPerRepo?: number;
  targetLanguages?: string[];
  verbose?: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const readConfigFile = async (homeDir: string): Promise<ConfigFileOverrides> => {
  const file = Bun.file(join(homeDir, ".gittributorrc.json"));

  if (!(await file.exists())) {
    return {};
  }

  let parsed: unknown;

  try {
    parsed = await file.json();
  } catch {
    throw new ConfigError("Failed to parse ~/.gittributorrc.json");
  }

  if (!isRecord(parsed)) {
    throw new ConfigError("~/.gittributorrc.json must contain a JSON object");
  }

  const overrides: ConfigFileOverrides = {};

  if (parsed.minStars !== undefined) {
    if (typeof parsed.minStars !== "number") {
      throw new ConfigError("minStars in ~/.gittributorrc.json must be a number");
    }
    overrides.minStars = parsed.minStars;
  }

  if (parsed.maxPRsPerDay !== undefined) {
    if (typeof parsed.maxPRsPerDay !== "number") {
      throw new ConfigError("maxPRsPerDay in ~/.gittributorrc.json must be a number");
    }
    overrides.maxPRsPerDay = parsed.maxPRsPerDay;
  }

  if (parsed.maxPRsPerRepo !== undefined) {
    if (typeof parsed.maxPRsPerRepo !== "number") {
      throw new ConfigError("maxPRsPerRepo in ~/.gittributorrc.json must be a number");
    }
    overrides.maxPRsPerRepo = parsed.maxPRsPerRepo;
  }

  if (parsed.targetLanguages !== undefined) {
    if (!Array.isArray(parsed.targetLanguages) || !parsed.targetLanguages.every((item) => typeof item === "string")) {
      throw new ConfigError("targetLanguages in ~/.gittributorrc.json must be a string array");
    }
    overrides.targetLanguages = parsed.targetLanguages;
  }

  if (parsed.verbose !== undefined) {
    if (typeof parsed.verbose !== "boolean") {
      throw new ConfigError("verbose in ~/.gittributorrc.json must be a boolean");
    }
    overrides.verbose = parsed.verbose;
  }

  return overrides;
};

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export const loadConfig = async (): Promise<Config> => {
  const anthropicApiKey = Bun.env.ANTHROPIC_API_KEY?.trim();
  const githubToken = Bun.env.GITHUB_TOKEN?.trim();

  if (!anthropicApiKey) {
    throw new ConfigError("Missing required environment variable: ANTHROPIC_API_KEY");
  }

  if (!githubToken) {
    throw new ConfigError("Missing required environment variable: GITHUB_TOKEN");
  }

  const homeDir = Bun.env.HOME ?? Bun.env.USERPROFILE;
  const configFileOverrides = homeDir ? await readConfigFile(homeDir) : {};

  const config: Config = {
    anthropicApiKey,
    minStars: configFileOverrides.minStars ?? DEFAULT_CONFIG.minStars,
    maxPRsPerDay: configFileOverrides.maxPRsPerDay ?? DEFAULT_CONFIG.maxPRsPerDay,
    maxPRsPerRepo: configFileOverrides.maxPRsPerRepo ?? DEFAULT_CONFIG.maxPRsPerRepo,
    targetLanguages: configFileOverrides.targetLanguages ?? DEFAULT_CONFIG.targetLanguages,
    verbose: configFileOverrides.verbose ?? DEFAULT_CONFIG.verbose,
  };

  if (!isConfig(config)) {
    throw new ConfigError("Resolved configuration is invalid");
  }

  return config;
};

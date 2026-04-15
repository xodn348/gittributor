import { join } from "path";
import { isConfig } from "../types/guards";
import type { Config, ContributionType } from "../types";

const DEFAULT_CONFIG: Omit<Config, "anthropicApiKey" | "oauthToken" | "openaiApiKey" | "openaiOauthToken"> = {
  aiProvider: "anthropic",
  openaiModel: "gpt-5-mini",
  minStars: 50,
  maxPRsPerDay: 5,
  maxPRsPerRepo: 1,
  targetLanguages: ["typescript", "javascript", "python"],
  verbose: false,
  repoListPath: "repos.yaml",
  maxPRsPerWeekPerRepo: 2,
  maxPRsPerHour: 3,
  contributionTypes: ["bug-fix", "performance", "type-safety", "logic-error", "static-analysis"],
  historyPath: ".gittributor/history.json",
  dryRun: false,
};

interface ConfigFileOverrides {
  aiProvider?: "anthropic" | "openai";
  openaiModel?: string;
  minStars?: number;
  maxPRsPerDay?: number;
  maxPRsPerRepo?: number;
  targetLanguages?: string[];
  verbose?: boolean;
  repoListPath?: string;
  maxPRsPerWeekPerRepo?: number;
  maxPRsPerHour?: number;
  contributionTypes?: ContributionType[];
  historyPath?: string;
  dryRun?: boolean;
}

const VALID_CONFIG_FIELDS = new Set<string>([
  "aiProvider",
  "openaiModel",
  "minStars",
  "maxPRsPerDay",
  "maxPRsPerRepo",
  "targetLanguages",
  "verbose",
  "repoListPath",
  "maxPRsPerWeekPerRepo",
  "maxPRsPerHour",
  "contributionTypes",
  "historyPath",
  "dryRun",
]);

const VALID_CONTRIBUTION_TYPES = new Set<ContributionType>([
  "bug-fix",
  "performance",
  "type-safety",
  "logic-error",
  "static-analysis",
]);

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const readConfigFile = async (
  filePath: string,
  configSource: string,
): Promise<ConfigFileOverrides> => {
  const file = Bun.file(filePath);

  if (!(await file.exists())) {
    return {};
  }

  let parsed: unknown;

  try {
    parsed = await file.json();
  } catch {
    throw new ConfigError(`Failed to parse ${configSource}`);
  }

  if (!isRecord(parsed)) {
    throw new ConfigError(`${configSource} must contain a JSON object`);
  }

  for (const key of Object.keys(parsed)) {
    if (!VALID_CONFIG_FIELDS.has(key)) {
      console.warn(`Unknown config field '${key}' in ${configSource}`);
    }
  }

  const overrides: ConfigFileOverrides = {};

  if (parsed.aiProvider !== undefined) {
    if (parsed.aiProvider !== "anthropic" && parsed.aiProvider !== "openai") {
      throw new ConfigError(`aiProvider in ${configSource} must be 'anthropic' or 'openai'`);
    }
    overrides.aiProvider = parsed.aiProvider;
  }

  if (parsed.openaiModel !== undefined) {
    if (typeof parsed.openaiModel !== "string" || parsed.openaiModel.trim().length === 0) {
      throw new ConfigError(`openaiModel in ${configSource} must be a non-empty string`);
    }
    overrides.openaiModel = parsed.openaiModel.trim();
  }

  if (parsed.minStars !== undefined) {
    if (typeof parsed.minStars !== "number") {
      throw new ConfigError(`minStars in ${configSource} must be a number`);
    }
    overrides.minStars = parsed.minStars;
  }

  if (parsed.maxPRsPerDay !== undefined) {
    if (typeof parsed.maxPRsPerDay !== "number") {
      throw new ConfigError(`maxPRsPerDay in ${configSource} must be a number`);
    }
    overrides.maxPRsPerDay = parsed.maxPRsPerDay;
  }

  if (parsed.maxPRsPerRepo !== undefined) {
    if (typeof parsed.maxPRsPerRepo !== "number") {
      throw new ConfigError(`maxPRsPerRepo in ${configSource} must be a number`);
    }
    overrides.maxPRsPerRepo = parsed.maxPRsPerRepo;
  }

  if (parsed.targetLanguages !== undefined) {
    if (!Array.isArray(parsed.targetLanguages) || !parsed.targetLanguages.every((langEntry) => typeof langEntry === "string")) {
      throw new ConfigError(`targetLanguages in ${configSource} must be a string array`);
    }
    overrides.targetLanguages = parsed.targetLanguages;
  }

  if (parsed.verbose !== undefined) {
    if (typeof parsed.verbose !== "boolean") {
      throw new ConfigError(`verbose in ${configSource} must be a boolean`);
    }
    overrides.verbose = parsed.verbose;
  }

  if (parsed.repoListPath !== undefined) {
    if (typeof parsed.repoListPath !== "string" || parsed.repoListPath.trim().length === 0) {
      throw new ConfigError(`repoListPath in ${configSource} must be a non-empty string`);
    }
    overrides.repoListPath = parsed.repoListPath.trim();
  }

  if (parsed.maxPRsPerWeekPerRepo !== undefined) {
    if (typeof parsed.maxPRsPerWeekPerRepo !== "number") {
      throw new ConfigError(`maxPRsPerWeekPerRepo in ${configSource} must be a number`);
    }
    overrides.maxPRsPerWeekPerRepo = parsed.maxPRsPerWeekPerRepo;
  }

  if (parsed.maxPRsPerHour !== undefined) {
    if (typeof parsed.maxPRsPerHour !== "number") {
      throw new ConfigError(`maxPRsPerHour in ${configSource} must be a number`);
    }
    overrides.maxPRsPerHour = parsed.maxPRsPerHour;
  }

  if (parsed.contributionTypes !== undefined) {
    if (!Array.isArray(parsed.contributionTypes)) {
      throw new ConfigError(`contributionTypes in ${configSource} must be an array`);
    }
    if (!parsed.contributionTypes.every((entry): entry is ContributionType => typeof entry === "string" && VALID_CONTRIBUTION_TYPES.has(entry as ContributionType))) {
      throw new ConfigError(
        `contributionTypes in ${configSource} must contain only: ${Array.from(VALID_CONTRIBUTION_TYPES).join(", ")}`,
      );
    }
    overrides.contributionTypes = parsed.contributionTypes;
  }

  if (parsed.historyPath !== undefined) {
    if (typeof parsed.historyPath !== "string" || parsed.historyPath.trim().length === 0) {
      throw new ConfigError(`historyPath in ${configSource} must be a non-empty string`);
    }
    overrides.historyPath = parsed.historyPath.trim();
  }

  if (parsed.dryRun !== undefined) {
    if (typeof parsed.dryRun !== "boolean") {
      throw new ConfigError(`dryRun in ${configSource} must be a boolean`);
    }
    overrides.dryRun = parsed.dryRun;
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
  const aiProvider = Bun.env.GITTRIBUTOR_AI_PROVIDER?.trim();
  const oauthToken = (Bun.env.CLAUDE_CODE_OAUTH_TOKEN || Bun.env.CLAUDE_SESSION_KEY)?.trim();
  const anthropicApiKey = Bun.env.ANTHROPIC_API_KEY?.trim();
  const openaiApiKey = Bun.env.OPENAI_API_KEY?.trim();
  const openaiOauthToken = Bun.env.OPENAI_OAUTH_TOKEN?.trim();
  const openaiModel = Bun.env.OPENAI_MODEL?.trim();

  const homeDir = Bun.env.HOME ?? Bun.env.USERPROFILE;
  const globalConfigFile = homeDir ? join(homeDir, ".gittributorrc.json") : "";
  const globalConfig = globalConfigFile ? await readConfigFile(globalConfigFile, "~/.gittributorrc.json") : {};

  const projectConfigFile = join(process.cwd(), ".gittributorrc.json");
  const projectConfig = await readConfigFile(projectConfigFile, ".gittributorrc.json");

  const mergedConfig = { ...globalConfig, ...projectConfig };

  const config: Config = {
    ...(aiProvider ? { aiProvider: aiProvider === "openai" ? "openai" : "anthropic" } : {}),
    ...(oauthToken ? { oauthToken } : {}),
    ...(anthropicApiKey ? { anthropicApiKey } : {}),
    ...(openaiApiKey ? { openaiApiKey } : {}),
    ...(openaiOauthToken ? { openaiOauthToken } : {}),
    openaiModel: mergedConfig.openaiModel ?? openaiModel ?? DEFAULT_CONFIG.openaiModel,
    aiProvider: mergedConfig.aiProvider ?? (aiProvider === "openai" ? "openai" : DEFAULT_CONFIG.aiProvider),
    minStars: mergedConfig.minStars ?? DEFAULT_CONFIG.minStars,
    maxPRsPerDay: mergedConfig.maxPRsPerDay ?? DEFAULT_CONFIG.maxPRsPerDay,
    maxPRsPerRepo: mergedConfig.maxPRsPerRepo ?? DEFAULT_CONFIG.maxPRsPerRepo,
    targetLanguages: [...(mergedConfig.targetLanguages ?? DEFAULT_CONFIG.targetLanguages)],
    verbose: mergedConfig.verbose ?? DEFAULT_CONFIG.verbose,
    repoListPath: mergedConfig.repoListPath ?? DEFAULT_CONFIG.repoListPath,
    maxPRsPerWeekPerRepo: mergedConfig.maxPRsPerWeekPerRepo ?? DEFAULT_CONFIG.maxPRsPerWeekPerRepo,
    maxPRsPerHour: mergedConfig.maxPRsPerHour ?? DEFAULT_CONFIG.maxPRsPerHour,
    contributionTypes: [...(mergedConfig.contributionTypes ?? DEFAULT_CONFIG.contributionTypes)],
    historyPath: mergedConfig.historyPath ?? DEFAULT_CONFIG.historyPath,
    dryRun: mergedConfig.dryRun ?? DEFAULT_CONFIG.dryRun,
  };

  if (!isConfig(config)) {
    throw new ConfigError("Resolved configuration is invalid");
  }

  return config;
};

export function getTargetLanguages(config: Config, overrideLanguage?: string): string[] {
  if (overrideLanguage && overrideLanguage.trim().length > 0) {
    return [overrideLanguage.trim()];
  }
  return [...config.targetLanguages];
}

const parsePositiveIntegerEnv = (name: string, fallback: number): number => {
  const raw = Bun.env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  return isNaN(parsed) || parsed < 0 ? fallback : parsed;
};

const parseBooleanEnv = (name: string, fallback: boolean): boolean => {
  const raw = Bun.env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  return raw === "true" || raw === "1";
};

export const discoveryConfig = {
  minStars: parsePositiveIntegerEnv("GITTRIBUTOR_DISCOVERY_MIN_STARS", 1000),
  maxStars: parsePositiveIntegerEnv("GITTRIBUTOR_DISCOVERY_MAX_STARS", 10000),
  staticAnalysisEnabled: parseBooleanEnv("GITTRIBUTOR_STATIC_ANALYSIS_ENABLED", true),
  issueLabels: Bun.env.GITTRIBUTOR_ISSUE_LABELS?.trim() || "good first issue,bug,help wanted",
  maxReposPerRun: parsePositiveIntegerEnv("GITTRIBUTOR_MAX_REPOS_PER_RUN", 5),
} as const;

export type DiscoveryConfig = typeof discoveryConfig;

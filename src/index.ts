#!/usr/bin/env bun

import { discoverIssues, printIssueProposalTable } from "./commands/analyze.js";
import { CLIArgumentError, parseArgs } from "./commands/cli";
import { discoverRepos } from "./commands/discover";
import { reviewFix } from "./commands/review";
import { submitApprovedFix } from "./commands/submit";
import { analyzeCodebase, sanitizeAnalysisForPersistence } from "./lib/analyzer";
import { ConfigError, loadConfig } from "./lib/config";
import { generateFix } from "./lib/fix-generator";
import { error as logError } from "./lib/logger";
import { loadState, saveState } from "./lib/state.js";
import type { AnalysisResult, Config, FixResult, Issue, Repository } from "./types";

const USAGE_TEXT = [
  "Usage: gittributor [global options] <command> [options]",
  "",
  "Commands:",
  "  discover    Find repositories with approachable issues",
  "  analyze     Discover issues for the current repository selection",
  "  fix         Analyze the top issue and generate a fix payload",
  "  review      Review the generated fix payload",
  "  submit      Submit the approved fix as a pull request",
  "  run         Run the full pipeline: discover → analyze → fix → review → submit",
  "  run         Run the full pipeline: discover → analyze → fix → review → submit",
  "",
  "Global options:",
  "  --help           Show this usage information",
  "  --version        Print the CLI version",
  "  --verbose        Enable verbose logging",
  "  --config <path>  Load configuration overrides from a JSON file",
  "",
  "Command options:",
  "  discover --min-stars=<number> --language=<name> --max-results=<number>",
].join("\n");

interface GlobalFlags {
  configPath?: string;
  help: boolean;
  verbose: boolean;
  version: boolean;
}

interface ParsedGlobalArgs {
  globalFlags: GlobalFlags;
  commandArgs: string[];
}

type SupportedCommand = "analyze" | "discover" | "fix" | "help" | "review" | "submit" | "run";

interface ConfigOverrides {
  aiProvider?: "anthropic" | "openai";
  maxPRsPerDay?: number;
  maxPRsPerRepo?: number;
  minStars?: number;
  openaiModel?: string;
  targetLanguages?: string[];
  verbose?: boolean;
}

interface CliOutput {
  stderr: {
    write: (chunk: string) => boolean;
  };
  stdout: {
    write: (chunk: string) => boolean;
  };
}

interface RunCliOptions {
  io?: CliOutput;
}

interface PersistedFixResult extends FixResult {
  changes: Array<{ file: string; modified: string; original: string }>;
}

class CLIEntrypointError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = "CLIEntrypointError";
    this.exitCode = exitCode;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const resolveCliOutput = (options: RunCliOptions): CliOutput => {
  return {
    stdout: options.io?.stdout ?? process.stdout,
    stderr: options.io?.stderr ?? process.stderr,
  };
};

const writeErrorLine = (output: CliOutput, message: string): void => {
  output.stderr.write(`${message}\n`);
};

const writeStandardLine = (output: CliOutput, message: string): void => {
  output.stdout.write(`${message}\n`);
};

const readPackageVersion = async (): Promise<string> => {
  const packageJsonFile = Bun.file(new URL("../package.json", import.meta.url));
  const packageJson = await packageJsonFile.json();

  if (!isRecord(packageJson) || typeof packageJson.version !== "string") {
    throw new CLIEntrypointError("package.json is missing a valid version", 1);
  }

  return packageJson.version;
};

const isSupportedCommand = (value: string): value is SupportedCommand => {
  return value === "discover" || value === "analyze" || value === "fix" || value === "review" || value === "submit" || value === "run" || value === "help";
};

const validateCommandShape = (commandArgs: string[]): void => {
  const commandName = commandArgs.find((argument) => !argument.startsWith("--"));

  if (!commandName) {
    return;
  }

  if (!isSupportedCommand(commandName)) {
    return;
  }

  const commandPositionals = commandArgs.filter((argument) => !argument.startsWith("--"));
  if (commandPositionals.length > 1) {
    throw new CLIArgumentError(`Unexpected argument for ${commandName}: ${commandPositionals[1]}`);
  }

  const allowedFlagPrefixesByCommand: Record<SupportedCommand, string[]> = {
    help: [],
    analyze: [],
    fix: [],
    review: [],
    submit: [],
    run: ["--dry-run", "--stats", "--type", "--type="],
    discover: ["--min-stars=", "--language=", "--max-results="],
  };

  for (const argument of commandArgs) {
    if (!argument.startsWith("--")) {
      continue;
    }

    const isAllowedFlag = allowedFlagPrefixesByCommand[commandName].some((allowedPrefix) => argument.startsWith(allowedPrefix));
    if (!isAllowedFlag) {
      throw new CLIArgumentError(`Unknown option for ${commandName}: ${argument}`);
    }
  }
};

const parseGlobalArgs = (argv: string[]): ParsedGlobalArgs => {
  const globalFlags: GlobalFlags = {
    help: false,
    verbose: false,
    version: false,
  };
  const commandArgs: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--help") {
      globalFlags.help = true;
      continue;
    }

    if (argument === "--version") {
      globalFlags.version = true;
      continue;
    }

    if (argument === "--verbose") {
      globalFlags.verbose = true;
      continue;
    }

    if (argument === "--config") {
      const configPath = argv[index + 1];

      if (!configPath || configPath.startsWith("--")) {
        throw new CLIArgumentError("Missing value for --config");
      }

      globalFlags.configPath = configPath;
      index += 1;
      continue;
    }

    if (argument.startsWith("--config=")) {
      const configPath = argument.slice("--config=".length).trim();

      if (!configPath) {
        throw new CLIArgumentError("Missing value for --config");
      }

      globalFlags.configPath = configPath;
      continue;
    }

    commandArgs.push(argument);
  }

  return { globalFlags, commandArgs };
};

const parseConfigOverrides = (value: unknown, configPath: string): ConfigOverrides => {
  if (!isRecord(value)) {
    throw new ConfigError(`${configPath} must contain a JSON object`);
  }

  const configOverrides: ConfigOverrides = {};

  if (value.aiProvider !== undefined) {
    if (value.aiProvider !== "anthropic" && value.aiProvider !== "openai") {
      throw new ConfigError(`aiProvider in ${configPath} must be 'anthropic' or 'openai'`);
    }
    configOverrides.aiProvider = value.aiProvider;
  }

  if (value.minStars !== undefined) {
    if (typeof value.minStars !== "number") {
      throw new ConfigError(`minStars in ${configPath} must be a number`);
    }
    configOverrides.minStars = value.minStars;
  }

  if (value.maxPRsPerDay !== undefined) {
    if (typeof value.maxPRsPerDay !== "number") {
      throw new ConfigError(`maxPRsPerDay in ${configPath} must be a number`);
    }
    configOverrides.maxPRsPerDay = value.maxPRsPerDay;
  }

  if (value.maxPRsPerRepo !== undefined) {
    if (typeof value.maxPRsPerRepo !== "number") {
      throw new ConfigError(`maxPRsPerRepo in ${configPath} must be a number`);
    }
    configOverrides.maxPRsPerRepo = value.maxPRsPerRepo;
  }

  if (value.targetLanguages !== undefined) {
    const targetLanguages = value.targetLanguages;
    if (!Array.isArray(targetLanguages) || targetLanguages.some((language) => typeof language !== "string")) {
      throw new ConfigError(`targetLanguages in ${configPath} must be a string array`);
    }

    configOverrides.targetLanguages = [...targetLanguages];
  }

  if (value.verbose !== undefined) {
    if (typeof value.verbose !== "boolean") {
      throw new ConfigError(`verbose in ${configPath} must be a boolean`);
    }
    configOverrides.verbose = value.verbose;
  }

  if (value.openaiModel !== undefined) {
    if (typeof value.openaiModel !== "string" || value.openaiModel.trim().length === 0) {
      throw new ConfigError(`openaiModel in ${configPath} must be a non-empty string`);
    }
    configOverrides.openaiModel = value.openaiModel.trim();
  }

  return configOverrides;
};

const loadConfigOverrides = async (configPath: string): Promise<ConfigOverrides> => {
  const configFile = Bun.file(configPath);

  if (!(await configFile.exists())) {
    throw new ConfigError(`Config file not found: ${configPath}`);
  }

  let parsedConfig: unknown;

  try {
    parsedConfig = await configFile.json();
  } catch (configParseError) {
    if (configParseError instanceof Error) {
      throw new ConfigError(`Failed to parse ${configPath}: ${configParseError.message}`);
    }

    throw new ConfigError(`Failed to parse ${configPath}`);
  }

  return parseConfigOverrides(parsedConfig, configPath);
};

const resolveRuntimeConfig = async (globalFlags: GlobalFlags): Promise<Config> => {
  const loadedConfig = await loadConfig();
  const configOverrides = globalFlags.configPath ? await loadConfigOverrides(globalFlags.configPath) : {};
  const verbose = globalFlags.verbose ? true : (configOverrides.verbose ?? loadedConfig.verbose);
  const runtimeConfig: Config = {
    ...loadedConfig,
    ...configOverrides,
    verbose,
  };

  if (runtimeConfig.verbose) {
    process.env.VERBOSE = "true";
  }

  if (runtimeConfig.aiProvider) {
    process.env.GITTRIBUTOR_AI_PROVIDER = runtimeConfig.aiProvider;
  }
  if (runtimeConfig.openaiModel) {
    process.env.OPENAI_MODEL = runtimeConfig.openaiModel;
  }
  if (runtimeConfig.openaiApiKey) {
    process.env.OPENAI_API_KEY = runtimeConfig.openaiApiKey;
  }
  if (runtimeConfig.openaiOauthToken) {
    process.env.OPENAI_OAUTH_TOKEN = runtimeConfig.openaiOauthToken;
  }
  if (runtimeConfig.anthropicApiKey) {
    process.env.ANTHROPIC_API_KEY = runtimeConfig.anthropicApiKey;
  }
  if (runtimeConfig.oauthToken) {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = runtimeConfig.oauthToken;
  }

  return runtimeConfig;
};

const selectRepositoryForAnalysis = (repositories: Repository[]): Repository => {
  const selectedRepository = repositories[0];

  if (!selectedRepository) {
    throw new CLIEntrypointError("No repositories available. Run 'discover' first.");
  }

  return selectedRepository;
};

const selectIssueForFix = (issues: Issue[]): Issue => {
  const selectedIssue = issues[0];

  if (!selectedIssue) {
    throw new CLIEntrypointError("No issues available. Run 'analyze' first.");
  }

  return selectedIssue;
};

const findRepositoryByIssue = (repositories: Repository[], issue: Issue): Repository => {
  const matchingRepository = repositories.find((repository) => repository.fullName === issue.repoFullName);

  if (!matchingRepository) {
    throw new CLIEntrypointError(`Repository for issue '${issue.repoFullName}' was not found in state.`);
  }

  return matchingRepository;
};

const shouldRefreshAnalysisResult = (analysis: AnalysisResult | undefined): boolean => {
  if (!analysis) {
    return true;
  }

  return analysis.relevantFiles.length > 0 && !analysis.fileContents;
};

const isSkippedAnalysisResult = (analysis: AnalysisResult): boolean => {
  return analysis.rootCause === "repo too large to analyze" || analysis.relevantFiles.length === 0;
};

const sanitizeAnalysesForState = (
  analyses: Record<number, AnalysisResult>,
): Record<number, AnalysisResult> => {
  return Object.fromEntries(
    Object.entries(analyses).map(([issueId, analysis]) => [issueId, sanitizeAnalysisForPersistence(analysis)]),
  );
};

const buildPersistedFixResult = (
  analysisResult: AnalysisResult,
  issue: Issue,
  generatedFix: Awaited<ReturnType<typeof generateFix>>,
): PersistedFixResult => {
  return {
    issueId: issue.id,
    repoFullName: analysisResult.repoFullName,
    patch: generatedFix.changes.map((change) => `--- ${change.file}\n+++ ${change.file}`).join("\n"),
    testsPass: false,
    explanation: generatedFix.explanation,
    confidence: generatedFix.confidence,
    generatedAt: new Date().toISOString(),
    changes: generatedFix.changes,
  };
};

const runDiscoverCommand = async (runtimeConfig: Config, commandArgs: string[]): Promise<number> => {
  const parsedArgs = parseArgs(commandArgs);
  const discoveredRepositories = await discoverRepos({
    language: parsedArgs.flags.language ?? runtimeConfig.targetLanguages?.[0],
    minStars: parsedArgs.flags.minStars ?? runtimeConfig.minStars,
    limit: parsedArgs.flags.maxResults,
  });
  const currentState = await loadState();

  const repositories = discoveredRepositories.map((r) => ({
    id: 0,
    name: r.name,
    fullName: r.fullName,
    url: `https://github.com/${r.fullName}`,
    stars: r.stars,
    language: r.language,
    openIssuesCount: r.openIssues,
    updatedAt: new Date().toISOString(),
    description: r.description,
  }));

  await saveState({
    ...currentState,
    status: "discovered",
    repositories,
    issues: [],
    analyses: {},
    fixes: {},
    submissions: [],
  });

  return 0;
};

type AnalyzeDependencies = {
  discoverIssues: typeof discoverIssues;
  loadState: typeof loadState;
  printIssueProposalTable: typeof printIssueProposalTable;
  saveState: typeof saveState;
};

const defaultAnalyzeDependencies: AnalyzeDependencies = {
  discoverIssues,
  loadState,
  printIssueProposalTable,
  saveState,
};

export const runAnalyzeCommand = async (
  output: CliOutput,
  dependencies: AnalyzeDependencies = defaultAnalyzeDependencies,
): Promise<number> => {
  const currentState = await dependencies.loadState();
  selectRepositoryForAnalysis(currentState.repositories);

  for (const repository of currentState.repositories) {
    const discoveredIssuesForRepository = await dependencies.discoverIssues(repository);

    if (discoveredIssuesForRepository.length === 0) {
      continue;
    }

    dependencies.printIssueProposalTable(repository, discoveredIssuesForRepository);

    await dependencies.saveState({
      ...currentState,
      status: "analyzed",
      issues: discoveredIssuesForRepository,
    });

    return 0;
  }

  writeErrorLine(output, "No issues found across all repositories.");
  return 1;
};

const runFixCommand = async (): Promise<number> => {
  const currentState = await loadState();
  const selectedIssue = selectIssueForFix(currentState.issues);
  const selectedRepository = findRepositoryByIssue(currentState.repositories, selectedIssue);
  const cachedAnalysis = currentState.analyses[selectedIssue.id];
  const analysisResult = shouldRefreshAnalysisResult(cachedAnalysis)
    ? await analyzeCodebase(selectedRepository, selectedIssue)
    : cachedAnalysis;

  if (isSkippedAnalysisResult(analysisResult)) {
    throw new CLIEntrypointError(
      `Cannot generate a fix for ${selectedRepository.fullName}: automated analysis was skipped because the repository is too large.`,
    );
  }

  const generatedFix = await generateFix(analysisResult, selectedIssue, selectedRepository);
  const persistedFix = buildPersistedFixResult(analysisResult, selectedIssue, generatedFix);
  const nextAnalyses = sanitizeAnalysesForState({
    ...currentState.analyses,
    [selectedIssue.id]: analysisResult,
  });

  await saveState({
    ...currentState,
    status: "fixed",
    analyses: nextAnalyses,
    fixes: {
      ...currentState.fixes,
      [selectedIssue.id]: persistedFix,
    },
  });

  return 0;
};

type PipelineDependencies = {
  discoverIssues: typeof discoverIssues;
  loadState: typeof loadState;
  printIssueProposalTable: typeof printIssueProposalTable;
  reviewFix: typeof reviewFix;
  runDiscoverCommand: typeof runDiscoverCommand;
  runFixCommand: typeof runFixCommand;
  saveState: typeof saveState;
  submitApprovedFix: typeof submitApprovedFix;
  writeErrorLine: typeof writeErrorLine;
};

const defaultPipelineDependencies: PipelineDependencies = {
  discoverIssues,
  loadState,
  printIssueProposalTable,
  reviewFix,
  runDiscoverCommand,
  runFixCommand,
  saveState,
  submitApprovedFix,
  writeErrorLine,
};

export const runPipelineCommand = async (
  runtimeConfig: Config,
  commandArgs: string[],
  output: CliOutput,
  dependencies: PipelineDependencies = defaultPipelineDependencies,
): Promise<number> => {
  const discoverResult = await dependencies.runDiscoverCommand(runtimeConfig, commandArgs);
  if (discoverResult !== 0) return discoverResult;

  const discoveredState = await dependencies.loadState();
  selectRepositoryForAnalysis(discoveredState.repositories);

  for (const repository of discoveredState.repositories) {
    const discoveredIssuesForRepository = await dependencies.discoverIssues(repository);

    if (discoveredIssuesForRepository.length === 0) {
      continue;
    }

    dependencies.printIssueProposalTable(repository, discoveredIssuesForRepository);

    await dependencies.saveState({
      ...discoveredState,
      status: "analyzed",
      issues: discoveredIssuesForRepository,
    });

    try {
      const fixResult = await dependencies.runFixCommand();
      if (fixResult !== 0) {
        continue;
      }
    } catch (pipelineError) {
      const pipelineErrorMessage = pipelineError instanceof Error ? pipelineError.message : String(pipelineError);

      if (pipelineErrorMessage.includes("repository is too large")) {
        dependencies.writeErrorLine(output, `Skipping ${repository.fullName}: ${pipelineErrorMessage}`);
        continue;
      }

      throw pipelineError;
    }

    const reviewResult = await dependencies.reviewFix({}, {});
    if (reviewResult !== 0) {
      return reviewResult;
    }

    return dependencies.submitApprovedFix();
  }

  dependencies.writeErrorLine(output, "No fixable issues found across all repositories.");
  return 1;
};


const printHelp = (output: CliOutput): number => {
  writeStandardLine(output, USAGE_TEXT);
  return 0;
};

const runCommand = async (argv: string[], output: CliOutput): Promise<number> => {
  const { globalFlags, commandArgs } = parseGlobalArgs(argv);

  if (globalFlags.help) {
    return printHelp(output);
  }

  if (globalFlags.version) {
    writeStandardLine(output, await readPackageVersion());
    return 0;
  }

  if (globalFlags.verbose) {
    process.env.VERBOSE = "true";
  }

  validateCommandShape(commandArgs);

  const parsedArgs = parseArgs(commandArgs);
  const requestedCommand = parsedArgs.positionals[0];

  if (parsedArgs.command === "help") {
    if (requestedCommand && requestedCommand !== "help") {
      writeErrorLine(output, "Unknown command. Run --help for usage");
      return 1;
    }

    return printHelp(output);
  }

  const runtimeConfig = globalFlags.configPath ? await resolveRuntimeConfig(globalFlags) : null;

  switch (parsedArgs.command) {
    case "discover":
      return runDiscoverCommand(runtimeConfig ?? await resolveRuntimeConfig(globalFlags), commandArgs);
    case "analyze":
      {
        const repos = await discoverRepos({});
        const { analyzeRepositories } = await import("./commands/analyze.js");
        const { setStateData } = await import("./lib/state.js");
        const opportunities = await analyzeRepositories(repos);
        await setStateData("contributionOpportunities", opportunities);
        if (opportunities.length === 0) {
          writeErrorLine(output, "No contribution opportunities found.");
          return 1;
        }
        return 0;
      }
    case "fix":
      await (runtimeConfig ?? resolveRuntimeConfig(globalFlags));
      return runFixCommand();
    case "review":
      return reviewFix({});
    case "submit":
      return submitApprovedFix();
    case "run":
      {
        const { parseRunFlags, runOrchestrator } = await import("./commands/run.js");
        const flags = parseRunFlags(commandArgs);
        return runOrchestrator(flags);
      }
  }
};

export const runCli = async (
  argv: string[],
  options: RunCliOptions = {},
): Promise<{ exitCode: number }> => {
  const output = resolveCliOutput(options);

  try {
    return { exitCode: await runCommand(argv, output) };
  } catch (commandError) {
    if (
      commandError instanceof CLIEntrypointError ||
      commandError instanceof CLIArgumentError ||
      commandError instanceof ConfigError
    ) {
      writeErrorLine(output, commandError.message);
      return { exitCode: commandError instanceof CLIEntrypointError ? commandError.exitCode : 1 };
    }

    if (commandError instanceof Error) {
      logError(commandError.message);
      return { exitCode: 1 };
    }

    logError("Unknown CLI failure");
    return { exitCode: 1 };
  }
};

const main = async (argv: string[]): Promise<number> => {
  const { exitCode } = await runCli(argv);
  return exitCode;
};

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)));
}

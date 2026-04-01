import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { callAnthropic } from "./anthropic";
import { GitHubAPIError, GittributorError } from "./errors";
import { warn } from "./logger";
import type { AnalysisResult, Issue, Repository } from "../types/index";

declare module "../types/index" {
  interface AnalysisResult {
    rootCause?: string;
    affectedFiles?: string[];
    complexity?: "low" | "medium" | "high";
  }
}

interface ParsedAnalysisPayload {
  rootCause: string;
  affectedFiles: string[];
  suggestedApproach: string;
  complexity: "low" | "medium" | "high";
  confidence: number;
}

interface RepoDetails {
  diskUsageKb: number;
}

class AnalyzerError extends GittributorError {
  constructor(message: string) {
    super(message, "ANALYZER_ERROR");
    this.name = "AnalyzerError";
  }
}

const MAX_ANALYZED_FILES = 5;
const MAX_LINES_PER_FILE = 500;
const MAX_REPO_SIZE_KB = 102400;
const ANALYZER_MAX_TOKENS = 1024;
const SUPPORTED_SOURCE_EXTENSION_PATTERN =
  /\.(ts|tsx|js|jsx|mjs|cjs|py|go|java|rb|rs|c|cpp|cs|php|swift|kt)$/;
const FILE_MENTION_PATTERN =
  /(?:[\w./-]+)\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|java|rb|rs|c|cpp|cs|php|swift|kt)/g;
const ANALYZER_SYSTEM_PROMPT =
  "You are analyzing a codebase to understand a GitHub issue. Identify the root cause and suggest which files need changes.";

function createTempRepoPath(repo: Repository): string {
  return path.join(tmpdir(), `gittributor-${repo.name}-${Date.now()}`);
}

function createLargeRepoResult(repo: Repository, issue: Issue): AnalysisResult {
  return {
    issueId: issue.id,
    repoFullName: repo.fullName,
    relevantFiles: [],
    suggestedApproach: "Skip automated analysis because the repository exceeds the analyzer size limit.",
    confidence: 0,
    analyzedAt: new Date().toISOString(),
    rootCause: "repo too large to analyze",
    affectedFiles: [],
    complexity: "high",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function clampConfidence(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0;
  }

  if (value < 0) {
    return 0;
  }

  if (value > 1) {
    return 1;
  }

  return value;
}

function normalizeComplexity(value: unknown): "low" | "medium" | "high" {
  if (value === "low" || value === "medium" || value === "high") {
    return value;
  }

  return "medium";
}

async function runCommand(command: string[]): Promise<string> {
  const process = Bun.spawn({ cmd: command, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);

  if (exitCode !== 0) {
    throw new GitHubAPIError(`Command failed: ${command.join(" ")} (exit ${exitCode}) ${stderr}`, exitCode);
  }

  return stdout;
}

async function getRepoDetails(repo: Repository): Promise<RepoDetails> {
  const stdout = await runCommand(["gh", "repo", "view", repo.fullName, "--json", "diskUsage"]);

  try {
    const parsed = JSON.parse(stdout) as unknown;
    if (!isRecord(parsed) || typeof parsed.diskUsage !== "number") {
      return { diskUsageKb: 0 };
    }

    return { diskUsageKb: parsed.diskUsage };
  } catch {
    throw new AnalyzerError("Repository details response was not valid JSON.");
  }
}

function parseMentionedFiles(issue: Issue): string[] {
  const issueText = `${issue.title}\n${issue.body ?? ""}`;
  const mentionedFiles = issueText.match(FILE_MENTION_PATTERN) ?? [];
  return [...new Set(mentionedFiles.map((filePath) => filePath.replace(/^\.\//, "")))];
}

function listSourceFiles(directoryPath: string): string[] {
  if (!existsSync(directoryPath)) {
    return [];
  }

  const discoveredFiles: string[] = [];
  const entries = readdirSync(directoryPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      discoveredFiles.push(...listSourceFiles(fullPath));
      continue;
    }

    if (SUPPORTED_SOURCE_EXTENSION_PATTERN.test(entry.name)) {
      discoveredFiles.push(fullPath);
    }
  }

  return discoveredFiles;
}

function rankSourceFiles(repoPath: string, issue: Issue): string[] {
  const preferredRoot = path.join(repoPath, "src");
  const sourceFiles = listSourceFiles(preferredRoot);
  const fallbackFiles = sourceFiles.length > 0 ? sourceFiles : listSourceFiles(repoPath);
  const relativeFiles = fallbackFiles.map((absolutePath) => path.relative(repoPath, absolutePath));
  const mentionedFiles = parseMentionedFiles(issue);

  return [...relativeFiles]
    .sort((leftFile, rightFile) => {
      const leftMentionIndex = mentionedFiles.findIndex((mentionedFile) => leftFile.endsWith(mentionedFile));
      const rightMentionIndex = mentionedFiles.findIndex((mentionedFile) => rightFile.endsWith(mentionedFile));

      if (leftMentionIndex !== -1 || rightMentionIndex !== -1) {
        if (leftMentionIndex === -1) {
          return 1;
        }

        if (rightMentionIndex === -1) {
          return -1;
        }

        return leftMentionIndex - rightMentionIndex;
      }

      return leftFile.localeCompare(rightFile);
    })
    .slice(0, MAX_ANALYZED_FILES);
}

function truncateFileByLines(filePath: string): string {
  const lines = readFileSync(filePath, "utf8").split("\n");
  if (lines.length <= MAX_LINES_PER_FILE) {
    return lines.join("\n");
  }

  return `${lines.slice(0, MAX_LINES_PER_FILE).join("\n")}\n// [...truncated at 500 lines...]`;
}

function buildAnalysisPrompt(
  repo: Repository,
  issue: Issue,
  repoPath: string,
  relevantFiles: string[],
): string {
  const fileBlocks = relevantFiles
    .map((relativeFilePath) => {
      const absoluteFilePath = path.join(repoPath, relativeFilePath);
      return `File: ${relativeFilePath}\n${truncateFileByLines(absoluteFilePath)}`;
    })
    .join("\n\n");

  return [
    "Analyze this GitHub issue against the selected repository files.",
    `Repository: ${repo.fullName}`,
    `Issue #${issue.number}: ${issue.title}`,
    `Issue Body: ${issue.body ?? "(no body)"}`,
    "Selected Files:",
    fileBlocks || "(no relevant files found)",
    'Respond as JSON with keys: rootCause (string), affectedFiles (string[]), suggestedApproach (string), complexity ("low"|"medium"|"high"), confidence (0..1).',
  ].join("\n\n");
}

function parseAnalysisPayload(responseText: string): ParsedAnalysisPayload {
  try {
    const parsed = JSON.parse(responseText) as unknown;
    if (!isRecord(parsed)) {
      throw new AnalyzerError("Analyzer response must be a JSON object.");
    }

    const affectedFiles = Array.isArray(parsed.affectedFiles)
      ? parsed.affectedFiles.filter((filePath): filePath is string => typeof filePath === "string")
      : [];

    return {
      rootCause: typeof parsed.rootCause === "string" ? parsed.rootCause : "Unable to determine root cause.",
      affectedFiles,
      suggestedApproach:
        typeof parsed.suggestedApproach === "string"
          ? parsed.suggestedApproach
          : "Review the selected files and align the fix with the issue description.",
      complexity: normalizeComplexity(parsed.complexity),
      confidence: clampConfidence(parsed.confidence),
    };
  } catch (error) {
    if (error instanceof AnalyzerError) {
      throw error;
    }

    throw new AnalyzerError("Analyzer response was not valid JSON.");
  }
}

function normalizeRelevantFiles(selectedFiles: string[], affectedFiles: string[]): string[] {
  const selectedFileSet = new Set(selectedFiles);
  const normalizedAffectedFiles = affectedFiles.filter((filePath) => selectedFileSet.has(filePath));
  return normalizedAffectedFiles.length > 0 ? normalizedAffectedFiles : selectedFiles;
}

async function persistAnalysisResult(analysis: AnalysisResult): Promise<void> {
  const outputDirectory = path.join(process.cwd(), ".gittributor");
  mkdirSync(outputDirectory, { recursive: true });
  await Bun.write(path.join(outputDirectory, "analysis.json"), JSON.stringify(analysis, null, 2));
}

async function requestAnalysis(
  repo: Repository,
  issue: Issue,
  repoPath: string,
  selectedFiles: string[],
): Promise<AnalysisResult> {
  const prompt = buildAnalysisPrompt(repo, issue, repoPath, selectedFiles);
  const responseText = await callAnthropic({
    apiKey: Bun.env.ANTHROPIC_API_KEY ?? "",
    system: ANALYZER_SYSTEM_PROMPT,
    prompt,
    maxTokens: ANALYZER_MAX_TOKENS,
  });
  const parsedAnalysis = parseAnalysisPayload(responseText);
  const normalizedRelevantFiles = normalizeRelevantFiles(selectedFiles, parsedAnalysis.affectedFiles);

  return {
    issueId: issue.id,
    repoFullName: repo.fullName,
    relevantFiles: normalizedRelevantFiles,
    suggestedApproach: parsedAnalysis.suggestedApproach,
    confidence: parsedAnalysis.confidence,
    analyzedAt: new Date().toISOString(),
    rootCause: parsedAnalysis.rootCause,
    affectedFiles: normalizedRelevantFiles,
    complexity: parsedAnalysis.complexity,
  };
}

/**
 * Analyze a repository snapshot against a GitHub issue using a shallow clone and Anthropic.
 *
 * @param repo - Repository metadata used for GitHub CLI lookup and shallow cloning.
 * @param issue - GitHub issue metadata used to rank relevant files and describe the problem.
 * @returns A persisted analysis payload including relevant files, root cause, and suggested approach.
 * @throws {GitHubAPIError} When the GitHub CLI commands fail.
 * @throws {AnalyzerError} When repository metadata or Anthropic responses are malformed.
 *
 * @example
 * const analysis = await analyzeCodebase(repo, issue);
 * console.log(analysis.relevantFiles);
 */
export async function analyzeCodebase(repo: Repository, issue: Issue): Promise<AnalysisResult> {
  const repoDetails = await getRepoDetails(repo);
  if (repoDetails.diskUsageKb > MAX_REPO_SIZE_KB) {
    warn(`Skipping ${repo.fullName} because size is ${repoDetails.diskUsageKb}KB (>100MB).`);
    const largeRepoResult = createLargeRepoResult(repo, issue);
    await persistAnalysisResult(largeRepoResult);
    return largeRepoResult;
  }

  const tempRepoPath = createTempRepoPath(repo);

  try {
    await runCommand([
      "gh",
      "repo",
      "clone",
      repo.fullName,
      tempRepoPath,
      "--",
      "--depth",
      "1",
    ]);

    const selectedFiles = rankSourceFiles(tempRepoPath, issue);
    const analysis = await requestAnalysis(repo, issue, tempRepoPath, selectedFiles);
    await persistAnalysisResult(analysis);
    return analysis;
  } finally {
    rmSync(tempRepoPath, { recursive: true, force: true });
  }
}

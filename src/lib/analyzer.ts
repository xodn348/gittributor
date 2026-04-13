import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { callModel } from "./ai";
import { GitHubAPIError, GittributorError } from "./errors";
import { debug, warn } from "./logger";
import { analyzeFileStatic } from "./static-analyzer.js";
import type { AnalysisResult, Issue, Repository } from "../types/index";

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

const parsePositiveIntegerEnv = (name: string, fallback: number): number => {
  const raw = Bun.env[name]?.trim();
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const MAX_ANALYZED_FILES = parsePositiveIntegerEnv("GITTRIBUTOR_ANALYZER_MAX_FILES", 10);
const MAX_LINES_PER_FILE = parsePositiveIntegerEnv("GITTRIBUTOR_ANALYZER_MAX_LINES_PER_FILE", 250);
const MAX_REPO_SIZE_KB = 102400;
const MAX_PERSISTED_FILE_CONTENT_BYTES = 50 * 1024;
const ANALYZER_MAX_TOKENS = parsePositiveIntegerEnv("GITTRIBUTOR_ANALYZER_MAX_TOKENS", 2048);
const MAX_LLM_CALLS_PER_REPO = 3;
const SUPPORTED_SOURCE_EXTENSION_PATTERN =
  /\.(ts|tsx|js|jsx|mjs|cjs|py|go|java|rb|rs|c|cpp|cs|php|swift|kt)$/;
const FILE_MENTION_PATTERN =
  /(?:[\w./-]+)\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|java|rb|rs|c|cpp|cs|php|swift|kt)/g;
const ANALYZER_SYSTEM_PROMPT =
  "You are analyzing a codebase to understand a GitHub issue. Identify the root cause and suggest which files need changes.";

function createTempRepoPath(repo: Repository): string {
  return path.join(tmpdir(), `gittributor-${repo.name}-${Date.now()}`);
}

function createLargeRepoResult(repo: Repository, issue?: Issue): AnalysisResult {
  return {
    issueId: issue?.id ?? 0,
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

export function sanitizeAnalysisForPersistence(analysis: AnalysisResult): AnalysisResult {
  const payloadWithContents = JSON.stringify(analysis, null, 2);
  if (!analysis.fileContents || Buffer.byteLength(payloadWithContents, "utf8") <= MAX_PERSISTED_FILE_CONTENT_BYTES) {
    return analysis;
  }

  return {
    ...analysis,
    fileContents: undefined,
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

const PREFERRED_SOURCE_DIRS = ["src", "source", "lib", "app", "packages", "modules", "core", "server", "client", "api"];

function getFileSizeScore(filePath: string): number {
  try {
    const stat = readFileSync(filePath, "utf8");
    const lines = stat.split("\n").length;
    if (lines < 50) return 0.3;
    if (lines <= 2000) return 1.0;
    if (lines <= 5000) return 0.6;
    return 0.2;
  } catch {
    return 0.5;
  }
}

function rankSourceFiles(repoPath: string, issue?: Issue): string[] {
  let sourceFiles: string[] = [];
  for (const dir of PREFERRED_SOURCE_DIRS) {
    sourceFiles = listSourceFiles(path.join(repoPath, dir));
    if (sourceFiles.length > 0) break;
  }
  const fallbackFiles = sourceFiles.length > 0 ? sourceFiles : listSourceFiles(repoPath);
  const relativeFiles = fallbackFiles.map((absolutePath) => path.relative(repoPath, absolutePath));
  const mentionedFiles = issue ? parseMentionedFiles(issue) : [];

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

      const leftAbs = path.join(repoPath, leftFile);
      const rightAbs = path.join(repoPath, rightFile);
      const leftScore = getFileSizeScore(leftAbs);
      const rightScore = getFileSizeScore(rightAbs);

      if (leftScore !== rightScore) {
        return rightScore - leftScore;
      }

      return 0;
    })
    .slice(0, MAX_ANALYZED_FILES);
}

interface StaticPhaseResult {
  filePath: string;
  riskScore: number;
}

function runStaticAnalysisPhase(
  repoPath: string,
  filePaths: string[],
): StaticPhaseResult[] {
  const results: StaticPhaseResult[] = [];

  for (const relativePath of filePaths) {
    const absolutePath = path.join(repoPath, relativePath);
    if (!existsSync(absolutePath)) {
      continue;
    }

    try {
      const content = readFileSync(absolutePath, "utf8");
      const fileAnalysis = analyzeFileStatic(absolutePath, content);
      if (fileAnalysis) {
        results.push({
          filePath: relativePath,
          riskScore: fileAnalysis.maxSeverity,
        });
      }
    } catch (e) {
      debug("[analyzer] error: " + String(e));
      throw e;
    }
  }

  return results.sort((a, b) => b.riskScore - a.riskScore);
}

function listAllSourceFiles(repoPath: string): string[] {
  let sourceFiles: string[] = [];
  for (const dir of PREFERRED_SOURCE_DIRS) {
    sourceFiles = listSourceFiles(path.join(repoPath, dir));
    if (sourceFiles.length > 0) break;
  }
  const fallbackFiles = sourceFiles.length > 0 ? sourceFiles : listSourceFiles(repoPath);
  return fallbackFiles.map((absolutePath) => path.relative(repoPath, absolutePath));
}

function truncateFileByLines(filePath: string): string {
  const lines = readFileSync(filePath, "utf8").split("\n");
  if (lines.length <= MAX_LINES_PER_FILE) {
    return lines.join("\n");
  }

  return `${lines.slice(0, MAX_LINES_PER_FILE).join("\n")}\n// [...truncated at ${MAX_LINES_PER_FILE} lines...]`;
}

function buildAnalysisPrompt(
  repo: Repository,
  issue: Issue | undefined,
  repoPath: string,
  relevantFiles: string[],
): string {
  const fileBlocks = relevantFiles
    .map((relativeFilePath) => {
      const absoluteFilePath = path.join(repoPath, relativeFilePath);
      return `File: ${relativeFilePath}\n${truncateFileByLines(absoluteFilePath)}`;
    })
    .join("\n\n");

  if (!issue) {
    return [
      "Discover bugs, security issues, type errors, performance problems, and logic errors in this repository.",
      "Focus on finding actionable, self-contained issues that can be fixed with minimal changes.",
      `Repository: ${repo.fullName}`,
      `Description: ${repo.description ?? "(no description)"}`,
      "Selected Files:",
      fileBlocks || "(no relevant files found)",
      "Respond as JSON with keys: rootCause (string), affectedFiles (string[]), suggestedApproach (string), complexity (\"low\"|\"medium\"|\"high\"), confidence (0..1).",
    ].join("\n\n");
  }

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

function extractJson(text: string): string {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return match ? match[1].trim() : text.trim();
}

function parseAnalysisPayload(responseText: string): ParsedAnalysisPayload {
  try {
    const parsed = JSON.parse(extractJson(responseText)) as unknown;
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

async function validateRelevantFiles(repoPath: string, relevantFiles: string[]): Promise<string[]> {
  try {
    const validatedRelevantFiles = relevantFiles.filter((filePath) =>
      existsSync(path.join(repoPath, filePath))
    );

    if (validatedRelevantFiles.length !== relevantFiles.length) {
      debug(`[analyzer] filtered ${relevantFiles.length - validatedRelevantFiles.length} relevant files not present in repo tree`);
    }

    return validatedRelevantFiles;
  } catch (e) {
    debug("[analyzer] error: " + String(e));
    throw e;
  }
}

async function persistAnalysisResult(analysis: AnalysisResult): Promise<void> {
  const outputDirectory = path.join(process.cwd(), ".gittributor");
  mkdirSync(outputDirectory, { recursive: true });
  await Bun.write(
    path.join(outputDirectory, "analysis.json"),
    JSON.stringify(sanitizeAnalysisForPersistence(analysis), null, 2),
  );
}

async function requestAnalysis(
  repo: Repository,
  issue: Issue | undefined,
  repoPath: string,
  selectedFiles: string[],
): Promise<AnalysisResult> {
  debug(`[analyzer] requestAnalysis: repo=${repo.fullName}, files=${selectedFiles.length}`);
  const systemPrompt = issue
    ? ANALYZER_SYSTEM_PROMPT
    : "You are discovering bugs, security issues, type errors, and logic errors in a codebase. Identify actionable issues and suggest which files need changes.";
  const prompt = buildAnalysisPrompt(repo, issue, repoPath, selectedFiles);
  const responseText = await callModel({
    provider: Bun.env.GITTRIBUTOR_AI_PROVIDER?.trim() === "openai" ? "openai" : "anthropic",
    apiKey: Bun.env.OPENAI_API_KEY?.trim() ?? Bun.env.ANTHROPIC_API_KEY?.trim(),
    oauthToken: Bun.env.OPENAI_OAUTH_TOKEN?.trim() ?? Bun.env.CLAUDE_CODE_OAUTH_TOKEN?.trim(),
    model: Bun.env.OPENAI_MODEL?.trim(),
    system: systemPrompt,
    prompt,
    maxTokens: ANALYZER_MAX_TOKENS,
  });
  const parsedAnalysis = parseAnalysisPayload(responseText);
  debug(`[analyzer] requestAnalysis: repo=${repo.fullName}, confidence=${parsedAnalysis.confidence}`);
  const normalizedRelevantFiles = normalizeRelevantFiles(selectedFiles, parsedAnalysis.affectedFiles);
  const validatedRelevantFiles = await validateRelevantFiles(repoPath, normalizedRelevantFiles);

  return {
    issueId: issue?.id ?? 0,
    repoFullName: repo.fullName,
    relevantFiles: validatedRelevantFiles,
    suggestedApproach: parsedAnalysis.suggestedApproach,
    confidence: parsedAnalysis.confidence,
    analyzedAt: new Date().toISOString(),
    rootCause: parsedAnalysis.rootCause,
    affectedFiles: validatedRelevantFiles,
    complexity: parsedAnalysis.complexity,
    fileContents: Object.fromEntries(
      validatedRelevantFiles.map((f) => [f, truncateFileByLines(path.join(repoPath, f))]),
    ),
  };
}

/**
 * Analyze a repository snapshot against a GitHub issue using a shallow clone and Anthropic.
 * When issue is absent, runs in free-form discovery mode to find bugs, security issues,
 * type errors, and logic errors.
 *
 * @param repo - Repository metadata used for GitHub CLI lookup and shallow cloning.
 * @param issue - Optional GitHub issue metadata. When absent, discovers issues proactively.
 * @returns A persisted analysis payload including relevant files, root cause, and suggested approach.
 * @throws {GitHubAPIError} When the GitHub CLI commands fail.
 * @throws {AnalyzerError} When repository metadata or Anthropic responses are malformed.
 *
 * @example
 * const analysis = await analyzeCodebase(repo, issue);
 * console.log(analysis.relevantFiles);
 * @example
 * const analysis = await analyzeCodebase(repo);
 * console.log(analysis.relevantFiles);
 */
export async function analyzeCodebase(repo: Repository, issue?: Issue): Promise<AnalysisResult> {
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

    const allFiles = listAllSourceFiles(tempRepoPath);
    const selectedFiles = rankSourceFiles(tempRepoPath, issue);

    const staticResults = runStaticAnalysisPhase(tempRepoPath, allFiles);
    debug(`[analyzer] Phase 1: static analysis found ${staticResults.length} files with risk scores`);
    const topRiskFiles = staticResults
      .sort((a, b) => b.riskScore - a.riskScore)
      .slice(0, MAX_ANALYZED_FILES)
      .map((r) => r.filePath);

    const prioritized = new Set(topRiskFiles);
    const remaining = selectedFiles.filter((f) => !prioritized.has(f));
    const llmFiles = [...new Set([...topRiskFiles, ...remaining])].slice(0, MAX_ANALYZED_FILES);
    debug(`[analyzer] Phase 2: LLM analyzing ${llmFiles.length} files`);

    let llmCallsUsed = 0;
    if (llmCallsUsed >= MAX_LLM_CALLS_PER_REPO) {
      throw new Error(`LLM budget exhausted for ${repo.fullName}`);
    }
    llmCallsUsed++;
    const analysis = await requestAnalysis(repo, issue, tempRepoPath, llmFiles);
    await persistAnalysisResult(analysis);
    return analysis;
  } finally {
    rmSync(tempRepoPath, { recursive: true, force: true });
  }
}

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { analyzeCodeForIssue } from "./anthropic";
import { warn } from "./logger";
import type { AnalysisResult, Issue, Repository } from "../types/index";

const MAX_FILES_TO_ANALYZE = 5;
const MAX_LINES_PER_FILE = 500;
const MAX_REPO_SIZE_KB = 102400;
const FILE_EXTENSION_PATTERN = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|java|rb|rs|c|cpp|cs|php|swift|kt)$/;
const FILE_MENTION_PATTERN = /(?:[\w./-]+)\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|java|rb|rs|c|cpp|cs|php|swift|kt)/g;

interface RepoDetails {
  diskUsageKb: number;
}

function createTempRepoPath(repo: Repository): string {
  return path.join(tmpdir(), `${repo.name}-${Date.now()}`);
}

function createCommandProcess(cmd: string[]): Bun.Subprocess {
  return Bun.spawn({ cmd, stdout: "pipe", stderr: "pipe" });
}

async function runCommand(cmd: string[]): Promise<string> {
  const process = createCommandProcess(cmd);
  const stdoutStream = process.stdout instanceof ReadableStream ? process.stdout : "";
  const stderrStream = process.stderr instanceof ReadableStream ? process.stderr : "";
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(stdoutStream).text(),
    new Response(stderrStream).text(),
    process.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(`Command failed: ${cmd.join(" ")} (exit ${exitCode}) ${stderr}`);
  }

  return stdout;
}

async function getRepoDetails(repo: Repository): Promise<RepoDetails> {
  const stdout = await runCommand(["gh", "repo", "view", repo.fullName, "--json", "diskUsage"]);
  const parsed = JSON.parse(stdout) as unknown;
  if (typeof parsed !== "object" || parsed === null) {
    return { diskUsageKb: 0 };
  }

  const diskUsage = (parsed as { diskUsage?: unknown }).diskUsage;
  return { diskUsageKb: typeof diskUsage === "number" ? diskUsage : 0 };
}

function parseMentionedFiles(issue: Issue): string[] {
  const issueText = `${issue.title}\n${issue.body ?? ""}`;
  const mentions = issueText.match(FILE_MENTION_PATTERN) ?? [];
  return [...new Set(mentions)];
}

function listSourceFiles(directoryPath: string): string[] {
  const discoveredFiles: string[] = [];
  const entries = readdirSync(directoryPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      discoveredFiles.push(...listSourceFiles(fullPath));
      continue;
    }

    if (FILE_EXTENSION_PATTERN.test(entry.name)) {
      discoveredFiles.push(fullPath);
    }
  }

  return discoveredFiles;
}

function selectRelevantFiles(repoPath: string, issue: Issue): string[] {
  const srcDirectory = path.join(repoPath, "src");
  const mentionedFiles = parseMentionedFiles(issue);
  const mentionedRelativePaths = mentionedFiles.map((filePath) => filePath.replace(/^\.\//, ""));
  const sourceFiles = listSourceFiles(srcDirectory);
  const sourceRelativePaths = sourceFiles.map((absolutePath) => path.relative(repoPath, absolutePath));

  const rankedPaths = [...sourceRelativePaths].sort((leftPath, rightPath) => {
    const leftMentionIndex = mentionedRelativePaths.findIndex((mentioned) => leftPath.endsWith(mentioned));
    const rightMentionIndex = mentionedRelativePaths.findIndex((mentioned) => rightPath.endsWith(mentioned));

    if (leftMentionIndex !== -1 || rightMentionIndex !== -1) {
      if (leftMentionIndex === -1) return 1;
      if (rightMentionIndex === -1) return -1;
      return leftMentionIndex - rightMentionIndex;
    }

    return leftPath.localeCompare(rightPath);
  });

  return rankedPaths.slice(0, MAX_FILES_TO_ANALYZE);
}

function formatCodeContext(repoPath: string, relativeFilePaths: string[]): string {
  return relativeFilePaths
    .map((relativeFilePath) => {
      const absoluteFilePath = path.join(repoPath, relativeFilePath);
      const lines = readFileSync(absoluteFilePath, "utf8").split("\n");
      if (lines.length <= MAX_LINES_PER_FILE) {
        return `File: ${relativeFilePath}\n${lines.join("\n")}`;
      }

      const truncated = lines.slice(0, MAX_LINES_PER_FILE).join("\n");
      return `${`File: ${relativeFilePath}\n${truncated}`}\n// [...truncated at 500 lines...]`;
    })
    .join("\n\n");
}

function saveAnalysisResult(analysis: AnalysisResult): void {
  const outputDirectory = path.join(process.cwd(), ".gittributor");
  mkdirSync(outputDirectory, { recursive: true });
  writeFileSync(path.join(outputDirectory, "analysis.json"), JSON.stringify(analysis, null, 2));
}

export async function analyzeCodebase(repo: Repository, issue: Issue): Promise<AnalysisResult> {
  const details = await getRepoDetails(repo);
  if (details.diskUsageKb > MAX_REPO_SIZE_KB) {
    warn(`Skipping ${repo.fullName} because size is ${details.diskUsageKb}KB (>100MB).`);

    const largeRepoAnalysis = {
      issueId: issue.id,
      repoFullName: repo.fullName,
      relevantFiles: [],
      suggestedApproach: "Repository is too large to analyze automatically.",
      confidence: 0,
      analyzedAt: new Date().toISOString(),
      rootCause: "repo too large to analyze",
      affectedFiles: [],
      complexity: "high",
    };

    return largeRepoAnalysis;
  }

  const tempDirectory = createTempRepoPath(repo);

  try {
    await runCommand([
      "gh",
      "repo",
      "clone",
      repo.fullName,
      tempDirectory,
      "--",
      "--depth",
      "1",
    ]);

    const relevantFiles = selectRelevantFiles(tempDirectory, issue);
    const codeContext = formatCodeContext(tempDirectory, relevantFiles);
    const analysis = await analyzeCodeForIssue({
      issue,
      codeContext,
      apiKey: process.env.ANTHROPIC_API_KEY ?? "",
    });

    const normalizedAnalysis: AnalysisResult = {
      ...analysis,
      issueId: issue.id,
      repoFullName: repo.fullName,
      relevantFiles,
    };

    saveAnalysisResult(normalizedAnalysis);
    return normalizedAnalysis;
  } finally {
    rmSync(tempDirectory, { recursive: true, force: true });
  }
}

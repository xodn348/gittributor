import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { GitHubClient } from "../lib/github";
import { debug, info, log } from "../lib/logger";
import type { Issue, Repository } from "../types";

const ISSUE_LABELS = ["good first issue", "good-first-issue", "beginner", "help wanted"];
const ISSUE_SEARCH_LIMIT = 50;
const ONE_YEAR_IN_MS = 365 * 24 * 60 * 60 * 1000;
const FILE_PATH_PATTERN = /(?:[\w.-]+\/)*[\w.-]+\.[a-z0-9]+/gi;
const DIRECTORY_PATTERN = /(?:src|lib|app|tests?|packages|docs)\/[\w./-]+/gi;
const STOP_WORDS = new Set([
  "about",
  "after",
  "before",
  "check",
  "clear",
  "issue",
  "please",
  "steps",
  "their",
  "there",
  "these",
  "this",
  "when",
  "with",
]);

const REPRODUCTION_PATTERNS = [
  /steps to reproduce/i,
  /reproduc(e|ible|tion)/i,
  /how to reproduce/i,
  /minimal repro/i,
];

const SMALL_SCOPE_PATTERNS = [
  /small scope/i,
  /narrow scope/i,
  /limited scope/i,
  /single module/i,
  /one module/i,
  /single component/i,
  /one component/i,
  /single file/i,
  /one file/i,
  /in\s+[\w./-]+\.(ts|tsx|js|jsx|py|go|java|rb|rs|c|cpp|cs)/i,
];

const TEST_FILE_PATTERNS = [
  /test file/i,
  /\btests?\b/i,
  /\bspec\b/i,
  /\.(test|spec)\.[\w]+/i,
];

const SINGLE_FILE_FIX_PATTERNS = [
  /single[-\s]file/i,
  /one[-\s]file/i,
  /only\s+[\w./-]+\.(ts|tsx|js|jsx|py|go|java|rb|rs|c|cpp|cs)/i,
  /just\s+[\w./-]+\.(ts|tsx|js|jsx|py|go|java|rb|rs|c|cpp|cs)/i,
];

type IssueWithOptionalUpdatedAt = Issue & {
  updatedAt?: string;
};

export type ScoredIssue = Issue & {
  approachabilityScore: number;
  impactScore: number;
  codebaseScore: number;
  totalScore: number;
};

const hasPatternMatch = (source: string, patterns: RegExp[]): boolean => {
  return patterns.some((pattern) => pattern.test(source));
};

const getIssueUpdatedAt = (issue: Issue): string => {
  const withOptionalUpdatedAt = issue as IssueWithOptionalUpdatedAt;
  return withOptionalUpdatedAt.updatedAt ?? issue.createdAt;
};

const isNotStale = (issue: Issue): boolean => {
  const updatedAtMs = Date.parse(getIssueUpdatedAt(issue));
  if (!Number.isFinite(updatedAtMs)) {
    return false;
  }

  return Date.now() - updatedAtMs <= ONE_YEAR_IN_MS;
};

const hasClearDescription = (issue: Issue): boolean => {
  const body = issue.body ?? "";
  return body.trim().length > 50;
};

const scoreApproachability = (issue: Issue): number => {
  const body = issue.body ?? "";
  let score = 0;

  if (hasPatternMatch(body, REPRODUCTION_PATTERNS)) {
    score += 2;
  }

  if (hasPatternMatch(body, SMALL_SCOPE_PATTERNS)) {
    score += 2;
  }

  if (hasPatternMatch(body, TEST_FILE_PATTERNS)) {
    score += 1;
  }

  if (hasPatternMatch(body, SINGLE_FILE_FIX_PATTERNS)) {
    score += 3;
  }

  return score;
};

const scoreImpact = (issue: Issue): number => {
  let score = 0;

  if ((issue.reactions ?? 0) > 10) {
    score += 3;
  } else if ((issue.reactions ?? 0) >= 5) {
    score += 2;
  } else if ((issue.reactions ?? 0) >= 1) {
    score += 1;
  }

  if ((issue.commentsCount ?? 0) > 5) {
    score += 1;
  }

  if (issue.labels.some((label) => label.toLowerCase().includes("bug"))) {
    score += 1;
  }

  return score;
};

const getIssueText = (issue: Issue): string => {
  return `${issue.title}\n${issue.body ?? ""}`.toLowerCase();
};

const extractKeywords = (issue: Issue): string[] => {
  const matches = getIssueText(issue).match(/[a-z][a-z0-9_-]{3,}/g) ?? [];
  return [...new Set(matches.filter((keyword) => !STOP_WORDS.has(keyword)))];
};

const getMentionedFilePaths = (issue: Issue): string[] => {
  return [...new Set((getIssueText(issue).match(FILE_PATH_PATTERN) ?? []).map((value) => value.toLowerCase()))];
};

const getMentionedDirectories = (issue: Issue): string[] => {
  return [...new Set((getIssueText(issue).match(DIRECTORY_PATTERN) ?? []).map((value) => value.toLowerCase()))];
};

const scoreWithCodebase = (issue: Issue, fileTree: string[]): number => {
  if (fileTree.length === 0) {
    return 0;
  }

  const normalizedTree = fileTree.map((filePath) => filePath.toLowerCase());
  let score = 0;

  if (getMentionedFilePaths(issue).some((filePath) => normalizedTree.includes(filePath))) {
    score += 3;
  }

  if (extractKeywords(issue).some((keyword) => normalizedTree.some((filePath) => filePath.includes(keyword)))) {
    score += 2;
  }

  if (
    getMentionedDirectories(issue).some((directoryPath) =>
      normalizedTree.some((filePath) => filePath === directoryPath || filePath.startsWith(`${directoryPath}/`)),
    )
  ) {
    score += 1;
  }

  return score;
};

const persistIssues = async (issues: ScoredIssue[]): Promise<void> => {
  const outputDirectory = join(process.cwd(), ".gittributor");
  const outputPath = join(outputDirectory, "issues.json");

  await mkdir(outputDirectory, { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(issues, null, 2)}\n`, "utf8");
};

const estimateComplexity = (issue: ScoredIssue): "low" | "medium" | "high" => {
  if (issue.approachabilityScore >= 4 || issue.totalScore >= 8) {
    return "low";
  }

  if (issue.approachabilityScore >= 2 || issue.totalScore >= 4) {
    return "medium";
  }

  return "high";
};

export function buildIssueProposalTable(repo: Repository, issues: ScoredIssue[]): string {
  if (issues.length === 0) {
    return "";
  }

  const rankedLines = issues.slice(0, 5).flatMap((issue, index) => [
    `[${index + 1}] #${issue.number}  ${issue.title}   (score: ${issue.totalScore})`,
    `    Complexity: ${estimateComplexity(issue)} | 👍 ${issue.reactions ?? 0} reactions`,
  ]);

  return [
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    `  TOP 5 FIXABLE ISSUES for ${repo.fullName}`,
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    ...rankedLines,
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    `Run 'gittributor fix' to fix issue #${issues[0].number}`,
  ].join("\n");
}

export function printIssueProposalTable(repo: Repository, issues: ScoredIssue[]): void {
  const table = buildIssueProposalTable(repo, issues);
  if (!table) {
    return;
  }

  log(table);
}

export async function discoverIssues(repo: Repository): Promise<ScoredIssue[]> {
  info(`Discovering issues for ${repo.fullName}...`);
  const githubClient = new GitHubClient();
  const [issues, fileTree] = await Promise.all([
    githubClient.searchIssues(repo.fullName, {
      labels: ISSUE_LABELS,
      limit: ISSUE_SEARCH_LIMIT,
    }),
    githubClient.getFileTree(repo.fullName),
  ]);

  const filtered = issues.filter((issue) => {
    const isUnassigned = issue.assignees.length === 0;
    return isUnassigned && isNotStale(issue) && hasClearDescription(issue);
  });

  const scored = filtered
    .map((issue) => {
      const approachabilityScore = scoreApproachability(issue);
      const impactScore = scoreImpact(issue);
      const codebaseScore = scoreWithCodebase(issue, fileTree);

      return {
        ...issue,
        approachabilityScore,
        impactScore,
        codebaseScore,
        totalScore: approachabilityScore + impactScore + codebaseScore,
      };
    })
    .sort((left, right) => {
      if (right.totalScore !== left.totalScore) {
        return right.totalScore - left.totalScore;
      }

      return left.number - right.number;
    });

  await persistIssues(scored);
  debug(`Discovered ${scored.length} actionable issue(s) for ${repo.fullName}.`);
  return scored;
}

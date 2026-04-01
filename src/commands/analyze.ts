import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { GitHubClient } from "../lib/github";
import { debug, info } from "../lib/logger";
import type { Issue, Repository } from "../types";

const ISSUE_LABELS = ["good first issue", "good-first-issue", "beginner", "help wanted"];
const ISSUE_SEARCH_LIMIT = 50;
const THIRTY_DAYS_IN_MS = 30 * 24 * 60 * 60 * 1000;

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

const IMPACT_PATTERNS = [
  /\bcrash(es|ed|ing)?\b/i,
  /\bdata[\s-]loss\b/i,
  /\bsecurity\b/i,
  /\bvulnerabilit(y|ies)\b/i,
  /\bregression\b/i,
  /\bmemory[\s-]leak\b/i,
  /\bcorrupt(s|ed|ion)?\b/i,
  /\bbroken\b/i,
];

type IssueWithOptionalUpdatedAt = Issue & {
  updatedAt?: string;
};

export type ScoredIssue = Issue & {
  approachabilityScore: number;
  impactScore: number;
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

  return Date.now() - updatedAtMs <= THIRTY_DAYS_IN_MS;
};

const hasClearDescription = (issue: Issue): boolean => {
  const body = issue.body ?? "";
  return body.trim().length > 50;
};

/**
 * Scores issue approachability using deterministic rules:
 * - clear reproduction steps in body (+2)
 * - small file scope mentioned (+2)
 * - test file mentioned (+1)
 * - single-file fix likely (+3)
 */
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

/**
 * Scores issue impact using deterministic keyword rules (no AI tokens):
 * - crash/data-loss/security/vulnerability (+3 each)
 * - regression/memory-leak/corrupt/broken (+2 each)
 * Checks both title and body.
 */
const scoreImpact = (issue: Issue): number => {
  const source = `${issue.title} ${issue.body ?? ""}`;
  let score = 0;

  for (const pattern of IMPACT_PATTERNS) {
    if (pattern.test(source)) {
      if (/crash|data[\s-]loss|security|vulnerabilit/.test(pattern.source)) {
        score += 3;
      } else {
        score += 2;
      }
    }
  }

  return score;
};

const persistIssues = async (issues: ScoredIssue[]): Promise<void> => {
  const outputDirectory = join(process.cwd(), ".gittributor");
  const outputPath = join(outputDirectory, "issues.json");

  await mkdir(outputDirectory, { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(issues, null, 2)}\n`, "utf8");
};

export async function discoverIssues(repo: Repository): Promise<ScoredIssue[]> {
  info(`Discovering issues for ${repo.fullName}...`);
  const githubClient = new GitHubClient();
  const issues = await githubClient.searchIssues(repo.fullName, {
    labels: ISSUE_LABELS,
    limit: ISSUE_SEARCH_LIMIT,
  });

  const filtered = issues.filter((issue) => {
    const isUnassigned = issue.assignees.length === 0;

    return isUnassigned && isNotStale(issue) && hasClearDescription(issue);
  });

  const scored = filtered
    .map((issue) => {
      const approachabilityScore = scoreApproachability(issue);
      const impactScore = scoreImpact(issue);
      return {
        ...issue,
        approachabilityScore,
        impactScore,
        totalScore: approachabilityScore + impactScore,
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

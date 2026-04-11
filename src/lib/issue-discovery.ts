import { GitHubClient } from "./github.js";
import type { Issue, Repository, ScoredIssue } from "../types/index.js";
export type { ScoredIssue };

export const REPRODUCTION_PATTERNS = [
  /steps to reproduce/i,
  /reproduc(e|ible|tion)/i,
  /how to reproduce/i,
  /minimal repro/i,
];

export const SMALL_SCOPE_PATTERNS = [
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

export const IMPACT_PATTERNS = [
  /\bcrash(es|ing)?\b/i,
  /\bcritical\b/i,
  /\bsecurity\b/i,
  /\bvulnerabilit/i,
  /\bregression\b/i,
  /\bdata\s+loss\b/i,
  /\bcorrupt/i,
  /\bbreaking\s+change\b/i,
  /\bproduction\b/i,
  /\bsevere\b/i,
];


const SIX_MONTHS_IN_MS = 180 * 24 * 60 * 60 * 1000;

const hasPatternMatch = (source: string, patterns: RegExp[]): boolean => {
  return patterns.some((pattern) => pattern.test(source));
};

const getIssueAgeMs = (issue: Issue): number => {
  const updatedAt = issue.updatedAt ?? issue.createdAt;
  const updatedAtMs = Date.parse(updatedAt);
  if (!Number.isFinite(updatedAtMs)) {
    return Infinity;
  }
  return Date.now() - updatedAtMs;
};

const scoreLabel = (labels: string[]): number => {
  const normalized = labels.map((l) => l.toLowerCase().replace(/\s+/g, "-"));
  if (normalized.some((l) => l.includes("security"))) return 40;
  if (normalized.includes("bug")) return 30;
  if (normalized.some((l) => l === "good-first-issue" || l === "good first issue")) return 20;
  if (normalized.some((l) => l === "help-wanted" || l === "help wanted")) return 15;
  if (normalized.includes("enhancement")) return 10;
  return 0;
};

const scoreAge = (issue: Issue): number => {
  const ageMs = getIssueAgeMs(issue);
  if (ageMs >= SIX_MONTHS_IN_MS) return -1;
  const ageDays = ageMs / (24 * 60 * 60 * 1000);
  if (ageDays < 7) return 20;
  if (ageDays < 30) return 15;
  if (ageDays < 90) return 10;
  return 5;
};

const scoreComments = (commentsCount: number | undefined): number => {
  if (commentsCount === undefined || commentsCount === 0) return 15;
  if (commentsCount <= 3) return 10;
  if (commentsCount <= 9) return 5;
  return -1;
};

const hasLinkedPR = (issue: Issue): boolean => {
  if (issue.pullRequest === true) return true;
  if (issue.body && /PR\s+#\d+/i.test(issue.body)) return true;
  return false;
};

export function scoreIssue(issue: Issue): ScoredIssue | null {
  if (issue.assignees.length > 0) return null;
  if (hasLinkedPR(issue)) return null;

  const ageScore = scoreAge(issue);
  if (ageScore < 0) return null;

  const commentsCount = issue.commentsCount;
  const commentScore = scoreComments(commentsCount);
  if (commentScore < 0) return null;

  const labelScore = scoreLabel(issue.labels);
  const body = issue.body ?? "";
  const text = `${issue.title}\n${body}`;

  const approachabilityBonus =
    (hasPatternMatch(body, REPRODUCTION_PATTERNS) ? 15 : 0) +
    (hasPatternMatch(body, SMALL_SCOPE_PATTERNS) ? 10 : 0);
  const impactBonus = hasPatternMatch(text, IMPACT_PATTERNS) ? 20 : 0;

  const approachabilityScore = labelScore + commentScore + approachabilityBonus;
  const impactScore = ageScore + impactBonus;
  const totalScore = approachabilityScore + impactScore;

  return {
    ...issue,
    approachabilityScore,
    impactScore,
    totalScore,
  };
}

async function fetchIssuesByLabels(
  client: GitHubClient,
  repoFullName: string,
  labelList: string[],
  limit: number,
): Promise<Issue[]> {
  return client.searchIssues(repoFullName, { labels: labelList, limit });
}

export async function discoverIssues(repo: Repository): Promise<ScoredIssue[]> {
  const client = new GitHubClient();

  let primaryIssues: Issue[] = [];
  let secondaryIssues: Issue[] = [];

  try {
    [primaryIssues, secondaryIssues] = await Promise.all([
      fetchIssuesByLabels(client, repo.fullName, ["bug", "good-first-issue"], 50),
      fetchIssuesByLabels(client, repo.fullName, ["help-wanted", "enhancement", "hacktoberfest"], 50),
    ]);
  } catch {
    return [];
  }

  const seen = new Set<number>();
  const uniqueIssues: Issue[] = [];

  for (const issue of [...primaryIssues, ...secondaryIssues]) {
    if (!seen.has(issue.number)) {
      seen.add(issue.number);
      uniqueIssues.push(issue);
    }
  }

  const scored = uniqueIssues
    .map((issue) => scoreIssue(issue))
    .filter((s): s is ScoredIssue => s !== null)
    .sort((left, right) => {
      if (right.totalScore !== left.totalScore) {
        return right.totalScore - left.totalScore;
      }
      return left.number - right.number;
    });

  return scored.slice(0, 3);
}

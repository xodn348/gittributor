import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { debug, info, warn } from "./logger.js";
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

const scoreBugType = (issue: Issue): number => {
  const text = `${issue.title}\n${issue.body ?? ""}`.toLowerCase();

  const nullNpePattern = /\b(null|npe|nullpointer|null pointer|undefined|nil)\b/i;
  if (nullNpePattern.test(text)) return 40;

  const leakPattern = /\b(memory leak|resource leak|leak|garbage collection|gc pressure)\b/i;
  if (leakPattern.test(text)) return 30;

  const typePattern = /\b(type error|type mismatch|typescript error|type safety)\b/i;
  if (typePattern.test(text)) return 20;

  const logicPattern = /\b(logic error|logical bug|incorrect|business logic)\b/i;
  if (logicPattern.test(text)) return 10;

  const enhancementPattern = /\b(enhancement|improvement|feature request|refactor)\b/i;
  if (enhancementPattern.test(text)) return 0;

  return 0;
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
  const bugTypeScore = scoreBugType(issue);
  const body = issue.body ?? "";
  const text = `${issue.title}\n${body}`;

  const approachabilityBonus =
    (hasPatternMatch(body, REPRODUCTION_PATTERNS) ? 15 : 0) +
    (hasPatternMatch(body, SMALL_SCOPE_PATTERNS) ? 10 : 0);
  const impactBonus = hasPatternMatch(text, IMPACT_PATTERNS) ? 20 : 0;

  const approachabilityScore = labelScore + commentScore + approachabilityBonus + bugTypeScore;
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
  info(`Discovering issues for ${repo.fullName}...`);
  const scored = await discoverIssuesCore(repo);
  await persistIssues(scored);
  printProposalTable(scored);
  debug(`Discovered ${scored.length} actionable issue(s) for ${repo.fullName}.`);
  return scored;
}

async function persistIssues(issues: ScoredIssue[]): Promise<void> {
  const outputDirectory = join(process.cwd(), ".gittributor");
  const outputPath = join(outputDirectory, "issues.json");

  await mkdir(outputDirectory, { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(issues, null, 2)}\n`, "utf8");
}

let lastPrintedProposalTable = "";

const getProposalTableLines = (issues: ScoredIssue[]): string[] => {
  const top = issues.slice(0, 5);

  if (top.length === 0) {
    return ["No actionable issues found."];
  }

  const separator = "─".repeat(80);
  const lines = [separator, "  PROPOSED ISSUES (top scored — ready for analysis)", separator];

  for (const issue of top) {
    const scoreLabel = `score ${issue.totalScore}`;
    const truncatedTitle = issue.title.length > 50 ? `${issue.title.slice(0, 47)}...` : issue.title;
    lines.push(`  #${String(issue.number).padEnd(6)} [${scoreLabel.padEnd(8)}] ${truncatedTitle}`);
    lines.push(`           ${issue.url}`);
  }

  lines.push(separator);
  return lines;
};

const printProposalTable = (issues: ScoredIssue[]): void => {
  const table = getProposalTableLines(issues).join("\n");
  lastPrintedProposalTable = table;

  for (const line of table.split("\n")) {
    info(line);
  }
};

export function buildIssueProposalTable(repo: Repository, issues: ScoredIssue[]): string {
  void repo;
  return getProposalTableLines(issues).join("\n");
}

export function printIssueProposalTable(repo: Repository, issues: ScoredIssue[]): void {
  const table = buildIssueProposalTable(repo, issues);

  if (table === lastPrintedProposalTable) {
    lastPrintedProposalTable = "";
    return;
  }

  lastPrintedProposalTable = table;

  for (const line of table.split("\n")) {
    info(line);
  }
}

async function discoverIssuesCore(repo: Repository): Promise<ScoredIssue[]> {
  const client = new GitHubClient();

  let allIssues: Issue[] = [];

  try {
    allIssues = await fetchIssuesByLabels(
      client,
      repo.fullName,
      ["bug", "good-first-issue", "help-wanted", "enhancement", "hacktoberfest"],
      50,
    );
  } catch (err) {
    warn(`[ISSUE DISCOVERY ERROR] ${String(err)}`);
    return [];
  }

  const scored = allIssues
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

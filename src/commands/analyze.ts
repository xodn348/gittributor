import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { debug, info } from "../lib/logger.js";
import { discoverIssues as discoverIssuesCore, type ScoredIssue } from "../lib/issue-discovery.js";
import type { Repository } from "../types/index.js";

export type { ScoredIssue };

const persistIssues = async (issues: ScoredIssue[]): Promise<void> => {
  const outputDirectory = join(process.cwd(), ".gittributor");
  const outputPath = join(outputDirectory, "issues.json");

  await mkdir(outputDirectory, { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(issues, null, 2)}\n`, "utf8");
};

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

  for (const line of table.split("\n")) {
    info(line);
  }
}

export async function discoverIssues(repo: Repository): Promise<ScoredIssue[]> {
  info(`Discovering issues for ${repo.fullName}...`);
  const scored = await discoverIssuesCore(repo);
  await persistIssues(scored);
  printProposalTable(scored);
  debug(`Discovered ${scored.length} actionable issue(s) for ${repo.fullName}.`);
  return scored;
}

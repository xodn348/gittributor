import { existsSync, readFileSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "os";
import { GitHubClient } from "../lib/github.js";
import { debug, info } from "../lib/logger.js";
import { setStateData } from "../lib/state.js";
import { checkRepoEligibility } from "../lib/guardrails.js";
import { discoveryConfig } from "../lib/config.js";
import { discoverIssues as discoverIssuesCore, type ScoredIssue } from "../lib/issue-discovery.js";
import {
  detectTypos,
  detectDocs,
  detectDeps,
  detectTests,
  detectCode,
  calculateMergeProbability,
  sortOpportunities,
  cloneRepoShallow,
} from "../lib/contribution-detector.js";
import type { Repository, TrendingRepo, ContributionOpportunity } from "../types/index.js";

export type { ScoredIssue };

const MAX_REPOS = 10;

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

async function createTempRepoPath(repoFullName: string): Promise<string> {
  return join(tmpdir(), `gittributor-analyze-${repoFullName.replace("/", "-")}-${Date.now()}`);
}

export async function analyzeSingleRepo(repo: TrendingRepo): Promise<ContributionOpportunity[]> {
  const opportunities: ContributionOpportunity[] = [];
  const tempPath = await createTempRepoPath(repo.fullName);

  try {
    info(`Analyzing ${repo.fullName}...`);
    await cloneRepoShallow(repo.fullName, tempPath);

    const readmePath = join(tempPath, "README.md");
    const readmeContent = existsSync(readmePath) ? readFileSync(readmePath, "utf8") : "";

    const filePaths = existsSync(tempPath) ?
      [...readdirSync(tempPath).map((f: string) => join(tempPath, f))] : [];

    const typoResults = detectTypos(readmeContent);
    for (const typo of typoResults) {
      const opp: ContributionOpportunity = {
        repo,
        type: "typo",
        filePath: "README.md",
        description: `Fix typo: "${typo.original}" → "${typo.replacement}"`,
        original: typo.original,
        replacement: typo.replacement,
        mergeProbability: calculateMergeProbability({} as ContributionOpportunity, {
          hasTests: false,
          diffSize: 10,
          followsContributingGuide: repo.hasContributing,
          maintainerActivity: "high",
        }),
        detectedAt: new Date().toISOString(),
      };
      opportunities.push(opp);
    }

    const docsResults = detectDocs(readmeContent, filePaths, tempPath);
    for (const doc of docsResults) {
      const opp: ContributionOpportunity = {
        repo,
        type: "docs",
        filePath: doc.filePath,
        description: doc.description,
        section: doc.section,
        mergeProbability: calculateMergeProbability({} as ContributionOpportunity, {
          hasTests: false,
          diffSize: 50,
          followsContributingGuide: repo.hasContributing,
          maintainerActivity: "medium",
        }),
        detectedAt: new Date().toISOString(),
      };
      opportunities.push(opp);
    }

    const depsResults = await detectDeps(tempPath);
    for (const dep of depsResults) {
      const opp: ContributionOpportunity = {
        repo,
        type: "deps",
        filePath: dep.packageName,
        description: dep.description,
        packageName: dep.packageName,
        oldVersion: dep.oldVersion,
        newVersion: dep.newVersion,
        mergeProbability: calculateMergeProbability({} as ContributionOpportunity, {
          hasTests: false,
          diffSize: 30,
          followsContributingGuide: repo.hasContributing,
          maintainerActivity: "medium",
        }),
        detectedAt: new Date().toISOString(),
      };
      opportunities.push(opp);
    }

    const testResults = detectTests(tempPath);
    for (const test of testResults) {
      const opp: ContributionOpportunity = {
        repo,
        type: "test",
        filePath: test.filePath,
        description: test.description,
        mergeProbability: calculateMergeProbability({} as ContributionOpportunity, {
          hasTests: true,
          diffSize: 100,
          followsContributingGuide: repo.hasContributing,
          maintainerActivity: "medium",
        }),
        detectedAt: new Date().toISOString(),
      };
      opportunities.push(opp);
    }

    const githubClient = new GitHubClient();
    const labels = discoveryConfig.issueLabels.split(",").map((l) => l.trim()).filter(Boolean);
    const issues = await githubClient.searchIssues(repo.fullName, {
      labels,
      limit: 50,
    });
    const codeResults = await detectCode(repo, issues);
    for (const code of codeResults) {
      const opp: ContributionOpportunity = {
        repo,
        type: "code",
        filePath: "",
        description: code.description,
        mergeProbability: code.mergeProbability,
        detectedAt: new Date().toISOString(),
      };
      opportunities.push(opp);
    }

  } catch (error) {
    debug(`Error analyzing ${repo.fullName}: ${error}`);
  } finally {
    try {
      rmSync(tempPath, { recursive: true, force: true });
    } catch {
      // intentionally ignored
    }
  }

  return sortOpportunities(opportunities);
}

export async function analyzeRepositories(repos: TrendingRepo[]): Promise<ContributionOpportunity[]> {
  const allOpportunities: ContributionOpportunity[] = [];
  const eligibleRepos = repos.slice(0, MAX_REPOS);

  for (const repo of eligibleRepos) {
    const eligibility = checkRepoEligibility(repo.isArchived, repo.stars);
    if (!eligibility.passed) {
      debug(`Skipping ${repo.fullName}: ${eligibility.reason}`);
      continue;
    }

    const opportunities = await analyzeSingleRepo(repo);
    allOpportunities.push(...opportunities);
  }

  const sorted = sortOpportunities(allOpportunities);

  await setStateData("contributionOpportunities", sorted);
  info(`Found ${sorted.length} contribution opportunities across ${eligibleRepos.length} repositories.`);

  return sorted;
}

function readdirSync(path: string) {
  const fs = require("fs");
  return fs.readdirSync(path);
}

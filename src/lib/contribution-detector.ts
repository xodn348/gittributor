import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { mkdirSync } from "node:fs";
import type { ContributionOpportunity, ContributionType, MergeProbability, TrendingRepo, Issue } from "../types/index.js";
import { GitHubClient } from "./github.js";

export async function cloneRepoShallow(repoFullName: string, targetPath: string): Promise<void> {
  mkdirSync(targetPath, { recursive: true });

  const proc = Bun.spawn({
    cmd: ["gh", "repo", "clone", repoFullName, targetPath, "--", "--depth", "1"],
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(`Failed to clone ${repoFullName}: ${stderr}`);
  }
}

const COMMON_MISPELLINGS: Record<string, string> = {
  teh: "the",
  recieve: "receive",
  occuring: "occurring",
  accomodate: "accommodate",
  independant: "independent",
  responsiblity: "responsibility",
  definately: "definitely",
  seperately: "separately",
  freind: "friend",
  wierd: "weird",
  thier: "their",
  alot: "a lot",
  lenght: "length",
  untill: "until",
  begining: "beginning",
  calulated: "calculated",
  hte: "the",
  htis: "this",
  taht: "that",
};

const SUPPORTED_SOURCE_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|java|rb|rs|c|cpp|cs|php|swift|kt)$/;
const TEST_FILE_PATTERNS = [
  /\.test\.([jt]sx?|ts|js)$/,
  /\.spec\.([jt]sx?|ts|js)$/,
  /\/tests\//,
  /\/__tests__\//,
  /\/test\//,
];

const DOC_SECTIONS = ["Installation", "Usage", "Contributing", "License"];

export interface TypoResult {
  filePath: string;
  original: string;
  replacement: string;
  context: string;
}

export interface DocResult {
  filePath: string;
  section?: string;
  description: string;
}

export interface DepResult {
  packageName: string;
  oldVersion: string;
  newVersion: string;
  description: string;
}

export interface TestResult {
  filePath: string;
  description: string;
}

export interface CodeResult {
  issue: Issue;
  label: string;
}

function scanFileForTypos(filePath: string, content: string): TypoResult[] {
  const results: TypoResult[] = [];
  const lowerContent = content.toLowerCase();

  for (const [misspelling, correction] of Object.entries(COMMON_MISPELLINGS)) {
    const regex = new RegExp(`\\b${misspelling}\\b`, "gi");
    let match: RegExpExecArray | null = regex.exec(content);
    while (match !== null) {
      const start = Math.max(0, match.index - 30);
      const end = Math.min(content.length, match.index + misspelling.length + 30);
      results.push({
        filePath,
        original: misspelling,
        replacement: correction,
        context: content.slice(start, end).replace(/\n/g, " "),
      });
      match = regex.exec(content);
    }
  }

  return results;
}

export function detectTypos(content: string): TypoResult[] {
  if (!content || content.trim().length === 0) {
    return [];
  }

  const results: TypoResult[] = [];

  for (const [misspelling, correction] of Object.entries(COMMON_MISPELLINGS)) {
    const regex = new RegExp(`\\b${misspelling}\\b`, "gi");
    let match: RegExpExecArray | null = regex.exec(content);
    while (match !== null) {
      results.push({
        filePath: "",
        original: misspelling,
        replacement: correction,
        context: content.slice(Math.max(0, match.index - 20), match.index + misspelling.length + 20),
      });
      match = regex.exec(content);
    }
  }

  return results;
}

export async function detectTyposInRepo(repoPath: string): Promise<TypoResult[]> {
  const results: TypoResult[] = [];
  const mdExtensions = [".md", ".markdown"];

  const scanDirectory = (dirPath: string): void => {
    if (!existsSync(dirPath)) return;

    const entries = readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = `${dirPath}/${entry.name}`;
      if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
        scanDirectory(fullPath);
      } else if (entry.isFile()) {
        const ext = entry.name.includes(".") ? `.${entry.name.split(".").pop()}` : "";
        if (mdExtensions.includes(ext.toLowerCase()) || entry.name.toLowerCase().includes("readme")) {
          try {
            const content = readFileSync(fullPath, "utf8");
            const fileResults = scanFileForTypos(fullPath, content);
            results.push(...fileResults);
          } catch {
            // intentionally ignored
          }
        }
      }
    }
  };

  scanDirectory(repoPath);
  return results;
}

export function detectDocs(readmeContent: string, readmePaths: string[], repoPath: string): DocResult[] {
  const results: DocResult[] = [];

  const missingSections: string[] = [];
  if (!readmeContent.includes("## Installation") && !readmeContent.includes("# Installation")) {
    missingSections.push("Installation");
  }
  if (!readmeContent.includes("## Usage") && !readmeContent.includes("# Usage")) {
    missingSections.push("Usage");
  }
  if (!readmeContent.includes("## Contributing") && !readmeContent.includes("# Contributing")) {
    missingSections.push("Contributing");
  }
  if (!readmeContent.includes("## License") && !readmeContent.includes("# License")) {
    missingSections.push("License");
  }

  for (const section of missingSections) {
    results.push({
      filePath: readmePaths[0] || "README.md",
      section,
      description: `Missing section: ${section}`,
    });
  }

  const docsDir = `${repoPath}/docs`;
  if (existsSync(docsDir)) {
    const docsEntries = readdirSync(docsDir);
    if (docsEntries.length === 0) {
      results.push({
        filePath: "docs/",
        description: "docs/ is empty",
      });
    }
  }

  return results;
}

export async function detectDeps(repoPath: string): Promise<DepResult[]> {
  const results: DepResult[] = [];

  const packageJsonPath = `${repoPath}/package.json`;
  if (existsSync(packageJsonPath)) {
    try {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
      const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies } as Record<string, string>;

      for (const [pkg, version] of Object.entries(dependencies)) {
        const latestVersion = await getNpmLatestVersion(pkg);
        if (latestVersion && isOutdated(version, latestVersion)) {
          results.push({
            packageName: pkg,
            oldVersion: version,
            newVersion: latestVersion,
            description: `Outdated dependency: ${pkg}@${version} -> ${latestVersion}`,
          });
        }
      }
    } catch {
      // intentionally ignored
    }
  }

  const requirementsPath = `${repoPath}/requirements.txt`;
  if (existsSync(requirementsPath)) {
    try {
      const requirements = readFileSync(requirementsPath, "utf8");
      const lines = requirements.split("\n");
      for (const line of lines) {
        const match = line.match(/^([a-zA-Z0-9_-]+)==([0-9.]+)$/);
        if (match) {
          const [, pkg, version] = match;
          const latestVersion = await getPyPiLatestVersion(pkg);
          if (latestVersion && isOutdated(version, latestVersion)) {
            results.push({
              packageName: pkg,
              oldVersion: version,
              newVersion: latestVersion,
              description: `Outdated dependency: ${pkg}==${version} -> ${latestVersion}`,
            });
          }
        }
      }
    } catch {
      // intentionally ignored
    }
  }

  return results;
}

async function getNpmLatestVersion(packageName: string): Promise<string | null> {
  try {
    const proc = Bun.spawn({
      cmd: ["npm", "view", packageName, "version", "--json"],
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    if (proc.exitCode !== 0) return null;
    return stdout.trim().replace(/^"|"$/g, "");
  } catch {
    return null;
  }
}

async function getPyPiLatestVersion(packageName: string): Promise<string | null> {
  try {
    const proc = Bun.spawn({
      cmd: ["pip", "index", "versions", packageName],
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    if (proc.exitCode !== 0) return null;
    const match = stdout.match(/Available versions: ([0-9.]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function isOutdated(current: string, latest: string): boolean {
  const currentParts = current.replace(/[\^~>=<]/g, "").split(".").map(Number);
  const latestParts = latest.split(".").map(Number);

  for (let i = 0; i < Math.max(currentParts.length, latestParts.length); i++) {
    const cur = currentParts[i] || 0;
    const lat = latestParts[i] || 0;
    if (lat > cur) return true;
    if (lat < cur) return false;
  }
  return false;
}

export function detectTests(repoPath: string): TestResult[] {
  const results: TestResult[] = [];

  const findSourceFiles = (dirPath: string): string[] => {
    const sources: string[] = [];
    if (!existsSync(dirPath)) return sources;

    const entries = readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = `${dirPath}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".") && entry.name !== "node_modules") {
          sources.push(...findSourceFiles(fullPath));
        }
      } else if (SUPPORTED_SOURCE_EXTENSIONS.test(entry.name)) {
        sources.push(fullPath);
      }
    }
    return sources;
  };

  const findAllFiles = (dirPath: string): string[] => {
    const files: string[] = [];
    if (!existsSync(dirPath)) return files;

    const entries = readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = `${dirPath}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".") && entry.name !== "node_modules") {
          files.push(...findAllFiles(fullPath));
        }
      } else {
        files.push(fullPath);
      }
    }
    return files;
  };

  const sourceFiles = findSourceFiles(repoPath);
  const allFiles = findAllFiles(repoPath);
  const sourceFilesWithoutTests: string[] = [];

  for (const sourceFile of sourceFiles) {
    const sourceFileName = sourceFile.split("/").pop() || "";
    const baseName = sourceFileName.replace(/\.(ts|tsx|js|jsx|mjs|cjs|py|go|java|rb|rs|c|cpp|cs|php|swift|kt)$/, "");

    const hasTest = allFiles.some((file) => {
      const fileName = file.split("/").pop() || "";
      const testFileName = fileName.replace(/\.(ts|tsx|js|jsx|mjs|cjs|py|go|java|rb|rs|c|cpp|cs|php|swift|kt)$/, "");
      const hasTestPattern = TEST_FILE_PATTERNS.some((pattern) => pattern.test(file));
      return hasTestPattern && (testFileName === baseName);
    });

    if (!hasTest) {
      sourceFilesWithoutTests.push(sourceFile);
    }
  }

  for (const file of sourceFilesWithoutTests) {
    results.push({
      filePath: file.replace(`${repoPath}/`, ""),
      description: `Source file without test: ${file}`,
    });
  }

  return results;
}

const CODE_ISSUE_LABELS = ["good first issue", "good-first-issue", "help wanted", "bug", "beginner"];

export async function detectCodeIssues(repoFullName: string, labels?: string[]): Promise<CodeResult[]> {
  const results: CodeResult[] = [];
  const searchLabels = labels || CODE_ISSUE_LABELS;

  try {
    const client = new GitHubClient();
    const issues = await client.searchIssues(repoFullName, { labels: searchLabels, limit: 30 });

    for (const issue of issues) {
      if (issue.assignees.length === 0) {
        results.push({
          issue,
          label: issue.labels[0] || "open",
        });
      }
    }
  } catch {
    // intentionally ignored
  }

  return results;
}

export async function detectCode(
  repo: TrendingRepo,
  issues: Array<{ number: number; title: string; labels: string[]; assignees: string[] }>
): Promise<ContributionOpportunity[]> {
  const results: ContributionOpportunity[] = [];

  for (const issue of issues) {
    if (issue.assignees.length > 0) continue;

    const priorityLabels = ["good first issue", "good-first-issue", "help wanted", "bug"];
    const hasPriorityLabel = issue.labels.some((l) =>
      priorityLabels.some((pl) => l.toLowerCase().includes(pl.toLowerCase()))
    );

    results.push({
      repo,
      type: "code",
      filePath: "",
      description: issue.title,
      mergeProbability: {
        score: hasPriorityLabel ? 0.7 : 0.4,
        label: hasPriorityLabel ? "high" : "medium",
        reasons: [`Issue #${issue.number} with label: ${issue.labels[0] || "open"}`],
      },
      detectedAt: new Date().toISOString(),
    });
  }

  return results;
}

export function calculateMergeProbability(
  opportunity: ContributionOpportunity,
  factors: {
    hasTests: boolean;
    diffSize: number;
    followsContributingGuide: boolean;
    maintainerActivity: "high" | "medium" | "low";
  }
): MergeProbability {
  let score = 0;
  const reasons: string[] = [];

  const typeWeights: Record<ContributionType, number> = {
    typo: 0.9,
    docs: 0.85,
    deps: 0.7,
    test: 0.75,
    code: 0.6,
    "bug-fix": 0.7,
    performance: 0.65,
    "type-safety": 0.75,
    "logic-error": 0.7,
    "static-analysis": 0.65,
  };

  score += typeWeights[opportunity.type] * 0.3;

  if (factors.diffSize < 100) {
    score += 0.2;
    reasons.push("Small diff size increases merge likelihood");
  } else if (factors.diffSize < 500) {
    score += 0.1;
  }

  if (factors.hasTests) {
    score += 0.15;
    reasons.push("Has tests for the change");
  }

  if (factors.followsContributingGuide) {
    score += 0.15;
    reasons.push("Follows contributing guidelines");
  }

  if (factors.maintainerActivity === "high") {
    score += 0.15;
    reasons.push("Maintainers are active");
  } else if (factors.maintainerActivity === "medium") {
    score += 0.08;
  }

  if (opportunity.repo.hasContributing) {
    score += 0.1;
    reasons.push("Repository has CONTRIBUTING guide");
  }

  score = Math.min(1, Math.max(0, score));

  const label = score >= 0.7 ? "high" : score >= 0.4 ? "medium" : "low";

  return {
    score,
    label,
    reasons: reasons.length > 0 ? reasons : ["Standard contribution"],
  };
}

export function sortOpportunities(opportunities: ContributionOpportunity[]): ContributionOpportunity[] {
  return [...opportunities].sort((a, b) => {
    if (b.mergeProbability.score !== a.mergeProbability.score) {
      return b.mergeProbability.score - a.mergeProbability.score;
    }
    return a.repo.fullName.localeCompare(b.repo.fullName);
  });
}

export function sortOpportunitiesByMergeProbability(opportunities: ContributionOpportunity[]): ContributionOpportunity[] {
  return sortOpportunities(opportunities);
}
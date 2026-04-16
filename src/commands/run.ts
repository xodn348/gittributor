import { existsSync } from "node:fs";
import { join } from "node:path";
import { getHistoryStats } from "../lib/history.js";
import { resetState } from "../lib/state.js";
import { debug, error as logError, warn } from "../lib/logger.js";
import { loadConfig, getTargetLanguages } from "../lib/config.js";
import { getGlobalWeeklyCount, MAX_GLOBAL_WEEKLY } from "../lib/guardrails.js";
import { createBranchWithToken, commitFilesWithToken, createPullRequestWithToken, GitHubAPIError } from "../lib/github.js";
import { discoverIssues } from "../lib/issue-discovery.js";
import type { AnalysisResult, Config, ContributionType, Issue, Repository, TrendingRepo } from "../types/index.js";
import type { FixResult as GeneratedFixResult } from "../lib/fix-generator.js";

const VALID_TYPES: readonly ContributionType[] = ["bug-fix", "performance", "type-safety", "logic-error", "static-analysis"];

export interface RunOptions {
  dryRun?: boolean;
  stats?: boolean;
  type?: ContributionType | null;
  language?: string;
}

export interface RunDependencies {
  loadConfig?: () => Promise<Config>;
  discoverRepos: (options: Record<string, unknown>) => Promise<TrendingRepo[]>;
  discoverIssues?: (repo: Repository) => Promise<Issue[]>;
  analyzeCodebase: (repo: Repository, issue?: Issue) => Promise<AnalysisResult>;
  generateFix: (analysis: AnalysisResult, issue: Issue, repo: Repository) => Promise<GeneratedFixResult>;
  reviewFix: (options?: { autoApprove?: boolean }) => Promise<number>;
  submitApprovedFix: (options?: Record<string, unknown>) => Promise<number>;
  showHistoryStats?: (path: string, options?: { stdout?: WritableLike }) => Promise<void>;
}

interface WritableLike {
  write: (chunk: string) => boolean;
}

interface FixChange {
  file: string;
  original: string;
  modified: string;
}

interface PersistedFixPayload {
  changes: FixChange[];
  explanation: string;
}

const shortDescription = (text: string): string => {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "apply approved fix";
  }
  return normalized.length > 72 ? `${normalized.slice(0, 69)}...` : normalized;
};

const slugify = (text: string): string => {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
};

const extractRepoOwner = (repoUrl: string): string => {
  const match = repoUrl.match(/^https:\/\/github\.com\/([^/]+)\/[^/\s]+\/?$/);
  if (!match) {
    throw new Error(`Unexpected fork URL format: ${repoUrl}`);
  }
  return match[1];
};

const extractGitHubUrl = (payload: string): string => {
  const urlMatch = payload.match(/https:\/\/github\.com\/\S+/);
  if (!urlMatch) {
    throw new Error("Fork did not return a GitHub URL");
  }
  return urlMatch[0].trim();
};

const loadPersistedFixPayload = async (): Promise<PersistedFixPayload> => {
  const filePath = join(process.cwd(), ".gittributor", "fix.json");
  const content = await Bun.file(filePath).json();
  const record = content as Record<string, unknown>;
  const changes = Array.isArray(record.changes)
    ? record.changes
        .map((entry) => {
          if (typeof entry !== "object" || entry === null) {
            return null;
          }
          const change = entry as Record<string, unknown>;
          if (
            typeof change.file !== "string" ||
            typeof change.original !== "string" ||
            typeof change.modified !== "string"
          ) {
            return null;
          }
          return { file: change.file, original: change.original, modified: change.modified };
        })
        .filter((entry): entry is FixChange => entry !== null)
    : [];
  return { changes, explanation: typeof record.explanation === "string" ? record.explanation : "" };
};

const countLinesChanged = (original: string, modified: string): number => {
  const originalLines = original.split("\n").length;
  const modifiedLines = modified.split("\n").length;
  return Math.abs(modifiedLines - originalLines) + Math.min(originalLines, modifiedLines);
};

const isDryRun = (): boolean => {
  return Bun.env.GITTRIBUTOR_DRY_RUN === "true";
};

const getGitHubToken = (): string | undefined => {
  const envToken = Bun.env.GITHUB_TOKEN?.trim();
  if (envToken) {
    return envToken;
  }
  try {
    const result = Bun.spawnSync(["gh", "auth", "token"]);
    if (result.exitCode === 0) {
      const token = result.stdout.toString().trim();
      if (token) return token;
    }
  } catch {
    // gh not installed or spawn failed — fall through to undefined
  }
  return undefined;
};

const submitPRForResult = async (
  syntheticIssue: Issue,
  repoFullName: string,
  analysis: AnalysisResult,
): Promise<boolean> => {
  const dryRun = isDryRun();
  const token = getGitHubToken();

  if (!token) {
    warn("GITHUB_TOKEN not set. Skipping PR submission.");
    return false;
  }

  const fixPayload = await loadPersistedFixPayload();
  const fileCount = fixPayload.changes.length;
  const totalLinesChanged = fixPayload.changes.reduce(
    (acc, change) => acc + countLinesChanged(change.original, change.modified),
    0,
  );

  if (fileCount > 5 || totalLinesChanged > 200) {
    warn(`Skipping ${repoFullName}: fix too large for automated PR (${fileCount} files, ${totalLinesChanged} LOC).`);
    return false;
  }

  const isSynthetic = syntheticIssue.number === 0;
  const branchName = isSynthetic
    ? `gittributor/fix-${slugify(syntheticIssue.title || syntheticIssue.body?.slice(0, 30) || "issue")}`
    : `gittributor/fix-${syntheticIssue.number}`;

  const prTitle = isSynthetic
    ? shortDescription(analysis.suggestedApproach)
    : `fix(#${syntheticIssue.number}): ${shortDescription(syntheticIssue.title)}`;

  const changedFiles = fixPayload.changes.map((c) => `- \`${c.file}\``).join("\n");
  const prBodyLines = [
    "## Summary",
    shortDescription(fixPayload.explanation),
    "",
    "## Changes",
    changedFiles,
  ];
  if (!isSynthetic && syntheticIssue.number > 0) {
    prBodyLines.push("");
    prBodyLines.push(`Fixes #${syntheticIssue.number}`);
  }
  prBodyLines.push("");
  prBodyLines.push("## Verification");
  prBodyLines.push("Run `bun test` to verify all tests pass.");
  prBodyLines.push("Run `bun run typecheck` to verify TypeScript compiles.");

  const prBody = prBodyLines.join("\n");

  if (dryRun) {
    process.stdout.write(`[DRY RUN] Would create PR: ${prTitle} on ${repoFullName}\n`);
    process.stdout.write(`[DRY RUN] Files: ${fixPayload.changes.map((c) => c.file).join(", ")}\n`);
    process.stdout.write(`[DRY RUN] Verification: run \`bun test\` and \`bun run typecheck\` before submitting.\n`);
    return true;
  }

  try {
    const forkOutput = await runCommand(["gh", "repo", "fork", repoFullName, "--clone=false"]);
    const forkUrl = extractGitHubUrl(forkOutput);
    const forkOwner = extractRepoOwner(forkUrl);

    await createBranchWithToken(token, forkUrl.replace("https://github.com/", ""), branchName, "main");

    const commitMessage = `fix: ${shortDescription(syntheticIssue.title || fixPayload.explanation)}`;
    const files = fixPayload.changes.map((change) => ({
      path: change.file,
      content: change.modified,
      message: commitMessage,
    }));
    await commitFilesWithToken(token, forkUrl.replace("https://github.com/", ""), branchName, files);

    await createPullRequestWithToken(token, {
      upstreamRepo: repoFullName,
      head: `${forkOwner}:${branchName}`,
      title: prTitle,
      body: prBody,
    });

    debug(`[run] PR created for ${repoFullName} — verification: bun test && bun run typecheck`);
    process.stdout.write(`Submitted PR: ${prTitle}\n`);
    return true;
  } catch (err) {
    if (err instanceof GitHubAPIError && err.message.includes("[RATE LIMIT]")) {
      process.stdout.write(`${err.message}\n`);
      return false;
    }
    const msg = err instanceof Error ? err.message : String(err);
    warn(`PR submission failed for ${repoFullName}: ${msg}`);
    return false;
  }
};

const runCommand = async (cmd: string[]): Promise<string> => {
  const proc = Bun.spawn({ cmd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`Command failed: ${cmd.join(" ")} (exit ${exitCode}) ${stderr.trim()}`);
  }
  return stdout;
};

export async function showHistoryStats(
  historyPath: string,
  options: { stdout?: WritableLike } = {},
): Promise<void> {
  const stdout = options.stdout ?? {
    write(chunk: string): boolean {
      process.stdout.write(chunk);
      return true;
    },
  };
  if (!existsSync(historyPath)) {
    stdout.write("(No history found)\n");
    return;
  }
  try {
    const stats = await getHistoryStats(historyPath);
    stdout.write("\n═══════════════════════════════════════════\n");
    stdout.write("CONTRIBUTION HISTORY\n");
    stdout.write("═══════════════════════════════════════════\n");
    stdout.write("Total contributions: " + stats.total + "\n");
    stdout.write("Merge rate: " + (stats.mergeRate * 100).toFixed(1) + "%\n");
    stdout.write("\nBy status:\n");
    for (const [status, count] of Object.entries(stats.byStatus)) {
      stdout.write("  " + status + ": " + count + "\n");
    }
    stdout.write("\nBy type:\n");
    for (const [type, count] of Object.entries(stats.byType)) {
      stdout.write("  " + type + ": " + count + "\n");
    }
    stdout.write("═══════════════════════════════════════════\n");
  } catch {
    stdout.write("(No history found)\n");
    return;
  }
}

const printStage = (emoji: string, message: string): void => {
  process.stdout.write(emoji + " " + message + "\n");
};

export function parseRunFlags(args: string[]): RunOptions {
  const options: RunOptions = {};
  for (const arg of args) {
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--stats") {
      options.stats = true;
    }
  }
  const typeIndex = args.indexOf("--type");
  if (typeIndex !== -1 && typeIndex + 1 < args.length) {
    const value = args[typeIndex + 1];
    if (VALID_TYPES.includes(value as ContributionType)) {
      options.type = value as ContributionType;
    } else {
      options.type = null;
    }
  } else {
    for (const arg of args) {
      if (arg.startsWith("--type=")) {
        const value = arg.slice("--type=".length);
        if (VALID_TYPES.includes(value as ContributionType)) {
          options.type = value as ContributionType;
        } else {
          options.type = null;
        }
        break;
      }
    }
  }
  const languageIndex = args.indexOf("--language");
  if (languageIndex !== -1 && languageIndex + 1 < args.length) {
    const value = args[languageIndex + 1];
    if (value && value.trim() !== "") {
      options.language = value;
    }
  } else {
    for (const arg of args) {
      if (arg.startsWith("--language=")) {
        const value = arg.slice("--language=".length);
        if (value && value.trim() !== "") {
          options.language = value;
        }
        break;
      }
    }
  }
  return options;
}

export async function runOrchestrator(
  options: RunOptions = {},
  deps: Partial<RunDependencies> = {},
): Promise<number> {
  if (options.stats) {
    const showStats = deps.showHistoryStats ?? showHistoryStats;
    await showStats(".gittributor/history.json");
  }
  if (!getGitHubToken() && !isDryRun()) {
    warn("GITHUB_TOKEN not set and not in dry-run mode. Set GITHUB_TOKEN or GITTRIBUTOR_DRY_RUN=true.");
    return 1;
  }
  const config = await (deps.loadConfig ?? loadConfig)();
  const languages = getTargetLanguages(config, options.language);

  const discover = deps.discoverRepos ?? (async (opts: Record<string, unknown>) => {
    const { discoverRepos: fn } = await import("./discover.js");
    return fn(opts as Parameters<typeof fn>[0]);
  });
  const analyzeCodebase = deps.analyzeCodebase ?? (async (repo: Repository, issue?: Issue) => {
    const { analyzeCodebase: fn } = await import("../lib/analyzer.js");
    return fn(repo, issue);
  });
  const generateFix = deps.generateFix ?? (async (analysis: AnalysisResult, issue: Issue, repo: Repository) => {
    const { generateFix: fn } = await import("../lib/fix-generator.js");
    return fn(analysis, issue, repo);
  });
  const review = deps.reviewFix ?? (async (opts: { autoApprove?: boolean } = {}) => {
    const { reviewFixes: fn } = await import("./review.js");
    return fn({}, opts);
  });
  const submit = deps.submitApprovedFix ?? (async (opts?: Record<string, unknown>) => {
    const { submitApprovedFix: fn } = await import("./submit.js");
    return fn(opts as Parameters<typeof fn>[0]);
  });

  let lastSubmitResult = 0;
  let totalReposAnalyzed = 0;
  let totalIssuesFound = 0;
  let totalFixesGenerated = 0;

  for (let i = 0; i < languages.length; i++) {
    const language = languages[i];

    const globalWeeklyCount = await getGlobalWeeklyCount(".gittributor/rate-limits.json");
    if (globalWeeklyCount >= MAX_GLOBAL_WEEKLY) {
      process.stdout.write(`⚠️  Global weekly cap reached (${globalWeeklyCount}/${MAX_GLOBAL_WEEKLY}). Stopping.\n`);
      break;
    }

    process.stdout.write(`[language ${i + 1}/${languages.length}] Processing: ${language}\n`);

    await resetState();

    try {
      printStage("🔍", "Discovering repos...");
      const repos = await discover({ language });
      if (repos.length === 0) {
        process.stdout.write("No repositories found.\n");
        printStage("✅", `Pipeline complete for ${language}.`);
        continue;
      }

      printStage("📊", "Analyzing repositories...");
      const eligibleRepos = repos.slice(0, 5);
      const analyses: AnalysisResult[] = [];
      const topIssues: (Issue | undefined)[] = [];
      for (const tr of eligibleRepos) {
        process.stdout.write("  Analyzing: " + tr.fullName + "\n");
        const repo: Repository = {
          id: 0,
          name: tr.name,
          fullName: tr.fullName,
          url: `https://github.com/${tr.fullName}`,
          stars: tr.stars,
          language: tr.language,
          openIssuesCount: tr.openIssues,
          updatedAt: new Date().toISOString(),
          description: tr.description,
        };
        try {
          const issuesFn = deps.discoverIssues ?? discoverIssues;
          const issues = await issuesFn(repo);
          const topIssue = issues[0];
          debug(`[run] Top issue for ${tr.fullName}: ${topIssue?.title ?? "none (free-form)"}`);
          const analysis = await Promise.race([
            analyzeCodebase(repo, topIssue),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error("Repo analysis timeout after 60s")), 60000)
            ),
          ]);
          analyses.push(analysis);
          topIssues.push(topIssue);
          totalReposAnalyzed++;
          totalIssuesFound++;
          process.stdout.write("    Analysis: " + (analysis.suggestedApproach.slice(0, 80)) + "...\n");
        } catch (err) {
          if (err instanceof Error && err.message.includes("timeout")) {
            warn(`Skipping ${tr.fullName}: analysis timed out after 60s`);
          } else {
            process.stderr.write(`Error analyzing ${tr.fullName}: ${err instanceof Error ? err.message : String(err)}\n`);
            debug(`[run] Skipping ${tr.fullName} due to analysis error`);
          }
          continue;
        }
      }
      if (analyses.length === 0) {
        process.stdout.write("No repositories could be analyzed.\n");
        printStage("✅", `Pipeline complete for ${language}.`);
        continue;
      }

      if (options.dryRun) {
        process.stdout.write("\n=== Pipeline Summary ===\n");
        process.stdout.write("Total analyzed: " + analyses.length + "\n");
        for (const a of analyses) {
          process.stdout.write("  " + a.suggestedApproach.slice(0, 80) + "...\n");
        }
        await review({ autoApprove: true });
        printStage("✅", `Pipeline complete for ${language}.`);
        continue;
      }

      printStage("🔧", "Generating fixes...");
      interface SuccessfulFix {
        result: GeneratedFixResult;
        repo: Repository;
        analysis: AnalysisResult;
        issue: Issue;
      }
      const successfulFixes: SuccessfulFix[] = [];
      for (let i = 0; i < eligibleRepos.length; i++) {
        const tr = eligibleRepos[i];
        const analysis = analyses[i];
        if (!analysis) {
          debug(`[run] Skipping ${tr.fullName}: analysis result not available`);
          continue;
        }
        if (!analysis.relevantFiles || analysis.relevantFiles.length === 0) {
          process.stdout.write(`  Skipping ${tr.fullName}: no relevant files found by analyzer.\n`);
          continue;
        }
        const repo: Repository = {
          id: 0,
          name: tr.name,
          fullName: tr.fullName,
          url: `https://github.com/${tr.fullName}`,
          stars: tr.stars,
          language: tr.language,
          openIssuesCount: tr.openIssues,
          updatedAt: new Date().toISOString(),
          description: tr.description,
        };
        const realIssue = topIssues[i];
        const syntheticIssue: Issue = {
          id: realIssue?.id ?? 0,
          number: realIssue?.number ?? 0,
          title: "Free-form analysis",
          body: analysis.suggestedApproach,
          url: `https://github.com/${tr.fullName}`,
          repoFullName: tr.fullName,
          labels: [],
          createdAt: new Date().toISOString(),
          assignees: [],
        };
        const issueToUse: Issue = realIssue ?? syntheticIssue;
        try {
          const fixResult = await generateFix(analysis, issueToUse, repo);
          successfulFixes.push({ result: fixResult, repo, analysis, issue: issueToUse });
          totalFixesGenerated++;
          process.stdout.write("    Fix: " + (fixResult.explanation.slice(0, 80)) + "...\n");
        } catch (err) {
          logError(`Error generating fix for ${tr.fullName}: ${err instanceof Error ? err.message : String(err)}`);
          debug(`[run] Skipping ${tr.fullName} due to fix generation error`);
          continue;
        }
      }

      printStage("👀", "Reviewing contributions...");
      await review({ autoApprove: true });

      printStage("📤", "Submitting contribution...");
      const submitResult = await submit();

      if (isDryRun()) {
        process.stdout.write("\n=== PR Submission (Dry Run) ===\n");
        for (const { result: fixResult, repo, analysis, issue } of successfulFixes) {
          await submitPRForResult(issue, repo.fullName, analysis);
        }
        process.stdout.write("==============================\n");
      } else {
        for (const { result: fixResult, repo, analysis, issue } of successfulFixes) {
          await submitPRForResult(issue, repo.fullName, analysis);
        }
      }
      lastSubmitResult = submitResult;

      if (submitResult === 0) {
        printStage("✅", `Pipeline complete for ${language}.`);
      } else {
        logError("Pipeline failed during submit.");
      }
    } catch (err) {
      logError(`Error processing language "${language}": ${err instanceof Error ? err.message : String(err)}`);
      lastSubmitResult = 1;
    }
  }

  process.stdout.write(
    `Pipeline Summary: Analyzed ${totalReposAnalyzed} repos, found ${totalIssuesFound} issues, generated ${totalFixesGenerated} fixes\n`,
  );
  return lastSubmitResult;
}

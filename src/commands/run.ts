import { existsSync } from "node:fs";
import { getHistoryStats } from "../lib/history.js";
import { setStateData, saveState, loadState, resetState } from "../lib/state.js";
import { debug, error as logError } from "../lib/logger.js";
import { loadConfig, getTargetLanguages } from "../lib/config.js";
import { getGlobalWeeklyCount, MAX_GLOBAL_WEEKLY } from "../lib/guardrails.js";
import type { AnalysisResult, Config, ContributionType, Issue, Repository, TrendingRepo } from "../types/index.js";
import type { FixResult as GeneratedFixResult } from "../lib/fix-generator.js";

const VALID_TYPES: readonly ContributionType[] = ["typo", "docs", "deps", "test", "code", "bug-fix", "performance", "type-safety", "logic-error", "static-analysis"];

export interface RunOptions {
  dryRun?: boolean;
  stats?: boolean;
  type?: ContributionType | null;
  language?: string;
}

export interface RunDependencies {
  loadConfig?: () => Promise<Config>;
  discoverRepos: (options: Record<string, unknown>) => Promise<TrendingRepo[]>;
  analyzeCodebase: (repo: Repository, issue?: Issue) => Promise<AnalysisResult>;
  generateFix: (analysis: AnalysisResult, issue: Issue, repo: Repository) => Promise<GeneratedFixResult>;
  reviewFix: (options?: { autoApprove?: boolean }) => Promise<number>;
  submitApprovedFix: (options?: Record<string, unknown>) => Promise<number>;
  showHistoryStats: (path: string, options?: { stdout?: WritableLike }) => Promise<void>;
}

interface WritableLike {
  write: (chunk: string) => boolean;
}

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
          const analysis = await analyzeCodebase(repo);
          analyses.push(analysis);
          totalReposAnalyzed++;
          totalIssuesFound++;
          process.stdout.write("    Analysis: " + (analysis.suggestedApproach.slice(0, 80)) + "...\n");
        } catch (err) {
          logError(`Error analyzing ${tr.fullName}: ${err instanceof Error ? err.message : String(err)}`);
          debug(`[run] Skipping ${tr.fullName} due to analysis error`);
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
      const results: GeneratedFixResult[] = [];
      for (let i = 0; i < eligibleRepos.length; i++) {
        const tr = eligibleRepos[i];
        const analysis = analyses[i];
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
        const syntheticIssue: Issue = {
          id: 0,
          number: 0,
          title: "Free-form analysis",
          body: analysis.suggestedApproach,
          url: `https://github.com/${tr.fullName}`,
          repoFullName: tr.fullName,
          labels: [],
          createdAt: new Date().toISOString(),
          assignees: [],
        };
        try {
          const fixResult = await generateFix(analysis, syntheticIssue, repo);
          results.push(fixResult);
          totalFixesGenerated++;
          process.stdout.write("    Fix: " + (fixResult.explanation.slice(0, 80)) + "...\n");
        } catch (err) {
          logError(`Error generating fix for ${tr.fullName}: ${err instanceof Error ? err.message : String(err)}`);
          debug(`[run] Skipping ${tr.fullName} due to fix generation error`);
          continue;
        }
      }

      printStage("👀", "Reviewing contributions...");
      await review({ autoApprove: options.dryRun });

      printStage("📤", "Submitting contribution...");
      const submitResult = await submit();
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

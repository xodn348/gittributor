import { existsSync } from "node:fs";
import { getHistoryStats } from "../lib/history.js";
import { setStateData, saveState, loadState } from "../lib/state.js";
import { error as logError } from "../lib/logger.js";
import type { ContributionOpportunity, ContributionType, TrendingRepo } from "../types/index.js";

const VALID_TYPES: readonly ContributionType[] = ["typo", "docs", "deps", "test", "code"];

export interface RunOptions {
  dryRun?: boolean;
  stats?: boolean;
  type?: ContributionType | null;
}

export interface RunDependencies {
  discoverRepos: (options: Record<string, unknown>) => Promise<TrendingRepo[]>;
  analyzeRepositories: (repos: TrendingRepo[]) => Promise<ContributionOpportunity[]>;
  routeContribution: (opp: ContributionOpportunity) => Promise<{ patch: string; description: string; confidence: number }>;
  reviewContributions: (options: { typeFilter?: ContributionType }) => Promise<number>;
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
  }
}

const printStage = (emoji: string, message: string): void => {
  process.stdout.write(emoji + " " + message + "\n");
};

const printSummary = (opportunities: ContributionOpportunity[]): void => {
  process.stdout.write("\n=== Pipeline Summary ===\n");
  process.stdout.write("Total opportunities: " + opportunities.length + "\n");
  const byType: Record<string, number> = {};
  for (const opp of opportunities) {
    byType[opp.type] = (byType[opp.type] ?? 0) + 1;
  }
  for (const [type, count] of Object.entries(byType)) {
    process.stdout.write("  " + type + ": " + count + "\n");
  }
};

const filterByType = (
  opportunities: ContributionOpportunity[],
  type: ContributionType,
): ContributionOpportunity[] => {
  return opportunities.filter((opp) => opp.type === type);
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
  const discover = deps.discoverRepos ?? (async (opts: Record<string, unknown>) => {
    const { discoverRepos: fn } = await import("./discover.js");
    return fn(opts as Parameters<typeof fn>[0]);
  });
  const analyze = deps.analyzeRepositories ?? (async (repos: TrendingRepo[]) => {
    const { analyzeRepositories: fn } = await import("./analyze.js");
    return fn(repos);
  });
  const route = deps.routeContribution ?? (async (opp: ContributionOpportunity) => {
    const { routeContribution: fn } = await import("../lib/fix-router.js");
    return fn(opp);
  });
  const review = deps.reviewContributions ?? (async (opts: { typeFilter?: ContributionType }) => {
    const { reviewContributions: fn } = await import("./review.js");
    return fn(opts);
  });
  const submit = deps.submitApprovedFix ?? (async (opts?: Record<string, unknown>) => {
    const { submitApprovedFix: fn } = await import("./submit.js");
    return fn(opts as Parameters<typeof fn>[0]);
  });

  printStage("🔍", "Discovering repos...");
  const repos = await discover({});
  if (repos.length === 0) {
    process.stdout.write("No repositories found.\n");
    printStage("✅", "Pipeline complete.");
    return 0;
  }

  printStage("📊", "Analyzing contributions...");
  const opportunities = await analyze(repos);
  let filtered = opportunities;
  if (options.type) {
    filtered = filterByType(opportunities, options.type);
    process.stdout.write("Filtered to " + filtered.length + " " + options.type + " opportunities.\n");
  }
  if (filtered.length === 0) {
    process.stdout.write("No contribution opportunities found.\n");
    printStage("✅", "Pipeline complete.");
    return 0;
  }

  if (options.dryRun) {
    printSummary(filtered);
    printStage("✅", "Pipeline complete.");
    return 0;
  }

  printStage("🔧", "Fixing contributions...");
  for (const opp of filtered) {
    process.stdout.write("  " + opp.repo.fullName + ": " + opp.description + "\n");
    await setStateData("currentOpportunity", opp);
    await route(opp);
  }

  const currentState = await loadState();
  await saveState({ ...currentState, status: "fixed" });

  printStage("👀", "Reviewing contributions...");
  await review({ typeFilter: options.type ?? undefined });

  printStage("📤", "Submitting contribution...");
  const submitResult = await submit();

  if (submitResult === 0) {
    printStage("✅", "Pipeline complete.");
  } else {
    logError("Pipeline failed during submit.");
  }

  return submitResult;
}

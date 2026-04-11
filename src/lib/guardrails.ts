import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { GuardrailCheck, ContributionType } from "../types/index.js";
import { debug } from "./logger.js";

export interface RateLimitState {
  hourly: Array<{ submittedAt: string; repo: string }>;
  weekly: Record<string, string[]>;
}

export const HOUR_IN_MS = 60 * 60 * 1000;
export const WEEK_IN_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_HOURLY = 3;
const MAX_WEEKLY_PER_REPO = 2;
export const MAX_GLOBAL_WEEKLY = 10;

export { readJsonSafely };



const readJsonSafely = <T>(path: string, defaultValue: T): T => {
  try {
    if (!existsSync(path)) {
      return defaultValue;
    }
    const content = readFileSync(path, "utf8");
    return JSON.parse(content) as T;
  } catch {
    debug(`[guardrails] readJsonSafely failed for ${path}`);
    return defaultValue;
  }
};

export async function checkRateLimit(
  repo: string,
  rateLimitsPath: string,
  limits?: { maxHourly?: number; maxWeeklyPerRepo?: number },
): Promise<GuardrailCheck> {
  const state = readJsonSafely<RateLimitState>(rateLimitsPath, {
    hourly: [],
    weekly: {},
  });

  const maxHourly = limits?.maxHourly ?? MAX_HOURLY;
  const maxWeeklyPerRepo = limits?.maxWeeklyPerRepo ?? MAX_WEEKLY_PER_REPO;

  const now = Date.now();
  const hourlyWindow = state.hourly.filter((entry) => {
    const time = new Date(entry.submittedAt).getTime();
    return now - time < HOUR_IN_MS;
  });

  if (hourlyWindow.length >= maxHourly) {
    return {
      passed: false,
      reason: `hourly limit exceeded: ${hourlyWindow.length}/${maxHourly} PRs in the last hour`,
    };
  }

  const weeklyEntries = state.weekly[repo] || [];
  const weeklyWindow = weeklyEntries.filter((timestamp) => {
    const time = new Date(timestamp).getTime();
    return now - time < WEEK_IN_MS;
  });

  if (weeklyWindow.length >= maxWeeklyPerRepo) {
    return {
      passed: false,
      reason: `weekly limit exceeded for ${repo}: ${weeklyWindow.length}/${maxWeeklyPerRepo} PRs in the last week`,
    };
  }

  let globalWeeklyCount = 0;
  for (const repoTimestamps of Object.values(state.weekly)) {
    const recentTimestamps = repoTimestamps.filter((timestamp) => {
      const time = new Date(timestamp).getTime();
      return now - time < WEEK_IN_MS;
    });
    globalWeeklyCount += recentTimestamps.length;
  }

  if (globalWeeklyCount >= MAX_GLOBAL_WEEKLY) {
    return {
      passed: false,
      reason: `global weekly cap exceeded: ${globalWeeklyCount}/${MAX_GLOBAL_WEEKLY} PRs across all repos this week`,
    };
  }

  return { passed: true, reason: "" };
}

export async function getGlobalWeeklyCount(rateLimitsPath: string): Promise<number> {
  const state = readJsonSafely<RateLimitState>(rateLimitsPath, {
    hourly: [],
    weekly: {},
  });
  const now = Date.now();
  let count = 0;
  for (const repoTimestamps of Object.values(state.weekly)) {
    const recent = repoTimestamps.filter((ts) => {
      const time = new Date(ts).getTime();
      return now - time < WEEK_IN_MS;
    });
    count += recent.length;
  }
  return count;
}

interface ContributionHistory {
  [repo: string]: {
    [filePath: string]: {
      [type in ContributionType]?: {
        status: string;
        submittedAt: string;
      };
    };
  };
}

export async function checkDuplicateContribution(
  repo: string,
  filePath: string,
  type: ContributionType,
  historyPath: string,
): Promise<GuardrailCheck> {
  const history = readJsonSafely<ContributionHistory>(historyPath, {});

  const repoHistory = history[repo];
  if (!repoHistory) {
    return { passed: true, reason: "" };
  }

  const fileHistory = repoHistory[filePath];
  if (!fileHistory) {
    return { passed: true, reason: "" };
  }

  const typeHistory = fileHistory[type];
  if (!typeHistory) {
    return { passed: true, reason: "" };
  }

  if (typeHistory.status !== "rejected") {
    return {
      passed: false,
      reason: `duplicate: ${repo}/${filePath} already has a ${type} submission with status "${typeHistory.status}"`,
    };
  }

  return { passed: true, reason: "" };
}

export function checkRepoEligibility(
  isArchived: boolean,
  stars: number,
  minStars?: number,
): GuardrailCheck {
  const threshold = minStars ?? 1000;
  if (isArchived) {
    return {
      passed: false,
      reason: "Repository is archived",
    };
  }

  if (stars < threshold) {
    return {
      passed: false,
      reason: `Repository has insufficient stars (${stars} < ${threshold})`,
    };
  }

  return { passed: true, reason: "" };
}

export async function recordSubmission(
  repo: string,
  rateLimitsPath: string,
): Promise<void> {
  const state = readJsonSafely<RateLimitState>(rateLimitsPath, {
    hourly: [],
    weekly: {},
  });

  const now = new Date().toISOString();

  state.hourly.push({ submittedAt: now, repo });

  if (!state.weekly[repo]) {
    state.weekly[repo] = [];
  }
  state.weekly[repo].push(now);

  const dir = dirname(rateLimitsPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(rateLimitsPath, JSON.stringify(state, null, 2));
}
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { GuardrailCheck, ContributionType } from "../types/index.js";

export interface RateLimitState {
  hourly: Array<{ submittedAt: string; repo: string }>;
  weekly: Record<string, string[]>;
}

const HOUR_IN_MS = 60 * 60 * 1000;
const WEEK_IN_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_HOURLY = 3;
const MAX_WEEKLY_PER_REPO = 2;

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const readJsonSafely = <T>(path: string, defaultValue: T): T => {
  try {
    if (!existsSync(path)) {
      return defaultValue;
    }
    const content = readFileSync(path, "utf8");
    return JSON.parse(content) as T;
  } catch {
    return defaultValue;
  }
};

export async function checkRateLimit(
  repo: string,
  rateLimitsPath: string,
): Promise<GuardrailCheck> {
  const state = readJsonSafely<RateLimitState>(rateLimitsPath, {
    hourly: [],
    weekly: {},
  });

  const now = Date.now();
  const hourlyWindow = state.hourly.filter((entry) => {
    const time = new Date(entry.submittedAt).getTime();
    return now - time < HOUR_IN_MS;
  });

  if (hourlyWindow.length >= MAX_HOURLY) {
    return {
      passed: false,
      reason: `hourly limit exceeded: ${hourlyWindow.length}/${MAX_HOURLY} PRs in the last hour`,
    };
  }

  const weeklyEntries = state.weekly[repo] || [];
  const weeklyWindow = weeklyEntries.filter((timestamp) => {
    const time = new Date(timestamp).getTime();
    return now - time < WEEK_IN_MS;
  });

  if (weeklyWindow.length >= MAX_WEEKLY_PER_REPO) {
    return {
      passed: false,
      reason: `weekly limit exceeded for ${repo}: ${weeklyWindow.length}/${MAX_WEEKLY_PER_REPO} PRs in the last week`,
    };
  }

  return { passed: true, reason: "" };
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
): GuardrailCheck {
  if (isArchived) {
    return {
      passed: false,
      reason: "Repository is archived",
    };
  }

  if (stars < 1000) {
    return {
      passed: false,
      reason: `Repository has insufficient stars (${stars} < 1000)`,
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
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { GitHubClient, GitHubAPIError } from "../lib/github.js";
import { loadRepoList, filterRepoList } from "../lib/repo-list.js";
import { loadConfig, discoveryConfig } from "../lib/config.js";
import { loadState, saveState, setStateData } from "../lib/state.js";
import { checkRepoEligibility } from "../lib/guardrails.js";
import { info, log, debug, warn } from "../lib/logger.js";
import type { TrendingRepo, Repository, MergeProbability, Config } from "../types/index.js";
import { toTrendingRepo } from "../types/index.js";

const ANSI_RESET = "\x1b[0m";
const ANSI_GREEN = "\x1b[32m";
const ANSI_BOLD = "\x1b[1m";

const DEFAULT_MIN_STARS = 1000;
const DEFAULT_LIMIT = 10;
const DEFAULT_LANGUAGE = "TypeScript";

const DISCOVERY_DIR = ".gittributor";
const DISCOVERY_FILE = "discoveries.json";

const DAYS_AGO_90 = 90;
const DAYS_AGO_30 = 30;

const THIRTY_DAYS_MS = DAYS_AGO_30 * 24 * 60 * 60 * 1000;

const scoreRepo = (repo: TrendingRepo): number => {
  let score = 0;

  if (repo.stars >= 1000 && repo.stars <= 10000) {
    score += 30;
  } else if (repo.stars > 10000 && repo.stars <= 50000) {
    score += 15;
  }

  if (repo.openIssues > 5) {
    score += 20;
  } else if (repo.openIssues > 0) {
    score += 5;
  }

  if (repo.hasContributing) {
    score += 25;
  }

  if (repo.topics && repo.topics.length > 0) {
    const hasGoodFirst = repo.topics.some(
      (t) => t.toLowerCase().includes("good-first") || t.toLowerCase().includes("good first")
    );
    if (hasGoodFirst) {
      score += 10;
    }
  }

  return score;
};

const isRecentlyActive = (updatedAt: string): boolean => {
  const updatedMs = Date.parse(updatedAt);
  if (!Number.isFinite(updatedMs)) return false;
  return Date.now() - updatedMs <= THIRTY_DAYS_MS;
};

const isGitHubClient = (arg: unknown): arg is GitHubClient => {
  return arg instanceof GitHubClient;
};

export async function discoverReposFromAPI(
  client: GitHubClient,
  options?: Partial<DiscoverOptions>,
): Promise<TrendingRepo[]> {
  let fetchedRepos: Repository[] = [];

  const searchLanguage = (options?.language?.trim() || "typescript").toLowerCase();
  const minStars = options?.minStars ?? discoveryConfig.minStars;
  const maxRepos = options?.limit ?? discoveryConfig.maxReposPerRun;

  try {
    fetchedRepos = await client.searchRepositories({
      minStars,
      languages: [searchLanguage],
      limit: maxRepos,
    });
  } catch (err) {
    if (err instanceof GitHubAPIError) {
      const msg = err.message.toLowerCase();
      if (
        msg.includes("authentication") ||
        msg.includes("auth") ||
        msg.includes("token") ||
        msg.includes("unauthorized") ||
        err.exitCode === 1
      ) {
        warn("GitHub authentication required. Please run 'gh auth login' first.");
        warn("Falling back to curated repo list...");
      } else {
        warn(`GitHub API error: ${err.message}. Falling back to curated repo list...`);
      }
    } else {
      warn(`Discovery failed: ${String(err)}. Falling back to curated repo list...`);
    }
    return [];
  }

  if (fetchedRepos.length === 0) {
    debug("No repos found from GitHub search, trying curated list...");
    return [];
  }

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - DAYS_AGO_30);
  const cutoffDate = thirtyDaysAgo.toISOString();

  const recentlyActive = fetchedRepos.filter((r) => r.updatedAt >= cutoffDate);

  if (recentlyActive.length === 0) {
    debug("No repos with recent activity found, using all fetched repos");
  }

  const scored = (recentlyActive.length > 0 ? recentlyActive : fetchedRepos)
    .map((r) => toTrendingRepo(r))
    .map((r) => ({ repo: r, score: scoreRepo(r) }))
    .sort((a, b) => b.score - a.score);

  const topCandidates = scored
    .slice(0, 2)
    .map((s) => s.repo);

  const enriched: TrendingRepo[] = [];

  for (const candidate of topCandidates) {
    try {
      const repoInfo = await client.getRepoInfo(candidate.fullName);

      if (repoInfo.hasOpenUserPR) {
        debug(`Filtered out ${candidate.fullName}: user already has open PR`);
        continue;
      }

      if (repoInfo.isArchived) {
        debug(`Filtered out ${candidate.fullName}: archived`);
        continue;
      }

      enriched.push({
        ...candidate,
        isArchived: repoInfo.isArchived,
        hasContributing: false,
      });
    } catch (err) {
      debug(`Failed to enrich ${candidate.fullName}: ${String(err)}`);
      enriched.push(candidate);
    }
  }

  return enriched
    .sort((a, b) => scoreRepo(b) - scoreRepo(a))
    .slice(0, maxRepos);
}

export async function discoverRepos(
  clientOrOptions?: GitHubClient | DiscoverOptions,
): Promise<TrendingRepo[]> {
  const config = await loadConfig();
  const githubClient = isGitHubClient(clientOrOptions) ? clientOrOptions : new GitHubClient();
  const passedOptions = isGitHubClient(clientOrOptions) ? undefined : clientOrOptions;

  let yamlRepos: TrendingRepo[] = [];
  try {
    yamlRepos = await loadTrendingRepos(config);
  } catch {
    yamlRepos = [];
  }

  if (yamlRepos.length > 0) {
    const filtered = filterRepoList(yamlRepos, {});
    return await filterAndEnrichRepos(filtered, { language: "TypeScript", minStars: 1000, limit: 10 });
  }

  return await discoverReposFromAPI(githubClient, passedOptions);
}

export interface DiscoverOptions {
  language?: string;
  minStars?: number;
  limit?: number;
  dryRun?: boolean;
}

interface NormalizedDiscoverOptions {
  language: string;
  minStars: number;
  limit: number;
}

const normalizeOptions = (options: DiscoverOptions): NormalizedDiscoverOptions => {
  return {
    language: options.language?.trim() || DEFAULT_LANGUAGE,
    minStars: options.minStars ?? DEFAULT_MIN_STARS,
    limit: options.limit ?? DEFAULT_LIMIT,
  };
};

export const buildDiscoverQuery = (options: DiscoverOptions): string => {
  const normalizedOptions = normalizeOptions(options);
  const starsFilter = normalizedOptions.minStars > 0 ? `+stars:>=${normalizedOptions.minStars}` : "";
  
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - DAYS_AGO_90);
  const pushedDate = ninetyDaysAgo.toISOString().slice(0, 10);
  
  return `language:${normalizedOptions.language}${starsFilter}+pushed:>=${pushedDate}&sort=updated&order=desc`;
};

const calculateMergeProbability = (repo: TrendingRepo): MergeProbability => {
  const reasons: string[] = [];
  let score = 50;

  if (repo.stars >= 100000) {
    score += 20;
    reasons.push("high stars (100k+)");
  } else if (repo.stars >= 50000) {
    score += 15;
    reasons.push("good stars (50k+)");
  } else if (repo.stars >= 10000) {
    score += 10;
    reasons.push("decent stars (10k+)");
  }

  if (repo.topics && repo.topics.length > 0) {
    const hasGoodFirstIssue = repo.topics.some(
      (t) => t.toLowerCase().includes("good-first") || t.toLowerCase().includes("good first")
    );
    if (hasGoodFirstIssue) {
      score += 15;
      reasons.push("good-first-issue topic");
    }
  }

  if (repo.hasContributing) {
    score += 10;
    reasons.push("has CONTRIBUTING.md");
  }

  if (repo.openIssues > 0) {
    score += 5;
    reasons.push("has open issues");
  }

  let label: "high" | "medium" | "low" = "low";
  if (score >= 70) {
    label = "high";
  } else if (score >= 50) {
    label = "medium";
  }

  return { score, label, reasons };
};

const getNinetyDaysAgo = (): Date => {
  const date = new Date();
  date.setDate(date.getDate() - DAYS_AGO_90);
  date.setHours(0, 0, 0, 0);
  return date;
};

const isActiveRecently = (repo: TrendingRepo & { lastUpdated?: string }): boolean => {
  if (repo.lastUpdated) {
    const updatedAt = new Date(repo.lastUpdated);
    return updatedAt >= getNinetyDaysAgo();
  }
  if (repo.openIssues !== undefined && repo.openIssues !== null && repo.openIssues > 0) {
    return true;
  }
  return true;
};

interface EnrichedTrendingRepo extends TrendingRepo {
  lastUpdated?: string;
  hasOpenPR?: boolean;
}

const enrichRepoWithGitHubInfo = async (
  repo: TrendingRepo,
  githubClient: GitHubClient
): Promise<EnrichedTrendingRepo> => {
  try {
    const repoInfo = await githubClient.getRepoInfo(repo.fullName);
    return {
      ...repo,
      isArchived: repoInfo.isArchived,
      lastUpdated: repoInfo.updatedAt,
      openIssues: repoInfo.stargazerCount > 0 ? repo.openIssues : 0,
      hasOpenPR: repoInfo.hasOpenUserPR,
    };
  } catch {
    debug(`Failed to enrich repo ${repo.fullName}, using defaults`);
    return repo;
  }
};

const filterAndEnrichRepos = async (
  repos: TrendingRepo[],
  options: NormalizedDiscoverOptions
): Promise<TrendingRepo[]> => {
  const githubClient = new GitHubClient();
  const enrichedRepos: EnrichedTrendingRepo[] = [];

  for (const repo of repos) {
    const enriched = await enrichRepoWithGitHubInfo(repo, githubClient);
    debug(`Enriched ${repo.fullName}: isArchived=${enriched.isArchived}, lastUpdated=${enriched.lastUpdated}, hasOpenPR=${enriched.hasOpenPR}`);
    
    const eligibility = checkRepoEligibility(enriched.isArchived, enriched.stars);
    if (!eligibility.passed) {
      debug(`Filtered out ${repo.fullName}: ${eligibility.reason}`);
      continue;
    }

    if (enriched.hasOpenPR) {
      debug(`Filtered out ${repo.fullName}: user already has open PR`);
      continue;
    }

    if (!isActiveRecently(enriched)) {
      debug(`Filtered out ${repo.fullName}: no activity in 90+ days`);
      continue;
    }

    enrichedRepos.push(enriched);
  }

  return enrichedRepos
    .map((repo) => ({
      repo,
      mergeProbability: calculateMergeProbability(repo),
    }))
    .sort((a, b) => b.mergeProbability.score - a.mergeProbability.score)
    .map((sortedRepo) => sortedRepo.repo)
    .slice(0, options.limit);
};

const pad = (value: string, width: number): string => {
  if (value.length >= width) {
    return value;
  }

  return `${value}${" ".repeat(width - value.length)}`;
};

const renderDiscoverTable = (repositories: TrendingRepo[]): string => {
  const header = [
    pad("Repository", 30),
    pad("Stars", 8),
    pad("Language", 14),
    pad("Open Issues", 14),
    "URL",
  ].join("  ");

  const rows = repositories.map((repository) => {
    return [
      pad(repository.fullName, 30),
      pad(String(repository.stars), 8),
      pad(repository.language ?? "unknown", 14),
      pad(String(repository.openIssues), 14),
      `https://github.com/${repository.fullName}`,
    ].join("  ");
  });

  const table = [header, ...rows].join("\n");
  return `${ANSI_GREEN}${ANSI_BOLD}${table}${ANSI_RESET}`;
};

const persistDiscoveries = async (repositories: TrendingRepo[]): Promise<void> => {
  const discoveriesDir = join(process.cwd(), DISCOVERY_DIR);
  await mkdir(discoveriesDir, { recursive: true });
  const filePath = join(discoveriesDir, DISCOVERY_FILE);
  await Bun.write(
    filePath,
    JSON.stringify(
      {
        discoveredAt: new Date().toISOString(),
        repositories: repositories.map((r) => ({
          fullName: r.fullName,
          stars: r.stars,
          language: r.language,
          openIssues: r.openIssues,
          isArchived: r.isArchived,
        })),
      },
      null,
      2
    )
  );
};

const loadTrendingRepos = async (config: Config): Promise<TrendingRepo[]> => {
  const repoListPath = config.repoListPath || "repos.yaml";
  
  try {
    const repos = loadRepoList(repoListPath);
    info(`Loaded ${repos.length} curated repos from YAML`);
    return repos;
  } catch (e) {
    const err = e as Error;
    if (err.message.includes("not found") || err.message.includes("ENOENT")) {
      info("No YAML repo list found, will use fallback");
      return [];
    }
    throw err;
  }
};

const searchReposFallback = async (
  options: NormalizedDiscoverOptions
): Promise<Repository[]> => {
  const githubClient = new GitHubClient();
  const query = buildDiscoverQuery({ language: options.language, minStars: options.minStars });
  info(`Searching repositories with query: ${query}`);

  const repositories = await githubClient.searchRepositories({
    minStars: options.minStars,
    languages: [options.language],
    limit: options.limit,
  });

  return repositories;
};

export async function runDiscoverCommand(options: DiscoverOptions): Promise<TrendingRepo[]> {
  const config = await loadConfig();
  const normalizedOptions = normalizeOptions(options);

  let trendingRepos: TrendingRepo[] = [];

  const yamlRepos = await loadTrendingRepos(config);

  if (yamlRepos.length > 0) {
    const filtered = filterRepoList(yamlRepos, {
      languages: normalizedOptions.language ? [normalizedOptions.language] : undefined,
      minStars: normalizedOptions.minStars,
    });
    info(`Filtered curated repos to ${filtered.length} by language/minStars`);

    trendingRepos = await filterAndEnrichRepos(filtered, normalizedOptions);
  } else {
    info("No YAML repo list found, using dynamic discovery");
    const githubClient = new GitHubClient();
    const apiResults = await discoverRepos(githubClient);

    if (apiResults.length > 0) {
      trendingRepos = apiResults;
    } else {
      info("No repos from API, falling back to search with options");
      const searchResults = await searchReposFallback(normalizedOptions);

      trendingRepos = await filterAndEnrichRepos(
        searchResults.map((r): TrendingRepo => ({
          owner: r.fullName.split("/")[0],
          name: r.fullName.split("/")[1],
          fullName: r.fullName,
          stars: r.stars,
          language: r.language,
          description: r.description,
          isArchived: false,
          defaultBranch: "main",
          hasContributing: false,
          topics: [],
          openIssues: r.openIssuesCount,
        })),
        normalizedOptions
      );
    }
  }

  await persistDiscoveries(trendingRepos);

  const state = await loadState();
  state.repositories = trendingRepos.map((r) => ({
    id: 0,
    name: r.name,
    fullName: r.fullName,
    url: `https://github.com/${r.fullName}`,
    stars: r.stars,
    language: r.language,
    openIssuesCount: r.openIssues,
    updatedAt: new Date().toISOString(),
    description: r.description,
  }));
  await saveState(state);

  await setStateData("trendingRepos", trendingRepos);

  if (trendingRepos.length === 0) {
    log("No repositories found matching criteria.");
    return trendingRepos;
  }

  log(renderDiscoverTable(trendingRepos));
  return trendingRepos;
}


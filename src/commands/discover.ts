import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { GitHubClient } from "../lib/github";
import { info, log } from "../lib/logger";
import type { Repository } from "../types/index";

const ANSI_RESET = "\x1b[0m";
const ANSI_GREEN = "\x1b[32m";
const ANSI_BOLD = "\x1b[1m";

const DEFAULT_MIN_STARS = 50;
const DEFAULT_LIMIT = 10;
const DEFAULT_LANGUAGE = "TypeScript";
const DEFAULT_DAYS_BACK = 7;

const DISCOVERY_DIR = ".gittributor";
const DISCOVERY_FILE = "discoveries.json";

interface RepositoryWithGoodFirstIssueSignals extends Repository {
  hasGoodFirstIssues?: boolean;
  topics?: string[];
}

export interface DiscoverOptions {
  language?: string;
  minStars?: number;
  createdAfter?: string;
  limit?: number;
}

interface NormalizedDiscoverOptions {
  language: string;
  minStars: number;
  createdAfter: Date;
  createdAfterText: string;
  limit: number;
}

const parseCreatedAfter = (createdAfter?: string): Date => {
  if (!createdAfter) {
    const defaultDate = new Date();
    defaultDate.setDate(defaultDate.getDate() - DEFAULT_DAYS_BACK);
    return defaultDate;
  }

  const parsed = new Date(createdAfter);
  if (Number.isNaN(parsed.getTime())) {
    const fallbackDate = new Date();
    fallbackDate.setDate(fallbackDate.getDate() - DEFAULT_DAYS_BACK);
    return fallbackDate;
  }

  return parsed;
};

const toIsoDay = (value: Date): string => {
  return value.toISOString().slice(0, 10);
};

const normalizeOptions = (options: DiscoverOptions): NormalizedDiscoverOptions => {
  const createdAfterDate = parseCreatedAfter(options.createdAfter);

  return {
    language: options.language?.trim() || DEFAULT_LANGUAGE,
    minStars: options.minStars ?? DEFAULT_MIN_STARS,
    createdAfter: createdAfterDate,
    createdAfterText: toIsoDay(createdAfterDate),
    limit: options.limit ?? DEFAULT_LIMIT,
  };
};

export const buildDiscoverQuery = (options: DiscoverOptions): string => {
  const normalizedOptions = normalizeOptions(options);
  return `language:${normalizedOptions.language}+stars:>=${normalizedOptions.minStars}+good-first-issues:>0+created:>=${normalizedOptions.createdAfterText}&sort=stars&order=desc`;
};

const hasGoodFirstIssueSignals = (repository: RepositoryWithGoodFirstIssueSignals): boolean => {
  if (repository.hasGoodFirstIssues === true) {
    return true;
  }

  if (!Array.isArray(repository.topics)) {
    return true;
  }

  return repository.topics.some((topic) => {
    const normalizedTopic = topic.trim().toLowerCase();
    return normalizedTopic.includes("good-first") || normalizedTopic.includes("good first");
  });
};

const isRecentEnough = (repository: Repository): boolean => {
  const updatedAt = new Date(repository.updatedAt);
  return !Number.isNaN(updatedAt.getTime());
};

const filterDiscoveredRepositories = (
  repositories: Repository[],
  options: NormalizedDiscoverOptions,
): Repository[] => {
  return repositories
    .filter((repository) => {
      const withSignals = repository as RepositoryWithGoodFirstIssueSignals;

      if (repository.openIssuesCount < 1) {
        return false;
      }

      if (!hasGoodFirstIssueSignals(withSignals)) {
        return false;
      }

      if (!isRecentEnough(repository)) {
        return false;
      }

      return new Date(repository.updatedAt) >= options.createdAfter;
    })
    .slice(0, options.limit);
};

const pad = (value: string, width: number): string => {
  if (value.length >= width) {
    return value;
  }

  return `${value}${" ".repeat(width - value.length)}`;
};

const renderDiscoverTable = (repositories: Repository[]): string => {
  const header = [
    pad("Repository", 30),
    pad("Stars", 8),
    pad("Language", 14),
    pad("Good First Issues", 20),
    "URL",
  ].join("  ");

  const rows = repositories.map((repository) => {
    return [
      pad(repository.fullName, 30),
      pad(String(repository.stars), 8),
      pad(repository.language ?? "unknown", 14),
      pad(String(repository.openIssuesCount), 20),
      repository.url,
    ].join("  ");
  });

  const table = [header, ...rows].join("\n");
  return `${ANSI_GREEN}${ANSI_BOLD}${table}${ANSI_RESET}`;
};

const persistDiscoveries = async (repositories: Repository[]): Promise<void> => {
  const discoveriesDir = join(process.cwd(), DISCOVERY_DIR);
  await mkdir(discoveriesDir, { recursive: true });
  const filePath = join(discoveriesDir, DISCOVERY_FILE);
  await Bun.write(
    filePath,
    JSON.stringify(
      {
        discoveredAt: new Date().toISOString(),
        repositories,
      },
      null,
      2,
    ),
  );
};

export async function discoverRepos(options: DiscoverOptions): Promise<Repository[]> {
  const normalizedOptions = normalizeOptions(options);
  const query = buildDiscoverQuery(options);
  info(`Searching repositories with query: ${query}`);

  const githubClient = new GitHubClient();
  const repositories = await githubClient.searchRepositories({
    minStars: normalizedOptions.minStars,
    languages: [normalizedOptions.language],
    limit: normalizedOptions.limit,
  });

  const discoveredRepositories = filterDiscoveredRepositories(repositories, normalizedOptions);
  await persistDiscoveries(discoveredRepositories);

  if (discoveredRepositories.length === 0) {
    log("No repositories found with good first issues.");
    return discoveredRepositories;
  }

  log(renderDiscoverTable(discoveredRepositories));
  return discoveredRepositories;
}

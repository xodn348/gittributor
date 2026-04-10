import yaml from "js-yaml";
import { readFileSync } from "fs";
import { TrendingRepo } from "../types/index.js";

interface RepoYaml {
  owner: string;
  name: string;
  stars: number;
  language: string;
  description: string;
  topics: string[];
  defaultBranch: string;
}

interface RepoListYaml {
  repos: RepoYaml[];
}

export function loadRepoList(repoListPath: string): TrendingRepo[] {
  let fileContent: string;
  try {
    fileContent = readFileSync(repoListPath, "utf-8");
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      throw new Error(`Repository list file not found: ${repoListPath}`);
    }
    throw new Error(`Failed to read repository list: ${err.message}`);
  }

  let parsed: RepoListYaml;
  try {
    parsed = yaml.load(fileContent) as RepoListYaml;
  } catch (e) {
    const err = e as Error;
    throw new Error(`Failed to parse repository list YAML: ${err.message}`);
  }

  if (!parsed.repos || !Array.isArray(parsed.repos)) {
    throw new Error("Invalid YAML format: 'repos' array not found");
  }

  return parsed.repos.map((repo): TrendingRepo => ({
    owner: repo.owner,
    name: repo.name,
    fullName: `${repo.owner}/${repo.name}`,
    stars: repo.stars,
    language: repo.language,
    description: repo.description,
    topics: repo.topics,
    defaultBranch: repo.defaultBranch,
    hasContributing: false,
    isArchived: false,
    openIssues: 0,
  }));
}

export function filterRepoList(
  repos: TrendingRepo[],
  options: { languages?: string[]; minStars?: number; excludeRepos?: string[]; topics?: string[] }
): TrendingRepo[] {
  const minStars = Math.max(1000, options.minStars || 1000);
  let filtered = repos;

  if (options.minStars !== undefined) {
    filtered = filtered.filter((r) => r.stars >= minStars);
  }

  if (options.languages && options.languages.length > 0) {
    filtered = filtered.filter((r) => r.language && options.languages!.map(l => l.toLowerCase()).includes(r.language.toLowerCase()));
  }

  if (options.excludeRepos && options.excludeRepos.length > 0) {
    filtered = filtered.filter((r) => {
      const fullName = `${r.owner}/${r.name}`;
      return !options.excludeRepos!.includes(fullName);
    });
  }

  if (options.topics && options.topics.length > 0) {
    filtered = filtered.filter((r) => {
      if (!r.topics) return false;
      return options.topics!.some((t) => r.topics!.includes(t));
    });
  }

  return filtered;
}
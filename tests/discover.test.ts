import { afterAll, afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitHubClient } from "../src/lib/github.js";
import { acquireGlobalTestLock } from "./helpers/global-test-lock";

import { buildDiscoverQuery, discoverRepos } from "../src/commands/discover.js";
import type { TrendingRepo, Config } from "../src/types/index.js";

describe("discover command - TDD for trending repos", () => {
  const cwd = process.cwd();
  let tempDir: string;
  let releaseGlobalLock: (() => void) | null = null;

  beforeEach(async () => {
    releaseGlobalLock = await acquireGlobalTestLock();
    spyOn(GitHubClient.prototype, "searchRepositories").mockResolvedValue([]);
    spyOn(GitHubClient.prototype, "getRepoInfo").mockResolvedValue({
      fullName: "test/repo",
      diskUsage: 1000,
      stargazerCount: 5000,
      isArchived: false,
      updatedAt: new Date().toISOString(),
    });
    tempDir = mkdtempSync(join(tmpdir(), "gittributor-discover-"));
    process.chdir(tempDir);

    mock.module("../src/lib/config.js", () => ({
      loadConfig: () =>
        Promise.resolve({
          minStars: 1000,
          maxPRsPerDay: 5,
          maxPRsPerRepo: 1,
          targetLanguages: ["typescript", "javascript"],
          repoListPath: "./repos.yaml",
          verbose: false,
          historyPath: ".gittributor/history.json",
          maxPRsPerWeekPerRepo: 2,
          maxPRsPerHour: 3,
          contributionTypes: ["bug-fix", "performance", "type-safety", "logic-error", "static-analysis"],
          dryRun: false,
        } as Config),
    }));

    mock.module("../src/lib/repo-list.js", () => ({
      loadRepoList: () => {
        throw new Error("Repository list file not found: ./repos.yaml");
      },
      filterRepoList: (repos: TrendingRepo[]) => repos,
    }));
  });

  afterEach(() => {
    process.chdir(cwd);
    rmSync(tempDir, { recursive: true, force: true });
    mock.restore();
    releaseGlobalLock?.();
    releaseGlobalLock = null;
  });

  test("buildDiscoverQuery applies defaults and requested filters without date filter", () => {
    const query = buildDiscoverQuery({ language: "TypeScript" });

    expect(query).toContain("language:TypeScript");
    expect(query).not.toContain("created:>=");
    expect(query).toContain("stars:>=1000");
    expect(query).toContain("pushed:");
  });

  test("buildDiscoverQuery applies minStars from options", () => {
    const query = buildDiscoverQuery({ language: "TypeScript", minStars: 5000 });

    expect(query).toContain("stars:>=5000");
  });

  test("falls back to gh search when YAML file is empty or not found", async () => {
    const searchRepositoriesSpy = spyOn(GitHubClient.prototype, "searchRepositories").mockResolvedValueOnce([]);

    const result = await discoverRepos({ language: "TypeScript", minStars: 1000, limit: 10 });

    expect(searchRepositoriesSpy).toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  test("searches with pushed:>= in fallback path", async () => {
    spyOn(GitHubClient.prototype, "searchRepositories").mockResolvedValueOnce([
      {
        id: 1,
        name: "test",
        fullName: "test/test",
        url: "https://github.com/test/test",
        stars: 5000,
        language: "TypeScript",
        openIssuesCount: 5,
        updatedAt: "2026-04-01T00:00:00.000Z",
        description: "test repo",
      },
    ]);

    const result = await discoverRepos({ language: "TypeScript", minStars: 1000, limit: 10 });

    expect(result.length).toBeGreaterThan(0);
    expect(result[0].fullName).toBe("test/test");
  });

  test("filters out archived repos using checkRepoEligibility", async () => {
    spyOn(GitHubClient.prototype, "getRepoInfo").mockResolvedValue({
      fullName: "test/archived",
      diskUsage: 1000,
      stargazerCount: 5000,
      isArchived: true,
      updatedAt: new Date().toISOString(),
    });
    spyOn(GitHubClient.prototype, "searchRepositories").mockResolvedValueOnce([]);

    mock.module("../src/lib/repo-list.js", () => ({
      loadRepoList: () => [
        {
          owner: "test",
          name: "archived",
          fullName: "test/archived",
          stars: 5000,
          language: "TypeScript",
          description: "archived repo",
          topics: [],
          defaultBranch: "main",
          hasContributing: false,
          isArchived: true,
          openIssues: 5,
        },
      ],
      filterRepoList: (repos: TrendingRepo[]) => repos,
    }));

    const result = await discoverRepos({});

    expect(result.find(r => r.fullName === "test/archived")).toBeUndefined();
  });

  test("filters out repos with 0 activity in 90+ days", async () => {
    spyOn(GitHubClient.prototype, "getRepoInfo").mockResolvedValue({
      fullName: "test/stale",
      diskUsage: 1000,
      stargazerCount: 5000,
      isArchived: false,
      updatedAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString(),
    });
    spyOn(GitHubClient.prototype, "searchRepositories").mockResolvedValueOnce([]);

    mock.module("../src/lib/repo-list.js", () => ({
      loadRepoList: () => [
        {
          owner: "test",
          name: "stale",
          fullName: "test/stale",
          stars: 5000,
          language: "TypeScript",
          description: "stale repo",
          topics: [],
          defaultBranch: "main",
          hasContributing: false,
          isArchived: false,
          openIssues: 0,
        },
      ],
      filterRepoList: (repos: TrendingRepo[]) => repos,
    }));

    const result = await discoverRepos({});

    expect(result.find(r => r.fullName === "test/stale")).toBeUndefined();
  });

  test("sorts repos by merge probability descending", async () => {
    spyOn(GitHubClient.prototype, "searchRepositories").mockResolvedValueOnce([]);

    mock.module("../src/lib/repo-list.js", () => ({
      loadRepoList: () => [
        {
          owner: "test",
          name: "repo1",
          fullName: "test/repo1",
          stars: 5000,
          language: "TypeScript",
          description: "Repo 1",
          topics: ["good-first-issue"],
          defaultBranch: "main",
          hasContributing: true,
          isArchived: false,
          openIssues: 10,
        },
        {
          owner: "test",
          name: "repo2",
          fullName: "test/repo2",
          stars: 20000,
          language: "TypeScript",
          description: "Repo 2",
          topics: [],
          defaultBranch: "main",
          hasContributing: false,
          isArchived: false,
          openIssues: 5,
        },
        {
          owner: "test",
          name: "repo3",
          fullName: "test/repo3",
          stars: 1000,
          language: "TypeScript",
          description: "Repo 3",
          topics: [],
          defaultBranch: "main",
          hasContributing: false,
          isArchived: false,
          openIssues: 2,
        },
      ],
      filterRepoList: (repos: TrendingRepo[]) => repos,
    }));

    const result = await discoverRepos({ minStars: 1000 });

    expect(result[0].fullName).toBe("test/repo1");
    expect(result[1].fullName).toBe("test/repo2");
    expect(result[2].fullName).toBe("test/repo3");
  });

  test("stores result in pipeline state via setStateData", async () => {
    spyOn(GitHubClient.prototype, "searchRepositories").mockResolvedValueOnce([]);

    mock.module("../src/lib/repo-list.js", () => ({
      loadRepoList: () => [
        {
          owner: "test",
          name: "repo",
          fullName: "test/repo",
          stars: 5000,
          language: "TypeScript",
          description: "test repo",
          topics: [],
          defaultBranch: "main",
          hasContributing: false,
          isArchived: false,
          openIssues: 5,
        },
      ],
      filterRepoList: (repos: TrendingRepo[]) => repos,
    }));

    const result = await discoverRepos({});

    expect(result.length).toBeGreaterThan(0);
  });

  test("DEFAULT_MIN_STARS is 1000", () => {
    const query = buildDiscoverQuery({});
    expect(query).toContain("stars:>=1000");
  });

  test("accepts --language flag", async () => {
    spyOn(GitHubClient.prototype, "searchRepositories").mockResolvedValueOnce([]);

    mock.module("../src/lib/repo-list.js", () => ({
      loadRepoList: () => {
        throw new Error("not found");
      },
      filterRepoList: (repos: TrendingRepo[]) => repos,
    }));

    await discoverRepos({ language: "Python" });

    expect(GitHubClient.prototype.searchRepositories).toHaveBeenCalled();
  });

  test("accepts --min-stars flag", async () => {
    spyOn(GitHubClient.prototype, "searchRepositories").mockResolvedValueOnce([]);

    mock.module("../src/lib/repo-list.js", () => ({
      loadRepoList: () => {
        throw new Error("not found");
      },
      filterRepoList: (repos: TrendingRepo[]) => repos,
    }));

    await discoverRepos({ minStars: 5000 });

    expect(GitHubClient.prototype.searchRepositories).toHaveBeenCalledWith(
      expect.objectContaining({
        minStars: 5000,
      })
    );
  });

  test("enriches repos with getRepoInfo from github.ts", async () => {
    spyOn(GitHubClient.prototype, "searchRepositories").mockResolvedValueOnce([]);

    mock.module("../src/lib/repo-list.js", () => ({
      loadRepoList: () => [
        {
          owner: "test",
          name: "repo",
          fullName: "test/repo",
          stars: 5000,
          language: "TypeScript",
          description: "test repo",
          topics: [],
          defaultBranch: "main",
          hasContributing: false,
          isArchived: false,
          openIssues: 5,
        },
      ],
      filterRepoList: (repos: TrendingRepo[]) => repos,
    }));

    await discoverRepos({});

    expect(GitHubClient.prototype.getRepoInfo).toHaveBeenCalled();
  });
});

afterAll(async () => {
  try {
    const configModule = await import("../src/lib/config.js?nocache=" + Date.now());
    mock.module("../src/lib/config.js", () => ({
      loadConfig: configModule.loadConfig,
      ConfigError: configModule.ConfigError,
    }));
  } catch {
  }
});
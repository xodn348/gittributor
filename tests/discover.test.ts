import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitHubAPIError as _GitHubAPIErrorBinding, GitHubClient as _GitHubClientBinding } from "../src/lib/github";
import type { Issue, PRSubmission, Repository } from "../src/types/index";

const _realGitHubClient = _GitHubClientBinding;
const _realGitHubAPIError = _GitHubAPIErrorBinding;

let _currentGitHubClientClass: typeof _realGitHubClient = _realGitHubClient;

class GitHubClientMockWrapper {
  private readonly client: InstanceType<typeof _realGitHubClient>;

  constructor() {
    this.client = new _currentGitHubClientClass();
  }

  searchRepositories(opts: { minStars: number; languages: string[]; limit: number }): Promise<Repository[]> {
    return this.client.searchRepositories(opts);
  }

  searchIssues(repoFullName: string, opts: { labels: string[]; limit: number }): Promise<Issue[]> {
    return this.client.searchIssues(repoFullName, opts);
  }

  forkRepo(repoFullName: string): Promise<string> {
    return this.client.forkRepo(repoFullName);
  }

  createBranch(repoPath: string, branchName: string): Promise<void> {
    return this.client.createBranch(repoPath, branchName);
  }

  commitAndPush(repoPath: string, message: string, branchName: string): Promise<void> {
    return this.client.commitAndPush(repoPath, message, branchName);
  }

  createPR(opts: { upstreamRepo: string; branchName: string; title: string; body: string }): Promise<PRSubmission> {
    return this.client.createPR(opts);
  }
}

function establishGitHubModuleMock(): void {
  mock.module("../src/lib/github", () => ({
    GitHubClient: GitHubClientMockWrapper,
    GitHubAPIError: _realGitHubAPIError,
  }));
}

establishGitHubModuleMock();

const searchRepositoriesMock = mock(async (_opts: { minStars: number; languages: string[]; limit: number }): Promise<Repository[]> => []);

let discoverModuleLoadCounter = 0;

async function loadDiscoverCommandWithGitHubMock(): Promise<typeof import("../src/commands/discover")> {
  _currentGitHubClientClass = class DiscoverGitHubClientMock extends _realGitHubClient {
    override searchRepositories(opts: { minStars: number; languages: string[]; limit: number }): Promise<Repository[]> {
      return searchRepositoriesMock(opts);
    }
  };

  discoverModuleLoadCounter += 1;
  return import(`../src/commands/discover.ts?cacheBust=${discoverModuleLoadCounter}`);
}

describe("discoverRepos", () => {
  const cwd = process.cwd();
  let tempDir: string;

  beforeEach(() => {
    searchRepositoriesMock.mockReset();
    tempDir = mkdtempSync(join(tmpdir(), "gittributor-discover-"));
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(cwd);
    rmSync(tempDir, { recursive: true, force: true });
    _currentGitHubClientClass = _realGitHubClient;
    mock.restore();
    establishGitHubModuleMock();
  });

  test("buildDiscoverQuery applies defaults and requested filters", async () => {
    const { buildDiscoverQuery } = await loadDiscoverCommandWithGitHubMock();
    const query = buildDiscoverQuery({ language: "TypeScript" });

    expect(query).toContain("language:TypeScript");
    expect(query).toContain("stars:>=50");
    expect(query).toContain("good-first-issues:>0");
    expect(query).toContain("sort=stars");
    expect(query).toContain("order=desc");
    expect(query).toContain("created:>=");
  });

  test("filters repositories to include only repos with good-first-issue signals", async () => {
    const { discoverRepos } = await loadDiscoverCommandWithGitHubMock();

    searchRepositoriesMock.mockResolvedValueOnce([
      {
        id: 1,
        name: "good",
        fullName: "octo/good",
        url: "https://github.com/octo/good",
        stars: 120,
        language: "TypeScript",
        openIssuesCount: 3,
        updatedAt: "2026-03-30T00:00:00.000Z",
        description: "good repo",
      },
      {
        id: 2,
        name: "bad",
        fullName: "octo/bad",
        url: "https://github.com/octo/bad",
        stars: 130,
        language: "TypeScript",
        openIssuesCount: 0,
        updatedAt: "2026-03-30T00:00:00.000Z",
        description: "bad repo",
      },
    ]);

    const result = await discoverRepos({ language: "TypeScript", minStars: 100, limit: 10 });

    expect(result).toHaveLength(1);
    expect(result[0]?.fullName).toBe("octo/good");
    expect(searchRepositoriesMock).toHaveBeenCalledWith({
      minStars: 100,
      languages: ["TypeScript"],
      limit: 10,
    });
  });

  test("returns empty list and persists an empty discoveries file when no repositories match", async () => {
    const { discoverRepos } = await loadDiscoverCommandWithGitHubMock();

    searchRepositoriesMock.mockResolvedValueOnce([]);

    const result = await discoverRepos({});

    expect(result).toEqual([]);
    const saved = JSON.parse(readFileSync(join(tempDir, ".gittributor", "discoveries.json"), "utf8"));
    expect(saved.repositories).toEqual([]);
    expect(typeof saved.discoveredAt).toBe("string");
  });

  test("writes ANSI-formatted discovery table to stdout", async () => {
    const { discoverRepos } = await loadDiscoverCommandWithGitHubMock();

    searchRepositoriesMock.mockResolvedValueOnce([
      {
        id: 3,
        name: "cli-tool",
        fullName: "octo/cli-tool",
        url: "https://github.com/octo/cli-tool",
        stars: 999,
        language: "Go",
        openIssuesCount: 7,
        updatedAt: "2026-03-30T00:00:00.000Z",
        description: "CLI utility",
      },
    ]);

    const chunks: string[] = [];
    const stdoutSpy = spyOn(process.stdout, "write").mockImplementation((...args) => {
      const [chunk] = args;
      chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    });

    await discoverRepos({ language: "Go", minStars: 100, limit: 10 });

    stdoutSpy.mockRestore();
    const output = chunks.join("");
    expect(output).toContain("\x1b[32m");
    expect(output).toContain("Repository");
    expect(output).toContain("octo/cli-tool");
    expect(output).toContain("https://github.com/octo/cli-tool");
  });
});

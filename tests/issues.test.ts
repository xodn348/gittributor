import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitHubAPIError as _GitHubAPIErrorBinding, GitHubClient as _GitHubClientBinding } from "../src/lib/github";
import type { Issue, Repository } from "../src/types";
import type { PRSubmission } from "../src/types/index";

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

const mockSearchIssues = mock(
  async (_repoFullName: string, _opts: { labels: string[]; limit: number }) => [] as Issue[],
);

let analyzeModuleLoadCounter = 0;

async function loadAnalyzeCommandWithGitHubMock(): Promise<typeof import("../src/commands/analyze")> {
  _currentGitHubClientClass = class AnalyzeGitHubClientMock extends _realGitHubClient {
    override searchIssues(repoFullName: string, opts: { labels: string[]; limit: number }): Promise<Issue[]> {
      return mockSearchIssues(repoFullName, opts);
    }
  };

  analyzeModuleLoadCounter += 1;
  return import(`../src/commands/analyze.ts?cacheBust=${analyzeModuleLoadCounter}`);
}

const repoFixture: Repository = {
  id: 1,
  name: "repo",
  fullName: "owner/repo",
  url: "https://github.com/owner/repo",
  stars: 123,
  language: "TypeScript",
  openIssuesCount: 20,
  updatedAt: "2026-03-30T00:00:00.000Z",
  description: "Repository for issue discovery tests",
};

const now = new Date("2026-03-31T00:00:00.000Z");

function makeIssue(overrides: Partial<Issue & { updatedAt: string }>): Issue {
  return {
    id: overrides.id ?? 1,
    number: overrides.number ?? 1,
    title: overrides.title ?? "Issue title",
    body:
      overrides.body ??
      "This issue includes clear details, reproducible steps, and expected behavior to implement.",
    url: overrides.url ?? "https://github.com/owner/repo/issues/1",
    repoFullName: overrides.repoFullName ?? "owner/repo",
    labels: overrides.labels ?? ["good first issue"],
    createdAt: overrides.createdAt ?? "2026-03-25T00:00:00.000Z",
    assignees: overrides.assignees ?? [],
    ...(overrides.updatedAt ? { updatedAt: overrides.updatedAt } : {}),
  } as Issue;
}

describe("discoverIssues", () => {
  const originalNow = Date.now;
  const originalCwd = process.cwd();
  let tempDir = "";

  beforeEach(async () => {
    Date.now = () => now.getTime();
    tempDir = await mkdtemp(join(tmpdir(), "gittributor-issues-"));
    process.chdir(tempDir);
    mockSearchIssues.mockReset();
  });

  afterEach(async () => {
    Date.now = originalNow;
    process.chdir(originalCwd);
    await rm(tempDir, { recursive: true, force: true });
    _currentGitHubClientClass = _realGitHubClient;
    mock.restore();
    establishGitHubModuleMock();
  });

  it("filters assigned issues", async () => {
    const { discoverIssues } = await loadAnalyzeCommandWithGitHubMock();

    mockSearchIssues.mockResolvedValue([
      makeIssue({ id: 1, number: 1, assignees: ["alice"] }),
      makeIssue({ id: 2, number: 2, assignees: [] }),
    ]);

    const issues = await discoverIssues(repoFixture);

    expect(issues).toHaveLength(1);
    expect(issues[0]?.number).toBe(2);
  });

  it("filters stale issues older than 30 days based on updatedAt", async () => {
    const { discoverIssues } = await loadAnalyzeCommandWithGitHubMock();

    mockSearchIssues.mockResolvedValue([
      makeIssue({ id: 1, number: 1, updatedAt: "2026-02-15T00:00:00.000Z" }),
      makeIssue({ id: 2, number: 2, updatedAt: "2026-03-10T00:00:00.000Z" }),
    ]);

    const issues = await discoverIssues(repoFixture);

    expect(issues).toHaveLength(1);
    expect(issues[0]?.number).toBe(2);
  });

  it("sorts by approachability score descending", async () => {
    const { discoverIssues } = await loadAnalyzeCommandWithGitHubMock();

    mockSearchIssues.mockResolvedValue([
      makeIssue({
        id: 10,
        number: 10,
        title: "High score issue",
        body: "Steps to reproduce: open app, click button, run test file parser.test.ts, fix in src/parser.ts for this specific small scope single file change.",
        updatedAt: "2026-03-30T00:00:00.000Z",
      }),
      makeIssue({
        id: 11,
        number: 11,
        title: "Lower score issue",
        body: "Please investigate unexpected behavior and propose a broad change.",
        updatedAt: "2026-03-30T00:00:00.000Z",
      }),
    ]);

    const issues = await discoverIssues(repoFixture);

    expect(issues).toHaveLength(2);
    expect(issues[0]?.number).toBe(10);
    expect((issues[0] as Issue & { approachabilityScore: number }).approachabilityScore).toBeGreaterThan(
      (issues[1] as Issue & { approachabilityScore: number }).approachabilityScore,
    );
  });

  it("returns empty array when no issues pass filters", async () => {
    const { discoverIssues } = await loadAnalyzeCommandWithGitHubMock();

    mockSearchIssues.mockResolvedValue([
      makeIssue({ id: 1, number: 1, assignees: ["alice"] }),
      makeIssue({
        id: 2,
        number: 2,
        updatedAt: "2026-02-20T00:00:00.000Z",
      }),
      makeIssue({
        id: 3,
        number: 3,
        body: "Too short",
      }),
    ]);

    const issues = await discoverIssues(repoFixture);
    expect(issues).toEqual([]);
  });

  it("persists discovered issues to .gittributor/issues.json", async () => {
    const { discoverIssues } = await loadAnalyzeCommandWithGitHubMock();

    const persisted = makeIssue({
      id: 99,
      number: 99,
      updatedAt: "2026-03-28T00:00:00.000Z",
      body: "Steps to reproduce: run app and inspect failing test in parser.test.ts. This is a small scope and likely single-file in src/parser.ts.",
    });
    mockSearchIssues.mockResolvedValue([persisted]);

    const issues = await discoverIssues(repoFixture);
    const filePath = join(tempDir, ".gittributor", "issues.json");
    const fileContents = await readFile(filePath, "utf8");
    const parsed = JSON.parse(fileContents) as Array<Issue & { approachabilityScore: number }>;

    expect(issues).toHaveLength(1);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.number).toBe(99);
    expect(parsed[0]?.approachabilityScore).toBeGreaterThanOrEqual(0);
  });
});

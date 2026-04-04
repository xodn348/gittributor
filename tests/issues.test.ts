import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitHubClient } from "../src/lib/github";
import type { Issue, Repository } from "../src/types";
import { acquireGlobalTestLock } from "./helpers/global-test-lock";

const { buildIssueProposalTable, discoverIssues } = await import("../src/commands/analyze");

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
    reactions: overrides.reactions,
    commentsCount: overrides.commentsCount,
    ...(overrides.updatedAt ? { updatedAt: overrides.updatedAt } : {}),
  } as Issue;
}

describe("discoverIssues", () => {
  const originalNow = Date.now;
  const originalCwd = process.cwd();
  let tempDir = "";
  let releaseGlobalLock: (() => void) | null = null;

  beforeEach(async () => {
    releaseGlobalLock = await acquireGlobalTestLock();
    Date.now = () => now.getTime();
    spyOn(GitHubClient.prototype, "searchIssues").mockResolvedValue([]);
    spyOn(GitHubClient.prototype, "getFileTree").mockResolvedValue([]);
    tempDir = await mkdtemp(join(tmpdir(), "gittributor-issues-"));
    process.chdir(tempDir);
  });

  afterEach(async () => {
    Date.now = originalNow;
    process.chdir(originalCwd);
    await rm(tempDir, { recursive: true, force: true });
    mock.restore();
    releaseGlobalLock?.();
    releaseGlobalLock = null;
  });

  it("filters assigned issues", async () => {
    spyOn(GitHubClient.prototype, "searchIssues").mockResolvedValue([
      makeIssue({ id: 1, number: 1, assignees: ["alice"] }),
      makeIssue({ id: 2, number: 2, assignees: [] }),
    ]);

    const issues = await discoverIssues(repoFixture);

    expect(issues).toHaveLength(1);
    expect(issues[0]?.number).toBe(2);
  });

  it("filters stale issues older than one year based on updatedAt", async () => {
    spyOn(GitHubClient.prototype, "searchIssues").mockResolvedValue([
      makeIssue({ id: 1, number: 1, updatedAt: "2024-02-15T00:00:00.000Z" }),
      makeIssue({ id: 2, number: 2, updatedAt: "2026-03-10T00:00:00.000Z" }),
    ]);

    const issues = await discoverIssues(repoFixture);

    expect(issues).toHaveLength(1);
    expect(issues[0]?.number).toBe(2);
  });

  it("sorts by approachability score descending", async () => {
    spyOn(GitHubClient.prototype, "searchIssues").mockResolvedValue([
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

  it("adds impact and codebase scores when reactions, comments, and file tree matches exist", async () => {
    spyOn(GitHubClient.prototype, "searchIssues").mockResolvedValue([
      makeIssue({
        id: 20,
        number: 20,
        title: "Auth bug in auth service",
        body: "Steps to reproduce are in src/auth/service.ts. Check the src/auth directory when login fails.",
        labels: ["good first issue", "bug"],
        reactions: 11,
        commentsCount: 6,
        updatedAt: "2026-03-30T00:00:00.000Z",
      }),
    ]);
    spyOn(GitHubClient.prototype, "getFileTree").mockResolvedValue([
      "src/auth/service.ts",
      "src/auth/index.ts",
      "src/parser.ts",
    ]);

    const issues = await discoverIssues(repoFixture);

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      impactScore: 5,
      codebaseScore: 6,
    });
    expect(issues[0]?.totalScore).toBe(
      issues[0]!.approachabilityScore + issues[0]!.impactScore + issues[0]!.codebaseScore,
    );
  });

  it("gracefully skips codebase scoring when file tree lookup fails", async () => {
    spyOn(GitHubClient.prototype, "searchIssues").mockResolvedValue([
      makeIssue({
        id: 21,
        number: 21,
        title: "Auth issue",
        body: "Please check auth flow with clear reproduction steps in src/auth/service.ts.",
        reactions: 3,
        updatedAt: "2026-03-30T00:00:00.000Z",
      }),
    ]);
    spyOn(GitHubClient.prototype, "getFileTree").mockResolvedValue([]);

    const issues = await discoverIssues(repoFixture);

    expect(issues).toHaveLength(1);
    expect(issues[0]?.codebaseScore).toBe(0);
  });

  it("returns empty array when no issues pass filters", async () => {
    spyOn(GitHubClient.prototype, "searchIssues").mockResolvedValue([
      makeIssue({ id: 1, number: 1, assignees: ["alice"] }),
      makeIssue({
        id: 2,
        number: 2,
        updatedAt: "2024-02-20T00:00:00.000Z",
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
    const persisted = makeIssue({
      id: 99,
      number: 99,
      updatedAt: "2026-03-28T00:00:00.000Z",
      body: "Steps to reproduce: run app and inspect failing test in parser.test.ts. This is a small scope and likely single-file in src/parser.ts.",
    });
    spyOn(GitHubClient.prototype, "searchIssues").mockResolvedValue([persisted]);

    const issues = await discoverIssues(repoFixture);
    const filePath = join(tempDir, ".gittributor", "issues.json");
    const fileContents = await readFile(filePath, "utf8");
    const parsed = JSON.parse(fileContents) as Array<
      Issue & { approachabilityScore: number; impactScore: number; codebaseScore: number; totalScore: number }
    >;

    expect(issues).toHaveLength(1);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.number).toBe(99);
    expect(parsed[0]?.approachabilityScore).toBeGreaterThanOrEqual(0);
    expect(parsed[0]?.impactScore).toBeGreaterThanOrEqual(0);
    expect(parsed[0]?.codebaseScore).toBeGreaterThanOrEqual(0);
  });

  it("builds a ranked issue proposal table for the top five issues", () => {
    const table = buildIssueProposalTable(repoFixture, [
      {
        ...makeIssue({
          id: 1,
          number: 101,
          title: "Top issue",
          reactions: 8,
        }),
        approachabilityScore: 5,
        impactScore: 3,
        codebaseScore: 2,
        totalScore: 10,
      },
      {
        ...makeIssue({ id: 2, number: 102, title: "Second issue", reactions: 2 }),
        approachabilityScore: 4,
        impactScore: 2,
        codebaseScore: 1,
        totalScore: 7,
      },
    ]);

    expect(table).toContain("TOP 5 FIXABLE ISSUES for owner/repo");
    expect(table).toContain("[1] #101  Top issue   (score: 10)");
    expect(table).toContain("Complexity: low | 👍 8 reactions");
    expect(table).toContain("Run 'gittributor fix' to fix issue #101");
  });
});

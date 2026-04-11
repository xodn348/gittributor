import { describe, expect, it } from "bun:test";
import { scoreIssue } from "../src/lib/issue-discovery";
import type { Issue } from "../src/types";

function makeIssue(overrides: Partial<Issue & { updatedAt?: string }> = {}): Issue {
  return {
    id: overrides.id ?? 1,
    number: overrides.number ?? 1,
    title: overrides.title ?? "Issue title",
    body: overrides.body ?? null,
    url: "https://github.com/owner/repo/issues/1",
    repoFullName: "owner/repo",
    labels: overrides.labels ?? [],
    createdAt: overrides.createdAt ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    assignees: overrides.assignees ?? [],
    commentsCount: overrides.commentsCount,
    ...(overrides.updatedAt ? { updatedAt: overrides.updatedAt } : {}),
  } as Issue;
}

describe("scoreIssue", () => {
  describe("label scoring", () => {
    it("security label adds 40 pts", () => {
      const issue = makeIssue({ labels: ["security vulnerability"] });
      const result = scoreIssue(issue);
      expect(result).not.toBeNull();
      expect(result!.totalScore).toBeGreaterThanOrEqual(40);
    });

    it("bug label adds 30 pts", () => {
      const issue = makeIssue({ labels: ["bug"] });
      const result = scoreIssue(issue);
      expect(result).not.toBeNull();
      expect(result!.totalScore).toBeGreaterThanOrEqual(30);
    });

    it("good-first-issue label adds 20 pts", () => {
      const issue = makeIssue({ labels: ["good-first-issue"] });
      const result = scoreIssue(issue);
      expect(result).not.toBeNull();
      expect(result!.totalScore).toBeGreaterThanOrEqual(20);
    });

    it("help-wanted label adds 15 pts", () => {
      const issue = makeIssue({ labels: ["help wanted"] });
      const result = scoreIssue(issue);
      expect(result).not.toBeNull();
      expect(result!.totalScore).toBeGreaterThanOrEqual(15);
    });

    it("enhancement label adds 10 pts", () => {
      const issue = makeIssue({ labels: ["enhancement"] });
      const result = scoreIssue(issue);
      expect(result).not.toBeNull();
      expect(result!.totalScore).toBeGreaterThanOrEqual(10);
    });

    it("multiple labels combine scores", () => {
      const issue = makeIssue({ labels: ["bug", "good-first-issue"] });
      const result = scoreIssue(issue);
      expect(result).not.toBeNull();
      expect(result!.totalScore).toBeGreaterThanOrEqual(50);
    });
  });

  describe("age scoring", () => {
    const realNow = Date.now();

    it("filters issues older than 180 days", () => {
      const old = makeIssue({ updatedAt: new Date(realNow - 200 * 24 * 60 * 60 * 1000).toISOString() });
      expect(scoreIssue(old)).toBeNull();
    });

    it("keeps issues updated within 180 days", () => {
      const recent = makeIssue({ updatedAt: new Date(realNow - 179 * 24 * 60 * 60 * 1000).toISOString() });
      const result = scoreIssue(recent);
      expect(result).not.toBeNull();
    });

    it("age < 7 days adds 20 pts", () => {
      const issue = makeIssue({ updatedAt: new Date(realNow - 5 * 24 * 60 * 60 * 1000).toISOString() });
      const result = scoreIssue(issue);
      expect(result!.impactScore).toBeGreaterThanOrEqual(20);
    });

    it("age < 30 days adds 15 pts", () => {
      const issue = makeIssue({ updatedAt: new Date(realNow - 20 * 24 * 60 * 60 * 1000).toISOString() });
      const result = scoreIssue(issue);
      expect(result!.impactScore).toBeGreaterThanOrEqual(15);
    });

    it("age < 90 days adds 10 pts", () => {
      const issue = makeIssue({ updatedAt: new Date(realNow - 60 * 24 * 60 * 60 * 1000).toISOString() });
      const result = scoreIssue(issue);
      expect(result!.impactScore).toBeGreaterThanOrEqual(10);
    });
  });

  describe("comment count scoring", () => {
    it("0 comments adds 15 pts", () => {
      const issue = makeIssue({ commentsCount: 0 });
      const result = scoreIssue(issue);
      expect(result!.approachabilityScore).toBeGreaterThanOrEqual(15);
    });

    it("1-3 comments adds 10 pts", () => {
      const issue = makeIssue({ commentsCount: 2 });
      const result = scoreIssue(issue);
      expect(result!.approachabilityScore).toBeGreaterThanOrEqual(10);
    });

    it("4-9 comments adds 5 pts", () => {
      const issue = makeIssue({ commentsCount: 6 });
      const result = scoreIssue(issue);
      expect(result!.approachabilityScore).toBeGreaterThanOrEqual(5);
    });

    it("10+ comments filters issue", () => {
      const issue = makeIssue({ commentsCount: 10 });
      expect(scoreIssue(issue)).toBeNull();
    });
  });

  describe("content pattern scoring", () => {
    it("reproduction steps in body adds 15 pts", () => {
      const issue = makeIssue({
        body: "Steps to reproduce the bug:\n1. Do X\n2. See Y",
      });
      const result = scoreIssue(issue);
      expect(result!.approachabilityScore).toBeGreaterThanOrEqual(15);
    });

    it("small scope in body adds 10 pts", () => {
      const issue = makeIssue({
        body: "This is a small scope issue in src/utils/helper.ts",
      });
      const result = scoreIssue(issue);
      expect(result!.approachabilityScore).toBeGreaterThanOrEqual(10);
    });

    it("impact patterns in title/body adds 20 pts", () => {
      const issue = makeIssue({
        title: "Critical security vulnerability",
        body: "The app crashes in production",
      });
      const result = scoreIssue(issue);
      expect(result!.impactScore).toBeGreaterThanOrEqual(20);
    });
  });

  describe("filtering", () => {
    it("filters assigned issues", () => {
      const issue = makeIssue({ assignees: ["alice"] });
      expect(scoreIssue(issue)).toBeNull();
    });

    it("filters issues with linked PR in body", () => {
      const issue = makeIssue({ body: "This is fixed in PR #123" });
      expect(scoreIssue(issue)).toBeNull();
    });

    it("filters issues with pull_request flag", () => {
      const issue = makeIssue({ body: "Issue body" }) as Issue & { pullRequest: boolean };
      issue.pullRequest = true;
      expect(scoreIssue(issue)).toBeNull();
    });
  });

  describe("multi-factor scoring", () => {
    it("bug + recent + no comments + repro = high score", () => {
      const issue = makeIssue({
        labels: ["bug"],
        updatedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
        commentsCount: 0,
        body: "Steps to reproduce the crash",
      });
      const result = scoreIssue(issue);
      expect(result).not.toBeNull();
      expect(result!.approachabilityScore).toBeGreaterThanOrEqual(30 + 15 + 15);
      expect(result!.impactScore).toBeGreaterThanOrEqual(20);
    });

    it("good-first-issue + no comments + no patterns = moderate score", () => {
      const issue = makeIssue({
        labels: ["good-first-issue"],
        commentsCount: 0,
        body: "Issue description without patterns",
      });
      const result = scoreIssue(issue);
      expect(result).not.toBeNull();
      expect(result!.totalScore).toBeGreaterThanOrEqual(20 + 15);
    });

    it("totalScore = approachabilityScore + impactScore", () => {
      const issue = makeIssue({
        labels: ["bug"],
        updatedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
        commentsCount: 0,
        body: "Steps to reproduce",
      });
      const result = scoreIssue(issue);
      expect(result!.totalScore).toBe(result!.approachabilityScore + result!.impactScore);
    });
  });
});

describe("discoverIssues rate limiting", () => {
  it("returns empty array when searchIssues throws rate limit error", async () => {
    const { discoverIssues } = await import("../src/lib/issue-discovery");
    const { GitHubClient } = await import("../src/lib/github");
    const { GitHubAPIError } = await import("../src/lib/errors");

    const mockError = new GitHubAPIError("HTTP 403 API rate limit exceeded", 1);

    const repo = {
      id: 1,
      name: "repo",
      fullName: "owner/repo",
      url: "https://github.com/owner/repo",
      stars: 100,
      language: null,
      openIssuesCount: 10,
      updatedAt: new Date().toISOString(),
      description: null,
    };

    const originalSearch = GitHubClient.prototype.searchIssues;
    GitHubClient.prototype.searchIssues = async () => {
      throw mockError;
    };

    try {
      const result = await discoverIssues(repo);
      expect(result).toEqual([]);
    } finally {
      GitHubClient.prototype.searchIssues = originalSearch;
    }
  });
});

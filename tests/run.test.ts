import { afterEach, beforeEach, describe, it, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "os";
import { join } from "node:path";
import type { AnalysisResult, Config, Issue, Repository, TrendingRepo } from "../src/types/index.js";
import type { RunDependencies } from "../src/commands/run.js";
import type { FixResult } from "../src/lib/fix-generator.js";

const mockConfig = (overrides: Partial<Config> = {}): Config => ({
  aiProvider: "anthropic",
  openaiModel: "gpt-5-mini",
  minStars: 50,
  maxPRsPerDay: 5,
  maxPRsPerRepo: 1,
  targetLanguages: ["typescript"],
  verbose: false,
  repoListPath: "repos.yaml",
  maxPRsPerWeekPerRepo: 2,
  maxPRsPerHour: 3,
  contributionTypes: ["docs", "typo", "deps", "test", "code"],
  historyPath: ".gittributor/history.json",
  dryRun: false,
  ...overrides,
});
import { acquireGlobalTestLock } from "./helpers/global-test-lock";

const mockRepository = (overrides: Partial<Repository> = {}): Repository => ({
  id: 1,
  name: "test-repo",
  fullName: "test-owner/test-repo",
  url: "https://github.com/test-owner/test-repo",
  stars: 5000,
  language: "TypeScript",
  openIssuesCount: 10,
  updatedAt: "2026-04-01T00:00:00.000Z",
  description: "A test repo",
  ...overrides,
});

const mockIssue = (overrides: Partial<Issue> = {}): Issue => ({
  id: 1,
  number: 1,
  title: "Test issue",
  body: "Test issue body",
  url: "https://github.com/test-owner/test-repo/issues/1",
  repoFullName: "test-owner/test-repo",
  labels: ["bug"],
  createdAt: "2026-04-01T00:00:00.000Z",
  assignees: [],
  ...overrides,
});

const mockAnalysisResult = (overrides: Partial<AnalysisResult> = {}): AnalysisResult => ({
  issueId: 0,
  repoFullName: "test-owner/test-repo",
  relevantFiles: ["src/test.ts"],
  suggestedApproach: "Add null check",
  confidence: 0.8,
  analyzedAt: new Date().toISOString(),
  rootCause: "Missing guard",
  affectedFiles: ["src/test.ts"],
  complexity: "low",
  ...overrides,
});

const mockFixResult = () => ({
  changes: [{ file: "src/test.ts", original: "foo", modified: "bar" }] as FixResult["changes"],
  explanation: "Added null check",
  confidence: 0.8,
});

const mockTrendingRepo = (overrides: Partial<TrendingRepo> = {}): TrendingRepo => ({
  owner: "test-owner",
  name: "test-repo",
  fullName: "test-owner/test-repo",
  stars: 5000,
  language: "TypeScript",
  description: "A test repo",
  isArchived: false,
  defaultBranch: "main",
  hasContributing: true,
  topics: ["good-first-issue"],
  openIssues: 10,
  ...overrides,
});

const makeDeps = (overrides: Partial<RunDependencies> = {}): RunDependencies => ({
  loadConfig: async () => mockConfig(),
  discoverRepos: async () => [],
  analyzeCodebase: async () => mockAnalysisResult(),
  generateFix: async () => mockFixResult(),
  reviewFix: async () => 0,
  submitApprovedFix: async () => 0,
  showHistoryStats: async () => {},
  ...overrides,
});

describe("run command V2 pipeline", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "gittributor-run-test-"));
    process.chdir(tempDir);
  });

  afterEach(async () => {
    process.chdir("/");
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("parseRunFlags", () => {
    it("parses --dry-run flag", async () => {
      const { parseRunFlags } = await import("../src/commands/run.js");
      const result = parseRunFlags(["--dry-run"]);
      expect(result.dryRun).toBe(true);
    });

    it("parses --stats flag", async () => {
      const { parseRunFlags } = await import("../src/commands/run.js");
      const result = parseRunFlags(["--stats"]);
      expect(result.stats).toBe(true);
    });

    it("parses --type=typo flag", async () => {
      const { parseRunFlags } = await import("../src/commands/run.js");
      const result = parseRunFlags(["--type=typo"]);
      expect(result.type).toBe("typo");
    });

    it("parses --type typo value style", async () => {
      const { parseRunFlags } = await import("../src/commands/run.js");
      const result = parseRunFlags(["--type", "docs"]);
      expect(result.type).toBe("docs");
    });

    it("parses multiple flags together", async () => {
      const { parseRunFlags } = await import("../src/commands/run.js");
      const result = parseRunFlags(["--dry-run", "--stats", "--type=typo"]);
      expect(result.dryRun).toBe(true);
      expect(result.stats).toBe(true);
      expect(result.type).toBe("typo");
    });

    it("returns empty options for no flags", async () => {
      const { parseRunFlags } = await import("../src/commands/run.js");
      const result = parseRunFlags([]);
      expect(result).toEqual({});
    });

    it("rejects invalid type values", async () => {
      const { parseRunFlags } = await import("../src/commands/run.js");
      const result = parseRunFlags(["--type=invalid"]);
      expect(result.type).toBeNull();
    });
  });

  describe("runOrchestrator", () => {
    it("calls all pipeline stages when no flags set", async () => {
      const { runOrchestrator } = await import("../src/commands/run.js");

      let order: string[] = [];
      const deps = makeDeps({
        discoverRepos: async () => {
          order.push("discover");
          return [mockTrendingRepo()];
        },
        analyzeCodebase: async () => {
          order.push("analyze");
          return mockAnalysisResult();
        },
        generateFix: async () => {
          order.push("fix");
          return mockFixResult();
        },
        reviewFix: async () => {
          order.push("review");
          return 0;
        },
        submitApprovedFix: async () => {
          order.push("submit");
          return 0;
        },
      });

      const exitCode = await runOrchestrator({}, deps);
      expect(exitCode).toBe(0);
      expect(order).toEqual(["discover", "analyze", "fix", "review", "submit"]);
    });

    it("calls analyze and review (auto-approved) in --dry-run mode but skips fix/submit", async () => {
      const { runOrchestrator } = await import("../src/commands/run.js");

      let analyzeCalled = false;
      let fixCalled = false;
      let reviewCalled = false;
      let reviewAutoApprove: boolean | undefined;
      let submitCalled = false;

      const deps = makeDeps({
        discoverRepos: async () => [mockTrendingRepo()],
        analyzeCodebase: async () => { analyzeCalled = true; return mockAnalysisResult(); },
        generateFix: async () => { fixCalled = true; return mockFixResult(); },
        reviewFix: async (opts) => { reviewCalled = true; reviewAutoApprove = opts?.autoApprove; return 0; },
        submitApprovedFix: async () => { submitCalled = true; return 0; },
      });

      const exitCode = await runOrchestrator({ dryRun: true }, deps);

      expect(exitCode).toBe(0);
      expect(analyzeCalled).toBe(true);
      expect(fixCalled).toBe(false);
      expect(reviewCalled).toBe(true);
      expect(reviewAutoApprove).toBe(true);
      expect(submitCalled).toBe(false);
    });

    it("calls --stats before pipeline starts", async () => {
      const { runOrchestrator } = await import("../src/commands/run.js");

      let statsCalled = false;
      let discoverCalled = false;

      const deps = makeDeps({
        showHistoryStats: async () => { statsCalled = true; },
        discoverRepos: async () => { discoverCalled = true; return []; },
      });

      await runOrchestrator({ stats: true }, deps);

      expect(statsCalled).toBe(true);
      expect(discoverCalled).toBe(true);
    });

    it("does not call generateFix/review/submit when no repos discovered", async () => {
      const { runOrchestrator } = await import("../src/commands/run.js");

      let fixCalled = false;
      let reviewCalled = false;
      let submitCalled = false;

      const deps = makeDeps({
        discoverRepos: async () => [],
        generateFix: async () => { fixCalled = true; return mockFixResult(); },
        reviewFix: async () => { reviewCalled = true; return 0; },
        submitApprovedFix: async () => { submitCalled = true; return 0; },
      });

      const exitCode = await runOrchestrator({}, deps);

      expect(exitCode).toBe(0);
      expect(fixCalled).toBe(false);
      expect(reviewCalled).toBe(false);
      expect(submitCalled).toBe(false);
    });

    it("skips analyze when no repos discovered", async () => {
      const { runOrchestrator } = await import("../src/commands/run.js");

      let analyzeCalled = false;

      const deps = makeDeps({
        discoverRepos: async () => [],
        analyzeCodebase: async () => { analyzeCalled = true; return mockAnalysisResult(); },
      });

      const exitCode = await runOrchestrator({}, deps);

      expect(exitCode).toBe(0);
      expect(analyzeCalled).toBe(false);
    });

    it("passes autoApprove to review in dry-run mode", async () => {
      const { runOrchestrator } = await import("../src/commands/run.js");

      let passedAutoApprove: boolean | undefined = undefined;

      const deps = makeDeps({
        discoverRepos: async () => [mockTrendingRepo()],
        analyzeCodebase: async () => mockAnalysisResult(),
        generateFix: async () => mockFixResult(),
        reviewFix: async (opts) => {
          passedAutoApprove = opts?.autoApprove;
          return 0;
        },
        submitApprovedFix: async () => 0,
      });

      await runOrchestrator({ dryRun: true }, deps);

      expect(passedAutoApprove ?? false).toBe(true);
    });
  });

  describe("V2 pipeline integration", () => {
    it("passes Repository to analyzeCodebase for each discovered repo", async () => {
      const { runOrchestrator } = await import("../src/commands/run.js");

      const repo1 = mockTrendingRepo({ fullName: "owner/repo1" });
      const repo2 = mockTrendingRepo({ fullName: "owner/repo2" });

      let passedRepos: Repository[] = [];

      const deps = makeDeps({
        discoverRepos: async () => [repo1, repo2],
        analyzeCodebase: async (repo: Repository) => {
          passedRepos.push(repo);
          return mockAnalysisResult({ repoFullName: repo.fullName });
        },
        generateFix: async () => mockFixResult(),
        reviewFix: async () => 0,
        submitApprovedFix: async () => 0,
      });

      await runOrchestrator({}, deps);

      expect(passedRepos.length).toBe(2);
      expect(passedRepos[0]?.fullName).toBe("owner/repo1");
      expect(passedRepos[1]?.fullName).toBe("owner/repo2");
    });

    it("generates fix after successful analysis", async () => {
      const { runOrchestrator } = await import("../src/commands/run.js");

      let fixCallCount = 0;

      const deps = makeDeps({
        discoverRepos: async () => [mockTrendingRepo()],
        analyzeCodebase: async () => mockAnalysisResult(),
        generateFix: async () => { fixCallCount++; return mockFixResult(); },
        reviewFix: async () => 0,
        submitApprovedFix: async () => 0,
      });

      await runOrchestrator({}, deps);

      expect(fixCallCount).toBe(1);
    });
  });
});

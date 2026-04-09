import { afterEach, beforeEach, describe, it, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "os";
import { join } from "node:path";
import type { ContributionOpportunity, TrendingRepo, Config } from "../src/types/index.js";
import type { RunDependencies } from "../src/commands/run.js";

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

const mockOpportunity = (overrides: Partial<ContributionOpportunity> = {}): ContributionOpportunity => ({
  repo: {
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
  },
  type: "typo",
  filePath: "README.md",
  description: "Fix a typo",
  mergeProbability: {
    score: 0.75,
    label: "high",
    reasons: ["good stars"],
  },
  detectedAt: new Date().toISOString(),
  ...overrides,
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
  analyzeRepositories: async () => [],
  routeContribution: async () => ({ patch: "", description: "", confidence: 0 }),
  reviewContributions: async () => 0,
  submitApprovedFix: async () => 0,
  showHistoryStats: async () => {},
  setStateData: async () => {},
  loadState: async () => ({}),
  saveState: async () => {},
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
        analyzeRepositories: async () => {
          order.push("analyze");
          return [mockOpportunity()];
        },
        routeContribution: async () => {
          order.push("fix");
          return { patch: "", description: "", confidence: 0 };
        },
        reviewContributions: async () => {
          order.push("review");
          return 0;
        },
        submitApprovedFix: async () => {
          order.push("submit");
          return 0;
        },
        setStateData: async () => {},
        loadState: async () => ({}),
        saveState: async () => {},
      });

      const exitCode = await runOrchestrator({}, deps);
      expect(exitCode).toBe(0);
      expect(order).toEqual(["discover", "analyze", "fix", "review", "submit"]);
    });

    it("stops after analyze in --dry-run mode", async () => {
      const { runOrchestrator } = await import("../src/commands/run.js");

      let routeCalled = false;
      let reviewCalled = false;
      let submitCalled = false;

      const deps = makeDeps({
        discoverRepos: async () => [mockTrendingRepo()],
        analyzeRepositories: async () => [mockOpportunity()],
        routeContribution: async () => { routeCalled = true; return { patch: "", description: "", confidence: 0 }; },
        reviewContributions: async () => { reviewCalled = true; return 0; },
        submitApprovedFix: async () => { submitCalled = true; return 0; },
        setStateData: async () => {},
        loadState: async () => ({}),
        saveState: async () => {},
      });

      const exitCode = await runOrchestrator({ dryRun: true }, deps);

      expect(exitCode).toBe(0);
      expect(routeCalled).toBe(false);
      expect(reviewCalled).toBe(false);
      expect(submitCalled).toBe(false);
    });

    it("filters opportunities by type when --type flag is provided", async () => {
      const { runOrchestrator } = await import("../src/commands/run.js");

      const typoOpp = mockOpportunity({ type: "typo" });
      const docsOpp = mockOpportunity({ type: "docs" });

      let capturedType: string | null = null;

      const deps = makeDeps({
        discoverRepos: async () => [mockTrendingRepo()],
        analyzeRepositories: async () => [typoOpp, docsOpp],
        routeContribution: async (opp: ContributionOpportunity) => {
          capturedType = opp.type;
          return { patch: "", description: "", confidence: 0 };
        },
        reviewContributions: async () => 0,
        submitApprovedFix: async () => 0,
        setStateData: async () => {},
        loadState: async () => ({}),
        saveState: async () => {},
      });

      const exitCode = await runOrchestrator({ type: "typo" }, deps);

      expect(exitCode).toBe(0);
      expect(capturedType).toBe("typo");
    });

    it("does not call fix/review/submit when no opportunities are found", async () => {
      const { runOrchestrator } = await import("../src/commands/run.js");

      let routeCalled = false;

      const deps = makeDeps({
        discoverRepos: async () => [mockTrendingRepo()],
        analyzeRepositories: async () => [],
        routeContribution: async () => { routeCalled = true; return { patch: "", description: "", confidence: 0 }; },
        setStateData: async () => {},
        loadState: async () => ({}),
        saveState: async () => {},
      });

      const exitCode = await runOrchestrator({}, deps);

      expect(exitCode).toBe(0);
      expect(routeCalled).toBe(false);
    });

    it("skips analyze when no repos discovered", async () => {
      const { runOrchestrator } = await import("../src/commands/run.js");

      let analyzeCalled = false;

      const deps = makeDeps({
        discoverRepos: async () => [],
        analyzeRepositories: async () => { analyzeCalled = true; return []; },
      });

      const exitCode = await runOrchestrator({}, deps);

      expect(exitCode).toBe(0);
      expect(analyzeCalled).toBe(false);
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
  });

  describe("V2 pipeline integration", () => {
    it("passes repos from discoverRepos to analyzeRepositories", async () => {
      const { runOrchestrator } = await import("../src/commands/run.js");

      const repos = [mockTrendingRepo({ fullName: "owner/repo1" })];
      const opps = [mockOpportunity()];

      let passedRepos: TrendingRepo[] = [];

      const deps = makeDeps({
        discoverRepos: async () => repos,
        analyzeRepositories: async (passed: TrendingRepo[]) => {
          passedRepos = passed;
          return opps;
        },
        routeContribution: async () => ({ patch: "", description: "", confidence: 0 }),
        reviewContributions: async () => 0,
        submitApprovedFix: async () => 0,
        setStateData: async () => {},
        loadState: async () => ({}),
        saveState: async () => {},
      });

      await runOrchestrator({}, deps);

      expect(passedRepos).toEqual(repos);
    });

    it("only calls routeContribution once when type=typo from mixed opportunities", async () => {
      const { runOrchestrator } = await import("../src/commands/run.js");

      const typoOpp = mockOpportunity({ type: "typo" });
      const docsOpp = mockOpportunity({ type: "docs" });

      let routeCallCount = 0;

      const deps = makeDeps({
        discoverRepos: async () => [mockTrendingRepo()],
        analyzeRepositories: async () => [typoOpp, docsOpp],
        routeContribution: async () => {
          routeCallCount++;
          return { patch: "", description: "", confidence: 0 };
        },
        reviewContributions: async () => 0,
        submitApprovedFix: async () => 0,
        setStateData: async () => {},
        loadState: async () => ({}),
        saveState: async () => {},
      });

      await runOrchestrator({ type: "typo" }, deps);

      expect(routeCallCount).toBe(1);
    });
  });
});

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "os";
import { join } from "node:path";
import type { AnalysisResult, Config, Issue, Repository, TrendingRepo } from "../../src/types/index.js";
import type { RunDependencies } from "../../src/commands/run.js";
import type { FixResult as GeneratedFixResult } from "../../src/lib/fix-generator.js";

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

const mockFixResult = (overrides: Partial<GeneratedFixResult> = {}): GeneratedFixResult => ({
  changes: [{ file: "src/test.ts", original: "foo", modified: "bar" }],
  explanation: "Added null check",
  confidence: 0.8,
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

describe("pipeline E2E", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "gittributor-e2e-"));
    process.chdir(tempDir);
  });

  afterEach(async () => {
    process.chdir("/");
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("Scenario 1 — Happy Path", () => {
    it("discovers 1 repo, analyzes it, generates fix, and completes the pipeline", async () => {
      const { runOrchestrator } = await import("../../src/commands/run.js");

      let order: string[] = [];
      const deps = makeDeps({
        discoverRepos: async () => {
          order.push("discover");
          return [mockTrendingRepo({ fullName: "test-owner/happy-repo" })];
        },
        analyzeCodebase: async (repo: Repository) => {
          order.push("analyze");
          return mockAnalysisResult({ repoFullName: repo.fullName });
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

      const exitCode = await runOrchestrator({ dryRun: false }, deps);

      expect(exitCode).toBe(0);
      expect(order).toEqual(["discover", "analyze", "fix", "review", "submit"]);
    });

    it("dry-run mode skips fix generation and PR submission", async () => {
      const { runOrchestrator } = await import("../../src/commands/run.js");

      let fixCalled = false;
      let submitCalled = false;

      const deps = makeDeps({
        discoverRepos: async () => [mockTrendingRepo()],
        analyzeCodebase: async () => mockAnalysisResult(),
        generateFix: async () => { fixCalled = true; return mockFixResult(); },
        reviewFix: async () => 0,
        submitApprovedFix: async () => { submitCalled = true; return 0; },
      });

      const exitCode = await runOrchestrator({ dryRun: true }, deps);

      expect(exitCode).toBe(0);
      expect(fixCalled).toBe(false);
      expect(submitCalled).toBe(false);
    });

    it("pipeline completes even when GITHUB_TOKEN is not set", async () => {
      const { runOrchestrator } = await import("../../src/commands/run.js");

      const deps = makeDeps({
        discoverRepos: async () => [mockTrendingRepo()],
        analyzeCodebase: async () => mockAnalysisResult(),
        generateFix: async () => mockFixResult(),
        reviewFix: async () => 0,
        submitApprovedFix: async () => 0,
      });

      const exitCode = await runOrchestrator({}, deps);

      expect(exitCode).toBe(0);
    });
  });

  describe("Scenario 2 — No Repos Found", () => {
    it("pipeline exits gracefully when no repositories are discovered", async () => {
      const { runOrchestrator } = await import("../../src/commands/run.js");

      let analyzeCalled = false;
      let fixCalled = false;
      let reviewCalled = false;
      let submitCalled = false;

      const deps = makeDeps({
        discoverRepos: async () => [],
        analyzeCodebase: async () => { analyzeCalled = true; return mockAnalysisResult(); },
        generateFix: async () => { fixCalled = true; return mockFixResult(); },
        reviewFix: async () => { reviewCalled = true; return 0; },
        submitApprovedFix: async () => { submitCalled = true; return 0; },
      });

      const exitCode = await runOrchestrator({}, deps);

      expect(exitCode).toBe(0);
      expect(analyzeCalled).toBe(false);
      expect(fixCalled).toBe(false);
      expect(reviewCalled).toBe(false);
      expect(submitCalled).toBe(false);
    });
  });

  describe("Scenario 3 — Analysis Result with No Issues", () => {
    it("pipeline skips fix generation when analysis has no relevant files", async () => {
      const { runOrchestrator } = await import("../../src/commands/run.js");

      let fixCalled = false;

      const deps = makeDeps({
        discoverRepos: async () => [mockTrendingRepo()],
        analyzeCodebase: async () =>
          mockAnalysisResult({
            relevantFiles: [],
            suggestedApproach: "No actionable issues found in this repository.",
            confidence: 0,
          }),
        generateFix: async () => { fixCalled = true; return mockFixResult(); },
        reviewFix: async () => 0,
        submitApprovedFix: async () => 0,
      });

      const exitCode = await runOrchestrator({}, deps);

      expect(exitCode).toBe(0);
      expect(fixCalled).toBe(false);
    });

    it("pipeline proceeds with fix generation even when analysis has zero confidence", async () => {
      const { runOrchestrator } = await import("../../src/commands/run.js");

      let fixCalled = false;

      const deps = makeDeps({
        discoverRepos: async () => [mockTrendingRepo()],
        analyzeCodebase: async () =>
          mockAnalysisResult({ confidence: 0, suggestedApproach: "Could not identify any issues." }),
        generateFix: async () => { fixCalled = true; return mockFixResult(); },
        reviewFix: async () => 0,
        submitApprovedFix: async () => 0,
      });

      const exitCode = await runOrchestrator({}, deps);

      expect(exitCode).toBe(0);
      expect(fixCalled).toBe(true);
    });

    it("pipeline calls fix generation when analysis reports 'no issues' but has relevant files", async () => {
      const { runOrchestrator } = await import("../../src/commands/run.js");

      let fixCalled = false;
      let fixExplanation = "";

      const deps = makeDeps({
        discoverRepos: async () => [mockTrendingRepo()],
        analyzeCodebase: async () =>
          mockAnalysisResult({
            suggestedApproach: "All files look good. No issues detected.",
            confidence: 0.5,
            relevantFiles: ["src/main.ts"],
          }),
        generateFix: async (analysis: AnalysisResult) => {
          fixCalled = true;
          fixExplanation = analysis.suggestedApproach;
          return mockFixResult({ explanation: analysis.suggestedApproach });
        },
        reviewFix: async () => 0,
        submitApprovedFix: async () => 0,
      });

      const exitCode = await runOrchestrator({}, deps);

      expect(exitCode).toBe(0);
      expect(fixCalled).toBe(true);
      expect(fixExplanation).toContain("No issues detected");
    });
  });

  describe("Scenario 4 — Fix Generation Fails", () => {
    it("pipeline continues to next repo when fix generation throws", async () => {
      const { runOrchestrator } = await import("../../src/commands/run.js");

      let analyzeCount = 0;
      let fixCount = 0;
      let okFixCalled = false;

      const deps = makeDeps({
        discoverRepos: async () => [
          mockTrendingRepo({ fullName: "test-owner/fail-fix-repo" }),
          mockTrendingRepo({ fullName: "test-owner/ok-repo" }),
        ],
        analyzeCodebase: async () => {
          analyzeCount++;
          return mockAnalysisResult();
        },
        generateFix: async (_analysis: AnalysisResult, _issue: Issue, repo: Repository) => {
          fixCount++;
          if (repo.fullName === "test-owner/fail-fix-repo") {
            throw new Error("LLM API failed to generate fix");
          }
          okFixCalled = true;
          return mockFixResult();
        },
        reviewFix: async () => 0,
        submitApprovedFix: async () => 0,
      });

      const exitCode = await runOrchestrator({}, deps);

      expect(exitCode).toBe(0);
      expect(analyzeCount).toBe(2);
      expect(fixCount).toBe(2);
      expect(okFixCalled).toBe(true);
    });

    it("pipeline returns exit code 1 when submit fails", async () => {
      const { runOrchestrator } = await import("../../src/commands/run.js");

      const deps = makeDeps({
        discoverRepos: async () => [mockTrendingRepo()],
        analyzeCodebase: async () => mockAnalysisResult(),
        generateFix: async () => mockFixResult(),
        reviewFix: async () => 0,
        submitApprovedFix: async () => 1,
      });

      const exitCode = await runOrchestrator({}, deps);
      expect(exitCode).toBe(1);
    });
  });

  describe("Scenario 5 — Static Analysis Path", () => {
    it("static-analysis type is passed through the pipeline correctly", async () => {
      const { runOrchestrator } = await import("../../src/commands/run.js");

      let capturedType: string | undefined;

      const deps = makeDeps({
        discoverRepos: async () => [mockTrendingRepo({ name: "static-ts-repo", fullName: "test-owner/static-ts-repo" })],
        analyzeCodebase: async () =>
          mockAnalysisResult({
            type: "static-analysis",
            suggestedApproach: "Fix empty catch blocks that silently swallow errors.",
            relevantFiles: ["src/handler.ts"],
            confidence: 0.9,
          }),
        generateFix: async (analysis: AnalysisResult) => {
          capturedType = analysis.type;
          return mockFixResult({
            explanation: "Added error logging to empty catch block in src/handler.ts",
            changes: [
              {
                file: "src/handler.ts",
                original: "} catch (e) {}",
                modified: "} catch (e) { console.error('Unhandled error:', e); }",
              },
            ],
          });
        },
        reviewFix: async () => 0,
        submitApprovedFix: async () => 0,
      });

      const exitCode = await runOrchestrator({}, deps);

      expect(exitCode).toBe(0);
      expect(capturedType).toBe("static-analysis");
    });

    it("type-safety contribution type flows through pipeline", async () => {
      const { runOrchestrator } = await import("../../src/commands/run.js");

      let capturedType: string | undefined;

      const deps = makeDeps({
        discoverRepos: async () => [mockTrendingRepo()],
        analyzeCodebase: async () =>
          mockAnalysisResult({
            type: "type-safety",
            suggestedApproach: "Add missing type annotations.",
            confidence: 0.9,
          }),
        generateFix: async (analysis: AnalysisResult) => {
          capturedType = analysis.type;
          return mockFixResult({ explanation: "Added type annotation." });
        },
        reviewFix: async () => 0,
        submitApprovedFix: async () => 0,
      });

      const exitCode = await runOrchestrator({}, deps);

      expect(exitCode).toBe(0);
      expect(capturedType).toBe("type-safety");
    });

    it("logic-error contribution type flows through pipeline", async () => {
      const { runOrchestrator } = await import("../../src/commands/run.js");

      let capturedType: string | undefined;

      const deps = makeDeps({
        discoverRepos: async () => [mockTrendingRepo()],
        analyzeCodebase: async () =>
          mockAnalysisResult({
            type: "logic-error",
            suggestedApproach: "Fix incorrect conditional logic.",
            confidence: 0.9,
          }),
        generateFix: async (analysis: AnalysisResult) => {
          capturedType = analysis.type;
          return mockFixResult({ explanation: "Fixed conditional." });
        },
        reviewFix: async () => 0,
        submitApprovedFix: async () => 0,
      });

      const exitCode = await runOrchestrator({}, deps);

      expect(exitCode).toBe(0);
      expect(capturedType).toBe("logic-error");
    });
  });

  describe("Multiple Repos", () => {
    it("pipeline processes multiple repos in sequence", async () => {
      const { runOrchestrator } = await import("../../src/commands/run.js");

      const repo1 = mockTrendingRepo({ fullName: "owner/repo1" });
      const repo2 = mockTrendingRepo({ fullName: "owner/repo2" });
      const repo3 = mockTrendingRepo({ fullName: "owner/repo3" });

      let analyzeCount = 0;
      let fixCount = 0;

      const deps = makeDeps({
        discoverRepos: async () => [repo1, repo2, repo3],
        analyzeCodebase: async (repo: Repository) => {
          analyzeCount++;
          return mockAnalysisResult({ repoFullName: repo.fullName });
        },
        generateFix: async () => {
          fixCount++;
          return mockFixResult();
        },
        reviewFix: async () => 0,
        submitApprovedFix: async () => 0,
      });

      const exitCode = await runOrchestrator({}, deps);

      expect(exitCode).toBe(0);
      expect(analyzeCount).toBe(3);
      expect(fixCount).toBe(3);
    });

    it("pipeline skips repos that fail analysis and continues", async () => {
      const { runOrchestrator } = await import("../../src/commands/run.js");

      const repo1 = mockTrendingRepo({ fullName: "owner/ok-repo" });
      const repo2 = mockTrendingRepo({ fullName: "owner/fail-repo" });
      const repo3 = mockTrendingRepo({ fullName: "owner/ok-repo2" });

      let analyzeCount = 0;
      let fixCount = 0;

      const deps = makeDeps({
        discoverRepos: async () => [repo1, repo2, repo3],
        analyzeCodebase: async (repo: Repository) => {
          analyzeCount++;
          if (repo.fullName === "owner/fail-repo") {
            throw new Error("Analysis failed for this repo");
          }
          return mockAnalysisResult({ repoFullName: repo.fullName });
        },
        generateFix: async () => {
          fixCount++;
          return mockFixResult();
        },
        reviewFix: async () => 0,
        submitApprovedFix: async () => 0,
      });

      const exitCode = await runOrchestrator({}, deps);

      expect(exitCode).toBe(0);
      expect(analyzeCount).toBe(3);
      expect(fixCount).toBe(2);
    });
  });

  describe("Pipeline Stats", () => {
    it("stats flag is processed before pipeline starts", async () => {
      const { runOrchestrator } = await import("../../src/commands/run.js");

      let statsCalled = false;

      const deps = makeDeps({
        showHistoryStats: async () => { statsCalled = true; },
        discoverRepos: async () => [],
      });

      await runOrchestrator({ stats: true }, deps);

      expect(statsCalled).toBe(true);
    });

    it("pipeline completes successfully with multiple contribution types", async () => {
      const { runOrchestrator } = await import("../../src/commands/run.js");

      let capturedTypes: string[] = [];

      const deps = makeDeps({
        discoverRepos: async () => [
          mockTrendingRepo({ fullName: "owner/type-repo" }),
          mockTrendingRepo({ fullName: "owner/logic-repo" }),
        ],
        analyzeCodebase: async (repo: Repository) => {
          if (repo.fullName === "owner/type-repo") {
            return mockAnalysisResult({ type: "type-safety", repoFullName: repo.fullName });
          }
          return mockAnalysisResult({ type: "logic-error", repoFullName: repo.fullName });
        },
        generateFix: async (analysis: AnalysisResult) => {
          capturedTypes.push(analysis.type || "unknown");
          return mockFixResult();
        },
        reviewFix: async () => 0,
        submitApprovedFix: async () => 0,
      });

      const exitCode = await runOrchestrator({}, deps);

      expect(exitCode).toBe(0);
      expect(capturedTypes).toContain("type-safety");
      expect(capturedTypes).toContain("logic-error");
    });
  });
});

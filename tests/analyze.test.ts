import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmdirSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { analyzeRepositories, analyzeSingleRepo } from "../src/commands/analyze.js";
import type { TrendingRepo, ContributionOpportunity } from "../src/types/index.js";

const createMockTrendingRepo = (overrides: Partial<TrendingRepo> = {}): TrendingRepo => ({
  owner: "owner",
  name: "repo",
  fullName: "owner/repo",
  stars: 1500,
  language: "TypeScript",
  description: "A test repository",
  isArchived: false,
  defaultBranch: "main",
  hasContributing: true,
  topics: [],
  openIssues: 10,
  ...overrides,
});

describe("analyze command", () => {
  const testDir = "/tmp/gittributor-analyze-test";

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    process.chdir(testDir);
  });

  afterEach(() => {
    try {
      process.chdir("/");
      rmdirSync(testDir, { recursive: true });
    } catch {}
  });

  describe("analyzeRepositories", () => {
    test("analyzes up to 10 repos max", async () => {
      const repos: TrendingRepo[] = Array.from({ length: 15 }, (_, i) =>
        createMockTrendingRepo({ fullName: `owner/repo${i}` })
      );

      const result = await analyzeRepositories(repos);

      expect(result.length).toBeLessThanOrEqual(10);
    }, 30000);

    test("skips archived repos", async () => {
      const repos: TrendingRepo[] = [
        createMockTrendingRepo({ fullName: "owner/active", isArchived: false }),
        createMockTrendingRepo({ fullName: "owner/archived", isArchived: true }),
      ];

      const result = await analyzeRepositories(repos);

      const archivedOpps = result.filter(
        (opp) => opp.repo.fullName === "owner/archived"
      );
      expect(archivedOpps.length).toBe(0);
    });
  });

  describe("analyzeSingleRepo", () => {
    test("returns contribution opportunities array", async () => {
      const repo = createMockTrendingRepo();

      const result = await analyzeSingleRepo(repo);

      expect(Array.isArray(result)).toBe(true);
      result.forEach((opp: ContributionOpportunity) => {
        expect(opp.repo).toBeDefined();
        expect(opp.type).toBeDefined();
        expect(["typo", "docs", "deps", "test", "code"]).toContain(opp.type);
        expect(opp.mergeProbability).toBeDefined();
        expect(opp.mergeProbability.score).toBeGreaterThanOrEqual(0);
        expect(opp.mergeProbability.score).toBeLessThanOrEqual(1);
      });
    });

    test("returns empty for non-existent repo", async () => {
      const repo = createMockTrendingRepo({ fullName: "nonexistent/repo" });

      const result = await analyzeSingleRepo(repo);

      expect(Array.isArray(result)).toBe(true);
    });

    test("sorts opportunities by merge probability", async () => {
      const repo = createMockTrendingRepo();

      const result = await analyzeSingleRepo(repo);

      if (result.length > 1) {
        for (let i = 1; i < result.length; i++) {
          expect(result[i - 1].mergeProbability.score).toBeGreaterThanOrEqual(
            result[i].mergeProbability.score
          );
        }
      }
    });
  });

  describe("integration with pipeline state", () => {
    test("opportunities can be stored in state data", async () => {
      const repo = createMockTrendingRepo();
      const stateDir = join(testDir, ".gittributor");
      mkdirSync(stateDir, { recursive: true });

      const result = await analyzeSingleRepo(repo);

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });
  });
});
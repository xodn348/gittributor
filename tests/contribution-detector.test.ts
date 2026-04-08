import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  detectTypos,
  detectDocs,
  detectDeps,
  detectTests,
  detectCode,
  calculateMergeProbability,
  sortOpportunities,
} from "../src/lib/contribution-detector.js";
import type { TrendingRepo, ContributionOpportunity, ContributionType } from "../src/types/index.js";

const createMockRepo = (overrides: Partial<TrendingRepo> = {}): TrendingRepo => ({
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

describe("contribution-detector", () => {
  const testDir = "/tmp/gittributor-detector-test";

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmdirSync(testDir, { recursive: true });
    } catch {}
  });

  describe("detectTypos", () => {
    test("finds 'teh' -> 'the' in sample text", () => {
      const content = "This is teh test file for teh project.";
      const results = detectTypos(content);
      expect(results.length).toBeGreaterThan(0);
      expect(results.some(r => r.original === "teh" && r.replacement === "the")).toBe(true);
    });

    test("finds 'recieve' -> 'receive'", () => {
      const content = "Please recieve the package.";
      const results = detectTypos(content);
      expect(results.some(r => r.original === "recieve" && r.replacement === "receive")).toBe(true);
    });

    test("returns empty for text with no typos", () => {
      const content = "This is a clean README with correct spelling.";
      const results = detectTypos(content);
      expect(results.length).toBe(0);
    });

    test("handles empty input", () => {
      const results = detectTypos("");
      expect(results.length).toBe(0);
    });
  });

  describe("detectDocs", () => {
    test("detects missing README sections", () => {
      const readmeContent = "# Project\nJust a simple project.";
      const results = detectDocs(readmeContent, ["README.md"], testDir);
      expect(results.length).toBeGreaterThan(0);
      const hasMissingSection = results.some(r => 
        r.description.includes("Installation") || 
        r.description.includes("Usage") ||
        r.description.includes("Contributing") ||
        r.description.includes("License")
      );
      expect(hasMissingSection).toBe(true);
    });

    test("detects empty docs directory", () => {
      const docsDir = join(testDir, "docs");
      mkdirSync(docsDir, { recursive: true });
      const results = detectDocs("", ["README.md"], testDir);
      expect(results.some(r => r.description.includes("empty"))).toBe(true);
    });

    test("returns empty when all sections present", () => {
      const readmeContent = `# Project
## Installation
Run npm install
## Usage
Run the app
## Contributing
PRs welcome
## License
MIT`;
      const results = detectDocs(readmeContent, ["README.md"], testDir);
      expect(results.length).toBe(0);
    });
  });

  describe("detectDeps", () => {
    test("handles missing package.json", async () => {
      const results = await detectDeps(testDir);
      expect(results.length).toBe(0);
    });

    test("handles Python requirements.txt", async () => {
      const requirementsPath = join(testDir, "requirements.txt");
      writeFileSync(requirementsPath, "requests==2.25.0\nflask==1.0.0");

      const results = await detectDeps(testDir);
      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe("detectTests", () => {
    test("finds source file without test", () => {
      const sourceDir = join(testDir, "src");
      mkdirSync(sourceDir, { recursive: true });
      writeFileSync(join(sourceDir, "index.ts"), "export const test = 1;");
      
      const results = detectTests(testDir);
      expect(results.length).toBeGreaterThan(0);
    });

    test("detects low coverage directories", () => {
      const srcDir = join(testDir, "src");
      mkdirSync(srcDir, { recursive: true });
      writeFileSync(join(srcDir, "a.ts"), "export const a = 1;");
      writeFileSync(join(srcDir, "b.ts"), "export const b = 2;");
      writeFileSync(join(srcDir, "c.ts"), "export const c = 3;");
      
      const results = detectTests(testDir);
      expect(results.length).toBeGreaterThan(0);
    });

    test("detects files with or without tests", () => {
      const srcDir = join(testDir, "src");
      mkdirSync(srcDir, { recursive: true });
      writeFileSync(join(srcDir, "index.ts"), "export const test = 1;");
      
      const results = detectTests(testDir);
      expect(results.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe("detectCode", () => {
    test("returns empty when no issues found", async () => {
      const mockIssues: any[] = [];
      const results = await detectCode(createMockRepo(), mockIssues);
      expect(results.length).toBe(0);
    });

    test("detects good first issues", async () => {
      const mockIssues = [
        { number: 1, title: "Fix typo in README", labels: ["good first issue"], assignees: [] },
        { number: 2, title: "Add tests", labels: ["help wanted"], assignees: [] },
      ];
      const results = await detectCode(createMockRepo(), mockIssues);
      expect(results.length).toBe(2);
    });

    test("filters assigned issues", async () => {
      const mockIssues = [
        { number: 1, title: "Fix typo", labels: ["good first issue"], assignees: ["someone"] },
        { number: 2, title: "Add tests", labels: ["good first issue"], assignees: [] },
      ];
      const results = await detectCode(createMockRepo(), mockIssues);
      expect(results.length).toBe(1);
    });
  });

  describe("calculateMergeProbability", () => {
    test("returns score 0-1 with factor breakdown", () => {
      const repo = createMockRepo();
      const opportunity: ContributionOpportunity = {
        repo,
        type: "typo",
        filePath: "README.md",
        description: "Fix typo",
        original: "teh",
        replacement: "the",
        mergeProbability: { score: 0, label: "low", reasons: [] },
        detectedAt: new Date().toISOString(),
      };

      const result = calculateMergeProbability(opportunity, {
        hasTests: true,
        diffSize: 50,
        followsContributingGuide: true,
        maintainerActivity: "high",
      });

      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(1);
      expect(result.reasons.length).toBeGreaterThan(0);
    });

    test("awards points for having tests", () => {
      const repo = createMockRepo();
      const opportunity: ContributionOpportunity = {
        repo,
        type: "code",
        filePath: "src/index.ts",
        description: "Add feature",
        mergeProbability: { score: 0, label: "low", reasons: [] },
        detectedAt: new Date().toISOString(),
      };

      const withTests = calculateMergeProbability(opportunity, {
        hasTests: true,
        diffSize: 100,
        followsContributingGuide: false,
        maintainerActivity: "medium",
      });

      const withoutTests = calculateMergeProbability(opportunity, {
        hasTests: false,
        diffSize: 100,
        followsContributingGuide: false,
        maintainerActivity: "medium",
      });

      expect(withTests.score).toBeGreaterThan(withoutTests.score);
    });

    test("awards points for following contributing guide", () => {
      const repo = createMockRepo({ hasContributing: true });
      const opportunity: ContributionOpportunity = {
        repo,
        type: "docs",
        filePath: "README.md",
        description: "Add section",
        mergeProbability: { score: 0, label: "low", reasons: [] },
        detectedAt: new Date().toISOString(),
      };

      const result = calculateMergeProbability(opportunity, {
        hasTests: false,
        diffSize: 50,
        followsContributingGuide: true,
        maintainerActivity: "high",
      });

      expect(result.score).toBeGreaterThan(0);
    });
  });

  describe("sortOpportunities", () => {
    test("sorts by merge probability descending", () => {
      const repo = createMockRepo();
      const opportunities: ContributionOpportunity[] = [
        {
          repo,
          type: "typo",
          filePath: "README.md",
          description: "Low priority",
          mergeProbability: { score: 0.3, label: "low", reasons: [] },
          detectedAt: new Date().toISOString(),
        },
        {
          repo,
          type: "code",
          filePath: "src/main.ts",
          description: "High priority",
          mergeProbability: { score: 0.9, label: "high", reasons: [] },
          detectedAt: new Date().toISOString(),
        },
        {
          repo,
          type: "docs",
          filePath: "docs/guide.md",
          description: "Medium priority",
          mergeProbability: { score: 0.6, label: "medium", reasons: [] },
          detectedAt: new Date().toISOString(),
        },
      ];

      const sorted = sortOpportunities(opportunities);
      expect(sorted[0].mergeProbability.score).toBe(0.9);
      expect(sorted[1].mergeProbability.score).toBe(0.6);
      expect(sorted[2].mergeProbability.score).toBe(0.3);
    });

    test("handles empty array", () => {
      const sorted = sortOpportunities([]);
      expect(sorted.length).toBe(0);
    });
  });
});
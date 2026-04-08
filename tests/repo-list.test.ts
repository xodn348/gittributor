import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { loadRepoList, filterRepoList } from "../src/lib/repo-list";

const TEST_DIR = join(import.meta.dir, "fixtures", "repo-list");

describe("repo-list", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  describe("loadRepoList", () => {
    it("loads valid YAML and returns TrendingRepo array", () => {
      const validYaml = `repos:
  - owner: facebook
    name: react
    stars: 220000
    language: JavaScript
    description: "The library for web and native user interfaces"
    topics: ["javascript", "library"]
    defaultBranch: main
`;
      const yamlPath = join(TEST_DIR, "repos.yaml");
      writeFileSync(yamlPath, validYaml);

      const repos = loadRepoList(yamlPath);

      expect(repos).toHaveLength(1);
      expect(repos[0].owner).toBe("facebook");
      expect(repos[0].name).toBe("react");
      expect(repos[0].stars).toBe(220000);
      expect(repos[0].language).toBe("JavaScript");
      expect(repos[0].description).toBe("The library for web and native user interfaces");
      expect(repos[0].topics).toEqual(["javascript", "library"]);
      expect(repos[0].defaultBranch).toBe("main");
      expect(repos[0].hasContributing).toBe(false);
      expect(repos[0].isArchived).toBe(false);
      expect(repos[0].openIssues).toBe(0);
    });

    it("throws descriptive error if file not found", () => {
      const missingPath = join(TEST_DIR, "nonexistent.yaml");

      expect(() => loadRepoList(missingPath)).toThrow(/not found/i);
    });

    it("throws descriptive error if YAML is invalid", () => {
      const invalidYaml = `repos:
  - owner: facebook
    name: react
    stars: !!invalid
`;
      const yamlPath = join(TEST_DIR, "invalid.yaml");
      writeFileSync(yamlPath, invalidYaml);

      expect(() => loadRepoList(yamlPath)).toThrow(/YAML|i18n|parse|unknown|token/i);
    });
  });

  describe("filterRepoList", () => {
    const testRepos = [
      {
        owner: "facebook",
        name: "react",
        fullName: "facebook/react",
        stars: 220000,
        language: "JavaScript",
        description: "UI library",
        topics: ["javascript", "library"],
        defaultBranch: "main",
        hasContributing: false,
        isArchived: false,
        openIssues: 0,
      },
      {
        owner: "microsoft",
        name: "vscode",
        fullName: "microsoft/vscode",
        stars: 150000,
        language: "TypeScript",
        description: "Code editor",
        topics: ["editor", " IDE"],
        defaultBranch: "main",
        hasContributing: false,
        isArchived: false,
        openIssues: 0,
      },
      {
        owner: "golang",
        name: "go",
        fullName: "golang/go",
        stars: 110000,
        language: "Go",
        description: "Programming language",
        topics: ["go", "language"],
        defaultBranch: "main",
        hasContributing: false,
        isArchived: false,
        openIssues: 0,
      },
      {
        owner: "rust-lang",
        name: "rust",
        fullName: "rust-lang/rust",
        stars: 90000,
        language: "Rust",
        description: "Programming language",
        topics: ["rust", "compiler"],
        defaultBranch: "master",
        hasContributing: false,
        isArchived: false,
        openIssues: 0,
      },
    ];

    it("filters by minimum stars", () => {
      const filtered = filterRepoList(testRepos, { minStars: 100000 });

      expect(filtered).toHaveLength(3);
      expect(filtered.every((r) => r.stars >= 100000)).toBe(true);
    });

    it("filters by language", () => {
      const filtered = filterRepoList(testRepos, { languages: ["JavaScript", "TypeScript"] });

      expect(filtered).toHaveLength(2);
      expect(filtered.every((r) => r.language === "JavaScript" || r.language === "TypeScript")).toBe(true);
    });

    it("filters by exclude repos", () => {
      const filtered = filterRepoList(testRepos, { excludeRepos: ["facebook/react"] });

      expect(filtered).toHaveLength(3);
      expect(filtered.every((r) => r.owner + "/" + r.name !== "facebook/react")).toBe(true);
    });

    it("filters by topics", () => {
      const filtered = filterRepoList(testRepos, { topics: ["library"] });

      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe("react");
    });

    it("always enforces minimum 1000 stars regardless of input", () => {
      const filtered = filterRepoList(testRepos, { minStars: 500 });

      expect(filtered).toHaveLength(4);
      expect(filtered.every((r) => r.stars >= 1000)).toBe(true);
    });

    it("combines multiple filters", () => {
      const filtered = filterRepoList(testRepos, {
        minStars: 100000,
        languages: ["JavaScript", "TypeScript"],
      });

      expect(filtered).toHaveLength(2);
      expect(filtered.every((r) => r.stars >= 100000)).toBe(true);
      expect(filtered.every((r) => r.language === "JavaScript" || r.language === "TypeScript")).toBe(true);
    });
  });
});
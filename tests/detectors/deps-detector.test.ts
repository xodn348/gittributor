import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "path";
import type { ContributionOpportunity } from "../../src/types/index";
import {
  parsePackageJson,
  checkOutdatedDeps,
  generateVersionBump,
} from "../../src/lib/detectors/deps-detector.js";

describe("deps-detector", () => {
  let previousCwd = "";
  let tempDir = "";

  beforeEach(async () => {
    previousCwd = process.cwd();
    tempDir = await mkdtemp(path.join(tmpdir(), "gittributor-deps-"));
    process.chdir(tempDir);
  });

  afterEach(async () => {
    process.chdir(previousCwd);
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("parsePackageJson", () => {
    it("parses valid package.json", () => {
      const pkg = {
        name: "test-package",
        version: "1.0.0",
        dependencies: {
          express: "4.0.0",
          lodash: "^4.0.0",
        },
      };

      const deps = parsePackageJson(pkg);

      expect(deps.express).toBe("4.0.0");
      expect(deps.lodash).toBe("^4.0.0");
    });

    it("returns empty object for invalid input", () => {
      const result = parsePackageJson(null);

      expect(result).toEqual({});
    });
  });

  describe("checkOutdatedDeps", () => {
    it("identifies outdated express version", async () => {
      const deps = { express: "4.0.0" };

      const result = await checkOutdatedDeps(deps);

      const expressOutdated = result.find((d) => d.packageName === "express");
      expect(expressOutdated).toBeDefined();
      expect(expressOutdated?.currentVersion).toBe("4.0.0");
      expect(expressOutdated?.latestVersion).toBeDefined();
    });
  });

  describe("generateVersionBump", () => {
    it("generates version bump patch for express", () => {
      const opportunity: ContributionOpportunity = {
        repo: {
          owner: "test",
          name: "repo",
          fullName: "test/repo",
          stars: 100,
          language: "TypeScript",
          description: "Test repo",
          isArchived: false,
          defaultBranch: "main",
          hasContributing: false,
          topics: [],
          openIssues: 5,
        },
        type: "deps",
        filePath: "package.json",
        description: "Update express",
        packageName: "express",
        oldVersion: "4.0.0",
        newVersion: "4.18.0",
        mergeProbability: { score: 0.8, label: "high", reasons: [] },
        detectedAt: "2026-04-01T00:00:00.000Z",
      };

      const result = generateVersionBump(opportunity);

      expect(result.patch).toContain('"express"');
      expect(result.patch).toContain('"4.18.0"');
      expect(result.patch).not.toContain('"4.0.0"');
      expect(result.description).toContain("express");
      expect(result.confidence).toBeGreaterThan(0.7);
    });

    it("handles caret version prefixes", () => {
      const opportunity: ContributionOpportunity = {
        repo: {
          owner: "test",
          name: "repo",
          fullName: "test/repo",
          stars: 100,
          language: "TypeScript",
          description: "Test repo",
          isArchived: false,
          defaultBranch: "main",
          hasContributing: false,
          topics: [],
          openIssues: 5,
        },
        type: "deps",
        filePath: "package.json",
        description: "Update lodash",
        packageName: "lodash",
        oldVersion: "^4.0.0",
        newVersion: "4.18.0",
        mergeProbability: { score: 0.8, label: "high", reasons: [] },
        detectedAt: "2026-04-01T00:00:00.000Z",
      };

      const result = generateVersionBump(opportunity);

      expect(result.patch).toContain("lodash");
      expect(result.patch).toContain("4.18.0");
    });

    it("handles tilde version prefixes", () => {
      const opportunity: ContributionOpportunity = {
        repo: {
          owner: "test",
          name: "repo",
          fullName: "test/repo",
          stars: 100,
          language: "TypeScript",
          description: "Test repo",
          isArchived: false,
          defaultBranch: "main",
          hasContributing: false,
          topics: [],
          openIssues: 5,
        },
        type: "deps",
        filePath: "package.json",
        description: "Update lodash",
        packageName: "lodash",
        oldVersion: "~4.0.0",
        newVersion: "4.18.2",
        mergeProbability: { score: 0.8, label: "high", reasons: [] },
        detectedAt: "2026-04-01T00:00:00.000Z",
      };

      const result = generateVersionBump(opportunity);

      expect(result.patch).toContain("lodash");
    });
  });
});
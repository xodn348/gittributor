import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "path";
import type { ContributionOpportunity, ContributionType } from "../src/types/index";
import { acquireGlobalTestLock } from "./helpers/global-test-lock";
import { callModel as _callModelBinding } from "../src/lib/ai";

const _realCallModel = _callModelBinding;

let _currentCallModelImpl: (options: {
  apiKey: string;
  system: string;
  prompt: string;
  maxTokens: number;
}) => Promise<string> = _realCallModel;

const establishModelMock = (): void => {
  mock.module("../src/lib/ai", () => ({
    callModel: (options: { apiKey: string; system: string; prompt: string; maxTokens: number }) =>
      _currentCallModelImpl(options),
  }));
};

const createOpportunity = (overrides: Partial<ContributionOpportunity> = {}): ContributionOpportunity => ({
  repo: {
    owner: "acme",
    name: "demo",
    fullName: "acme/demo",
    stars: 100,
    language: "TypeScript",
    description: "Demo",
    isArchived: false,
    defaultBranch: "main",
    hasContributing: false,
    topics: [],
    openIssues: 10,
  },
  type: "typo",
  filePath: "README.md",
  description: "Fix typo",
  mergeProbability: { score: 0.8, label: "high", reasons: [] },
  detectedAt: "2026-04-01T00:00:00.000Z",
  ...overrides,
});

let fixRouterModuleLoadCounter = 0;

function loadFixRouterWithModelMock(
  impl: (options: { apiKey: string; system: string; prompt: string; maxTokens: number }) => Promise<string>,
): Promise<typeof import("../src/lib/fix-router")> {
  _currentCallModelImpl = impl;
  fixRouterModuleLoadCounter += 1;
  return import(`../src/lib/fix-router.ts?cacheBust=${fixRouterModuleLoadCounter}`);
}

describe("fix-router", () => {
  let previousCwd = "";
  let tempDir = "";
  let releaseGlobalLock: (() => void) | null = null;

  beforeEach(async () => {
    releaseGlobalLock = await acquireGlobalTestLock();
    establishModelMock();
    previousCwd = process.cwd();
    tempDir = await mkdtemp(path.join(tmpdir(), "gittributor-fix-router-"));
    process.chdir(tempDir);
  });

  afterEach(async () => {
    process.chdir(previousCwd);
    await rm(tempDir, { recursive: true, force: true });
    _currentCallModelImpl = _realCallModel;
    mock.restore();
    establishModelMock();
    releaseGlobalLock?.();
    releaseGlobalLock = null;
  });

  describe("routeContribution", () => {
    it("returns FixResult with patch and description for typo type", async () => {
      const { routeContribution } = await import("../src/lib/fix-router.ts");

      const opportunity = createOpportunity({
        type: "typo",
        filePath: "README.md",
        original: "teh",
        replacement: "the",
      });

      const result = await routeContribution(opportunity);

      expect(result.patch).toContain("the");
      expect(result.patch).not.toContain("teh");
      expect(result.description).toBeDefined();
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it("returns FixResult with patch for docs type", async () => {
      const { routeContribution } = await import("../src/lib/fix-router.ts");

      const opportunity = createOpportunity({
        type: "docs",
        filePath: "README.md",
        section: "Installation",
      });

      const result = await routeContribution(opportunity);

      expect(result.patch).toContain("Installation");
      expect(result.description).toBeDefined();
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it("returns FixResult with patch for deps type", async () => {
      const { routeContribution } = await import("../src/lib/fix-router.ts");

      const opportunity = createOpportunity({
        type: "deps",
        filePath: "package.json",
        packageName: "express",
        oldVersion: "4.0.0",
        newVersion: "4.18.0",
      });

      const result = await routeContribution(opportunity);

      expect(result.patch).toContain("4.18.0");
      expect(result.description).toBeDefined();
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it("calls AI provider for test type", async () => {
      const { routeContribution } = await loadFixRouterWithModelMock(async () => {
        return JSON.stringify({
          patch: "import { describe, it, expect } from 'bun:test';\n\ndescribe('foo', () => {\n  it('works', () => {\n    expect(true).toBe(true);\n  });\n});",
          description: "Generated test skeleton",
          confidence: 0.85,
        });
      });

      const opportunity = createOpportunity({
        type: "test",
        filePath: "tests/foo.test.ts",
        description: "Add tests for foo function",
      });

      const result = await routeContribution(opportunity);

      expect(result.patch).toContain("describe");
      expect(result.patch).toContain("it");
      expect(result.description).toBe("Generated test skeleton");
      expect(result.confidence).toBe(0.85);
    });

    it("calls AI provider for code type", async () => {
      const { routeContribution } = await loadFixRouterWithModelMock(async () => {
        return JSON.stringify({
          patch: "export function add(a: number, b: number): number {\n  return a + b;\n}",
          description: "Fixed arithmetic operation",
          confidence: 0.9,
        });
      });

      const opportunity = createOpportunity({
        type: "code",
        filePath: "src/math.ts",
        description: "Add function to handle addition",
      });

      const result = await routeContribution(opportunity);

      expect(result.patch).toContain("export function add");
      expect(result.description).toBe("Fixed arithmetic operation");
      expect(result.confidence).toBe(0.9);
    });

    it("throws error for unknown contribution type", async () => {
      const { routeContribution } = await import("../src/lib/fix-router.ts");

      const opportunity = createOpportunity({
        type: "typo" as ContributionType,
      });
      (opportunity as ContributionOpportunity & { type: string }).type = "unknown" as ContributionType;

      await expect(routeContribution(opportunity)).rejects.toThrow();
    });
  });

  describe("typo route", () => {
    it("produces correct patch for 'teh' → 'the'", async () => {
      const { routeContribution } = await import("../src/lib/fix-router.ts");

      const opportunity = createOpportunity({
        type: "typo",
        filePath: "README.md",
        original: "teh",
        replacement: "the",
      });

      const result = await routeContribution(opportunity);

      expect(result.patch).toBe("the");
    });

    it("handles multiple typo fixes in one file", async () => {
      const { routeContribution } = await import("../src/lib/fix-router.ts");

      const opportunity = createOpportunity({
        type: "typo",
        filePath: "README.md",
        original: "adn",
        replacement: "and",
      });

      const result = await routeContribution(opportunity);

      expect(result.patch).toBe("and");
    });
  });

  describe("docs route", () => {
    it("generates missing README section", async () => {
      const { routeContribution } = await import("../src/lib/fix-router.ts");

      const opportunity = createOpportunity({
        type: "docs",
        filePath: "README.md",
        section: "Installation",
      });

      const result = await routeContribution(opportunity);

      expect(result.patch).toContain("Installation");
      expect(result.patch).toContain("## Installation");
    });

    it("generates Usage section when missing", async () => {
      const { routeContribution } = await import("../src/lib/fix-router.ts");

      const opportunity = createOpportunity({
        type: "docs",
        filePath: "README.md",
        section: "Usage",
      });

      const result = await routeContribution(opportunity);

      expect(result.patch).toContain("Usage");
      expect(result.patch).toContain("## Usage");
    });
  });

  describe("deps route", () => {
    it("bumps outdated version string", async () => {
      const { routeContribution } = await import("../src/lib/fix-router.ts");

      const opportunity = createOpportunity({
        type: "deps",
        filePath: "package.json",
        packageName: "express",
        oldVersion: "4.0.0",
        newVersion: "4.18.0",
      });

      const result = await routeContribution(opportunity);

      expect(result.patch).toContain('"express"');
      expect(result.patch).toContain('"4.18.0"');
      expect(result.patch).not.toContain('"4.0.0"');
    });
  });
});
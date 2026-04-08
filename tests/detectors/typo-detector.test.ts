import { describe, expect, it } from "bun:test";
import type { ContributionOpportunity } from "../../src/types/index";
import { detectTypos, createTypoFix } from "../../src/lib/detectors/typo-detector.js";

describe("typo-detector", () => {
  describe("detectTypos", () => {
    it("detects 'teh' as typo of 'the'", () => {
      const content = "teh quick brown fox";
      const opportunities = detectTypos(content, "README.md");

      expect(opportunities.length).toBeGreaterThan(0);
      const tehTypo = opportunities.find((o) => o.original === "teh");
      expect(tehTypo).toBeDefined();
      expect(tehTypo?.replacement).toBe("the");
    });

    it("detects 'adn' as typo of 'and'", () => {
      const content = "foo adn bar";
      const opportunities = detectTypos(content, "README.md");

      const adnTypo = opportunities.find((o) => o.original === "adn");
      expect(adnTypo).toBeDefined();
      expect(adnTypo?.replacement).toBe("and");
    });

    it("detects 'htes' as typo of 'the'", () => {
      const content = "htes quick";
      const opportunities = detectTypos(content, "docs/readme.txt");

      const htesTypo = opportunities.find((o) => o.original === "htes");
      expect(htesTypo).toBeDefined();
      expect(htesTypo?.replacement).toBe("the");
    });

    it("detects 'recieved' as typo of 'received'", () => {
      const content = "I recieved the package";
      const opportunities = detectTypos(content, "CHANGELOG.md");

      const recievedTypo = opportunities.find((o) => o.original === "recieved");
      expect(recievedTypo).toBeDefined();
      expect(recievedTypo?.replacement).toBe("received");
    });

    it("detects 'occured' as typo of 'occurred'", () => {
      const content = "An error occured";
      const opportunities = detectTypos(content, "README.md");

      const occuredTypo = opportunities.find((o) => o.original === "occured");
      expect(occuredTypo).toBeDefined();
      expect(occuredTypo?.replacement).toBe("occurred");
    });

    it("does not detect typos in code files", () => {
      const content = "const teh = 'value'";
      const opportunities = detectTypos(content, "src/main.ts");

      expect(opportunities.length).toBe(0);
    });

    it("detects typos in markdown files", () => {
      const content = "# Heading\n\nteh is wrong";
      const opportunities = detectTypos(content, "README.md");

      expect(opportunities.length).toBeGreaterThan(0);
    });

    it("detects typos in txt files", () => {
      const content = "This has occured";
      const opportunities = detectTypos(content, "notes.txt");

      expect(opportunities.length).toBeGreaterThan(0);
    });

    it("detects typos in rst files", () => {
      const content = "This is teh documentation";
      const opportunities = detectTypos(content, "docs/index.rst");

      expect(opportunities.length).toBeGreaterThan(0);
    });

    it("returns empty for non-text files", () => {
      const content = "some content";
      const opportunities = detectTypos(content, "image.png");

      expect(opportunities.length).toBe(0);
    });
  });

  describe("createTypoFix", () => {
    it("creates patch replacing typo with correction", () => {
      const opportunity: ContributionOpportunity = {
        repo: {
          owner: "test",
          name: "repo",
          fullName: "test/repo",
          stars: 100,
          language: "TypeScript",
          description: "Test",
          isArchived: false,
          defaultBranch: "main",
          hasContributing: false,
          topics: [],
          openIssues: 5,
        },
        type: "typo",
        filePath: "README.md",
        description: "Fix typo",
        original: "teh",
        replacement: "the",
        mergeProbability: { score: 0.8, label: "high", reasons: [] },
        detectedAt: "2026-04-01T00:00:00.000Z",
      };

      const fix = createTypoFix(opportunity);

      expect(fix.patch).toBe("the");
      expect(fix.description).toContain("typo");
      expect(fix.confidence).toBeGreaterThan(0.8);
    });

    it("handles multiple word typos", () => {
      const opportunity: ContributionOpportunity = {
        repo: {
          owner: "test",
          name: "repo",
          fullName: "test/repo",
          stars: 100,
          language: "TypeScript",
          description: "Test",
          isArchived: false,
          defaultBranch: "main",
          hasContributing: false,
          topics: [],
          openIssues: 5,
        },
        type: "typo",
        filePath: "README.md",
        description: "Fix typo",
        original: "adn",
        replacement: "and",
        mergeProbability: { score: 0.8, label: "high", reasons: [] },
        detectedAt: "2026-04-01T00:00:00.000Z",
      };

      const fix = createTypoFix(opportunity);

      expect(fix.patch).toBe("and");
    });
  });
});
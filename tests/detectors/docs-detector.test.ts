import { describe, expect, it } from "bun:test";
import type { ContributionOpportunity } from "../../src/types/index";
import { detectMissingSections, generateDocsSection } from "../../src/lib/detectors/docs-detector.js";

describe("docs-detector", () => {
  describe("detectMissingSections", () => {
    it("detects missing Installation section", () => {
      const content = "# Demo\n\n## Usage\n\n## License\n";
      const opportunities = detectMissingSections(content, "README.md");

      const installOpp = opportunities.find((o) => o.section === "Installation");
      expect(installOpp).toBeDefined();
    });

    it("detects missing Usage section", () => {
      const content = "# Demo\n\n## Installation\n\n## License\n";
      const opportunities = detectMissingSections(content, "README.md");

      const usageOpp = opportunities.find((o) => o.section === "Usage");
      expect(usageOpp).toBeDefined();
    });

    it("detects missing Contributing section", () => {
      const content = "# Demo\n\n## Usage\n\n## License\n";
      const opportunities = detectMissingSections(content, "README.md");

      const contribOpp = opportunities.find((o) => o.section === "Contributing");
      expect(contribOpp).toBeDefined();
    });

    it("detects missing License section", () => {
      const content = "# Demo\n\n## Installation\n\n## Usage\n";
      const opportunities = detectMissingSections(content, "README.md");

      const licenseOpp = opportunities.find((o) => o.section === "License");
      expect(licenseOpp).toBeDefined();
    });

    it("returns empty when all sections present", () => {
      const content = "# Demo\n\n## Installation\n\n## Usage\n\n## Contributing\n\n## License\n";
      const opportunities = detectMissingSections(content, "README.md");

      expect(opportunities.length).toBe(0);
    });

    it("detects missing badges", () => {
      const content = "# Demo\n\n## Installation\n";
      const opportunities = detectMissingSections(content, "README.md");

      const badgeOpp = opportunities.find((o) => o.section === "Badges");
      expect(badgeOpp).toBeDefined();
    });
  });

  describe("generateDocsSection", () => {
    it("generates Installation section template", () => {
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
        type: "docs",
        filePath: "README.md",
        description: "Add installation section",
        section: "Installation",
        mergeProbability: { score: 0.8, label: "high", reasons: [] },
        detectedAt: "2026-04-01T00:00:00.000Z",
      };

      const result = generateDocsSection(opportunity);

      expect(result.patch).toContain("## Installation");
      expect(result.patch).toContain("```bash");
      expect(result.patch).toContain("bun install");
    });

    it("generates Usage section template", () => {
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
        type: "docs",
        filePath: "README.md",
        description: "Add usage section",
        section: "Usage",
        mergeProbability: { score: 0.8, label: "high", reasons: [] },
        detectedAt: "2026-04-01T00:00:00.000Z",
      };

      const result = generateDocsSection(opportunity);

      expect(result.patch).toContain("## Usage");
      expect(result.patch).toContain("```");
    });

    it("generates Contributing section template", () => {
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
        type: "docs",
        filePath: "README.md",
        description: "Add contributing section",
        section: "Contributing",
        mergeProbability: { score: 0.8, label: "high", reasons: [] },
        detectedAt: "2026-04-01T00:00:00.000Z",
      };

      const result = generateDocsSection(opportunity);

      expect(result.patch).toContain("## Contributing");
      expect(result.patch).toContain("issues");
    });

    it("generates License section template", () => {
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
        type: "docs",
        filePath: "README.md",
        description: "Add license section",
        section: "License",
        mergeProbability: { score: 0.8, label: "high", reasons: [] },
        detectedAt: "2026-04-01T00:00:00.000Z",
      };

      const result = generateDocsSection(opportunity);

      expect(result.patch).toContain("## License");
      expect(result.patch).toContain("MIT");
    });
  });
});
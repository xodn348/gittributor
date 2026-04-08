import type { ContributionOpportunity } from "../../types/index.js";

const REQUIRED_SECTIONS = ["Installation", "Usage", "Contributing", "License"];

export function detectMissingSections(
  content: string,
  filePath: string,
): ContributionOpportunity[] {
  const isMarkdownOrRst = filePath.endsWith(".md") || filePath.endsWith(".rst");
  if (!isMarkdownOrRst) {
    return [];
  }

  const opportunities: ContributionOpportunity[] = [];
  const contentLower = content.toLowerCase();

  for (const section of REQUIRED_SECTIONS) {
    const hasSection = contentLower.includes("## " + section.toLowerCase());
    
    if (!hasSection) {
      const descriptionText = "Add missing " + section + " section to README";
      opportunities.push({
        repo: {
          owner: "",
          name: "",
          fullName: "",
          stars: 0,
          language: null,
          description: null,
          isArchived: false,
          defaultBranch: "main",
          hasContributing: false,
          topics: [],
          openIssues: 0,
        },
        type: "docs",
        filePath,
        description: descriptionText,
        section: section,
        mergeProbability: { score: 0.8, label: "high", reasons: ["Standard documentation section"] },
        detectedAt: new Date().toISOString(),
      });
    }
  }

  if (opportunities.length >= 3) {
    const hasBadges = contentLower.includes("badges");
    if (!hasBadges) {
      opportunities.push({
        repo: {
          owner: "",
          name: "",
          fullName: "",
          stars: 0,
          language: null,
          description: null,
          isArchived: false,
          defaultBranch: "main",
          hasContributing: false,
          topics: [],
          openIssues: 0,
        },
        type: "docs",
        filePath,
        description: "Add missing badges section",
        section: "Badges",
        mergeProbability: { score: 0.7, label: "medium", reasons: ["CI/CD badges"] },
        detectedAt: new Date().toISOString(),
      });
    }
  }

  return opportunities;
}

export function generateDocsSection(
  opportunity: ContributionOpportunity,
): { patch: string; description: string; confidence: number } {
  const section = opportunity.section ?? "Section";

  const templates: Record<string, string> = {
    Installation: "## Installation\n\n```bash\nbun install\n```\n\nOr using npm:\n\n```bash\nnpm install\n```\n",
    Usage: "## Usage\n\n```typescript\nimport { main } from './src/main';\n\nmain();\n```\n",
    Contributing: "## Contributing\n\n1. Fork the repository\n2. Create your feature branch (`git checkout -b feature/amazing-feature`)\n3. Commit your changes (`git commit -m 'Add some amazingFeature'`)\n4. Push to the branch (`git push origin feature/amazingFeature`)\n5. Open a Pull Request\n\nPlease open issues for questions and bugs.\n\nPlease read [CONTRIBUTING.md](CONTRIBUTING.md) for details.\n",
    License: "## License\n\nMIT License - see the [LICENSE](LICENSE) file for details.\n",
    Badges: "## Badges\n\n[![Build Status](https://github.com/owner/repo/actions/workflows/ci/badge.svg)](https://github.com/owner/repo/actions)\n[![npm version](https://img.shields.io/npm/v/package.svg)](https://www.npmjs.com/package)\n[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)\n",
  };

  const patch = templates[section] ?? "## " + section + "\n\nContent here.\n";

  return {
    patch: patch,
    description: "Generated " + section + " section template",
    confidence: 0.85,
  };
}
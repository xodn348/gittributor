import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ComplianceResult } from "../types/index.js";

const CLA_REGEX = /(?:contributor\s+license\s+agreement|CLA)/i;
const ISSUE_FIRST_REGEX = /(?:please\s+open\s+an\s+issue|file\s+an\s+issue|issue\s+first)/i;

export async function checkContributingCompliance(repoPath: string): Promise<ComplianceResult> {
  const contributingPath = join(repoPath, "CONTRIBUTING.md");
  const prTemplatePath = join(repoPath, ".github", "PULL_REQUEST_TEMPLATE.md");

  let hasCLA = false;
  let requiresIssueFirst = false;

  if (existsSync(contributingPath)) {
    const content = readFileSync(contributingPath, "utf-8");
    hasCLA = CLA_REGEX.test(content);
    requiresIssueFirst = ISSUE_FIRST_REGEX.test(content);
  }

  let hasPRTemplate = false;
  let prTemplateContent: string | null = null;

  if (existsSync(prTemplatePath)) {
    hasPRTemplate = true;
    prTemplateContent = readFileSync(prTemplatePath, "utf-8");
  }

  return { hasCLA, requiresIssueFirst, hasPRTemplate, prTemplateContent };
}

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { mkdtempSync } from "fs";
import { checkContributingCompliance } from "../src/lib/contributing-checker.js";

describe("checkContributingCompliance", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "gittributor-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns permissive defaults when CONTRIBUTING.md is missing", async () => {
    const result = await checkContributingCompliance(tempDir);
    expect(result.hasCLA).toBe(false);
    expect(result.requiresIssueFirst).toBe(false);
    expect(result.hasPRTemplate).toBe(false);
    expect(result.prTemplateContent).toBeNull();
  });

  it("detects CLA requirement when CONTRIBUTING.md contains 'Contributor License Agreement'", async () => {
    const contributingPath = join(tempDir, "CONTRIBUTING.md");
    writeFileSync(contributingPath, "Please read our Contributor License Agreement before submitting.");
    const result = await checkContributingCompliance(tempDir);
    expect(result.hasCLA).toBe(true);
  });

  it("detects CLA when CONTRIBUTING.md contains 'CLA'", async () => {
    const contributingPath = join(tempDir, "CONTRIBUTING.md");
    writeFileSync(contributingPath, "By signing the CLA, you agree to our terms.");
    const result = await checkContributingCompliance(tempDir);
    expect(result.hasCLA).toBe(true);
  });

  it("detects issue-first requirement when CONTRIBUTING.md contains 'please open an issue'", async () => {
    const contributingPath = join(tempDir, "CONTRIBUTING.md");
    writeFileSync(contributingPath, "Please open an issue first before submitting a PR.");
    const result = await checkContributingCompliance(tempDir);
    expect(result.requiresIssueFirst).toBe(true);
  });

  it("detects issue-first when CONTRIBUTING.md contains 'file an issue'", async () => {
    const contributingPath = join(tempDir, "CONTRIBUTING.md");
    writeFileSync(contributingPath, "Make sure to file an issue before starting work.");
    const result = await checkContributingCompliance(tempDir);
    expect(result.requiresIssueFirst).toBe(true);
  });

  it("detects issue-first when CONTRIBUTING.md contains 'issue first'", async () => {
    const contributingPath = join(tempDir, "CONTRIBUTING.md");
    writeFileSync(contributingPath, "We follow an issue first workflow.");
    const result = await checkContributingCompliance(tempDir);
    expect(result.requiresIssueFirst).toBe(true);
  });

  it("finds PR template when .github/PULL_REQUEST_TEMPLATE.md exists", async () => {
    const prTemplatePath = join(tempDir, ".github", "PULL_REQUEST_TEMPLATE.md");
    mkdirSync(join(tempDir, ".github"), { recursive: true });
    const templateContent = "## Description\n\nPlease describe your changes.";
    writeFileSync(prTemplatePath, templateContent);
    const result = await checkContributingCompliance(tempDir);
    expect(result.hasPRTemplate).toBe(true);
    expect(result.prTemplateContent).toBe(templateContent);
  });

  it("returns hasPRTemplate=false when no PR template exists", async () => {
    const contributingPath = join(tempDir, "CONTRIBUTING.md");
    writeFileSync(contributingPath, "Thanks for contributing!");
    const result = await checkContributingCompliance(tempDir);
    expect(result.hasPRTemplate).toBe(false);
    expect(result.prTemplateContent).toBeNull();
  });

  it("detects all compliance requirements together", async () => {
    const contributingPath = join(tempDir, "CONTRIBUTING.md");
    writeFileSync(
      contributingPath,
      "Please read our Contributor License Agreement.\n" +
        "Open an issue first before submitting PRs."
    );
    const prTemplatePath = join(tempDir, ".github", "PULL_REQUEST_TEMPLATE.md");
    mkdirSync(join(tempDir, ".github"), { recursive: true });
    writeFileSync(prTemplatePath, "## PR Description");
    const result = await checkContributingCompliance(tempDir);
    expect(result.hasCLA).toBe(true);
    expect(result.requiresIssueFirst).toBe(true);
    expect(result.hasPRTemplate).toBe(true);
    expect(result.prTemplateContent).toBe("## PR Description");
  });
});

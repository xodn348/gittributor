import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { writeFileSync, readFileSync, existsSync, mkdirSync, unlinkSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  checkRateLimit,
  checkDuplicateContribution,
  checkRepoEligibility,
  recordSubmission,
} from "../src/lib/guardrails";
import type { ContributionType } from "../src/types";

describe("guardrails", () => {
  const testDir = "/tmp/gittributor-guardrails-test";

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    try {
      unlinkSync(join(testDir, "rate-limits.json"));
      unlinkSync(join(testDir, "history.json"));
    } catch {}
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {}
  });

  describe("checkRateLimit", () => {
    test("passed true when no submissions", async () => {
      const rateLimitsPath = join(testDir, "rate-limits.json");
      const result = await checkRateLimit("owner/repo", rateLimitsPath);
      expect(result.passed).toBe(true);
    });

    test("passed false when hourly limit exceeded", async () => {
      const rateLimitsPath = join(testDir, "rate-limits.json");
      const now = new Date().toISOString();
      const state = {
        hourly: [
          { submittedAt: now, repo: "owner/repo1" },
          { submittedAt: now, repo: "owner/repo2" },
          { submittedAt: now, repo: "owner/repo3" },
        ],
        weekly: {},
      };
      writeFileSync(rateLimitsPath, JSON.stringify(state));
      const result = await checkRateLimit("owner/repo", rateLimitsPath);
      expect(result.passed).toBe(false);
      expect(result.reason).toContain("hourly");
    });

    test("passed false when weekly per-repo limit exceeded", async () => {
      const rateLimitsPath = join(testDir, "rate-limits.json");
      const now = new Date().toISOString();
      const state = {
        hourly: [],
        weekly: {
          "owner/repo": [now, now],
        },
      };
      writeFileSync(rateLimitsPath, JSON.stringify(state));
      const result = await checkRateLimit("owner/repo", rateLimitsPath);
      expect(result.passed).toBe(false);
      expect(result.reason).toContain("weekly");
    });

    test("handles missing file gracefully", async () => {
      const rateLimitsPath = join(testDir, "nonexistent.json");
      const result = await checkRateLimit("owner/repo", rateLimitsPath);
      expect(result.passed).toBe(true);
    });
  });

  describe("checkDuplicateContribution", () => {
    test("passed true when no duplicates", async () => {
      const historyPath = join(testDir, "history.json");
      const result = await checkDuplicateContribution(
        "owner/repo",
        "src/index.ts",
        "bug-fix",
        historyPath
      );
      expect(result.passed).toBe(true);
    });

    test("passed false when duplicate exists with non-rejected status", async () => {
      const historyPath = join(testDir, "history.json");
      const existing = {
        "owner/repo": {
          "src/index.ts": {
            "bug-fix": { status: "submitted", submittedAt: new Date().toISOString() },
          },
        },
      };
      writeFileSync(historyPath, JSON.stringify(existing));
      const result = await checkDuplicateContribution(
        "owner/repo",
        "src/index.ts",
        "bug-fix",
        historyPath
      );
      expect(result.passed).toBe(false);
      expect(result.reason).toContain("duplicate");
    });

    test("passed true when same file but different type", async () => {
      const historyPath = join(testDir, "history.json");
      const existing = {
        "owner/repo": {
          "src/index.ts": {
            "bug-fix": { status: "submitted", submittedAt: new Date().toISOString() },
          },
        },
      };
      writeFileSync(historyPath, JSON.stringify(existing));
      const result = await checkDuplicateContribution(
        "owner/repo",
        "src/index.ts",
        "docs",
        historyPath
      );
      expect(result.passed).toBe(true);
    });

    test("passed true when existing entry is rejected", async () => {
      const historyPath = join(testDir, "history.json");
      const existing = {
        "owner/repo": {
          "src/index.ts": {
            "bug-fix": { status: "rejected", submittedAt: new Date().toISOString() },
          },
        },
      };
      writeFileSync(historyPath, JSON.stringify(existing));
      const result = await checkDuplicateContribution(
        "owner/repo",
        "src/index.ts",
        "bug-fix",
        historyPath
      );
      expect(result.passed).toBe(true);
    });

    test("handles missing file gracefully", async () => {
      const historyPath = join(testDir, "nonexistent.json");
      const result = await checkDuplicateContribution(
        "owner/repo",
        "src/index.ts",
        "bug-fix",
        historyPath
      );
      expect(result.passed).toBe(true);
    });
  });

  describe("checkRepoEligibility", () => {
    test("passed true for eligible repo", () => {
      const result = checkRepoEligibility(false, 1500);
      expect(result.passed).toBe(true);
    });

    test("passed false when archived", () => {
      const result = checkRepoEligibility(true, 1500);
      expect(result.passed).toBe(false);
      expect(result.reason).toContain("archived");
    });

    test("passed false when stars below 1000", () => {
      const result = checkRepoEligibility(false, 500);
      expect(result.passed).toBe(false);
      expect(result.reason).toContain("stars");
    });
  });

  describe("recordSubmission", () => {
    test("appends to hourly and weekly", async () => {
      const rateLimitsPath = join(testDir, "rate-limits.json");
      const now = new Date().toISOString();
      const state = {
        hourly: [{ submittedAt: now, repo: "owner/old" }],
        weekly: { "owner/existing": [now] },
      };
      writeFileSync(rateLimitsPath, JSON.stringify(state));

      await recordSubmission("owner/new", rateLimitsPath);

      const updated = JSON.parse(readFileSync(rateLimitsPath, "utf8"));
      expect(updated.hourly.length).toBe(2);
      expect(updated.weekly["owner/new"]).toBeDefined();
    });

    test("creates file if missing", async () => {
      const rateLimitsPath = join(testDir, "new-rates.json");
      expect(existsSync(rateLimitsPath)).toBe(false);

      await recordSubmission("owner/repo", rateLimitsPath);

      expect(existsSync(rateLimitsPath)).toBe(true);
    });
  });
});
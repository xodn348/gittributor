import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { loadHistory, saveContribution, updateContributionStatus, getHistoryStats, getRepoHistory } from "../src/lib/history";

describe("history", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = `/tmp/gittributor-history-test-${Date.now()}`;
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  describe("loadHistory", () => {
    test("returns empty array for missing file", async () => {
      const historyPath = join(testDir, "nonexistent.json");
      const result = await loadHistory(historyPath);
      expect(result).toEqual([]);
    });

    test("loads existing history correctly", async () => {
      const historyPath = join(testDir, "history.json");
      const existingData = {
        contributions: [
          {
            id: "1-test",
            repo: "owner/repo1",
            branchName: "fix-test",
            description: "Fix bug",
            filePath: "src/test.ts",
            type: "bug-fix" as const,
            status: "merged" as const,
            prNumber: 101,
            prUrl: "https://github.com/owner/repo1/pull/101",
            createdAt: "2024-01-01T00:00:00Z",
            mergedAt: "2024-01-02T00:00:00Z",
          },
        ],
      };
      writeFileSync(historyPath, JSON.stringify(existingData));

      const result = await loadHistory(historyPath);
      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe("1-test");
      expect(result[0]?.repo).toBe("owner/repo1");
    });
  });

  describe("saveContribution", () => {
    test("creates file and directory if missing", async () => {
      const historyPath = join(testDir, "newdir", "history.json");
      const contribution = {
        repo: "owner/newrepo",
        branchName: "test-branch",
        description: "New feature",
        filePath: "src/test.ts",
        type: "docs" as const,
        status: "pending" as const,
      };

      const result = await saveContribution(contribution, historyPath);

      expect(existsSync(historyPath)).toBe(true);
      expect(result.id).toBeDefined();
      expect(result.createdAt).toBeDefined();
      expect(result.repo).toBe("owner/newrepo");
    });

    test("appends to existing history", async () => {
      const historyPath = join(testDir, "history.json");
      const existingData = {
        contributions: [
          {
            id: "old-id",
            repo: "owner/existing",
            issueId: 1,
            issueTitle: "Old issue",
            type: "fix" as const,
            status: "pending" as const,
            createdAt: "2024-01-01T00:00:00Z",
          },
        ],
      };
      writeFileSync(historyPath, JSON.stringify(existingData));

      const newContribution = {
        repo: "owner/new",
        branchName: "new-branch",
        description: "New issue",
        filePath: "src/new.ts",
        type: "docs" as const,
        status: "submitted" as const,
        submittedAt: "2024-01-02T00:00:00Z",
      };

      const result = await saveContribution(newContribution, historyPath);
      const fileContent = JSON.parse(await Bun.file(historyPath).text());

      expect(fileContent.contributions).toHaveLength(2);
      expect(fileContent.contributions[1]?.id).toBe(result.id);
    });

    test("generates unique id and createdAt", async () => {
      const historyPath = join(testDir, "history.json");
      const contribution = {
        repo: "owner/test",
        branchName: "test-branch",
        description: "Test",
        filePath: "src/test.ts",
        type: "bug-fix" as const,
        status: "pending" as const,
      };

      const result1 = await saveContribution(contribution, historyPath);
      const result2 = await saveContribution(contribution, historyPath);

      expect(result1.id).not.toBe(result2.id);
      expect(result1.id).toMatch(/^\d+-[a-z0-9]{6}$/);
      expect(result2.id).toMatch(/^\d+-[a-z0-9]{6}$/);
    });
  });

  describe("updateContributionStatus", () => {
    test("updates status and optional fields", async () => {
      const historyPath = join(testDir, "history.json");
      const initialData = {
        contributions: [
          {
            id: "test-id",
            repo: "owner/repo",
            issueId: 1,
            issueTitle: "Test",
            type: "fix" as const,
            status: "submitted" as const,
            createdAt: "2024-01-01T00:00:00Z",
          },
        ],
      };
      writeFileSync(historyPath, JSON.stringify(initialData));

      await updateContributionStatus(
        "test-id",
        "merged",
        { prNumber: 101, prUrl: "https://github.com/owner/repo/pull/101", submittedAt: "2024-01-02T00:00:00Z", mergedAt: "2024-01-03T00:00:00Z" },
        historyPath
      );

      const fileContent = JSON.parse(await Bun.file(historyPath).text());
      const contrib = fileContent.contributions[0];
      expect(contrib.status).toBe("merged");
      expect(contrib.prNumber).toBe(101);
      expect(contrib.prUrl).toBe("https://github.com/owner/repo/pull/101");
      expect(contrib.mergedAt).toBe("2024-01-03T00:00:00Z");
    });

    test("noop if id not found", async () => {
      const historyPath = join(testDir, "history.json");
      const initialData = {
        contributions: [
          {
            id: "existing-id",
            repo: "owner/repo",
            issueId: 1,
            issueTitle: "Test",
            type: "fix" as const,
            status: "pending" as const,
            createdAt: "2024-01-01T00:00:00Z",
          },
        ],
      };
      writeFileSync(historyPath, JSON.stringify(initialData));

      await updateContributionStatus(
        "nonexistent-id",
        "merged",
        { mergedAt: "2024-01-03T00:00:00Z" },
        historyPath
      );

      const fileContent = JSON.parse(await Bun.file(historyPath).text());
      expect(fileContent.contributions[0]?.status).toBe("pending");
    });
  });

  describe("getHistoryStats", () => {
    test("returns correct totals and mergeRate", async () => {
      const historyPath = join(testDir, "history.json");
      const data = {
        contributions: [
          { id: "1", repo: "r1", branchName: "b1", description: "d1", filePath: "f1.ts", type: "fix" as const, status: "merged" as const, createdAt: "2024-01-01T00:00:00Z" },
          { id: "2", repo: "r2", branchName: "b2", description: "d2", filePath: "f2.ts", type: "docs" as const, status: "merged" as const, createdAt: "2024-01-01T00:00:00Z" },
          { id: "3", repo: "r3", branchName: "b3", description: "d3", filePath: "f3.ts", type: "fix" as const, status: "closed" as const, createdAt: "2024-01-01T00:00:00Z" },
          { id: "4", repo: "r4", branchName: "b4", description: "d4", filePath: "f4.ts", type: "improvement" as const, status: "pending" as const, createdAt: "2024-01-01T00:00:00Z" },
        ],
      };
      writeFileSync(historyPath, JSON.stringify(data));

      const stats = await getHistoryStats(historyPath);

      expect(stats.total).toBe(4);
      expect((stats.byType as Record<string, number>)["fix"]).toBe(2);
      expect(stats.byType.docs).toBe(1);
      expect((stats.byType as Record<string, number>)["improvement"]).toBe(1);
      expect(stats.byStatus.merged).toBe(2);
      expect(stats.byStatus.closed).toBe(1);
      expect(stats.byStatus.pending).toBe(1);
      expect(stats.mergeRate).toBe(0.5);
    });
  });

  describe("getRepoHistory", () => {
    test("filters by repo", async () => {
      const historyPath = join(testDir, "history.json");
      const data = {
        contributions: [
          { id: "1", repo: "owner/repo1", issueId: 1, issueTitle: "t1", type: "fix" as const, status: "merged" as const, createdAt: "2024-01-01T00:00:00Z" },
          { id: "2", repo: "owner/repo2", issueId: 2, issueTitle: "t2", type: "docs" as const, status: "pending" as const, createdAt: "2024-01-01T00:00:00Z" },
          { id: "3", repo: "owner/repo1", issueId: 3, issueTitle: "t3", type: "fix" as const, status: "closed" as const, createdAt: "2024-01-01T00:00:00Z" },
        ],
      };
      writeFileSync(historyPath, JSON.stringify(data));

      const result = await getRepoHistory("owner/repo1", historyPath);

      expect(result).toHaveLength(2);
      expect(result.every((c) => c.repo === "owner/repo1")).toBe(true);
    });
  });
});
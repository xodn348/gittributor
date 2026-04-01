import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FileChange, RepoInfo } from "../src/types";
import { RateLimiter, SafetyChecker, SubmissionPersistenceError } from "../src/lib/rate-limiter";

const readJsonWhenAvailable = async (filePath: string): Promise<unknown> => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const file = Bun.file(filePath);
    if (await file.exists()) {
      return file.json();
    }

    await Bun.sleep(2);
  }

  throw new Error(`Timed out waiting for ${filePath}`);
};

const waitForSubmissionPersistenceError = async (limiter: RateLimiter): Promise<void> => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      limiter.getStatus();
    } catch (error) {
      if (error instanceof SubmissionPersistenceError) {
        return;
      }

      throw error;
    }

    await Bun.sleep(2);
  }

  throw new Error("Timed out waiting for SubmissionPersistenceError");
};

describe("RateLimiter", () => {
  let tempDir: string;
  let previousCwd: string;

  beforeEach(async () => {
    previousCwd = process.cwd();
    tempDir = await mkdtemp(join(tmpdir(), "gittributor-rate-limiter-"));
    process.chdir(tempDir);
  });

  afterEach(async () => {
    process.chdir(previousCwd);
    await rm(tempDir, { recursive: true, force: true });
  });

  test("allows first submission and blocks second submission to the same repo within 24h", () => {
    const nowSpy = spyOn(Date, "now");
    nowSpy.mockReturnValue(1_700_000_000_000);

    const limiter = new RateLimiter();
    const initialCheck = limiter.canSubmit("owner/repo");
    limiter.recordSubmission("owner/repo", "https://github.com/owner/repo/pull/1");
    const secondCheck = limiter.canSubmit("owner/repo");

    expect(initialCheck).toEqual({ allowed: true });
    expect(secondCheck.allowed).toBe(false);
    expect(secondCheck.reason).toContain("repo");

    nowSpy.mockRestore();
  });

  test("allows the 5th submission and blocks the 6th within 24h rolling window", () => {
    const nowSpy = spyOn(Date, "now");
    nowSpy.mockReturnValue(1_700_000_000_000);

    const limiter = new RateLimiter();

    limiter.recordSubmission("owner/repo-1", "https://github.com/owner/repo-1/pull/1");
    limiter.recordSubmission("owner/repo-2", "https://github.com/owner/repo-2/pull/1");
    limiter.recordSubmission("owner/repo-3", "https://github.com/owner/repo-3/pull/1");
    limiter.recordSubmission("owner/repo-4", "https://github.com/owner/repo-4/pull/1");

    const fifthCheck = limiter.canSubmit("owner/repo-5");
    limiter.recordSubmission("owner/repo-5", "https://github.com/owner/repo-5/pull/1");
    const sixthCheck = limiter.canSubmit("owner/repo-6");

    expect(fifthCheck).toEqual({ allowed: true });
    expect(sixthCheck.allowed).toBe(false);
    expect(sixthCheck.reason).toContain("daily");

    nowSpy.mockRestore();
  });

  test("does not count submissions older than 24h", () => {
    const nowSpy = spyOn(Date, "now");
    const baseTimestamp = 1_700_000_000_000;
    nowSpy.mockReturnValue(baseTimestamp);

    const limiter = new RateLimiter();
    limiter.recordSubmission("owner/repo", "https://github.com/owner/repo/pull/1");

    nowSpy.mockReturnValue(baseTimestamp + 24 * 60 * 60 * 1000 + 1_000);
    const checkAfterWindow = limiter.canSubmit("owner/repo");

    expect(checkAfterWindow).toEqual({ allowed: true });

    nowSpy.mockRestore();
  });

  test("uses the configured rolling window in the repo block message", () => {
    const nowSpy = spyOn(Date, "now");
    nowSpy.mockReturnValue(1_700_000_000_000);

    const limiter = new RateLimiter({ windowMs: 60 * 60 * 1000 });
    limiter.recordSubmission("owner/repo", "https://github.com/owner/repo/pull/1");

    expect(limiter.canSubmit("owner/repo")).toEqual({
      allowed: false,
      reason: "Repo limit reached for owner/repo. Try again after 1 hour.",
    });

    nowSpy.mockRestore();
  });

  test("respects persisted submissions immediately when checking limits", async () => {
    const nowSpy = spyOn(Date, "now");
    const baseTimestamp = 1_700_000_000_000;
    const submissionsDirectory = join(tempDir, ".gittributor");
    const submissionsFilePath = join(submissionsDirectory, "submissions.json");

    nowSpy.mockReturnValue(baseTimestamp);
    await Bun.write(
      submissionsFilePath,
      JSON.stringify(
        [
          {
            repo: "owner/repo",
            prUrl: "https://github.com/owner/repo/pull/1",
            submittedAt: new Date(baseTimestamp).toISOString(),
          },
        ],
        null,
        2,
      ),
    );

    const limiter = new RateLimiter();

    expect(limiter.canSubmit("owner/repo")).toEqual({
      allowed: false,
      reason: "Repo limit reached for owner/repo. Try again after 24 hours.",
    });

    nowSpy.mockRestore();
  });

  test("persists recorded submissions and reports remaining daily capacity", async () => {
    const nowSpy = spyOn(Date, "now");
    const baseTimestamp = 1_700_000_000_000;
    const submissionsFilePath = join(tempDir, ".gittributor", "submissions.json");

    nowSpy.mockReturnValue(baseTimestamp);

    const limiter = new RateLimiter();
    limiter.recordSubmission("owner/repo", "https://github.com/owner/repo/pull/1");

    const persisted = await readJsonWhenAvailable(submissionsFilePath);
    const status = limiter.getStatus();

    expect(persisted).toEqual([
      {
        repo: "owner/repo",
        prUrl: "https://github.com/owner/repo/pull/1",
        submittedAt: new Date(baseTimestamp).toISOString(),
      },
    ]);
    expect(status.dailyRemaining).toBe(4);
    expect(status.repoLimits["owner/repo"]?.toISOString()).toBe(
      new Date(baseTimestamp + 24 * 60 * 60 * 1000).toISOString(),
    );

    nowSpy.mockRestore();
  });

  test("reports retry time from the oldest still-blocking repo submission", () => {
    const nowSpy = spyOn(Date, "now");
    const baseTimestamp = 1_700_000_000_000;

    nowSpy.mockReturnValue(baseTimestamp);

    const limiter = new RateLimiter({ maxSubmissionsPerRepo: 2 });
    limiter.recordSubmission("owner/repo", "https://github.com/owner/repo/pull/1");

    nowSpy.mockReturnValue(baseTimestamp + 5 * 60 * 1000);
    limiter.recordSubmission("owner/repo", "https://github.com/owner/repo/pull/2");

    nowSpy.mockReturnValue(baseTimestamp + 10 * 60 * 1000);
    limiter.recordSubmission("owner/repo", "https://github.com/owner/repo/pull/3");

    expect(limiter.getStatus().repoLimits["owner/repo"]?.toISOString()).toBe(
      new Date(baseTimestamp + 5 * 60 * 1000 + 24 * 60 * 60 * 1000).toISOString(),
    );

    nowSpy.mockRestore();
  });

  test("throws when persisted submissions are malformed", async () => {
    const submissionsFilePath = join(tempDir, ".gittributor", "submissions.json");

    await Bun.write(submissionsFilePath, JSON.stringify({ repo: "owner/repo" }, null, 2));

    const limiter = new RateLimiter();

    expect(() => limiter.canSubmit("owner/repo")).toThrow(SubmissionPersistenceError);
  });

  test("surfaces async persistence failures on the next public call", async () => {
    const nowSpy = spyOn(Date, "now");
    const writeSpy = spyOn(Bun, "write");

    nowSpy.mockReturnValue(1_700_000_000_000);
    writeSpy.mockRejectedValueOnce(new Error("disk full"));

    const limiter = new RateLimiter();
    limiter.recordSubmission("owner/repo", "https://github.com/owner/repo/pull/1");

    await waitForSubmissionPersistenceError(limiter);

    writeSpy.mockRestore();
    nowSpy.mockRestore();
  });
});

describe("SafetyChecker", () => {
  test("flags forbidden files and allows safe files", () => {
    const checker = new SafetyChecker();
    const forbiddenChanges: FileChange[] = [
      {
        file: ".env",
        original: "",
        modified: "SECRET=123",
      },
    ];
    const safeChanges: FileChange[] = [
      {
        file: "src/index.ts",
        original: "export const value = 1;",
        modified: "export const value = 2;",
      },
    ];

    const forbiddenResult = checker.checkFiles(forbiddenChanges);
    const safeResult = checker.checkFiles(safeChanges);

    expect(forbiddenResult.safe).toBe(false);
    expect(forbiddenResult.violations.length).toBe(1);
    expect(forbiddenResult.violations[0]).toContain(".env");
    expect(safeResult).toEqual({ safe: true, violations: [] });
  });

  test("marks archived repositories as unsafe", () => {
    const checker = new SafetyChecker();
    const repo: RepoInfo = {
      fullName: "owner/archived-repo",
      diskUsage: 120,
      stargazerCount: 100,
      isArchived: true,
    };

    const result = checker.checkRepo(repo);

    expect(result.safe).toBe(false);
    expect(result.reason).toContain("archived");
  });

  test("marks repositories with too few stars as unsafe", () => {
    const checker = new SafetyChecker({ minStars: 50 });
    const repo: RepoInfo = {
      fullName: "owner/low-star-repo",
      diskUsage: 120,
      stargazerCount: 10,
      isArchived: false,
    };

    const result = checker.checkRepo(repo);

    expect(result.safe).toBe(false);
    expect(result.reason).toContain("stars");
  });

  test("marks repositories larger than max size as unsafe", () => {
    const checker = new SafetyChecker({ maxSizeMb: 500 });
    const repo: RepoInfo = {
      fullName: "owner/large-repo",
      diskUsage: 501,
      stargazerCount: 120,
      isArchived: false,
    };

    const result = checker.checkRepo(repo);

    expect(result.safe).toBe(false);
    expect(result.reason).toContain("size");
  });

  test("marks repositories with an open user PR as unsafe", () => {
    const checker = new SafetyChecker();
    const repo: RepoInfo = {
      fullName: "owner/existing-pr-repo",
      diskUsage: 120,
      stargazerCount: 120,
      isArchived: false,
      hasOpenUserPR: true,
    };

    const result = checker.checkRepo(repo);

    expect(result).toEqual({
      safe: false,
      reason: "You already have an open PR in owner/existing-pr-repo.",
    });
  });
});

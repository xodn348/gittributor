import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { FileChange, RepoInfo } from "../types";

interface SubmissionRecord {
  repo: string;
  prUrl: string;
  submittedAt: string;
}

interface RateLimiterOptions {
  maxDailySubmissions?: number;
  maxSubmissionsPerRepo?: number;
  windowMs?: number;
}

interface SafetyCheckerOptions {
  minStars?: number;
  maxSizeMb?: number;
}

const STATE_DIRECTORY = ".gittributor";
const SUBMISSIONS_FILENAME = "submissions.json";
const DAY_IN_MS = 24 * 60 * 60 * 1000;

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const isSubmissionRecord = (value: unknown): value is SubmissionRecord => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.repo === "string" &&
    typeof value.prUrl === "string" &&
    typeof value.submittedAt === "string"
  );
};

export class RateLimiter {
  private readonly submissionsFilePath: string;
  private readonly maxDailySubmissions: number;
  private readonly maxSubmissionsPerRepo: number;
  private readonly windowMs: number;
  private submissions: SubmissionRecord[] = [];
  private pendingWrite: Promise<void> = Promise.resolve();
  private lastPersistenceError: Error | null = null;

  constructor(options: RateLimiterOptions = {}) {
    this.submissionsFilePath = join(
      process.cwd(),
      STATE_DIRECTORY,
      SUBMISSIONS_FILENAME,
    );
    this.maxDailySubmissions = options.maxDailySubmissions ?? 5;
    this.maxSubmissionsPerRepo = options.maxSubmissionsPerRepo ?? 1;
    this.windowMs = options.windowMs ?? DAY_IN_MS;
    void this.hydrateSubmissionsFromDisk();
  }

  canSubmit(repo: string): { allowed: boolean; reason?: string } {
    this.throwIfPersistenceFailed();
    const now = Date.now();
    this.submissions = this.getRecentSubmissions(now);

    const repoRecentSubmissions = this.submissions.filter(
      (submission) => submission.repo === repo,
    );

    if (repoRecentSubmissions.length >= this.maxSubmissionsPerRepo) {
      return {
        allowed: false,
        reason: `Repo limit reached for ${repo}. Try again after 24 hours.`,
      };
    }

    if (this.submissions.length >= this.maxDailySubmissions) {
      return {
        allowed: false,
        reason: "Global daily submission limit reached.",
      };
    }

    return { allowed: true };
  }

  recordSubmission(repo: string, prUrl: string): void {
    this.throwIfPersistenceFailed();

    const entry: SubmissionRecord = {
      repo,
      prUrl,
      submittedAt: new Date(Date.now()).toISOString(),
    };

    this.submissions = [...this.getRecentSubmissions(Date.now()), entry];
    this.persistSubmissions();
  }

  getStatus(): { dailyRemaining: number; repoLimits: Record<string, Date> } {
    this.throwIfPersistenceFailed();

    const now = Date.now();
    const recentSubmissions = this.getRecentSubmissions(now);
    const dailyRemaining = Math.max(
      0,
      this.maxDailySubmissions - recentSubmissions.length,
    );
    const latestSubmissionByRepo = new Map<string, number>();

    for (const submission of recentSubmissions) {
      const submissionTime = new Date(submission.submittedAt).getTime();
      const latestForRepo = latestSubmissionByRepo.get(submission.repo) ?? 0;
      if (submissionTime > latestForRepo) {
        latestSubmissionByRepo.set(submission.repo, submissionTime);
      }
    }

    const repoLimits: Record<string, Date> = {};
    for (const [repo, lastSubmissionTime] of latestSubmissionByRepo.entries()) {
      repoLimits[repo] = new Date(lastSubmissionTime + this.windowMs);
    }

    return {
      dailyRemaining,
      repoLimits,
    };
  }

  private async hydrateSubmissionsFromDisk(): Promise<void> {
    try {
      await mkdir(join(process.cwd(), STATE_DIRECTORY), { recursive: true });

      const submissionsFile = Bun.file(this.submissionsFilePath);
      if (!(await submissionsFile.exists())) {
        this.submissions = [];
        return;
      }

      const rawContent = await submissionsFile.json();
      if (!Array.isArray(rawContent)) {
        this.submissions = [];
        return;
      }

      this.submissions = rawContent.filter((entry) => isSubmissionRecord(entry));
    } catch (error) {
      this.lastPersistenceError =
        error instanceof Error ? error : new Error(String(error));
      this.submissions = [];
    }
  }

  private getRecentSubmissions(now: number): SubmissionRecord[] {
    return this.submissions.filter((submission) => {
      const submittedAt = new Date(submission.submittedAt).getTime();
      if (!Number.isFinite(submittedAt)) {
        return false;
      }

      return now - submittedAt < this.windowMs;
    });
  }

  private persistSubmissions(): void {
    this.pendingWrite = this.pendingWrite
      .then(async () => {
        await mkdir(join(process.cwd(), STATE_DIRECTORY), { recursive: true });
        await Bun.write(
          this.submissionsFilePath,
          JSON.stringify(this.submissions, null, 2),
        );
      })
      .catch((error) => {
        this.lastPersistenceError =
          error instanceof Error ? error : new Error(String(error));
      });
  }

  private throwIfPersistenceFailed(): void {
    if (this.lastPersistenceError) {
      throw this.lastPersistenceError;
    }
  }
}

export class SafetyChecker {
  private readonly minStars: number;
  private readonly maxSizeMb: number;

  constructor(options: SafetyCheckerOptions = {}) {
    this.minStars = options.minStars ?? 50;
    this.maxSizeMb = options.maxSizeMb ?? 500;
  }

  checkFiles(changes: FileChange[]): { safe: boolean; violations: string[] } {
    const violations: string[] = [];

    for (const change of changes) {
      const violation = this.getForbiddenFileViolation(change.file);
      if (violation) {
        violations.push(violation);
      }
    }

    return {
      safe: violations.length === 0,
      violations,
    };
  }

  checkRepo(repo: RepoInfo): { safe: boolean; reason?: string } {
    if (repo.isArchived) {
      return {
        safe: false,
        reason: `Repository ${repo.fullName} is archived.`,
      };
    }

    if (repo.stargazerCount < this.minStars) {
      return {
        safe: false,
        reason: `Repository ${repo.fullName} has too few stars (${repo.stargazerCount} < ${this.minStars}).`,
      };
    }

    if (repo.diskUsage > this.maxSizeMb) {
      return {
        safe: false,
        reason: `Repository ${repo.fullName} exceeds size limit (${repo.diskUsage}MB > ${this.maxSizeMb}MB).`,
      };
    }

    if (repo.hasOpenUserPR) {
      return {
        safe: false,
        reason: `You already have an open PR in ${repo.fullName}.`,
      };
    }

    return { safe: true };
  }

  private getForbiddenFileViolation(filePath: string): string | null {
    const normalizedPath = filePath.replaceAll("\\", "/");
    const fileName = normalizedPath.split("/").at(-1) ?? normalizedPath;

    if (fileName === ".env") {
      return `Forbidden file modified: ${filePath} (.env)`;
    }

    if (fileName.endsWith(".lock")) {
      return `Forbidden file modified: ${filePath} (*.lock)`;
    }

    if (fileName.endsWith(".config.js")) {
      return `Forbidden file modified: ${filePath} (*.config.js)`;
    }

    if (fileName.endsWith(".config.ts")) {
      return `Forbidden file modified: ${filePath} (*.config.ts)`;
    }

    if (normalizedPath.includes(".github/workflows/")) {
      return `Forbidden file modified: ${filePath} (.github/workflows/*)`;
    }

    if (fileName === "package.json") {
      return `Forbidden file modified: ${filePath} (package.json)`;
    }

    return null;
  }
}

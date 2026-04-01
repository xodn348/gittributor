import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { FileChange, RepoInfo } from "../types";
import { StateError } from "./errors";

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

interface RateLimitDecision {
  allowed: boolean;
  reason?: string;
}

interface RateLimiterStatus {
  dailyRemaining: number;
  repoLimits: Record<string, Date>;
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

const formatWindowLabel = (windowMs: number): string => {
  const totalMinutes = Math.ceil(windowMs / (60 * 1000));
  if (totalMinutes < 60) {
    return `${totalMinutes} minute${totalMinutes === 1 ? "" : "s"}`;
  }

  const totalHours = Math.ceil(totalMinutes / 60);
  if (totalHours <= 24) {
    return `${totalHours} hour${totalHours === 1 ? "" : "s"}`;
  }

  const totalDays = Math.ceil(totalHours / 24);
  return `${totalDays} day${totalDays === 1 ? "" : "s"}`;
};

export class SubmissionPersistenceError extends StateError {
  constructor(message: string) {
    super(message);
    this.name = "SubmissionPersistenceError";
  }
}

const createSubmissionPersistenceError = (message: string, cause: unknown): SubmissionPersistenceError => {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return new SubmissionPersistenceError(`${message}: ${detail}`);
};

export class RateLimiter {
  private readonly submissionsFilePath: string;
  private readonly maxDailySubmissions: number;
  private readonly maxSubmissionsPerRepo: number;
  private readonly windowMs: number;
  private submissions: SubmissionRecord[] = [];
  private pendingWrite: Promise<void> = Promise.resolve();
  private lastPersistenceError: SubmissionPersistenceError | null = null;

  constructor(options: RateLimiterOptions = {}) {
    this.submissionsFilePath = join(
      process.cwd(),
      STATE_DIRECTORY,
      SUBMISSIONS_FILENAME,
    );
    this.maxDailySubmissions = options.maxDailySubmissions ?? 5;
    this.maxSubmissionsPerRepo = options.maxSubmissionsPerRepo ?? 1;
    this.windowMs = options.windowMs ?? DAY_IN_MS;
    this.submissions = this.loadSubmissionsFromDisk();
  }

  canSubmit(repo: string): RateLimitDecision {
    this.throwIfPersistenceFailed();
    this.pruneExpiredSubmissions();

    const repoRecentSubmissions = this.submissions.filter(
      (submission) => submission.repo === repo,
    );

    if (repoRecentSubmissions.length >= this.maxSubmissionsPerRepo) {
      return {
        allowed: false,
        reason: `Repo limit reached for ${repo}. Try again after ${formatWindowLabel(this.windowMs)}.`,
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
    this.pruneExpiredSubmissions();

    const entry: SubmissionRecord = {
      repo,
      prUrl,
      submittedAt: new Date(Date.now()).toISOString(),
    };

    this.submissions = [...this.submissions, entry];
    this.persistSubmissions();
  }

  getStatus(): RateLimiterStatus {
    this.throwIfPersistenceFailed();
    this.pruneExpiredSubmissions();
    const recentSubmissions = this.submissions;
    const dailyRemaining = Math.max(
      0,
      this.maxDailySubmissions - recentSubmissions.length,
    );
    const submissionsByRepo = new Map<string, SubmissionRecord[]>();

    for (const submission of recentSubmissions) {
      const repoSubmissions = submissionsByRepo.get(submission.repo) ?? [];
      submissionsByRepo.set(submission.repo, [...repoSubmissions, submission]);
    }

    const repoLimits: Record<string, Date> = {};
    for (const [repo, repoSubmissions] of submissionsByRepo.entries()) {
      const retryTime = this.getRetryTimeForRepo(repoSubmissions);
      if (retryTime) {
        repoLimits[repo] = retryTime;
      }
    }

    return {
      dailyRemaining,
      repoLimits,
    };
  }

  private loadSubmissionsFromDisk(): SubmissionRecord[] {
    try {
      if (!existsSync(dirname(this.submissionsFilePath))) {
        return [];
      }

      if (!existsSync(this.submissionsFilePath)) {
        return [];
      }

      const rawContent = JSON.parse(readFileSync(this.submissionsFilePath, "utf8")) as unknown;
      if (!Array.isArray(rawContent)) {
        throw new SubmissionPersistenceError("Failed to load submissions from disk: submissions.json must contain an array");
      }

      if (!rawContent.every((entry) => isSubmissionRecord(entry))) {
        throw new SubmissionPersistenceError("Failed to load submissions from disk: submissions.json contains invalid submission entries");
      }

      return this.getRecentSubmissions(Date.now(), rawContent);
    } catch (error) {
      this.lastPersistenceError = error instanceof SubmissionPersistenceError
        ? error
        : createSubmissionPersistenceError("Failed to load submissions from disk", error);
      return [];
    }
  }

  private pruneExpiredSubmissions(): void {
    this.submissions = this.getRecentSubmissions(Date.now(), this.submissions);
  }

  private getRecentSubmissions(now: number, submissions: SubmissionRecord[]): SubmissionRecord[] {
    return submissions.filter((submission) => {
      const submittedAt = new Date(submission.submittedAt).getTime();
      if (!Number.isFinite(submittedAt)) {
        return false;
      }

      return now - submittedAt < this.windowMs;
    });
  }

  private persistSubmissions(): void {
    mkdirSync(dirname(this.submissionsFilePath), { recursive: true });

    this.pendingWrite = this.pendingWrite
      .then(async () => {
        await Bun.write(
          this.submissionsFilePath,
          JSON.stringify(this.submissions, null, 2),
        );
      })
      .catch((error) => {
        this.lastPersistenceError = createSubmissionPersistenceError(
          "Failed to persist submissions to disk",
          error,
        );
      });
  }

  private getRetryTimeForRepo(submissions: SubmissionRecord[]): Date | null {
    if (submissions.length < this.maxSubmissionsPerRepo) {
      return null;
    }

    const sortedSubmissions = [...submissions].sort((left, right) => {
      return new Date(left.submittedAt).getTime() - new Date(right.submittedAt).getTime();
    });
    const blockingSubmissionIndex = submissions.length - this.maxSubmissionsPerRepo;
    const blockingSubmission = sortedSubmissions[blockingSubmissionIndex];
    const blockingTime = new Date(blockingSubmission.submittedAt).getTime();

    return new Date(blockingTime + this.windowMs);
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

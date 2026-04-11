import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { loadState, saveState, transition, getStateData } from "../lib/state.js";
import { loadConfig } from "../lib/config.js";
import { checkRateLimit, checkDuplicateContribution, checkRepoEligibility, recordSubmission } from "../lib/guardrails.js";
import { saveContribution } from "../lib/history.js";
import { checkContributingCompliance } from "../lib/contributing-checker.js";
import { error as logError, warn, debug } from "../lib/logger.js";
import { GitHubAPIError } from "../lib/errors.js";
import type { FixResult, PRSubmission, PipelineState, PipelineStatus, ContributionType } from "../types/index.js";

const WORKSPACE_ROOT = ".gittributor/workspace";
const AI_DISCLOSURE =
  process.env.GITTRIBUTOR_AI_PROVIDER === "openai"
    ? "This fix was generated with AI assistance (OpenAI) and reviewed by a human."
    : "This fix was generated with AI assistance (Anthropic Claude) and reviewed by a human.";

const MAX_PR_FILES = 5;
const MAX_PR_LINES = 200;

const isEnvDryRun = (): boolean => Bun.env.GITTRIBUTOR_DRY_RUN === "true";

export interface SubmitOptions {
  rateLimitsPath?: string;
  historyPath?: string;
  dryRun?: boolean;
  skipIssueCheck?: boolean;
}

interface FixChange {
  file: string;
  original: string;
  modified: string;
}

interface FixResultWithChanges extends FixResult {
  changes: FixChange[];
}

interface ReviewStateData {
  issueId?: number;
  decision?: string;
}

interface SubmissionStateData {
  submission?: {
    prUrl?: string;
    prNumber?: number;
    error?: string;
    branchName?: string;
  };
  review?: ReviewStateData;
}

interface PersistedFixPayload {
  changes: FixChange[];
  explanation: string;
}

interface PipelineStateWithData extends PipelineState {
  data?: Record<string, unknown>;
}

const extractGitHubUrl = (payload: string, operation: string): string => {
  const urlMatch = payload.match(/https:\/\/github\.com\/\S+/);
  if (!urlMatch) {
    throw new Error(`${operation} did not return a GitHub URL`);
  }

  return urlMatch[0].trim();
};

const extractPRNumber = (prUrl: string): number => {
  const match = prUrl.match(/\/pull\/(\d+)$/);
  if (!match) {
    throw new Error(`Unexpected PR URL format: ${prUrl}`);
  }

  return Number.parseInt(match[1], 10);
};

const extractRepoOwner = (repoUrl: string): string => {
  const match = repoUrl.match(/^https:\/\/github\.com\/([^/]+)\/[^/\s]+\/?$/);
  if (!match) {
    throw new Error(`Unexpected fork URL format: ${repoUrl}`);
  }

  return match[1];
};

const shortDescription = (text: string): string => {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "apply approved fix";
  }

  return normalized.length > 72 ? `${normalized.slice(0, 69)}...` : normalized;
};

const countLinesChanged = (original: string, modified: string): number => {
  const originalLines = original.split("\n").length;
  const modifiedLines = modified.split("\n").length;
  return Math.abs(modifiedLines - originalLines) + (modifiedLines > originalLines ? modifiedLines - originalLines : 0);
};

const checkFixSize = (fix: FixResultWithChanges): { passed: boolean; fileCount: number; lineCount: number } => {
  const fileCount = fix.changes.length;
  let totalLineCount = 0;
  for (const change of fix.changes) {
    totalLineCount += countLinesChanged(change.original, change.modified);
  }
  return {
    passed: fileCount <= MAX_PR_FILES && totalLineCount <= MAX_PR_LINES,
    fileCount,
    lineCount: totalLineCount,
  };
};

const isRateLimitError = (error: unknown): boolean => {
  if (error instanceof GitHubAPIError) {
    const message = error.message.toLowerCase();
    return message.includes("http 403") || message.includes("rate limit") || error.exitCode === 1;
  }
  return false;
};

const runCommand = async (cmd: string[]): Promise<string> => {
  const proc = Bun.spawn({ cmd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(`Command failed: ${cmd.join(" ")} (exit ${exitCode}) ${stderr.trim()}`);
  }

  return stdout;
};

const loadPersistedFixPayload = async (): Promise<PersistedFixPayload> => {
  const filePath = join(process.cwd(), ".gittributor", "fix.json");
  const payload = await Bun.file(filePath).json();

  if (typeof payload !== "object" || payload === null) {
    throw new Error("Cannot submit: persisted fix payload is invalid");
  }

  const record = payload as Record<string, unknown>;
  const changes = Array.isArray(record.changes)
    ? record.changes
        .map((entry) => {
          if (typeof entry !== "object" || entry === null) {
            return null;
          }

          const change = entry as Record<string, unknown>;
          if (
            typeof change.file !== "string" ||
            typeof change.original !== "string" ||
            typeof change.modified !== "string"
          ) {
            return null;
          }

          return {
            file: change.file,
            original: change.original,
            modified: change.modified,
          };
        })
        .filter((entry): entry is FixChange => entry !== null)
    : [];

  return {
    changes,
    explanation: typeof record.explanation === "string" ? record.explanation : "",
  };
};

const selectIssueId = (
  state: PipelineState,
  reviewState: ReviewStateData | null,
  fixPayload: PersistedFixPayload,
): number => {
  const submissionData = {
    review: reviewState ?? undefined,
  } satisfies SubmissionStateData;

  if (typeof submissionData.review?.issueId === "number") {
    return submissionData.review.issueId;
  }

  const currentIssue = state.issues[0];
  if (currentIssue && state.fixes[currentIssue.id] && currentIssue.repoFullName) {
    return currentIssue.id;
  }

  const matchingFixIds = Object.entries(state.fixes)
    .filter(([, fix]) => {
      return fix.explanation === fixPayload.explanation && fix.repoFullName === currentIssue?.repoFullName;
    })
    .map(([issueId]) => Number.parseInt(issueId, 10))
    .filter((issueId) => Number.isFinite(issueId));

  if (matchingFixIds.length === 1) {
    return matchingFixIds[0];
  }

  const fixIssueIds = Object.keys(state.fixes)
    .map((key) => Number.parseInt(key, 10))
    .filter((value) => Number.isFinite(value));

  if (fixIssueIds.length === 0) {
    throw new Error("Cannot submit: no fix found in pipeline state");
  }

  return fixIssueIds.sort((left, right) => right - left)[0];
};

const ensureApprovedReview = (state: PipelineState, submissionData: SubmissionStateData): void => {
  const decision = submissionData.review?.decision;
  if (state.status !== "reviewed" || decision !== "approved") {
    throw new Error("Cannot submit: fix was not approved");
  }
};

const buildSubmissionRecord = (
  issueId: number,
  repoFullName: string,
  prUrl: string,
  branchName: string,
): PRSubmission => {
  return {
    issueId,
    repoFullName,
    prUrl,
    prNumber: extractPRNumber(prUrl),
    branchName,
    submittedAt: new Date().toISOString(),
  };
};

const createPRBody = (issueNumber: number, fix: FixResultWithChanges): string => {
  const changedFiles = fix.changes.map((change) => `- \`${change.file}\``).join("\n");
  const summary = shortDescription(fix.explanation);

  return [
    `Fixes #${issueNumber}`,
    "",
    AI_DISCLOSURE,
    "",
    "## Summary of changes",
    changedFiles,
    "",
    "## Why",
    summary,
  ].join("\n");
};

const extractStateDataRecord = (state: PipelineState): Record<string, unknown> => {
  const candidate = (state as PipelineStateWithData).data;
  if (!candidate || typeof candidate !== "object") {
    return {};
  }

  return candidate;
};

const appendSubmissionData = (
  state: PipelineState,
  patch: SubmissionStateData["submission"],
): Record<string, unknown> => {
  const existingData = extractStateDataRecord(state);
  const existingSubmission =
    typeof existingData.submission === "object" && existingData.submission !== null
      ? (existingData.submission as Record<string, unknown>)
      : {};

  return {
    ...existingData,
    submission: {
      ...existingSubmission,
      ...patch,
    },
  };
};

const updateState = async (
  state: PipelineState,
  status: PipelineStatus | "submit_failed",
  submissionPatch: SubmissionStateData["submission"],
  submissionRecord?: PRSubmission,
): Promise<void> => {
  const nextState = {
    ...state,
    status,
    submissions: submissionRecord ? [...state.submissions, submissionRecord] : state.submissions,
    data: appendSubmissionData(state, submissionPatch),
  };

  await saveState(nextState as unknown as PipelineState);
};

const applyFixChanges = async (workspacePath: string, fix: FixResultWithChanges): Promise<void> => {
  for (const change of fix.changes) {
    const targetFile = join(workspacePath, change.file);
    await mkdir(dirname(targetFile), { recursive: true });
    await Bun.write(targetFile, change.modified);
  }
};

export const submitApprovedFix = async (options: SubmitOptions = {}): Promise<number> => {
  const config = await loadConfig();
  const rateLimitsPath = options.rateLimitsPath || ".gittributor/rate-limits.json";
  const historyPath = options.historyPath || config.historyPath || ".gittributor/history.json";

  const state = await loadState();
  const reviewState = (state as unknown as { data?: { review?: ReviewStateData } }).data?.review ?? null;
  const stateData: SubmissionStateData = {
    review: reviewState ?? undefined,
  };

  try {
    ensureApprovedReview(state, stateData);

    const fixPayload = await loadPersistedFixPayload();

    const issueId = selectIssueId(state, reviewState, fixPayload);
    const issue = state.issues.find((entry) => entry.id === issueId || entry.number === issueId);
    if (!issue) {
      throw new Error(`Cannot submit: issue ${issueId} not found in pipeline state`);
    }

    const rawFix = state.fixes[issueId as unknown as keyof typeof state.fixes];
    if (!rawFix) {
      throw new Error(`Cannot submit: fix for issue ${issueId} not found`);
    }

    const fix: FixResultWithChanges = {
      ...(rawFix as FixResult),
      changes: fixPayload.changes,
    };
    if (!Array.isArray(fix.changes) || fix.changes.length === 0) {
      throw new Error("Cannot submit: fix has no file changes");
    }

    const repoFullName = issue.repoFullName || fix.repoFullName;
    const repoName = repoFullName.split("/")[1];
    if (!repoName) {
      throw new Error(`Cannot submit: invalid repository name '${repoFullName}'`);
    }

    const primaryFilePath = fix.changes[0]?.file || "";
    const contributionType: ContributionType = "code";

    const prSizeCheck = checkFixSize(fix);
    if (!prSizeCheck.passed) {
      process.stdout.write(`[SKIP] Fix too large for automated PR (${prSizeCheck.fileCount} files, ${prSizeCheck.lineCount} LOC). Skipping submission.\n`);
      return 0;
    }

    const envDryRun = isEnvDryRun();
    if (options.dryRun || envDryRun) {
      const prTitle = `fix(#${issue.number}): ${shortDescription(issue.title)}`;
      const prBody = createPRBody(issue.number, fix);
      const fileList = fix.changes.map((c) => c.file).join(", ");
      if (envDryRun) {
        process.stdout.write(`[DRY RUN] Would create PR: ${prTitle} on ${repoFullName}\n`);
        process.stdout.write(`[DRY RUN] Files: ${fileList}\n`);
      } else {
        process.stdout.write("\n=== PR Preview (dry-run) ===\n");
        process.stdout.write(`Title: ${prTitle}\n`);
        process.stdout.write(`Body:\n${prBody}\n`);
        process.stdout.write("=============================\n");
      }
      return 0;
    }

    const rateLimitCheck = await checkRateLimit(repoFullName, rateLimitsPath);
    if (!rateLimitCheck.passed) {
      throw new Error(`Cannot submit: ${rateLimitCheck.reason}`);
    }

    const duplicateCheck = await checkDuplicateContribution(
      repoFullName,
      fix.changes[0]?.file || "",
      contributionType,
      historyPath,
    );
    if (!duplicateCheck.passed) {
      throw new Error(`Cannot submit: ${duplicateCheck.reason}`);
    }

    const matchingRepo = state.repositories.find((r) => r.fullName === repoFullName);
    const repoStars = matchingRepo?.stars ?? 0;
    const eligibleCheck = checkRepoEligibility(false, repoStars);
    if (!eligibleCheck.passed) {
      throw new Error(`Cannot submit: ${eligibleCheck.reason}`);
    }

    const branchName = `gittributor/fix-${issue.number}`;
    const workspacePath = join(WORKSPACE_ROOT, repoName);

    let forkOwner: string;
    let forkUrl: string;
    try {
      const forkOutput = await runCommand(["gh", "repo", "fork", repoFullName, "--clone=false"]);
      forkUrl = extractGitHubUrl(forkOutput, "gh repo fork");
      forkOwner = extractRepoOwner(forkUrl);
    } catch (forkError: unknown) {
      if (isRateLimitError(forkError)) {
        process.stdout.write(`[RATE LIMIT] GitHub rate limit hit for ${repoFullName}. Skipping.\n`);
        return 0;
      }
      throw forkError;
    }

    try {
      await runCommand(["git", "clone", "--depth=1", forkUrl, workspacePath]);
    } catch (cloneError: unknown) {
      if (isRateLimitError(cloneError)) {
        process.stdout.write(`[RATE LIMIT] GitHub rate limit hit for ${repoFullName}. Skipping.\n`);
        return 0;
      }
      throw cloneError;
    }

    const compliance = await checkContributingCompliance(workspacePath);
    if (compliance.hasCLA) {
      await rm(workspacePath, { recursive: true, force: true });
      throw new Error("Cannot submit: CLA required for this repository");
    }

    if (compliance.requiresIssueFirst && !options.skipIssueCheck) {
      warn("Warning: Repository requires opening an issue before PR. Proceeding anyway...");
    }

    await runCommand(["git", "-C", workspacePath, "checkout", "-b", branchName]);

    await applyFixChanges(workspacePath, fix);

    const commitTitle = `fix(#${issue.number}): ${shortDescription(issue.title)}`;
    await runCommand(["git", "-C", workspacePath, "add", "."]);
    await runCommand(["git", "-C", workspacePath, "commit", "-m", commitTitle, "-m", AI_DISCLOSURE]);

    try {
      await runCommand(["git", "-C", workspacePath, "push", "origin", branchName]);
    } catch (pushError: unknown) {
      await rm(workspacePath, { recursive: true, force: true });
      if (isRateLimitError(pushError)) {
        process.stdout.write(`[RATE LIMIT] GitHub rate limit hit for ${repoFullName}. Skipping.\n`);
        return 0;
      }
      throw pushError;
    }

    const prTitle = commitTitle;
    const prBody = createPRBody(issue.number, fix);

    let prUrl: string;
    try {
      const prOutput = await runCommand([
        "gh",
        "pr",
        "create",
        "--repo",
        repoFullName,
        "--head",
        `${forkOwner}:${branchName}`,
        "--title",
        prTitle,
        "--body",
        prBody,
      ]);
      prUrl = extractGitHubUrl(prOutput, "gh pr create");
    } catch (prError: unknown) {
      await rm(workspacePath, { recursive: true, force: true });
      if (isRateLimitError(prError)) {
        process.stdout.write(`[RATE LIMIT] GitHub rate limit hit for ${repoFullName}. Skipping.\n`);
        return 0;
      }
      throw prError;
    }

    const submissionRecord = buildSubmissionRecord(issueId, repoFullName, prUrl, branchName);

    await saveContribution(
      {
        repo: repoFullName,
        type: contributionType,
        description: fix.explanation,
        filePath: primaryFilePath,
        branchName,
        prNumber: submissionRecord.prNumber,
        prUrl,
        status: "submitted",
      },
      historyPath,
    );

    await recordSubmission(repoFullName, rateLimitsPath);

    await updateState(state, transition(state.status, "submitted"), {
      prUrl,
      prNumber: submissionRecord.prNumber,
      branchName,
    }, submissionRecord);

    await rm(join(WORKSPACE_ROOT), { recursive: true, force: true });
    return 0;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown submit failure";

    logError(message);
    await updateState(state, "submit_failed", {
      error: message,
    });
    return 1;
  }
};

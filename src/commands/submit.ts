import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { loadState, saveState, transition, getStateData } from "../lib/state";
import type { FixResult, PRSubmission, PipelineState, PipelineStatus } from "../types";

const WORKSPACE_ROOT = ".gittributor/workspace";
const AI_DISCLOSURE =
  "This fix was generated with AI assistance (Anthropic Claude) and reviewed by a human.";

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
  const data = {
    review: reviewState ?? undefined,
  } satisfies SubmissionStateData;

  if (typeof data.review?.issueId === "number") {
    return data.review.issueId;
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

const ensureApprovedReview = (state: PipelineState, data: SubmissionStateData): void => {
  const decision = data.review?.decision;
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

export const submitApprovedFix = async (): Promise<number> => {
  const state = await loadState();
  const reviewState = getStateData<ReviewStateData>("review");
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

    const branchName = `gittributor/fix-${issue.number}`;
    const workspacePath = join(WORKSPACE_ROOT, repoName);

    const forkOutput = await runCommand(["gh", "repo", "fork", repoFullName, "--clone=false"]);
    const forkUrl = extractGitHubUrl(forkOutput, "gh repo fork");
    const forkOwner = extractRepoOwner(forkUrl);

    await runCommand(["git", "clone", "--depth=1", forkUrl, workspacePath]);
    await runCommand(["git", "-C", workspacePath, "checkout", "-b", branchName]);

    await applyFixChanges(workspacePath, fix);

    const commitTitle = `fix(#${issue.number}): ${shortDescription(issue.title)}`;
    await runCommand(["git", "-C", workspacePath, "add", "."]);
    await runCommand(["git", "-C", workspacePath, "commit", "-m", commitTitle, "-m", AI_DISCLOSURE]);
    await runCommand(["git", "-C", workspacePath, "push", "origin", branchName]);

    const prTitle = commitTitle;
    const prBody = createPRBody(issue.number, fix);
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
    const prUrl = extractGitHubUrl(prOutput, "gh pr create");
    const submissionRecord = buildSubmissionRecord(issueId, repoFullName, prUrl, branchName);

    await updateState(state, transition(state.status, "submitted"), {
      prUrl,
      prNumber: submissionRecord.prNumber,
      branchName,
    }, submissionRecord);

    await rm(join(WORKSPACE_ROOT), { recursive: true, force: true });
    return 0;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown submit failure";

    console.error(message);
    await updateState(state, "submit_failed", {
      error: message,
    });
    return 1;
  }
};

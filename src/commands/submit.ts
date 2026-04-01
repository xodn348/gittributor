import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { loadState, saveState, transition } from "../lib/state";
import type { FixResult, PipelineState, PipelineStatus } from "../types";

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

const getStateData = (state: PipelineState): SubmissionStateData => {
  const candidate = (state as unknown as { data?: unknown }).data;
  if (!candidate || typeof candidate !== "object") {
    return {};
  }

  return candidate as SubmissionStateData;
};

const selectIssueId = (state: PipelineState, data: SubmissionStateData): number => {
  if (typeof data.review?.issueId === "number") {
    return data.review.issueId;
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

const appendSubmissionData = (
  state: PipelineState,
  patch: SubmissionStateData["submission"],
): Record<string, unknown> => {
  const existingData = getStateData(state);
  return {
    ...existingData,
    submission: {
      ...existingData.submission,
      ...patch,
    },
  };
};

const updateState = async (
  state: PipelineState,
  status: PipelineStatus | "submit_failed",
  submissionPatch: SubmissionStateData["submission"],
): Promise<void> => {
  const nextState = {
    ...state,
    status,
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
  const stateData = getStateData(state);

  try {
    ensureApprovedReview(state, stateData);

    const issueId = selectIssueId(state, stateData);
    const issue = state.issues.find((entry) => entry.id === issueId || entry.number === issueId);
    if (!issue) {
      throw new Error(`Cannot submit: issue ${issueId} not found in pipeline state`);
    }

    const rawFix = state.fixes[issueId as unknown as keyof typeof state.fixes];
    if (!rawFix) {
      throw new Error(`Cannot submit: fix for issue ${issueId} not found`);
    }

    const fix = rawFix as unknown as FixResultWithChanges;
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
      "--title",
      prTitle,
      "--body",
      prBody,
    ]);
    const prUrl = extractGitHubUrl(prOutput, "gh pr create");

    await updateState(state, transition(state.status, "submitted"), {
      prUrl,
      prNumber: extractPRNumber(prUrl),
      branchName,
    });

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

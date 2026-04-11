import { join } from "node:path";
import { loadState, saveState, setStateData, transition, getStateData } from "../lib/state.js";
import type { ContributionOpportunity, ContributionType } from "../types/index.js";

const ANSI_RESET = "\x1b[0m";
const ANSI_GREEN = "\x1b[32m";
const ANSI_YELLOW = "\x1b[33m";
const ANSI_RED = "\x1b[31m";

interface FixChange {
  file: string;
  original: string;
  modified: string;
}

interface FixReviewPayload {
  issueTitle: string;
  issueDescription: string;
  changes: FixChange[];
  explanation: string;
  confidence: number;
}

interface WritableLike {
  write: (chunk: string) => boolean;
}

interface PromptInput {
  setEncoding: (encoding?: BufferEncoding) => unknown;
  resume: () => void;
  pause: () => void;
  once: (event: "data", listener: (chunk: string) => void) => void;
}

export interface ReviewCommandIO {
  stdin: PromptInput;
  stdout: WritableLike;
  stderr: WritableLike;
}

const toLines = (content: string): string[] => {
  return content
    .split("\n")
    .map((line) => line.replace(/\r$/, ""))
    .filter((line) => line.length > 0);
};

const readPrompt = async (
  prompt: string,
  io: ReviewCommandIO,
): Promise<string> => {
  io.stdout.write(prompt);
  io.stdin.setEncoding("utf8");
  io.stdin.resume();

  return new Promise((resolve) => {
    io.stdin.once("data", (chunk) => {
      io.stdin.pause();
      resolve(chunk.trim());
    });
  });
};

const readDecision = async (io: ReviewCommandIO): Promise<"a" | "r" | "s"> => {
  while (true) {
    const action = (await readPrompt("[a]pprove / [r]eject / [s]kip: ", io)).toLowerCase();

    if (action === "a" || action === "r" || action === "s") {
      return action;
    }

    io.stderr.write("Invalid selection. Enter a, r, or s.\n");
  }
};

const asString = (value: unknown, fallback = ""): string => {
  return typeof value === "string" ? value : fallback;
};

const asNumber = (value: unknown, fallback = 0): number => {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
};

const parseFixPayload = (value: unknown): FixReviewPayload => {
  const payload = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const issue =
    typeof payload.issue === "object" && payload.issue !== null
      ? (payload.issue as Record<string, unknown>)
      : {};

  const changes = Array.isArray(payload.changes)
    ? payload.changes
        .map((entry) => {
          const record =
            typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>) : null;

          if (!record) {
            return null;
          }

          return {
            file: asString(record.file, asString(record.filePath, "(unknown file)")),
            original: asString(record.original),
            modified: asString(record.modified),
          };
        })
        .filter((entry): entry is FixChange => entry !== null)
    : [];

  return {
    issueTitle: asString(issue.title, "(no issue title)"),
    issueDescription: asString(issue.description),
    changes,
    explanation: asString(payload.explanation),
    confidence: asNumber(payload.confidence),
  };
};

const writeFixSummary = (payload: FixReviewPayload, io: ReviewCommandIO): void => {
  io.stdout.write(`Issue: ${payload.issueTitle}\n`);
  io.stdout.write(`Description: ${payload.issueDescription || "(no description)"}\n\n`);

  for (const change of payload.changes) {
    io.stdout.write(`File: ${change.file}\n`);

    for (const line of toLines(change.original)) {
      io.stdout.write(`${ANSI_RED}-${line}${ANSI_RESET}\n`);
    }

    for (const line of toLines(change.modified)) {
      io.stdout.write(`${ANSI_GREEN}+${line}${ANSI_RESET}\n`);
    }

    io.stdout.write("\n");
  }

  io.stdout.write(`AI explanation: ${payload.explanation || "(none provided)"}\n`);
  io.stdout.write(`Confidence score: ${payload.confidence}\n\n`);
};

const loadFixPayload = async (): Promise<FixReviewPayload> => {
  const filePath = join(process.cwd(), ".gittributor", "fix.json");
  const content = await Bun.file(filePath).json();
  return parseFixPayload(content);
};

const updateReviewState = async (
  state: Awaited<ReturnType<typeof loadState>>,
  decision: "approved" | "rejected",
  reason?: string,
): Promise<void> => {
  const nextStatus = transition("fixed", "reviewed");
  await saveState({ ...state, status: nextStatus });
  await setStateData("review", {
    decision,
    ...(reason ? { reason } : {}),
  });
};

export async function reviewFixes(
  ioOverrides: Partial<ReviewCommandIO> = {},
  { autoApprove }: { autoApprove?: boolean } = {}
): Promise<number> {
  const io: ReviewCommandIO = {
    stdin: ioOverrides.stdin ?? process.stdin,
    stdout: ioOverrides.stdout ?? process.stdout,
    stderr: ioOverrides.stderr ?? process.stderr,
  };
  const state = await loadState();

  if (state.status !== "fixed") {
    const message = "No fixes available for review. Run 'fix' command first.";
    io.stderr.write(`${message}\n`);
    process.exitCode = 1;
    return 1;
  }

  let fixPayload: FixReviewPayload;
  try {
    fixPayload = await loadFixPayload();
  } catch (err) {
    const isNotFound = err instanceof Error && err.message.includes("ENOENT");
    if (isNotFound) {
      const message = "No fixes available for review. Run 'fix' command first.";
      io.stderr.write(`${message}\n`);
      process.exitCode = 1;
      return 1;
    }
    throw err;
  }
  writeFixSummary(fixPayload, io);

  let action: "a" | "r" | "s";
  if (autoApprove) {
    io.stdout.write("Auto-approving fix (pipeline mode)...\n");
    action = "a";
  } else {
    action = await readDecision(io);
  }

  if (action === "s") {
    return 0;
  }

  if (action === "r") {
    const reason = await readPrompt("Rejection reason: ", io);
    await updateReviewState(state, "rejected", reason);
    return 0;
  }

  await updateReviewState(state, "approved");
  return 0;
}

export const reviewFix = reviewFixes;

const CONTRIBUTION_TYPE_LABELS: Record<ContributionType, string> = {
  typo: "Typo",
  docs: "Docs",
  deps: "Deps",
  test: "Test",
  code: "Code",
  "bug-fix": "Bug Fix",
  performance: "Performance",
  "type-safety": "Type Safety",
  "logic-error": "Logic Error",
  "static-analysis": "Static Analysis",
};

interface ContributionReviewIO {
  stdout: WritableLike;
  stderr: WritableLike;
}

interface ReviewContributionsOptions extends Partial<ContributionReviewIO> {
  typeFilter?: ContributionType;
}

const getColorForScore = (score: number): string => {
  if (score > 0.7) return ANSI_GREEN;
  if (score >= 0.4) return ANSI_YELLOW;
  return ANSI_RED;
};

const groupByType = (
  opportunities: ContributionOpportunity[],
): Map<ContributionType, ContributionOpportunity[]> => {
  const grouped = new Map<ContributionType, ContributionOpportunity[]>();
  for (const opp of opportunities) {
    const existing = grouped.get(opp.type) ?? [];
    existing.push(opp);
    grouped.set(opp.type, existing);
  }
  return grouped;
};

const hasCLAIssue = (opp: ContributionOpportunity): boolean => {
  const repo = opp.repo as { hasCLA?: boolean };
  return repo.hasCLA === true;
};

const hasIssueFirstRequirement = (opp: ContributionOpportunity): boolean => {
  const repo = opp.repo as { requiresIssueFirst?: boolean };
  return repo.requiresIssueFirst === true;
};

const writeOpportunityDetails = (opp: ContributionOpportunity, io: ContributionReviewIO): void => {
  const color = getColorForScore(opp.mergeProbability.score);
  io.stdout.write(`  [${color}${opp.mergeProbability.score.toFixed(2)}${ANSI_RESET}] ${opp.repo.fullName}\n`);
  io.stdout.write(`    ${opp.description}\n`);
  io.stdout.write(`    File: ${opp.filePath || "(multiple)"}\n`);

  if (opp.mergeProbability.reasons.length > 0) {
    io.stdout.write(`    Factors: ${opp.mergeProbability.reasons.join(", ")}\n`);
  }

  if (hasCLAIssue(opp)) {
    io.stdout.write(`${ANSI_YELLOW}    ⚠ CLA required${ANSI_RESET}\n`);
  }
  if (hasIssueFirstRequirement(opp)) {
    io.stdout.write(`${ANSI_YELLOW}    ⚠ Issue-first required${ANSI_RESET}\n`);
  }
};

const writeSummary = (
  grouped: Map<ContributionType, ContributionOpportunity[]>,
  allOpportunities: ContributionOpportunity[],
  io: ContributionReviewIO,
): void => {
  io.stdout.write("\n═══════════════════════════════════════════\n");
  io.stdout.write("SUMMARY\n");
  io.stdout.write("═══════════════════════════════════════════\n");

  for (const [type, opps] of grouped) {
    io.stdout.write(`  ${CONTRIBUTION_TYPE_LABELS[type].toLowerCase()}: ${opps.length}\n`);
  }

  if (allOpportunities.length > 0) {
    const avgScore =
      allOpportunities.reduce((sum, o) => sum + o.mergeProbability.score, 0) /
      allOpportunities.length;
    io.stdout.write(`  Average merge probability: ${avgScore.toFixed(2)}\n`);

    const sorted = [...allOpportunities].sort(
      (a, b) => b.mergeProbability.score - a.mergeProbability.score,
    );
    const top = sorted[0];
    io.stdout.write(`\nRECOMMENDED: ${top.repo.fullName}\n`);
    io.stdout.write(`  Type: ${CONTRIBUTION_TYPE_LABELS[top.type]}\n`);
    io.stdout.write(`  Score: ${getColorForScore(top.mergeProbability.score)}${top.mergeProbability.score.toFixed(2)}${ANSI_RESET}\n`);
    io.stdout.write(`  ${top.description}\n`);
  }
};

export async function reviewContributions(
  options: ReviewContributionsOptions = {},
): Promise<number> {
  const io: ContributionReviewIO = {
    stdout: options.stdout ?? process.stdout,
    stderr: options.stderr ?? process.stderr,
  };

  const opportunities = getStateData<ContributionOpportunity[]>("contributionOpportunities");

  if (!opportunities || opportunities.length === 0) {
    io.stdout.write("No contributions found.\n");
    io.stdout.write("Run 'analyze' command first to discover contribution opportunities.\n");
    return 0;
  }

  let filtered = opportunities;
  if (options.typeFilter) {
    filtered = opportunities.filter((o) => o.type === options.typeFilter);
    if (filtered.length === 0) {
      io.stdout.write(`No contributions found for type '${options.typeFilter}'.\n`);
      return 0;
    }
  }

  const grouped = groupByType(filtered);

  io.stdout.write("═══════════════════════════════════════════\n");
  io.stdout.write("CONTRIBUTION OPPORTUNITIES\n");
  io.stdout.write("═══════════════════════════════════════════\n\n");

  for (const [type, opps] of grouped) {
    io.stdout.write(`${CONTRIBUTION_TYPE_LABELS[type]} (${opps.length})\n`);
    io.stdout.write("───────────────────────────────────────────\n");
    for (const opp of opps) {
      writeOpportunityDetails(opp, io);
    }
    io.stdout.write("\n");
  }

  writeSummary(grouped, filtered, io);

  return 0;
}

const VALID_TYPES: readonly ContributionType[] = ["typo", "docs", "deps", "test", "code"];

export function parseTypeFilter(args: string[]): ContributionType | null {
  const typeIndex = args.indexOf("--type");
  if (typeIndex !== -1 && typeIndex + 1 < args.length) {
    const value = args[typeIndex + 1];
    if (VALID_TYPES.includes(value as ContributionType)) {
      return value as ContributionType;
    }
    return null;
  }

  for (const arg of args) {
    if (arg.startsWith("--type=")) {
      const value = arg.slice("--type=".length);
      if (VALID_TYPES.includes(value as ContributionType)) {
        return value as ContributionType;
      }
    }
  }

  return null;
}

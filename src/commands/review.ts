import { join } from "node:path";
import { loadState, saveState, setStateData, transition } from "../lib/state";

const ANSI_RESET = "\x1b[0m";
const ANSI_GREEN = "\x1b[32m";
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

export async function reviewFixes(ioOverrides: Partial<ReviewCommandIO> = {}): Promise<number> {
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

  const fixPayload = await loadFixPayload();
  writeFixSummary(fixPayload, io);

  const action = await readDecision(io);

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

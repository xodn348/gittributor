import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PipelineState, PipelineStatus } from "../src/types";
import {
  loadState as _loadStateBinding,
  saveState as _saveStateBinding,
  setStateData as _setStateDataBinding,
  transition as _transitionBinding,
} from "../src/lib/state";

const _realLoadState = _loadStateBinding;
const _realSaveState = _saveStateBinding;
const _realSetStateData = _setStateDataBinding;
const _realTransition = _transitionBinding;

let _currentLoadState: typeof _realLoadState = _realLoadState;
let _currentSaveState: typeof _realSaveState = _realSaveState;
let _currentSetStateData: typeof _realSetStateData = _realSetStateData;
let _currentTransition: typeof _realTransition = _realTransition;

const establishStateMock = (): void => {
  mock.module("../src/lib/state", () => ({
    loadState: (): ReturnType<typeof _realLoadState> => _currentLoadState(),
    saveState: (state: PipelineState): ReturnType<typeof _realSaveState> => _currentSaveState(state),
    setStateData: (key: string, data: unknown): ReturnType<typeof _realSetStateData> =>
      _currentSetStateData(key, data),
    transition: (from: PipelineStatus, to: PipelineStatus): ReturnType<typeof _realTransition> =>
      _currentTransition(from, to),
  }));
};

establishStateMock();

class ControlledStdin {
  private readonly queue: string[];

  constructor(lines: string[]) {
    this.queue = [...lines];
  }

  setEncoding(_encoding?: BufferEncoding): void {}

  pause(): void {}

  resume(): void {}

  once(event: "data", listener: (chunk: string) => void): void {
    if (event !== "data") {
      return;
    }

    const next = this.queue.shift() ?? "";
    queueMicrotask(() => listener(`${next}\n`));
  }
}

interface WritableCapture {
  text: string;
  write: (chunk: string) => boolean;
}

type LoadedState = Awaited<ReturnType<typeof _realLoadState>>;

const createWritableCapture = (): WritableCapture => {
  const capture: WritableCapture = {
    text: "",
    write(chunk: string): boolean {
      capture.text += chunk;
      return true;
    },
  };

  return capture;
};

const makeState = (status: PipelineStatus): LoadedState => {
  return {
    version: "1.0.0",
    status,
    repositories: [],
    issues: [],
    analyses: {},
    fixes: {},
    submissions: [],
    lastUpdated: new Date().toISOString(),
    data: {},
  };
};

const writeFixFixture = async (cwd: string): Promise<void> => {
  await mkdir(join(cwd, ".gittributor"), { recursive: true });
  await Bun.write(
    join(cwd, ".gittributor", "fix.json"),
    JSON.stringify(
      {
        issue: {
          title: "Parser drops trailing commas",
          description: "Repro in src/parser.ts when parsing trailing commas.",
        },
        changes: [
          {
            filePath: "src/parser.ts",
            original: "const hasComma = false;",
            modified: "const hasComma = true;",
          },
        ],
        explanation: "Adjusted parsing branch to preserve optional separator handling.",
        confidence: 0.87,
      },
      null,
      2,
    ),
  );
};

let reviewModuleLoadCounter = 0;

const loadReviewModule = async (): Promise<typeof import("../src/commands/review")> => {
  reviewModuleLoadCounter += 1;
  return import(`../src/commands/review.ts?cacheBust=${reviewModuleLoadCounter}`);
};

describe("reviewFixes", () => {
  let previousCwd = "";
  let tempDir = "";
  const transitionCalls: Array<{ from: PipelineStatus; to: PipelineStatus }> = [];
  const saveStateCalls: PipelineState[] = [];
  const setStateDataCalls: Array<{ key: string; data: unknown }> = [];

  beforeEach(async () => {
    previousCwd = process.cwd();
    tempDir = await mkdtemp(join(tmpdir(), "gittributor-review-"));
    process.chdir(tempDir);
    await writeFixFixture(tempDir);

    transitionCalls.length = 0;
    saveStateCalls.length = 0;
    setStateDataCalls.length = 0;

    _currentLoadState = async () => makeState("fixed");
    _currentTransition = (from: PipelineStatus, to: PipelineStatus) => {
      transitionCalls.push({ from, to });
      return to;
    };
    _currentSaveState = async (state: PipelineState) => {
      saveStateCalls.push(state);
    };
    _currentSetStateData = async (key: string, data: unknown) => {
      setStateDataCalls.push({ key, data });
    };
  });

  afterEach(async () => {
    process.chdir(previousCwd);
    await rm(tempDir, { recursive: true, force: true });

    _currentLoadState = _realLoadState;
    _currentSaveState = _realSaveState;
    _currentSetStateData = _realSetStateData;
    _currentTransition = _realTransition;

    mock.restore();
    establishStateMock();
  });

  it("approve flow transitions fixed -> reviewed and stores approved decision", async () => {
    const { reviewFixes } = await loadReviewModule();
    const stdout = createWritableCapture();
    const stderr = createWritableCapture();

    const exitCode = await reviewFixes({
      stdin: new ControlledStdin(["a"]),
      stdout,
      stderr,
    });

    expect(exitCode).toBe(0);
    expect(stderr.text).toBe("");
    expect(transitionCalls).toEqual([{ from: "fixed", to: "reviewed" }]);
    expect(saveStateCalls).toEqual([expect.objectContaining({ status: "reviewed" })]);
    expect(setStateDataCalls).toEqual([{ key: "review", data: { decision: "approved" } }]);
    expect(stdout.text).toContain("Issue: Parser drops trailing commas");
    expect(stdout.text).toContain("Description: Repro in src/parser.ts when parsing trailing commas.");
    expect(stdout.text).toContain(
      "AI explanation: Adjusted parsing branch to preserve optional separator handling.",
    );
    expect(stdout.text).toContain("Confidence score: 0.87");
    expect(stdout.text).toContain("\x1b[31m-const hasComma = false;\x1b[0m");
    expect(stdout.text).toContain("\x1b[32m+const hasComma = true;\x1b[0m");
  });

  it("reject flow prompts for reason and stores rejected decision with reason", async () => {
    const { reviewFixes } = await loadReviewModule();
    const stdout = createWritableCapture();

    const exitCode = await reviewFixes({
      stdin: new ControlledStdin(["r", "Need regression coverage"]),
      stdout,
      stderr: createWritableCapture(),
    });

    expect(exitCode).toBe(0);
    expect(transitionCalls).toEqual([{ from: "fixed", to: "reviewed" }]);
    expect(saveStateCalls).toEqual([expect.objectContaining({ status: "reviewed" })]);
    expect(setStateDataCalls).toEqual([
      {
        key: "review",
        data: {
          decision: "rejected",
          reason: "Need regression coverage",
        },
      },
    ]);
    expect(stdout.text).toContain("Rejection reason:");
  });

  it("skip flow exits cleanly with no state transition", async () => {
    const { reviewFixes } = await loadReviewModule();

    const exitCode = await reviewFixes({
      stdin: new ControlledStdin(["s"]),
      stdout: createWritableCapture(),
      stderr: createWritableCapture(),
    });

    expect(exitCode).toBe(0);
    expect(transitionCalls).toEqual([]);
    expect(saveStateCalls).toEqual([]);
    expect(setStateDataCalls).toEqual([]);
  });

  it("returns code 1 when state is not fixed", async () => {
    _currentLoadState = async () => makeState("analyzed");
    const { reviewFixes } = await loadReviewModule();
    const stderr = createWritableCapture();

    const exitCode = await reviewFixes({
      stdin: new ControlledStdin(["a"]),
      stdout: createWritableCapture(),
      stderr,
    });

    expect(exitCode).toBe(1);
    expect(stderr.text).toContain("No fixes available for review. Run 'fix' command first.");
    expect(transitionCalls).toEqual([]);
    expect(saveStateCalls).toEqual([]);
    expect(setStateDataCalls).toEqual([]);
  });
});

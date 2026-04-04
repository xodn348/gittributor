import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Config, Issue, PipelineState, Repository } from "../src/types";
import type { ScoredIssue } from "../src/commands/analyze";
import { acquireGlobalTestLock } from "./helpers/global-test-lock";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

interface CliRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface RunCliOptions {
  env?: Record<string, string | undefined>;
}

interface PersistedPipelineStateLike extends PipelineState {
  data: Record<string, unknown>;
}

const escapeShellArgument = (value: string): string => {
  return `'${value.replaceAll("'", `'\\''`)}'`;
};

const runCli = async (argumentsList: string[], options: RunCliOptions = {}): Promise<CliRunResult> => {
  const shellCommand = `bun run src/index.ts ${argumentsList.map(escapeShellArgument).join(" ")}`.trim();
  const processHandle = Bun.spawn({
    cmd: ["/bin/sh", "-lc", shellCommand],
    cwd: projectRoot,
    env: {
      ...process.env,
      ANTHROPIC_API_KEY: "test-anthropic-key",
      GITHUB_TOKEN: "test-github-token",
      ...options.env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(processHandle.stdout).text(),
    new Response(processHandle.stderr).text(),
    processHandle.exited,
  ]);

  return { exitCode, stdout, stderr };
};

describe("src/index.ts", () => {
  test("prints help with all supported subcommands", async () => {
    const result = await runCli(["--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("discover");
    expect(result.stdout).toContain("analyze");
    expect(result.stdout).toContain("fix");
    expect(result.stdout).toContain("review");
    expect(result.stdout).toContain("submit");
  });

  test("prints the semver version from package.json", async () => {
    const packageJson = (await Bun.file(join(projectRoot, "package.json")).json()) as {
      version?: string;
    };
    if (typeof packageJson.version !== "string") {
      throw new TypeError("package.json must define a version string");
    }

    const result = await runCli(["--version"]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe(packageJson.version);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/);
  });

  test("exits with code 1 for unknown commands", async () => {
    const result = await runCli(["ship-it"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Unknown command. Run --help for usage");
  });

  test("rejects unsupported flags for discover", async () => {
    const result = await runCli(["discover", "--bogus=true"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Unknown option for discover: --bogus=true");
  });

  test("review dispatch does not require unrelated config env vars", async () => {
    const result = await runCli(["review"], {
      env: {
        ANTHROPIC_API_KEY: undefined,
        GITHUB_TOKEN: undefined,
      },
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("No fixes available for review. Run 'fix' command first.");
  });
});

const createMockIo = (): {
  io: {
    stdout: { write: (chunk: string) => boolean };
    stderr: { write: (chunk: string) => boolean };
  };
  readStdout: () => string;
  readStderr: () => string;
} => {
  let stdout = "";
  let stderr = "";

  return {
    io: {
      stdout: {
        write: (chunk: string) => {
          stdout += chunk;
          return true;
        },
      },
      stderr: {
        write: (chunk: string) => {
          stderr += chunk;
          return true;
        },
      },
    },
    readStdout: () => stdout,
    readStderr: () => stderr,
  };
};

const createRepository = (name: string): Repository => {
  return {
    id: Number(name.replace("repo", "")) || 1,
    name,
    fullName: `owner/${name}`,
    url: `https://github.com/owner/${name}`,
    stars: 100,
    language: "TypeScript",
    openIssuesCount: 10,
    updatedAt: "2026-04-01T00:00:00.000Z",
    description: `${name} description`,
  };
};

const createState = (repositories: Repository[]): PersistedPipelineStateLike => {
  return {
    version: "1.0.0",
    status: "discovered",
    repositories,
    issues: [],
    analyses: {},
    fixes: {},
    submissions: [],
    lastUpdated: "2026-04-01T00:00:00.000Z",
    data: {},
  };
};

describe("runCli analyze command repository fallback (RED)", () => {
  let releaseGlobalLock: (() => void) | null = null;

  beforeEach(async () => {
    releaseGlobalLock = await acquireGlobalTestLock();
  });

  afterEach(() => {
    mock.restore();
    releaseGlobalLock?.();
    releaseGlobalLock = null;
  });

  test("skips repos with no issues and uses first repo with results", async () => {
    const repositories = [createRepository("repoA"), createRepository("repoB"), createRepository("repoC")];
    const mockIssue = {
      id: 2001,
      number: 42,
      title: "Fix analyzer fallback",
      body: "Issue body",
      url: `https://github.com/${repositories[1]!.fullName}/issues/42`,
      repoFullName: repositories[1]!.fullName,
      labels: ["good first issue"],
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
      assignees: [],
      reactions: 5,
      commentsCount: 1,
      approachabilityScore: 4,
      impactScore: 3,
      codebaseScore: 2,
      totalScore: 9,
    };

    const loadStateMock = mock(async () => createState(repositories));
    const saveStateMock = mock(async (_state: unknown) => {});
    const discoverIssuesMock = mock(async (repository: Repository) => {
      if (repository.fullName === repositories[0]!.fullName) {
        return [];
      }

      if (repository.fullName === repositories[1]!.fullName) {
        return [mockIssue];
      }

      return [];
    });

    const printIssueProposalTableMock = mock((_repository: Repository, _issues: unknown[]) => {});
    const { runAnalyzeCommand } = await import("../src/index");
    const io = createMockIo();

    const exitCode = await runAnalyzeCommand(io.io, {
      loadState: loadStateMock,
      saveState: saveStateMock,
      discoverIssues: discoverIssuesMock,
      printIssueProposalTable: printIssueProposalTableMock,
    });

    expect(exitCode).toBe(0);
    expect(saveStateMock).toHaveBeenCalledTimes(1);
    expect(saveStateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "analyzed",
        issues: [mockIssue],
      }),
    );
    expect(discoverIssuesMock.mock.calls.map(([repository]) => (repository as Repository).fullName)).toEqual([
      repositories[0]!.fullName,
      repositories[1]!.fullName,
    ]);
  });

  test("throws error when all repos yield 0 issues", async () => {
    const repositories = [createRepository("repoA"), createRepository("repoB")];
    const loadStateMock = mock(async () => createState(repositories));
    const saveStateMock = mock(async (_state: unknown) => {});
    const discoverIssuesMock = mock(async (_repository: Repository) => []);

    const printIssueProposalTableMock = mock((_repository: Repository, _issues: unknown[]) => {});
    const { runAnalyzeCommand } = await import("../src/index");
    const io = createMockIo();

    const exitCode = await runAnalyzeCommand(io.io, {
      loadState: loadStateMock,
      saveState: saveStateMock,
      discoverIssues: discoverIssuesMock,
      printIssueProposalTable: printIssueProposalTableMock,
    });

    expect(exitCode).toBe(1);
    expect(io.readStderr()).toContain("No issues found");
    expect(saveStateMock).not.toHaveBeenCalled();
    expect(printIssueProposalTableMock).not.toHaveBeenCalled();
  });
});

describe("runPipelineCommand oversized repository fallback", () => {
  let releaseGlobalLock: (() => void) | null = null;

  beforeEach(async () => {
    releaseGlobalLock = await acquireGlobalTestLock();
  });

  afterEach(() => {
    mock.restore();
    releaseGlobalLock?.();
    releaseGlobalLock = null;
  });

  const runtimeConfig: Config = {
    minStars: 50,
    maxPRsPerDay: 5,
    maxPRsPerRepo: 1,
    targetLanguages: ["typescript"],
    verbose: false,
  };

  test("skips oversized repository and continues to next repository in run pipeline", async () => {
    const repositories = [createRepository("repoA"), createRepository("repoB")];
    const repoAIssue: ScoredIssue = {
      id: 1,
      number: 101,
      title: "Repo A issue",
      body: "issue body",
      url: `https://github.com/${repositories[0]!.fullName}/issues/101`,
      repoFullName: repositories[0]!.fullName,
      labels: ["good first issue"],
      createdAt: "2026-04-01T00:00:00.000Z",
      assignees: [],
      approachabilityScore: 3,
      impactScore: 2,
      codebaseScore: 1,
      totalScore: 6,
    };
    const repoBIssue: ScoredIssue = {
      id: 2,
      number: 202,
      title: "Repo B issue",
      body: "issue body",
      url: `https://github.com/${repositories[1]!.fullName}/issues/202`,
      repoFullName: repositories[1]!.fullName,
      labels: ["good first issue"],
      createdAt: "2026-04-01T00:00:00.000Z",
      assignees: [],
      approachabilityScore: 4,
      impactScore: 2,
      codebaseScore: 1,
      totalScore: 7,
    };

    const runDiscoverCommandMock = mock(async (_runtimeConfig: Config, _commandArgs: string[]) => 0);
    const loadStateMock = mock(async () => createState(repositories));
    const discoverIssuesMock = mock(async (repository: Repository) => {
      if (repository.fullName === repositories[0]!.fullName) {
        return [repoAIssue];
      }

      return [repoBIssue];
    });
    const saveStateMock = mock(async (_state: unknown) => {});
    const runFixCommandMock = mock(async () => {
      if (runFixCommandMock.mock.calls.length === 1) {
        throw new Error("Cannot generate a fix for owner/repoA: automated analysis was skipped because the repository is too large.");
      }

      return 0;
    });
    const reviewFixMock = mock(async () => 0);
    const submitApprovedFixMock = mock(async () => 0);
    const printIssueProposalTableMock = mock((_repository: Repository, _issues: ScoredIssue[]) => {});
    const writeErrorLineMock = mock((output: { stderr: { write: (chunk: string) => boolean } }, message: string) => {
      output.stderr.write(`${message}\n`);
    });

    const { runPipelineCommand } = await import("../src/index");
    const io = createMockIo();

    const exitCode = await runPipelineCommand(runtimeConfig, [], io.io, {
      runDiscoverCommand: runDiscoverCommandMock,
      loadState: loadStateMock,
      discoverIssues: discoverIssuesMock,
      saveState: saveStateMock,
      runFixCommand: runFixCommandMock,
      reviewFix: reviewFixMock,
      submitApprovedFix: submitApprovedFixMock,
      printIssueProposalTable: printIssueProposalTableMock,
      writeErrorLine: writeErrorLineMock,
    });

    expect(exitCode).toBe(0);
    expect(runFixCommandMock).toHaveBeenCalledTimes(2);
    expect(submitApprovedFixMock).toHaveBeenCalledTimes(1);
    expect(reviewFixMock).toHaveBeenCalledTimes(1);
    expect(io.readStderr()).toContain("Skipping owner/repoA");
  });

  test("returns 1 when all repositories have zero fixable issues", async () => {
    const repositories = [createRepository("repoA"), createRepository("repoB")];

    const runDiscoverCommandMock = mock(async (_runtimeConfig: Config, _commandArgs: string[]) => 0);
    const loadStateMock = mock(async () => createState(repositories));
    const discoverIssuesMock = mock(async (_repository: Repository) => [] as ScoredIssue[]);
    const saveStateMock = mock(async (_state: unknown) => {});
    const runFixCommandMock = mock(async () => 0);
    const reviewFixMock = mock(async () => 0);
    const submitApprovedFixMock = mock(async () => 0);
    const printIssueProposalTableMock = mock((_repository: Repository, _issues: ScoredIssue[]) => {});
    const writeErrorLineMock = mock((output: { stderr: { write: (chunk: string) => boolean } }, message: string) => {
      output.stderr.write(`${message}\n`);
    });

    const { runPipelineCommand } = await import("../src/index");
    const io = createMockIo();

    const exitCode = await runPipelineCommand(runtimeConfig, [], io.io, {
      runDiscoverCommand: runDiscoverCommandMock,
      loadState: loadStateMock,
      discoverIssues: discoverIssuesMock,
      saveState: saveStateMock,
      runFixCommand: runFixCommandMock,
      reviewFix: reviewFixMock,
      submitApprovedFix: submitApprovedFixMock,
      printIssueProposalTable: printIssueProposalTableMock,
      writeErrorLine: writeErrorLineMock,
    });

    expect(exitCode).toBe(1);
    expect(runFixCommandMock).not.toHaveBeenCalled();
    expect(submitApprovedFixMock).not.toHaveBeenCalled();
    expect(io.readStderr()).toContain("No fixable issues found across all repositories.");
  });
});

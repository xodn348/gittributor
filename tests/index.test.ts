import { afterEach, describe, expect, mock, test } from "bun:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PipelineState, Repository } from "../src/types";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

interface CliRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface RunCliOptions {
  env?: Record<string, string | undefined>;
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

const createState = (repositories: Repository[]): PipelineState => {
  return {
    version: "1.0.0",
    status: "discovered",
    repositories,
    issues: [],
    analyses: {},
    fixes: {},
    submissions: [],
    lastUpdated: "2026-04-01T00:00:00.000Z",
  };
};

let importNonce = 0;

const nextImportNonce = (): number => {
  importNonce += 1;
  return importNonce;
};

describe("runCli analyze command repository fallback (RED)", () => {
  afterEach(() => {
    mock.restore();
  });

  const mockAnalyzeDependencies = async (params: {
    loadState: () => Promise<PipelineState>;
    saveState: (state: unknown) => Promise<void>;
    discoverIssues: (repository: Repository) => Promise<unknown[]>;
  }): Promise<void> => {
    const actualStateModule = await import("../src/lib/state");
    const actualAnalyzeModule = await import("../src/commands/analyze");

    mock.module("../src/lib/state", () => ({
      ...actualStateModule,
      loadState: params.loadState,
      saveState: params.saveState,
    }));
    mock.module("../src/commands/analyze", () => ({
      ...actualAnalyzeModule,
      discoverIssues: params.discoverIssues,
      printIssueProposalTable: () => {},
    }));
  };

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

    await mockAnalyzeDependencies({
      loadState: loadStateMock,
      saveState: saveStateMock,
      discoverIssues: discoverIssuesMock,
    });

    const { runCli: runCliEntry } = await import(`../src/index.ts?red-${Date.now()}-${nextImportNonce()}`);
    const io = createMockIo();

    await runCliEntry(["analyze"], { io: io.io });

    expect(saveStateMock).toHaveBeenCalledTimes(1);
    expect(saveStateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "analyzed",
        issues: [mockIssue],
      }),
    );
  });

  test("throws error when all repos yield 0 issues", async () => {
    const repositories = [createRepository("repoA"), createRepository("repoB")];
    const loadStateMock = mock(async () => createState(repositories));
    const saveStateMock = mock(async (_state: unknown) => {});
    const discoverIssuesMock = mock(async (_repository: Repository) => []);

    await mockAnalyzeDependencies({
      loadState: loadStateMock,
      saveState: saveStateMock,
      discoverIssues: discoverIssuesMock,
    });

    const { runCli: runCliEntry } = await import(`../src/index.ts?red-${Date.now()}-${nextImportNonce()}`);
    const io = createMockIo();

    const result = await runCliEntry(["analyze"], { io: io.io });

    expect(result.exitCode).toBe(1);
    expect(io.readStderr()).toContain("No issues found");
    expect(saveStateMock).not.toHaveBeenCalled();
  });
});

import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface CapturedOutput {
  io: {
    stdout: { write: (chunk: string) => boolean };
    stderr: { write: (chunk: string) => boolean };
  };
  readStdout: () => string;
  readStderr: () => string;
}

interface StubState {
  analyzeCodebaseCalls: number;
  discoverIssuesCalls: number;
  discoverReposCalls: number;
  generateFixCalls: number;
  reviewFixCalls: number;
  saveStateCalls: number;
  submitApprovedFixCalls: number;
}

interface CliFixture {
  cleanup: () => Promise<void>;
  runCli: (argv: string[], options?: { io?: CapturedOutput["io"] }) => Promise<{ exitCode: number }>;
  state: StubState;
}

interface FixtureOptions {
  oversizedAnalysis?: boolean;
}

declare global {
  var __gittributorCliEntrypointStubState: StubState | undefined;
  var __gittributorCliEntrypointConfigEnv:
    | {
        ANTHROPIC_API_KEY?: string;
        GITHUB_TOKEN?: string;
      }
    | undefined;
}

const packageJson = await Bun.file(new URL("../package.json", import.meta.url)).json() as {
  version?: string;
};

if (typeof packageJson.version !== "string") {
  throw new TypeError("package.json must define a version string");
}

const packageVersion = packageJson.version;

const realIndexSource = await Bun.file(new URL("../src/index.ts", import.meta.url)).text();
const realCliSource = await Bun.file(new URL("../src/commands/cli.ts", import.meta.url)).text();
const realGuardsSource = await Bun.file(new URL("../src/types/guards.ts", import.meta.url)).text();
const realTypesSource = await Bun.file(new URL("../src/types/index.ts", import.meta.url)).text();

const createIo = (): CapturedOutput => {
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

const createStubModuleSource = (): string => {
  return `
interface StubState {
  analyzeCodebaseCalls: number;
  discoverIssuesCalls: number;
  discoverReposCalls: number;
  generateFixCalls: number;
  reviewFixCalls: number;
  saveStateCalls: number;
  submitApprovedFixCalls: number;
}

declare global {
  var __gittributorCliEntrypointStubState: StubState | undefined;
}

export const getStubState = (): StubState => {
  if (!globalThis.__gittributorCliEntrypointStubState) {
    throw new Error("CLI test stub state is not initialized");
  }

  return globalThis.__gittributorCliEntrypointStubState;
};
`;
};

const createFixture = async (options: FixtureOptions = {}): Promise<CliFixture> => {
  const tempDir = await mkdtemp(join(tmpdir(), "gittributor-cli-entrypoint-"));
  const stubState: StubState = {
    analyzeCodebaseCalls: 0,
    discoverIssuesCalls: 0,
    discoverReposCalls: 0,
    generateFixCalls: 0,
    reviewFixCalls: 0,
    saveStateCalls: 0,
    submitApprovedFixCalls: 0,
  };

  globalThis.__gittributorCliEntrypointStubState = stubState;

  await Bun.write(
    join(tempDir, "package.json"),
    JSON.stringify({ name: "gittributor", version: packageVersion, type: "module" }, null, 2),
  );
  await Bun.write(join(tempDir, "src", "index.ts"), realIndexSource);
  await Bun.write(join(tempDir, "src", "commands", "cli.ts"), realCliSource);
  await Bun.write(join(tempDir, "src", "types", "guards.ts"), realGuardsSource);
  await Bun.write(join(tempDir, "src", "types", "index.ts"), realTypesSource);
  await Bun.write(join(tempDir, "src", "test-stubs.ts"), createStubModuleSource());

  await Bun.write(
    join(tempDir, "src", "commands", "discover.ts"),
    `import { getStubState } from "../test-stubs";

export const discoverRepos = async (options: unknown): Promise<unknown[]> => {
  getStubState().discoverReposCalls += 1;
  const recordedPath = Bun.env.GITTRIBUTOR_DISCOVER_OPTIONS_PATH;

  if (recordedPath) {
    await Bun.write(recordedPath, JSON.stringify(options, null, 2));
  }

  return [];
};
`,
  );

  await Bun.write(
    join(tempDir, "src", "commands", "analyze.ts"),
    `import { getStubState } from "../test-stubs";

export const discoverIssues = async (): Promise<unknown[]> => {
  getStubState().discoverIssuesCalls += 1;
  return [{
    id: 123,
    number: 123,
    title: "Issue title",
    body: "Issue body",
    url: "https://github.com/owner/repo/issues/123",
    repoFullName: "owner/repo",
    labels: ["good first issue"],
    createdAt: "2026-04-01T00:00:00.000Z",
    assignees: [],
    reactions: 7,
    commentsCount: 3,
    approachabilityScore: 4,
    impactScore: 2,
    codebaseScore: 1,
    totalScore: 7,
  }];
};

export const printIssueProposalTable = (): void => {
  process.stdout.write("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\\n");
  process.stdout.write("  TOP 5 FIXABLE ISSUES for owner/repo\\n");
  process.stdout.write("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\\n");
  process.stdout.write("[1] #123  Issue title   (score: 7)\\n");
  process.stdout.write("    Complexity: low | 👍 7 reactions\\n");
  process.stdout.write("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\\n");
  process.stdout.write("Run 'gittributor fix' to fix issue #123\\n");
};
`,
  );

  await Bun.write(
    join(tempDir, "src", "commands", "review.ts"),
    `import { getStubState } from "../test-stubs";

export const reviewFix = async (): Promise<number> => {
  getStubState().reviewFixCalls += 1;
  return 0;
};
`,
  );

  await Bun.write(
    join(tempDir, "src", "commands", "submit.ts"),
    `import { getStubState } from "../test-stubs";

export const submitApprovedFix = async (): Promise<number> => {
  getStubState().submitApprovedFixCalls += 1;
  return 0;
};
`,
  );

  await Bun.write(
    join(tempDir, "src", "lib", "analyzer.ts"),
    `import { getStubState } from "../test-stubs";

export const analyzeCodebase = async () => {
  getStubState().analyzeCodebaseCalls += 1;
  return {
    issueId: 123,
    repoFullName: "owner/repo",
    relevantFiles: ${options.oversizedAnalysis ? "[]" : '["src/example.ts"]'},
    suggestedApproach: ${options.oversizedAnalysis ? '"Skip automated analysis because the repository exceeds the analyzer size limit."' : '"Update the example path."'},
    confidence: 0.85,
    analyzedAt: "2026-04-01T00:00:00.000Z",
    rootCause: ${options.oversizedAnalysis ? '"repo too large to analyze"' : 'undefined'},
  };
};

export const sanitizeAnalysisForPersistence = (analysis: unknown) => analysis;
`,
  );

  await Bun.write(
    join(tempDir, "src", "lib", "fix-generator.ts"),
    `import { getStubState } from "../test-stubs";

export const generateFix = async () => {
  getStubState().generateFixCalls += 1;
  return {
    changes: [{ file: "src/example.ts", original: "before", modified: "after" }],
    explanation: "test fix",
    confidence: 0.8,
  };
};
`,
  );

  await Bun.write(
    join(tempDir, "src", "lib", "config.ts"),
    `export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export const loadConfig = async () => {
  const configEnv = globalThis.__gittributorCliEntrypointConfigEnv ?? Bun.env;
  const anthropicApiKey = configEnv.ANTHROPIC_API_KEY?.trim();
  const githubToken = configEnv.GITHUB_TOKEN?.trim();

  if (!anthropicApiKey) {
    throw new ConfigError("Missing required environment variable: ANTHROPIC_API_KEY");
  }

  if (!githubToken) {
    throw new ConfigError("Missing required environment variable: GITHUB_TOKEN");
  }

  return {
    anthropicApiKey,
    minStars: 50,
    maxPRsPerDay: 5,
    maxPRsPerRepo: 1,
    targetLanguages: ["typescript"],
    verbose: Bun.env.GITTRIBUTOR_STUB_LOADED_VERBOSE === "true",
  };
};
`,
  );

  await Bun.write(
    join(tempDir, "src", "lib", "logger.ts"),
    `export const log = (message: string): void => { process.stdout.write(message + "\\n"); };
export const info = (message: string): void => { process.stdout.write(message + "\\n"); };
export const warn = (message: string): void => { process.stderr.write(message + "\\n"); };
export const error = (message: string): void => { process.stderr.write(message + "\\n"); };
export const success = (message: string): void => { process.stdout.write(message + "\\n"); };
export const debug = (message: string): void => {
  if (process.env.VERBOSE === "true") {
    process.stdout.write(message + "\\n");
  }
};
`,
  );

  await Bun.write(
    join(tempDir, "src", "lib", "state.ts"),
    `import { getStubState } from "../test-stubs";

const state = {
  version: "1.0.0",
  status: "analyzed",
  repositories: [
    {
      id: 1,
      name: "repo",
      fullName: "owner/repo",
      url: "https://github.com/owner/repo",
      stars: 100,
      language: "TypeScript",
      openIssuesCount: 3,
      updatedAt: "2026-04-01T00:00:00.000Z",
      description: "Test repo",
    },
  ],
  issues: [
    {
      id: 123,
      number: 123,
      title: "Issue title",
      body: "Issue body",
      url: "https://github.com/owner/repo/issues/123",
      repoFullName: "owner/repo",
      labels: ["good first issue"],
      createdAt: "2026-04-01T00:00:00.000Z",
      assignees: [],
    },
  ],
  analyses: {},
  fixes: {},
  submissions: [],
  lastUpdated: "2026-04-01T00:00:00.000Z",
};

export const loadState = async () => state;
export const saveState = async () => {
  getStubState().saveStateCalls += 1;
};
`,
  );

  const moduleUrl = new URL(`file://${join(tempDir, "src", "index.ts")}?cli-entrypoint=${Date.now()}`);
  const { runCli } = await import(moduleUrl.href);

  return {
    cleanup: async () => {
      delete globalThis.__gittributorCliEntrypointStubState;
      await rm(tempDir, { recursive: true, force: true });
    },
    runCli,
    state: stubState,
  };
};

describe("runCli", () => {
  const fixtures: CliFixture[] = [];
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
    process.env.GITHUB_TOKEN = "test-github-token";
    process.env.VERBOSE = "false";
    delete process.env.GITTRIBUTOR_DISCOVER_OPTIONS_PATH;
    delete process.env.GITTRIBUTOR_STUB_LOADED_VERBOSE;
    Bun.env.ANTHROPIC_API_KEY = "test-anthropic-key";
    Bun.env.GITHUB_TOKEN = "test-github-token";
    Bun.env.VERBOSE = "false";
    delete Bun.env.GITTRIBUTOR_DISCOVER_OPTIONS_PATH;
    delete Bun.env.GITTRIBUTOR_STUB_LOADED_VERBOSE;
    globalThis.__gittributorCliEntrypointConfigEnv = {
      ANTHROPIC_API_KEY: "test-anthropic-key",
      GITHUB_TOKEN: "test-github-token",
    };
  });

  afterEach(async () => {
    while (fixtures.length > 0) {
      const fixture = fixtures.pop();
      if (fixture) {
        await fixture.cleanup();
      }
    }

    delete globalThis.__gittributorCliEntrypointConfigEnv;
    process.env = { ...originalEnv };
    Bun.env.ANTHROPIC_API_KEY = originalEnv.ANTHROPIC_API_KEY;
    Bun.env.GITHUB_TOKEN = originalEnv.GITHUB_TOKEN;
    Bun.env.VERBOSE = originalEnv.VERBOSE;

    if (originalEnv.GITTRIBUTOR_DISCOVER_OPTIONS_PATH) {
      Bun.env.GITTRIBUTOR_DISCOVER_OPTIONS_PATH = originalEnv.GITTRIBUTOR_DISCOVER_OPTIONS_PATH;
    } else {
      delete Bun.env.GITTRIBUTOR_DISCOVER_OPTIONS_PATH;
    }

    if (originalEnv.GITTRIBUTOR_STUB_LOADED_VERBOSE) {
      Bun.env.GITTRIBUTOR_STUB_LOADED_VERBOSE = originalEnv.GITTRIBUTOR_STUB_LOADED_VERBOSE;
    } else {
      delete Bun.env.GITTRIBUTOR_STUB_LOADED_VERBOSE;
    }
  });

  const useFixture = async (options: FixtureOptions = {}): Promise<CliFixture> => {
    const fixture = await createFixture(options);
    fixtures.push(fixture);
    return fixture;
  };

  it("prints help with all supported subcommands", async () => {
    const output = createIo();
    const fixture = await useFixture();

    const result = await fixture.runCli(["--help"], { io: output.io });

    expect(result.exitCode).toBe(0);
    expect(output.readStderr()).toBe("");
    expect(output.readStdout()).toContain("discover");
    expect(output.readStdout()).toContain("analyze");
    expect(output.readStdout()).toContain("fix");
    expect(output.readStdout()).toContain("review");
    expect(output.readStdout()).toContain("submit");
  });

  it("prints the package version from package.json", async () => {
    const output = createIo();
    const fixture = await useFixture();

    const result = await fixture.runCli(["--version"], { io: output.io });

    expect(result.exitCode).toBe(0);
    expect(output.readStderr()).toBe("");
    expect(output.readStdout().trim()).toBe(packageVersion);
  });

  it("returns exit code 1 for an unknown command", async () => {
    const output = createIo();
    const fixture = await useFixture();

    const result = await fixture.runCli(["unknowncmd"], { io: output.io });

    expect(result.exitCode).toBe(1);
    expect(output.readStdout()).toBe("");
    expect(output.readStderr()).toContain("Unknown command");
  });

  it("dispatches discover to discoverRepos", async () => {
    const fixture = await useFixture();

    const result = await fixture.runCli(["discover"]);

    expect(result.exitCode).toBe(0);
    expect(fixture.state.discoverReposCalls).toBe(1);
  });

  it("dispatches analyze to discoverIssues", async () => {
    const fixture = await useFixture();
    const stdoutSpy = spyOn(process.stdout, "write").mockImplementation(() => true);

    const result = await fixture.runCli(["analyze"]);

    expect(result.exitCode).toBe(0);
    expect(fixture.state.discoverIssuesCalls).toBe(1);
    const renderedOutput = stdoutSpy.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(renderedOutput).toContain("TOP 5 FIXABLE ISSUES for owner/repo");
    expect(renderedOutput).toContain("Run 'gittributor fix' to fix issue #123");
    mock.restore();
  });

  it("returns exit code 1 when fix is skipped for oversized repositories", async () => {
    const fixture = await useFixture({ oversizedAnalysis: true });
    const output = createIo();

    const result = await fixture.runCli(["fix"], { io: output.io });

    expect(result.exitCode).toBe(1);
    expect(fixture.state.analyzeCodebaseCalls).toBe(1);
    expect(fixture.state.generateFixCalls).toBe(0);
    expect(output.readStderr()).toContain("automated analysis was skipped because the repository is too large");
  });

  it("dispatches fix without running real integrations", async () => {
    const fixture = await useFixture();

    const result = await fixture.runCli(["fix"]);

    expect(result.exitCode).toBe(0);
    expect(fixture.state.analyzeCodebaseCalls).toBe(1);
    expect(fixture.state.generateFixCalls).toBe(1);
  });

  it("dispatches review to reviewFix", async () => {
    const fixture = await useFixture();

    const result = await fixture.runCli(["review"]);

    expect(result.exitCode).toBe(0);
    expect(fixture.state.reviewFixCalls).toBe(1);
  });

  it("dispatches submit to submitApprovedFix", async () => {
    const fixture = await useFixture();

    const result = await fixture.runCli(["submit"]);

    expect(result.exitCode).toBe(0);
    expect(fixture.state.submitApprovedFixCalls).toBe(1);
  });

  it("enables verbose mode from a global flag before dispatch", async () => {
    const fixture = await useFixture();

    await fixture.runCli(["--verbose", "review"]);

    expect(process.env.VERBOSE).toBe("true");
    expect(fixture.state.reviewFixCalls).toBe(1);
  });

  it("loads config before dispatching review when --config is provided", async () => {
    globalThis.__gittributorCliEntrypointConfigEnv = {
      GITHUB_TOKEN: "test-github-token",
    };
    const fixture = await useFixture();
    const configDirectory = await mkdtemp(join(tmpdir(), "gittributor-cli-config-"));
    const configPath = join(configDirectory, "gittributor.config.json");
    fixtures.push({
      cleanup: async () => {
        await rm(configDirectory, { recursive: true, force: true });
      },
      runCli: fixture.runCli,
      state: fixture.state,
    });
    const output = createIo();

    await Bun.write(configPath, JSON.stringify({ minStars: 120 }, null, 2));

    const result = await fixture.runCli(["--config", configPath, "review"], { io: output.io });

    expect(result.exitCode).toBe(1);
    expect(fixture.state.reviewFixCalls).toBe(0);
    expect(output.readStderr()).toContain("Missing required environment variable: ANTHROPIC_API_KEY");
  });

  it("applies config file overrides before discover dispatch", async () => {
    const fixture = await useFixture();
    const configDirectory = await mkdtemp(join(tmpdir(), "gittributor-cli-config-"));
    const configPath = join(configDirectory, "gittributor.config.json");
    const recordedOptionsPath = join(configDirectory, "discover-options.json");
    fixtures.push({
      cleanup: async () => {
        await rm(configDirectory, { recursive: true, force: true });
      },
      runCli: fixture.runCli,
      state: fixture.state,
    });

    await Bun.write(
      configPath,
      JSON.stringify({ minStars: 120, targetLanguages: ["rust"] }, null, 2),
    );
    process.env.GITTRIBUTOR_DISCOVER_OPTIONS_PATH = recordedOptionsPath;
    Bun.env.GITTRIBUTOR_DISCOVER_OPTIONS_PATH = recordedOptionsPath;

    const result = await fixture.runCli(["--config", configPath, "discover"]);
    const recordedOptions = await Bun.file(recordedOptionsPath).json();

    expect(result.exitCode).toBe(0);
    expect(fixture.state.discoverReposCalls).toBe(1);
    expect(recordedOptions).toEqual({
      language: "rust",
      minStars: 120,
      limit: undefined,
    });
  });

  it("allows config file verbose false to override a true loaded config default", async () => {
    const fixture = await useFixture();
    const configDirectory = await mkdtemp(join(tmpdir(), "gittributor-cli-config-"));
    const configPath = join(configDirectory, "gittributor.config.json");
    fixtures.push({
      cleanup: async () => {
        await rm(configDirectory, { recursive: true, force: true });
      },
      runCli: fixture.runCli,
      state: fixture.state,
    });

    await Bun.write(configPath, JSON.stringify({ verbose: false }, null, 2));
    process.env.GITTRIBUTOR_STUB_LOADED_VERBOSE = "true";
    Bun.env.GITTRIBUTOR_STUB_LOADED_VERBOSE = "true";
    process.env.VERBOSE = "false";
    Bun.env.VERBOSE = "false";

    const result = await fixture.runCli(["--config", configPath, "review"]);

    expect(result.exitCode).toBe(0);
    expect(process.env.VERBOSE).toBe("false");
    expect(fixture.state.reviewFixCalls).toBe(1);
  });
});

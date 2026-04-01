import { afterEach, beforeEach, describe, expect, it } from "bun:test";
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

declare global {
  var __gittributorCliEntrypointStubState: StubState | undefined;
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

const createFixture = async (): Promise<CliFixture> => {
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

  await Bun.write(join(tempDir, "package.json"), JSON.stringify({ name: "gittributor", version: packageVersion, type: "module" }, null, 2));
  await Bun.write(join(tempDir, "src", "index.ts"), realIndexSource);
  await Bun.write(join(tempDir, "src", "commands", "cli.ts"), realCliSource);
  await Bun.write(join(tempDir, "src", "types", "guards.ts"), realGuardsSource);
  await Bun.write(join(tempDir, "src", "types", "index.ts"), realTypesSource);
  await Bun.write(join(tempDir, "src", "test-stubs.ts"), createStubModuleSource());

  await Bun.write(
    join(tempDir, "src", "commands", "discover.ts"),
    `import { getStubState } from "../test-stubs";

export const discoverRepos = async (): Promise<[]> => {
  getStubState().discoverReposCalls += 1;
  return [];
};
`,
  );

  await Bun.write(
    join(tempDir, "src", "commands", "analyze.ts"),
    `import { getStubState } from "../test-stubs";

export const discoverIssues = async (): Promise<[]> => {
  getStubState().discoverIssuesCalls += 1;
  return [];
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
    relevantFiles: ["src/example.ts"],
    suggestedApproach: "Update the example path.",
    confidence: 0.85,
    analyzedAt: "2026-04-01T00:00:00.000Z",
  };
};
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
  return {
    anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
    minStars: 50,
    maxPRsPerDay: 5,
    maxPRsPerRepo: 1,
    targetLanguages: ["typescript"],
    verbose: false,
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
  });

  afterEach(async () => {
    while (fixtures.length > 0) {
      const fixture = fixtures.pop();
      if (fixture) {
        await fixture.cleanup();
      }
    }

    process.env = { ...originalEnv };
  });

  const useFixture = async (): Promise<CliFixture> => {
    const fixture = await createFixture();
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

    const result = await fixture.runCli(["analyze"]);

    expect(result.exitCode).toBe(0);
    expect(fixture.state.discoverIssuesCalls).toBe(1);
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
});

import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireGlobalTestLock } from "./helpers/global-test-lock";
import type { ContributionOpportunity } from "../src/types";

interface MockProcess {
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  exited: Promise<number>;
}

type SpawnResult = ReturnType<typeof Bun.spawn>;

const encoder = new TextEncoder();

const createMockProcess = (opts: { stdout?: string; stderr?: string; exitCode?: number }): SpawnResult => {
  const stdout = opts.stdout ?? "";
  const stderr = opts.stderr ?? "";
  const exitCode = opts.exitCode ?? 0;

  const processStub: MockProcess = {
    stdout: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(stdout));
        controller.close();
      },
    }),
    stderr: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(stderr));
        controller.close();
      },
    }),
    exited: Promise.resolve(exitCode),
  };

  return processStub as unknown as SpawnResult;
};

const createReviewedState = (decision: "approved" | "rejected", extraData: Record<string, unknown> = {}) => ({
  version: "1.0.0",
  status: "reviewed",
  repositories: [],
  issues: [
    {
      id: 17,
      number: 17,
      title: "Fix flaky parser trim path",
      body: "Handle whitespace consistently in parser",
      url: "https://github.com/octocat/hello-world/issues/17",
      repoFullName: "octocat/hello-world",
      labels: ["good first issue"],
      createdAt: "2026-04-01T00:00:00.000Z",
      assignees: [],
    },
  ],
  analyses: {},
  fixes: {
    17: {
      issueId: 17,
      repoFullName: "octocat/hello-world",
      patch: "",
      explanation: "Normalize whitespace parsing for empty input.",
      testsPass: true,
      confidence: 0.91,
      generatedAt: "2026-04-01T00:00:00.000Z",
      changes: [
        {
          file: "src/parser.ts",
          original: "",
          modified: "export const parse = (value: string) => value.trim();\n",
        },
      ],
    },
  },
  submissions: [],
  lastUpdated: "2026-04-01T00:00:00.000Z",
  data: {
    review: {
      issueId: 17,
      decision,
    },
    ...extraData,
  },
});

const createReviewedStateWithOpportunity = (opportunity: ContributionOpportunity) => {
  const state = createReviewedState("approved", { contributionOpportunities: [opportunity] });
  return state;
};

describe("submit command — guardrail blocking", () => {
  const originalCwd = process.cwd();
  let tempDir: string;
  let releaseGlobalLock: (() => void) | null = null;

  beforeEach(async () => {
    releaseGlobalLock = await acquireGlobalTestLock();
    tempDir = mkdtempSync(join(tmpdir(), "gittributor-submit-guardrails-"));
    process.chdir(tempDir);
    mkdirSync(join(tempDir, ".gittributor"), { recursive: true });
    mock.restore();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tempDir, { recursive: true, force: true });
    mock.restore();
    releaseGlobalLock?.();
    releaseGlobalLock = null;
  });

  test("rate limit exceeded blocks submission and returns 1", async () => {
    const now = new Date().toISOString();
    writeFileSync(
      join(tempDir, ".gittributor", "rate-limits.json"),
      JSON.stringify({
        hourly: [
          { submittedAt: now, repo: "octocat/hello-world" },
          { submittedAt: now, repo: "octocat/hello-world" },
          { submittedAt: now, repo: "octocat/hello-world" },
        ],
        weekly: {},
      }),
    );
    writeFileSync(join(tempDir, ".gittributor", "history.json"), JSON.stringify({ contributions: [] }));

    const opportunity: ContributionOpportunity = {
      repo: {
        owner: "octocat",
        name: "hello-world",
        fullName: "octocat/hello-world",
        stars: 5000,
        language: "TypeScript",
        description: "A sample repo",
        isArchived: false,
        defaultBranch: "main",
        hasContributing: false,
        topics: [],
        openIssues: 10,
      },
      type: "code",
      filePath: "src/parser.ts",
      description: "Fix parser",
      mergeProbability: { score: 0.9, label: "high" as const, reasons: [] },
      detectedAt: "2026-04-01T00:00:00.000Z",
    };

    await Bun.write(
      join(tempDir, ".gittributor", "state.json"),
      JSON.stringify(createReviewedStateWithOpportunity(opportunity), null, 2),
    );
    await Bun.write(
      join(tempDir, ".gittributor", "fix.json"),
      JSON.stringify({
        changes: [{ file: "src/parser.ts", original: "", modified: "export const parse = (value: string) => value.trim();\n" }],
        explanation: "Normalize whitespace parsing.",
      }),
    );

    const spawnSpy = spyOn(Bun, "spawn");

    const { submitApprovedFix } = await import("../src/commands/submit");
    const exitCode = await submitApprovedFix();

    expect(exitCode).toBe(1);
    expect(spawnSpy).not.toHaveBeenCalled();
  });

  test("CLA required blocks submission and returns 1", async () => {
    writeFileSync(join(tempDir, ".gittributor", "rate-limits.json"), JSON.stringify({ hourly: [], weekly: {} }));
    writeFileSync(join(tempDir, ".gittributor", "history.json"), JSON.stringify({ contributions: [] }));

    const opportunity: ContributionOpportunity = {
      repo: {
        owner: "octocat",
        name: "hello-world",
        fullName: "octocat/hello-world",
        stars: 5000,
        language: "TypeScript",
        description: "A sample repo",
        isArchived: false,
        defaultBranch: "main",
        hasContributing: false,
        topics: [],
        openIssues: 10,
      },
      type: "code",
      filePath: "src/parser.ts",
      description: "Fix parser",
      mergeProbability: { score: 0.9, label: "high" as const, reasons: [] },
      detectedAt: "2026-04-01T00:00:00.000Z",
    };

    await Bun.write(
      join(tempDir, ".gittributor", "state.json"),
      JSON.stringify(createReviewedStateWithOpportunity(opportunity), null, 2),
    );
    await Bun.write(
      join(tempDir, ".gittributor", "fix.json"),
      JSON.stringify({
        changes: [{ file: "src/parser.ts", original: "", modified: "export const parse = (value: string) => value.trim();\n" }],
        explanation: "Normalize whitespace parsing.",
      }),
    );

    const { checkContributingCompliance } = await import("../src/lib/contributing-checker.js");
    spyOn(checkContributingCompliance, "checkContributingCompliance").mockImplementation(async () => ({
      hasCLA: true,
      requiresIssueFirst: false,
      hasPRTemplate: false,
      prTemplateContent: null,
    }));

    const spawnMock = spyOn(Bun, "spawn");
    spawnMock.mockImplementation((options: { cmd: string[] }) => {
      const cmd = options.cmd;
      if (cmd[0] === "gh" && cmd[1] === "repo" && cmd[2] === "fork") {
        return createMockProcess({ stdout: "https://github.com/test-user/hello-world\n" });
      }
      if (cmd[0] === "git" && cmd[1] === "clone") {
        return createMockProcess({ exitCode: 0 });
      }
      return createMockProcess({ exitCode: 0 });
    });

    const { submitApprovedFix } = await import("../src/commands/submit");
    const exitCode = await submitApprovedFix();

    expect(exitCode).toBe(1);
  });

  test("archived repo blocks submission and returns 1", async () => {
    writeFileSync(join(tempDir, ".gittributor", "rate-limits.json"), JSON.stringify({ hourly: [], weekly: {} }));
    writeFileSync(join(tempDir, ".gittributor", "history.json"), JSON.stringify({ contributions: [] }));

    const opportunity: ContributionOpportunity = {
      repo: {
        owner: "octocat",
        name: "hello-world",
        fullName: "octocat/hello-world",
        stars: 5000,
        language: "TypeScript",
        description: "A sample repo",
        isArchived: true,
        defaultBranch: "main",
        hasContributing: false,
        topics: [],
        openIssues: 10,
      },
      type: "code",
      filePath: "src/parser.ts",
      description: "Fix parser",
      mergeProbability: { score: 0.9, label: "high" as const, reasons: [] },
      detectedAt: "2026-04-01T00:00:00.000Z",
    };

    await Bun.write(
      join(tempDir, ".gittributor", "state.json"),
      JSON.stringify(createReviewedStateWithOpportunity(opportunity), null, 2),
    );
    await Bun.write(
      join(tempDir, ".gittributor", "fix.json"),
      JSON.stringify({
        changes: [{ file: "src/parser.ts", original: "", modified: "export const parse = (value: string) => value.trim();\n" }],
        explanation: "Normalize whitespace parsing.",
      }),
    );

    const spawnSpy = spyOn(Bun, "spawn");

    const { submitApprovedFix } = await import("../src/commands/submit");
    const exitCode = await submitApprovedFix();

    expect(exitCode).toBe(1);
    expect(spawnSpy).not.toHaveBeenCalled();
  });
});

describe("submit command — PR body templates", () => {
  const originalCwd = process.cwd();
  let tempDir: string;
  let releaseGlobalLock: (() => void) | null = null;

  const createFixPayload = (file: string, original: string, modified: string, explanation: string) => ({
    changes: [{ file, original, modified }],
    explanation,
    confidence: 0.91,
  });

  beforeEach(async () => {
    releaseGlobalLock = await acquireGlobalTestLock();
    tempDir = mkdtempSync(join(tmpdir(), "gittributor-submit-templates-"));
    process.chdir(tempDir);
    mkdirSync(join(tempDir, ".gittributor"), { recursive: true });
    mock.restore();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tempDir, { recursive: true, force: true });
    mock.restore();
    releaseGlobalLock?.();
    releaseGlobalLock = null;
  });

  test("typo type generates PR body with typo pattern", async () => {
    const opportunity: ContributionOpportunity = {
      repo: {
        owner: "octocat",
        name: "hello-world",
        fullName: "octocat/hello-world",
        stars: 1500,
        language: "TypeScript",
        description: "Test repo",
        isArchived: false,
        defaultBranch: "main",
        hasContributing: false,
        topics: [],
        openIssues: 10,
      },
      type: "typo",
      filePath: "README.md",
      description: "Fix typo",
      original: "recieve",
      replacement: "receive",
      mergeProbability: { score: 0.9, label: "high", reasons: [] },
      detectedAt: new Date().toISOString(),
    };

    await Bun.write(
      join(tempDir, ".gittributor", "state.json"),
      JSON.stringify(createReviewedStateWithOpportunity(opportunity), null, 2),
    );
    await Bun.write(
      join(tempDir, ".gittributor", "fix.json"),
      JSON.stringify(createFixPayload("README.md", "recieve", "receive", "Fix typo in README")),
    );

    let capturedPrBody = "";
    const spawnMock = spyOn(Bun, "spawn");
    spawnMock.mockImplementation((options: { cmd: string[] }) => {
      const cmd = options.cmd;
      if (cmd[0] === "gh" && cmd[1] === "repo" && cmd[2] === "fork") {
        return createMockProcess({ stdout: "https://github.com/test-user/hello-world\n" });
      }
      if (cmd[0] === "git" && cmd[1] === "clone") {
        return createMockProcess({ exitCode: 0 });
      }
      if (cmd[0] === "git" && (cmd[2] === "checkout" || cmd[2] === "add" || cmd[2] === "commit" || cmd[2] === "push")) {
        return createMockProcess({ exitCode: 0 });
      }
      if (cmd[0] === "gh" && cmd[1] === "pr" && cmd[2] === "create") {
        const bodyIdx = cmd.indexOf("--body");
        if (bodyIdx !== -1 && cmd[bodyIdx + 1]) {
          capturedPrBody = cmd[bodyIdx + 1];
        }
        return createMockProcess({ stdout: "https://github.com/octocat/hello-world/pull/42\n" });
      }
      return createMockProcess({ exitCode: 0 });
    });

    const { submitApprovedFix } = await import("../src/commands/submit");
    const exitCode = await submitApprovedFix();

    expect(exitCode).toBe(0);
    expect(capturedPrBody).toContain("Fix typo:");
    expect(capturedPrBody).toContain("recieve");
    expect(capturedPrBody).toContain("receive");
    expect(capturedPrBody).toContain("README.md");
  });

  test("docs type generates PR body with section info", async () => {
    const opportunity: ContributionOpportunity = {
      repo: {
        owner: "octocat",
        name: "hello-world",
        fullName: "octocat/hello-world",
        stars: 1500,
        language: "TypeScript",
        description: "Test repo",
        isArchived: false,
        defaultBranch: "main",
        hasContributing: false,
        topics: [],
        openIssues: 10,
      },
      type: "docs",
      filePath: "README.md",
      description: "Add API section",
      section: "API",
      mergeProbability: { score: 0.9, label: "high", reasons: [] },
      detectedAt: new Date().toISOString(),
    };

    await Bun.write(
      join(tempDir, ".gittributor", "state.json"),
      JSON.stringify(createReviewedStateWithOpportunity(opportunity), null, 2),
    );
    await Bun.write(
      join(tempDir, ".gittributor", "fix.json"),
      JSON.stringify(createFixPayload("README.md", "", "## API\nDocumentation here", "Add API section")),
    );

    let capturedPrBody = "";
    const spawnMock = spyOn(Bun, "spawn");
    spawnMock.mockImplementation((options: { cmd: string[] }) => {
      const cmd = options.cmd;
      if (cmd[0] === "gh" && cmd[1] === "repo" && cmd[2] === "fork") {
        return createMockProcess({ stdout: "https://github.com/test-user/hello-world\n" });
      }
      if (cmd[0] === "git" && cmd[1] === "clone") {
        return createMockProcess({ exitCode: 0 });
      }
      if (cmd[0] === "git" && (cmd[2] === "checkout" || cmd[2] === "add" || cmd[2] === "commit" || cmd[2] === "push")) {
        return createMockProcess({ exitCode: 0 });
      }
      if (cmd[0] === "gh" && cmd[1] === "pr" && cmd[2] === "create") {
        const bodyIdx = cmd.indexOf("--body");
        if (bodyIdx !== -1 && cmd[bodyIdx + 1]) {
          capturedPrBody = cmd[bodyIdx + 1];
        }
        return createMockProcess({ stdout: "https://github.com/octocat/hello-world/pull/42\n" });
      }
      return createMockProcess({ exitCode: 0 });
    });

    const { submitApprovedFix } = await import("../src/commands/submit");
    const exitCode = await submitApprovedFix();

    expect(exitCode).toBe(0);
    expect(capturedPrBody).toContain("Add missing");
    expect(capturedPrBody).toContain("API");
    expect(capturedPrBody).toContain("README");
  });

  test("deps type generates PR body with version bump info", async () => {
    const opportunity: ContributionOpportunity = {
      repo: {
        owner: "octocat",
        name: "hello-world",
        fullName: "octocat/hello-world",
        stars: 1500,
        language: "TypeScript",
        description: "Test repo",
        isArchived: false,
        defaultBranch: "main",
        hasContributing: false,
        topics: [],
        openIssues: 10,
      },
      type: "deps",
      filePath: "package.json",
      description: "Bump lodash version",
      packageName: "lodash",
      oldVersion: "4.17.20",
      newVersion: "4.17.21",
      mergeProbability: { score: 0.9, label: "high", reasons: [] },
      detectedAt: new Date().toISOString(),
    };

    await Bun.write(
      join(tempDir, ".gittributor", "state.json"),
      JSON.stringify(createReviewedStateWithOpportunity(opportunity), null, 2),
    );
    await Bun.write(
      join(tempDir, ".gittributor", "fix.json"),
      JSON.stringify(
        createFixPayload('package.json', '"lodash": "4.17.20"', '"lodash": "4.17.21"', "Bump lodash"),
      ),
    );

    let capturedPrBody = "";
    const spawnMock = spyOn(Bun, "spawn");
    spawnMock.mockImplementation((options: { cmd: string[] }) => {
      const cmd = options.cmd;
      if (cmd[0] === "gh" && cmd[1] === "repo" && cmd[2] === "fork") {
        return createMockProcess({ stdout: "https://github.com/test-user/hello-world\n" });
      }
      if (cmd[0] === "git" && cmd[1] === "clone") {
        return createMockProcess({ exitCode: 0 });
      }
      if (cmd[0] === "git" && (cmd[2] === "checkout" || cmd[2] === "add" || cmd[2] === "commit" || cmd[2] === "push")) {
        return createMockProcess({ exitCode: 0 });
      }
      if (cmd[0] === "gh" && cmd[1] === "pr" && cmd[2] === "create") {
        const bodyIdx = cmd.indexOf("--body");
        if (bodyIdx !== -1 && cmd[bodyIdx + 1]) {
          capturedPrBody = cmd[bodyIdx + 1];
        }
        return createMockProcess({ stdout: "https://github.com/octocat/hello-world/pull/42\n" });
      }
      return createMockProcess({ exitCode: 0 });
    });

    const { submitApprovedFix } = await import("../src/commands/submit");
    const exitCode = await submitApprovedFix();

    expect(exitCode).toBe(0);
    expect(capturedPrBody).toContain("lodash");
    expect(capturedPrBody).toContain("4.17.20");
    expect(capturedPrBody).toContain("4.17.21");
  });
});

describe("submit command — dry-run", () => {
  const originalCwd = process.cwd();
  let tempDir: string;
  let releaseGlobalLock: (() => void) | null = null;

  beforeEach(async () => {
    releaseGlobalLock = await acquireGlobalTestLock();
    tempDir = mkdtempSync(join(tmpdir(), "gittributor-submit-dryrun-"));
    process.chdir(tempDir);
    mkdirSync(join(tempDir, ".gittributor"), { recursive: true });
    mock.restore();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tempDir, { recursive: true, force: true });
    mock.restore();
    releaseGlobalLock?.();
    releaseGlobalLock = null;
  });

  test("dry-run prints PR preview without calling gh and returns 0", async () => {
    const opportunity: ContributionOpportunity = {
      repo: {
        owner: "octocat",
        name: "hello-world",
        fullName: "octocat/hello-world",
        stars: 5000,
        language: "TypeScript",
        description: "A sample repo",
        isArchived: false,
        defaultBranch: "main",
        hasContributing: false,
        topics: [],
        openIssues: 10,
      },
      type: "code",
      filePath: "src/parser.ts",
      description: "Fix parser",
      mergeProbability: { score: 0.9, label: "high" as const, reasons: [] },
      detectedAt: "2026-04-01T00:00:00.000Z",
    };

    await Bun.write(
      join(tempDir, ".gittributor", "state.json"),
      JSON.stringify(createReviewedStateWithOpportunity(opportunity), null, 2),
    );
    await Bun.write(
      join(tempDir, ".gittributor", "fix.json"),
      JSON.stringify({
        changes: [{ file: "src/parser.ts", original: "", modified: "export const parse = (value: string) => value.trim();\n" }],
        explanation: "Normalize whitespace parsing.",
      }),
    );

    const spawnMock = spyOn(Bun, "spawn");
    spawnMock.mockImplementation((options: { cmd: string[] }) => {
      const cmd = options.cmd;
      if (cmd[0] === "gh" && cmd[1] === "repo" && cmd[2] === "fork") {
        return createMockProcess({ stdout: "https://github.com/test-user/hello-world\n" });
      }
      if (cmd[0] === "git" && cmd[1] === "clone") {
        return createMockProcess({ exitCode: 0 });
      }
      return createMockProcess({ exitCode: 0 });
    });

    const { submitApprovedFix } = await import("../src/commands/submit");
    const exitCode = await submitApprovedFix({ dryRun: true });

    expect(exitCode).toBe(0);
  });
});

describe("submit command — existing behavior preserved", () => {
  const originalCwd = process.cwd();
  let tempDir: string;
  let releaseGlobalLock: (() => void) | null = null;

  beforeEach(async () => {
    releaseGlobalLock = await acquireGlobalTestLock();
    tempDir = mkdtempSync(join(tmpdir(), "gittributor-submit-legacy-"));
    process.chdir(tempDir);
    mkdirSync(join(tempDir, ".gittributor"), { recursive: true });
    mock.restore();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tempDir, { recursive: true, force: true });
    mock.restore();
    releaseGlobalLock?.();
    releaseGlobalLock = null;
  });

  test("rejected review exits early with error and no git operations", async () => {
    await Bun.write(
      join(tempDir, ".gittributor", "state.json"),
      JSON.stringify(createReviewedState("rejected"), null, 2),
    );
    await Bun.write(
      join(tempDir, ".gittributor", "fix.json"),
      JSON.stringify({
        changes: [
          {
            file: "src/parser.ts",
            original: "",
            modified: "export const parse = (value: string) => value.trim();\n",
          },
        ],
        explanation: "Normalize whitespace parsing for empty input.",
        confidence: 0.91,
      }),
    );

    const spawnSpy = spyOn(Bun, "spawn");
    const { submitApprovedFix } = await import("../src/commands/submit");
    const exitCode = await submitApprovedFix();

    expect(exitCode).toBe(1);
    expect(spawnSpy).not.toHaveBeenCalled();

    const persisted = JSON.parse(
      readFileSync(join(tempDir, ".gittributor", "state.json"), "utf8"),
    ) as { status: string; data?: { submission?: { error?: string } } };

    expect(persisted.status).toBe("submit_failed");
    expect(persisted.data?.submission?.error).toBe("Cannot submit: fix was not approved");
  });
});

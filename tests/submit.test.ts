import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireGlobalTestLock } from "./helpers/global-test-lock";

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
  repositories: [
    {
      id: 1,
      name: "hello-world",
      fullName: "octocat/hello-world",
      url: "https://github.com/octocat/hello-world",
      stars: 5000,
      language: "TypeScript",
      openIssuesCount: 10,
      updatedAt: "2026-04-01T00:00:00.000Z",
      description: "A sample repo",
    },
  ],
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

    await Bun.write(
      join(tempDir, ".gittributor", "state.json"),
      JSON.stringify(createReviewedState("approved"), null, 2),
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

    await Bun.write(
      join(tempDir, ".gittributor", "state.json"),
      JSON.stringify(createReviewedState("approved"), null, 2),
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
    spawnMock.mockImplementation((options: unknown) => {
      const opts = options as { cmd?: string[] };
      const cmd = opts.cmd ?? [];
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

  test.skip("archived repo check requires isArchived field in Repository");
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

  test("generates PR body with standard format", async () => {
    await Bun.write(
      join(tempDir, ".gittributor", "state.json"),
      JSON.stringify(createReviewedState("approved"), null, 2),
    );
    await Bun.write(
      join(tempDir, ".gittributor", "fix.json"),
      JSON.stringify(createFixPayload("README.md", "old text", "new text", "Update text")),
    );

    let stdoutCapture = "";
    const stdoutSpy = spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdoutCapture += String(chunk);
      return true;
    });

    const { submitApprovedFix } = await import("../src/commands/submit");
    const exitCode = await submitApprovedFix({ dryRun: true });

    stdoutSpy.mockRestore();

    expect(exitCode).toBe(0);
    expect(stdoutCapture).toContain("Fixes #17");
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
    await Bun.write(
      join(tempDir, ".gittributor", "state.json"),
      JSON.stringify(createReviewedState("approved"), null, 2),
    );
    await Bun.write(
      join(tempDir, ".gittributor", "fix.json"),
      JSON.stringify({
        changes: [{ file: "src/parser.ts", original: "", modified: "export const parse = (value: string) => value.trim();\n" }],
        explanation: "Normalize whitespace parsing.",
      }),
    );

    let stdoutCapture = "";
    const stdoutSpy = spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdoutCapture += String(chunk);
      return true;
    });

    const { submitApprovedFix } = await import("../src/commands/submit");
    const exitCode = await submitApprovedFix({ dryRun: true });

    stdoutSpy.mockRestore();

    expect(exitCode).toBe(0);
    expect(stdoutCapture).toContain("=== PR Preview");
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

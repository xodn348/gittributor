import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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

const createReviewedState = (decision: "approved" | "rejected") => ({
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
  },
});

describe("submit command", () => {
  const originalCwd = process.cwd();
  let tempDir: string;
  let releaseGlobalLock: (() => void) | null = null;

  beforeEach(async () => {
    releaseGlobalLock = await acquireGlobalTestLock();
    tempDir = mkdtempSync(join(tmpdir(), "gittributor-submit-"));
    process.chdir(tempDir);
    await Bun.write(
      join(tempDir, ".gittributor", "state.json"),
      JSON.stringify(createReviewedState("approved"), null, 2),
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
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tempDir, { recursive: true, force: true });
    mock.restore();
    releaseGlobalLock?.();
    releaseGlobalLock = null;
  });

  test("successful submission runs workflow, transitions state, and stores PR URL", async () => {
    const spawnSpy = spyOn(Bun, "spawn")
      .mockReturnValueOnce(
        createMockProcess({ stdout: "https://github.com/test-user/hello-world\n", exitCode: 0 }),
      )
      .mockReturnValueOnce(createMockProcess({ exitCode: 0 }))
      .mockReturnValueOnce(createMockProcess({ exitCode: 0 }))
      .mockReturnValueOnce(createMockProcess({ exitCode: 0 }))
      .mockReturnValueOnce(createMockProcess({ exitCode: 0 }))
      .mockReturnValueOnce(createMockProcess({ exitCode: 0 }))
      .mockReturnValueOnce(
        createMockProcess({ stdout: "https://github.com/octocat/hello-world/pull/42\n", exitCode: 0 }),
      );

    const { submitApprovedFix } = await import("../src/commands/submit");
    const exitCode = await submitApprovedFix();

    expect(exitCode).toBe(0);
    expect(spawnSpy).toHaveBeenCalledTimes(7);

    const spawnCalls = spawnSpy.mock.calls as unknown as Array<[{ cmd: string[] }] >;
    const commands = spawnCalls.map((call) => call[0].cmd);
    expect(commands[0]).toEqual(["gh", "repo", "fork", "octocat/hello-world", "--clone=false"]);
    expect(commands[1]).toEqual([
      "git",
      "clone",
      "--depth=1",
      "https://github.com/test-user/hello-world",
      ".gittributor/workspace/hello-world",
    ]);
    expect(commands[2]).toEqual([
      "git",
      "-C",
      ".gittributor/workspace/hello-world",
      "checkout",
      "-b",
      "gittributor/fix-17",
    ]);
    expect(commands[5]).toEqual([
      "git",
      "-C",
      ".gittributor/workspace/hello-world",
      "push",
      "origin",
      "gittributor/fix-17",
    ]);
    expect(commands[4]).toEqual([
      "git",
      "-C",
      ".gittributor/workspace/hello-world",
      "commit",
      "-m",
      "fix(#17): Fix flaky parser trim path",
      "-m",
      "This fix was generated with AI assistance (Anthropic Claude) and reviewed by a human.",
    ]);
    expect(commands[6]).toEqual([
      "gh",
      "pr",
      "create",
      "--repo",
      "octocat/hello-world",
      "--head",
      "test-user:gittributor/fix-17",
      "--title",
      "fix(#17): Fix flaky parser trim path",
      "--body",
      [
        "Fixes #17",
        "",
        "This fix was generated with AI assistance (Anthropic Claude) and reviewed by a human.",
        "",
        "## Summary of changes",
        "- `src/parser.ts`",
        "",
        "## Why",
        "Normalize whitespace parsing for empty input.",
      ].join("\n"),
    ]);

    const persisted = JSON.parse(readFileSync(join(tempDir, ".gittributor", "state.json"), "utf8")) as {
      status: string;
      submissions?: Array<{ prUrl?: string; branchName?: string }>;
      data?: { submission?: { prUrl?: string; branchName?: string } };
    };

    expect(persisted.status).toBe("submitted");
    expect(persisted.data?.submission?.prUrl).toBe("https://github.com/octocat/hello-world/pull/42");
    expect(persisted.data?.submission?.branchName).toBe("gittributor/fix-17");
    expect(persisted.submissions).toEqual([
      expect.objectContaining({
        prUrl: "https://github.com/octocat/hello-world/pull/42",
        branchName: "gittributor/fix-17",
      }),
    ]);
    expect(Bun.file(join(tempDir, ".gittributor", "workspace", "hello-world")).exists()).resolves.toBe(
      false,
    );
  });

  test("push failure transitions to submit_failed and skips PR creation", async () => {
    const spawnSpy = spyOn(Bun, "spawn")
      .mockReturnValueOnce(
        createMockProcess({ stdout: "https://github.com/test-user/hello-world\n", exitCode: 0 }),
      )
      .mockReturnValueOnce(createMockProcess({ exitCode: 0 }))
      .mockReturnValueOnce(createMockProcess({ exitCode: 0 }))
      .mockReturnValueOnce(createMockProcess({ exitCode: 0 }))
      .mockReturnValueOnce(createMockProcess({ exitCode: 0 }))
      .mockReturnValueOnce(createMockProcess({ stderr: "push rejected", exitCode: 1 }));

    const { submitApprovedFix } = await import("../src/commands/submit");
    const exitCode = await submitApprovedFix();

    expect(exitCode).toBe(1);
    expect(spawnSpy).toHaveBeenCalledTimes(6);

    const persisted = JSON.parse(readFileSync(join(tempDir, ".gittributor", "state.json"), "utf8")) as {
      status: string;
      data?: { submission?: { error?: string } };
    };

    expect(persisted.status).toBe("submit_failed");
    expect(persisted.data?.submission?.error).toContain("git -C .gittributor/workspace/hello-world push origin gittributor/fix-17");
  });

  test("rejected review exits early with error and no git operations", async () => {
    await Bun.write(
      join(tempDir, ".gittributor", "state.json"),
      JSON.stringify(createReviewedState("rejected"), null, 2),
    );

    const spawnSpy = spyOn(Bun, "spawn");
    const { submitApprovedFix } = await import("../src/commands/submit");
    const exitCode = await submitApprovedFix();

    expect(exitCode).toBe(1);
    expect(spawnSpy).not.toHaveBeenCalled();

    const persisted = JSON.parse(readFileSync(join(tempDir, ".gittributor", "state.json"), "utf8")) as {
      status: string;
      data?: { submission?: { error?: string } };
    };

    expect(persisted.status).toBe("submit_failed");
    expect(persisted.data?.submission?.error).toBe("Cannot submit: fix was not approved");
  });
});

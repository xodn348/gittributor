import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { AnalysisResult, FixResult, Issue } from "../src/types/index";
import {
  AnthropicAPIError,
  analyzeCodeForIssue,
  createPRDescription,
  generateFix,
} from "../src/lib/anthropic";

const CLAUDE_CLI_PATH =
  "/Users/jnnj92/Library/Application Support/Claude/claude-code/2.1.78/claude.app/Contents/MacOS/claude";

const issueFixture: Issue = {
  id: 101,
  number: 77,
  title: "Handle null API response",
  body: "Null response causes crash in parser",
  url: "https://github.com/acme/repo/issues/77",
  repoFullName: "acme/repo",
  labels: ["bug"],
  createdAt: "2026-03-31T12:00:00.000Z",
  assignees: ["alice"],
};

const analysisFixture: AnalysisResult = {
  issueId: 101,
  repoFullName: "acme/repo",
  relevantFiles: ["src/parser.ts", "src/api.ts"],
  suggestedApproach: "Guard against null payload before parsing.",
  confidence: 0.82,
  analyzedAt: "2026-03-31T12:05:00.000Z",
};

const fixFixture: FixResult = {
  issueId: 101,
  repoFullName: "acme/repo",
  patch: "diff --git a/src/parser.ts b/src/parser.ts\n+if (!payload) return null;",
  explanation: "Adds a null guard in parser.",
  testsPass: true,
  confidence: 0.88,
  generatedAt: "2026-03-31T12:10:00.000Z",
};

function toStream(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

function createMockProcess(options: {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}): Bun.Subprocess {
  return {
    stdout: toStream(options.stdout ?? ""),
    stderr: toStream(options.stderr ?? ""),
    exited: Promise.resolve(options.exitCode ?? 0),
  } as unknown as Bun.Subprocess;
}

describe("anthropic client wrapper", () => {
  afterEach(() => {
    mock.restore();
  });

  it("analyzeCodeForIssue invokes Claude CLI and returns AnalysisResult", async () => {
    const spawnMock = spyOn(Bun, "spawn").mockReturnValue(
      createMockProcess({ stdout: JSON.stringify(analysisFixture) }),
    );

    const result = await analyzeCodeForIssue({
      issue: issueFixture,
      codeContext: "src/parser.ts: if (payload.data.id) { ... }",
      apiKey: "test-key",
    });

    expect(result).toMatchObject({
      issueId: analysisFixture.issueId,
      repoFullName: analysisFixture.repoFullName,
      relevantFiles: analysisFixture.relevantFiles,
      suggestedApproach: analysisFixture.suggestedApproach,
      confidence: analysisFixture.confidence,
    });
    expect(Number.isNaN(Date.parse(result.analyzedAt))).toBe(false);
    expect(spawnMock).toHaveBeenCalledTimes(1);

    const spawnArg = spawnMock.mock.calls[0]?.[0] as unknown as {
      cmd: string[];
      stdout: "pipe";
      stderr: "pipe";
    };
    expect(spawnArg.cmd[0]).toBe(CLAUDE_CLI_PATH);
    expect(spawnArg.cmd[1]).toBe("-p");
    expect(spawnArg.cmd[2]).toContain("[SYSTEM]");
    expect(spawnArg.cmd[2]).toContain("[USER]");
    expect(spawnArg.cmd[2]).toContain(issueFixture.title);
    expect(spawnArg.cmd[3]).toBe("--dangerously-skip-permissions");
    expect(spawnArg.stdout).toBe("pipe");
    expect(spawnArg.stderr).toBe("pipe");
  });

  it("generateFix returns FixResult from Claude response", async () => {
    spyOn(Bun, "spawn").mockReturnValue(
      createMockProcess({ stdout: JSON.stringify(fixFixture) }),
    );

    const result = await generateFix({
      issue: issueFixture,
      analysis: analysisFixture,
      fileContents: {
        "src/parser.ts": "export function parse(payload: unknown) { return payload as object; }",
      },
      apiKey: "test-key",
    });

    expect(result).toMatchObject({
      issueId: fixFixture.issueId,
      repoFullName: fixFixture.repoFullName,
      patch: fixFixture.patch,
      explanation: fixFixture.explanation,
      testsPass: fixFixture.testsPass,
      confidence: fixFixture.confidence,
    });
    expect(Number.isNaN(Date.parse(result.generatedAt))).toBe(false);
  });

  it("createPRDescription returns generated markdown including AI disclosure", async () => {
    spyOn(Bun, "spawn").mockReturnValue(
      createMockProcess({
        stdout: "## Summary\n- Added null guard\n\nGenerated with AI assistance",
      }),
    );

    const result = await createPRDescription({
      issue: issueFixture,
      fix: fixFixture,
      apiKey: "test-key",
    });

    expect(result).toContain("Generated with AI assistance");
    expect(result).toContain("## Summary");
  });

  it("throws AnthropicAPIError on non-zero Claude CLI exit", async () => {
    spyOn(Bun, "spawn").mockReturnValue(
      createMockProcess({ stderr: "permission denied", exitCode: 2 }),
    );

    return expect(
      analyzeCodeForIssue({
        issue: issueFixture,
        codeContext: "context",
        apiKey: "test-key",
      }),
    ).rejects.toBeInstanceOf(AnthropicAPIError);
  });

  it("throws AnthropicAPIError on empty Claude CLI output", async () => {
    spyOn(Bun, "spawn").mockReturnValue(createMockProcess({ stdout: "   " }));

    return expect(
      createPRDescription({
        issue: issueFixture,
        fix: fixFixture,
        apiKey: "test-key",
      }),
    ).rejects.toBeInstanceOf(AnthropicAPIError);
  });
});

import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import type { AnalysisResult, Issue, Repository } from "../src/types/index";

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

const repoFixture: Repository = {
  id: 1,
  name: "demo-repo",
  fullName: "acme/demo-repo",
  url: "https://github.com/acme/demo-repo",
  stars: 100,
  language: "TypeScript",
  openIssuesCount: 10,
  updatedAt: "2026-03-31T00:00:00.000Z",
  description: "demo",
};

const issueFixture: Issue = {
  id: 42,
  number: 42,
  title: "Fix parser null handling",
  body: "Investigate src/parser.ts and src/api/client.ts",
  url: "https://github.com/acme/demo-repo/issues/42",
  repoFullName: "acme/demo-repo",
  labels: ["bug"],
  createdAt: "2026-03-31T00:00:00.000Z",
  assignees: [],
};

const analysisFixture: AnalysisResult = {
  issueId: 42,
  repoFullName: "acme/demo-repo",
  relevantFiles: ["src/parser.ts"],
  suggestedApproach: "Add null guards and update parser flow.",
  confidence: 0.9,
  analyzedAt: "2026-03-31T12:00:00.000Z",
};

describe("analyzeCodebase", () => {
  let spawnMock: ReturnType<typeof spyOn<typeof Bun, "spawn">>;
  let warnMock: ReturnType<typeof spyOn>;
  const createdPaths: string[] = [];

  function loadAnalyzerWithAnthropicMock(
    impl: (opts: { issue: Issue; codeContext: string; apiKey: string }) => Promise<AnalysisResult>,
  ): Promise<typeof import("../src/lib/analyzer")> {
    mock.module("../src/lib/anthropic", () => ({
      analyzeCodeForIssue: impl,
    }));

    return import(`../src/lib/analyzer.ts?cacheBust=${Date.now()}`);
  }

  beforeEach(async () => {
    spyOn(Date, "now").mockReturnValue(1711886400000);
    spawnMock = spyOn(Bun, "spawn");

    const loggerModule = await import("../src/lib/logger");
    warnMock = spyOn(loggerModule, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    for (const target of createdPaths) {
      rmSync(target, { recursive: true, force: true });
    }

    rmSync(path.join(process.cwd(), ".gittributor"), { recursive: true, force: true });
    mock.restore();
  });

  it("checks repository size first and skips clone for repositories larger than 100MB", async () => {
    const { analyzeCodebase } = await loadAnalyzerWithAnthropicMock(async () => analysisFixture);

    spawnMock.mockReturnValueOnce(
      createMockProcess({
        stdout: JSON.stringify({ diskUsage: 102401 }),
      }),
    );

    const result = await analyzeCodebase(repoFixture, issueFixture);
    const largeRepoResult = result as AnalysisResult & {
      complexity?: "low" | "medium" | "high";
      rootCause?: string;
      affectedFiles?: string[];
    };

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock).toHaveBeenNthCalledWith(1, {
      cmd: ["gh", "repo", "view", repoFixture.fullName, "--json", "diskUsage"],
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(largeRepoResult.complexity).toBe("high");
    expect(largeRepoResult.confidence).toBe(0);
    expect(largeRepoResult.rootCause).toBe("repo too large to analyze");
    expect(largeRepoResult.affectedFiles).toEqual([]);
    expect(warnMock).toHaveBeenCalled();
  });

  it("shallow clones, analyzes max five files, saves analysis, and cleans temp dir", async () => {
    const { analyzeCodebase } = await loadAnalyzerWithAnthropicMock(async ({ codeContext }) => {
      const fileBlockCount = codeContext.match(/^File: /gm)?.length ?? 0;
      expect(fileBlockCount).toBe(5);

      return analysisFixture;
    });

    spawnMock
      .mockReturnValueOnce(createMockProcess({ stdout: JSON.stringify({ diskUsage: 1000 }) }))
      .mockImplementationOnce((spawnArg: unknown) => {
        const cloneTarget =
          typeof spawnArg === "object" && spawnArg !== null && "cmd" in spawnArg
            ? ((spawnArg as { cmd: string[] }).cmd[4] ?? "")
            : "";
        createdPaths.push(cloneTarget);

        mkdirSync(path.join(cloneTarget, "src", "api"), { recursive: true });
        mkdirSync(path.join(cloneTarget, "src", "utils"), { recursive: true });

        writeFileSync(path.join(cloneTarget, "src", "parser.ts"), "export const parser = true;\n");
        writeFileSync(path.join(cloneTarget, "src", "api", "client.ts"), "export const client = true;\n");
        writeFileSync(path.join(cloneTarget, "src", "utils", "a.ts"), "export const a = 1;\n");
        writeFileSync(path.join(cloneTarget, "src", "utils", "b.ts"), "export const b = 2;\n");
        writeFileSync(path.join(cloneTarget, "src", "utils", "c.ts"), "export const c = 3;\n");
        writeFileSync(path.join(cloneTarget, "src", "utils", "d.ts"), "export const d = 4;\n");

        return createMockProcess({});
      });

    const result = await analyzeCodebase(repoFixture, issueFixture);

    expect(result).toMatchObject({
      issueId: analysisFixture.issueId,
      repoFullName: analysisFixture.repoFullName,
      suggestedApproach: analysisFixture.suggestedApproach,
      confidence: analysisFixture.confidence,
    });
    expect(result.relevantFiles).toHaveLength(5);
    expect(spawnMock).toHaveBeenNthCalledWith(2, {
      cmd: [
        "gh",
        "repo",
        "clone",
        repoFixture.fullName,
        path.join(tmpdir(), `${repoFixture.name}-${Date.now()}`),
        "--",
        "--depth",
        "1",
      ],
      stdout: "pipe",
      stderr: "pipe",
    });

    const analysisPath = path.join(process.cwd(), ".gittributor", "analysis.json");
    expect(existsSync(analysisPath)).toBe(true);
    expect(JSON.parse(readFileSync(analysisPath, "utf8"))).toEqual(result);

    const cloneTarget = path.join(tmpdir(), `${repoFixture.name}-${Date.now()}`);
    expect(existsSync(cloneTarget)).toBe(false);
  });

  it("truncates files to 500 lines with truncation marker", async () => {
    const longFileLines = Array.from({ length: 520 }, (_, index) => `const x${index} = ${index};`).join(
      "\n",
    );

    const { analyzeCodebase } = await loadAnalyzerWithAnthropicMock(async ({ codeContext }) => {
      expect(codeContext).toContain("// [...truncated at 500 lines...]");
      expect(codeContext).not.toContain("const x519 = 519;");
      return analysisFixture;
    });

    spawnMock
      .mockReturnValueOnce(createMockProcess({ stdout: JSON.stringify({ diskUsage: 1000 }) }))
      .mockImplementationOnce((spawnArg: unknown) => {
        const cloneTarget =
          typeof spawnArg === "object" && spawnArg !== null && "cmd" in spawnArg
            ? ((spawnArg as { cmd: string[] }).cmd[4] ?? "")
            : "";
        createdPaths.push(cloneTarget);
        mkdirSync(path.join(cloneTarget, "src"), { recursive: true });
        writeFileSync(path.join(cloneTarget, "src", "parser.ts"), longFileLines);
        return createMockProcess({});
      });

    await analyzeCodebase(repoFixture, issueFixture);
  });

  it("cleans up temp directory when analysis fails", async () => {
    const { analyzeCodebase } = await loadAnalyzerWithAnthropicMock(async () => {
      throw new Error("analysis failed");
    });

    spawnMock
      .mockReturnValueOnce(createMockProcess({ stdout: JSON.stringify({ diskUsage: 1000 }) }))
      .mockImplementationOnce((spawnArg: unknown) => {
        const cloneTarget =
          typeof spawnArg === "object" && spawnArg !== null && "cmd" in spawnArg
            ? ((spawnArg as { cmd: string[] }).cmd[4] ?? "")
            : "";
        createdPaths.push(cloneTarget);
        mkdirSync(path.join(cloneTarget, "src"), { recursive: true });
        writeFileSync(path.join(cloneTarget, "src", "parser.ts"), "export const parser = true;\n");
        return createMockProcess({});
      });

    await expect(analyzeCodebase(repoFixture, issueFixture)).rejects.toThrow("analysis failed");

    const cloneTarget = path.join(tmpdir(), `${repoFixture.name}-${Date.now()}`);
    expect(existsSync(cloneTarget)).toBe(false);
  });
});

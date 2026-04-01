import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "path";
import type { Issue, Repository } from "../src/types/index";
import {
  callAnthropic as _callAnthropicBinding,
  analyzeCodeForIssue as _analyzeCodeForIssueBinding,
  createPRDescription as _createPRDescriptionBinding,
  generateFix as _generateFixBinding,
  AnthropicAPIError as _anthropicApiErrorBinding,
  RateLimitError as _rateLimitErrorBinding,
} from "../src/lib/anthropic";

const _realCallAnthropic = _callAnthropicBinding;
const _realAnalyzeCodeForIssue = _analyzeCodeForIssueBinding;
const _realCreatePRDescription = _createPRDescriptionBinding;
const _realGenerateFix = _generateFixBinding;
const _realAnthropicApiError = _anthropicApiErrorBinding;
const _realRateLimitError = _rateLimitErrorBinding;

type AnalyzerAnthropicResponse = {
  rootCause: string;
  affectedFiles: string[];
  suggestedApproach: string;
  complexity: "low" | "medium" | "high";
  confidence: number;
};

let currentCallAnthropicImpl: (options: {
  apiKey: string;
  system: string;
  prompt: string;
  maxTokens: number;
}) => Promise<string> = _realCallAnthropic;

mock.module("../src/lib/anthropic", () => ({
  callAnthropic: (options: { apiKey: string; system: string; prompt: string; maxTokens: number }) =>
    currentCallAnthropicImpl(options),
  analyzeCodeForIssue: _realAnalyzeCodeForIssue,
  createPRDescription: _realCreatePRDescription,
  generateFix: _realGenerateFix,
  AnthropicAPIError: _realAnthropicApiError,
  RateLimitError: _realRateLimitError,
}));

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

const repositoryFixture: Repository = {
  id: 1,
  name: "demo-repo",
  fullName: "acme/demo-repo",
  url: "https://github.com/acme/demo-repo",
  stars: 100,
  language: "TypeScript",
  openIssuesCount: 10,
  updatedAt: "2026-04-01T00:00:00.000Z",
  description: "Demo repository",
};

const issueFixture: Issue = {
  id: 42,
  number: 42,
  title: "Fix parser null handling",
  body: "Investigate src/parser.ts and src/api/client.ts when payload parsing fails.",
  url: "https://github.com/acme/demo-repo/issues/42",
  repoFullName: "acme/demo-repo",
  labels: ["bug"],
  createdAt: "2026-04-01T00:00:00.000Z",
  assignees: [],
};

const anthropicResponseFixture: AnalyzerAnthropicResponse = {
  rootCause: "The parser assumes payload is always present and the API client forwards null values unchecked.",
  affectedFiles: ["src/parser.ts", "src/api/client.ts"],
  suggestedApproach: "Add a null guard in the parser and normalize nullable payloads in the API client.",
  complexity: "medium",
  confidence: 0.88,
};

let analyzerModuleLoadCounter = 0;

function loadAnalyzerWithAnthropicMock(
  implementation: (options: {
    apiKey: string;
    system: string;
    prompt: string;
    maxTokens: number;
  }) => Promise<string>,
): Promise<typeof import("../src/lib/analyzer")> {
  currentCallAnthropicImpl = implementation;
  analyzerModuleLoadCounter += 1;
  return import(`../src/lib/analyzer.ts?cacheBust=${analyzerModuleLoadCounter}`);
}

describe("analyzeCodebase", () => {
  let spawnMock: ReturnType<typeof spyOn<typeof Bun, "spawn">>;
  let warnMock: ReturnType<typeof spyOn>;
  let previousCwd = "";
  let workspaceTempDir = "";

  beforeEach(async () => {
    previousCwd = process.cwd();
    workspaceTempDir = await mkdtemp(path.join(tmpdir(), "gittributor-analyzer-test-"));
    process.chdir(workspaceTempDir);
    spyOn(Date, "now").mockReturnValue(1711886400000);
    spawnMock = spyOn(Bun, "spawn");

    const loggerModule = await import("../src/lib/logger");
    warnMock = spyOn(loggerModule, "warn").mockImplementation(() => undefined);
  });

  afterEach(async () => {
    process.chdir(previousCwd);
    await rm(workspaceTempDir, { recursive: true, force: true });
    currentCallAnthropicImpl = _realCallAnthropic;
    mock.restore();
    mock.module("../src/lib/anthropic", () => ({
      callAnthropic: (options: { apiKey: string; system: string; prompt: string; maxTokens: number }) =>
        currentCallAnthropicImpl(options),
      analyzeCodeForIssue: _realAnalyzeCodeForIssue,
      createPRDescription: _realCreatePRDescription,
      generateFix: _realGenerateFix,
      AnthropicAPIError: _realAnthropicApiError,
      RateLimitError: _realRateLimitError,
    }));
  });

  it("skips cloning repositories larger than 100MB and returns a warning analysis", async () => {
    const { analyzeCodebase } = await loadAnalyzerWithAnthropicMock(async () => {
      throw new Error("Anthropic should not be called for oversized repositories");
    });

    spawnMock.mockReturnValueOnce(
      createMockProcess({
        stdout: JSON.stringify({ diskUsage: 102401 }),
      }),
    );

    const result = await analyzeCodebase(repositoryFixture, issueFixture);

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock).toHaveBeenNthCalledWith(1, {
      cmd: ["gh", "repo", "view", repositoryFixture.fullName, "--json", "diskUsage"],
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result).toMatchObject({
      issueId: issueFixture.id,
      repoFullName: repositoryFixture.fullName,
      relevantFiles: [],
      confidence: 0,
      rootCause: "repo too large to analyze",
      affectedFiles: [],
      complexity: "high",
    });
    expect(warnMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(readFileSync(path.join(process.cwd(), ".gittributor", "analysis.json"), "utf8"))).toEqual(
      result,
    );
  });

  it("shallow clones, limits analysis to five files, persists analysis, and cleans the temp directory", async () => {
    let capturedSystem = "";
    let capturedPrompt = "";

    const { analyzeCodebase } = await loadAnalyzerWithAnthropicMock(async (options) => {
      capturedSystem = options.system;
      capturedPrompt = options.prompt;
      return JSON.stringify(anthropicResponseFixture);
    });

    spawnMock
      .mockReturnValueOnce(createMockProcess({ stdout: JSON.stringify({ diskUsage: 1000 }) }))
      .mockImplementationOnce((spawnArg: unknown) => {
        const cloneTarget =
          typeof spawnArg === "object" && spawnArg !== null && "cmd" in spawnArg
            ? ((spawnArg as { cmd: string[] }).cmd[4] ?? "")
            : "";

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

    const result = await analyzeCodebase(repositoryFixture, issueFixture);
    const cloneTarget = path.join(tmpdir(), `gittributor-${repositoryFixture.name}-${Date.now()}`);
    const persistedAnalysisPath = path.join(process.cwd(), ".gittributor", "analysis.json");

    expect(spawnMock).toHaveBeenNthCalledWith(2, {
      cmd: [
        "gh",
        "repo",
        "clone",
        repositoryFixture.fullName,
        cloneTarget,
        "--",
        "--depth",
        "1",
      ],
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(capturedSystem).toBe(
      "You are analyzing a codebase to understand a GitHub issue. Identify the root cause and suggest which files need changes.",
    );
    expect(capturedPrompt).toContain(issueFixture.title);
    expect(capturedPrompt).toContain(issueFixture.body as string);
    expect(capturedPrompt).toContain(repositoryFixture.fullName);
    expect(capturedPrompt).toContain("File: src/parser.ts");
    expect(capturedPrompt).toContain("File: src/api/client.ts");
    expect(capturedPrompt.match(/^File: /gm)?.length).toBe(5);
    expect(capturedPrompt).not.toContain("File: src/utils/d.ts");

    expect(result).toMatchObject({
      issueId: issueFixture.id,
      repoFullName: repositoryFixture.fullName,
      suggestedApproach: anthropicResponseFixture.suggestedApproach,
      confidence: anthropicResponseFixture.confidence,
      rootCause: anthropicResponseFixture.rootCause,
      affectedFiles: anthropicResponseFixture.affectedFiles,
      complexity: anthropicResponseFixture.complexity,
    });
    expect(result.relevantFiles).toEqual(anthropicResponseFixture.affectedFiles);
    expect(Number.isNaN(Date.parse(result.analyzedAt))).toBe(false);

    expect(existsSync(persistedAnalysisPath)).toBe(true);
    expect(JSON.parse(readFileSync(persistedAnalysisPath, "utf8"))).toEqual(result);
    expect(existsSync(cloneTarget)).toBe(false);
  });

  it("truncates analyzed files to 500 lines and appends the truncation marker", async () => {
    const longFileLines = Array.from({ length: 520 }, (_, index) => `const value${index} = ${index};`).join(
      "\n",
    );

    const { analyzeCodebase } = await loadAnalyzerWithAnthropicMock(async (options) => {
      expect(options.prompt).toContain("// [...truncated at 500 lines...]");
      expect(options.prompt).not.toContain("const value519 = 519;");
      return JSON.stringify(anthropicResponseFixture);
    });

    spawnMock
      .mockReturnValueOnce(createMockProcess({ stdout: JSON.stringify({ diskUsage: 1000 }) }))
      .mockImplementationOnce((spawnArg: unknown) => {
        const cloneTarget =
          typeof spawnArg === "object" && spawnArg !== null && "cmd" in spawnArg
            ? ((spawnArg as { cmd: string[] }).cmd[4] ?? "")
            : "";

        mkdirSync(path.join(cloneTarget, "src"), { recursive: true });
        writeFileSync(path.join(cloneTarget, "src", "parser.ts"), longFileLines);
        return createMockProcess({});
      });

    await analyzeCodebase(repositoryFixture, issueFixture);
  });

  it("removes the temp clone directory when Anthropic analysis fails", async () => {
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

        mkdirSync(path.join(cloneTarget, "src"), { recursive: true });
        writeFileSync(path.join(cloneTarget, "src", "parser.ts"), "export const parser = true;\n");
        return createMockProcess({});
      });

    expect(analyzeCodebase(repositoryFixture, issueFixture)).rejects.toThrow("analysis failed");

    expect(existsSync(path.join(tmpdir(), `gittributor-${repositoryFixture.name}-${Date.now()}`))).toBe(
      false,
    );
  });
});

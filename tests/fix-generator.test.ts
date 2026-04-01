import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "path";
import type { AnalysisResult, Issue, Repository } from "../src/types/index";
import { FixValidationError as SharedFixValidationError } from "../src/lib/errors";
import {
  callAnthropic as _callAnthropicBinding,
  analyzeCodeForIssue as _analyzeCodeForIssueBinding,
  createPRDescription as _createPRDescriptionBinding,
  generateFix as _anthropicGenerateFixBinding,
  AnthropicAPIError as _anthropicApiErrorBinding,
  RateLimitError as _rateLimitErrorBinding,
} from "../src/lib/anthropic";

const _realCallAnthropic = _callAnthropicBinding;
const _realAnalyzeCodeForIssue = _analyzeCodeForIssueBinding;
const _realCreatePRDescription = _createPRDescriptionBinding;
const _realAnthropicGenerateFix = _anthropicGenerateFixBinding;
const _RealAnthropicAPIError = _anthropicApiErrorBinding;
const _RealRateLimitError = _rateLimitErrorBinding;

let _currentCallAnthropicImpl: (options: {
  apiKey: string;
  system: string;
  prompt: string;
  maxTokens: number;
}) => Promise<string> = _realCallAnthropic;

mock.module("../src/lib/anthropic", () => ({
  callAnthropic: (options: { apiKey: string; system: string; prompt: string; maxTokens: number }) =>
    _currentCallAnthropicImpl(options),
  analyzeCodeForIssue: _realAnalyzeCodeForIssue,
  createPRDescription: _realCreatePRDescription,
  generateFix: _realAnthropicGenerateFix,
  AnthropicAPIError: _RealAnthropicAPIError,
  RateLimitError: _RealRateLimitError,
}));

const issueFixture: Issue = {
  id: 301,
  number: 123,
  title: "Fix parser for null payload",
  body: "Parser crashes when payload is null.",
  url: "https://github.com/acme/demo/issues/123",
  repoFullName: "acme/demo",
  labels: ["bug"],
  createdAt: "2026-04-01T00:00:00.000Z",
  assignees: [],
};

const repoFixture: Repository = {
  id: 55,
  name: "demo",
  fullName: "acme/demo",
  url: "https://github.com/acme/demo",
  stars: 120,
  language: "TypeScript",
  openIssuesCount: 7,
  updatedAt: "2026-04-01T00:00:00.000Z",
  description: "Demo repository",
};

const analysisFixture: AnalysisResult = {
  issueId: 301,
  repoFullName: "acme/demo",
  relevantFiles: ["src/parser.ts", "src/api/client.ts"],
  suggestedApproach: "Add a null guard before parse flow and preserve existing behavior.",
  confidence: 0.84,
  analyzedAt: "2026-04-01T00:05:00.000Z",
};

let fixGeneratorModuleLoadCounter = 0;

function loadFixGeneratorWithAnthropicMock(
  impl: (options: { apiKey: string; system: string; prompt: string; maxTokens: number }) => Promise<string>,
): Promise<typeof import("../src/lib/fix-generator")> {
  _currentCallAnthropicImpl = impl;
  fixGeneratorModuleLoadCounter += 1;
  return import(`../src/lib/fix-generator.ts?cacheBust=${fixGeneratorModuleLoadCounter}`);
}

describe("fix-generator", () => {
  let previousCwd = "";
  let tempDir = "";

  beforeEach(async () => {
    previousCwd = process.cwd();
    tempDir = await mkdtemp(path.join(tmpdir(), "gittributor-fix-generator-"));
    process.chdir(tempDir);
  });

  afterEach(async () => {
    process.chdir(previousCwd);
    await rm(tempDir, { recursive: true, force: true });
    _currentCallAnthropicImpl = _realCallAnthropic;
    mock.restore();
    mock.module("../src/lib/anthropic", () => ({
      callAnthropic: (options: { apiKey: string; system: string; prompt: string; maxTokens: number }) =>
        _currentCallAnthropicImpl(options),
      analyzeCodeForIssue: _realAnalyzeCodeForIssue,
      createPRDescription: _realCreatePRDescription,
      generateFix: _realAnthropicGenerateFix,
      AnthropicAPIError: _RealAnthropicAPIError,
      RateLimitError: _RealRateLimitError,
    }));
  });

  it("generates a minimal fix, includes required prompt context, and saves .gittributor/fix.json", async () => {
    let capturedPrompt = "";
    let capturedSystem = "";

    const { generateFix } = await loadFixGeneratorWithAnthropicMock(async (options) => {
      capturedPrompt = options.prompt;
      capturedSystem = options.system;

      return JSON.stringify({
        changes: [
          {
            file: "src/parser.ts",
            original: "export function parse(payload: unknown) {\n  return payload as object;\n}",
            modified:
              "export function parse(payload: unknown) {\n  // Guard null payload to prevent runtime crash\n  if (payload == null) return null;\n  return payload as object;\n}",
          },
        ],
        explanation: "Adds a null guard in parser while preserving existing parse behavior.",
        confidence: 0.9,
      });
    });

    const result = await generateFix(analysisFixture, issueFixture, repoFixture);

    expect(result).toEqual({
      changes: [
        {
          file: "src/parser.ts",
          original: "export function parse(payload: unknown) {\n  return payload as object;\n}",
          modified:
            "export function parse(payload: unknown) {\n  // Guard null payload to prevent runtime crash\n  if (payload == null) return null;\n  return payload as object;\n}",
        },
      ],
      explanation: "Adds a null guard in parser while preserving existing parse behavior.",
      confidence: 0.9,
    });

    expect(capturedSystem).toContain("only modify files from analysis.relevantFiles");
    expect(capturedSystem).toContain("minimal");
    expect(capturedSystem).toContain("inline comments");
    expect(capturedSystem).toContain("code style");
    expect(capturedPrompt).toContain(issueFixture.title);
    expect(capturedPrompt).toContain(issueFixture.body as string);
    expect(capturedPrompt).toContain(analysisFixture.suggestedApproach);
    expect(capturedPrompt).toContain(repoFixture.fullName);
    expect(capturedPrompt).toContain(repoFixture.description as string);
    expect(capturedPrompt).toContain(String(analysisFixture.confidence));
    expect(capturedPrompt).toContain("src/parser.ts");
    expect(capturedPrompt).toContain("src/api/client.ts");

    const fixPath = path.join(process.cwd(), ".gittributor", "fix.json");
    expect(existsSync(fixPath)).toBe(true);
    expect(JSON.parse(readFileSync(fixPath, "utf8"))).toEqual({
      ...result,
      issue: {
        title: issueFixture.title,
        description: issueFixture.body,
      },
    });
  });

  it("rejects out-of-scope file edits with FixValidationError mentioning out of scope", async () => {
    const { generateFix } = await loadFixGeneratorWithAnthropicMock(async () => {
      return JSON.stringify({
        changes: [
          {
            file: "src/unrelated.ts",
            original: "export const x = 1;",
            modified: "export const x = 2;",
          },
        ],
        explanation: "Touched unrelated file.",
        confidence: 0.3,
      });
    });

    try {
      await generateFix(analysisFixture, issueFixture, repoFixture);
      throw new Error("Expected generateFix to reject for out-of-scope changes");
    } catch (error) {
      expect(error).toBeInstanceOf(SharedFixValidationError);
      expect((error as SharedFixValidationError).code).toBe("FIX_VALIDATION_ERROR");
      expect((error as SharedFixValidationError).message).toContain("out of scope");
    }
  });

  it("fails fast on Anthropic API errors with required message and no retry", async () => {
    let callCount = 0;
    const { generateFix } = await loadFixGeneratorWithAnthropicMock(async () => {
      callCount += 1;
      throw new _RealAnthropicAPIError("server failure", 500);
    });

    try {
      await generateFix(analysisFixture, issueFixture, repoFixture);
      throw new Error("Expected generateFix to reject for API failures");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("Failed to generate fix: API error (500)");
    }

    expect(callCount).toBe(1);
  });

  it("rejects changes with empty file content fields before persisting", async () => {
    const { generateFix } = await loadFixGeneratorWithAnthropicMock(async () => {
      return JSON.stringify({
        changes: [
          {
            file: "src/parser.ts",
            original: "",
            modified: "",
          },
        ],
        explanation: "Incomplete change payload.",
        confidence: 0.25,
      });
    });

    try {
      await generateFix(analysisFixture, issueFixture, repoFixture);
      throw new Error("Expected generateFix to reject invalid empty change fields");
    } catch (error) {
      expect(error).toBeInstanceOf(SharedFixValidationError);
      expect((error as SharedFixValidationError).message).toContain("empty");
    }

    expect(existsSync(path.join(process.cwd(), ".gittributor", "fix.json"))).toBe(false);
  });

  it("persists generated fix JSON payload with changes, explanation, and confidence", async () => {
    const { generateFix } = await loadFixGeneratorWithAnthropicMock(async () => {
      return JSON.stringify({
        changes: [
          {
            file: "src/api/client.ts",
            original: "export const toPayload = (value: unknown) => ({ value });",
            modified:
              "export const toPayload = (value: unknown) => {\n  // Keep null safety explicit for API payloads\n  return { value };\n};",
          },
        ],
        explanation: "Keeps payload transform explicit and comment-documented.",
        confidence: 0.76,
      });
    });

    const result = await generateFix(analysisFixture, issueFixture, repoFixture);
    const persisted = JSON.parse(readFileSync(path.join(process.cwd(), ".gittributor", "fix.json"), "utf8"));

    expect(persisted).toEqual({
      ...result,
      issue: {
        title: issueFixture.title,
        description: issueFixture.body,
      },
    });
    expect(persisted).toHaveProperty("changes");
    expect(persisted).toHaveProperty("explanation");
    expect(persisted).toHaveProperty("confidence");
    expect(persisted).toHaveProperty("issue");
  });

  it("rejects malformed change entries instead of blanking file fields", async () => {
    const { generateFix } = await loadFixGeneratorWithAnthropicMock(async () => {
      return JSON.stringify({
        changes: [
          {
            file: "src/parser.ts",
            original: "export const parser = true;",
          },
        ],
        explanation: "Incomplete change payload.",
        confidence: 0.4,
      });
    });

    try {
      await generateFix(analysisFixture, issueFixture, repoFixture);
      throw new Error("Expected malformed change payload to be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(SharedFixValidationError);
      expect((error as SharedFixValidationError).message).toContain("malformed");
    }
  });
});

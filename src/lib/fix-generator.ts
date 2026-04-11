import { mkdirSync } from "fs";
import { join } from "path";
import type { AnalysisResult, ContributionType, Issue, Repository } from "../types/index";
import { callModel } from "./ai";
import { AnthropicAPIError, OpenAIAPIError } from "./errors";
import { FixValidationError } from "./errors";

export interface FixChange {
  file: string;
  original: string;
  modified: string;
}

export interface FixResult {
  changes: FixChange[];
  explanation: string;
  confidence: number;
}

interface PersistedFixResult extends FixResult {
  issue: {
    title: string;
    description: string;
  };
}

interface ParsedFixPayload {
  changes: unknown;
  explanation: unknown;
  confidence: unknown;
}

const parsePositiveIntegerEnv = (name: string, fallback: number): number => {
  const raw = Bun.env[name]?.trim();
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const MAX_FIX_TOKENS = parsePositiveIntegerEnv("GITTRIBUTOR_FIX_MAX_TOKENS", 1024);
const DEFAULT_CONFIDENCE = 0.5;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function clampConfidence(confidence: unknown): number {
  if (typeof confidence !== "number" || Number.isNaN(confidence)) {
    return DEFAULT_CONFIDENCE;
  }

  if (confidence < 0) {
    return 0;
  }

  if (confidence > 1) {
    return 1;
  }

  return confidence;
}

function extractJson(text: string): string {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return match ? match[1].trim() : text.trim();
}

function parseFixPayload(responseText: string): ParsedFixPayload {
  const parsed = JSON.parse(extractJson(responseText)) as unknown;
  if (!isRecord(parsed)) {
    throw new FixValidationError("Failed to parse fix response: response must be a JSON object.");
  }

  return {
    changes: parsed.changes,
    explanation: parsed.explanation,
    confidence: parsed.confidence,
  };
}

function parseFixChanges(rawChanges: unknown): FixChange[] {
  if (!Array.isArray(rawChanges)) {
    return [];
  }

  return rawChanges.map((change, index) => {
    if (!isRecord(change)) {
      throw new FixValidationError(`Fix change at index ${index} is invalid.`);
    }

    if (
      typeof change.file !== "string" ||
      typeof change.original !== "string" ||
      typeof change.modified !== "string" ||
      change.file.length === 0
    ) {
      throw new FixValidationError(`Fix change at index ${index} is malformed.`);
    }

    return {
      file: change.file,
      original: change.original,
      modified: change.modified,
    };
  });
}

function validateFixScope(changes: FixChange[], relevantFiles: string[]): void {
  for (const change of changes) {
    if (!change.file.trim()) {
      throw new FixValidationError("Fix change file path cannot be empty.");
    }

    if (!change.original.trim() || !change.modified.trim()) {
      throw new FixValidationError(
        `Fix change for '${change.file}' contains empty original or modified content.`,
      );
    }

    if (!relevantFiles.includes(change.file)) {
      throw new FixValidationError(
        `File '${change.file}' is out of scope. Only files in analysis.relevantFiles may be modified.`,
      );
    }
  }

  const changedFileCount = new Set(changes.map((c) => c.file)).size;
  if (changedFileCount > 10) {
    throw new FixValidationError(
      `Fix scope is too broad. Only up to 10 relevant files may be modified, but ${changedFileCount} files were proposed.`,
    );
  }
}

function buildSystemPrompt(): string {
  return [
    "You are a senior software engineer generating safe, minimal code fixes.",
    "only modify files from analysis.relevantFiles.",
    "Keep changes minimal and focused.",
    "Include inline comments for non-obvious modifications.",
    "Follow the repository's existing code style.",
    "Respond as JSON with keys: changes (array of {file, original, modified}), explanation (string), confidence (0..1).",
  ].join(" ");
}

function buildFileContentsSection(analysis: AnalysisResult): string {
  if (!analysis.fileContents || Object.keys(analysis.fileContents).length === 0) {
    return `<analyzer-relevant-files>${analysis.relevantFiles.join(", ") || "(none provided)"}</analyzer-relevant-files>`;
  }

  const fileBlocks = Object.entries(analysis.fileContents)
    .map(([filePath, content]) => `<file path="${filePath}">\n${content}\n</file>`)
    .join("\n\n");

  return `<file-contents>\n${fileBlocks}\n</file-contents>`;
}

const CONTRIBUTION_TYPE_PROMPTS: Record<string, string> = {
  "bug-fix": "This is a bug fix. Focus on identifying the root cause and implementing a minimal, targeted fix. Include inline comments explaining the bug and the fix.",
  performance: "This is a performance optimization. Analyze the code for performance bottlenecks and propose efficient solutions. Consider time complexity, memory usage, and algorithmic improvements.",
  "type-safety": "This is a TypeScript type safety improvement. Focus on adding proper type annotations, fixing type errors, and improving type inference. Ensure type safety without breaking existing functionality.",
  "logic-error": "This is a logic error fix. The code compiles/runs but produces incorrect results. Identify the flawed logic and correct it with clear reasoning.",
  "static-analysis": "This is a static analysis finding. Address linting warnings, code style issues, or potential bugs detected by static analysis tools.",
};

function buildContributionTypeSection(type?: ContributionType): string {
  if (!type || !CONTRIBUTION_TYPE_PROMPTS[type]) {
    return "";
  }
  return `<contribution-type>${CONTRIBUTION_TYPE_PROMPTS[type]}</contribution-type>`;
}

function buildRootCauseSection(rootCause?: string): string {
  if (!rootCause) {
    return "";
  }
  return `<root-cause>${rootCause}</root-cause>`;
}

function buildAffectedFilesSection(affectedFiles?: string[]): string {
  if (!affectedFiles || affectedFiles.length === 0) {
    return "";
  }
  return `<affected-files>${affectedFiles.join(", ")}</affected-files>`;
}

function buildSuggestedFixSection(suggestedFix?: string): string {
  if (!suggestedFix) {
    return "";
  }
  return `<suggested-fix>${suggestedFix}</suggested-fix>`;
}

function buildDescriptionSection(description?: string): string {
  if (!description) {
    return "";
  }
  return `<analysis-description>${description}</analysis-description>`;
}

function buildPrompt(analysis: AnalysisResult, issue: Issue, repo: Repository): string {
  const sections = [
    "Generate a fix proposal for this GitHub issue.",
    `<repository>${repo.fullName}</repository>`,
    `<repository-description>${repo.description ?? "(no description)"}</repository-description>`,
    `<issue-number>${issue.number}</issue-number>`,
    `<issue-title>${issue.title}</issue-title>`,
    `<issue-description>${issue.body ?? "(no body)"}</issue-description>`,
    buildFileContentsSection(analysis),
    buildContributionTypeSection(analysis.type),
    buildRootCauseSection(analysis.rootCause),
    buildAffectedFilesSection(analysis.affectedFiles),
    buildDescriptionSection(analysis.description),
    buildSuggestedFixSection(analysis.suggestedFix),
    `<analyzer-suggested-approach>${analysis.suggestedApproach}</analyzer-suggested-approach>`,
    `<analyzer-confidence>${analysis.confidence}</analyzer-confidence>`,
  ];

  return sections.filter((s) => s.length > 0).join("\n\n");
}

async function persistFixResult(issue: Issue, fixResult: FixResult): Promise<void> {
  const outputDirectory = join(process.cwd(), ".gittributor");
  const persistedResult: PersistedFixResult = {
    ...fixResult,
    issue: {
      title: issue.title,
      description: issue.body ?? "(no body)",
    },
  };

  mkdirSync(outputDirectory, { recursive: true });
  await Bun.write(join(outputDirectory, "fix.json"), JSON.stringify(persistedResult, null, 2));
}

/**
 * Generate a scoped fix proposal for the analyzed issue.
 *
 * @param analysis - Analyzer output containing the allowed file scope and suggested approach.
 * @param issue - GitHub issue metadata used to describe the bug to Anthropic.
 * @param repo - Repository metadata used to anchor the prompt to the target project.
 * @returns A persisted fix payload containing file-level changes, explanation, and confidence.
 * @throws {FixValidationError} When the AI response is not valid JSON or modifies files out of scope.
 * @throws {Error} When Anthropic returns an API failure status.
 *
 * @example
 * const result = await generateFix(analysis, issue, repo);
 * console.log(result.changes[0]?.file);
 */
export async function generateFix(
  analysis: AnalysisResult,
  issue: Issue,
  repo: Repository,
): Promise<FixResult> {
  const system = buildSystemPrompt();
  const prompt = buildPrompt(analysis, issue, repo);

  let responseText: string;
  try {
    responseText = await callModel({
      provider: Bun.env.GITTRIBUTOR_AI_PROVIDER?.trim() === "openai" ? "openai" : "anthropic",
      apiKey: Bun.env.OPENAI_API_KEY?.trim() ?? Bun.env.ANTHROPIC_API_KEY?.trim(),
      oauthToken: Bun.env.OPENAI_OAUTH_TOKEN?.trim() ?? Bun.env.CLAUDE_CODE_OAUTH_TOKEN?.trim(),
      model: Bun.env.OPENAI_MODEL?.trim(),
      system,
      prompt,
      maxTokens: MAX_FIX_TOKENS,
    });
  } catch (error) {
    if (error instanceof AnthropicAPIError || error instanceof OpenAIAPIError) {
      throw new Error(`Failed to generate fix: API error (${error.statusCode ?? "unknown"})`);
    }

    throw error;
  }

  let parsedPayload: ParsedFixPayload;
  try {
    parsedPayload = parseFixPayload(responseText);
  } catch (error) {
    if (error instanceof FixValidationError) {
      throw error;
    }

    throw new FixValidationError("Failed to parse fix response: response is not valid JSON.");
  }

  const changes = parseFixChanges(parsedPayload.changes);
  validateFixScope(changes, analysis.relevantFiles);

  const fixResult: FixResult = {
    changes,
    explanation:
      typeof parsedPayload.explanation === "string"
        ? parsedPayload.explanation
        : "Generated a scoped fix proposal.",
    confidence: clampConfidence(parsedPayload.confidence),
  };

  await persistFixResult(issue, fixResult);
  return fixResult;
}

export { FixValidationError };

import { mkdirSync } from "fs";
import { join } from "path";
import type { AnalysisResult, Issue, Repository } from "../types/index";
import { AnthropicAPIError, callAnthropic } from "./anthropic";
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

const MAX_FIX_TOKENS = 2048;
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

function parseFixPayload(responseText: string): ParsedFixPayload {
  const parsed = JSON.parse(responseText) as unknown;
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

function buildFileContentsSection(fileContents: Record<string, string> | undefined): string {
  if (!fileContents || Object.keys(fileContents).length === 0) {
    return "";
  }

  const blocks = Object.entries(fileContents)
    .map(([filePath, content]) => `<file path="${filePath}">\n${content}\n</file>`)
    .join("\n\n");

  return `\n\n<relevant-file-contents>\n${blocks}\n</relevant-file-contents>`;
}

function buildPrompt(analysis: AnalysisResult, issue: Issue, repo: Repository): string {
  const base = [
    "Generate a fix proposal for this GitHub issue.",
    `<repository>${repo.fullName}</repository>`,
    `<repository-description>${repo.description ?? "(no description)"}</repository-description>`,
    `<issue-number>${issue.number}</issue-number>`,
    `<issue-title>${issue.title}</issue-title>`,
    `<issue-description>${issue.body ?? "(no body)"}</issue-description>`,
    `<analyzer-relevant-files>${analysis.relevantFiles.join(", ") || "(none provided)"}</analyzer-relevant-files>`,
    `<analyzer-suggested-approach>${analysis.suggestedApproach}</analyzer-suggested-approach>`,
    `<analyzer-confidence>${analysis.confidence}</analyzer-confidence>`,
  ].join("\n\n");

  return base + buildFileContentsSection(analysis.fileContents);
}

async function persistFixResult(issue: Issue, result: FixResult): Promise<void> {
  const outputDirectory = join(process.cwd(), ".gittributor");
  const persistedResult: PersistedFixResult = {
    ...result,
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
  const apiKey = Bun.env.ANTHROPIC_API_KEY ?? "";
  const system = buildSystemPrompt();
  const prompt = buildPrompt(analysis, issue, repo);

  let responseText: string;
  try {
    responseText = await callAnthropic({
      apiKey,
      system,
      prompt,
      maxTokens: MAX_FIX_TOKENS,
    });
  } catch (error) {
    if (error instanceof AnthropicAPIError) {
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

  const result: FixResult = {
    changes,
    explanation:
      typeof parsedPayload.explanation === "string"
        ? parsedPayload.explanation
        : "Generated a scoped fix proposal.",
    confidence: clampConfidence(parsedPayload.confidence),
  };

  await persistFixResult(issue, result);
  return result;
}

export { FixValidationError };

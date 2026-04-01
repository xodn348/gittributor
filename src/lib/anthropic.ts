import type { AnalysisResult, FixResult, Issue } from "../types/index";
import { AnthropicAPIError, RateLimitError } from "./errors";

export { AnthropicAPIError, RateLimitError };

const ANTHROPIC_MESSAGES_ENDPOINT = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MODEL = "claude-3-5-haiku-20241022";

interface AnthropicMessageRequest {
  model: string;
  max_tokens: number;
  system?: string;
  messages: Array<{ role: "user"; content: string }>;
}

interface AnthropicTextBlock {
  type: "text";
  text: string;
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
}

interface AnthropicMessageResponse {
  content: AnthropicContentBlock[];
}

function isAnthropicMessageResponse(value: unknown): value is AnthropicMessageResponse {
  if (!isRecord(value) || !Array.isArray(value.content)) {
    return false;
  }

  return value.content.every((block) => {
    return isRecord(block) && typeof block.type === "string";
  });
}

function clampConfidence(confidence: unknown): number {
  if (typeof confidence !== "number" || Number.isNaN(confidence)) {
    return 0.5;
  }

  if (confidence < 0) {
    return 0;
  }

  if (confidence > 1) {
    return 1;
  }

  return confidence;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function extractMessageText(response: AnthropicMessageResponse): string {
  const text = response.content
    .filter((block): block is AnthropicTextBlock => {
      return block.type === "text" && typeof block.text === "string";
    })
    .map((block) => block.text)
    .join("")
    .trim();

  if (!text) {
    throw new AnthropicAPIError("Anthropic response did not contain text content.");
  }

  return text;
}

async function parseErrorMessage(response: Response): Promise<string> {
  const rawBody = await response.text();

  if (!rawBody) {
    return `Anthropic API responded with status ${response.status}.`;
  }

  try {
    const parsed = JSON.parse(rawBody) as unknown;

    if (!isRecord(parsed) || !isRecord(parsed.error)) {
      return rawBody;
    }

    const message = parsed.error.message;
    if (typeof message === "string" && message.length > 0) {
      return message;
    }

    return rawBody;
  } catch {
    return rawBody;
  }
}

async function callAnthropic(options: {
  apiKey: string;
  system: string;
  prompt: string;
  maxTokens: number;
}): Promise<string> {
  const payload: AnthropicMessageRequest = {
    model: MODEL,
    max_tokens: options.maxTokens,
    system: options.system,
    messages: [{ role: "user", content: options.prompt }],
  };

  const response = await fetch(ANTHROPIC_MESSAGES_ENDPOINT, {
    method: "POST",
    headers: {
      "x-api-key": options.apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (response.status !== 200) {
    const message = await parseErrorMessage(response);
    if (response.status === 429) {
      throw new RateLimitError(message);
    }

    throw new AnthropicAPIError(message, response.status);
  }

  const data = (await response.json()) as unknown;
  if (!isAnthropicMessageResponse(data)) {
    throw new AnthropicAPIError("Anthropic response shape is invalid.");
  }

  return extractMessageText(data);
}

function parseJsonObject(text: string, field: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!isRecord(parsed)) {
      throw new AnthropicAPIError(`Anthropic ${field} response must be a JSON object.`);
    }

    return parsed;
  } catch (error) {
    if (error instanceof AnthropicAPIError) {
      throw error;
    }

    throw new AnthropicAPIError(`Anthropic ${field} response is not valid JSON.`);
  }
}

export async function analyzeCodeForIssue(opts: {
  issue: Issue;
  codeContext: string;
  apiKey: string;
}): Promise<AnalysisResult> {
  const prompt = [
    "Analyze this GitHub issue against the provided code context.",
    `Issue #${opts.issue.number}: ${opts.issue.title}`,
    `Issue Body: ${opts.issue.body ?? "(no body)"}`,
    `Repository: ${opts.issue.repoFullName}`,
    "Code Context:",
    opts.codeContext,
    'Respond as JSON with keys: relevantFiles (string[]), suggestedApproach (string), confidence (0..1).',
  ].join("\n\n");

  const text = await callAnthropic({
    apiKey: opts.apiKey,
    system: "You are a senior code analyst for automated OSS contributions.",
    prompt,
    maxTokens: 1024,
  });

  const parsed = parseJsonObject(text, "analysis");
  const relevantFiles = Array.isArray(parsed.relevantFiles)
    ? parsed.relevantFiles.filter((file): file is string => typeof file === "string")
    : [];

  return {
    issueId: opts.issue.id,
    repoFullName: opts.issue.repoFullName,
    relevantFiles,
    suggestedApproach:
      typeof parsed.suggestedApproach === "string"
        ? parsed.suggestedApproach
        : "Review issue context and update relevant files.",
    confidence: clampConfidence(parsed.confidence),
    analyzedAt: new Date().toISOString(),
  };
}

export async function generateFix(opts: {
  issue: Issue;
  analysis: AnalysisResult;
  fileContents: Record<string, string>;
  apiKey: string;
}): Promise<FixResult> {
  const prompt = [
    "Generate a unified diff patch to fix the issue.",
    `Issue #${opts.issue.number}: ${opts.issue.title}`,
    `Issue Body: ${opts.issue.body ?? "(no body)"}`,
    `Repository: ${opts.issue.repoFullName}`,
    `Analysis Suggested Approach: ${opts.analysis.suggestedApproach}`,
    `Analysis Relevant Files: ${opts.analysis.relevantFiles.join(", ") || "(none provided)"}`,
    "File Contents:",
    JSON.stringify(opts.fileContents, null, 2),
    "Respond as JSON with keys: patch (string, unified diff), explanation (string), testsPass (boolean), confidence (0..1).",
  ].join("\n\n");

  const text = await callAnthropic({
    apiKey: opts.apiKey,
    system: "You are a senior software engineer generating safe, minimal patches.",
    prompt,
    maxTokens: 2048,
  });

  const parsed = parseJsonObject(text, "fix");

  return {
    issueId: opts.issue.id,
    repoFullName: opts.issue.repoFullName,
    patch: typeof parsed.patch === "string" ? parsed.patch : "",
    explanation:
      typeof parsed.explanation === "string"
        ? parsed.explanation
        : "Applied issue-oriented patch changes.",
    testsPass: typeof parsed.testsPass === "boolean" ? parsed.testsPass : false,
    confidence: clampConfidence(parsed.confidence),
    generatedAt: new Date().toISOString(),
  };
}

export async function createPRDescription(opts: {
  issue: Issue;
  fix: FixResult;
  apiKey: string;
}): Promise<string> {
  const prompt = [
    "Write a concise GitHub pull request description in markdown.",
    `Issue #${opts.issue.number}: ${opts.issue.title}`,
    `Issue Body: ${opts.issue.body ?? "(no body)"}`,
    `Patch:\n${opts.fix.patch}`,
    `Fix Explanation: ${opts.fix.explanation}`,
    'Include the exact sentence "Generated with AI assistance" somewhere in the output.',
  ].join("\n\n");

  const text = await callAnthropic({
    apiKey: opts.apiKey,
    system: "You are a technical writer producing clear pull request descriptions.",
    prompt,
    maxTokens: 768,
  });

  if (text.includes("Generated with AI assistance")) {
    return text;
  }

  return `${text}\n\nGenerated with AI assistance`;
}

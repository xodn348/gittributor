import type { AnalysisResult, FixResult, Issue } from "../types/index";
import { AnthropicAPIError, RateLimitError } from "./errors";

export { AnthropicAPIError, RateLimitError };

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODEL = "claude-opus-4-5";
const ANTHROPIC_API_VERSION = "2023-06-01";

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

export async function callAnthropic(options: {
  apiKey?: string;
  oauthToken?: string;
  system: string;
  prompt: string;
  maxTokens: number;
}): Promise<string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "anthropic-version": ANTHROPIC_API_VERSION,
  };

  if (options.oauthToken) {
    // Claude.ai session key (OAuth token for Max subscribers)
    headers["authorization"] = `Bearer ${options.oauthToken}`;
  } else if (options.apiKey) {
    headers["x-api-key"] = options.apiKey;
  } else {
    throw new AnthropicAPIError("No API key or OAuth token provided.");
  }

  const body = JSON.stringify({
    model: ANTHROPIC_MODEL,
    max_tokens: options.maxTokens,
    system: options.system,
    messages: [{ role: "user", content: options.prompt }],
  });

  let response: Response;
  try {
    response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers,
      body,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown network failure";
    throw new AnthropicAPIError(`Anthropic API request failed: ${detail}`);
  }

  if (response.status === 429) {
    throw new RateLimitError("Anthropic API rate limit exceeded.");
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "(no body)");
    throw new AnthropicAPIError(`Anthropic API error ${response.status}: ${detail}`, response.status);
  }

  const json = await response.json() as unknown;
  if (!isRecord(json) || !Array.isArray(json.content) || json.content.length === 0) {
    throw new AnthropicAPIError("Anthropic API returned unexpected response shape.");
  }

  const first = json.content[0];
  if (!isRecord(first) || typeof first.text !== "string") {
    throw new AnthropicAPIError("Anthropic API response missing text content.");
  }

  return first.text.trim();
}

function extractJson(text: string): string {
  // Strip markdown code fences: ```json ... ``` or ``` ... ```
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }

  // Find first { ... } block in the text
  const braceStart = text.indexOf("{");
  const braceEnd = text.lastIndexOf("}");
  if (braceStart !== -1 && braceEnd > braceStart) {
    return text.slice(braceStart, braceEnd + 1);
  }

  return text;
}

function parseJsonObject(text: string, field: string): Record<string, unknown> {
  const candidate = extractJson(text);
  try {
    const parsed = JSON.parse(candidate) as unknown;
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
  apiKey?: string;
  oauthToken?: string;
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
    oauthToken: opts.oauthToken,
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
  apiKey?: string;
  oauthToken?: string;
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
    oauthToken: opts.oauthToken,
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
  apiKey?: string;
  oauthToken?: string;
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
    oauthToken: opts.oauthToken,
    system: "You are a technical writer producing clear pull request descriptions.",
    prompt,
    maxTokens: 768,
  });

  if (text.includes("Generated with AI assistance")) {
    return text;
  }

  return `${text}\n\nGenerated with AI assistance`;
}

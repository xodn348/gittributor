import type { AnalysisResult, FixResult, Issue } from "../types/index";
import { AnthropicAPIError, RateLimitError } from "./errors";

export { AnthropicAPIError, RateLimitError };

const CLAUDE_CLI_PATH =
  "/Users/jnnj92/Library/Application Support/Claude/claude-code/2.1.78/claude.app/Contents/MacOS/claude";

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

function buildCliPrompt(system: string, prompt: string): string {
  return `[SYSTEM]\n${system}\n\n[USER]\n${prompt}`;
}

async function readSubprocessPipe(pipe: Bun.Subprocess["stdout"] | Bun.Subprocess["stderr"]): Promise<string> {
  if (!pipe || typeof pipe === "number") {
    return "";
  }

  return new Response(pipe).text();
}

export async function callAnthropic(options: {
  apiKey?: string;
  oauthToken?: string;
  system: string;
  prompt: string;
  maxTokens: number;
}): Promise<string> {
  void options.apiKey;
  void options.oauthToken;
  void options.maxTokens;

  const fullPrompt = buildCliPrompt(options.system, options.prompt);
  let proc: Bun.Subprocess;
  try {
    proc = Bun.spawn({
      cmd: [
        CLAUDE_CLI_PATH,
        "-p",
        fullPrompt,
        "--dangerously-skip-permissions",
      ],
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown spawn failure";
    throw new AnthropicAPIError(`Failed to start Claude CLI: ${detail}`);
  }

  let stdout = "";
  let stderr = "";
  let exitCode = 0;
  try {
    const [nextStdout, nextStderr, nextExitCode] = await Promise.all([
      readSubprocessPipe(proc.stdout),
      readSubprocessPipe(proc.stderr),
      proc.exited,
    ]);
    stdout = nextStdout;
    stderr = nextStderr;
    exitCode = nextExitCode;
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown subprocess failure";
    throw new AnthropicAPIError(`Claude CLI subprocess failed: ${detail}`);
  }

  if (exitCode !== 0) {
    const detail = stderr.trim();
    const message = detail
      ? `Claude CLI exited with status ${exitCode}: ${detail}`
      : `Claude CLI exited with status ${exitCode}.`;
    throw new AnthropicAPIError(message, exitCode);
  }

  const text = stdout.trim();
  if (text.length === 0) {
    throw new AnthropicAPIError("Claude CLI returned empty output.");
  }

  return text;
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

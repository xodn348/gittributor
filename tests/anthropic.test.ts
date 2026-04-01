import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { AnalysisResult, FixResult, Issue } from "../src/types/index";
import {
  AnthropicAPIError,
  RateLimitError,
  analyzeCodeForIssue,
  createPRDescription,
  generateFix,
} from "../src/lib/anthropic";

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

function anthropicResponse(text: string): Response {
  return new Response(
    JSON.stringify({
      id: "msg_123",
      type: "message",
      role: "assistant",
      content: [{ type: "text", text }],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("anthropic client wrapper", () => {
  afterEach(() => {
    mock.restore();
  });

  it("analyzeCodeForIssue sends raw fetch request and returns AnalysisResult", async () => {
    const fetchMock = spyOn(globalThis, "fetch").mockResolvedValue(
      anthropicResponse(JSON.stringify(analysisFixture)),
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
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      "x-api-key": "test-key",
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    });

    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("claude-3-5-haiku-20241022");
    expect(body.messages[0].role).toBe("user");
  });

  it("generateFix returns FixResult from Claude response", async () => {
    spyOn(globalThis, "fetch").mockResolvedValue(
      anthropicResponse(JSON.stringify(fixFixture)),
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
    spyOn(globalThis, "fetch").mockResolvedValue(
      anthropicResponse("## Summary\n- Added null guard\n\nGenerated with AI assistance"),
    );

    const result = await createPRDescription({
      issue: issueFixture,
      fix: fixFixture,
      apiKey: "test-key",
    });

    expect(result).toContain("Generated with AI assistance");
    expect(result).toContain("## Summary");
  });

  it("throws RateLimitError on 429 response", async () => {
    spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("rate limit", { status: 429 }),
    );

    await expect(
      analyzeCodeForIssue({
        issue: issueFixture,
        codeContext: "context",
        apiKey: "test-key",
      }),
    ).rejects.toBeInstanceOf(RateLimitError);
  });

  it("throws AnthropicAPIError on non-200 response", async () => {
    spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("server failure", { status: 500 }),
    );

    await expect(
      createPRDescription({
        issue: issueFixture,
        fix: fixFixture,
        apiKey: "test-key",
      }),
    ).rejects.toBeInstanceOf(AnthropicAPIError);
  });
});

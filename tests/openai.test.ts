import { afterEach, describe, expect, mock, test } from "bun:test";
import { callOpenAI } from "../src/lib/openai";
import { OpenAIAPIError } from "../src/lib/errors";

describe("openai transport", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    mock.restore();
    globalThis.fetch = originalFetch;
    delete Bun.env.OPENAI_API_KEY;
    delete Bun.env.OPENAI_OAUTH_TOKEN;
    delete Bun.env.OPENAI_MODEL;
  });

  test("uses oauth token when provided and returns output_text", async () => {
    const fetchMock = mock(async () =>
      new Response(JSON.stringify({ output_text: "ok" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await callOpenAI({
      oauthToken: "sess-token",
      system: "system",
      prompt: "prompt",
      maxTokens: 200,
      model: "gpt-5-mini",
    });

    expect(result).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("uses API key from env when oauth token is absent", async () => {
    Bun.env.OPENAI_API_KEY = "api-key";
    const fetchMock = mock(async () =>
      new Response(JSON.stringify({ output: [{ content: [{ text: "from-output-array" }] }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await callOpenAI({
      system: "system",
      prompt: "prompt",
      maxTokens: 300,
    });

    expect(result).toBe("from-output-array");
  });

  test("throws OpenAIAPIError when credentials are missing", async () => {
    await expect(
      callOpenAI({
        system: "system",
        prompt: "prompt",
        maxTokens: 200,
      }),
    ).rejects.toBeInstanceOf(OpenAIAPIError);
  });
});

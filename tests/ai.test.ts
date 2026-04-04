import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { callModel } from "../src/lib/ai";

function toStream(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

function createMockProcess(options: { stdout?: string; stderr?: string; exitCode?: number }): Bun.Subprocess {
  return {
    stdout: toStream(options.stdout ?? ""),
    stderr: toStream(options.stderr ?? ""),
    exited: Promise.resolve(options.exitCode ?? 0),
  } as unknown as Bun.Subprocess;
}

describe("callModel provider routing", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    mock.restore();
    globalThis.fetch = originalFetch;
    delete Bun.env.GITTRIBUTOR_AI_PROVIDER;
    delete Bun.env.OPENAI_API_KEY;
    delete Bun.env.OPENAI_OAUTH_TOKEN;
    delete Bun.env.OPENAI_MODEL;
  });

  test("defaults to anthropic provider when env is not set", async () => {
    const spawnMock = spyOn(Bun, "spawn").mockImplementation(() => createMockProcess({ stdout: "anthropic-route" }));

    const response = await callModel({
      system: "system",
      prompt: "prompt",
      maxTokens: 128,
    });

    expect(response).toBe("anthropic-route");
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  test("routes to openai when provider env is set and uses oauth token", async () => {
    Bun.env.GITTRIBUTOR_AI_PROVIDER = "openai";
    Bun.env.OPENAI_OAUTH_TOKEN = "sess-openai-token";
    Bun.env.OPENAI_MODEL = "gpt-5-mini";

    const fetchMock = mock(async () =>
      new Response(JSON.stringify({ output_text: "openai-route" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const response = await callModel({
      system: "system",
      prompt: "prompt",
      maxTokens: 256,
    });

    expect(response).toBe("openai-route");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("explicit provider overrides env provider", async () => {
    Bun.env.GITTRIBUTOR_AI_PROVIDER = "openai";
    const spawnMock = spyOn(Bun, "spawn").mockImplementation(() => createMockProcess({ stdout: "anthropic-route" }));

    const response = await callModel({
      provider: "anthropic",
      system: "system",
      prompt: "prompt",
      maxTokens: 64,
    });

    expect(response).toBe("anthropic-route");
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });
});

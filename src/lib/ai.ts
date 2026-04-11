import { callAnthropic } from "./anthropic";
import { callOpenAI } from "./openai";

export type AIProvider = "anthropic" | "openai";

export interface ModelCallOptions {
  provider?: AIProvider;
  apiKey?: string;
  oauthToken?: string;
  model?: string;
  system: string;
  prompt: string;
  maxTokens: number;
}

const resolveProvider = (provider?: AIProvider): AIProvider => {
  if (provider) {
    return provider;
  }

  return Bun.env.GITTRIBUTOR_AI_PROVIDER?.trim() === "openai" ? "openai" : "anthropic";
};

const TIMEOUT_MS = 30_000;

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`LLM call timed out after ${ms / 1000}s`)), ms),
    ),
  ]);
};

export async function callModel(options: ModelCallOptions): Promise<string> {
  const provider = resolveProvider(options.provider);

  const aiCall =
    provider === "openai"
      ? callOpenAI({
          apiKey: options.apiKey,
          oauthToken: options.oauthToken,
          model: options.model,
          system: options.system,
          prompt: options.prompt,
          maxTokens: options.maxTokens,
        })
      : callAnthropic({
          apiKey: options.apiKey,
          oauthToken: options.oauthToken,
          system: options.system,
          prompt: options.prompt,
          maxTokens: options.maxTokens,
        });

  return withTimeout(aiCall, TIMEOUT_MS);
}

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

export async function callModel(options: ModelCallOptions): Promise<string> {
  const provider = resolveProvider(options.provider);

  if (provider === "openai") {
    return callOpenAI({
      apiKey: options.apiKey,
      oauthToken: options.oauthToken,
      model: options.model,
      system: options.system,
      prompt: options.prompt,
      maxTokens: options.maxTokens,
    });
  }

  return callAnthropic({
    apiKey: options.apiKey,
    oauthToken: options.oauthToken,
    system: options.system,
    prompt: options.prompt,
    maxTokens: options.maxTokens,
  });
}

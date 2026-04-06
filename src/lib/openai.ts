import { OpenAIAPIError } from "./errors";

interface OpenAIChatChoice {
  message?: {
    content?: string;
  };
}

interface OpenAIChatResult {
  choices?: OpenAIChatChoice[];
  error?: {
    message?: string;
  };
}

export interface OpenAIRequestOptions {
  apiKey?: string;
  oauthToken?: string;
  system: string;
  prompt: string;
  maxTokens: number;
  model?: string;
}

const OPENAI_CHAT_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";

const pickBearerToken = (options: OpenAIRequestOptions): string | undefined => {
  return options.oauthToken ?? options.apiKey ?? Bun.env.OPENAI_OAUTH_TOKEN?.trim() ?? Bun.env.OPENAI_API_KEY?.trim();
};

const pickModel = (options: OpenAIRequestOptions): string => {
  return options.model ?? Bun.env.OPENAI_MODEL?.trim() ?? DEFAULT_OPENAI_MODEL;
};

const parseOutputText = (payload: OpenAIChatResult): string => {
  return (payload.choices?.[0]?.message?.content ?? "").trim();
};

export async function callOpenAI(options: OpenAIRequestOptions): Promise<string> {
  const bearerToken = pickBearerToken(options);
  if (!bearerToken) {
    throw new OpenAIAPIError("Missing OpenAI credentials. Set OPENAI_API_KEY or OPENAI_OAUTH_TOKEN.");
  }

  const model = pickModel(options);
  const response = await fetch(OPENAI_CHAT_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bearerToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: options.maxTokens,
      messages: [
        {
          role: "system",
          content: options.system,
        },
        {
          role: "user",
          content: options.prompt,
        },
      ],
    }),
  });

  let payload: OpenAIChatResult;
  try {
    payload = (await response.json()) as OpenAIChatResult;
  } catch {
    throw new OpenAIAPIError("OpenAI response was not valid JSON.", response.status);
  }

  if (!response.ok) {
    const detail = payload.error?.message?.trim();
    throw new OpenAIAPIError(
      detail ? `OpenAI request failed (${response.status}): ${detail}` : `OpenAI request failed (${response.status}).`,
      response.status,
    );
  }

  const text = parseOutputText(payload);
  if (text.length === 0) {
    throw new OpenAIAPIError("OpenAI returned empty output.", response.status);
  }

  return text;
}

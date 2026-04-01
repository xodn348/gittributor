import { describe, expect, it } from "bun:test";
import {
  AnthropicAPIError,
  ConfigError,
  GitHubAPIError,
  GittributorError,
  RateLimitError,
  StateError,
} from "../src/lib/errors";

describe("errors", () => {
  it("GittributorError sets base fields", () => {
    const error = new GittributorError("Base failure", "BASE_ERROR");

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(GittributorError);
    expect(error.name).toBe("GittributorError");
    expect(error.message).toBe("Base failure");
    expect(error.code).toBe("BASE_ERROR");
  });

  it("ConfigError has CONFIG_ERROR code", () => {
    const error = new ConfigError("Missing token");

    expect(error).toBeInstanceOf(GittributorError);
    expect(error.name).toBe("ConfigError");
    expect(error.code).toBe("CONFIG_ERROR");
    expect(error.message).toBe("Missing token");
  });

  it("GitHubAPIError includes optional exitCode", () => {
    const error = new GitHubAPIError("gh failed", 2);

    expect(error).toBeInstanceOf(GittributorError);
    expect(error.name).toBe("GitHubAPIError");
    expect(error.code).toBe("GITHUB_API_ERROR");
    expect(error.message).toBe("gh failed");
    expect(error.exitCode).toBe(2);
  });

  it("AnthropicAPIError includes optional statusCode", () => {
    const error = new AnthropicAPIError("api failed", 429);

    expect(error).toBeInstanceOf(GittributorError);
    expect(error.name).toBe("AnthropicAPIError");
    expect(error.code).toBe("ANTHROPIC_API_ERROR");
    expect(error.message).toBe("api failed");
    expect(error.statusCode).toBe(429);
  });

  it("RateLimitError includes optional retryAfter", () => {
    const error = new RateLimitError("rate limited", 60);

    expect(error).toBeInstanceOf(GittributorError);
    expect(error.name).toBe("RateLimitError");
    expect(error.code).toBe("RATE_LIMIT_ERROR");
    expect(error.message).toBe("rate limited");
    expect(error.retryAfter).toBe(60);
  });

  it("StateError has STATE_ERROR code", () => {
    const error = new StateError("bad state");

    expect(error).toBeInstanceOf(GittributorError);
    expect(error.name).toBe("StateError");
    expect(error.code).toBe("STATE_ERROR");
    expect(error.message).toBe("bad state");
  });
});

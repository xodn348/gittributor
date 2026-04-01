export class GittributorError extends Error {
  code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "GittributorError";
    this.code = code;
  }
}

export class ConfigError extends GittributorError {
  constructor(message: string) {
    super(message, "CONFIG_ERROR");
    this.name = "ConfigError";
  }
}

export class GitHubAPIError extends GittributorError {
  exitCode?: number;

  constructor(message: string, exitCode?: number) {
    super(message, "GITHUB_API_ERROR");
    this.name = "GitHubAPIError";
    this.exitCode = exitCode;
  }
}

export class AnthropicAPIError extends GittributorError {
  statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message, "ANTHROPIC_API_ERROR");
    this.name = "AnthropicAPIError";
    this.statusCode = statusCode;
  }
}

export class RateLimitError extends GittributorError {
  retryAfter?: number;

  constructor(message: string, retryAfter?: number) {
    super(message, "RATE_LIMIT_ERROR");
    this.name = "RateLimitError";
    this.retryAfter = retryAfter;
  }
}

export class StateError extends GittributorError {
  constructor(message: string) {
    super(message, "STATE_ERROR");
    this.name = "StateError";
  }
}

export class FixValidationError extends GittributorError {
  constructor(message: string) {
    super(message, "FIX_VALIDATION_ERROR");
    this.name = "FixValidationError";
  }
}

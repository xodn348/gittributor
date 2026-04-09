import type {
  AnalysisResult,
  CommandName,
  Config,
  ContributionOpportunity,
  ContributionType,
  FixResult,
  GuardrailCheck,
  Issue,
  MergeProbability,
  PipelineState,
  PipelineStatus,
  PRSubmission,
  Repository,
  ReviewDecision,
  TrendingRepo,
} from "./index";

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const isStringArray = (value: unknown): value is string[] => {
  return Array.isArray(value) && value.every((element) => typeof element === "string");
};

export const isCommandName = (value: unknown): value is CommandName => {
  return (
    value === "discover" ||
    value === "analyze" ||
    value === "fix" ||
    value === "review" ||
    value === "submit" ||
    value === "run"
  );
};

export const isRepository = (value: unknown): value is Repository => {
  if (!isRecord(value)) return false;

  return (
    typeof value.id === "number" &&
    typeof value.name === "string" &&
    typeof value.fullName === "string" &&
    typeof value.url === "string" &&
    typeof value.stars === "number" &&
    (typeof value.language === "string" || value.language === null) &&
    typeof value.openIssuesCount === "number" &&
    typeof value.updatedAt === "string" &&
    (typeof value.description === "string" || value.description === null)
  );
};

export const isIssue = (value: unknown): value is Issue => {
  if (!isRecord(value)) return false;

  return (
    typeof value.id === "number" &&
    typeof value.number === "number" &&
    typeof value.title === "string" &&
    (typeof value.body === "string" || value.body === null) &&
    typeof value.url === "string" &&
    typeof value.repoFullName === "string" &&
    isStringArray(value.labels) &&
    typeof value.createdAt === "string" &&
    isStringArray(value.assignees)
  );
};

export const isAnalysisResult = (value: unknown): value is AnalysisResult => {
  if (!isRecord(value)) return false;

  return (
    typeof value.issueId === "number" &&
    typeof value.repoFullName === "string" &&
    isStringArray(value.relevantFiles) &&
    typeof value.suggestedApproach === "string" &&
    typeof value.confidence === "number" &&
    typeof value.analyzedAt === "string"
  );
};

export const isFixResult = (value: unknown): value is FixResult => {
  if (!isRecord(value)) return false;

  return (
    typeof value.issueId === "number" &&
    typeof value.repoFullName === "string" &&
    typeof value.patch === "string" &&
    typeof value.explanation === "string" &&
    typeof value.testsPass === "boolean" &&
    typeof value.confidence === "number" &&
    typeof value.generatedAt === "string"
  );
};

export const isPRSubmission = (value: unknown): value is PRSubmission => {
  if (!isRecord(value)) return false;

  return (
    typeof value.issueId === "number" &&
    typeof value.repoFullName === "string" &&
    typeof value.prUrl === "string" &&
    typeof value.prNumber === "number" &&
    typeof value.branchName === "string" &&
    typeof value.submittedAt === "string"
  );
};

export const isPipelineStatus = (value: unknown): value is PipelineStatus => {
  return (
    value === "idle" ||
    value === "discovered" ||
    value === "analyzed" ||
    value === "fixed" ||
    value === "reviewed" ||
    value === "submitted"
  );
};

const isRecordOf = <T>(
  value: unknown,
  validator: (inner: unknown) => inner is T,
): value is Record<number, T> => {
  if (!isRecord(value)) return false;

  return Object.entries(value).every(([key, entry]) => {
    const numericKey = Number(key);

    return Number.isInteger(numericKey) && String(numericKey) === key && validator(entry);
  });
};

export const isPipelineState = (value: unknown): value is PipelineState => {
  if (!isRecord(value)) return false;

  return (
    typeof value.version === "string" &&
    isPipelineStatus(value.status) &&
    Array.isArray(value.repositories) &&
    value.repositories.every((repository) => isRepository(repository)) &&
    Array.isArray(value.issues) &&
    value.issues.every((issue) => isIssue(issue)) &&
    isRecordOf(value.analyses, isAnalysisResult) &&
    isRecordOf(value.fixes, isFixResult) &&
    Array.isArray(value.submissions) &&
    value.submissions.every((submission) => isPRSubmission(submission)) &&
    typeof value.lastUpdated === "string"
  );
};

export const isConfig = (value: unknown): value is Config => {
  if (!isRecord(value)) return false;

  const hasValidApiKey =
    value.anthropicApiKey === undefined || typeof value.anthropicApiKey === "string";
  const hasValidOauthToken =
    value.oauthToken === undefined || typeof value.oauthToken === "string";
  const hasValidAiProvider =
    value.aiProvider === undefined || value.aiProvider === "anthropic" || value.aiProvider === "openai";
  const hasValidOpenAIApiKey =
    value.openaiApiKey === undefined || typeof value.openaiApiKey === "string";
  const hasValidOpenAIOauthToken =
    value.openaiOauthToken === undefined || typeof value.openaiOauthToken === "string";
  const hasValidOpenAIModel =
    value.openaiModel === undefined || typeof value.openaiModel === "string";

  return (
    hasValidAiProvider &&
    hasValidApiKey &&
    hasValidOauthToken &&
    hasValidOpenAIApiKey &&
    hasValidOpenAIOauthToken &&
    hasValidOpenAIModel &&
    typeof value.minStars === "number" &&
    typeof value.maxPRsPerDay === "number" &&
    typeof value.maxPRsPerRepo === "number" &&
    isStringArray(value.targetLanguages) &&
    typeof value.verbose === "boolean"
  );
};

export const isReviewDecision = (value: unknown): value is ReviewDecision => {
  return value === "approve" || value === "reject";
};

export const isContributionType = (value: unknown): value is ContributionType => {
  return (
    value === "typo" ||
    value === "docs" ||
    value === "deps" ||
    value === "test" ||
    value === "code"
  );
};

export const isTrendingRepo = (value: unknown): value is TrendingRepo => {
  if (!isRecord(value)) return false;

  return (
    typeof value.owner === "string" &&
    typeof value.name === "string" &&
    typeof value.fullName === "string" &&
    typeof value.stars === "number" &&
    (typeof value.language === "string" || value.language === null) &&
    (typeof value.description === "string" || value.description === null) &&
    typeof value.isArchived === "boolean" &&
    typeof value.defaultBranch === "string" &&
    typeof value.hasContributing === "boolean" &&
    isStringArray(value.topics) &&
    typeof value.openIssues === "number"
  );
};

export const isMergeProbability = (value: unknown): value is MergeProbability => {
  if (!isRecord(value)) return false;

  return (
    typeof value.score === "number" &&
    (value.label === "high" || value.label === "medium" || value.label === "low") &&
    isStringArray(value.reasons)
  );
};

export const isContributionOpportunity = (value: unknown): value is ContributionOpportunity => {
  if (!isRecord(value)) return false;

  return (
    isTrendingRepo(value.repo) &&
    isContributionType(value.type) &&
    typeof value.filePath === "string" &&
    typeof value.description === "string" &&
    isMergeProbability(value.mergeProbability) &&
    typeof value.detectedAt === "string"
  );
};

export const isContributionHistory = (value: unknown): value is ContributionHistory => {
  if (!isRecord(value)) return false;

  const validStatuses = ["pending", "submitted", "merged", "closed", "rejected"];

  return (
    typeof value.id === "string" &&
    typeof value.repo === "string" &&
    isContributionType(value.type) &&
    typeof value.description === "string" &&
    typeof value.filePath === "string" &&
    typeof value.branchName === "string" &&
    validStatuses.includes(String(value.status)) &&
    typeof value.createdAt === "string"
  );
};

export const isGuardrailCheck = (value: unknown): value is GuardrailCheck => {
  if (!isRecord(value)) return false;

  return (
    typeof value.passed === "boolean" &&
    typeof value.reason === "string"
  );
};

import type { ContributionHistory } from "./index";

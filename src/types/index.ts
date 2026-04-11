// Type definitions for gittributor
export type CommandName = "discover" | "analyze" | "fix" | "review" | "submit" | "run";

export interface Repository {
  id: number;
  name: string;
  fullName: string;
  url: string;
  stars: number;
  language: string | null;
  openIssuesCount: number;
  updatedAt: string;
  description: string | null;
}

export interface Issue {
  id: number;
  number: number;
  title: string;
  body: string | null;
  url: string;
  repoFullName: string;
  labels: string[];
  createdAt: string;
  updatedAt?: string;
  assignees: string[];
  reactions?: number;
  commentsCount?: number;
}

export interface AnalysisResult {
  issueId: number;
  repoFullName: string;
  relevantFiles: string[];
  suggestedApproach: string;
  confidence: number;
  analyzedAt: string;
  rootCause?: string;
  affectedFiles?: string[];
  complexity?: "low" | "medium" | "high";
  fileContents?: Record<string, string>;
}

export interface FixResult {
  issueId: number;
  repoFullName: string;
  patch: string;
  explanation: string;
  testsPass: boolean;
  confidence: number;
  generatedAt: string;
}

export interface PRSubmission {
  issueId: number;
  repoFullName: string;
  prUrl: string;
  prNumber: number;
  branchName: string;
  submittedAt: string;
}

export interface FileChange {
  file: string;
  original: string;
  modified: string;
}

export interface RepoInfo {
  fullName: string;
  diskUsage: number;
  stargazerCount: number;
  isArchived: boolean;
  hasOpenUserPR?: boolean;
}

export interface TrendingRepo {
  owner: string;
  name: string;
  fullName: string;
  stars: number;
  language: string | null;
  description: string | null;
  isArchived: boolean;
  defaultBranch: string;
  hasContributing: boolean;
  topics: string[];
  openIssues: number;
}

export type PipelineStatus =
  | "idle"
  | "discovered"
  | "analyzed"
  | "fixed"
  | "reviewed"
  | "submitted";

export interface PipelineState {
  version: string;
  status: PipelineStatus;
  repositories: Repository[];
  issues: Issue[];
  analyses: Record<number, AnalysisResult>;
  fixes: Record<number, FixResult>;
  submissions: PRSubmission[];
  lastUpdated: string;
}

export interface Config {
  aiProvider?: "anthropic" | "openai";
  anthropicApiKey?: string;
  oauthToken?: string;
  openaiApiKey?: string;
  openaiOauthToken?: string;
  openaiModel?: string;
  minStars: number;
  maxPRsPerDay: number;
  maxPRsPerRepo: number;
  targetLanguages: string[];
  verbose: boolean;
  repoListPath: string;
  maxPRsPerWeekPerRepo: number;
  maxPRsPerHour: number;
  contributionTypes: ContributionType[];
  historyPath: string;
  dryRun: boolean;
}

export type ReviewDecision = "approve" | "reject";

export type ContributionType = "typo" | "docs" | "deps" | "test" | "code" | "bug-fix" | "performance" | "type-safety" | "logic-error" | "static-analysis";

export interface GuardrailCheck {
  passed: boolean;
  reason: string;
  blockedBy?: string;
}

export interface MergeProbability {
  score: number;
  label: "high" | "medium" | "low";
  reasons: string[];
}

export interface ContributionOpportunity {
  repo: TrendingRepo;
  type: ContributionType;
  filePath: string;
  description: string;
  original?: string;
  replacement?: string;
  section?: string;
  packageName?: string;
  oldVersion?: string;
  newVersion?: string;
  mergeProbability: MergeProbability;
  detectedAt: string;
}

export type ContributionStatus = "pending" | "submitted" | "merged" | "closed" | "rejected";

export interface ContributionHistory {
  id: string;
  repo: string;
  type: ContributionType;
  description: string;
  filePath: string;
  branchName: string;
  prNumber?: number;
  prUrl?: string;
  status: "pending" | "submitted" | "merged" | "closed" | "rejected";
  createdAt: string;
  submittedAt?: string;
  mergedAt?: string;
}

export interface ComplianceResult {
  hasCLA: boolean;
  requiresIssueFirst: boolean;
  hasPRTemplate: boolean;
  prTemplateContent: string | null;
}

export interface StaticAnalysisResult {
  patternType: string;
  riskScore: number;
  phase: 1 | 2;
}

export function toTrendingRepo(repo: Repository): TrendingRepo {
  const [owner, name] = repo.fullName.split("/");
  return {
    owner,
    name,
    fullName: repo.fullName,
    stars: repo.stars,
    language: repo.language,
    description: repo.description,
    isArchived: false,
    defaultBranch: "main",
    hasContributing: false,
    topics: [],
    openIssues: repo.openIssuesCount,
  };
}

export function toRepository(repo: TrendingRepo): Repository {
  return {
    id: 0,
    name: repo.name,
    fullName: repo.fullName,
    url: `https://github.com/${repo.fullName}`,
    stars: repo.stars,
    language: repo.language,
    openIssuesCount: repo.openIssues,
    updatedAt: new Date().toISOString(),
    description: repo.description,
  };
}

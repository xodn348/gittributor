// Type definitions for gittributor
export type CommandName = "discover" | "analyze" | "fix" | "review" | "submit";

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
  anthropicApiKey: string;
  minStars: number;
  maxPRsPerDay: number;
  maxPRsPerRepo: number;
  targetLanguages: string[];
  verbose: boolean;
}

export type ReviewDecision = "approve" | "reject";

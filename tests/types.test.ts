import { describe, expect, test } from "bun:test";
import {
  isAnalysisResult,
  isCommandName,
  isConfig,
  isFixResult,
  isIssue,
  isPipelineState,
  isPipelineStatus,
  isPRSubmission,
  isRepository,
  isReviewDecision,
} from "../src/types/guards";

describe("isRepository", () => {
  test("returns true for valid repository", () => {
    const value = {
      id: 1,
      name: "owner/repo",
      fullName: "owner/repo",
      url: "https://github.com/owner/repo",
      stars: 100,
      language: "TypeScript",
      openIssuesCount: 12,
      updatedAt: "2026-03-31T10:00:00.000Z",
      description: "A repository",
    };

    expect(isRepository(value)).toBe(true);
  });

  test("returns false when required field is missing", () => {
    const value = {
      id: 1,
      name: "owner/repo",
      url: "https://github.com/owner/repo",
      stars: 100,
      language: "TypeScript",
      openIssuesCount: 12,
      updatedAt: "2026-03-31T10:00:00.000Z",
      description: "A repository",
    };

    expect(isRepository(value)).toBe(false);
  });

  test("returns false when field has wrong type", () => {
    const value = {
      id: "1",
      name: "owner/repo",
      fullName: "owner/repo",
      url: "https://github.com/owner/repo",
      stars: 100,
      language: "TypeScript",
      openIssuesCount: 12,
      updatedAt: "2026-03-31T10:00:00.000Z",
      description: "A repository",
    };

    expect(isRepository(value)).toBe(false);
  });
});

describe("isIssue", () => {
  test("returns true for valid issue", () => {
    const value = {
      id: 11,
      number: 42,
      title: "Fix pipeline crash",
      body: "Details",
      url: "https://github.com/owner/repo/issues/42",
      repoFullName: "owner/repo",
      labels: ["bug", "help wanted"],
      createdAt: "2026-03-31T10:00:00.000Z",
      assignees: ["alice", "bob"],
    };

    expect(isIssue(value)).toBe(true);
  });

  test("returns false when required field is missing", () => {
    const value = {
      id: 11,
      number: 42,
      body: "Details",
      url: "https://github.com/owner/repo/issues/42",
      repoFullName: "owner/repo",
      labels: ["bug", "help wanted"],
      createdAt: "2026-03-31T10:00:00.000Z",
      assignees: ["alice", "bob"],
    };

    expect(isIssue(value)).toBe(false);
  });

  test("returns false when field has wrong type", () => {
    const value = {
      id: 11,
      number: "42",
      title: "Fix pipeline crash",
      body: "Details",
      url: "https://github.com/owner/repo/issues/42",
      repoFullName: "owner/repo",
      labels: ["bug", "help wanted"],
      createdAt: "2026-03-31T10:00:00.000Z",
      assignees: ["alice", "bob"],
    };

    expect(isIssue(value)).toBe(false);
  });
});

describe("isAnalysisResult", () => {
  test("returns true for valid analysis result", () => {
    const value = {
      issueId: 42,
      repoFullName: "owner/repo",
      relevantFiles: ["src/index.ts"],
      suggestedApproach: "Update parser logic",
      confidence: 0.9,
      analyzedAt: "2026-03-31T10:00:00.000Z",
    };

    expect(isAnalysisResult(value)).toBe(true);
  });

  test("returns false when required field is missing", () => {
    const value = {
      issueId: 42,
      repoFullName: "owner/repo",
      relevantFiles: ["src/index.ts"],
      confidence: 0.9,
      analyzedAt: "2026-03-31T10:00:00.000Z",
    };

    expect(isAnalysisResult(value)).toBe(false);
  });

  test("returns false when field has wrong type", () => {
    const value = {
      issueId: 42,
      repoFullName: "owner/repo",
      relevantFiles: "src/index.ts",
      suggestedApproach: "Update parser logic",
      confidence: 0.9,
      analyzedAt: "2026-03-31T10:00:00.000Z",
    };

    expect(isAnalysisResult(value)).toBe(false);
  });
});

describe("isFixResult", () => {
  test("returns true for valid fix result", () => {
    const value = {
      issueId: 42,
      repoFullName: "owner/repo",
      patch: "diff --git a b",
      explanation: "Applied null check",
      testsPass: true,
      confidence: 0.85,
      generatedAt: "2026-03-31T10:00:00.000Z",
    };

    expect(isFixResult(value)).toBe(true);
  });

  test("returns false when required field is missing", () => {
    const value = {
      issueId: 42,
      repoFullName: "owner/repo",
      patch: "diff --git a b",
      testsPass: true,
      confidence: 0.85,
      generatedAt: "2026-03-31T10:00:00.000Z",
    };

    expect(isFixResult(value)).toBe(false);
  });

  test("returns false when field has wrong type", () => {
    const value = {
      issueId: 42,
      repoFullName: "owner/repo",
      patch: "diff --git a b",
      explanation: "Applied null check",
      testsPass: "true",
      confidence: 0.85,
      generatedAt: "2026-03-31T10:00:00.000Z",
    };

    expect(isFixResult(value)).toBe(false);
  });
});

describe("isPRSubmission", () => {
  test("returns true for valid PR submission", () => {
    const value = {
      issueId: 42,
      repoFullName: "owner/repo",
      prUrl: "https://github.com/owner/repo/pull/1",
      prNumber: 1,
      branchName: "fix/issue-42",
      submittedAt: "2026-03-31T10:00:00.000Z",
    };

    expect(isPRSubmission(value)).toBe(true);
  });

  test("returns false when required field is missing", () => {
    const value = {
      issueId: 42,
      repoFullName: "owner/repo",
      prNumber: 1,
      branchName: "fix/issue-42",
      submittedAt: "2026-03-31T10:00:00.000Z",
    };

    expect(isPRSubmission(value)).toBe(false);
  });

  test("returns false when field has wrong type", () => {
    const value = {
      issueId: 42,
      repoFullName: "owner/repo",
      prUrl: "https://github.com/owner/repo/pull/1",
      prNumber: "1",
      branchName: "fix/issue-42",
      submittedAt: "2026-03-31T10:00:00.000Z",
    };

    expect(isPRSubmission(value)).toBe(false);
  });
});

describe("isPipelineState", () => {
  test("returns true for valid pipeline state", () => {
    const value = {
      version: "1.0",
      status: "analyzed",
      repositories: [
        {
          id: 1,
          name: "owner/repo",
          fullName: "owner/repo",
          url: "https://github.com/owner/repo",
          stars: 100,
          language: "TypeScript",
          openIssuesCount: 12,
          updatedAt: "2026-03-31T10:00:00.000Z",
          description: "A repository",
        },
      ],
      issues: [
        {
          id: 11,
          number: 42,
          title: "Fix pipeline crash",
          body: "Details",
          url: "https://github.com/owner/repo/issues/42",
          repoFullName: "owner/repo",
          labels: ["bug"],
          createdAt: "2026-03-31T10:00:00.000Z",
          assignees: ["alice"],
        },
      ],
      analyses: {
        42: {
          issueId: 42,
          repoFullName: "owner/repo",
          relevantFiles: ["src/index.ts"],
          suggestedApproach: "Update parser logic",
          confidence: 0.9,
          analyzedAt: "2026-03-31T10:00:00.000Z",
        },
      },
      fixes: {
        42: {
          issueId: 42,
          repoFullName: "owner/repo",
          patch: "diff --git a b",
          explanation: "Applied null check",
          testsPass: true,
          confidence: 0.85,
          generatedAt: "2026-03-31T10:00:00.000Z",
        },
      },
      submissions: [
        {
          issueId: 42,
          repoFullName: "owner/repo",
          prUrl: "https://github.com/owner/repo/pull/1",
          prNumber: 1,
          branchName: "fix/issue-42",
          submittedAt: "2026-03-31T10:00:00.000Z",
        },
      ],
      lastUpdated: "2026-03-31T10:00:00.000Z",
    };

    expect(isPipelineState(value)).toBe(true);
  });

  test("returns false when required field is missing", () => {
    const value = {
      version: "1.0",
      status: "analyzed",
      repositories: [],
      issues: [],
      analyses: {},
      fixes: {},
      submissions: [],
    };

    expect(isPipelineState(value)).toBe(false);
  });

  test("returns false when field has wrong type", () => {
    const value = {
      version: "1.0",
      status: 1,
      repositories: [],
      issues: [],
      analyses: {},
      fixes: {},
      submissions: [],
      lastUpdated: "2026-03-31T10:00:00.000Z",
    };

    expect(isPipelineState(value)).toBe(false);
  });

  test("returns false when analyses or fixes contain non-numeric keys", () => {
    const value = {
      version: "1.0",
      status: "analyzed",
      repositories: [],
      issues: [],
      analyses: {
        foo: {
          issueId: 42,
          repoFullName: "owner/repo",
          relevantFiles: ["src/index.ts"],
          suggestedApproach: "Update parser logic",
          confidence: 0.9,
          analyzedAt: "2026-03-31T10:00:00.000Z",
        },
      },
      fixes: {
        bar: {
          issueId: 42,
          repoFullName: "owner/repo",
          patch: "diff --git a b",
          explanation: "Applied null check",
          testsPass: true,
          confidence: 0.85,
          generatedAt: "2026-03-31T10:00:00.000Z",
        },
      },
      submissions: [],
      lastUpdated: "2026-03-31T10:00:00.000Z",
    };

    expect(isPipelineState(value)).toBe(false);
  });
});

describe("isConfig", () => {
  test("returns true when auth fields are omitted", () => {
    const value = {
      minStars: 50,
      maxPRsPerDay: 5,
      maxPRsPerRepo: 1,
      targetLanguages: ["TypeScript", "JavaScript", "Python"],
      verbose: false,
    };

    expect(isConfig(value)).toBe(true);
  });

  test("returns true for valid config", () => {
    const value = {
      anthropicApiKey: "key",
      minStars: 50,
      maxPRsPerDay: 5,
      maxPRsPerRepo: 1,
      targetLanguages: ["TypeScript", "JavaScript", "Python"],
      verbose: false,
    };

    expect(isConfig(value)).toBe(true);
  });

  test("returns false when required field is missing", () => {
    const value = {
      anthropicApiKey: "key",
      maxPRsPerDay: 5,
      maxPRsPerRepo: 1,
      targetLanguages: ["TypeScript", "JavaScript", "Python"],
      verbose: false,
    };

    expect(isConfig(value)).toBe(false);
  });

  test("returns false when field has wrong type", () => {
    const value = {
      anthropicApiKey: "key",
      minStars: 50,
      maxPRsPerDay: 5,
      maxPRsPerRepo: 1,
      targetLanguages: "TypeScript",
      verbose: false,
    };

    expect(isConfig(value)).toBe(false);
  });
});

describe("union type guards", () => {
  test("isReviewDecision returns true for approve", () => {
    expect(isReviewDecision("approve")).toBe(true);
  });

  test("isReviewDecision returns false for invalid value", () => {
    expect(isReviewDecision("pending")).toBe(false);
  });

  test("isReviewDecision returns false for wrong type", () => {
    expect(isReviewDecision(42)).toBe(false);
  });

  test("isPipelineStatus returns true for fixed", () => {
    expect(isPipelineStatus("fixed")).toBe(true);
  });

  test("isPipelineStatus returns false for invalid value", () => {
    expect(isPipelineStatus("queued")).toBe(false);
  });

  test("isPipelineStatus returns false for wrong type", () => {
    expect(isPipelineStatus(null)).toBe(false);
  });

  test("isCommandName returns true for submit", () => {
    expect(isCommandName("submit")).toBe(true);
  });

  test("isCommandName returns false for invalid value", () => {
    expect(isCommandName("deploy")).toBe(false);
  });

  test("isCommandName returns false for wrong type", () => {
    expect(isCommandName({ command: "submit" })).toBe(false);
  });
});

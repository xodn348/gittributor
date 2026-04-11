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
} from "../src/types/guards.js";
import type {
  ContributionType,
  TrendingRepo,
  MergeProbability,
  ContributionHistory,
  GuardrailCheck,
  Config,
} from "../src/types/index.js";

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
      aiProvider: "openai",
      anthropicApiKey: "key",
      openaiApiKey: "ok",
      openaiOauthToken: "sess",
      openaiModel: "gpt-5-mini",
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
      aiProvider: "codex",
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

describe("V2 Type System", () => {
  describe("ContributionType", () => {
    test("accepts valid contribution types", () => {
      const types: ContributionType[] = ["typo", "docs", "deps", "test", "code"];
      expect(types).toHaveLength(5);
      expect(types).toContain("typo");
      expect(types).toContain("docs");
      expect(types).toContain("deps");
      expect(types).toContain("test");
      expect(types).toContain("code");
    });
  });

  describe("TrendingRepo", () => {
    test("matches expected shape", () => {
      const repo: TrendingRepo = {
        owner: "facebook",
        name: "react",
        fullName: "facebook/react",
        stars: 150000,
        language: "TypeScript",
        description: "A declarative UI library",
        isArchived: false,
        defaultBranch: "main",
        hasContributing: true,
        topics: ["ui", "javascript"],
        openIssues: 1000,
      };
      expect(repo.owner).toBe("facebook");
      expect(repo.name).toBe("react");
      expect(repo.fullName).toBe("facebook/react");
      expect(repo.stars).toBe(150000);
      expect(repo.language).toBe("TypeScript");
      expect(repo.description).toBe("A declarative UI library");
      expect(repo.isArchived).toBe(false);
      expect(repo.defaultBranch).toBe("main");
      expect(repo.hasContributing).toBe(true);
      expect(repo.topics).toEqual(["ui", "javascript"]);
      expect(repo.openIssues).toBe(1000);
    });

    test("allows null language and description", () => {
      const repo: TrendingRepo = {
        owner: "owner",
        name: "name",
        fullName: "owner/name",
        stars: 1000,
        language: null,
        description: null,
        isArchived: false,
        defaultBranch: "main",
        hasContributing: false,
        topics: [],
        openIssues: 0,
      };
      expect(repo.language).toBeNull();
      expect(repo.description).toBeNull();
    });
  });

  describe("MergeProbability", () => {
    test("matches expected shape with all labels", () => {
      const high: MergeProbability = {
        score: 85,
        label: "high",
        reasons: ["popular dependency", "frequently updated"],
      };
      expect(high.score).toBe(85);
      expect(high.label).toBe("high");
      expect(high.reasons).toHaveLength(2);

      const medium: MergeProbability = {
        score: 50,
        label: "medium",
        reasons: ["some chance of merge"],
      };
      expect(medium.label).toBe("medium");

      const low: MergeProbability = {
        score: 20,
        label: "low",
        reasons: ["rarely updated repo"],
      };
      expect(low.label).toBe("low");
    });
  });

  describe("ContributionHistory", () => {
    test("matches expected shape for pending contribution", () => {
      const history: ContributionHistory = {
        id: "abc123",
        repo: "owner/name",
        type: "docs",
        description: "Fix typos",
        filePath: "README.md",
        branchName: "fix-readme-typos",
        status: "pending",
        createdAt: "2026-04-08T12:00:00Z",
      };

      expect(history.id).toBe("abc123");
      expect(history.status).toBe("pending");
      expect(history.prNumber).toBeUndefined();
      expect(history.prUrl).toBeUndefined();
    });

    test("matches expected shape for merged contribution", () => {
      const history: ContributionHistory = {
        id: "def456",
        repo: "owner/repo",
        type: "typo",
        description: "Fix typo",
        filePath: "CONTRIBUTING.md",
        branchName: "fix-typo",
        prNumber: 42,
        prUrl: "https://github.com/owner/repo/pull/42",
        status: "merged",
        createdAt: "2026-04-01T12:00:00Z",
        submittedAt: "2026-04-02T12:00:00Z",
        mergedAt: "2026-04-03T12:00:00Z",
      };

      expect(history.prNumber).toBe(42);
      expect(history.status).toBe("merged");
      expect(history.submittedAt).toBe("2026-04-02T12:00:00Z");
      expect(history.mergedAt).toBe("2026-04-03T12:00:00Z");
    });

    test("accepts all status values", () => {
      const statuses: ContributionHistory["status"][] = [
        "pending",
        "submitted",
        "merged",
        "closed",
        "rejected",
      ];
      expect(statuses).toHaveLength(5);
    });
  });

  describe("GuardrailCheck", () => {
    test("matches expected shape for passed check", () => {
      const check: GuardrailCheck = {
        passed: true,
        reason: "All checks passed",
      };

      expect(check.passed).toBe(true);
      expect(check.reason).toBe("All checks passed");
      expect(check.blockedBy).toBeUndefined();
    });

    test("matches expected shape for blocked check", () => {
      const check: GuardrailCheck = {
        passed: false,
        reason: "Rate limit exceeded",
        blockedBy: "maxPRsPerHour",
      };

      expect(check.passed).toBe(false);
      expect(check.blockedBy).toBe("maxPRsPerHour");
    });
  });

  describe("Config V2 fields", () => {
    test("contains V2 fields", () => {
      const config: Config = {
        minStars: 1000,
        maxPRsPerDay: 10,
        maxPRsPerRepo: 3,
        targetLanguages: ["TypeScript", "JavaScript"],
        verbose: true,
        repoListPath: "./repos.txt",
        maxPRsPerWeekPerRepo: 5,
        maxPRsPerHour: 3,
        contributionTypes: ["docs", "typo", "deps"],
        historyPath: "./history.json",
        dryRun: true,
      };

      expect(config.repoListPath).toBe("./repos.txt");
      expect(config.maxPRsPerWeekPerRepo).toBe(5);
      expect(config.maxPRsPerHour).toBe(3);
      expect(config.contributionTypes).toEqual(["docs", "typo", "deps"]);
      expect(config.historyPath).toBe("./history.json");
      expect(config.dryRun).toBe(true);
    });

    test("preserves original V1 fields", () => {
      const config: Config = {
        aiProvider: "openai",
        openaiApiKey: "sk-test",
        openaiModel: "gpt-4o-mini",
        minStars: 500,
        maxPRsPerDay: 5,
        maxPRsPerRepo: 2,
        targetLanguages: ["Python"],
        verbose: false,
        repoListPath: "./list.txt",
        maxPRsPerWeekPerRepo: 3,
        maxPRsPerHour: 2,
        contributionTypes: ["code"],
        historyPath: "./hist.json",
        dryRun: false,
      };

      expect(config.aiProvider).toBe("openai");
      expect(config.openaiApiKey).toBe("sk-test");
      expect(config.openaiModel).toBe("gpt-4o-mini");
      expect(config.minStars).toBe(500);
      expect(config.maxPRsPerDay).toBe(5);
      expect(config.maxPRsPerRepo).toBe(2);
      expect(config.targetLanguages).toEqual(["Python"]);
      expect(config.verbose).toBe(false);
    });

    test("allows optional OAuth tokens", () => {
      const config: Config = {
        minStars: 100,
        maxPRsPerDay: 1,
        maxPRsPerRepo: 1,
        targetLanguages: [],
        verbose: false,
        repoListPath: "./repos.txt",
        maxPRsPerWeekPerRepo: 1,
        maxPRsPerHour: 1,
        contributionTypes: [],
        historyPath: "./hist.json",
        dryRun: false,
      };

      expect(config.anthropicApiKey).toBeUndefined();
      expect(config.oauthToken).toBeUndefined();
      expect(config.openaiApiKey).toBeUndefined();
    });
  });
});

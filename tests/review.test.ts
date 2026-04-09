import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { 
  PipelineState, 
  PipelineStatus, 
  ContributionOpportunity, 
  ContributionType,
  TrendingRepo,
} from "../src/types";
import { acquireGlobalTestLock } from "./helpers/global-test-lock";
import {
  loadState as _loadStateBinding,
  saveState as _saveStateBinding,
  setStateData as _setStateDataBinding,
  getStateData as _getStateDataBinding,
  transition as _transitionBinding,
} from "../src/lib/state";

const _realLoadState = _loadStateBinding;
const _realSaveState = _saveStateBinding;
const _realSetStateData = _setStateDataBinding;
const _realGetStateData = _getStateDataBinding;
const _realTransition = _transitionBinding;

let _currentLoadState: typeof _realLoadState = _realLoadState;
let _currentSaveState: typeof _realSaveState = _realSaveState;
let _currentSetStateData: typeof _realSetStateData = _realSetStateData;
let _currentGetStateData: typeof _realGetStateData = _realGetStateData;
let _currentTransition: typeof _realTransition = _realTransition;

const establishStateMock = (): void => {
  mock.module("../src/lib/state", () => ({
    loadState: (): ReturnType<typeof _realLoadState> => _currentLoadState(),
    saveState: (state: PipelineState): ReturnType<typeof _realSaveState> => _currentSaveState(state),
    setStateData: (key: string, data: unknown): ReturnType<typeof _realSetStateData> =>
      _currentSetStateData(key, data),
    getStateData: <T>(key: string): T | null => _currentGetStateData<T>(key),
    transition: (from: PipelineStatus, to: PipelineStatus): ReturnType<typeof _realTransition> =>
      _currentTransition(from, to),
  }));
};

interface WritableCapture {
  text: string;
  write: (chunk: string) => boolean;
}

type LoadedState = Awaited<ReturnType<typeof _realLoadState>>;

const createWritableCapture = (): WritableCapture => {
  const capture: WritableCapture = {
    text: "",
    write(chunk: string): boolean {
      capture.text += chunk;
      return true;
    },
  };
  return capture;
};

const makeState = (status: PipelineStatus): LoadedState => {
  return {
    version: "1.0.0",
    status,
    repositories: [],
    issues: [],
    analyses: {},
    fixes: {},
    submissions: [],
    lastUpdated: new Date().toISOString(),
    data: {},
  };
};

const createMockRepo = (name: string): TrendingRepo => ({
  owner: "test-owner",
  name,
  fullName: `test-owner/${name}`,
  stars: 100,
  language: "TypeScript",
  description: `Test repo ${name}`,
  isArchived: false,
  defaultBranch: "main",
  hasContributing: true,
  topics: [],
  openIssues: 5,
});

const createMockOpportunity = (
  type: ContributionType,
  score: number,
  repoName = "test-repo",
  hasComplianceIssue = false,
): ContributionOpportunity => ({
  repo: createMockRepo(repoName),
  type,
  filePath: `src/${type}.ts`,
  description: `Test ${type} contribution`,
  mergeProbability: {
    score,
    label: score > 0.7 ? "high" : score > 0.4 ? "medium" : "low",
    reasons: [`Test reason for ${type}`],
  },
  detectedAt: new Date().toISOString(),
});

let reviewModuleLoadCounter = 0;

const loadReviewModule = async (): Promise<typeof import("../src/commands/review")> => {
  reviewModuleLoadCounter += 1;
  return import(`../src/commands/review.ts?cacheBust=${reviewModuleLoadCounter}`);
};

describe("reviewContributions", () => {
  let previousCwd = "";
  let tempDir = "";
  let releaseGlobalLock: (() => void) | null = null;

  beforeEach(async () => {
    releaseGlobalLock = await acquireGlobalTestLock();
    establishStateMock();
    previousCwd = process.cwd();
    tempDir = await mkdtemp(join(tmpdir(), "gittributor-review-"));
    process.chdir(tempDir);
  });

  afterEach(async () => {
    process.chdir(previousCwd);
    await rm(tempDir, { recursive: true, force: true });

    _currentLoadState = _realLoadState;
    _currentSaveState = _realSaveState;
    _currentSetStateData = _realSetStateData;
    _currentGetStateData = _realGetStateData;
    _currentTransition = _realTransition;

    mock.restore();
    establishStateMock();
    releaseGlobalLock?.();
    releaseGlobalLock = null;
  });

  describe("grouping by type", () => {
    it("displays contributions grouped by type with headers", async () => {
      const opportunities: ContributionOpportunity[] = [
        createMockOpportunity("typo", 0.8),
        createMockOpportunity("typo", 0.9),
        createMockOpportunity("docs", 0.7),
        createMockOpportunity("deps", 0.5),
      ];
      _currentGetStateData = <T>(_key: string): T | null => {
        if (_key === "contributionOpportunities") {
          return opportunities as T;
        }
        return null;
      };

      const { reviewContributions } = await loadReviewModule();
      const stdout = createWritableCapture();

      await reviewContributions({ stdout });

      expect(stdout.text).toContain("Typo (2)");
      expect(stdout.text).toContain("Docs (1)");
      expect(stdout.text).toContain("Deps (1)");
      expect(stdout.text).not.toContain("Test (");
      expect(stdout.text).not.toContain("Code (");
    });

    it("shows only types that have contributions", async () => {
      const opportunities: ContributionOpportunity[] = [
        createMockOpportunity("test", 0.6, "repo1"),
        createMockOpportunity("code", 0.4, "repo2"),
      ];
      _currentGetStateData = <T>(_key: string): T | null => {
        if (_key === "contributionOpportunities") {
          return opportunities as T;
        }
        return null;
      };

      const { reviewContributions } = await loadReviewModule();
      const stdout = createWritableCapture();

      await reviewContributions({ stdout });

      expect(stdout.text).toContain("Test (1)");
      expect(stdout.text).toContain("Code (1)");
      expect(stdout.text).not.toContain("Typo (");
      expect(stdout.text).not.toContain("Docs (");
    });

    it("shows individual contribution details under each type", async () => {
      const opportunities: ContributionOpportunity[] = [
        createMockOpportunity("typo", 0.85, "awesome-lib"),
      ];
      _currentGetStateData = <T>(_key: string): T | null => {
        if (_key === "contributionOpportunities") {
          return opportunities as T;
        }
        return null;
      };

      const { reviewContributions } = await loadReviewModule();
      const stdout = createWritableCapture();

      await reviewContributions({ stdout });

      expect(stdout.text).toContain("Typo (1)");
      expect(stdout.text).toContain("test-owner/awesome-lib");
      expect(stdout.text).toContain("Test typo contribution");
    });
  });

  describe("--type filter", () => {
    it("filters to only show specified type", async () => {
      const opportunities: ContributionOpportunity[] = [
        createMockOpportunity("typo", 0.8),
        createMockOpportunity("docs", 0.7),
        createMockOpportunity("deps", 0.5),
        createMockOpportunity("test", 0.6),
        createMockOpportunity("code", 0.4),
      ];
      _currentGetStateData = <T>(_key: string): T | null => {
        if (_key === "contributionOpportunities") {
          return opportunities as T;
        }
        return null;
      };

      const { reviewContributions } = await loadReviewModule();
      const stdout = createWritableCapture();

      await reviewContributions({ 
        stdout, 
        typeFilter: "typo" 
      });

      expect(stdout.text).toContain("Typo (1)");
      expect(stdout.text).not.toContain("Docs (");
      expect(stdout.text).not.toContain("Deps (");
      expect(stdout.text).not.toContain("Test (");
      expect(stdout.text).not.toContain("Code (");
    });

    it("shows all types when no filter specified", async () => {
      const opportunities: ContributionOpportunity[] = [
        createMockOpportunity("typo", 0.8),
        createMockOpportunity("docs", 0.7),
      ];
      _currentGetStateData = <T>(_key: string): T | null => {
        if (_key === "contributionOpportunities") {
          return opportunities as T;
        }
        return null;
      };

      const { reviewContributions } = await loadReviewModule();
      const stdout = createWritableCapture();

      await reviewContributions({ stdout });

      expect(stdout.text).toContain("Typo (1)");
      expect(stdout.text).toContain("Docs (1)");
    });
  });

  describe("merge probability color coding", () => {
    it("displays high probability (>0.7) in green", async () => {
      const opportunities: ContributionOpportunity[] = [
        createMockOpportunity("typo", 0.8),
      ];
      _currentGetStateData = <T>(_key: string): T | null => {
        if (_key === "contributionOpportunities") {
          return opportunities as T;
        }
        return null;
      };

      const { reviewContributions } = await loadReviewModule();
      const stdout = createWritableCapture();

      await reviewContributions({ stdout });

      expect(stdout.text).toContain("\x1b[32m");
      expect(stdout.text).toContain("0.80");
    });

    it("displays medium probability (0.4-0.7) in yellow", async () => {
      const opportunities: ContributionOpportunity[] = [
        createMockOpportunity("deps", 0.55),
      ];
      _currentGetStateData = <T>(_key: string): T | null => {
        if (_key === "contributionOpportunities") {
          return opportunities as T;
        }
        return null;
      };

      const { reviewContributions } = await loadReviewModule();
      const stdout = createWritableCapture();

      await reviewContributions({ stdout });

      expect(stdout.text).toContain("\x1b[33m");
      expect(stdout.text).toContain("0.55");
    });

    it("displays low probability (<0.4) in red", async () => {
      const opportunities: ContributionOpportunity[] = [
        createMockOpportunity("code", 0.3),
      ];
      _currentGetStateData = <T>(_key: string): T | null => {
        if (_key === "contributionOpportunities") {
          return opportunities as T;
        }
        return null;
      };

      const { reviewContributions } = await loadReviewModule();
      const stdout = createWritableCapture();

      await reviewContributions({ stdout });

      expect(stdout.text).toContain("\x1b[31m");
      expect(stdout.text).toContain("0.30");
    });

    it("shows merge probability score and factor breakdown", async () => {
      const opportunities: ContributionOpportunity[] = [
        {
          ...createMockOpportunity("typo", 0.85),
          mergeProbability: {
            score: 0.85,
            label: "high",
            reasons: ["Has contributing guide", "Small diff", "Clear description"],
          },
        },
      ];
      _currentGetStateData = <T>(_key: string): T | null => {
        if (_key === "contributionOpportunities") {
          return opportunities as T;
        }
        return null;
      };

      const { reviewContributions } = await loadReviewModule();
      const stdout = createWritableCapture();

      await reviewContributions({ stdout });

      expect(stdout.text).toContain("0.85");
      expect(stdout.text).toContain("Has contributing guide");
      expect(stdout.text).toContain("Small diff");
      expect(stdout.text).toContain("Clear description");
    });
  });

  describe("compliance warnings", () => {
    it("shows warning when repo requires CLA", async () => {
      const opportunities: ContributionOpportunity[] = [
        {
          ...createMockOpportunity("code", 0.7),
          repo: { ...createMockRepo("clause-repo"), hasCLA: true } as TrendingRepo & { hasCLA?: boolean },
        },
      ];
      _currentGetStateData = <T>(_key: string): T | null => {
        if (_key === "contributionOpportunities") {
          return opportunities as T;
        }
        return null;
      };

      const { reviewContributions } = await loadReviewModule();
      const stdout = createWritableCapture();

      await reviewContributions({ stdout });

      expect(stdout.text).toContain("CLA");
      expect(stdout.text).toContain("\x1b[33m");
    });

    it("shows warning when repo requires issue-first", async () => {
      const opportunities: ContributionOpportunity[] = [
        {
          ...createMockOpportunity("docs", 0.6),
          repo: { ...createMockRepo("issue-first-repo"), requiresIssueFirst: true } as TrendingRepo & { requiresIssueFirst?: boolean },
        },
      ];
      _currentGetStateData = <T>(_key: string): T | null => {
        if (_key === "contributionOpportunities") {
          return opportunities as T;
        }
        return null;
      };

      const { reviewContributions } = await loadReviewModule();
      const stdout = createWritableCapture();

      await reviewContributions({ stdout });

      expect(stdout.text).toContain("issue");
      expect(stdout.text).toContain("\x1b[33m");
    });
  });

  describe("summary stats", () => {
    it("shows count per type in summary", async () => {
      const opportunities: ContributionOpportunity[] = [
        createMockOpportunity("typo", 0.8),
        createMockOpportunity("typo", 0.9),
        createMockOpportunity("docs", 0.7),
        createMockOpportunity("deps", 0.5),
        createMockOpportunity("test", 0.6),
      ];
      _currentGetStateData = <T>(_key: string): T | null => {
        if (_key === "contributionOpportunities") {
          return opportunities as T;
        }
        return null;
      };

      const { reviewContributions } = await loadReviewModule();
      const stdout = createWritableCapture();

      await reviewContributions({ stdout });

      expect(stdout.text).toContain("SUMMARY");
      expect(stdout.text).toContain("typo: 2");
      expect(stdout.text).toContain("docs: 1");
      expect(stdout.text).toContain("deps: 1");
      expect(stdout.text).toContain("test: 1");
    });

    it("shows average merge probability in summary", async () => {
      const opportunities: ContributionOpportunity[] = [
        createMockOpportunity("typo", 0.8),
        createMockOpportunity("docs", 0.6),
        createMockOpportunity("deps", 0.4),
      ];
      _currentGetStateData = <T>(_key: string): T | null => {
        if (_key === "contributionOpportunities") {
          return opportunities as T;
        }
        return null;
      };

      const { reviewContributions } = await loadReviewModule();
      const stdout = createWritableCapture();

      await reviewContributions({ stdout });

      expect(stdout.text).toContain("Average merge probability");
      expect(stdout.text).toContain("0.60");
    });

    it("shows top recommendation in summary", async () => {
      const opportunities: ContributionOpportunity[] = [
        createMockOpportunity("typo", 0.95, "best-repo"),
        createMockOpportunity("docs", 0.5, "ok-repo"),
      ];
      _currentGetStateData = <T>(_key: string): T | null => {
        if (_key === "contributionOpportunities") {
          return opportunities as T;
        }
        return null;
      };

      const { reviewContributions } = await loadReviewModule();
      const stdout = createWritableCapture();

      await reviewContributions({ stdout });

      expect(stdout.text).toContain("RECOMMENDED");
      expect(stdout.text).toContain("test-owner/best-repo");
      expect(stdout.text).toContain("0.95");
    });
  });

  describe("empty state", () => {
    it("shows no contributions found message when empty", async () => {
      _currentGetStateData = <T>(_key: string): T | null => {
        if (_key === "contributionOpportunities") {
          return [] as T;
        }
        return null;
      };

      const { reviewContributions } = await loadReviewModule();
      const stdout = createWritableCapture();

      await reviewContributions({ stdout });

      expect(stdout.text).toContain("No contributions found");
      expect(stdout.text).toContain("Run 'analyze' command first");
    });

    it("shows filtered type not found when no matches", async () => {
      const opportunities: ContributionOpportunity[] = [
        createMockOpportunity("typo", 0.8),
      ];
      _currentGetStateData = <T>(_key: string): T | null => {
        if (_key === "contributionOpportunities") {
          return opportunities as T;
        }
        return null;
      };

      const { reviewContributions } = await loadReviewModule();
      const stdout = createWritableCapture();

      await reviewContributions({ stdout, typeFilter: "code" });

      expect(stdout.text).toContain("No contributions found");
    });
  });

  describe("read-only behavior", () => {
    it("does not modify state (read-only command)", async () => {
      const opportunities: ContributionOpportunity[] = [
        createMockOpportunity("typo", 0.8),
      ];
      _currentGetStateData = <T>(_key: string): T | null => {
        if (_key === "contributionOpportunities") {
          return opportunities as T;
        }
        return null;
      };

      const saveStateCalls: PipelineState[] = [];
      _currentSaveState = async (state: PipelineState) => {
        saveStateCalls.push(state);
      };

      const { reviewContributions } = await loadReviewModule();
      const stdout = createWritableCapture();

      await reviewContributions({ stdout });

      expect(saveStateCalls).toHaveLength(0);
    });
  });
});

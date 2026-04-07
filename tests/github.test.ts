import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { GitHubAPIError, GitHubClient } from "../src/lib/github";
import * as logger from "../src/lib/logger";

function toStream(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

function createMockProcess(options: {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}): Bun.Subprocess {
  const stdout = options.stdout ?? "";
  const stderr = options.stderr ?? "";
  const exitCode = options.exitCode ?? 0;

  return {
    stdout: toStream(stdout),
    stderr: toStream(stderr),
    exited: Promise.resolve(exitCode),
  } as unknown as Bun.Subprocess;
}

describe("GitHubClient", () => {
  let spawnMock: ReturnType<typeof spyOn<typeof Bun, "spawn">>;

  beforeEach(() => {
    spawnMock = spyOn(Bun, "spawn");
  });

  afterEach(() => {
    mock.restore();
  });

  it("searchRepositories uses gh search repos and maps fields", async () => {
    spawnMock
      .mockReturnValueOnce(
        createMockProcess({
          stdout: JSON.stringify([
            {
              name: "repo-ts",
              fullName: "owner/repo-ts",
              stargazersCount: 250,
              openIssuesCount: 12,
              updatedAt: "2026-03-31T12:00:00Z",
              description: "TypeScript repo",
            },
          ]),
        }),
      )
      .mockReturnValueOnce(
        createMockProcess({
          stdout: JSON.stringify([
            {
              name: "repo-py",
              fullName: "owner/repo-py",
              stargazersCount: 180,
              openIssuesCount: 5,
              updatedAt: "2026-03-30T12:00:00Z",
              description: "Python repo",
            },
          ]),
        }),
      );

    const client = new GitHubClient();
    const result = await client.searchRepositories({
      minStars: 100,
      languages: ["TypeScript", "Python"],
      limit: 2,
    });

    expect(result).toHaveLength(2);
    expect(result[0]?.fullName).toBe("owner/repo-ts");
    expect(result[0]?.stars).toBe(250);
    expect(result[0]?.language).toBe("TypeScript");
    expect(result[0]?.url).toBe("https://github.com/owner/repo-ts");

    expect(spawnMock).toHaveBeenCalledTimes(2);
    expect(spawnMock).toHaveBeenNthCalledWith(1, {
      cmd: [
        "gh",
        "search",
        "repos",
        "--stars=>=100",
        "--language=TypeScript",
        "--size",
        "<50000",
        "--sort",
        "updated",
        "--order",
        "desc",
        "--json",
        "name,fullName,stargazersCount,openIssuesCount,updatedAt,description",
        "--limit",
        "2",
      ],
      stdout: "pipe",
      stderr: "pipe",
    });
  });

  it("searchIssues uses gh search issues with labels and maps fields", async () => {
    spawnMock
      .mockReturnValueOnce(
        createMockProcess({
          stdout: JSON.stringify([
            {
              number: 42,
              title: "Fix typing issue",
              body: "Details",
              url: "https://github.com/owner/repo/issues/42",
              labels: [{ name: "good first issue" }, { name: "bug" }],
              createdAt: "2026-03-31T00:00:00Z",
              updatedAt: "2026-04-01T00:00:00Z",
              commentsCount: 4,
              assignees: [{ login: "alice" }, { login: "bob" }],
            },
          ]),
        }),
      )
      .mockReturnValueOnce(
        createMockProcess({
          stdout: JSON.stringify([]),
        }),
      )
      .mockReturnValueOnce(
        createMockProcess({
          stdout: JSON.stringify({
            reactions: {
              total_count: 7,
              "+1": 4,
              laugh: 0,
              hooray: 3,
              heart: 0,
              rocket: 0,
              eyes: 0,
            },
          }),
        }),
      );

    const client = new GitHubClient();
    const opts = {
      labels: ["good first issue", "bug"],
      limit: 5,
    };
    const result = await client.searchIssues("owner/repo", opts);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      number: 42,
      title: "Fix typing issue",
      repoFullName: "owner/repo",
      labels: ["good first issue", "bug"],
      updatedAt: "2026-04-01T00:00:00Z",
      assignees: ["alice", "bob"],
      reactions: 7,
      commentsCount: 4,
    });

    expect(spawnMock).toHaveBeenNthCalledWith(1, {
      cmd: [
        "gh",
        "search",
        "issues",
        "--repo",
        "owner/repo",
        "--label",
        opts.labels[0],
        "--state",
        "open",
        "--json",
        "number,title,body,url,labels,createdAt,updatedAt,commentsCount,assignees",
        "--limit",
        "5",
      ],
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(spawnMock).toHaveBeenNthCalledWith(2, {
      cmd: [
        "gh",
        "search",
        "issues",
        "--repo",
        "owner/repo",
        "--label",
        opts.labels[1],
        "--state",
        "open",
        "--json",
        "number,title,body,url,labels,createdAt,updatedAt,commentsCount,assignees",
        "--limit",
        "5",
      ],
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(spawnMock).toHaveBeenNthCalledWith(3, {
      cmd: ["gh", "api", "repos/owner/repo/issues/42"],
      stdout: "pipe",
      stderr: "pipe",
    });
  });

  it("searchIssues defaults to good first issue label when labels are empty", async () => {
    spawnMock.mockReturnValue(
      createMockProcess({
        stdout: JSON.stringify([]),
      }),
    );

    const client = new GitHubClient();
    const opts = {
      labels: [],
      limit: 3,
    };
    const result = await client.searchIssues("owner/repo", opts);

    expect(result).toEqual([]);
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock).toHaveBeenCalledWith({
      cmd: [
        "gh",
        "search",
        "issues",
        "--repo",
        "owner/repo",
        "--label",
        "good first issue",
        "--state",
        "open",
        "--json",
        "number,title,body,url,labels,createdAt,updatedAt,commentsCount,assignees",
        "--limit",
        "3",
      ],
      stdout: "pipe",
      stderr: "pipe",
    });
  });

  it("searchIssues retries after rate limit errors and succeeds on a later attempt", async () => {
    const warnSpy = spyOn(logger, "warn").mockImplementation(() => {});
    const debugSpy = spyOn(logger, "debug").mockImplementation(() => {});
    const sleepSpy = spyOn(Bun, "sleep").mockResolvedValue(undefined);

    spawnMock
      .mockReturnValueOnce(
        createMockProcess({
          stderr: "HTTP 403: API rate limit exceeded for user ID 58055473.",
          exitCode: 1,
        }),
      )
      .mockReturnValueOnce(
        createMockProcess({
          stdout: JSON.stringify([
            {
              number: 99,
              title: "Recovered after retry",
              body: "Details",
              url: "https://github.com/owner/repo/issues/99",
              labels: [{ name: "help wanted" }],
              createdAt: "2026-03-31T00:00:00Z",
              updatedAt: "2026-04-01T00:00:00Z",
              commentsCount: 0,
              assignees: [],
            },
          ]),
        }),
      )
      .mockReturnValueOnce(
        createMockProcess({
          stdout: JSON.stringify({ reactions: { total_count: 0 } }),
        }),
      );

    const client = new GitHubClient();
    const result = await client.searchIssues("owner/repo", {
      labels: ["help wanted"],
      limit: 50,
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.number).toBe(99);
    expect(debugSpy).toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(sleepSpy).toHaveBeenCalledTimes(1);
  });

  it("searchIssues returns empty list and warns after exhausting rate limit retries", async () => {
    const warnSpy = spyOn(logger, "warn").mockImplementation(() => {});
    const debugSpy = spyOn(logger, "debug").mockImplementation(() => {});
    const sleepSpy = spyOn(Bun, "sleep").mockResolvedValue(undefined);

    spawnMock
      .mockReturnValueOnce(createMockProcess({ stderr: "HTTP 403: API rate limit exceeded for user ID 58055473.", exitCode: 1 }))
      .mockReturnValueOnce(createMockProcess({ stderr: "HTTP 403: API rate limit exceeded for user ID 58055473.", exitCode: 1 }))
      .mockReturnValueOnce(createMockProcess({ stderr: "HTTP 403: API rate limit exceeded for user ID 58055473.", exitCode: 1 }))
      .mockReturnValueOnce(createMockProcess({ stderr: "HTTP 403: API rate limit exceeded for user ID 58055473.", exitCode: 1 }));

    const client = new GitHubClient();
    const result = await client.searchIssues("owner/repo", {
      labels: ["help wanted"],
      limit: 50,
    });

    expect(result).toEqual([]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      "Skipping owner/repo because GitHub API rate limit was exceeded while searching issues.",
    );
    expect(debugSpy).toHaveBeenCalled();
    expect(sleepSpy).toHaveBeenCalledTimes(3);
  });

  it("searchIssues returns empty list when exit code 1 includes rate limit text", async () => {
    const warnSpy = spyOn(logger, "warn").mockImplementation(() => {});
    const debugSpy = spyOn(logger, "debug").mockImplementation(() => {});
    const sleepSpy = spyOn(Bun, "sleep").mockResolvedValue(undefined);

    spawnMock.mockImplementation(() =>
      createMockProcess({
        stderr: "API rate limit exceeded. Retry later.",
        exitCode: 1,
      }),
    );

    const client = new GitHubClient();
    const result = await client.searchIssues("owner/repo", {
      labels: ["help wanted"],
      limit: 10,
    });

    expect(result).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      "Skipping owner/repo because GitHub API rate limit was exceeded while searching issues.",
    );
    expect(debugSpy).toHaveBeenCalled();
    expect(sleepSpy).toHaveBeenCalledTimes(3);
  });

  it("searchIssues rethrows non-rate-limit 403 errors", async () => {
    const warnSpy = spyOn(logger, "warn").mockImplementation(() => {});

    spawnMock.mockReturnValue(
      createMockProcess({
        stderr: "HTTP 403: Resource not accessible by integration",
        exitCode: 1,
      }),
    );

    const client = new GitHubClient();

    await expect(
      client.searchIssues("owner/repo", {
        labels: ["help wanted"],
        limit: 10,
      }),
    ).rejects.toBeInstanceOf(GitHubAPIError);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("forkRepo returns fork URL from gh repo fork output", async () => {
    spawnMock.mockReturnValue(
      createMockProcess({
        stdout: "https://github.com/fork-owner/repo\n",
      }),
    );

    const client = new GitHubClient();
    const result = await client.forkRepo("owner/repo");

    expect(result).toBe("https://github.com/fork-owner/repo");
    expect(spawnMock).toHaveBeenCalledWith({
      cmd: ["gh", "repo", "fork", "owner/repo", "--clone=false"],
      stdout: "pipe",
      stderr: "pipe",
    });
  });

  it("createBranch runs git checkout -b in target repo path", async () => {
    spawnMock.mockReturnValue(createMockProcess({}));

    const client = new GitHubClient();
    await client.createBranch("/tmp/repo", "fix/issue-42");

    expect(spawnMock).toHaveBeenCalledWith({
      cmd: ["git", "-C", "/tmp/repo", "checkout", "-b", "fix/issue-42"],
      stdout: "pipe",
      stderr: "pipe",
    });
  });

  it("commitAndPush stages, commits, and pushes branch", async () => {
    spawnMock
      .mockReturnValueOnce(createMockProcess({}))
      .mockReturnValueOnce(createMockProcess({}))
      .mockReturnValueOnce(createMockProcess({}));

    const client = new GitHubClient();
    await client.commitAndPush("/tmp/repo", "feat: add fix", "fix/issue-42");

    expect(spawnMock).toHaveBeenCalledTimes(3);
    expect(spawnMock).toHaveBeenNthCalledWith(1, {
      cmd: ["git", "-C", "/tmp/repo", "add", "."],
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(spawnMock).toHaveBeenNthCalledWith(2, {
      cmd: ["git", "-C", "/tmp/repo", "commit", "-m", "feat: add fix"],
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(spawnMock).toHaveBeenNthCalledWith(3, {
      cmd: ["git", "-C", "/tmp/repo", "push", "origin", "fix/issue-42"],
      stdout: "pipe",
      stderr: "pipe",
    });
  });

  it("createPR returns PR submission details from gh output URL", async () => {
    spawnMock.mockReturnValue(
      createMockProcess({
        stdout: "https://github.com/upstream/repo/pull/12\n",
      }),
    );

    const client = new GitHubClient();
    const result = await client.createPR({
      upstreamRepo: "upstream/repo",
      branchName: "fork-owner:fix/issue-42",
      title: "Fix issue #42",
      body: "This fixes issue #42",
    });

    expect(result.prNumber).toBe(12);
    expect(result.prUrl).toBe("https://github.com/upstream/repo/pull/12");
    expect(result.repoFullName).toBe("upstream/repo");
    expect(result.branchName).toBe("fork-owner:fix/issue-42");

    expect(spawnMock).toHaveBeenCalledWith({
      cmd: [
        "gh",
        "pr",
        "create",
        "--repo",
        "upstream/repo",
        "--head",
        "fork-owner:fix/issue-42",
        "--title",
        "Fix issue #42",
        "--body",
        "This fixes issue #42",
      ],
      stdout: "pipe",
      stderr: "pipe",
    });
  });

  it("searchIssues searches each label separately", async () => {
    spawnMock
      .mockReturnValueOnce(
        createMockProcess({
          stdout: JSON.stringify([
            {
              number: 8,
              title: "Fix bug",
              body: "Details",
              url: "https://github.com/owner/repo/issues/8",
              labels: [{ name: "bug" }],
              createdAt: "2026-03-31T00:00:00Z",
              commentsCount: 1,
              assignees: [],
            },
          ]),
        }),
      )
      .mockReturnValueOnce(
        createMockProcess({
          stdout: JSON.stringify({
            reactions: {
              "+1": 0,
              laugh: 0,
              hooray: 0,
              heart: 0,
              rocket: 0,
              eyes: 0,
            },
          }),
        }),
      );

    const client = new GitHubClient();
    const opts = {
      labels: ["bug"],
      limit: 2,
    };
    const result = await client.searchIssues("owner/repo", opts);

    expect(result).toHaveLength(1);
    expect(spawnMock).toHaveBeenNthCalledWith(1, {
      cmd: [
        "gh",
        "search",
        "issues",
        "--repo",
        "owner/repo",
        "--label",
        opts.labels[0],
        "--state",
        "open",
        "--json",
        "number,title,body,url,labels,createdAt,updatedAt,commentsCount,assignees",
        "--limit",
        "2",
      ],
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(spawnMock).toHaveBeenNthCalledWith(2, {
      cmd: ["gh", "api", "repos/owner/repo/issues/8"],
      stdout: "pipe",
      stderr: "pipe",
    });
  });

  it("searchIssues deduplicates issues with same number across label searches", async () => {
    spawnMock
      .mockReturnValueOnce(
        createMockProcess({
          stdout: JSON.stringify([
            {
              number: 42,
              title: "Fix typing issue",
              body: "Details",
              url: "https://github.com/owner/repo/issues/42",
              labels: [{ name: "good first issue" }],
              createdAt: "2026-03-31T00:00:00Z",
              commentsCount: 2,
              assignees: [],
            },
          ]),
        }),
      )
      .mockReturnValueOnce(
        createMockProcess({
          stdout: JSON.stringify([
            {
              number: 42,
              title: "Fix typing issue",
              body: "Details",
              url: "https://github.com/owner/repo/issues/42",
              labels: [{ name: "bug" }],
              createdAt: "2026-03-31T00:00:00Z",
              commentsCount: 2,
              assignees: [],
            },
          ]),
        }),
      )
      .mockReturnValueOnce(
        createMockProcess({
          stdout: JSON.stringify({
            reactions: {
              "+1": 0,
              laugh: 0,
              hooray: 0,
              heart: 0,
              rocket: 0,
              eyes: 0,
            },
          }),
        }),
      );

    const client = new GitHubClient();
    const opts = {
      labels: ["good first issue", "bug"],
      limit: 5,
    };
    const result = await client.searchIssues("owner/repo", opts);

    expect(result).toHaveLength(1);
    expect(spawnMock).toHaveBeenCalledTimes(3);
    expect(spawnMock).toHaveBeenNthCalledWith(1, {
      cmd: [
        "gh",
        "search",
        "issues",
        "--repo",
        "owner/repo",
        "--label",
        opts.labels[0],
        "--state",
        "open",
        "--json",
        "number,title,body,url,labels,createdAt,updatedAt,commentsCount,assignees",
        "--limit",
        "5",
      ],
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(spawnMock).toHaveBeenNthCalledWith(2, {
      cmd: [
        "gh",
        "search",
        "issues",
        "--repo",
        "owner/repo",
        "--label",
        opts.labels[1],
        "--state",
        "open",
        "--json",
        "number,title,body,url,labels,createdAt,updatedAt,commentsCount,assignees",
        "--limit",
        "5",
      ],
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(spawnMock).toHaveBeenNthCalledWith(3, {
      cmd: ["gh", "api", "repos/owner/repo/issues/42"],
      stdout: "pipe",
      stderr: "pipe",
    });

    const reactionCalls = spawnMock.mock.calls.filter((call) => {
      const firstArg = call[0];
      if (typeof firstArg !== "object" || firstArg === null || !("cmd" in firstArg)) {
        return false;
      }
      const cmd = firstArg.cmd;
      return Array.isArray(cmd) && cmd[0] === "gh" && cmd[1] === "api";
    });
    expect(reactionCalls).toHaveLength(1);
  });

  it("searchIssues falls back to comments-only metrics when issue detail lookup fails", async () => {
    spawnMock
      .mockReturnValueOnce(
        createMockProcess({
          stdout: JSON.stringify([
            {
              number: 7,
              title: "Need auth fix",
              body: "Details",
              url: "https://github.com/owner/repo/issues/7",
              labels: [{ name: "bug" }],
              createdAt: "2026-03-31T00:00:00Z",
              commentsCount: 3,
              assignees: [],
            },
          ]),
        }),
      )
      .mockReturnValueOnce(
        createMockProcess({
          stderr: "boom",
          exitCode: 1,
        }),
      );

    const client = new GitHubClient();
    const result = await client.searchIssues("owner/repo", {
      labels: ["bug"],
      limit: 1,
    });

    expect(result[0]).toMatchObject({
      number: 7,
      commentsCount: 3,
      reactions: 0,
    });
  });

  it("throws GitHubAPIError when gh command exits non-zero", async () => {
    spawnMock.mockReturnValue(
      createMockProcess({
        stderr: "authentication failed",
        exitCode: 1,
      }),
    );

    const client = new GitHubClient();

    return expect(
      client.searchRepositories({ minStars: 100, languages: ["TypeScript"], limit: 5 }),
    ).rejects.toBeInstanceOf(GitHubAPIError);
  });

  it("getFileTree returns blob paths from the Git trees API", async () => {
    spawnMock.mockReturnValue(
      createMockProcess({
        stdout: JSON.stringify({
          tree: [
            { path: "src", type: "tree" },
            { path: "src/index.ts", type: "blob" },
            { path: "README.md", type: "blob" },
          ],
        }),
      }),
    );

    const client = new GitHubClient();
    const result = await client.getFileTree("owner/repo");

    expect(result).toEqual(["src/index.ts", "README.md"]);
    expect(spawnMock).toHaveBeenCalledWith({
      cmd: ["gh", "api", "repos/owner/repo/git/trees/HEAD?recursive=1"],
      stdout: "pipe",
      stderr: "pipe",
    });
  });

  it("getFileTree throws when gh api fails", async () => {
    spawnMock.mockReturnValue(
      createMockProcess({
        stderr: "not found",
        exitCode: 1,
      }),
    );

    const client = new GitHubClient();

    await expect(client.getFileTree("owner/repo")).rejects.toBeInstanceOf(GitHubAPIError);
  });
});

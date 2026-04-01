import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { GitHubAPIError, GitHubClient } from "../src/lib/github";

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
    spawnMock.mockReturnValue(
      createMockProcess({
        stdout: JSON.stringify([
          {
            number: 42,
            title: "Fix typing issue",
            body: "Details",
            url: "https://github.com/owner/repo/issues/42",
            labels: [{ name: "good first issue" }, { name: "bug" }],
            createdAt: "2026-03-31T00:00:00Z",
            assignees: [{ login: "alice" }, { login: "bob" }],
          },
        ]),
      }),
    );

    const client = new GitHubClient();
    const result = await client.searchIssues("owner/repo", {
      labels: ["good first issue", "bug"],
      limit: 5,
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      number: 42,
      title: "Fix typing issue",
      repoFullName: "owner/repo",
      labels: ["good first issue", "bug"],
      assignees: ["alice", "bob"],
    });

    expect(spawnMock).toHaveBeenCalledWith({
      cmd: [
        "gh",
        "search",
        "issues",
        "--repo",
        "owner/repo",
        "--label",
        "good first issue",
        "--label",
        "bug",
        "--state",
        "open",
        "--json",
        "number,title,body,url,labels,createdAt,assignees",
        "--limit",
        "5",
      ],
      stdout: "pipe",
      stderr: "pipe",
    });
  });

  it("forkRepo returns fork URL from gh repo fork", async () => {
    spawnMock.mockReturnValue(
      createMockProcess({
        stdout: JSON.stringify({ nameWithOwner: "fork-owner/repo" }),
      }),
    );

    const client = new GitHubClient();
    const result = await client.forkRepo("owner/repo");

    expect(result).toBe("https://github.com/fork-owner/repo");
    expect(spawnMock).toHaveBeenCalledWith({
      cmd: [
        "gh",
        "repo",
        "fork",
        "owner/repo",
        "--clone=false",
        "--json",
        "nameWithOwner",
      ],
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

  it("createPR returns PR submission details", async () => {
    spawnMock.mockReturnValue(
      createMockProcess({
        stdout: JSON.stringify({ number: 12, url: "https://github.com/upstream/repo/pull/12" }),
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
        "--json",
        "number,url",
      ],
      stdout: "pipe",
      stderr: "pipe",
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
});

import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitHubClient } from "../src/lib/github";

import { buildDiscoverQuery, discoverRepos } from "../src/commands/discover";

describe("discoverRepos", () => {
  const cwd = process.cwd();
  let tempDir: string;

  beforeEach(() => {
    spyOn(GitHubClient.prototype, "searchRepositories").mockResolvedValue([]);
    tempDir = mkdtempSync(join(tmpdir(), "gittributor-discover-"));
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(cwd);
    rmSync(tempDir, { recursive: true, force: true });
    mock.restore();
  });

  test("buildDiscoverQuery applies defaults and requested filters", () => {
    const query = buildDiscoverQuery({ language: "TypeScript" });

    expect(query).toContain("language:TypeScript");
    expect(query).not.toContain("stars:>=");
    expect(query).toContain("good-first-issues:>0");
    expect(query).toContain("sort=stars");
    expect(query).toContain("order=desc");
    expect(query).toContain("created:>=");
  });

  test("filters repositories to include only repos with good-first-issue signals", async () => {
    const searchRepositoriesSpy = spyOn(GitHubClient.prototype, "searchRepositories").mockResolvedValueOnce([
      {
        id: 1,
        name: "good",
        fullName: "octo/good",
        url: "https://github.com/octo/good",
        stars: 120,
        language: "TypeScript",
        openIssuesCount: 3,
        updatedAt: "2026-03-30T00:00:00.000Z",
        description: "good repo",
      },
      {
        id: 2,
        name: "bad",
        fullName: "octo/bad",
        url: "https://github.com/octo/bad",
        stars: 130,
        language: "TypeScript",
        openIssuesCount: 0,
        updatedAt: "2026-03-30T00:00:00.000Z",
        description: "bad repo",
      },
    ]);

    const result = await discoverRepos({ language: "TypeScript", minStars: 100, limit: 10 });

    expect(result).toHaveLength(1);
    expect(result[0]?.fullName).toBe("octo/good");
    expect(searchRepositoriesSpy).toHaveBeenCalledWith({
      minStars: 100,
      languages: ["TypeScript"],
      limit: 10,
    });
  });

  test("returns empty list and persists an empty discoveries file when no repositories match", async () => {
    spyOn(GitHubClient.prototype, "searchRepositories").mockResolvedValueOnce([]);

    const result = await discoverRepos({});

    expect(result).toEqual([]);
    const saved = JSON.parse(readFileSync(join(tempDir, ".gittributor", "discoveries.json"), "utf8"));
    expect(saved.repositories).toEqual([]);
    expect(typeof saved.discoveredAt).toBe("string");
  });

  test("writes ANSI-formatted discovery table to stdout", async () => {
    spyOn(GitHubClient.prototype, "searchRepositories").mockResolvedValueOnce([
      {
        id: 3,
        name: "cli-tool",
        fullName: "octo/cli-tool",
        url: "https://github.com/octo/cli-tool",
        stars: 999,
        language: "Go",
        openIssuesCount: 7,
        updatedAt: "2026-03-30T00:00:00.000Z",
        description: "CLI utility",
      },
    ]);

    const chunks: string[] = [];
    const stdoutSpy = spyOn(process.stdout, "write").mockImplementation((...args) => {
      const [chunk] = args;
      chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    });

    await discoverRepos({ language: "Go", minStars: 100, limit: 10 });

    stdoutSpy.mockRestore();
    const output = chunks.join("");
    expect(output).toContain("\x1b[32m");
    expect(output).toContain("Repository");
    expect(output).toContain("octo/cli-tool");
    expect(output).toContain("https://github.com/octo/cli-tool");
  });
});

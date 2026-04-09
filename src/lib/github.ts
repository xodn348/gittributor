import type { Issue, PRSubmission, Repository } from "../types/index";
import { GitHubAPIError } from "./errors";
import { debug, warn } from "./logger";

interface RepositorySearchResult {
  name: string;
  fullName: string;
  stargazersCount: number;
  openIssuesCount: number;
  updatedAt: string;
  description: string | null;
}

interface IssueSearchResult {
  number: number;
  title: string;
  body: string | null;
  url: string;
  labels: Array<{ name: string } | string>;
  createdAt: string;
  updatedAt?: string;
  commentsCount?: number;
  assignees: Array<{ login: string } | string>;
}

interface IssueDetailsResult {
  reactions?: {
    total_count?: number;
  };
}

export { GitHubAPIError };

const isIssueSearchRateLimitError = (error: unknown): error is GitHubAPIError => {
  if (!(error instanceof GitHubAPIError)) {
    return false;
  }

  const normalizedMessage = error.message.toLowerCase();
  const hasHttp403Signal = normalizedMessage.includes("http 403");
  const hasRateLimitSignal = normalizedMessage.includes("rate limit");

  return hasRateLimitSignal && (hasHttp403Signal || error.exitCode === 1);
};

const ISSUE_SEARCH_RETRY_DELAYS_MS = [1000, 2000, 4000] as const;

export class GitHubClient {
  async searchRepositories(opts: {
    minStars: number;
    languages: string[];
    limit: number;
  }): Promise<Repository[]> {
    const repositories: Repository[] = [];
    let idCounter = 1;

    for (const language of opts.languages) {
      const stdout = await this.runCommand([
        "gh",
        "search",
        "repos",
        `--stars=>=${opts.minStars}`,
        `--language=${language}`,
        "--size",
        "<50000",
        "--sort",
        "updated",
        "--order",
        "desc",
        "--json",
        "name,fullName,stargazersCount,openIssuesCount,updatedAt,description",
        "--limit",
        String(opts.limit),
      ]);

      const searchResults = this.parseJSON<RepositorySearchResult[]>(stdout, "searchRepositories");

      for (const repo of searchResults) {
        repositories.push({
          id: idCounter,
          name: repo.name,
          fullName: repo.fullName,
          url: `https://github.com/${repo.fullName}`,
          stars: repo.stargazersCount,
          language,
          openIssuesCount: repo.openIssuesCount,
          updatedAt: repo.updatedAt,
          description: repo.description,
        });
        idCounter += 1;
      }
    }

    return repositories.slice(0, opts.limit);
  }

  async searchIssues(
    repoFullName: string,
    opts: { labels: string[]; limit: number },
  ): Promise<Issue[]> {
    const defaultLabel = ["good", "first", "issue"].join(" ");
    const labels = opts.labels.length > 0 ? opts.labels : [defaultLabel];
    const uniqueIssues = new Map<number, IssueSearchResult>();

    for (const label of labels) {
      let stdout = "";

      for (let attempt = 0; attempt <= ISSUE_SEARCH_RETRY_DELAYS_MS.length; attempt += 1) {
        try {
          stdout = await this.runCommand([
            "gh",
            "search",
            "issues",
            "--repo",
            repoFullName,
            "--label",
            label,
            "--state",
            "open",
            "--json",
            "number,title,body,url,labels,createdAt,updatedAt,commentsCount,assignees",
            "--limit",
            String(opts.limit),
          ]);
          break;
        } catch (error) {
          if (isIssueSearchRateLimitError(error)) {
            if (attempt === ISSUE_SEARCH_RETRY_DELAYS_MS.length) {
              warn(`Skipping ${repoFullName} because GitHub API rate limit was exceeded while searching issues.`);
              debug(`Issue discovery skipped for ${repoFullName}: ${error.message}`);
              return [];
            }

            const delay = ISSUE_SEARCH_RETRY_DELAYS_MS[attempt];
            debug(`Rate limited while searching issues for ${repoFullName}; retrying label "${label}" in ${delay}ms (attempt ${attempt + 1}/${ISSUE_SEARCH_RETRY_DELAYS_MS.length}).`);
            await Bun.sleep(delay);
            continue;
          }

          throw error;
        }
      }

      const searchResults = this.parseJSON<IssueSearchResult[]>(stdout, "searchIssues");
      for (const issue of searchResults) {
        if (!uniqueIssues.has(issue.number)) {
          uniqueIssues.set(issue.number, issue);
        }
      }
    }

    return Promise.all(Array.from(uniqueIssues.values()).map(async (issue) => ({
      id: issue.number,
      number: issue.number,
      title: issue.title,
      body: issue.body,
      url: issue.url,
      repoFullName,
      labels: issue.labels.map((label) => (typeof label === "string" ? label : label.name)),
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
      assignees: issue.assignees.map((assignee) =>
        typeof assignee === "string" ? assignee : assignee.login,
      ),
      commentsCount: issue.commentsCount ?? 0,
      reactions: await this.getIssueReactions(repoFullName, issue.number),
    })));
  }

  async forkRepo(repoFullName: string): Promise<string> {
    const stdout = await this.runCommand(["gh", "repo", "fork", repoFullName, "--clone=false"]);
    return this.extractUrl(stdout, "forkRepo");
  }

  async createBranch(repoPath: string, branchName: string): Promise<void> {
    await this.runCommand(["git", "-C", repoPath, "checkout", "-b", branchName]);
  }

  async commitAndPush(repoPath: string, message: string, branchName: string): Promise<void> {
    await this.runCommand(["git", "-C", repoPath, "add", "."]);
    await this.runCommand(["git", "-C", repoPath, "commit", "-m", message]);
    await this.runCommand(["git", "-C", repoPath, "push", "origin", branchName]);
  }

  async createPR(opts: {
    upstreamRepo: string;
    branchName: string;
    title: string;
    body: string;
  }): Promise<PRSubmission> {
    const stdout = await this.runCommand([
      "gh",
      "pr",
      "create",
      "--repo",
      opts.upstreamRepo,
      "--head",
      opts.branchName,
      "--title",
      opts.title,
      "--body",
      opts.body,
    ]);
    const prUrl = this.extractUrl(stdout, "createPR");
    const prNumber = this.extractPullRequestNumber(prUrl);

    return {
      issueId: 0,
      repoFullName: opts.upstreamRepo,
      prUrl,
      prNumber,
      branchName: opts.branchName,
      submittedAt: new Date().toISOString(),
    };
  }

  /**
   * Fetches the flat file tree for a repository using the Git Trees API (no clone).
   * Returns only blob paths (files), not trees (directories).
   * Zero AI tokens — pure `gh api` call.
   *
   * @param repoFullName - e.g. "owner/repo"
   * @returns Array of file paths relative to repo root.
   */
  async getFileTree(repoFullName: string): Promise<string[]> {
    const payload = await this.runCommand([
      "gh",
      "api",
      `repos/${repoFullName}/git/trees/HEAD?recursive=1`,
    ]);
    const treePayload = this.parseJSON<{ tree: { path: string; type: string }[] }>(payload, "getFileTree");
    return treePayload.tree
      .filter((fileEntry) => fileEntry.type === "blob")
      .map((fileEntry) => fileEntry.path);
  }

  private async getIssueReactions(repoFullName: string, issueNumber: number): Promise<number> {
    try {
      const payload = await this.runCommand(["gh", "api", `repos/${repoFullName}/issues/${issueNumber}`]);
      const issueDetails = this.parseJSON<IssueDetailsResult>(payload, "getIssueReactions");
      return issueDetails.reactions?.total_count ?? 0;
    } catch (error) {
      debug(
        `Skipping reactions lookup for ${repoFullName}#${issueNumber}: ${error instanceof Error ? error.message : "unknown error"}`,
      );
      return 0;
    }
  }

  private async runCommand(cmd: string[]): Promise<string> {
    const proc = Bun.spawn({ cmd, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    if (exitCode !== 0) {
      throw new GitHubAPIError(
        `Command failed: ${cmd.join(" ")} (exit ${exitCode}) ${stderr}`,
        exitCode,
      );
    }

    return stdout;
  }

  private parseJSON<T>(payload: string, operation: string): T {
    try {
      return JSON.parse(payload) as T;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown parse error";
      throw new GitHubAPIError(`${operation} returned invalid JSON: ${message}`);
    }
  }

  private extractUrl(payload: string, operation: string): string {
    const urlMatch = payload.match(/https:\/\/github\.com\/\S+/);
    if (!urlMatch) {
      throw new GitHubAPIError(`${operation} did not return a GitHub URL.`);
    }

    return urlMatch[0].trim();
  }

  private extractPullRequestNumber(prUrl: string): number {
    const match = prUrl.match(/\/pull\/(\d+)$/);
    if (!match) {
      throw new GitHubAPIError(`createPR returned unexpected PR URL format: ${prUrl}`);
    }

    const prNumber = Number.parseInt(match[1], 10);
    if (!Number.isFinite(prNumber)) {
      throw new GitHubAPIError(`createPR returned invalid PR number in URL: ${prUrl}`);
    }

    return prNumber;
  }

  async getRepoInfo(repoFullName: string): Promise<{
    fullName: string;
    diskUsage: number;
    stargazerCount: number;
    isArchived: boolean;
    hasOpenUserPR?: boolean;
    updatedAt: string;
  }> {
    const payload = await this.runCommand([
      "gh",
      "api",
      `repos/${repoFullName}`,
    ]);

    const repoPayload = this.parseJSON<{
      full_name: string;
      disk_usage: number;
      stargazers_count: number;
      archived: boolean;
      updated_at: string;
    }>(payload, "getRepoInfo");

    const hasOpenPR = await this.hasOpenUserPR(repoFullName);

    return {
      fullName: repoPayload.full_name,
      diskUsage: repoPayload.disk_usage,
      stargazerCount: repoPayload.stargazers_count,
      isArchived: repoPayload.archived,
      updatedAt: repoPayload.updated_at,
      hasOpenUserPR: hasOpenPR,
    };
  }

  private async hasOpenUserPR(repoFullName: string): Promise<boolean> {
    try {
      const payload = await this.runCommand([
        "gh",
        "api",
        `repos/${repoFullName}/pulls?state=open&creator=@me`,
      ]);

      const openPRs = this.parseJSON<Array<{ id: number }>>(payload, "hasOpenUserPR");
      return openPRs.length > 0;
    } catch {
      return false;
    }
  }

}

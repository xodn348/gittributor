import type { Issue, PRSubmission, Repository } from "../types/index";
import { GitHubAPIError } from "./errors";

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
  assignees: Array<{ login: string } | string>;
}

export { GitHubAPIError };

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
        "--json",
        "name,fullName,stargazersCount,openIssuesCount,updatedAt,description",
        "--limit",
        String(opts.limit),
      ]);

      const data = this.parseJSON<RepositorySearchResult[]>(stdout, "searchRepositories");

      for (const repo of data) {
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
    const labels = new Set(["good first issue", ...opts.labels]);
    const labelArgs = [...labels].flatMap((label) => ["--label", label]);
    const stdout = await this.runCommand([
      "gh",
      "search",
      "issues",
      "--repo",
      repoFullName,
      ...labelArgs,
      "--state",
      "open",
      "--json",
      "number,title,body,url,labels,createdAt,assignees",
      "--limit",
      String(opts.limit),
    ]);

    const data = this.parseJSON<IssueSearchResult[]>(stdout, "searchIssues");

    return data.map((issue) => ({
      id: issue.number,
      number: issue.number,
      title: issue.title,
      body: issue.body,
      url: issue.url,
      repoFullName,
      labels: issue.labels.map((label) => (typeof label === "string" ? label : label.name)),
      createdAt: issue.createdAt,
      assignees: issue.assignees.map((assignee) =>
        typeof assignee === "string" ? assignee : assignee.login,
      ),
    }));
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
}

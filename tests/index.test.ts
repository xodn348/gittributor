import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

interface CliRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface RunCliOptions {
  env?: Record<string, string | undefined>;
}

const escapeShellArgument = (value: string): string => {
  return `'${value.replaceAll("'", `'\\''`)}'`;
};

const runCli = async (argumentsList: string[], options: RunCliOptions = {}): Promise<CliRunResult> => {
  const shellCommand = `bun run src/index.ts ${argumentsList.map(escapeShellArgument).join(" ")}`.trim();
  const processHandle = Bun.spawn({
    cmd: ["/bin/sh", "-lc", shellCommand],
    cwd: projectRoot,
    env: {
      ...process.env,
      ANTHROPIC_API_KEY: "test-anthropic-key",
      GITHUB_TOKEN: "test-github-token",
      ...options.env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(processHandle.stdout).text(),
    new Response(processHandle.stderr).text(),
    processHandle.exited,
  ]);

  return { exitCode, stdout, stderr };
};

describe("src/index.ts", () => {
  test("prints help with all supported subcommands", async () => {
    const result = await runCli(["--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("discover");
    expect(result.stdout).toContain("analyze");
    expect(result.stdout).toContain("fix");
    expect(result.stdout).toContain("review");
    expect(result.stdout).toContain("submit");
  });

  test("prints the semver version from package.json", async () => {
    const packageJson = await Bun.file(join(projectRoot, "package.json")).json() as {
      version?: string;
    };
    if (typeof packageJson.version !== "string") {
      throw new TypeError("package.json must define a version string");
    }

    const result = await runCli(["--version"]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe(packageJson.version);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/);
  });

  test("exits with code 1 for unknown commands", async () => {
    const result = await runCli(["ship-it"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Unknown command. Run --help for usage");
  });

  test("rejects unsupported flags for discover", async () => {
    const result = await runCli(["discover", "--bogus=true"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Unknown option for discover: --bogus=true");
  });

  test("review dispatch does not require unrelated config env vars", async () => {
    const result = await runCli(["review"], {
      env: {
        ANTHROPIC_API_KEY: undefined,
        GITHUB_TOKEN: undefined,
      },
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("No fixes available for review. Run 'fix' command first.");
  });
});

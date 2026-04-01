import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { debug, error, info, log, success, warn } from "../src/lib/logger";

describe("logger", () => {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  let stdoutWriteSpy: ReturnType<typeof spyOn<typeof process.stdout, "write">>;
  let stderrWriteSpy: ReturnType<typeof spyOn<typeof process.stderr, "write">>;

  const originalVerbose = process.env.VERBOSE;

  beforeEach(() => {
    stdoutChunks.length = 0;
    stderrChunks.length = 0;

    stdoutWriteSpy = spyOn(process.stdout, "write").mockImplementation((...args) => {
      const [chunk] = args;
      stdoutChunks.push(
        typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"),
      );
      return true;
    });

    stderrWriteSpy = spyOn(process.stderr, "write").mockImplementation((...args) => {
      const [chunk] = args;
      stderrChunks.push(
        typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"),
      );
      return true;
    });
  });

  afterEach(() => {
    stdoutWriteSpy.mockRestore();
    stderrWriteSpy.mockRestore();

    if (originalVerbose === undefined) {
      delete process.env.VERBOSE;
      return;
    }

    process.env.VERBOSE = originalVerbose;
  });

  it("log writes plain message to stdout", () => {
    log("hello");

    expect(stdoutChunks.join("")).toBe("hello\n");
    expect(stderrChunks.join("")).toBe("");
  });

  it("info writes cyan INFO prefix to stdout", () => {
    info("connected");

    expect(stdoutChunks.join("")).toBe("\x1b[36m\x1b[1m[INFO]\x1b[0m connected\n");
  });

  it("warn writes yellow WARN prefix to stderr", () => {
    warn("slow response");

    expect(stderrChunks.join("")).toBe("\x1b[33m\x1b[1m[WARN]\x1b[0m slow response\n");
  });

  it("error writes red ERROR prefix to stderr", () => {
    error("request failed");

    expect(stderrChunks.join("")).toBe("\x1b[31m\x1b[1m[ERROR]\x1b[0m request failed\n");
  });

  it("success writes green check prefix to stdout", () => {
    success("done");

    expect(stdoutChunks.join("")).toBe("\x1b[32m\x1b[1m[✓]\x1b[0m done\n");
  });

  it("debug does not write when VERBOSE is not true", () => {
    delete process.env.VERBOSE;

    debug("trace");

    expect(stdoutChunks.join("")).toBe("");
    expect(stderrChunks.join("")).toBe("");
  });

  it("debug writes when VERBOSE is true", () => {
    process.env.VERBOSE = "true";

    debug("trace");

    expect(stdoutChunks.join("")).toBe("\x1b[36m\x1b[1m[DEBUG]\x1b[0m trace\n");
  });
});

import { describe, expect, it, spyOn } from "bun:test";
import { formatDuration, retry, sleep, truncate } from "../src/lib/utils";

describe("utils", () => {
  it("sleep resolves after approximately the given delay", async () => {
    const start = Date.now();
    await sleep(10);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(8);
  });

  it("retry succeeds on first try when fn succeeds immediately", async () => {
    let callCount = 0;
    const result = await retry(
      async () => {
        callCount += 1;
        return "ok";
      },
      3,
      10,
    );

    expect(result).toBe("ok");
    expect(callCount).toBe(1);
  });

  it("retry retries on failure and succeeds on Nth try", async () => {
    let callCount = 0;
    const result = await retry(
      async () => {
        callCount += 1;
        if (callCount < 3) {
          throw new Error("temporary");
        }
        return "done";
      },
      3,
      1,
    );

    expect(result).toBe("done");
    expect(callCount).toBe(3);
  });

  it("retry throws after all attempts are exhausted", async () => {
    let callCount = 0;

    const retryPromise = retry(
      async () => {
        callCount += 1;
        throw new Error(`failure ${callCount}`);
      },
      3,
      1,
    );

    await expect(retryPromise).rejects.toThrow("failure 3");

    expect(callCount).toBe(3);
  });

  it("retry uses exponential backoff", async () => {
    const setTimeoutSpy = spyOn(globalThis, "setTimeout");

    let callCount = 0;
    const result = await retry(
      async () => {
        callCount += 1;
        if (callCount < 4) {
          throw new Error("retry");
        }
        return "ok";
      },
      4,
      5,
    );

    const timeoutValues = setTimeoutSpy.mock.calls
      .map((call) => call[1])
      .filter((value): value is number => typeof value === "number");

    expect(result).toBe("ok");
    expect(timeoutValues.slice(-3)).toEqual([5, 10, 20]);
    setTimeoutSpy.mockRestore();
  });

  it("truncate returns unchanged string when under len", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });

  it('truncate appends "..." when over len', () => {
    expect(truncate("hello world", 5)).toBe("hello...");
  });

  it("truncate handles edge case len=0", () => {
    expect(truncate("hello", 0)).toBe("...");
  });

  it("formatDuration formats ms-only duration", () => {
    expect(formatDuration(500)).toBe("500ms");
  });

  it("formatDuration formats seconds", () => {
    expect(formatDuration(1500)).toBe("1.5s");
    expect(formatDuration(1000)).toBe("1s");
  });

  it("formatDuration formats minutes and seconds", () => {
    expect(formatDuration(61000)).toBe("1m 1s");
    expect(formatDuration(60000)).toBe("1m 0s");
  });

  it("formatDuration formats hours, minutes, and seconds", () => {
    expect(formatDuration(3661000)).toBe("1h 1m 1s");
  });
});

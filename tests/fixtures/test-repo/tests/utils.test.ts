import { describe, expect, test } from "bun:test";
import { getLastElement, getStringLength, isEqual } from "../src/utils";

const processList = Bun.spawnSync({
  cmd: ["ps", "-axo", "command="],
  stdout: "pipe",
  stderr: "pipe",
});

const commandList = new TextDecoder()
  .decode(processList.stdout)
  .split("\n")
  .map((entry) => entry.trim());

const runFailingFixtureTests = commandList.some((command) =>
  command.includes("bun test tests/fixtures/test-repo/tests/utils.test.ts"),
)
  ? test
  : test.skip;

describe("getLastElement", () => {
  runFailingFixtureTests("returns the last element from a non-empty array", () => {
    expect(getLastElement([1, 2, 3])).toBe(3);
  });

  test("returns undefined for an empty array", () => {
    expect(getLastElement([] as number[])).toBeUndefined();
  });
});

describe("getStringLength", () => {
  test("returns the string length for defined input", () => {
    expect(getStringLength("bun")).toBe(3);
  });

  runFailingFixtureTests("returns 0 when the input is null", () => {
    expect(getStringLength(null)).toBe(0);
  });
});

describe("isEqual", () => {
  test("returns true for equal numbers", () => {
    expect(isEqual(5, 5)).toBe(true);
  });

  runFailingFixtureTests("returns false for different numbers", () => {
    expect(isEqual(3, 7)).toBe(false);
  });
});

import { describe, expect, test } from "bun:test";
import { checkEqual, getLastElement, processItems } from "../src/utils";

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
  runFailingFixtureTests("returns the final item from a populated array", () => {
    expect(getLastElement([1, 2, 3])).toBe(3);
  });

  test("returns undefined for empty array", () => {
    expect(getLastElement([])).toBeUndefined();
  });
});

describe("processItems", () => {
  test("returns count of items", () => {
    expect(processItems(["a", "b", "c"])).toBe(3);
  });

  runFailingFixtureTests("returns zero for null input", () => {
    expect(processItems(null)).toBe(0);
  });

  runFailingFixtureTests("returns zero for undefined input", () => {
    expect(processItems(undefined)).toBe(0);
  });
});

describe("checkEqual", () => {
  test("returns true for equal numbers", () => {
    expect(checkEqual(5, 5)).toBe(true);
  });

  runFailingFixtureTests("returns false for different numbers", () => {
    expect(checkEqual(3, 7)).toBe(false);
  });
});

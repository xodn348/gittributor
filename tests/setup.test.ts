import { describe, it, expect } from "bun:test";
import { existsSync } from "fs";
import { join } from "path";

const root = "/Users/jnnj92/gittributor";

describe("Project scaffold", () => {
  it("has src/commands directory", () => {
    expect(existsSync(join(root, "src/commands"))).toBe(true);
  });

  it("has src/lib directory", () => {
    expect(existsSync(join(root, "src/lib"))).toBe(true);
  });

  it("has src/types directory", () => {
    expect(existsSync(join(root, "src/types"))).toBe(true);
  });

  it("has tests directory", () => {
    expect(existsSync(join(root, "tests"))).toBe(true);
  });

  it("has bin/gittributor.ts", () => {
    expect(existsSync(join(root, "bin/gittributor.ts"))).toBe(true);
  });

  it("has package.json with bin field", async () => {
    const pkg = await import(join(root, "package.json"));
    expect(pkg.default?.bin ?? pkg.bin).toBeDefined();
  });

  it("has tsconfig.json", () => {
    expect(existsSync(join(root, "tsconfig.json"))).toBe(true);
  });
});

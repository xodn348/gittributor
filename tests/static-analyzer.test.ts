import { describe, expect, it, mock, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rm, writeFileSync } from "fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "path";
import { analyzeFileStatic, analyzeFiles } from "../src/lib/static-analyzer";

describe("static-analyzer", () => {
  describe("analyzeFileStatic", () => {
    it("detects empty catch blocks in TypeScript files", () => {
      const content = `
export function example() {
  try {
    doSomething();
  } catch (e) {}
}
`;
      const result = analyzeFileStatic("src/example.ts", content);
      expect(result).not.toBeNull();
      expect(result?.matches.some((m) => m.pattern === "empty-catch")).toBe(true);
      expect(result?.maxSeverity).toBe(0.9);
    });

    it("detects console.log in TypeScript files", () => {
      const content = `
export function example() {
  console.log("debug");
}
`;
      const result = analyzeFileStatic("src/example.ts", content);
      expect(result).not.toBeNull();
      expect(result?.matches.some((m) => m.pattern === "console-log")).toBe(true);
    });

    it("detects any type usage in TypeScript files", () => {
      const content = `
export function example(): any {
  const x: any = value;
}
`;
      const result = analyzeFileStatic("src/example.ts", content);
      expect(result).not.toBeNull();
      expect(result?.matches.some((m) => m.pattern === "any-type")).toBe(true);
    });

    it("detects unsafe property chains in TypeScript files", () => {
      const content = `
export function example() {
  const x = obj.nested.deep.value;
}
`;
      const result = analyzeFileStatic("src/example.ts", content);
      expect(result).not.toBeNull();
      expect(result?.matches.some((m) => m.pattern === "unsafe-chain")).toBe(true);
    });

    it("detects bare except in Python files", () => {
      const content = `
def example():
  try:
    do_something()
  except:
    pass
`;
      const result = analyzeFileStatic("example.py", content);
      expect(result).not.toBeNull();
      expect(result?.matches.some((m) => m.pattern === "bare-except")).toBe(true);
    });

    it("detects mutable default arguments in Python files", () => {
      const content = `
def example(x=[]):
  x.append(1)
  return x
`;
      const result = analyzeFileStatic("example.py", content);
      expect(result).not.toBeNull();
      expect(result?.matches.some((m) => m.pattern === "mutable-default")).toBe(true);
    });

    it("excludes test files from analysis", () => {
      const content = `
export function test() {
  console.log("test");
  const x: any = null;
}
`;
      const result = analyzeFileStatic("src/example.test.ts", content);
      expect(result).toBeNull();
    });

    it("excludes test_*.py files from analysis", () => {
      const content = `
def test_example():
    except:
        pass
`;
      const result = analyzeFileStatic("test_example.py", content);
      expect(result).toBeNull();
    });

    it("excludes spec files from analysis", () => {
      const content = `
export function example() {
  console.log("spec test");
}
`;
      const result = analyzeFileStatic("src/example.spec.ts", content);
      expect(result).toBeNull();
    });

    it("skips files over 500 lines", () => {
      const lines: string[] = [];
      for (let i = 0; i < 600; i++) {
        lines.push(`// Line ${i + 1}`);
      }
      const content = lines.join("\n");
      const result = analyzeFileStatic("src/large.ts", content);
      expect(result).toBeNull();
    });

    it("returns null for clean TypeScript files", () => {
      const content = `
export function example(name: string): string {
  return \`Hello, \${name}\`;
}
`;
      const result = analyzeFileStatic("src/example.ts", content);
      expect(result).toBeNull();
    });

    it("returns null for files with only low severity issues", () => {
      const content = `
export function example() {
  console.log("info");
}
`;
      const result = analyzeFileStatic("src/example.ts", content);
      expect(result).not.toBeNull();
      expect(result?.isHighPriority).toBe(false);
    });

    it("skips console.log in CLI scripts with shebang", () => {
      const content = `#!/usr/bin/env node
console.log("Hello");
`;
      const result = analyzeFileStatic("bin/cli.ts", content);
      expect(result).toBeNull();
    });
  });

  describe("analyzeFiles", () => {
    it("returns AnalysisResult with correct shape", () => {
      const files = [
        {
          path: "src/example.ts",
          content: `
export function example() {
  try {
    doSomething();
  } catch (e) {}
}
`,
        },
      ];

      const result = analyzeFiles("owner/repo", files);

      expect(result).not.toBeNull();
      expect(result).toHaveProperty("issueId");
      expect(result).toHaveProperty("repoFullName");
      expect(result).toHaveProperty("relevantFiles");
      expect(result).toHaveProperty("suggestedApproach");
      expect(result).toHaveProperty("confidence");
      expect(result).toHaveProperty("analyzedAt");
      expect(result?.repoFullName).toBe("owner/repo");
    });

    it("returns null when no issues found", () => {
      const files = [
        {
          path: "src/example.ts",
          content: `
export function example(name: string): string {
  return \`Hello, \${name}\`;
}
`,
        },
      ];

      const result = analyzeFiles("owner/repo", files);
      expect(result).toBeNull();
    });

    it("includes files with issues in relevantFiles", () => {
      const files = [
        {
          path: "src/bad.ts",
          content: `
export function example() {
  try {
    doSomething();
  } catch (e) {}
}
`,
        },
        {
          path: "src/good.ts",
          content: `
export function example(name: string): string {
  return \`Hello, \${name}\`;
}
`,
        },
      ];

      const result = analyzeFiles("owner/repo", files);
      expect(result).not.toBeNull();
      expect(result?.relevantFiles).toContain("src/bad.ts");
    });

    it("returns high confidence for severe issues", () => {
      const files = [
        {
          path: "src/example.ts",
          content: `
export function example() {
  try {
    doSomething();
  } catch (e) {}
  const x = obj.a.b.c.d;
}
`,
        },
      ];

      const result = analyzeFiles("owner/repo", files);
      expect(result).not.toBeNull();
      expect(result?.confidence).toBeGreaterThanOrEqual(0.95);
      expect(result?.complexity).toBe("high");
    });

    it("analyzes multiple Python files", () => {
      const files = [
        {
          path: "bad.py",
          content: `
def example():
  try:
    do_something()
  except:
    pass
`,
        },
      ];

      const result = analyzeFiles("owner/repo", files);
      expect(result).not.toBeNull();
      expect(result?.relevantFiles).toContain("bad.py");
    });
  });
});

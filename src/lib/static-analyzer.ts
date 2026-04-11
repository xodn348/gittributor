import { discoveryConfig } from "./config";
import { debug } from "./logger.js";
import type { AnalysisResult } from "../types/index";

const MAX_FILE_LINES = 500;

const TEST_FILE_PATTERN = /\.(test|spec)\.(ts|js|tsx|jsx)$/;
const TEST_FILE_PYTHON_PATTERN = /^test_.*\.py$/;

const TS_JS_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const PYTHON_EXTENSIONS = /\.py$/;

const EMPTY_CATCH_PATTERN = /catch\s*\([^)]*\)\s*\{\s*\}/g;
const CONSOLE_LOG_PATTERN = /console\.(log|warn|error|debug|info)\s*\(/g;
const ANY_TYPE_PATTERN = /:\s*any\b|as\s+any\b|<any>/g;
const UNSAFE_CHAIN_PATTERN = /\b\w+\.\w+\.\w+\.\w+/g;
const UNREACHABLE_CODE_PATTERN = /return\s+[^;]+;\s*\n\s*(?:\/\/[^\n]*\n\s*)*(?!\s*(?:\/\/|\/\*|\*|#|import|export|function|const|let|var|if|for|while|switch|class|interface|type|enum|async|await|\}))/g;
const UNUSED_IMPORT_TSJS_PATTERN = /import\s+[^;]+from\s+['"][^'"]+['"]\s*;/g;

const BARE_EXCEPT_PATTERN = /^\s*except\s*:/gm;
const MUTABLE_DEFAULT_PATTERN = /def\s+\w+\s*\([^)]*=\s*(\[|\{)/g;
const PYTHON_PRINT_PATTERN = /\bprint\s*\(/g;
const PYTHON_UNUSED_IMPORT_PATTERN = /^import\s+(\w+)|^from\s+(\S+)\s+import/gm;

interface PatternMatch {
  pattern: string;
  line: number;
  severity: number;
}

interface FileAnalysis {
  path: string;
  matches: PatternMatch[];
  maxSeverity: number;
  isHighPriority: boolean;
}

function isTestFile(filePath: string): boolean {
  const fileName = filePath.split("/").pop() ?? "";
  if (TEST_FILE_PYTHON_PATTERN.test(fileName)) return true;
  if (TEST_FILE_PATTERN.test(filePath)) return true;
  return false;
}

function isCliScript(content: string): boolean {
  const firstLine = content.split("\n")[0]?.trim() ?? "";
  return firstLine.startsWith("#!/");
}

function countLines(content: string): number {
  return content.split("\n").length;
}

function getLineNumber(content: string, index: number): number {
  return content.substring(0, index).split("\n").length;
}

function analyzeTsJsFile(filePath: string, content: string): FileAnalysis | null {
  const matches: PatternMatch[] = [];
  const lines = content.split("\n");

  const emptyCatch = EMPTY_CATCH_PATTERN.exec(content);
  if (emptyCatch) {
    const lineNumber = getLineNumber(content, emptyCatch.index);
    matches.push({ pattern: "empty-catch", line: lineNumber, severity: 0.9 });
  }

  if (!isCliScript(content)) {
    CONSOLE_LOG_PATTERN.lastIndex = 0;
    let match = CONSOLE_LOG_PATTERN.exec(content);
    while (match !== null) {
      const lineNumber = getLineNumber(content, match.index);
      matches.push({ pattern: "console-log", line: lineNumber, severity: 0.5 });
      match = CONSOLE_LOG_PATTERN.exec(content);
    }
  }

  ANY_TYPE_PATTERN.lastIndex = 0;
  let anyMatch = ANY_TYPE_PATTERN.exec(content);
  while (anyMatch !== null) {
    const lineNumber = getLineNumber(content, anyMatch.index);
    matches.push({ pattern: "any-type", line: lineNumber, severity: 0.7 });
    anyMatch = ANY_TYPE_PATTERN.exec(content);
  }

  UNSAFE_CHAIN_PATTERN.lastIndex = 0;
  let chainMatch = UNSAFE_CHAIN_PATTERN.exec(content);
  while (chainMatch !== null) {
    const matchIndex = chainMatch.index;
    const lineNumber = getLineNumber(content, matchIndex);
    const line = lines[lineNumber - 1] ?? "";
    const prevChar = matchIndex > 0 ? content[matchIndex - 1] : " ";
    const nextCharIndex = matchIndex + chainMatch[0].length;
    const nextChar = nextCharIndex < content.length ? content[nextCharIndex] : " ";
    
    if (prevChar !== '"' && prevChar !== "'" && nextChar !== '"' && nextChar !== "'" && !line.includes("//") && !line.includes("'")) {
      matches.push({ pattern: "unsafe-chain", line: lineNumber, severity: 1.0 });
    }
    chainMatch = UNSAFE_CHAIN_PATTERN.exec(content);
  }

  const returnPattern = /return\s+[^;]+;\s*\n((?:\s*(?:\/\/[^\n]*)?\n)*)/g;
  let retMatch = returnPattern.exec(content);
  while (retMatch !== null) {
    const afterReturn = retMatch[1] ?? "";
    const nonEmptyLines = afterReturn.split("\n").filter((l) => l.trim() !== "" && !l.trim().startsWith("//") && !l.trim().startsWith("*"));
    if (nonEmptyLines.length > 0 && !nonEmptyLines[0].trim().startsWith("}")) {
      const lineNumber = getLineNumber(content, retMatch.index);
      matches.push({ pattern: "unreachable-code", line: lineNumber, severity: 0.8 });
    }
    retMatch = returnPattern.exec(content);
  }

  const importNames = new Set<string>();
  const importLines: Array<{ line: number; names: string[] }> = [];
  const importPattern = /import\s+(?:{([^}]+)}|\*\s+as\s+(\w+)|(\w+))\s+from\s+['"][^'"]+['"]\s*;/g;
  let importMatch = importPattern.exec(content);
  while (importMatch !== null) {
    const lineNumber = getLineNumber(content, importMatch.index);
    if (importMatch[1]) {
      const names = importMatch[1].split(",").map((n) => n.trim().split(" as ")[0].trim());
      for (const n of names) { importNames.add(n); }
      importLines.push({ line: lineNumber, names });
    } else if (importMatch[2]) {
      importNames.add(importMatch[2]);
      importLines.push({ line: lineNumber, names: [importMatch[2]] });
    } else if (importMatch[3]) {
      importNames.add(importMatch[3]);
      importLines.push({ line: lineNumber, names: [importMatch[3]] });
    }
    importMatch = importPattern.exec(content);
  }

  const codeAfterImports = content.slice(content.indexOf(";", content.search(/import\s+/)) + 1);
  const usedNames = new Set<string>();
  for (const name of importNames) {
    const usagePattern = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
    if (usagePattern.test(codeAfterImports)) {
      usedNames.add(name);
    }
  }
  for (const { line, names } of importLines) {
    for (const name of names) {
      if (!usedNames.has(name)) {
        matches.push({ pattern: "unused-import", line, severity: 0.5 });
        break;
      }
    }
  }

  if (matches.length === 0) return null;

  const maxSeverity = Math.max(...matches.map((m) => m.severity));
  return {
    path: filePath,
    matches,
    maxSeverity,
    isHighPriority: maxSeverity > 0.6,
  };
}

function analyzePythonFile(filePath: string, content: string): FileAnalysis | null {
  const matches: PatternMatch[] = [];

  BARE_EXCEPT_PATTERN.lastIndex = 0;
  let bareExceptMatch = BARE_EXCEPT_PATTERN.exec(content);
  while (bareExceptMatch !== null) {
    const lineNumber = getLineNumber(content, bareExceptMatch.index);
    matches.push({ pattern: "bare-except", line: lineNumber, severity: 0.9 });
    bareExceptMatch = BARE_EXCEPT_PATTERN.exec(content);
  }

  MUTABLE_DEFAULT_PATTERN.lastIndex = 0;
  let mutableMatch = MUTABLE_DEFAULT_PATTERN.exec(content);
  while (mutableMatch !== null) {
    const lineNumber = getLineNumber(content, mutableMatch.index);
    matches.push({ pattern: "mutable-default", line: lineNumber, severity: 0.8 });
    mutableMatch = MUTABLE_DEFAULT_PATTERN.exec(content);
  }

  PYTHON_PRINT_PATTERN.lastIndex = 0;
  let printMatch = PYTHON_PRINT_PATTERN.exec(content);
  while (printMatch !== null) {
    const lineNumber = getLineNumber(content, printMatch.index);
    matches.push({ pattern: "python-print", line: lineNumber, severity: 0.5 });
    printMatch = PYTHON_PRINT_PATTERN.exec(content);
  }

  const pyImportPattern = /^import\s+(\w+)|^from\s+(\S+)\s+import/gm;
  const pyImportedNames = new Set<string>();
  const pyImportLines: Array<{ line: number; names: string[] }> = [];
  let pyImportMatch = pyImportPattern.exec(content);
  while (pyImportMatch !== null) {
    const lineNumber = getLineNumber(content, pyImportMatch.index);
    if (pyImportMatch[1]) {
      pyImportedNames.add(pyImportMatch[1]);
      pyImportLines.push({ line: lineNumber, names: [pyImportMatch[1]] });
    } else if (pyImportMatch[2]) {
      const fromModule = pyImportMatch[2];
      pyImportedNames.add(fromModule);
      pyImportLines.push({ line: lineNumber, names: [fromModule] });
    }
    pyImportMatch = pyImportPattern.exec(content);
  }
  const codeAfterImports = content.slice(content.indexOf("\n", content.search(/^import\s+|^from\s+/m)) + 1);
  for (const { line, names } of pyImportLines) {
    for (const name of names) {
      const usagePattern = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
      if (!usagePattern.test(codeAfterImports)) {
        matches.push({ pattern: "python-unused-import", line, severity: 0.5 });
        break;
      }
    }
  }

  if (matches.length === 0) return null;

  const maxSeverity = Math.max(...matches.map((m) => m.severity));
  return {
    path: filePath,
    matches,
    maxSeverity,
    isHighPriority: maxSeverity > 0.6,
  };
}

function buildSuggestedApproach(highPriorityFiles: FileAnalysis[]): string {
  const patterns = new Set<string>();
  
  for (const file of highPriorityFiles) {
    for (const match of file.matches) {
      switch (match.pattern) {
        case "empty-catch":
          patterns.add("Empty catch blocks should log errors or rethrow with context.");
          break;
        case "console-log":
          patterns.add("Replace console.log with structured logging for production code.");
          break;
        case "any-type":
          patterns.add("Replace 'any' type with specific types for type safety.");
          break;
        case "unsafe-chain":
          patterns.add("Add null checks before accessing nested properties to prevent NPEs.");
          break;
        case "bare-except":
          patterns.add("Replace bare except with specific exception types.");
          break;
        case "mutable-default":
          patterns.add("Use None as default and initialize mutable objects inside the function.");
          break;
        case "unreachable-code":
          patterns.add("Remove unreachable code after return statements.");
          break;
        case "unused-import":
          patterns.add("Remove unused imports to keep the codebase clean.");
          break;
        case "python-print":
          patterns.add("Replace print() calls with a proper logging framework.");
          break;
        case "python-unused-import":
          patterns.add("Remove unused Python imports.");
          break;
      }
    }
  }
  
  const suggestions = Array.from(patterns);
  if (suggestions.length === 0) {
    return "Review code for potential improvements identified by static analysis.";
  }
  return suggestions.join(" ");
}

export function analyzeFileStatic(filePath: string, content: string): FileAnalysis | null {
  if (isTestFile(filePath)) return null;
  
  const lineCount = countLines(content);
  if (lineCount > MAX_FILE_LINES) {
    debug(`[StaticAnalyzer] Skipping ${filePath}: ${lineCount} lines exceeds ${MAX_FILE_LINES} limit`);
    return null;
  }

  if (TS_JS_EXTENSIONS.test(filePath)) {
    return analyzeTsJsFile(filePath, content);
  }
  
  if (PYTHON_EXTENSIONS.test(filePath)) {
    return analyzePythonFile(filePath, content);
  }
  
  return null;
}

export function analyzeFiles(
  repoFullName: string,
  files: { path: string; content: string }[],
): AnalysisResult | null {
  if (!discoveryConfig.staticAnalysisEnabled) {
    return null;
  }

  const analyzedFiles: FileAnalysis[] = [];
  
  for (const file of files) {
    const analysis = analyzeFileStatic(file.path, file.content);
    if (analysis) {
      analyzedFiles.push(analysis);
    }
  }

  const relevantFiles = analyzedFiles.map((f) => f.path);
  
  if (relevantFiles.length === 0) {
    return null;
  }
  
  const highPriorityFiles = analyzedFiles.filter((f) => f.isHighPriority);

  const avgSeverity = highPriorityFiles.length > 0
    ? highPriorityFiles.reduce((sum, f) => sum + f.maxSeverity, 0) / highPriorityFiles.length
    : 0;

  let confidence: number;
  let complexity: "low" | "medium" | "high";
  
  if (avgSeverity >= 0.9) {
    confidence = 0.95;
    complexity = "high";
  } else if (avgSeverity >= 0.7) {
    confidence = 0.85;
    complexity = "medium";
  } else {
    confidence = 0.75;
    complexity = "low";
  }

  return {
    issueId: 0,
    repoFullName,
    relevantFiles,
    suggestedApproach: buildSuggestedApproach(highPriorityFiles),
    confidence,
    analyzedAt: new Date().toISOString(),
    rootCause: `Found ${analyzedFiles.length} file(s) with potential issues. ${highPriorityFiles.length} high-priority file(s) require attention.`,
    affectedFiles: relevantFiles,
    complexity,
  };
}

# Learnings — readme-update

## Project: gittributor
- Bun-based CLI, located at /Users/jnnj92/gittributor/
- 5 sequential commands: discover → analyze → fix → review → submit
- State persisted in .gittributor/ directory
- package.json scripts: test, typecheck, build

## CLI Source of Truth
- src/index.ts:15-33 — USAGE_TEXT defines canonical commands and flags
- Global flags: --help, --version, --verbose, --config <path>
- discover flags: --min-stars=<number> --language=<name> --max-results=<number>

## Recent Features (commit 5db8055)
- Impact scoring via IMPACT_PATTERNS in src/commands/analyze.ts
- getFileTree() in src/lib/github.ts
- fileContents field in src/lib/fix-generator.ts

## Target README
- Under 80 lines
- English only — no Korean
- Sections: title, prerequisites, install, usage, options, env vars, dev
- No FAQ, Architecture, Contributing, Roadmap sections

## 
## 2026-04-01T00:00:00Z Task: task-1
README rewritten. Line count: 53. Committed.

## 
## 2026-04-01T23:04:55Z Task: task-1
README rewritten. Line count: 53. Committed.


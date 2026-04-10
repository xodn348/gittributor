# Draft: Multi-Language Support for gittributor

## Ultimate Goal
- **Maximize user's GitHub contributions and open source credit**
- Multi-language = more repos = more contribution opportunities = more green squares

## Requirements (confirmed)
- **Languages**: Default 3 — TypeScript, JavaScript, Python (config extensible)
- **Execution mode**: Sequential iteration over targetLanguages array in single `gittributor run`
- **Purpose**: "나한테 최대의 git contribution, credit을 줘야돼. 그게 최종 목적이야"

## Technical Decisions
- Currently `src/index.ts:404` uses `targetLanguages?.[0]` — only first language
- Need to loop over all languages in targetLanguages array
- `--language` flag should override to single language (backward compat)
- Sequential execution to avoid GitHub API rate limit issues

## Research Findings
- (awaiting explore agents — pipeline flow + test infrastructure)

## Open Questions
- How does state management handle per-language runs? (awaiting research)
- Does MAX_GLOBAL_WEEKLY=10 guardrail apply per-language or total? (awaiting research)
- Test strategy: TDD or tests-after? (need to ask user after test infra assessment)

## Scope Boundaries
- INCLUDE: Loop discover→submit pipeline over all targetLanguages
- INCLUDE: Keep --language flag for single-language override
- INCLUDE: Update tests for new behavior
- INCLUDE: Update existing test baseline (357 pass, 0 fail)
- EXCLUDE: New language-specific fix strategies (each language uses same AI fix flow)
- EXCLUDE: Parallel language execution (sequential only)
- EXCLUDE: Per-language guardrail caps (global cap stays global)

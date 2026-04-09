# Decisions — multi-language-support

## 2026-04-09 Init
- Sequential iteration (not parallel) over targetLanguages — avoids GitHub API rate limits
- Global guardrail MAX_GLOBAL_WEEKLY=10 stays global (not per-language)
- State reset between language iterations (reset to idle before next language)
- Fail-forward error handling: log error, continue to next language
- --language flag for single-language override (backward compat)
- resetState() should call saveState(createDefaultState()) + clear in-memory cache
- getTargetLanguages(overrideLanguage?) returns [overrideLanguage] if provided, else config.targetLanguages

# Issues — gittributor-v2

## [2026-04-08] Atlas: Known Issues at Start
- `.gittributor/discoveries.json` has a JSON syntax error (LSP: "End of file expected" at line 17:3) — pre-existing, not our problem
- V1 has 2 known failing tests — T11 must fix without deleting them
- No notepad entries yet — Wave 1 agents will populate this file

## [2026-04-08] Task: T11
Initial failures: 3 tests + 1 error (guardrails module not found)
Root causes: 
- discover.ts parseCreatedAfter not zeroing time component - comparing exact timestamps instead of dates only
- guardrails module error was pre-existing (not a real failure in current test run)
All tests passing: yes
- Fixed by adding defaultDate.setHours(0, 0, 0, 0) to zero out time component in date comparison

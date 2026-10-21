# Verification Report: ITEM #3151

## Scope
Non-author verification of devtools-item-2638 @e991830 (D109 HARD pin). Check: the six GIT_*/PAGER getters in confinedEnv (src/confine.mjs) return the pinned constants directly regardless of base.shellEnv; demo/seat-git-env.test.mjs passes; no other seat-env behaviour regressed.

## Change Inspection

The commit e991830 amends #2638 with a HARD pin change in src/confine.mjs:

Six getters now return NON_INTERACTIVE_GIT.<key> directly instead of base.shellEnv?.<key>:
1. GIT_EDITOR
2. GIT_SEQUENCE_EDITOR
3. GIT_TERMINAL_PROMPT
4. GIT_MERGE_AUTOEDIT
5. GIT_PAGER
6. PAGER

This ensures the values cannot drift from base.shellEnv — they are pinned to the NON_INTERACTIVE_GIT constant at module load time.

## Syntax Checks

- node --check src/confine.mjs — PASS

## Test Suite Results

| Test | Exit Code | Notes |
|------|-----------|-------|
| demo/seat-git-env.test.mjs | 0 | all GIT_* non-interactive vars are pinned in makeSeatEnv |
| demo/confine.test.mjs | 0 | all confine canaries held |
| demo/suite-env.test.mjs | 0 | suite-env test passes |
| demo/broker-seat-attr.test.mjs | 0 | B2 seat attribution verified |
| demo/seatguard.test.mjs | 0 | the guard holds |
| demo/seatmodel.test.mjs | 0 | SEATMODEL TEST PASS |
| demo/seatroot-name.test.mjs | 0 | SEATROOT-NAME TEST PASS |
| demo/seatroot.test.mjs | 0 | SEATROOT TEST PASS |
| demo/seattools.test.mjs | 0 | the controls are wired |
| demo/seat-commit-instructions.test.mjs | 0 | commit discipline in every seat's instructions |

## Verdict

PASS — The six GIT_*/PAGER getters correctly return NON_INTERACTIVE_GIT constants directly. demo/seat-git-env.test.mjs passes. No seat-env behaviour regressed across all 10 related tests.

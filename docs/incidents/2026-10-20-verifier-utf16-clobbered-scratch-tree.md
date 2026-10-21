---
incident: verifier-utf16-clobbered-scratch-tree
date: 2026-10-20
severity: sev2
status: mitigated
symptom: "a verifier's suite run reports ~120 failures in a scratch worktree, and the file under test will not parse"
runbook: null
fix: null
prevention: "delegate recovery (reset + clean tree); PROPOSED check rule: no tracked text file may carry a UTF-16 BOM or NUL bytes"
last_reviewed: 2026-10-20
---

# A verifier's failing-first worktree was corrupted by a shell write, and the corruption was read as a Windows bug

*Incident 2026-10-20; detected by the delegate while checking why a claimed verify (#3216) had produced no
report.*

## Summary

`qa` was verifying `#3174` (`prepare_workspace` must not steal another seat's worktree) under item
**`#3216`**, with a deliberate failing-first pair of detached worktrees: `.durig/temp-verify-3174` (the
fix, `5961593`) and `.durig/temp-verify-3174-old` (the pre-fix base, `cdf4a43`).

In the fix tree, `src/worktree.mjs` had been **rewritten as UTF-16LE with a BOM** — 84,784 bytes,
sha256 `30ae2edd051aa2ca`, and `node --check src/worktree.mjs` exited **1**. `src/worktree-old.mjs` in the
same tree was a **byte-identical copy of that same corrupt file** (identical sha256), so it was not the
pre-fix source at all: any RED/GREEN comparison built from it compared the corrupt file with itself. A
UTF-8 copy `src/worktree-new.mjs` (47,238 bytes) was also present — the classic hand-patch scratch
pattern.

The tree had **no `node_modules`**, so `node scripts/suite.mjs` there failed ~120 demos on module
resolution. The verifier's run was converging on "the 120 failures are pre-existing Windows cleanup
permission errors" when it was reset — i.e. the corruption was about to be reported as an environmental
property of the box, not as self-inflicted damage.

## Timeline

- `2026-10-19T23:54:26Z` — last `WAKE qa` in `selfdev.sqlite.broker.log`; the verify run starts.
- During that run qa compacts **twice** (`pi.compaction` entries) while chasing the failure count.
- `2026-10-20T01:39Z` — the delegate reads `log qa` and sees the run ended on an **empty assistant
  entry** with `#3216` still `claimed` (a stranded claim: a claimed item is not "queued work", so nothing
  re-wakes the seat).
- `2026-10-20T01:4xZ` — the delegate inspects both scratch trees; the UTF-16 clobber and the missing
  `node_modules` are found; the "120 Windows cleanup failures" reading is identified as invalid.
- `2026-10-20T01:53:05Z` — `intent.mjs qa --op reset` applied by the broker (reset entry `148969`), the
  two poisoned worktrees removed (`git worktree remove --force`; the branch `impl-item-3174` @ `5961593`
  is untouched), and a corrective handoff delivered (`delegate-message-qa-3216`,
  `delivered:true 01:53:40Z`).
- `2026-10-20T01:54Z` — qa re-runs `#3216` from its own `item-3216` worktree (`qa-item-3216` @ `cdf4a43`,
  the correct pre-fix base, with `node_modules` present).

## Impact

- **One claimed verify was void** and had to be restarted (~2 h of one seat's turns plus two context
  compactions). `#3174` — the top of the priority stack — could not land while it was claimed.
- **No product code was lost.** The corrupted file is a worktree checkout, not a commit; the branch tip
  `5961593` is intact, and the pre-fix commit `cdf4a43` is in history.
- The near-miss is the real cost: the run was about to record a **false environmental cause**, which would
  have justified ignoring a genuine mass failure.

## Root cause

1. **A shell redirect wrote a source file.** PowerShell `>` / `Out-File` (and `Tee-Object`) emit UTF-16LE
   with a BOM. Redirecting into `src/worktree.mjs` replaced a UTF-8 module with a file Node cannot parse.
   This is the documented pitfall in `docs/SELFDEV.md` ("When `edit` misses… do not shell-edit source").
2. **The RED baseline was fabricated from the corrupted file.** `worktree-old.mjs` was copied from the
   already-corrupted `worktree.mjs` rather than from `cdf4a43`, so the comparison had no valid control.
3. **The worktree was not provisioned.** A detached `git worktree add` has no `node_modules`, and the
   suite reports module-resolution failures as REAL failures. The verifier read that count as a property
   of the machine.
4. **A stranded claim does not re-wake.** `#3216` stayed `claimed` after the run ended, and `status`
   reported no attention for it, so nothing in the rig would have brought the seat back.

## Detection

The delegate found it by reading `log qa` for a claimed item with no report, then checking the scratch
tree instead of trusting the seat's description of it. The decisive one-liners:

```bash
node --check .durig/temp-verify-3174/src/worktree.mjs          # exit 1
python -c "b=open('.durig/temp-verify-3174/src/worktree.mjs','rb').read(); print(len(b), b[:2]==b'\xff\xfe')"
ls -d .durig/temp-verify-3174/node_modules                     # missing
sha256sum .durig/temp-verify-3174/src/worktree{,-old}.mjs      # identical
```

## Resolution

- Both poisoned worktrees removed with `git worktree remove --force` (the branch was left untouched).
- `intent.mjs qa --op reset --handoff …` drew a reset boundary that states the corruption explicitly and
  points at `.spike/delegate/session/qa-handoff-3216.md`, then a `message` intent re-woke the seat.
- The corrected procedure for the verify: a **fresh in-repo linked worktree** (so `node_modules` resolves
  upward from the pinned shared tree), `git -C … checkout <sha> -- <path>` or `cp` for the RED copy, never
  a redirect.

## Prevention

- **PROPOSED (not yet registered): a `check` rule — no tracked text file may contain a NUL byte or carry a
  UTF-16 BOM.** One scan over `git ls-files`; it catches this class at `check` time, before it can land.
  The shared tree on `main` is currently clean (498 tracked files scanned, zero NUL bytes), so the rule
  would start green.
- **Same damage exists in older scratch trees** — `temp-1754-rebase/src/worktree.mjs` is also UTF-16LE
  (71,830 bytes, 2026-10-19 03:58Z). Any verify performed in those trees is likewise invalid.
- The `leaked-worktrees` / verify recipe should say a scratch tree must be **provisioned** (deps resolve)
  and that a copy of a file for a RED baseline must come from `git show`/`git checkout <sha> -- <path>`,
  never from the tree under test.

## Evidence

- `.durig/temp-verify-3174/src/worktree.mjs`: 84,784 bytes, UTF-16LE BOM `FF FE`, sha256 prefix
  `30ae2edd051aa2ca`, `node --check` exit 1 (measured 2026-10-20T01:4xZ, before removal).
- `.durig/temp-verify-3174/src/worktree-old.mjs`: same size and sha256 — a copy of the corrupt file.
- `.durig/temp-verify-3174/src/worktree-new.mjs`: 47,238 bytes, no BOM.
- `.durig/temp-verify-3174`: no `node_modules` directory.
- Broker: `2026-10-20T01:53:05.269Z WAKE qa`, result file
  `selfdev.sqlite.broker.inbox.out/delegate-reset-qa-3216.json` → `resetEntryId: 148969`;
  `delegate-message-qa-3216.json` → `delivered: true`.
- Store: `pi.compaction` entries in qa's conversation before the reset; the run ended on an empty
  `pi.assistant` entry.
- Baseline for comparison: `node scripts/suite.mjs` on `main` = `pass=179 fail=1`
  (`demo/pitui.test.mjs`, #2412) — not ~120.

## Links

- `docs/SELFDEV.md` §"Operational pitfalls" (never shell-edit source; F32).
- `docs/failing-first-recipe.md` (how to run RED without touching the shared tree).
- `docs/runbooks/leaked-worktrees.md`, `docs/runbooks/degeneration-guard.md`.
- `#3174` (the fix under verify), `#3216` (the verify), `#3176` (a duplicate held verify).

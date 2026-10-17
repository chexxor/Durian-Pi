---
runbook: write-corruption-recovery
symptom: "a `write` was refused as a one-line collapse, or a source file was silently collapsed to one line"
writes: true
precondition: "read-only"        # the Diagnose is read-only; step 3 stages a recovery commit
last_verified: 2026-10-16
verified_by: impl
evidence: "items 806/#673/#799; commits 0102f3c (guard), #623 (incident)"
check_rule: null
---

# Recover a file collapsed to one line (silent write corruption)

## When to use
One of two observables:
- A seat's `write` call returns the refusal **"refused by durig: this write would collapse a
  multi-line source file (N lines) to a single line — that is the silent-corruption shape of the
  #623 incident…"**, or
- a source file (`.mjs`/`.cjs`/`.js`/`.jsx`/`.ts`/`.mts`/`.cts`) is now **one long line** with no error
  having been raised — the failure is invisible until somebody opens the file.

## Impact
The overwrite is **real and silent** (no error). The seat keeps working against a file that is now
unreadable junk, and because git sees a normal modification, the loss is not obvious until review. The
guard (`refusalForWrite`, `src/seatguard.mjs`) catches the common shape *before* the write; a file that
already collapsed (or a shape the guard predicts but cannot prove) is what this runbook recovers.

## Preconditions
Read-only to diagnose. Step 3 commits, so the seat must own the item/worktree whose file was damaged
(`prepare_workspace` has been called; you are working in `item-<id>`).

## Diagnose (read-only)
Confirm the collapse and confirm the prior good content is still in git (an overwrite does **not**
discard the committed revision):
```bash
git -C item-<id> diff --stat -- <path>          # one file, huge +/-
git -C item-<id> diff --numstat -- <path>       # added lines ~=0, "removed" lines ~= the original line count
git -C item-<id> show HEAD:<path> | Measure-Object -Line   # the prior good content, still in HEAD
```
A single added line of thousands of characters against a file whose `HEAD` version is multi-line
confirms the #623 shape.

## Do
1. **Do not re-write the collapsed content.** Re-saving the same serialized string reproduces the
   incident. The refusal's wording is the recovery instruction: **recover from git**.
2. Recover the file from its last-good revision (the file survives in `HEAD`; the working-tree copy is
   the damaged one):
   ```bash
   git -C item-<id> show HEAD:<path>                # inspect the good content
   #   write it back through the `write` tool (multi-line content — the guard permits it), or
   #   if the only change since HEAD was the collapse, stage the recovery:
   git -C item-<id> checkout -- <path>              # OPERATOR ONLY: a seat cannot run checkout (guard)
   ```
   A seat recovers by reading `git show HEAD:<path>` and writing that content back through the `write`
   tool — never by `git checkout`/`restore`, which the guard refuses.
3. If the seat intended to *serialize* (a `JSON.stringify` dump or a `Set-Content`-style one-liner),
   write it to a **new** `.json`/`.txt` filename instead of collapsing the source file in place.

## Verify
Run the guard's own test — it encodes both the refusal and the healthy-rewrite cases:
```bash
node demo/seatguard.test.mjs     # expect: "PASS — the guard holds", exit 0
```
For the recovered file itself, confirm it is multi-line again and the **item's** test still passes in
the worktree: `node --check <path>` (clean) and the file's own demo.

## If it fails
- The guard did **not** fire and a legitimate multi-line source was still collapsed: capture the exact
  `path` + `content` shape and file it — the guard is a *narrow* refusal (`MIN_SUSPICIOUS_LENGTH`,
  code-shaped regex, prior-file is multi-line), not a boundary, so a miss is a real defect to record,
  not a retry.
- The bad write reached a file with **no** git history (a new untracked file): there is no prior to
  recover; re-create it from the seat transcript (`node cli.mjs log <seat>`) or the provider's record.
- Wrong file / another seat's work: stop; do not commit. Route to that item's owner.

## Escalate to
`impl` — a guard miss (a collapse the refusal did not catch) is a code defect against
`src/seatguard.mjs`; cite `demo/seatguard.test.mjs`. For the store-level analogue (a corrupt *document*,
not a worktree file) use `store-corruption-recovery.md`.

## Evidence
The #623 incident: a `write` handed the entire serialized payload of a source file as ONE line, a
silent overwrite with no error. The guard added in commit `0102f3c` (`refusalForWrite`, #673; also the
stray-control-byte check, #780), verified by `demo/seatguard.test.mjs` (exit 0). Last verified
2026-10-16 against `0102f3c` in `item-806`.

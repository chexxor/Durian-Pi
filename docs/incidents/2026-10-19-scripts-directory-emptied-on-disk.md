---
incident: scripts-directory-emptied-on-disk
date: 2026-10-19
severity: sev2
status: mitigated
symptom: "tracked files show as DELETED in git status while the index and HEAD still hold them; a whole directory (scripts/, demo tooling) is empty on disk and the tools built on it cannot parse"
runbook: tracked-files-missing-on-disk
fix: "git ls-files scripts/ | xargs git checkout-index -f --  (restored from the index, lossless; no commit needed)"
prevention: "runbook tracked-files-missing-on-disk.md (the three-part asymmetry test + the restore); escalation #2889/#2890 to lead/pm asking for the deleting actor to be identified"
last_reviewed: 2026-10-19
---

# Nine tracked files in `scripts/` vanished from disk while the index and `HEAD` still held them; no commit, branch, or stash explains it

*Incident 2026-10-19; detected by the delegate at a land+prune pass's first gate; analysis by the
delegate.*

## Summary
The shared tree reported **nine tracked deletions** in `scripts/` (`apply-commit-discipline`,
`degen-scan`, `from-openrig`, `land`, `read-constitution`, `repair-pi-live`, `serve-noroot.ps1`,
`suite`, `sync-pi`) with the directory **empty on disk**. Because `scripts/land.mjs` and
`scripts/suite.mjs` are the landing helper and the test runner, **every landing and the demo suite were
blocked** for the whole session — the prior pass had stopped there rather than guess. The content was
never lost: the index and `HEAD` both held all nine blobs, so restoring from the index was lossless.
**How the files were removed is UNVERIFIED.**

## Timeline
- Prior session: the pass halts at this gate; `main` unmoved at `a70fc27`; escalated as **#2889**
  (`pm`→`lead`) and **#2890** (`lead`→`pm`), both calling it operator-only.
- `17:33Z` prior clock-out records the diagnosis: index `git ls-files -s scripts/` = 9, `HEAD`
  `git ls-tree HEAD scripts/` = 9, disk = 0, and `git log --all --diff-filter=D -- scripts/` = **nothing**.
- `18:0xZ` this pass: re-verified the same three facts, then restored all nine files from the index.
- `18:0xZ` `node --check scripts/land.mjs` and `scripts/suite.mjs` both exit 0; tracked tree clean.
- `18:0xZ`–`18:2xZ` 17 branches landed (`main` `67228b9`→`3b79159`), suite `pass=175 fail=1`.

## Impact
**Everything that merges or verifies was blocked** — `land.mjs` is the enforcement chokepoint for every
landing, and `suite.mjs` is the only test runner — from at least `17:33Z` until the restore this
session. No data loss: the files were recoverable bit-for-bit from the index. The cost was a stalled
pass and a second agent's session spent on a gate rather than on work.

## Root cause
**UNVERIFIED.** What is established:
- `git log --all --diff-filter=D -- scripts/` returns nothing, so **no branch or commit deleted them**.
- The index (`git ls-files -s scripts/` = 9) and `HEAD` (`git ls-tree HEAD scripts/` = 9) were intact.
- `ls -la scripts/` showed the directory present but empty.

So the deletion happened in the **working tree only**, outside git's history. That is the signature of an
out-of-band filesystem operation (a scratch/harness cleanup, an editor or sync tool, an antivirus
quarantine, or a `git clean`/`rm` run with a wrong path) rather than a git operation. Nothing in the
store, `serve.err`, or the reflog contributed evidence, and this record does not guess.

## Detection
A human-readable symptom that a seat correctly refused to act on: `git status --short` listing nine
` D` lines, and `node --check scripts/land.mjs` failing to parse. The **durable** detection is still
missing — nothing watches for tracked files disappearing from disk. The escrow is that the damage is
always visible in `git status` and always recoverable while it is unstaged.

## Resolution
`git ls-files scripts/ | tr '\n' '\0' | xargs -0 git checkout-index -f --` restored all nine files.
Two of them then showed a stale-index ` M`; `git hash-object` matched the index shas and
`git add -- <the 2 paths>` produced an **empty staged diff** (a stat refresh, not a content change).
Verified: all nine byte-identical to their blobs after CRLF normalisation (`git ls-files --eol` reports
`i/lf w/crlf`, normal for this checkout), `node --check` clean on both scripts, `git status --short -- .`
showing only pre-existing untracked scratch.

**Note the directory-doesn't-recurse trap:** `git checkout-index -f -- scripts/` fails with
`scripts/ is not in the cache`. It takes FILES.

## Prevention
- `docs/runbooks/tracked-files-missing-on-disk.md` — the three-part asymmetry test that licenses a
  restore (and the branch direction: if a commit *did* delete the files, do not restore), the
  file-list restore, and the stale-stat refresh.
- **Not prevented:** the actor that emptied the directory is still unknown. #2889/#2890 asked for the
  operator to identify it; until then this class can recur. A `check` rule that compares tracked-file
  presence on disk (`git ls-files` vs `fs.existsSync`) is the candidate durable control — not built.

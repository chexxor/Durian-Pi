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

## Investigation 2026-10-19 — the SEAT HISTORIES were queried (they were not, originally)

The first analysis searched git only (all refs, `--diff-filter=D`), the index, and the working tree. It
did **not** query the seats' conversation histories, which is where a seat's tool calls are recorded — a
gap the operator identified. The histories were then queried read-only through the sanctioned one-shot
read (`node cli.mjs log <seat> <n> --full`; never a direct store handle while the broker runs).

**What was established:**
- **Seats CAN delete tracked files.** `powershell`, `write` and `edit` appear in the tool set of `impl`,
  `qa`, `advocate`, `scribe`, `devtools`, `auditor`, `designer`, `security` and `architect` (`pm`, `lead`
  are coordination-only: `claim_work`/`send_work`/`complete_work`/…). And every seat's root is the
  **SHARED tree** (see `2026-10-17-seat-root-fallback-commit.md`), so seat confinement does not protect
  the repo root. The mechanism therefore exists.
- **No recorded tool call does it.** 22,042 retained entries across all 12 seats were scanned for a
  destructive call (`Remove-Item`, `rm`, `rmdir`, `git rm`, `git clean`, `Move-Item`) — 86 matches, every
  one a false positive (module source containing `unlink`/`rmSync`, or `Remove-Item` on probe files
  *inside* item worktrees, e.g. `item-2608\.probe-2182.cjs`). Requiring `scripts/` and a removal verb in
  the same entry gave 26 matches, all compaction summaries or `docs/NEXT.md` reads. **Nothing deleted
  `scripts/`.**
- **The git mechanisms that produce this exact signature are ruled out.** `core.sparseCheckout` is unset
  and `.git/info/sparse-checkout` does not exist; `git ls-files -v scripts/` shows plain `H` entries, so
  no `skip-worktree` bit masked them (a sparse/skipped checkout would leave `git status` CLEAN, not
  deleted). `scripts/sync-pi.mjs` does use `git sparse-checkout init --cone` + `set … scripts`, but
  scoped to its own `BUILD_DIR`, never the shared tree. No commit deletes the files.

**Coverage limits — so this is not overclaimed:**
- `log` returns the last N entries; older ones are dropped, and `assert`-style resets write boundaries.
- **Compaction destroys raw evidence.** `devtools` compacted repeatedly at `08:16–08:23Z`, replacing its
  history with summaries ("The conversation history before this point was compacted…"). `devtools` is
  precisely the seat that was editing `scripts/land.mjs` (#2390) and `scripts/sync-pi.mjs` (#2336) at
  that time, so **it is the one seat that cannot be exonerated from history alone** — its pre-compaction
  tool calls no longer exist in a queryable form.

**Conclusion: still UNVERIFIED, now with a bounded exoneration.** No seat is shown to have done it, and
no git mechanism explains it; the remaining candidates are (a) a seat whose evidence was compacted away,
and (b) an out-of-band process (editor, sync tool, AV quarantine, a human `rm`) that was never in any
conversation. Do not record a culprit on this evidence.

**Side finding worth its own item:** `auditor`'s conversation is a degenerate blob — thousands of lines
of pseudo-tool-call noise across several languages, no usable transcript. It matches the documented
degeneration class and means the `auditor` seat's history is contaminated (consistent with its repeated
`400 Invalid request`). Route to `pm`.

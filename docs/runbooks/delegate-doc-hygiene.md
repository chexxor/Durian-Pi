---
runbook: delegate-doc-hygiene
symptom: "an edit reported success but the text is not in the file; the NEXT pointer went red on its line cap; a citation check flags findings you did not make; a commit sha you quoted turns out not to exist; a `cat >> file <<'EOF'` executed part of its own body as shell; you added a runbook and nothing noticed"
writes: false
precondition: "read-only"
last_verified: 2026-11-09
verified_by: scribe
evidence: "PARTIAL re-run 2026-11-09 by scribe (item #6080): the INTENDED-vs-RESOLVED section added under #6077/#6080 was checked with `node tools/doc-integrity-guard.mjs`, `node demo/next-pointer.test.mjs` and `node tools/review-cite-check.mjs docs/runbooks/delegate-doc-hygiene.md` in the item-6080 worktree at main `503ff096` (each exit code recorded in the completion); the corpus scan `awk '/^\| *[0-9]+ *\|/ {rows++; if (/[0-9]{3}/ && !/INTENDED|RESOLVED/) bad++} END{print rows, bad}' docs/ROADMAP.md` → `49 48`, exit 0. Earlier legs (2026-11-06, delegate): `node tools/doc-integrity-guard.mjs` → **exit 0** (`0 hard, 1 soft`) after the figure-carrying-its-measurement section was added, and the port probes in that section were run that hour; `last_verified` is NOT raised because the older sha-citation and heredoc legs were not re-run. docs/ROADMAP.md **262**; commit c34bb232 of this session (HEAD at the time of writing; verified with `git cat-file -e`); every command below was run 2026-10-29 on Linux (Fedora, box label-withheld-per-D205, node v24.22.1); the failure counts are from this session's own mistakes"
check_rule: "not yet — see docs/ROADMAP.md **262**: `check` reports `runbook-front-matter` as SKIPPED, and `scripts/clockin.mjs:123` skips any runbook with no front matter, so a header-less runbook is currently invisible to both"
---

# When your own doc edit does not land, or a pointer/citation check turns red on you

## When to use

You edited `docs/ROADMAP.md`, `docs/DECISIONS.md` or `docs/NEXT.md` and the tool said *successfully replaced* but the text
is not in the file. Or `node demo/next-pointer.test.mjs` fails on the line cap. Or `tools/review-cite-check.mjs` prints
findings for files you did not touch. Or a commit sha you wrote from memory does not resolve. Or a `cat >> … <<'EOF'` you
ran executed part of its own body as shell. Or you added a runbook and want to know whether the rig can even see it.

## Impact

Every one of these produced a **false green** this session. The worst: a `docs/ROADMAP.md` addition reported
`Successfully replaced 1 block(s)` and was never written — two registered items (260, 261) silently did not exist while
`docs/NEXT.md` cited them, so the next session would have gone looking for rules that were never recorded. A runbook with
no front matter is invisible to the only consumer that reads real runbooks, so the convention cannot fail. Untouched docs
that *look* verified are worse than missing docs: the pointer is the only state a future session gets.

## Preconditions

Read-only: nothing here writes to the store, so no broker stop is required. Work in the checkout you were given; `git add`
explicit paths only (never `-A`) because `.spike/` and `.scratch/` hold cited instruments.

## Diagnose (read-only)

```bash
node tools/doc-integrity-guard.mjs          # one verb: pointer cap, roadmap refs, runbook links, runbook headers
```

That instrument is what this runbook's advice turned into, because advice had already failed. Its four checks, and the
manual form of each if you want to see the raw evidence:

```bash
grep -c "the phrase you just wrote" docs/ROADMAP.md      # 0 = the edit is a rumour, whatever the tool reported
stat -c '%y %s' docs/ROADMAP.md                          # mtime older than your last commit = the file was never touched
git status --short -- docs/ROADMAP.md                    # clean after an "edit" means it did not happen
wc -l docs/NEXT.md                                       # see the cap trap below
grep -s "^| \[" docs/runbooks/README.md | grep -c "\](.*\.md)"   # index rows; compare with ls docs/runbooks/*.md | wc -l
```

## Do

1. **Never trust a write's return value — count after it.** `grep -c` the new phrase, `stat` the mtime, `git status` the
   path. A 6,400-line append-only file that shows clean after an "edit" means the edit never landed.
2. **Append to `docs/DECISIONS.md` / `docs/ROADMAP.md`; do not rewrite them in place.** They are full of apostrophes,
   backticks, backslashes, em dashes, `$` and quoted shell lines, so an exact-match edit misses, and a whole-file rewrite
   reflows lines you never touched — which the citation checker then reports as *your* findings.
3. **Watch the nested-heredoc trap.** `cat > f <<'EOF'` whose body contains an example ending in a bare `EOF` terminates
   at that inner line and **runs the rest of your document as shell**. This runbook was itself truncated that way at 29 of
   ~60 lines, with `bash: has: command not found` and `sed: unknown command: '<'` as the only clue, and a zero exit status.
   Either use the `write` tool for content that contains heredocs, or pick an outer delimiter that cannot appear inside
   (e.g. `<<'RUNBOOK_EOF'` — the delimiter used when appending the memory section to the verifier runbook).
4. **Do not put shell snippets inside a `python3` heredoc's string literals** — Python strips backslashes and ends the
   string on the embedded quote, so you get a Python error far from the cause. Put the block in a temp file, or splice by
   line number.
5. **The pointer cap is counted as `split("\n")`, so `wc -l` ≤ 199 is the passing maximum.** Seen in order: 224 → FAIL;
   then the test's own message, "…is 201 lines; the cap is 200"; and a file at 200 by `wc -l` → **still FAILS**, because
   the trailing newline counts as a line. Re-run `node demo/next-pointer.test.mjs` after every trim.
6. **Copy the archived pointer, never retype it,** then prove the copy *and* the offset in one command — a range one line
   short still looks complete:

   ```bash
   diff <(git show <sha-NEXT-had-before>:docs/NEXT.md) <(sed -n '<start>,<end>p' docs/NEXT-ARCHIVE.md)   # silent = proof
   ```

7. **Check shas you quote.** Three commit ids written into a session note from memory did not exist as objects.
   `git cat-file -e <sha>^{commit}` before you cite one; `git log --oneline -1` after every commit, because an amended
   message changes the id you were about to quote.
8. **New runbook ⇒ write the front matter from `_template.md`.** `runbook`, `symptom`, `writes`, `precondition`,
   `last_verified`, `verified_by`, `evidence`, `check_rule`, then the fixed headings (`When to use`, `Impact`,
   `Preconditions`, `Diagnose (read-only)`, `Do`, `Verify`, `If it fails`, `Escalate to`, `Evidence`). Add the index row
   in `docs/runbooks/README.md` — the symptom → runbook table is how anyone finds it.
9. **A red `review-cite-check.mjs` may be pre-existing; bound it before you report or act.** `tools/citation-registry.json`
   turns any path it cannot match into a soft finding (56 at one point), and `docs/ROADMAP.md:4905` was flagged before this
   session. Run it over the files your commit touched, and report the scope in the same breath as the verdict. Do not claim
   tree-wide `0 failing` when the tree is not.

## Verify

```bash
node tools/doc-integrity-guard.mjs                        # expect: DOC INTEGRITY GUARD … 0 hard findings, exit 0
node demo/next-pointer.test.mjs                           # NEXT POINTER TEST PASS
node tools/review-cite-check.mjs <the paths you staged>   # VERDICT: 0 failing …  exit 0
```

Note that `"224 lines"` written next to a path citation on the same line is read by the citation checker as a **size claim
about that file**, and `swapon`/`free`-style instruments can silently print `NaN` when you parse their header line — both
produced findings this session. Re-run the checker after rewording.

## A cited FIGURE must carry its measurement, or it must say it is unverified

A path citation can be checked with `test -e`; a **number** (a port, a token count, a latency, a row count) can only be
checked against the probe that produced it. So a figure you took from a measurement is admissible in a live doc only when
it carries **(a) the date it was measured and (b) the command that re-derives it**. If you cannot re-run the probe, write
the date, write `NOT re-verified`, and say what is missing — a labelled gap beats a silent number, and a bare number is
how a stale value survives a docs refresh: the refresh carries the number forward and nobody re-measures it.

Measured instance, 2026-11-06T08:0xZ (same host as `docs/NEXT.md`; no hostname per D205). A runbook and a roadmap row
cited the app's LAN share as `127.0.0.1:47832` / `0.0.0.0:47832` with no measurement date attached where the prose was
operational. Re-measuring: `curl -s -w 'HTTP %{http_code}\n' http://127.0.0.1:47832/v1/models` → `HTTP 000`, **exit 7**
(ECONNREFUSED); same for `:47831`. The live listener was `0.0.0.0:8080`, and `ps -eo pid,args | grep -E
'serve\.server|strata --serve'` showed the launch's own `--host 0.0.0.0 --port 8080` — the port is a launch argument
(`sharePort = findFreePort(STRATA_SHARE_PORT ?? PORT + 1)`), never a constant, and two `ss` runs inside the same hour
disagreed on the bind (`127.0.0.1:8080`, then `0.0.0.0:8080`) because the server restarted between them. The firewall
figures in the same section could **not** be re-measured at all: every `firewall-cmd` verb returned a D-Bus `Did not
receive a reply` error with **exit 254** — recorded as unverified, not re-asserted.

Find the cites worth re-dating (read-only):

```bash
git grep -nE '(127\.0\.0\.1|0\.0\.0\.0|localhost):[0-9]{4,5}' -- docs README.md | grep -v NEXT-ARCHIVE
```

**Archives are exempt by design.** `docs/NEXT-ARCHIVE.md` keeps superseded session text **verbatim** (the pointer says so
explicitly), so stale figures there are the historical record, not a live claim; the live surfaces are `docs/NEXT.md`,
`docs/STATUS.md`, `docs/FEATURES.md`, `docs/runbooks/*` and the README, and those are where a figure owes its measurement.

## A number in a roadmap or spec row must say INTENDED or RESOLVED, and name the tree it was measured on

Standing intake rule, from lead's ruling on #6080 (folded out of #6077): the decision itself already lives in
#6062/#6065/#6068, so minting a DECISIONS entry to relay it would duplicate a recorded ruling (lead cites #5568 for that
prohibition — I did not find it as text in `docs/DECISIONS.md`, so treat it as lead's ruling, not a doc I checked). A
runbook is the retrievable home for an operating procedure. Every number a row carries gets one of two tags, and the tag is not
optional:

- **RESOLVED** — what the code or the shipped dependency actually returns. Must name the **tree sha** and the
  **dependency set** it was read from, e.g. "`main 503ff096`, `@earendil-works/pi-durable` 1.3.0 as resolved by
  `package.json` + `package-lock.json`".
- **INTENDED** — a schedule, a proposal, a value someone wants to arm. Must say so in those words, and must not be
  written as if it is already in force.

A number with neither tag is not evidence: the reader cannot tell a measured fact from a wish, and a docs refresh carries
it forward unexamined.

**Worked instance (#6077, 2026-11-09).** `docs/ROADMAP.md` row 331 asserted the compaction thresholds
`159,040 / 126,272 / 24,000` — **INTENDED**, not the policy in force; qa's measured set is on `main 09a94b4c` — as if
they were what a seat gets. qa could not reproduce them on `main 09a94b4c` by either route (flat
defaults, window 204,800 → `188,416 / 155,648 / 20,000`; nested map honoured → `184,320 / 151,552 / 20,000`). Those
figures are **INTENDED** and live in `docs/DECISIONS.md` (rulings 4-7) and
`docs/reviews/task-completion-milestone-intake-2026-11-07.md:150` — not in the row that quoted them. Find them read-only:

```bash
grep -rnE "159,040|126,272" docs/ src/ demo/     # every hit now carries an INTENDED/RESOLVED tag (#6105, 2026-11-10); the measured set is qa's on `main 09a94b4c` — exit 0
```

**The tag must name the dependency set, not only the tree (#6105, measured 2026-11-10).** The carrying probe,
`docs/evidence/2026-11-08-context-window/compaction-policy-probe.mjs`, exits **1** on the lockfile pin **1.3.0**
(`TypeError: compactionPolicy is not a function` — that release's `dist/harness/compaction.js` exports
`CompactionTask, selectCut, summarizedMessages, estimateContext, serializeConversation` and no `compactionPolicy`);
run where **1.5.1** is installed it exits 0 and prints `reserve=16384 keepRecent=20000 background=32768` for every
family. A RESOLVED figure is only re-checkable if it names the tree *and* the dependency set it was read from.

The same row carried a **dead dependency citation**: `dist/harness/compaction.js:195-196`, attributed to
`compactionPolicy`. On the resolved 1.3.0 package line 196 is `export function selectCut(view, keepRecentTokens)`, and
`grep -rn "modelOverrides" node_modules/@earendil-works/pi-durable/dist` returns **0 hits (exit 1)** — the package ships
no `src/` at all, so a `src/harness/*.ts:NN` pointer in a doc cannot be checked against what the rig resolves. Strike the
citation, or replace it with the function that exists: `dist/harness/agent.js:10-15` holds `DEFAULT_COMPACTION_POLICY`,
`dist/harness/generation.js:223-229` computes the thresholds.

**Do NOT turn this into a `check` rule without a scan.** The precedent is #3539: a dangling-citation rule would have
started **498-red** across 97 docs and got disabled. A rule nobody can pass is not a rule. Re-measured on `main
503ff096` (exit 0):

```bash
awk '/^\| *[0-9]+ *\|/ {rows++; if (/[0-9]{3}/ && !/INTENDED|RESOLVED/) bad++} END{print rows, bad}' docs/ROADMAP.md
```

→ `49 48`: of 49 roadmap **table** rows, **48 carry a 3+ digit number with no tag**. Scope warning: `node tools/doc-integrity-guard.mjs` counts **352 registered items** in `docs/ROADMAP.md` (exit 0, run on this tree 2026-11-09) because items are also registered as `**NN.**` and `NN.` list lines — so 48 covers the table only, and any rule must be scoped per item, not per row. The corpus cannot start green, so the
rule stays prose. If a check is ever wanted it must apply to new or edited rows only, and this count must be re-measured
on the day it is enabled.

## If it fails

Nothing here writes, so there is nothing to roll back except your own edits: `git checkout -- <path>` restores a doc you
mangled, and `git restore --staged <path>` unstages. If a *registered roadmap item* is missing (my 260/261 case), re-append
it and re-count; do not edit the pointer's citation, fix the target. If a runbook refuses to conform, `docs/runbooks/_template.md`
is the source of truth, not this file.

## Escalate to

`pm` — when a doc-integrity finding is about the *product's* audit surface rather than a delegate's writes: **262** asks that
`cli.mjs check` actually supply runbook data (today it answers `no runbook data was supplied, so no runbook can be judged`
for `runbook-stale`, `runbook-unverified` and `runbook-front-matter`) and that `scripts/clockin.mjs:123` stop skipping a
runbook that has no front matter at all. The operator decides whether a doc-hygiene item outranks a queued feature.

## Evidence

Registered as **262**. Instruments: `tools/doc-integrity-guard.mjs` (this session) over `docs/NEXT.md`, `docs/DECISIONS.md`,
`docs/ROADMAP.md`, `docs/runbooks/README.md`. Counts observed when it first ran, all mine: `docs/NEXT.md` 200 lines
(over cap); `docs/ROADMAP.md` items 260/261 registered=missing while cited; `docs/runbooks/README.md` 46 index rows vs 32
runbook files; `docs/runbooks/delegate-doc-hygiene.md` front matter **absent** — the file this runbook describes was itself
non-conformant until fixed in the same commit that added the guard.

The figure-carrying-its-measurement rule above was folded in under item **#5193** (2026-11-06) rather than registered as a
second docs-truth row. Probes listed there were run that hour; the `firewall-cmd` leg is recorded **unverified** (exit 254).
The live half of the change is in `docs/runbooks/local-provider-down.md`, where the port literals became probes.

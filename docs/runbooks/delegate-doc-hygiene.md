---
runbook: delegate-doc-hygiene
symptom: "an edit reported success but the text is not in the file; the NEXT pointer went red on its line cap; a citation check flags findings you did not make; a commit sha you quoted turns out not to exist; a `cat >> file <<'EOF'` executed part of its own body as shell; you added a runbook and nothing noticed; a doc states a count (`check` runs eight rules) that nobody can re-check; you are about to mint a DECISIONS entry for a ruling the record already holds and the only trace of the convention is a closed queue row (#5568); a `see D115` citation resolves to more than one entry"
writes: false
precondition: "read-only"
last_verified: 2026-11-11
verified_by: scribe
evidence: "**Re-run 2026-11-11 by scribe (item #6332)** in the `item-6332` worktree off `main 35001c3a`: `grep -n 'referenced, not restated' docs/runbooks/delegate-doc-hygiene.md` → exit 0, 4 matches (the section heading, the Verify leg, the test leg, and this evidence line itself); `node tools/doc-integrity-guard.mjs` → VERDICT 0 hard, 0 soft, exit 0; `node tools/review-cite-check.mjs docs/runbooks/delegate-doc-hygiene.md docs/runbooks/branch-cleanup.md` → 0 failing of 42, exit 0; `node demo/next-pointer.test.mjs` → PASS, exit 0; `grep -ni relay src/checkup.mjs tools/doc-integrity-guard.mjs` → no matches, exit 1 (no enforcement, as the new section states). **SCOPED**: those legs only — the older sha-citation and heredoc legs were not re-run. PARTIAL re-run 2026-11-09 by scribe (item #6080): the INTENDED-vs-RESOLVED section added under #6077/#6080 was checked with `node tools/doc-integrity-guard.mjs`, `node demo/next-pointer.test.mjs` and `node tools/review-cite-check.mjs docs/runbooks/delegate-doc-hygiene.md` in the item-6080 worktree at main `503ff096` (each exit code recorded in the completion); the corpus scan `awk '/^\| *[0-9]+ *\|/ {rows++; if (/[0-9]{3}/ && !/INTENDED|RESOLVED/) bad++} END{print rows, bad}' docs/ROADMAP.md` → `49 48`, exit 0. **Re-measured 2026-11-10 by devtools (item #6110) on `main f192f543`: the same awk → `54 52`, exit 0; `node tools/doc-integrity-guard.mjs` → exit 0 (`0 hard, 0 soft`, 357 registered items, 54 runbooks); `node tools/review-cite-check.mjs docs/runbooks/delegate-doc-hygiene.md docs/runbooks/README.md` → exit 0 (0 failing of 41 findings). SCOPED: those three legs plus the README index row were re-run; the older sha-citation and heredoc legs were not. Also measured on the same tree: `node scripts/test.mjs --all --jobs 6` → 282/282, exit 0, in a worktree whose `sync-pi --link` succeeded (`dependencySet: built-pin`, pi-durable 1.5.1)." Re-measured 2026-11-10 by devtools (item #6155) in the item-6155 worktree: `node cli.mjs check rig.selfdev.json --json` → exit 0, `doc-count-drift: pass` (23 rules declared, 2 doc claims read, all consistent); the same command with `docs/WORKFLOWS.md` deliberately set to "eight rules" → exit 0, `summary.fix-now: 1`, finding `docs/WORKFLOWS.md:293 claims check has 8 rules; the code declares 23`; `node demo/doc-count-drift.test.mjs` → exit 1 with the wrong count, exit 0 with the right one. Earlier legs (2026-11-06, delegate): `node tools/doc-integrity-guard.mjs` → **exit 0** (`0 hard, 1 soft`) after the figure-carrying-its-measurement section was added, and the port probes in that section were run that hour; `last_verified` is NOT raised because the older sha-citation and heredoc legs were not re-run. docs/ROADMAP.md **262**; commit c34bb232 of this session (HEAD at the time of writing; verified with `git cat-file -e`); every command below was run 2026-10-29 on Linux (Fedora, box label-withheld-per-D205, node v24.22.1); the failure counts are from this session's own mistakes. PARTIAL re-run 2026-11-09 by scribe (item #6080): the INTENDED-vs-RESOLVED section added under #6077/#6080 was checked with `node tools/doc-integrity-guard.mjs`, `node demo/next-pointer.test.mjs` and `node tools/review-cite-check.mjs docs/runbooks/delegate-doc-hygiene.md` in the item-6080 worktree at main `503ff096` (each exit code recorded in the completion); the failure counts are from this session's own mistakes. Re-measured 2026-11-11 by devtools (item #6344) in the item-6344 worktree off `main 35001c3a`: `node tools/doc-integrity-guard.mjs` → **exit 1** (19 hard, 14 soft) — the ledger rule is new and the ledger is not yet clean; `node demo/doc-integrity-ledger.test.mjs` → exit 0; `node tools/review-cite-check.mjs docs/DECISIONS.md` → exit 1 (23 failing of 174 findings). Re-measured 2026-11-14 by the delegate in the item-6344 recut worktree off `main 8b5a19e1` (Linux, Fedora Linux 45, kernel 7.2.15-300.fc45.x86_64, node v24.22.1): the same command → **exit 1** (2 hard, 16 soft) — the ledger was partly cleaned since #6344 minted the rule, which is why the guard's exit code is derived from the file rather than pinned to a tree; `node demo/doc-integrity-ledger.test.mjs` → exit 0. `last_verified` NOT raised: the older sha-citation and heredoc legs were not re-run"
check_rule: "doc-count-drift (#6155) for the declared-set counts section below; `runbook-front-matter` still reports UNKNOWN from `cli.mjs check` — see docs/ROADMAP.md **262**"
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
node tools/doc-integrity-guard.mjs          # one verb: pointer cap, roadmap refs, runbook links, runbook headers, ledger D-numbers
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
10. **If your file QUOTES another report's footnote markers, say so in the file.** `tools/review-cite-check.mjs:520` reads
    `<!-- cite-ns: quoted -->`; with the declaration a `[^key]` that has no definition in that file is reported **soft**, without
    it it is **hard** and the checker exits 1 (`:527`). The convention is recorded in `docs/DECISIONS.md:6206` ("Suppression is
    counted, never silent") and is live in `docs/NEXT-ARCHIVE.md` (7044, 7295, 7494, 7701, ...). Measured 2026-11-12 in this
    item's worktree on `main ed84f0b4`: a one-line scratch file using `[^P3]` with no definition gave `HARD DANGLING KEY 1` /
    "VERDICT: 1 failing, 37 not failing (of 38 findings)" / **exit 1**; the same content with the declaration gave `SOFT DANGLING
    KEY 1 (hard 0 + not-failing 1)` / "VERDICT: 0 failing, 38 not failing" / **exit 0** (both scratch files deleted afterwards).
    Do **not** add the declaration to an append-only ledger on your own initiative: whether `docs/DISPOSITIONS.md` should carry
    it is UNDECIDED, routed to lead as #6462 and to be settled with #3539 (a whole-corpus scoping ruling). As of this
    measurement `docs/DISPOSITIONS.md` has no footnote markers at all (`grep -c '\[\^' docs/DISPOSITIONS.md` -> 0, exit 1) and
    no declaration (`grep -c 'cite-ns' docs/DISPOSITIONS.md` -> 0, exit 1), so renaming one key fixes one row while the next
    appended row re-arms the same hard finding — which is why the posture has to be a file-level decision, not a per-row patch.
11. **Scope a commit by explicit paths, and read the refusal instead of retrying blindly.** The shape that lands is `git add -- <paths>` then `git commit -F <msg>` (the message lives in gitignored `.spike/`). Measured 2026-11-15: `git commit -F .spike/msg-cap.txt -- docs/NEXT.md -- docs/NEXT-ARCHIVE.md` exits **1** with `error: pathspec '--' did not match any file(s) known to git` and leaves both files **STAGED**, so the session looks unchanged and the next call silently commits whatever is in the index. Prove the boundary after the commit, not before it: `git show --name-only --format= HEAD` must name exactly the paths you meant (measured: two paths, 12 insertions / 8 deletions).

## Verify

```bash
node tools/doc-integrity-guard.mjs                        # expect: DOC INTEGRITY GUARD … 0 hard findings, exit 0
node demo/next-pointer.test.mjs                           # NEXT POINTER TEST PASS
node tools/review-cite-check.mjs <the paths you staged>   # VERDICT: 0 failing …  exit 0
node tools/review-cite-check.mjs docs/DISPOSITIONS.md     # posture check: DANGLING KEY reported hard or soft per the cite-ns declaration
The cite-ns leg was re-run 2026-11-12 by scribe (item #6463) on `main ed84f0b4` with the two probe files described in Do step 10
(undeclared -> exit 1, declared -> exit 0). The other legs of this Verify section were not re-run on that date.

grep -n 'referenced, not restated' docs/runbooks/delegate-doc-hygiene.md   # >= 1 — the relay rule is retrievable text
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
#6062/#6065/#6068, so minting a DECISIONS entry to relay it would duplicate a recorded ruling. The prohibition is
#5568 — a DONE queue row with no read path (#3486), so the id alone is a dead pin; its text now lives in
`docs/runbooks/branch-cleanup.md` **Step 0e** (added 2026-11-10, #6111), and it is deliberately absent from
`docs/DECISIONS.md`: `git grep -niE 'relays|relay a ruling' -- docs/DECISIONS.md` → no matches, exit 1. A
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

**The count is a snapshot, not a constant — re-measure it, do not quote the old one.** Same command, run 2026-11-10 by
devtools on `main f192f543` (exit 0): **`54 52`**. Five rows were added and four of them carry an untagged 3+ digit
number. Between `503ff096` and `f192f543` the corpus moved, which is exactly why the rule cannot be armed from a
remembered number.

## A ruling the record already holds is referenced, not restated (#5568; home fixed by #6332)

**The rule, in the form a seat can act on.** Before you append a `## D` entry to `docs/DECISIONS.md` or a row to
`docs/ROADMAP.md`, search for the decision. If it already exists as retrievable text — a runbook, a review, a
roadmap row — annotate that place. Do not create a second copy of the ruling.

Three clauses, because the second is the one seats miss:

1. **Reference, do not restate.** The new text points at the place that holds the rule instead of paraphrasing it
   into a fresh entry. Two copies of one ruling drift apart, and the drift is invisible until two seats cite
   different ones — the same ambiguity the duplicate-heading census in `docs/DECISIONS.md` shows.
2. **The reference has to be checkable.** Name the file and the section. If you also cite a queue row, write out
   what the rule *is*, because a DONE row has no read path (#3486): an id alone is a dead pin. That is why #5568's
   prohibition is spelled out in a runbook rather than living only as that number.
3. **The exception is not a loophole.** A rule that was recorded **nowhere** is not a relay — record it, in the home
   its type demands: an operating procedure in a runbook, a design choice in `docs/DECISIONS.md`. Reading "do not
   relay" as "do not write it down" is exactly how a genuine rule gets dropped, which is the failure this rule exists
   to prevent.

**Where it runs.** `docs/runbooks/branch-cleanup.md` **Step 0e** applies it at the moment of minting, with the
pre-mint search. This file is its home: the seat that needs it is the one doing the doc write, and it is already
reading here. Keep one wording — a third copy in another file is the defect the rule forbids.

**Nothing enforces it.** `grep -ni relay src/checkup.mjs tools/doc-integrity-guard.mjs` → **no matches, exit 1**
(measured 2026-11-11 in `item-6332` off `main 35001c3a`). It is prose with a working retrieval command, not a check
rule; that is the honest state, and the grep below is the only way to confirm the rule is actually in the text.

**The test, read-only, before you mint:**

```bash
git grep -niE '<a phrase from the ruling itself>' -- docs/DECISIONS.md docs/runbooks docs/reviews docs/ROADMAP.md
# hit  -> annotate the hit, do not mint;  no hit -> mint it in the home its type demands
grep -n 'referenced, not restated' docs/runbooks/delegate-doc-hygiene.md   # >= 1 — the rule is text, not only a closed row
```

## A COUNT of a set the code declares is a claim the code can re-check (#6155)

`docs/WORKFLOWS.md` said `check` runs "eight rules". Nobody had counted `src/checkup.mjs`'s `RULES`; the
real number was 22, and by the time this section was written it was 23. A bare number in prose is authority
without a source: it reads as fact, drifts silently as rules are added, and nothing catches it — the same
failure mode as a threshold nobody can reproduce.

The rule is now structural, not advisory:

```bash
node cli.mjs check rig.selfdev.json --json   # doc-count-drift: status pass, or a finding naming both numbers
node demo/doc-count-drift.test.mjs           # exit 0 green; exit 1 if a docs/*.md count disagrees
```

What the rule reads: `` `check` (N rules) `` and `` `metrics` (N measures) `` in **top-level** `docs/*.md`
(reviews and evidence are dated records, not live capability statements), compared against
`DECLARED_COUNTS` in `src/checkup.mjs` — `RULES.length` and `Object.keys(MEASURES).length`. Spelled numbers
("eight") parse; "a few rules" is reported as a claim nobody can verify. Severity is `fix-now`, so `check`
prints it but still exits 0; the demo suite is what goes red, and the landing gate runs the suite.

Write the count with its source, not as a bare assertion:

> `check` (24 rules, declared in `src/checkup.mjs` `RULES`; recount with `node -e "import('./src/checkup.mjs').then(m=>console.log(m.RULES.length))"`)

Or drop the number entirely and name the declaring export. Either is honest; a number without a source is not.

## A D-number in the ledger must name exactly one entry (#6344)

`docs/DECISIONS.md` is the citable record, and the guard now judges three things about it. The severity follows the
remedy, not the size of the finding:

- **D-number collisions — HARD.** One number heading several entries means "see D91" names nothing.
- **Unnumbered headings — HARD.** `## D###` and `## D-<mint>` are pre-merge drafts that reached the record; an entry
  nobody can cite is not a style problem.
- **Byte-identical body sentences (>=80 chars) in two different entries — SOFT.** A cross-reference legitimately
  repeats a sentence, and repetition *inside* one entry is not reported at all: that is the distinction between
  "same text, different entry" and "same text, same entry".

Check the raw evidence before believing the tool (measured 2026-11-11 in the item-6344 worktree off `main 35001c3a`):

```bash
grep -oE "^## D[0-9]+" docs/DECISIONS.md | sort | uniq -c | sort -rn | head   # 3 x D91; D111-D120, D258, D259 x2 each
node tools/doc-integrity-guard.mjs                                            # VERDICT: 19 hard, 14 soft -> exit 1
node demo/doc-integrity-ledger.test.mjs                                      # exit 0: fixtures prove each leg fires
```

**This red is pre-existing, not yours.** The rule landed (2026-11-11, #6344) before the ledger was cleaned; the cleanup
is row #6352, and this row was explicitly told not to edit `docs/DECISIONS.md`. Do not "fix" a collision by renumbering
a neighbour — mint the missing number or fold the duplicate into the entry it repeats. The citation debt is separate and
also pre-existing: `node tools/review-cite-check.mjs docs/DECISIONS.md` -> `23 failing, 151 not failing (of 174 findings)`,
exit 1, on the untouched copy (the row quoted 23/142 of 165 on `main f192f543` — the corpus grows, the count does not
stay true, which is itself the point of citing a tree).

## The pointer's cadence rows: ONE call writes them — `tools/pointer-row-for-predecessor.mjs`

**Symptom:** `tools/pointer-sha-coverage.mjs` exits 1 and prints `MISSING <sha> <subject>` lines, or
the chase is costing one commit per commit (measured 2026-11-15: one window paid **eight** rows-only
commits to close one chain, each paying its own ~13 s of doc gates).

**The call, before you commit:**

```bash
node tools/pointer-row-for-predecessor.mjs --base=<base-sha> --for=HEAD --order   # 1.6-3.4 s, exit 0/1
node tools/pointer-row-for-predecessor.mjs --base=<base-sha> --dry-run             # names the rows, writes nothing
```

It spawns the AUDIT (`tools/pointer-sha-coverage.mjs --json`) and reads its `missing[]` — it never
re-derives the hole set here, which is the pair-of-spellings defect — appends one row per hole **in
commit order at the BOTTOM** of the live table, text from git's OWN subject line (pitfall 398's shape
two: a retyped row label is a lie the gate cannot see), then re-audits and reports the audit's verdict,
so the close is PROVEN by the same reader the gate uses. `--for=HEAD` also pays the row the coming
commit will owe, because HEAD can never name itself in the commit that carries it (pitfall 384) —
that is what makes the whole cadence ONE call instead of one commit per commit. A planning pass writes
nothing and says so; a row already present is not added twice. **`--order` closes the OTHER shape the
audit reports:** an ordering defect is not fixable by appending rows — without the flag the tool exits
1 and says exactly that rather than papering it over — but with it the tool PERMUTES the table's
existing rows into the order the audit reports in its `ordered` field (the audit is the ONE derivation
of both the verdict and the order; re-sorting from a second `git log` here would be a second spelling
of one rule). The move is mechanical: every row text that leaves the file is the text that came in, so
a reorder cannot be a place to invent a row label, and rows naming shas outside the audited range keep
their position. Appending a row for an OLD hole at the bottom is what creates an ordering defect, so
`--order` is what makes the one call close BOTH shapes instead of paying another commit per shape.

**The flag trap that used to make this invisible:** `tools/pointer-sha-coverage.mjs` took ONLY the
space form; `--base=<ref>` was ignored, the range fell back to `merge-base(origin/main, HEAD)`, and
the tool audited 37 of 197 commits while still exiting **0** (measured at `247a6211a`) — a FALSE green
that made the next window's cadence look closed. The audit now REFUSES the `=` form (exit 2) and the
closer REFUSES the space form; each says which form it reads. Never conclude "covered" from one flag
form — read the `range … (<baseLabel>)` line the audit prints.

**Cost and host, measured:** 1.607 s for a 0-hole `--dry-run` over a 227-commit range (measured at
`4ea4101b7`); **3.4 s** for the live pre-commit call `node tools/pointer-row-for-predecessor.mjs
--base=8b5a19e1 --for=HEAD --order` (1 row written, 233-commit range, three audit passes) and **1.244 s**
for the instrument's own test (`node tools/pointer-row-for-predecessor-test.mjs`, **38 checks / 0 FAIL**,
registered in the `toolchain` area of `demo/test-areas.json`) — all on Linux, Fedora Linux 45 (Forty Five),
kernel 7.2.15-300.fc45.x86_64, node v24.22.1, git 2.56.0. Re-measure rather than trust.

**last_verified:** 2026-11-15 at `edd22c534` by `node tools/pointer-row-for-predecessor-test.mjs` (exit
0, 38 checks / 0 FAIL, 1.244 s) plus `node tools/pointer-sha-coverage.mjs --base 8b5a19e1` (exit 0,
233 range commits, 0 holes / 0 ordering defects) and `node tools/pointer-sha-coverage-test.mjs` (exit
0). The `--order` legs are pinned by fixtures, not by the live pointer: the live table had 0 ordering
defects at that commit, so the reorder is proven only on the throwaway repo.

**THE CAP, AND THE TWO REDS ONE BREACH CAUSES (measured 2026-11-15 at `76b1298f`).** A `docs/NEXT.md` over its
200-line cap turns **two** areas red from **one** cause: `node tools/doc-integrity-guard.mjs` exits **1** with a single
`HARD POINTER` finding (`docs/NEXT.md counts 202 lines (split("\n")); the cap is 200, i.e. `wc -l` <= 199`), and that
exit 1 also makes `demo/doc-integrity-ledger.test.mjs` FAIL in the **check** area on its "the guard is red exactly when
the real ledger has collisions or unnumbered headings" leg — while the ledger itself prints **0 D-number collision(s),
0 unnumbered heading(s)**. So the ledger chase is a dead end: read the guard's `HARD POINTER` line first, and fix the
cap the way the guard names. Move the OLDEST **table rows** out to `docs/NEXT-ARCHIVE.md` under a dated heading, VERBATIM,
and PROVE the cut in the same commit: `head(post) + moved + tail(post)` is byte-identical to `git show <pre-cut sha>:docs/NEXT.md`
(measured this window: 8 rows / 2,086 B, proof byte-identical over a 60,988-char file; `demo/next-pointer.test.mjs` then PASS
exit 0, 0.04 s; `--area docs` **8/8** and `--area check` **18/18** green, both `--jobs 4`). A cut of the pointer's PROSE instead
pays the clock-in digest (pitfall 392); a cut of table rows pays **ZERO** digest bytes because the rows sit above the
`## NEXT SESSION` slice — that is the cheaper shape when the file is long and the slice is not.

**The cap cut, re-measured 2026-11-15 at `f69dd23d0` — ONE commit carries BOTH the cadence row and the cut.** 8 OLDEST table rows / 2,059 B over a 63,722 B file: `wc -l` 195 to 187 (split("\\n") 196 to 188; the cap is 200, i.e. `wc -l` <= 199), table rows 114 to 106. The closer ran BEFORE the commit (`node tools/pointer-row-for-predecessor.mjs --base=8b5a19e1 --for=HEAD --order`, exit 0, 1 row written, re-audit 0 holes / 0 ordering defects), then `.spike/cut-cap.mjs` moved the rows and proved the move in the same call: `head(pre) + moved + tail(pre) === pre` positional identity, and `archive2.lastIndexOf(moved) >= 0`.

**The rows-above-the-slice fact, proven by the slice's own byte count rather than claimed:** `awk -v n="$(grep -n '^## NEXT SESSION$' docs/NEXT.md | cut -d: -f1)" 'NR>=n' docs/NEXT.md | wc -c` printed **8,061 B UNCHANGED** across the cut while the slice's first line moved from 120 to 128 — a rows-only move changes the slice's position but not one byte of its content, so it costs the clock-in digest ZERO bytes; `node scripts/clockin.mjs` stayed exit 0 (11.8 s), and its `--json` prints `## POINTER (docs/NEXT.md lines 128-188 of 188; cap 200)`.

**Gates at that tree, every exit code captured on Linux, Fedora Linux 45 (Forty Five), kernel `7.2.15-300.fc45.x86_64`, node v24.22.1, git 2.56.0:** `tools/pointer-sha-coverage.mjs --base 8b5a19e1` exit 0 over 270 range commits, **106** `docs/NEXT.md` rows + **223** `docs/NEXT-ARCHIVE.md` rows — the cut rows are counted from the archive, which is why a VERBATIM move can never open a hole; `tools/doc-integrity-guard.mjs` exit 0 (0 hard / 25 soft); `demo/next-pointer.test.mjs` exit 0; `node scripts/test.mjs --area docs --jobs 4` 8/8 in 69.8 s and `--area check --jobs 4` 18/18 in 11.6 s, both PROVENANCE `tree=f69dd23d0`, `.err` 0 B each. `tools/review-cite-check.mjs docs/NEXT.md docs/NEXT-ARCHIVE.md` exits **1** with 6 hard — all six PRE-EXISTING in the archive at lines 5815..6629 (five `metagpt/docs/ROADMAP.md:2875` LINE-OUT-OF-RANGE plus one elided vendor path), ZERO at the appended region past line 15324: the scope is reported in the same breath as the verdict, per Do step 9.

**Headroom is the NEXT window's debt, not this one's:** 187 of 199 passing maximums, and each cadence commit adds 1-2 table rows, so cut BEFORE the breach turns red rather than after.

## The cap cut is ONE call now — `tools/pointer-table-trim.mjs` (and the half-cut it exists to catch)

**Symptom:** `node demo/next-pointer.test.mjs` exits 1 with `docs/NEXT.md must stay a pointer: 201 lines exceeds
the 200-line cap`, or `tools/doc-integrity-guard.mjs` prints `HARD POINTER`. Paying the cap BY HAND cost FOUR
separate cuts in one window (2026-11-16: `82d5bebbf`, `9fb43e341`, `f69dd23d0`, plus one left on disk UNFINISHED),
and the unfinished one is the trap this instrument exists to catch: `docs/NEXT-ARCHIVE.md` gained a `**Moved VERBATIM**`
block whose CUT was never applied, so four row lines were VERBATIM in **both** files — `demo/next-pointer.test.mjs`,
`tools/pointer-sha-coverage.mjs` and `tools/doc-integrity-guard.mjs` all stayed exit 0 over it. A fifth shape of
pitfall 398 (a doc that passes every gate while lying): the archive CLAIMS a move the live file never made.

**The call:**

```bash
node tools/pointer-table-trim.mjs --base=8b5a19e1 --to=185                    # 2.3 s, exit 0/1 — a PLAN: names the rows, writes NOTHING
node tools/pointer-table-trim.mjs --base=8b5a19e1 --to=185 --writes          # the cut: moves the rows, proves the move, exit 0
```

Without `--writes` the call only plans, so an instrument that re-runs the pointer's `Run these first` block
(`tools/cost-claim-audit.mjs` spawns those lines) cannot perform a cut by accident — and that audit REFUSES a
line carrying `--writes` (`FORBIDDEN_SUB`), because a measurement never writes a doc.

**What the tool guarantees, each one checked against the bytes on disk AFTER the write** (runbook Do step 1:
never trust a write's return value, count after it): `head + the moved rows + tail`, rebuilt from the file as it
is NOW by re-inserting at the position the removed block started, equals the pre-cut file EXACTLY; the archive's
older bytes are intact (append-only); each moved row is in the archive exactly once; no moved row survives in
the live file; the live file keeps its link to the archive. It REFUSES, writing nothing, when a row line is
VERBATIM in both files (the half-cut above), when more lines are owed than there are table rows (a cut moves ROWS,
never the pointer's prose), and when `--base=` is given and the ORDER audit reports an ordering defect — because
this tool moves the FIRST rows, and "first = oldest" is the audit's derivation, never re-spelled here.

**Cost and host, measured 2026-11-16:** 2.34 s for the writing pass over the LIVE pointer (`node tools/pointer-table-trim.mjs
--base=8b5a19e1 --to=185 --writes` → 16 rows moved, exit 0, `.err` 0 B), 2.29 s for the same call as a plan, 0.25 s
for a refusal; the pinned test `node tools/pointer-table-trim-test.mjs` PASS, **47 checks / 0 FAIL, 0.661 s, `.err` 0 B**
(fixture pointers in a throwaway tmpdir repo — no store, no network, no model), registered in the `toolchain` area of
`demo/test-areas.json`. Red-first: point the test at the pre-change `tools/` (`git archive HEAD tools | tar -x -C
.spike/prechange-trim`, which carries **0** files matching `pointer-table-trim`) → exit 1, 33 FAIL, 3 × `Cannot find module`
(`.spike/trim-red.out`). All on Linux, Fedora Linux 45 (Forty Five), kernel `7.2.15-300.fc45.x86_64`, node v24.22.1, git 2.56.0.

**The two counts the tool keeps straight:** the cap is `split("\n")`, so 201 lines is ONE over and `wc -l` 200 already
fails (Do step 5); and a TABLE ROW costs the clock-in digest ZERO bytes, because the digest slice is the `## NEXT SESSION`
block and the table sits above it (§43 NINTH/TENTH, re-proven 2026-11-16) — so a rows-only cut buys the LINE cap and
nothing else, while a PROSE cut is what pays the byte budget (pitfall 392).

**last_verified:** 2026-11-16 by `node tools/pointer-table-trim-test.mjs` (exit 0, 47 checks / 0 FAIL, 0.661 s) plus the
live cut above (`docs/NEXT.md` 201 → 185 split lines, 126 → 110 table rows, 16 rows / 8,824 B moved into the archive, proof
byte-exact over a 63,200 B pre-cut file) and `node demo/next-pointer.test.mjs` exit 0 after it.

## The pointer's BYTE budget is ONE call too — `tools/pointer-prose-cut.mjs` (and the zero-cost cut it refuses)

**Symptom:** `node scripts/clockin.mjs --budget 1` exits **1** with
`clockin: digest is 20,337 B, over its 20000 B budget` — the pointer grew and the digest a cold session pays grew with
it. Paying that budget was a hand procedure five times in one window (2026-11-16: `aebebd9fc`, `b8dcceb47`,
`.spike/cut-five.mjs`, `.spike/fix-halfcut.mjs`, `.spike/cut-tally-clause.mjs`), and `.spike/cut-tally-clause.mjs` is
why the tool exists: it wrote the cut, failed its own rebuild check, exited 1 and archived **nothing**, so the text left
the live file and never reached the archive — a half-cut `tools/pointer-sha-coverage.mjs`, `tools/doc-integrity-guard.mjs`
and `scripts/clockin.mjs` all read as exit 0 (SELFDEV pitfall 412).

**The two currencies, and which tool pays which:** the pointer has a **LINE** cap (`POINTER_CAP_LINES = 200`,
`scripts/clockin.mjs:44`, read by `demo/next-pointer.test.mjs`) and the digest has a **BYTE** budget
(`DIGEST_BUDGET_BYTES = 20000`, `scripts/clockin.mjs:46`). Table rows pay the line cap and **ZERO** digest bytes — the
digest's slice is the `## NEXT SESSION` block and the table sits above it. Prose **inside that slice** is what pays the
bytes. So `tools/pointer-table-trim.mjs` moves rows (cheap currency) and `tools/pointer-prose-cut.mjs` moves prose
(the byte currency), and neither is interchangeable: a row moved by the prose tool would add a row line to the archive,
which is the file the coverage audit compares, so the prose tool REFUSES a chunk carrying a row line; a prose clause
above the slice is refused with `FINDING outside-the-slice` because it pays the byte budget nothing.

**The call:**

```bash
node tools/pointer-prose-cut.mjs --cuts=.spike/cuts.json --dry-run   # 0.05 s, exit 0/1 — names the clauses, their bytes and the slice delta, writes NOTHING
node tools/pointer-prose-cut.mjs --cuts=.spike/cuts.json             # the same plan; it still only writes with --writes (so a re-run of the pointer's block cannot cut)
node tools/pointer-prose-cut.mjs --cuts=.spike/cuts.json --writes    # apply: move the clauses VERBATIM, prove the move, exit 0
```

`.spike/cuts.json` is a session artifact — a JSON array of `{"from","to","repl"}` (the `to` anchor is taken INCLUSIVE and
searched after `from`, so a paragraph is named by its ends rather than retyped) or `{"chunk","repl"}`. `repl` defaults to
`""` and must be SHORTER than the chunk, so the call pays bytes rather than moving text around for no reason.

**What the tool proves, each against the bytes on disk AFTER the write:** the live file equals the plan applied to the
pre-cut text (every cut is resolved in the pre-cut file's coordinates, so two overlapping cuts are refused rather than
applied in a chain where the later anchor was chosen after the earlier cut moved the text); the archive still begins with
its older bytes; every clause sits in the appended region exactly once and nowhere in the live file; and the digest's own
slice — imported as `pointerSection` from `scripts/clockin.mjs:71-79`, the ONE derivation the digest uses, never
re-spelled here — shrank by exactly the bytes moved. A proof that fails says RECONCILE, and it can only fail after a
write: every refusal (absent anchor, ambiguous anchor, overlapping cuts, a chunk outside the slice, a chunk carrying a
pointer row, a replacement that does not shrink, a replacement that opens a `## ` heading, a chunk already VERBATIM in
the archive) writes nothing.

**Cost and host, measured 2026-11-16 at the tree `bff677f6d` carries** (Linux, Fedora Linux 45 (Forty Five), kernel
`7.2.15-300.fc45.x86_64`, node v24.22.1, git 2.56.0, hostname-free probe in the same command): a two-clause planning
pass over the live pointer **0.05 s** wall, exit 0, `.err` 0 B; a refusal **0.04–0.05 s**, exit 1, `.err` 0 B; the pinned
`node tools/pointer-prose-cut-test.mjs` **49 checks / 0 FAIL, 0.60 s**, `.err` 0 B (fixture pointer pairs in a throwaway
tmpdir repo — no store, no network, no model), registered in the `toolchain` area of `demo/test-areas.json` (45 → 46
members, suite 368 → 369). Red-first: `git archive HEAD tools | tar -x -C .spike/prechange-prose` carries **0** files
matching `pointer-prose-cut`, and the same test pointed there exits **1** with **33 FAIL** and **3 × `Cannot find module`**
(in the check details on stdout; `.err` 0 B). `node scripts/clockin.mjs --budget 1` (**12.6 s**) stays the reader's verdict
for the WHOLE digest — the tool proves the slice, the digest's reader proves the digest.

**The falsifier-building trap this session hit (SELFDEV pitfall 413):** a half-cut is a clause VERBATIM in the ARCHIVE *and*
still in the LIVE file. Cut the clause first and you get `anchor-absent`, not `half-cut` — the chunk is unique in the
pre-cut file by construction — so a fixture that only duplicates an archive entry is not a half-cut. Build the pair from a
pristine pointer plus an archive that already claims it.

**last_verified:** 2026-11-16 by `node tools/pointer-prose-cut-test.mjs` (exit 0, 49 checks / 0 FAIL, 0.60 s, `.err` 0 B),
the `toolchain` area `timeout 150 node scripts/test.mjs --area toolchain --jobs 4` (46/46, exit 0, 27.0 s, `.err` 0 B), and
the live digest read `node scripts/clockin.mjs --budget 1` (exit 1 by design at budget 1, digest 19,902 B of
`DIGEST_BUDGET_BYTES = 20000`, slice lines 133–187 of 187). `last_verified:` in this runbook's front matter is NOT raised:
the sha-citation and heredoc legs were not re-run.

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

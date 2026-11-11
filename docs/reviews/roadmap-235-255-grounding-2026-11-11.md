# ROADMAP 235-240 and 242-255, grounded one concern each

Provenance: written 2026-11-11 by devtools for lead's #6218, in worktree `item-6218` on tree
`35001c3a`, `dependencySet: lockfile-released`. Every number below is either quoted from
`docs/ROADMAP.md` with the line it came from, or measured here with the command named.

Read as an intent: lead asked for a table lead can mint rows from. Every number below is either
quoted from `docs/ROADMAP.md` (with the line it came from) or measured by me in this worktree, and
measured claims name the command and its exit code.

## First, the source problem

`docs/reviews/cross-os-rig-portability-2026-10-29.md` (168 lines) **does not contain any of these ids**.
The ids it names are 210, 217, 221, 232, 233, 254, 256, 260, 263, 266, 267
(`grep -noE "\b2[0-9]{2}\b"` on the file). Of the twenty ids lead asked about, **only 254 appears in
the review** - twice, at lines 44 ("the 254 class again") and 140 ("254/233 show how badly pins age").
So the concerns for 235-240 and 242-255 come from `docs/ROADMAP.md` itself, and the line numbers
below are the ones I read them at, in this tree.

Second, the scope verdict: **the portability constraints do not belong on most of these ids.** Only
235, 236, 237, 238, 239, 240 and 242 are about the rig running on a host. 243, 244, 249, 250, 251,
252 are citation-corpus integrity; 253 is the landing gate; 245, 246, 247, 248 are the guard plane;
254, 255 are local-model request budgets. Minting them all under the portability class would drag
"do not touch `src/worktree.mjs:649`" and "keep the orphan sweep fail-closed" onto rows that never
touch a worktree.

## The table

| id | concern, quoted from ROADMAP.md (line) | the ONE seam it touches | a named check that fails today, with what I ran | overlap verdict |
|---|---|---|---|---|
| 235 | "Every delegate instrument is reachable only as a `bash` string, and the harness has a project-scoped tool registry that was never turned on" (:4400) | the delegate harness tool registry (`.pi/` extension surface). **Not** the seat tool plane (`src/seattools.mjs`) - the row's own blind spot | `ls .pi` -> exit 1, "No such file or directory" (ran here) | none minted. 245, 246, 248 must carry `blockedBy` 235 |
| 236 | "Standing instruction surface is unbudgeted: `AGENTS.md` injects 5,765 B per request" (:4427) | the standing-prompt injection surface | `wc -c AGENTS.md` -> **13,777 B** (ran here; the row's 5,765 B is stale). A budget check `test $(wc -c < AGENTS.md) -le 8000` exits 1 today | splits with 235: each registered tool adds ~100 B of `promptSnippet`. One budget row, two inputs |
| 237 | "publishes percentages without naming its corpus, and the corpus is host-local" (:4451) | `tools/harness-usage-census.mjs` output header | `grep -c "corpus" tools/harness-usage-census.mjs` -> **0** (ran here) | merge with 244's date/host half: both are "a measurement must name its corpus" |
| 238 | "No shipped harness in the observed set guards `git worktree prune` or `git clean -fd`" (:4470) | the delegate `tool_call` guard | `grep -rn "worktree prune" .pi` -> exit 1 (no `.pi` dir at all) | **not** #4850 (ROADMAP 232), which is **cancelled**: `pruneWorktrees` still runs from inside the broker (`src/worktree.mjs:649`, verified by grep). The headline over-claims - Copilot CLI ships opt-in deny rules that name these verbs - so re-scope the row to "the ten observed systems" |
| 239 | "A delegate-authored file is recoverable from the harness's own session transcripts, and the only instruments that do it are untracked" (:4510) | `tools/transcript-recovery.mjs` | `ls tools/transcript-recovery.mjs tools/extract-pi-src.mjs` -> exit 0, both tracked (verified); the read-body extractor is still scratch | not a duplicate of #4848 (233). 239 is 233's class with a named instrument; only the read-body half and the runbook row remain |
| 240 | "Nothing in the rig turns a successful ad-hoc run into a reusable repo-committed recipe" (:4556) | recipe capture in the delegate skills surface | `ls .pi/recipes` -> exit 1 | gated on 235; shares 236's budget |
| 242 | "prints `_not fetched_` for prefixed tag schemes, so the pin table under-reports drift" (:4659) | **two seams - split it**: (i) tag reporting, (ii) the pin record carries no remote URL | `grep -c "_not fetched_" docs/VENDOR-PINS.md` -> **3** (ran here); `grep -n "remote" docs/VENDOR-PINS.md` finds only the column definition, never a per-row remote | distinct from ROADMAP 220 (the **pi** pin invariants). Name the object in both subjects, or they will read as one row |
| 243 | "A delivered research report cited a fetched-page corpus it never delivered: 50 of 64 in-body anchors are unopenable" (:4679) | `inputs/fetched/MANIFEST.md` + `docs/runbooks/research-request.md` | the manifest is tracked (`grep -n "inputs/fetched" .gitignore` -> only `*.html` is ignored) | same family as 250 and 252; do not mint three rows that own one checker |
| 244 | "A cited incident file has never existed in any branch, and this rig's measurement dates name no host or timezone" (:4734) | measurement labelling in docs | `git log --all --oneline -- docs/incidents/2026-10-29-windows-vm-suite-self-sweep.md \| wc -l` -> **0** (ran here) | the phantom-file half is closed by the operator ruling ("Forget about the phantom citation") and is 233's class (#4848, held). Keep only the date/host half |
| 245 | "Guard trust should be keyed to the guard's content and writable only from above the project layer" (:4774) | guard trust state, above the project layer | `grep -rln "guard-status\|guardStatus" tools src scripts` -> 1 hit, `scripts/clockin.mjs`: there is no guard plane to trust | must NOT merge with 247 - the row says so itself: trust is not tightening |
| 246 | "A guard that is *listed as active* while it is not running is indistinguishable from a working guard" (:4793) | the guard-status surface | same grep as 245: no per-decision record exists | **246 and 248 are one seam.** 248 is the data model for 246's record; mint one row with the four states as its first deliverable |
| 247 | "The rig has no plane that can only tighten ... our config merge does the opposite" (:4812) | `src/config.mjs` merge order | `grep -n "mergeConfig" src/config.mjs` -> **:285** (the row cites `:169-179`, stale). No additive-only layer exists | collision risk with #4854 (265, store-vs-config comparison): both sit on config. Say which file each may edit |
| 248 | "'Loaded', 'enabled', 'trusted' and 'overridden' are four different states" (:4841) | same as 246 | - | merge into 246 |
| 249 | "The research sandbox has no copy of this repo, no write access, and no way to obtain HTTP status, sha256 or `Last-Modified`" (:4858) | `docs/runbooks/research-request.md` prompt template | `grep -n "self-contained" docs/runbooks/research-request.md` -> **0** hits (ran here) | contradicts 243's acceptance, which demands columns the sandbox cannot produce. One row, split columns: obtainable (URL, date, line count) vs delegate-obtained (HTTP, sha256, `Last-Modified`) |
| 250 | "Citation keys are a namespace nobody owns" (:4887) | `tools/review-cite-check.mjs` + the alias table | `node tools/review-cite-check.mjs --gate` -> **exit 1**, "316 failing, 670 not failing (of 986 findings)", 2.21 s (ran here, in this unlinked worktree) | 250 and 252 share one tool: 250 is the checker + gate, 252 is the corpus repair it authorises |
| 251 | "A report's evidence table cites a vendor outside its own comparison set, and its 'nothing here is cloned' caveat is already stale" (:4923) | docs amendment | `grep -n "none of these five is cloned" docs/reviews/harness-tools-skills-public-harnesses-research.md` -> a hit at line 244 (verified) while `docs/VENDOR-PINS.md` lists 14 pins | flag for every row in this class: `vendor/eval/` is **gitignored** (`.gitignore:23`), so "observed at the pin" cannot be re-checked from a clean worktree - `ls vendor/eval` here returns "No such file or directory" |
| 252 | "Our own review corpus is the least-verified artifact in the repo" (:4943) | the same checker, as a landing rule | exit 1 today (measured above) | see 250 |
| 253 | "No item reaches `done` until it is reviewed by a cross-family verifier AND its artifact is an ancestor of `main`" (:4994) | **four seams - split it**: (1) refuse the transition in `complete_work`; (2) the pre-`done` states in the lifecycle doc; (3) the ancestry `check` rule; (4) `scripts/land.mjs`'s lock as the merge mechanism | `grep -n 'item.status = "done"' src/rig.mjs` -> **:1039**; `grep -n "awaiting_review\|awaiting_merge" docs/WORK-ITEM-LIFECYCLE.md` -> **0** hits (both ran here) | overlaps the landing-report work already shipped (#6196/#6202: the suite header and `land.mjs` now carry `dependencyProvenance`). Two rows will both write the landing report - sequence them |
| 254 | "Every model probe in `tools/model-probes/` is deaf to a long generation, and prints a message that hides why" (:5034) | the probe request layer - four files named (`gate.mjs:96`, `calibrate-verifier.mjs:42`, `throughput.mjs:24`, `cold-prefill.mjs:53`) but **one seam**: extract one request helper | `grep -c "err.cause" tools/model-probes/gate.mjs` -> **0** (ran here) | the only id the review itself supports. Pairs with 255 |
| 255 | "`DURIG_VERIFIER_MAX_TOKENS` declares an output budget the rig's own request deadline cannot deliver, and no instrument compares the two" (:5063) | the config-vs-deadline arithmetic in `check` | `ls durig.config.json` -> exit 1 in a clean worktree: the config the rule reads is **host-local**, so the rule must say which host produced the number | 208 is the same arithmetic on the prompt side - the row says "do not build two rules that disagree". Mint ONE rule with two inputs |

## Line numbers that have moved (mint the rows with these)

| row cites | actual in this tree |
|---|---|
| `src/seatroot.mjs:36` (`sameRoot`) | `src/seatroot.mjs:35` |
| `src/broker.mjs:988` (`norm`) | `src/broker.mjs:1094` |
| `src/broker.mjs:1145-1170` (`reconcileOrphanedWorktrees`) | `src/broker.mjs:1250` (the function line) |
| `cli.mjs:679` / `:794` (`seatCwd`) | `cli.mjs:805` |
| `src/config.mjs:169-179` (`mergeConfig`) | `src/config.mjs:285` |
| `src/worktree.mjs:649`, `src/broker.mjs:1167` | `src/worktree.mjs:649` still correct; the broker's `pruneWorktrees` call is at `src/worktree.mjs:667`/`:1343`, imported at `src/broker.mjs:27` |

## The acceptance gate the constraints name is not a fixed number

`node tools/rig-portability-audit.mjs` in this worktree: **exit 1, 1 finding** - not the review's "15
findings". The finding count is store- and tree-dependent (it reads `cli.mjs worktree audit` and the
per-seat roots), and with no store in the worktree it exits 1 with
"no store at .../selfdev.sqlite". `--self-test` **exit 0**: "seat-root reachable for a same-host root:
seat-root; for a foreign-OS root: not-terminal; drive->msys: /c/users/alex/item-42".

So acceptance for any of these rows should be written as "exit 1 with the finding list named in the
completion", never "15 findings".

## What I did not verify

I did not run the suite in this worktree (it is unlinked, `dependencySet: lockfile-released`); the
exit codes quoted above are for the named commands only. I did not read the four unread Codex files
241 names, and I did not check the Windows-host corpus 237 and 239 depend on - it is not reachable
from this host, which is the point of those rows.

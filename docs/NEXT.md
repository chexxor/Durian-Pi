# NEXT — current priority and exact next command

<!-- cite-ns: quoted — this pointer QUOTES other reports' footnote namespaces; it does not own them (ROADMAP 250) -->

**Last updated:** 2026-10-31T20:0xZ (**D185**), host-local 2026-10-31 15:0x (`America/Chicago`, CDT = UTC−5).
Box `Alex-Desktop-Win10`, kernel `7.2.11-200.fc44.x86_64`, node v24.22.1, **Linux**. Delegate session (D184).
Updated **in place** — the archive cut is named inside NEXT SESSION below.

## NEXT SESSION

**Archive cut:** the superseded 160-line D183 pointer is in `docs/NEXT-ARCHIVE.md` **verbatim** — marker **9630**,
body **9632–9791** — re-runnable proof: `sed -n '9632,9791p' docs/NEXT-ARCHIVE.md | diff - <(git show
e3cc8afa:docs/NEXT.md)` prints nothing.

**Current item: `item-4931` @ `8fa8f3a2` is the ONLY unlanded build, and the independent verify came back with a
BASE-DRIFT finding that changes the next act: it must be RE-CUT onto current `main` by `impl` before it can land.**
`scribe` (#4957, `done` @ 19:23:36Z) measured `git merge-base main HEAD` = **`6d63a3c5`**, `--is-ancestor main HEAD`
exit **1**, and `a629973e` sitting in `HEAD..main` — so its green runs prove the **tip**, not the merged tree. **`main` = the last docs commit (re-read `git rev-parse main`; **ahead of `origin/main` (re-read `git rev-list --count origin/main..main`), nothing pushed** — no push
grant).** The seat root `/home/chexxor/Git/durian-dev/seatroot` is on `seatroot/linux` and was fast-forwarded to `main`
at clock-out (check: `git -C /home/chexxor/Git/durian-dev/seatroot rev-parse HEAD` must equal `main` before any new
seat wake). Earlier landings (grant 18, `scripts/land.mjs`): **#4935 @ `44fe9438` → `abca484d`**, **#4936 @ `24a479c8` →
`d0a5b7ad`**, **#4948 @ `fa1300a2` → `a629973e`**, each with `merge-tree` exit 0 before, `--is-ancestor` exit 0 after,
`%p` = two parents.

**Blocker:** the working seats are near their windows — but read that correctly, because I had it partly WRONG.
`status.context.consumed` is the **last model call's prompt accounting** (`input` + `cacheRead` + `output`), not the
live window: it goes stale the moment a reset or compaction moves the head marker. Two instruments at 19:4xZ disagree
and the store proves which: `architect` reports consumed 218,645 = **1.0932** while `seat-turn-shape` shows its window
is **1 message**; `advocate` 244,751 = 9.9589, same artifact. **So two of my three "over-window" alarms were bogus and
"attention never flags them" is mis-specified.** Read window length AND consumed together: `impl` **300 msgs @183,689 =
0.9184** (head marker `pi.compaction@276279`, `last_run_failed: model_error` — its wake died after doing the row work:
#4952 cancelled, #4955 claimed), `pm` **153 @184,507** with `cacheRead 0 / input 183,402` (a fresh uncached prompt, the
expensive case), `lead` 170 @163,686, `scribe` 175 @151,039, `security` 100 @89,530, `devtools` 79 @53,113, `qa2` 16
@20,192, `qa` 13 @20,110, `advocate`/`designer`/`architect` **window 1**. Three rows stay parked on `pm` (#4826, #4897,
#4900).

**#4956 (`security`, `done` @ 11:40:31Z, report row #4962) verified 217's code half on a tree it did not author**
(patch-id of landed `8a950542` = authored `f8840349`); its three routed findings: the stale shell probe lives in the
**PRE-217 instruments** (`tools/broker-serve.mjs:298-307`, `tools/channel-preflight.mjs:220-234` scrape the first
`options?.programs ?? […]`, which sits inside `createPowerShellTool` at `bash.ts:169` while `createBashTool` at 145
has none → **`channel-preflight --dry-run` exits 1 and refuses a broker start on a working host**); **217 is
half-delivered** (`rig.selfdev.json`: 1 seat still told "shell tool is powershell", 0 bash, 11 none); and
`tools/rig-portability-audit.mjs:171` asserts a store claim as a **string literal over a zero-row store** — a claim
that cannot fail is not evidence. **`scribe` (#4957 + #4958, both `done`) added: a dependency-set finding** — the npm
tarball also labelled **1.3.0** has **0** `modelOverrides` occurrences while the pinned build has the seam at
`dist/harness/compaction.js:194-197`, and **a thin worktree cannot open the live store at all: `compact-eval` exit 1,
"schema version 2 is newer than supported version 1"**; **and row #4964 (held, → `impl`) for a compaction-failure read
it measured at `cli.mjs:1358`** (`settled?.error ?? settled?.failure?.reason ?? settled?.reason` vs the pinned
`SettledTask` shape) that would report a failed compaction as `state:"no-op"`, exit 2, `ok:true`. **That cite does NOT
resolve on `main`** — I grepped: no `failure?.reason` anywhere in `cli.mjs`, and `main`'s compact path requires a
`pi.compaction` entry (`fail("compact: no compaction entry was written…")`) while the spool path checks
`awaited.ok` (`cli.mjs:1271-1272`). So #4964 is **unverified on `main`** and must be re-derived there before anyone
fixes it — the same class as the unfalsifiable literal above. Other rows: **#4934 cancelled**, **#4958 done with its
docs commit `5e2273ee` on branch `item-4958`, UNLANDED** (preflighted: `git merge-tree --write-tree main item-4958`
exit **0**, 2 files, +82/−5), **#4959/#4960 `devtools`** (effective-capacity denominators; promote the `.spike/` reads
into `tools/`), **#4955 `impl` claimed, #4937 `impl` held**. **#4952 is cancelled by its author** (notice #4961) —
contradicting `scribe`'s reply, which said it still needed cancelling: **the row beats the reply.**

**Next commands (delegate, Linux; block 1 is the actual next act):**

```bash
# 1. row truth + the pointer trio, all read-only, all priced in docs/runbooks/session-start-cost.md
pgrep -af "node cli.mjs send" | grep -v "bash -c" || echo "no wake running"   # NEVER bare pgrep -f "cli.mjs send" — it matches your own command line
DURIG_DB=/home/chexxor/Git/Durian-Pi/selfdev.sqlite node cli.mjs queue --json > .spike/fix-20261102/q.json   # 1.5 s, 21.7 MB — file it
node .spike/fix-20261101/rows.mjs 4955 4957 4958 4959 4960 4962 4938 4931 4937 4947 4950 < .spike/fix-20261102/q.json
DURIG_DB=/home/chexxor/Git/Durian-Pi/selfdev.sqlite node cli.mjs status --json | head -c 4000   # attention carries `admitted_not_started` — see block 2
DURIG_NO_SERVE=1 DURIG_SEAT_ROOT=/home/chexxor/Git/durian-dev/seatroot DURIG_DB=/home/chexxor/Git/Durian-Pi/selfdev.sqlite node cli.mjs up rig.selfdev.json --refresh --dry-run > .spike/fix-20261102/updry.json   # roster placement: read `wouldRefresh[].changes.cwd`; grepping for "drifted" finds nothing (D178's "vacuous" claim is retracted — see runbook step 3)
DURIG_DB=/home/chexxor/Git/Durian-Pi/selfdev.sqlite node tools/seat-turn-shape.mjs   # window LENGTH per seat + parity; AT RISK = strict-template warning, not a do-not-send gate here (see do-not-fix list)
ps -eo args | tr '\0' ' ' | grep -o -- "--ctx-size [0-9]*"  # 8192 ⇒ the verifier family is dead regardless of what status.context claims
# 2. impl is at 0.9184 (183,689 of a declared 200,000) with attention `last_run_failed: model_error`; its
#    `admitted_not_started` flag CLEARED on its own, so there is nothing to re-arm. If you see that flag again,
#    the verb is `node cli.mjs resume` (alias `doctor`), NO arguments, and it is a compound WRITE that REFUSES
#    while a broker drives — read docs/runbooks/resume-while-broker-runs.md first, because its own message says a
#    NEVER-STARTED (`queued`) submission is a different class whose settlement awaits the admission deadline (37(c)).
#    the ONLY licensed offline compaction read (there is NO `compact --dry-run` — see the do-not-fix list):
DURIG_DB=/home/chexxor/Git/Durian-Pi/selfdev.sqlite node scripts/compact-eval.mjs item --seat impl --limit 400 --out .spike/<session>/compact-impl-dry.txt
#    measured 19:0xZ, operator-authorised: 400 records ~296,807 est tokens; dropped zone 1 needle + 3 paths; firing = 1 summarizer call + ~10 probes ~890,421 est tokens.
# 3. BEFORE any send: if the dry run above named a drifted cwd, drop --dry-run (same command) — a seat parked in its
#    own item worktree refuses EVERY write verb. Diff a bare-name inventory around it (grant 11's tree-shape licence).
# 4. DO NOT land item-4931 as-is: #4957 measured merge-base main HEAD = 6d63a3c5 and --is-ancestor main HEAD exit 1,
#    so it needs an impl RE-CUT onto current main + the content gate (git patch-id --stable) first. What you CAN land
#    is scribe's docs commit: preflighted merge-tree exit 0, docs-only, 2 files +82/-5.
git merge-tree --write-tree main item-4958 && node scripts/land.mjs item-4958 --db /home/chexxor/Git/Durian-Pi/selfdev.sqlite
git merge-base --is-ancestor item-4958 main && echo LANDED   # then remove item-4958 (and item-4957, whose tip is IDENTICAL to item-4931's) by name
# 5. clock-out: the pointer trio, plus a suite pair in a NAMED tree — REMOVE the scratch BEFORE any landing
node demo/next-pointer.test.mjs && node demo/clockin-digest.test.mjs && node tools/doc-integrity-guard.mjs && node tools/instrument-provenance.mjs
git worktree add --detach "$PWD/.main-check" main && ( cd .main-check && node scripts/suite.mjs --jobs 8 ); echo "exit=$?"; git worktree remove .main-check
```

**ASK THE OPERATOR — grants, all cheap, none a code call.** (1) **Land `item-4958`?** scribe's docs commit `5e2273ee`
(verifier-independence runbook, 2 files +82/−5), preflighted: `git merge-tree --write-tree main item-4958` exit **0**.
(2) **`item-4931` cannot land as-is** — #4957 proved its base is `6d63a3c5`; do you want `impl` re-cut onto current
`main` (content gate by patch-id) and then landed? (3) **Three `-D` grants**: `item-4904`, `item-4957` (identical tip
to `item-4931`, removes nothing), `item-4898` (after #4931 lands). (4) **Delete the 5 redundant `refs/rescued` blobs?**
Each byte-identical to a tracked file; I recommend leaving the 485 commit refs alone (17.58 MiB pack, 475 are
one-of-a-kind). (5) **`wip/seat-prompt-files` @ `04e3ba6b`** (`git cherry` = `+`): land as a row, defer, or drop?
(6) **`impl` context decision**: 0.9184 with `last_run_failed: model_error`, row #4955 still `claimed`; firing the
compaction costs 1 summarizer call, firing the *eval* ≈890k est tokens — but `impl` already carries a live
`pi.compaction@276279` head marker that I did NOT fire, so ask whether the serving path auto-compacts before granting a
one. `pm` carries `pi.reset@273959` yet 153 msgs @184,507 with `cacheRead 0`, so #4886's reset did not free it.

**Grants in force:** **15** standing (no further verifier capacity) · **16** used (merge of 217) · **18** used
(landing: `abca484d`, `d0a5b7ad`, `a629973e`) · **19** used (local-AI verify legs: #4956/#4957 on non-author
local-model seats, **operator-confirmed 19:0xZ**; the `impl` compaction DRY RUN authorised and used —
`scripts/compact-eval.mjs`, estimates only, nothing fired, no tokens spent; **firing the compaction or the eval needs a
separate grant**) · **no push grant (reaffirmed)** · grant 11's tree-shape licence used only for `up … --refresh`
re-pointing, with bare-name inventories. **Grants 1–14 are in `docs/NEXT-ARCHIVE.md`.**

## Rig state, re-measured at clock-out 2026-10-31T19:3xZ (Linux) — re-read, do not trust

**Store** `/home/chexxor/Git/Durian-Pi/selfdev.sqlite` (444 MB); this session's pre-write backup
`.spike/fix-20261101b/store-backup-pre-lead-020622.sqlite`. **`git worktree list` 10** and **`git branch --list` 11**
at clock-out: the two checkouts (`/home/chexxor/Git/Durian-Pi` on `main`,
`/home/chexxor/Git/durian-dev/seatroot` on `seatroot/linux`, fast-forwarded to `main`; deps intact, 187 packages,
`vendor/pi-main`) and 8 item trees.

**WORKTREE / BRANCH AUDIT — full table, commands and verdicts in `docs/runbooks/leaked-worktrees.md` §"Disposition
audit"; short version.** Removed by name (`--is-ancestor` exit 0 → `worktree remove` → `branch -d` → `prune`; bare-name
inventory diff = 4 lines): `item-4916`, `item-4956`; earlier: `item-4902`, `item-4933`, `item-4935`, `item-4936`,
`item-4948`; `worktree prune --dry-run --verbose` prints nothing. **`-D` grants needed (proofs in the runbook):
`item-4904`** (content in `main` by patch-id), **`item-4898`** (role discharged once #4931 lands), **`item-4957`** (tip
sha **identical** to `item-4931`'s → removes zero objects, safest). **Leave the locked:** `item-4930` (cancelled; only
`devtools` unlocks), `item-4937` (`held`), `item-4955` (`claimed`; only dirt untracked `.probe-cli/status.out`).
`item-4958` @ `5e2273ee` = scribe's UNLANDED docs commit; `wip/seat-prompt-files` is a parked decision. **`refs/rescued`
= 490 refs (485 commits + 5 blobs), 15 reachable from `main`;** delete the 5 blobs only under grant (byte-identical to
tracked files) and **leave the 485 commit refs — whole pack 17.58 MiB, 475 one-of-a-kind**; read
`docs/runbooks/cross-clone-object-recovery.md` before any `git gc`. **Provider:** local `iq3_s` at `:47831` (`--max-context 204800`, GPU1 23,237/24,576); verifier
`ministral-3-14b-reasoning` at **8192 × 4** on GPU0 (12,618/16,376) and `status.attention` now carries
`auditor last_run_failed: model_error … Engine protocol predict request returned 500` — direct evidence the
verifier slot cannot carry agent turns. `lms` only as `HOME=~/.var/app/ai.lmstudio.lm-studio
~/.var/app/ai.lmstudio.lm-studio/.lmstudio/bin/lms` (flatpak). **Shape (fresh, 13 parity findings across 12
seats):** ADMISSIBLE `qa`, `qa2`; AT RISK the other ten; counted-projection parity breaks `lead` 26, `pm` 11, `scribe`
8, `devtools` 6, `auditor` 5, `security` 2. **Do NOT read `AT RISK` as a do-not-send gate on this host:** `scribe`
(window 175, head marker `pi.reset`) and `security` (100, `pi.reset`) both completed rows tonight — it is a warning
about strict alternating templates, and the local model is tolerant. **Per-seat consumed/window pairs are in the
Blocker above; the rule that matters is that `consumed` is the LAST call's prompt accounting and goes stale when a
reset/compaction moves the head marker** (`impl` carries `pi.compaction@276279` — a compaction entry exists in the live
store although I never fired `compact`, so the serving path compacts on its own; re-read for a marker before asking for
a manual `compact` grant). **The shape #4959 must fix:** `status.context.<seat>.window` =
`{denominator:"declared", value, candidates:{measured:null, declared, advertised:null}}` — always `declared`, and
`measured`/`advertised` null even for the 8192-slot seats; it should also carry the head marker and the window length. **Attention (19:35Z):**
`impl last_run_failed: model_error`; `auditor last_run_failed` (verifier grammar 500); `idle_with_queued_work` for
`lead`/`devtools`/`scribe`/`security`/`qa`/`qa2`/`architect`; step-repetition 3% (2/66); queue-ageing 1834.5 min.
**`impl admitted_not_started` cleared on its own — never assume an attention flag persists; and do not chase the
`advocate`/`architect` fractions: those windows are 1 message long, so the fraction is stale, not a missed alarm.**
Census at 19:35Z (NOT evidence): `{"done":3776,"cancelled":792,"held":324,"queued":54,"deferred":17,"claimed":2}`,
4965 rows. **Host:** 94 GiB total, 61 used, 32 available. **Suite pair (clean detached worktree): `pass=234 fail=5
demos=239` at `6d63a3c5` → `pass=237 fail=3 environmental=0, demos=240` at `a629973e`;** the 3 survivors are attributed
in D184 and in the CORRECTION below. **CORRECTION: `demo/local-model-pointer.test.mjs` does NOT assert
`verifier/mistralai`-style literals** — I took that from `lead`'s prose; the literal is absent on `main` (it guards
`verifier/<id>` + `DURIG_VERIFIER_BASE_URL` two-sided, id from machine config `src/providers/local.mjs:42`). The
shortcut claim held: `demo/deepinfra-catalog.test.mjs:76` accepts any `local/` id. **Clock-out guards exit 0:** the four
named in the commit message plus the 14-test derived set (`tools/what-to-test.mjs --run --base=HEAD`).

## Do not "fix" these on the strength of the docs

**`cli.mjs compact` has NO `--dry-run` and no `--config` flag** — `cli.mjs:2941` is `compact <seat> [instructions]`
and it WRITES a compaction boundary; only `reset` has `--dry-run` (`cli.mjs:2940`). A pointer near-miss of mine sent
the next session hunting for a `rig.compact.json` that does not exist in either tree. The licensed offline read is
**`scripts/compact-eval.mjs item --seat <name>` without `--yes`** (it always copies the store to temp).

**Every 40-hex value inside a SEAT's transcript is redacted as `secret-shaped value`** — measured on `security`'s
#4956 leg: commit shas, `sync-pi`'s `pinnedSha` and both patch-ids came out redacted, so the seat printed **halves**
(`279e0d9861b4d6958cf1|f36af03dc00c96fcaa23`). **This is very likely why 217's original verify report read as
unverifiable at row level** (D182/D183) — a transcript filter, not seat negligence. Ask for **halves plus the command
that prints them**, and re-run the instrument yourself rather than discounting the seat.

**`node --check` checks only the FIRST path and silently ignores the rest** — measured here: two deliberately
broken files in one call printed only the first and exited 1, so a three-file `--check` proves one file and exits
0 when the first is fine. **The store opener CREATES a file on read** and `*.sqlite` is gitignored, so a
"read-only" assertion written as absence-of-git-churn is **vacuous**; the approved seat root holds a stale empty
**122,880 B `selfdev.sqlite` dated Oct 30** right now, and any unqualified read there resolves it and fails with
`no seat named null` — pin `DURIG_DB` to an absolute path when cwd is the seat root (D184/#4955). **A failed wake
is not a reason to re-send the same brief**: `impl` settled `unanswered / model_error` with an empty reply and had
already done its row work — **re-arm the admitted submission (the resume/doctor verb), and check context before
waking anything.** **`status.context` declares 24,576 for `qa`/`qa2`/`auditor` while the loaded slot is 8192** —
read the live `--ctx-size` from process args. **A `broker-serve --status` provider BLOCK is one sample with a 20 s
budget** (#4949). **`channel-preflight` §7 and `seat-shell-availability` probe `[pwsh, powershell]` after reading
`registered shell tool name: "bash"`** (#4938). **The roster-wide `DURIG_SEAT_ROOT` guard refuses EVERY write verb
when any seat is parked in an item worktree** — `up … --refresh` under the root, never unsetting it (D180);
expect this after **every** turn that used `prepare_workspace` (it fired three times this session — off `item-4937`,
`item-4931` and `item-4955`; the roster was re-pointed clean at clock-out, refresh 5, whose inventory diff showed
nothing removed and only `item-4956` added by `security`'s turn — so no refusal is pending, and the next turn in any
item worktree re-arms it).
**`prepare_workspace` places beside the SERVING PROCESS's tree, not the seat root** (#4947/#4950) — `cd` to the
approved root before `send`; that habit is what put `item-4948`/`item-4931`/`item-4955` under the seat root.
**`up … --refresh --dry-run` is NOT vacuous when the rig file names no `cwd`** (drift shows as
`wouldRefresh[].changes.cwd`), and it never names removals. **A `done` settle can have an empty reply** (parts
`[thinking]`, text 0) — read the rows; **a cancel emits a notice row** that can sit queued to an unreachable seat with a
wrong self-reference (#4954). **`git worktree remove` refuses a dirty tree, `--force` is data loss, `branch -d` never
`-D`, gated by `merge-base --is-ancestor`; `scripts/land.mjs` refuses on ONE untracked path at the repo root** (the
#4139 gate is the directory list, not porcelain) — detail in `runbooks/leaked-worktrees.md` and SELFDEV. **Never read an
exit code through a pipe**; **`pgrep -f "cli.mjs send"` matches your own `bash -c` line — match `node cli.mjs send`,
exclude `bash -c`**; **`> /dev/null` is refused by the confine guard**; **take BARE-NAME inventories**; **
`better-sqlite3` is absent in both trees — use `node:sqlite`**; **inline briefs, no backticks**; **`AT RISK` from
`seat-turn-shape` is a strict-template warning, NOT a do-not-send gate on this host — `scribe` and `security` completed
rows tonight while flagged** (the real gate is the window/consumed pair plus GPU capacity); **a fresh worktree has 80
packages and no `vendor/pi-main` — name the artifact set with every exit code** (#4939); **LM Studio restores `8192×4`
on relaunch**.

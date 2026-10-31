# NEXT — current priority and exact next command

<!-- cite-ns: quoted — this pointer QUOTES other reports' footnote namespaces; it does not own them (ROADMAP 250) -->

**Last updated:** 2026-10-31T11:3xZ (**D184**), host-local 2026-10-31 06:3x (`America/Chicago`, CDT = UTC−5).
Box `Alex-Desktop-Win10`, kernel `7.2.11-200.fc44.x86_64`, node v24.22.1, **Linux**. Delegate session (D184).
Updated **in place** — the archive cut is named inside NEXT SESSION below.

## NEXT SESSION

**Archive cut:** the superseded 160-line D183 pointer is in `docs/NEXT-ARCHIVE.md` **verbatim** — marker line
**9630**, body **9632–9791** — proof, re-runnable:
`sed -n '9632,9791p' docs/NEXT-ARCHIVE.md | diff - <(git show e3cc8afa:docs/NEXT.md)` prints nothing.

**Current item: the three gated branches are LANDED and the queue is now working the verify legs — one build is
unlanded (`item-4931` @ `8fa8f3a2`, the compaction re-cut) and the rig's next acts are seats, not git.** `main` =
**`a629973e`**; the seat root `/home/chexxor/Git/durian-dev/seatroot` is fast-forwarded to the same sha;
**50 ahead of `origin/main` at that sha (51 counting this pointer commit), nothing pushed.** Landed under the
operator's grant 18, by the delegate,
via `scripts/land.mjs`: **#4935 @ `44fe9438` → merge `abca484d`**, **#4936 @ `24a479c8` → merge `d0a5b7ad`**,
**#4948 @ `fa1300a2` → merge `a629973e`** (each: `git merge-tree` exit 0 immediately before, `git merge-base
--is-ancestor` exit 0 after, `%p` = two parents, lock `{slots:1, held:1, waitedMs:0, reserved:true,
liveHolders:0}`).

**Blocker:** the rig is running out of HEADROOM on its working seats, and that — not code — is what stops next.
**`impl` died mid-turn with `settledStatus: unanswered`, `settledReason: model_error` at 0.9041 of its declared
window** after claiming #4955; it had already done the real work in that wake (#4952 cancelled by impl, handover
performed). `pm` is at 0.9225 and unreachable, `lead` at 0.8184, and `advocate` 9.9589 / `architect` 1.0932 are
over their windows with `status.attention` still not flagging them. Three rows are still parked on unreachable
`pm` (#4826, #4897, #4900).

**The verifier-capacity ruling is realised, in the seat's choice, not mine.** Operator grant 19: **no new GPU
capacity, no bigger slot — verification legs run on the local AI.** `lead` chose **route the legs to local-model
non-authors** and REFUSED the config re-point, because `demo/deepinfra-catalog.test.mjs` goes green under it only
by making `resolvable()` true for any `local/` id — **tuning the instrument to agree, hiding a red that is doing
real work.** Rows now: **#4934 cancelled** (auditor pinned to an 8192-token slot at p50 16,518 — it could never
carry the leg), **#4956 `security`** = independent verify of 217 on `main` @ `a629973e` (DISPATCHED this session,
served from the approved root), **#4957 `scribe`** = verify of the compaction build @ `8fa8f3a2` with the live
`compact --dry-run` repro DEFERRED (no broker tonight; a green config demo is not proof of a live path),
**#4958 `scribe`** = `docs/runbooks/verifier-independence.md` must state the three axes and name the lost
model-family diversity, **#4959 `devtools`** = `status.context` must report effective capacity AND both
denominators (it declares 24,576 where the slot is 8192, and that fiction caused `lead`'s own re-mint error),
**#4960 `devtools`** = promote the four `.spike/` reads into `tools/` with demos mapped in the manifest and
read-only / create-nothing guarantees, **#4955 `impl`** = the create-on-read opener defect (claimed, run died —
see next command). **#4952 is cancelled by its author**, so the compaction build's verify leg is #4957 alone.

**Next commands (delegate, Linux; block 1 is the actual next act):**

```bash
# 1. row truth + the pointer trio, all read-only, all priced in docs/runbooks/session-start-cost.md
pgrep -af "node cli.mjs send" | grep -v "bash -c" || echo "no wake running"   # NEVER bare pgrep -f "cli.mjs send" — it matches your own command line
DURIG_DB=/home/chexxor/Git/Durian-Pi/selfdev.sqlite node cli.mjs queue --json > .spike/fix-20261102/q.json   # 1.5 s, 21.7 MB — file it
node .spike/fix-20261101/rows.mjs 4955 4956 4957 4958 4959 4960 4931 4937 4947 4949 4950 < .spike/fix-20261102/q.json
DURIG_DB=/home/chexxor/Git/Durian-Pi/selfdev.sqlite node cli.mjs status --json | head -c 4000   # attention carries `admitted_not_started` — see block 2
node .spike/fix-20261101/read-cwd4.mjs                     # seats' persisted cwd — the ONLY honest root-drift read
node .spike/fix-20261101b/turncost.mjs                     # per-seat turn-cost percentiles (this priced the verifier question without loading a model)
DURIG_DB=/home/chexxor/Git/Durian-Pi/selfdev.sqlite node tools/seat-turn-shape.mjs   # AT RISK ⇒ do NOT send that seat
ps -eo args | tr '\0' ' ' | grep -o -- "--ctx-size [0-9]*"  # 8192 ⇒ the verifier family is dead regardless of what status.context claims
# 2. impl is CLAIMED-but-dead: re-arm, do not re-send a fresh brief. Read the resume/doctor verb first, then:
DURIG_DB=/home/chexxor/Git/Durian-Pi/selfdev.sqlite node cli.mjs doctor rig.selfdev.json   # report ONLY; the re-arm verb is named by attention
#    bring the compaction numbers to the operator BEFORE any compaction (grant 17 was dry-run + report):
DURIG_DB=/home/chexxor/Git/Durian-Pi/selfdev.sqlite node cli.mjs compact impl --dry-run --config rig.compact.json
# 3. BEFORE any send: re-point the roster — a seat parked in its own item worktree refuses EVERY write verb
DURIG_NO_SERVE=1 DURIG_SEAT_ROOT=/home/chexxor/Git/durian-dev/seatroot DURIG_DB=/home/chexxor/Git/Durian-Pi/selfdev.sqlite \
  node cli.mjs up rig.selfdev.json --refresh --dry-run     # names the drifted cwds; then drop --dry-run; diff a bare-name inventory
# 4. #4931 lands only after #4957's verify comes back clean. Preflight, land, prove, remove by name:
git merge-tree --write-tree main item-4931 && node scripts/land.mjs item-4931 --db /home/chexxor/Git/Durian-Pi/selfdev.sqlite
git merge-base --is-ancestor item-4931 main && echo LANDED   # then remove that worktree by name and `git worktree prune`
# 5. clock-out: the pointer trio, plus a suite pair in a NAMED tree — REMOVE the scratch BEFORE any landing
node demo/next-pointer.test.mjs && node demo/clockin-digest.test.mjs && node tools/doc-integrity-guard.mjs && node tools/instrument-provenance.mjs
git worktree add --detach "$PWD/.main-check" main && ( cd .main-check && node scripts/suite.mjs --jobs 8 ); echo "exit=$?"; git worktree remove .main-check
git for-each-ref refs/rescued | wc -l       # 490 at clock-out; read runbooks/cross-clone-object-recovery.md before anything runs `git gc`
```

**ASK THE OPERATOR — three, and none is a code decision.** (1) **`impl` is at 0.9041 and just died of
`model_error` mid-turn; `pm` is at 0.9225 and unreachable.** Both are past the 0.88 measured break-class edge and
neither has an in-wake auto-compaction (`selfCompacts` false). The licensed repair is `reset` (#4886) for `pm` and
a `compact --dry-run` proposal for `impl` — **do you authorise the compaction, or a reset?** Say which, and expect
to rule on `lead` at 0.8184 next. (2) **Push grant.** `main` is 51 commits ahead of `origin/main` and nothing has
been pushed for several sessions; `refs/rescued` holds 490 refs that exist because objects once could not travel
between machines. One working tree with no remote copy is the largest single unrecoverable loss on this rig. (3)
**Confirm `lead`'s independence realisation is what you meant by "use local AI"**: the verify legs now run on
local-model non-author seats (`security` for 217, `scribe` for the compaction build) and **model-family diversity
is lost — the author seat runs the same model**, which `lead` named in the rows rather than smoothing over.
Standing ask unchanged: `pm`'s three parked rows (#4826, #4897, #4900) and #4813.

**Grants in force.** **15** = no further verifier capacity (standing). **16** = merge of 217 (used). **18** =
landing of the stacked branches (**used**: `abca484d`, `d0a5b7ad`, `a629973e`). **19** = "use the local AI for the
verification leg" — no new GPU capacity, no new slot; `lead` owns the routing (realised: #4956/#4957). **No push
grant.** Grant 11's tree-shape licence used only for `up … --refresh` re-pointing, with bare-name inventories.

## Rig state, re-measured at clock-out 2026-10-31T11:3xZ (Linux) — re-read, do not trust

**Store** `/home/chexxor/Git/Durian-Pi/selfdev.sqlite` (444 MB); this session's pre-write backup
`.spike/fix-20261101b/store-backup-pre-lead-020622.sqlite`. **`git worktree list` 9**: the two checkouts
(`/home/chexxor/Git/Durian-Pi` @ `a629973e`, `/home/chexxor/Git/durian-dev/seatroot` @ `a629973e` on branch
`seatroot/linux`) and 7 item trees — `item-4937` (LOCKED, #4937 `held`, still based on `31d10565`), `item-4898`
(`9beb1ae3`, the patch-id reference for the compaction re-cut), `item-4904` (`f8840349`), `item-4916`
(`8a950542`), `item-4930` (LOCKED over a cancelled row — only `devtools` releases it), `item-4931` (`8fa8f3a2`,
UNLANDED until #4957 runs), `item-4955` (`a629973e`, LOCKED, impl's dead run). `git branch --list` **10**
(incl. `wip/seat-prompt-files`, no worktree). `refs/rescued` **490**. Removed this session by name with
`git branch -d` only, each pass inventory-diffed: `item-4902`, `item-4933`, `item-4935`, `item-4936`,
`item-4948`. **Provider:** local `iq3_s` at `:47831` (`--max-context 204800`, GPU1 23,237/24,576); verifier
`ministral-3-14b-reasoning` at **8192 × 4** on GPU0 (12,618/16,376) and `status.attention` now carries
`auditor last_run_failed: model_error … Engine protocol predict request returned 500` — direct evidence the
verifier slot cannot carry agent turns. `lms` only as `HOME=~/.var/app/ai.lmstudio.lm-studio
~/.var/app/ai.lmstudio.lm-studio/.lmstudio/bin/lms` (flatpak). **Shape (fresh, 13 parity findings across 12
seats):** ADMISSIBLE `qa`, `qa2`; **AT RISK** `pm`, `impl`, `lead`, `advocate`, `scribe`, `devtools`, `auditor`,
`designer`, `security`, `architect`; counted-projection parity breaks `pm` 11, `lead` 26, `scribe` 8, `devtools`
6, `auditor` 5, `security` 2. **Context (consumed / declared 200000 unless noted):** `pm` 184,507 = 0.9225
(unreachable), **`impl` 180,822 = 0.9041 (died mid-turn)**, `lead` 163,686 = 0.8184, `qa2` 20,192 = 0.8216
(window 24,576), `qa` 20,110 = 0.8183 (24,576), `advocate` 244,751 = **9.9589** (24,576), `architect` 218,645 =
**1.0932**, `devtools` 53,113 = 0.2656, `scribe` 33,517 = 0.1676, `security` 27,347 = 0.1367, `auditor` 0,
`designer` 0. **Attention (fresh, richer than D183):** `impl admitted_not_started — submission #276834 admitted
966 s ago, no run started and no slot held; re-arm with the resume/doctor verb`; `auditor last_run_failed`
(verifier grammar 500); `idle_with_queued_work` for `lead` (8), `devtools` (14), `scribe` (3), `security` (5),
`qa` (2), `qa2` (2), `architect` (1); step-repetition 3% (2/66); queue-ageing 1834.5 min (band 30). **Still
never flagged: `advocate` 9.9589 and `architect` 1.0932.** **Queue census at clock-out (NOT evidence — rows
are):** `{"done":3773,"cancelled":792,"held":323,"queued":54,"deferred":17,"claimed":2}`. **Host:** 94 GiB total,
61 used, 32 available. **Suite on `main` (detached clean worktree):** `pass=237 fail=3 environmental=0,
demos=240`; the 3 are attributed in D184 and two are the fresh-worktree false-red class. **Clock-out tests:** see
the commit message; `demo/next-pointer.test.mjs`, `demo/clockin-digest.test.mjs`,
`tools/doc-integrity-guard.mjs`, `tools/instrument-provenance.mjs` all exit 0.

## OPERATOR GRANTS (see the archive for 1–14)

15 no further verifier capacity. 16 merge of 217 (used). 18 landing of the stacked branches (used). 19 use the
local AI for the verification leg — no new GPU capacity, no new slot. **No push grant.**

## Do not "fix" these on the strength of the docs

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
expect this after **every** turn that used `prepare_workspace` (it fired twice this session).
**`prepare_workspace` places beside the SERVING PROCESS's tree, not the seat root** (#4947/#4950) — `cd` to the
approved root before `send`; that habit is what put `item-4948`/`item-4931`/`item-4955` under the seat root.
**`up … --refresh --dry-run` is NOT vacuous when the rig file names no `cwd`**, and it never names removals.
**A `done` settle can have an empty reply** (parts `[thinking]`, text 0) — read the rows. **A cancel emits a
notice row** — and that notice can sit `queued` to a seat that cannot reach it (`#4954` → auditor) while its own
body self-refers to the wrong id; `lead` re-minted two bodies tonight for exactly that class. **`git worktree
remove` refuses a dirty tree on purpose, `--force` is data loss, `git branch -d` never `-D`, gated by `git
merge-base --is-ancestor`** (`runbooks/leaked-worktrees.md`). **`scripts/land.mjs` refuses on ONE untracked path
at the repo root** — a proof scratch named `.main-check/` blocked this session's whole pass; the stray-worktree
gate (#4139) is the directory list, not porcelain. **Never read an exit code through a pipe**; **`pgrep -f
"cli.mjs send"` matches your own `bash -c` command line — match `node cli.mjs send`, exclude `bash -c`**; **`>
/dev/null` is refused by the confine guard**; **an `.spike`/worktree count is a function of cwd — take BARE-NAME
inventories**; **`better-sqlite3` is NOT installed in either tree — use `node:sqlite`**; **inline briefs, no
backticks**; **AT RISK ⇒ do not send**; **a fresh worktree has 80 packages and no `vendor/pi-main` — name the
artifact set with every exit code** (#4939); **LM Studio restores `8192×4` on relaunch**.

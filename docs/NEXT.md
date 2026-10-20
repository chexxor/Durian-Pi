# durian-pi — NEXT (current pointer)

## NEXT SESSION  (2026-10-20 — the ONLY live pointer; every later "NEXT SESSION" is history)

**Current item:** the `main` regression is **FIXED** — the delegate landed `revert-9c3aa02` as merge
`798836b` (`main` `db96a05` -> `798836b`). Cause: a bare `git commit` by the delegate swept a seat's
STAGED 21-file work into `9c3aa02` (message said `docs(NEXT)`, delta was 20 files / +450-907), removing
`src/tui/client.mjs` -286 etc. while the demos it removes stayed put. The revert restored those files.
**Measured on `main` after the revert, clean detached worktree: `pass=185 fail=3`** (demos 188).
The 4 TUI failures (`tui-landing`, `tui-status-bar`, `tui-conversation-header`, `landing-data`) are GONE.
**Still red, and NOT caused by that commit — all three also fail at `deff39c`, its parent:**
`broker-one-connection`, `pitui` (#2412), `seat-instruction-encoding`. Two of those are NEW against the
documented `pass=180 fail=1` baseline and have no item: ask `pm` to mint them.
**The seat's parked work is intact** at `stash@{0}` ("delegate: park a seat's 21-file shared-tree WIP for the
9c3aa02 revert") plus a patch at `.spike/delegate/revert-9c3aa02-2026-10-20/` — its author must redo it on
a BRANCH; do not pop the stash blind.
**Queue id:** `#3313` (landing render) · `#3309` · `#3308` · `#3315`/`#3314` (verifies CANCELLED — re-register
before accepting) · `#2412` (`pitui`) · `broker-one-connection` + `seat-instruction-encoding` regressions have
NO item yet.
**Blocker:** `main` is red on 7 demos, so `land.mjs --suite` is unusable; land without it and prove on
`main`. Also standing: the local PolyStrata model is DOWN (Swift/Qwen3.6 deleted, IQ3_S installing to
`D:\PolyStrata-models`), and the shared tree carries ~107 dirty paths of seats' in-flight work, so a suite
run in `.` does NOT measure `main` — use a detached worktree.
**Exact next command:** `DURIG_DB=./selfdev.sqlite node cli.mjs status`

Then:
`git worktree add --detach .verify-main main && (cd .verify-main && node scripts/suite.mjs); git worktree remove --force .verify-main`

**Do not:** treat a suite run in the shared tree as `main`'s result (it mixes uncommitted work); land
`impl-item-3313` before 3308/3309 (stacked); use `land.mjs --suite` while `main` is red; delete
`pi-opendurig.worktrees/` by hand (179 REGISTERED trees, all dirty, 34 unlanded, 13 with commits on no ref);
push (operator holds the grant).

## CLOCK-OUT / SESSION LOG (2026-10-20 ~05:15Z, delegate) — **HUMAN QUEUE ANSWERED: 10 ROWS → 2 REAL, 8 STALE; #3233 REF DELETED, RULINGS DELIVERED TO `pm`**

The operator asked what was waiting on a human. I enumerated the **10 non-terminal rows** carrying
`deferredTo:"human"` (from `status`, filtered — not from the item bodies) and re-verified each premise by
command. **Only 2 were real; 1 was already moot; 7 were stale liveness escalations.** The operator accepted
the recommendations and I acted on them.

**1. RULINGS DELIVERED — `pm`, request `operator-human-parked-2026-10-20-1`, `delivered:true` at
`05:11:02.570Z`** (body: `.spike/delegate/human-parked-2026-10-20/intent.md`; `pm` woke `05:14:16Z`).
Three rulings: R1 `#3233` closed-by-action + mint an `architect` item for a sanctioned
`worktree prune-branch`; R2 `#3274` close as SUPERSEDED (not "verified"); R3 the 7 stale rows released or
re-routed to their owning seats, **never re-escalated to the human**.

**2. `#3233` EXECUTED — the ref is GONE.** `git branch -D designer-item-2103` -> `Deleted branch
(was 81780e2)`, exit 0. Re-verified against current main `a836ed3` immediately before deleting:
`git cherry main designer-item-2103` = 3 lines **all `-`**; **0** worktrees hold it. Recovery:
`git branch designer-item-2103 81780e2`. This was the one row a seat could not close — `git branch -d`
refuses a patch-equivalent ref and `-D` is blocked by the seat guard (`src/confine.mjs:190`), so the seat
correctly refused rather than route around it. **The durable fix is a narrow sanctioned verb, NOT a wider
force-delete grant.**

**3. `#3274` IS MOOT — verified, and this is the reusable part.** Its premise ("config says swift-1.5, store
serves qwen36") no longer describes the system: `rig.selfdev.json` has **zero `local/` models**; the local
provider is **down** (`curl 127.0.0.1:8080/v1/models` -> `http=000`); the refresh is recorded as applied
(resetEntryId 153838/153841). **`devtools` proved its move** — a post-move turn on
`deepinfra/DeepSeek-V4.1-Flash`, `stopReason: stop`, completing **#3342 at `04:16:37Z`**.

**4. `qa` IS THE LIVE BLOCKER, and it is invisible to `status`.** `qa` has **no post-move turn**: its last
assistant turn is still `"provider": "local"`, followed by a `pi.reset` + `pi.user` with **no reply** — the
server on 8080 is gone. So `qa` cannot run, which is why **`#3347` (step 1 of lead's #3355 sequence) has sat
`queued` and unclaimed since `02:09:15Z`**, and why `#3403` stays parked (`dd2583b` is not an ancestor of
main; `src/compacteval.mjs` absent). **Getting `qa` onto a live provider is the highest-value next action.**

**5. THE 7 STALE ROWS ARE A KNOWN CLASS — do not answer them.** `#2559, #3260, #3263, #3277, #3287, #3288`
("devtools has failed 4 runs in a row") and `#2673` ("waited on pm 15 min") are supervisor liveness
escalations (`docs/runbooks/stale-held-backlog.md`), all dated `01:59Z`-or-earlier, i.e. before the local
model was taken down. `devtools` is healthy (#3342 done, above); `pm` is alive (`04:11:17Z`). All **349**
`PASS-FAILED` lines in the broker log are `SessionFailed … database is locked errcode=5` — the known
store-contention class, **not** seat failures. **Lesson: a `deferredTo:human` row is not evidence of a
question — check the seat's own transcript before relaying it.**

**6. PRIME DIRECTIVE EXECUTED — `qa` IS ALIVE ON DEEPINFRA, `#3347` IS DONE.** `lead` deferred `#3494` to me
("whoever holds the seat-restart lever"), so I ran the seat lever rather than leaving it parked:
`reset qa --dry-run` -> `wouldReset:true` (no live lease), then `intent.mjs qa --op reset --handoff …`
(request `operator-qa-reset-2026-10-20-1`, **resetEntryId 155811**, `05:22:17Z`) — broker-applied, **no broker
stop, no store backup needed**, the write path `docs/runbooks/seat-reset.md` prescribes while the broker runs.
Result: `#3347` was **claimed `05:22:24Z` and done `05:23:22Z`** (sat unclaimed 3h13m), and `qa` now has **three
post-move assistant turns on `deepinfra / Qwen/Qwen3.6-35B-A3B`** (`stopReason: toolUse`). **The
"unverified for target model" label is now satisfied for `qa`** — close `#3494` on the next `pm` pass.
`#3347`'s finding: `qa-item-1087`'s commit is **already on main** (patch-equivalent, `git cherry` `+`), because
`impl-item-1604` carries a duplicate copy — exactly what `#3403`'s re-cut exists to remove. **The 1604 chain
is unblocked.**

**7. `pm` APPLIED ALL THREE RULINGS IN ~5 MINUTES** (re-read from the queue, not from its own claim):
`#3233` cancelled · `#3274` cancelled · `#3491` -> `architect` "`worktree prune-branch <name>`" (the durable
fix, **not** a wider force-delete grant) · `#3492` -> `devtools` "resume your six parked items, operator ruled
the escalations STALE" · `#3493` -> `impl` "resume `#2673` and replace its PROSE gate with a structured
`blockedBy`" (done). The 7 stale rows went `deferred`/`held` -> **`claimed`** — real work, not re-escalation.

**8. LANDING PASS #7 (operator ask) — 2 LANDED, 1 CAUGHT BY PREFLIGHT, 2 GATED.** `main` `77b16a5` ->
`cc82331`. Landed `devtools-item-3239` @`be663f2` (gate #3240 done) and `impl-item-3241` @`9de833f` (gate
#3276 done), both pruned losslessly. Suite **before `pass=180 fail=1` -> after `pass=181 fail=1`** (demos
181 -> 182; the new `seat-instruction-encoding` demo PASSES) — **no new failure, `pitui` #2412 unchanged**.
The first attempt failed `cannot fast-forward main` because a seat advanced main during the 242 s slot wait;
re-preflighted and re-ran (the runbook's prescribed response).

**The reusable catch: `merge-tree` is CLEAN and the tip MATCHED, and the branch is still unlandable.**
`devtools-item-3341` @`92f8a7a` (entry #3476) ships a STALE DERIVED MANIFEST — I merged it in a scratch
worktree at current main and its own new guard failed:
`demo/test-areas.test.mjs` -> "manifest does not cover the suite: `demo/broker-one-connection.test.mjs` is
on disk but not mapped", exit 1. That is the **#1558 landed-then-reverted class verbatim**; the manifest was
generated at its fork point. Routed to `devtools` to regenerate. **Never land a branch that adds or changes
a test over a growing set without running that test against current main.**

**Also not landed, with reasons:** `scribe-item-3471` @`7b8c941` (entry #3560 calls it "1 file +25/-1";
the branch's real delta is **3 files, +151**, including a NEW `docs/DISPOSITIONS.md` — it is a STACK carrying
`3385`+`3303`'s content, so landing it silently satisfies two other entries; `lead`/`pm` must rule) and
`scribe-item-3311` @`2d709eb` (entry #3446: diff inspected and exactly as described — `docs/ROADMAP.md`
+2/-2 — but it has **no verify gate at all**, so it is ungated by the runbook's first gate).

**Scan (147 refs): 38 LANDED · 55 CLEAN · 54 CONFLICT.** Of the 55 CLEAN only 24 are named by a live
landing entry, and only **3** have a DONE verify gate. **Landing is verify-gated, not cleanliness-gated.**
Rulings + all four findings delivered to `pm` (request `operator-land-pass7-2026-10-20-1`, `delivered:true`
`06:16:27Z`).

**9. QUEUE HYGIENE PASS (operator ask) — HUMAN BUCKET IS EMPTY OF REAL ASKS; 1 REAL DEADLOCK FOUND.**
Report delivered to `pm` (request `operator-queue-hygiene-2026-10-20-1`, `delivered:true` `06:31:28Z`; body
at `.spike/delegate/queue-hygiene-2026-10-20/intent.md`). Counts: **held 227 · claimed 9 · deferred 2 ·
queued 48**; only **2** rows carry `deferredTo:"human"`.

**THE DEADLOCK (corrects what this file said one section above): `#3347` IS NOT DONE.** Its `done` at
`05:23:22Z` claims *"branch tip identical to main, the commit was already on main"* — **false, proved by
the branch's own reflog**: the branch WAS at `dd2583b` (1 ahead of main, carrying `src/compacteval.mjs`),
and `qa` rebased it **onto `0a38f1f`, i.e. onto itself**, producing an EMPTY branch. Now
`qa-item-1087` is 0 ahead of main with no `compacteval.mjs`; `dd2583b` is **not** an ancestor of main and
`main:src/compacteval.mjs` is **absent**. `#3403` gates on "after 1087 lands" — a step that now has
nothing to land, so it can never start. **The parking is correct; the GATE is the defect.** Content is
recoverable twice: `dd2583b` is in the reflog, and `impl-item-1604` @`bc41be1` **carries
`src/compacteval.mjs`** and is unlanded. **Ruling needed from `lead`/`pm`: restore `dd2583b` and run the
sequence, OR verify+land 1604 and cancel the re-cut.** Lesson: a rebase that reports "already on main"
must be checked with `git merge-base --is-ancestor <old-tip> main`, never inferred from empty `main..branch`.

**`#3494` (the qa-is-dead marker) — CLOSE IT, condition met.** `qa` has **12 consecutive assistant turns on
`deepinfra / Qwen/Qwen3.6-35B-A3B`** after the reset. "0 assistant turns in the last 8" is a window
artifact (all tool-results), not a dead seat — check a WIDER window before concluding a seat is stuck.

**Cleanup classified for `pm` (no transitions made by the delegate):** **28** landing entries whose pinned
tip is already an ancestor of main (close) — **except `#3428`/`#3430` `auditor-item-2154` @`fac647c`, which
are landed-then-REVERTED: ancestry is true but content is not live, and the rework re-pins the SAME sha so
re-landing is a NO-OP — it needs a NEW commit** (same stale-terminal-entry-against-a-moved-main trap as
#1719); **5** entries with an UNRESOLVABLE tip pin (`#3510 #3526 #3542 #3561` + `#2687` sha-less) needing a
re-verify+re-pin; **40** orphaned held rows whose every cited gate is terminal (incl. operator-priority
`#2598`/`#2599`, the 18-branch rebase `#2681`, and `#2788`/`#2789` — the operator-waiting VIEW + `answer`
spool op); **82** rows are DELIBERATELY parked (BACKLOG/TRIGGER/WINDOW) and must NOT be churned — the
"all cited gates terminal" heuristic false-positives on them; **24** are genuinely unlanded (normal queue).

**10. QUEUE VELOCITY — `qa2` WAS FULLY WIRED AND HAD NEVER BEEN USED. IT IS IN ROTATION NOW.**
Operator asked why `qa` gets every verify when `qa2` exists. Measured: the org edge
`pm -> [... ,"qa2"]` was ALWAYS allowed, the model resolves (`google/gemma-4-31B-it`, 262144 ctx,
`reasoning=false`), the seat carries `capabilities:["verify","review"]` — and **`qa2` had received 0 items
and 0 broker wakes EVER**, against `qa` **397** all-time inbound and `auditor` 92. Nothing was blocking it:
every queued verify was minted from a template whose target was `qa`, and **`#2389`** (the item that would
have decided whether qa2 is in rotation) was itself parked `held` as an unanswered conditional.

Rulings + recommended split delivered to `pm` (request `operator-queue-velocity-2026-10-20-1`,
`delivered:true` `06:46:37Z`). **`pm` applied them within ~90 seconds:** cancelled the three duplicate
twins (`#3522`, `#3532`, `#3589`), claimed `#2389`, and **opened `#3616` — the FIRST item ever addressed to
`qa2`, deliberately framed as a capability probe** (the docs-only `scribe-item-3311` verify, re-issued from
`#3587`). **`qa2` woke at `06:48:05.968Z` (first `WAKE qa2` line in the entire broker log), ran 3 turns on
`deepinfra/google/gemma-4-31B-it`, and COMPLETED at `06:50:01Z`.** Its verdict is CORRECT — independently
re-checked: `02f0004` IS an ancestor of main, the diff is exactly `2 2 docs/ROADMAP.md`, 101/124 untouched.
**One imprecision to note: it reported the BRANCH tip's ancestry (`2d709eb` not on main) rather than the
DELIVERED sha's (`02f0004` on main), so its wording is loose even though the verdict is right — make the
ref to check EXPLICIT in future verify bodies.**

Also delivered in that intent and awaiting `pm`: **`pitui` is RED right now** (`node demo/pitui.test.mjs`
exit 1, `pi-tui resolved somewhere unexpected … vendor/pi-main/packages/tui/dist/index.js`), which
**contradicts `#3531`/`#3532`'s "pitui GREEN on main"** — one measurement is stale, so re-measure before
acting on it. Fixing `#2412` is what restores `land.mjs --suite`, the single largest cost in a landing pass.

**11. SHARED-TREE WIP — 5 MISSING FILES RESTORED, ONE HALF ATTRIBUTED TO `impl`, ONE HALF UNCLAIMED.**
The operator believed someone was converting LF→CRLF. **That is not happening and no such item exists** —
`core.autocrlf=true` just makes git print `LF will be replaced by CRLF`, `.gitattributes` has **zero**
content change, and the real edits are code/docs. The only related item is **#994** (whole-tree Prettier,
`held`, TRIGGER-GATED / DO NOT START).

**Encoding census (all 511 tracked files, repo-scoped):** 506 valid UTF-8, **0 invalid UTF-8**, 0 UTF-16
BOM, 0 NUL, **14 UTF-8 BOM** (`package-lock.json`, `docs/DECISIONS.md`, `scripts/sync-pi.mjs`, …). So a
"re-encode everything to UTF-8" sweep is a **no-op that rewrites every byte**. If it is ever wanted: land
the `tracked-encoding` rule first (`src/trackencoding.mjs` is **absent from main**; it is on
`devtools-item-3342`/`3585`), then BOM-strip the 14 as its own item, never inside a feature change.
`docs/SELFDEV.md`'s rule stands: **UTF-8 without BOM;** BOM is the harmful variant.

**FIXED — 5 tracked files were absent from disk** (`demo/landing-data`, `tui-landing`, `tui-status-bar`,
`tui-conversation-header`, `workable-claim`). Per `runbooks/tracked-files-missing-on-disk.md`: index listed
all 5, HEAD held all 5 blobs, **`git log --all --diff-filter=D` EMPTY** -> never deliberately deleted. Restored
with the FILE-LIST form (`git ls-files <paths> | xargs -0 git checkout-index -f --`; a directory does not
recurse). Verified: **0 deletions left**, `node --check` exit 0, byte-identical modulo CRLF. Nothing discarded.

**ATTRIBUTED: `cli.mjs` +7/−0 is `impl`'s** — it adds the *"P5 / #110 exception … lead ruling #2874,
option B"* comment, i.e. a **#2578 follow-up**. Main's `2bb0427` documents the exception "at both opens" but
`main:cli.mjs` does **not** contain it (`grep -c` -> 0) while the worktree does (-> 1). **Steered**
(`operator-shared-tree-steer-impl-2026-10-20-1`, delivered `07:09:21Z`): confirm authorship, redo it in a
worktree via `prepare_workspace`, commit on a branch + landing entry, and do NOT `checkout`/`restore`/`reset`
the shared tree. Flagged to impl as INFERENCE from the diff text, not proof.

**UNCLAIMED: the remaining 17 files** match **no branch** (blobs compared against all 166 local refs).
Shape is a **docs pass**: `docs/SELFDEV.md` +432/−9, `docs/DECISIONS.md` **+31/−296** (a ledger
CONSOLIDATION = the `#3268`/`#3343`/`#3481` UNION, scribe-owned), plus `demo/prepare-workspace` +87,
`docs/runbooks/local-provider-down` +58, `broker-safe-change` +46, `src/worktree.mjs` +94/−7. Routed to `pm`
(`operator-shared-tree-wip-2026-10-20-1`, delivered `07:09:56Z`) to identify per-file and route.
**Patch preserved BEFORE the repair:** `.spike/delegate/shared-tree-wip-2026-10-20/shared-tree-wip.patch`
(2312 lines). **Nobody may `git checkout -- .` / `restore .` / `reset --hard` / `clean -fd` the shared tree**
— that work is recoverable right now and would not be after.

**NEXT SESSION:** if the shared tree is still dirty, the 17-file WIP has no owner yet — re-check whether
`impl` committed its `cli.mjs` half and whether `pm` identified the docs half. **This blocks every landing.**
Also awaiting: the #3347/1604 ruling, the #3428 rework re-cut, the 40 orphan dispositions, the `#3341` /
`3303->3385->3471` rulings. `qa2` is in rotation. Nothing pushed.

## CLOCK-OUT / SESSION LOG (2026-10-20 ~04:15Z, delegate) — LOCAL MODEL TAKEN DOWN, `qa`/`devtools` BACK ON DEEPINFRA

Operator-directed: stop the PolyStrata local model and move the two local seats to DeepInfra models they
held BEFORE the local move. Done, then verified.

**Model moves in `rig.selfdev.json`** (both ids were ALREADY in `fallbackModels()`, so no catalog edit was
needed — that is the catalog-entry-first rule satisfied by inspection, and `demo/deepinfra-catalog.test.mjs`
still passes with "12 rig seats resolve"):
- `qa`: `local/swift-1.5-iq2_xs` -> **`Qwen/Qwen3.6-35B-A3B`** (its own pre-local DeepInfra verifier model).
- `devtools`: `local/swift-1.5-iq2_xs` -> **`deepseek-ai/DeepSeek-V4.1-Flash`** (its own pre-local model).
  The author/verifier split still holds and is now CROSS-FAMILY again (devtools authors DeepSeek, qa
  verifies Qwen) — the shared-family exception in SELFDEV was a property of the local era only.

**Applied, not assumed:** store backed up (`/.spike/store-backup-*.sqlite`), `up --refresh --dry-run`
named exactly those 2 resets, then the real `up rig.selfdev.json --refresh` wrote them (`resetEntryId`
153838 / 153841). `cli.mjs check rig.selfdev.json` -> `ok:true`, exit 0. Both ids proved with a REAL
completion against DeepInfra (HTTP 200; `deepseek-ai/DeepSeek-V4.1-Flash` returned the exact requested
string). **`qa` note for the next session:** `Qwen/Qwen3.6-35B-A3B` is chatty — at `max_tokens:16` it
returns an EMPTY `content` because its reasoning consumes the budget, and at 512 it leaks reasoning text
into `content`. That is a model-quality property to watch in verifier output, not a resolution failure.

**The local stack is DOWN:** PolyStrata server (pids 14652, 16592) and the `strata.exe` engine (820) were
terminated; `127.0.0.1:8080` refuses connections (curl exit 7) and no seat references `local/` any more.

**RECOVERY COST OF THE FORCE STOP (the operator asked for speed — record it honestly):** `serve --stop`
returned `stopped:false` twice while `impl` held a genlock, so the broker (pid 4528) was killed. That left
(a) **2 stranded genlock files** a dead pid still "held" — cleared by hand after confirming the pid was
gone (`status` showed the exact attention: "held by pid 4528 (impl), which is gone"), and (b) **2 stranded
submissions** (`impl` #153640, `auditor` #153251) reported as `admitted_not_started`. The restarted broker
(pid 13228, passes advancing) re-drove the queue from there. **The store survived intact** — the backup was
taken first and no write corruption appeared. Lesson: a kill is recoverable in this order — verify pid dead,
delete `*.genlock.*`, restart `scripts/serve-noroot.ps1`, then confirm `admitted_not_started` clears.

**Suite after all of it: `pass=180 environmental=0 fail=1`** (`pitui`, #2412), unchanged from the pass #6
baseline — the rig change touched no code.


## CLOCK-OUT (2026-10-20T03:00Z, delegate) — **#3174 LANDED (`main` `b4e88ff`), 3 LANDINGS/PRUNES, 4 LANDING-LIST DEFECTS CAUGHT, 1 VERIFIER INCIDENT RECOVERED**

**Read this first.** The operator's priority stack was #3174 → landing/prune backlog → the M-series.
#3174 is now **on `main`**, and this file's previous pointer was already stale when the session opened (the
queue was ~60 ids ahead of it). Every claim below is backed by a command run in this session.

**1. THE DEFECT IS FIXED AND LANDED.** `impl-item-3174 @5961593` → merge **`b4e88ff`** (`main` was
`c22075a`). Landed with `scripts/land.mjs` and the broker UP (`lock.reserved:true, held:4, waitedMs:36s`).
All three gates checked by hand first: verified (#3374 **and** #3375, both narrow, fresh family — auditor is
GLM vs impl's DeepSeek), tip matches the entry (#3376 names `5961593` = the branch tip = `evidence.artifact`),
and `merge-tree main impl-item-3174` exit 0. **Suite on `main` after: `pass=179 fail=1`, only
`demo/pitui.test.mjs` (#2412)** — identical to the pre-landing baseline. Ref pruned (`git branch -d`).
Two follow-ups stay open by design: **#3219** (thread the item's queue status from `src/seattools.mjs` into
`prepareSeatWorkspace` — until then `itemStatus` defaults `null` → not terminal → **refuse**, the safe
direction) and **#3185** (the path-naming migration `item-<id>-<seat>`, lead's ruling B).

**2. The landing list was wrong FOUR times, and preflight caught each — not a landing.** This is the
reusable part, and `merge-tree` alone would have missed two of them:
- **#3256 said land `devtools-item-1754` AND `devtools-item-2188`.** They are **the same patch**
  (`git patch-id --stable` → identical `b50d9ae9…`, identical trees, identical blob). I landed ONE
  (`fa4e03d`); pm opened **#3340** to confirm `2188`'s content is on `main` (its commit is not an ancestor,
  so `git branch -d` correctly refuses — a CONTENT, not an ancestry, question).
- **#3254 wanted `devtools-item-3238 @7284834`.** `merge-tree` → `CONFLICT (modify/delete):
  demo/test-areas.json deleted in main and modified in …`. Cause: `0976cc4` reverted the WHOLE `#1558`
  stack, so the branch's base is gone. pm opened **#3341**: rebase the whole two-commit stack, then
  regenerate the manifest against the current `demo/` — the stale-derived-manifest rule again.
- **#3134/#3126 were two landing lists for two CLEAN branches that CONFLICT WITH EACH OTHER** in either
  order (both append to `docs/DECISIONS.md`, +154 and +53). pm replaced them with **#3343**: ONE serialized
  ledger UNION branch. **#3234 is marked `done` but produced no union** — its "done" covers the rebase half
  only. Verifies #3127/#3135/#3345 stay unclaimable until that union lands.
- **#3344 (the #3174 entry) was held behind the looped verify** — the inverted-gate pattern. pm replaced it
  with #3376 gated on a narrow re-verify; that is the shape that worked.

**3. A verifier's scratch tree was UTF-16-CLOBBERED and its mass failure was about to be reported as a
Windows bug.** qa's `#3216` tree had `src/worktree.mjs` rewritten as **UTF-16LE with a BOM** (84,784 B,
sha `30ae2edd…`, `node --check` exit **1**), `worktree-old.mjs` a **byte-identical copy of that same corrupt
file** (so the RED control was the corrupted file itself), and **no `node_modules`** — the ~120 "failures" it
was concluding were "pre-existing Windows cleanup permission errors". I removed both trees (the branch was
untouched), reset qa (entry `148969`), and re-issued the procedure. Record:
`docs/incidents/2026-10-20-verifier-utf16-clobbered-scratch-tree.md` (`c22075a`, indexed).
**The class is not one-off:** `temp-1754-rebase/src/worktree.mjs` is also UTF-16LE (2026-10-19 03:58Z).
`main`'s tracked tree is clean — I scanned all 498 tracked files for NUL bytes. pm registered **#3342**:
a `check` rule refusing tracked text files carrying a UTF-16 BOM or a NUL byte.

**4. qa then LOOPED on the same item — 5 compactions, no written report — and the fix was a fresh FAMILY,
not another reset.** The substance was proven twice (its own probes plus my independent RED/GREEN) but it
never wrote it up. I stopped the run (`op stop`, `settled:true aborted:true`), put the evidence to pm, and pm
reassigned a NARROW verify to `auditor` (#3374/#3375), which finished in minutes. **Lesson: a seat that will
not close an item is a context problem — re-route to a fresh seat rather than sending more instructions.**
qa is now reset (entry `152031`) with #3216 explicitly superseded.

**5. Pruned / hygiene:** `devtools-item-1754` (merged), `impl-item-1704` (ahead=0 after impl's `#3258`
rebase — its content was already `main`), `impl-item-3174` (merged), plus qa's four terminal scratch trees.
Tracked tree CLEAN at clock-out.

**6. What the backlog actually looks like now (measured at `main` `b4e88ff`).** After impl's rebase pass
(#3335) exactly ONE branch became clean — `impl-item-1604 @bc41be1` — and it is **a scope question**:
cancelled #2035 dropped it pending the `#1087` call, and `qa-item-1087 @dd2583b` is still CONFLICT (pm
routed the ruling to lead, #3346/#3355, and the rebase to qa, #3347). Everything else in the rebase set is
still CONFLICT and author-owned: `devtools-item-2073/2187/2459`, `impl-item-2574/2578/2777`,
`qa-item-2792`, `security-item-1475`, `architect-item-2730`, `scribe-item-2515`. **Three authors reported a
rebase "done" while the tip had not moved and still conflicts** (`security-item-1475` #3302,
`architect-item-2730` #3331, `devtools-item-2459` #3288) — pm opened #3348 to reconcile. Also:
`scribe-item-3207 @c51813f` is CLEAN but pins D-numbers → cancel candidate; `advocate-item-2985 @7387716`
is CLEAN and docs-only but gated on lead's R-A refinement (#3351/#3360, landing entry #3349).

**7. M-series state (priority 3).** M1a is on `main` (`a55535e`). M1b `impl-item-3056 @6ddf538` is CLEAN and
verified (#3113) and **correctly held** by #3208 step 4. The duplicate registrations that made the release
point ambiguous are gone: pm cancelled **#3063** (duplicate of #3056), **#3064** (duplicate of #3095) and
**#3176** (duplicate of #3216). M2 (#3018) and #3025–#3030 remain held behind step 4 by design.

**8. Broker/metric note.** `selfdev.sqlite.broker.log` carries **38 `PASS-FAILED` in the 24h window**, every
one `SessionFailed … database is locked errcode=5` (last `01:25:52Z`), so `status` shows the `pass-failed`
measure in `warn` band 1 on every read. Passes are healthy (500+, ~5–25 ms) and it cleared on its own — the
known store-contention class, not a new wedge.

## NEXT SESSION
**Current item:** the **serialized DECISIONS.md UNION pass** is the throughput unlock for the docs half
(`#3268` → `#3343`), and the **owner rebase passes** (`#3259`/`#3260`/`#3288`/`#3292`/`#3341`/`#3347`) are
the unlock for everything else. On the code side **`#3308`/`#3309` → `#3313`** (the operator's TUI
landing-screen slice) is the live build chain, verifies `#3314`/`#3315` held behind it.
**Queue id:** `#3268` (ledger union) · `#3343` (its landing list) · `#3376` (the #3174 entry — **moot,
already landed; close it**) · `#3216` (superseded — close it; qa has been reset) · `#3349` (advocate
review, gated on lead) · `#3346`/`#3355` (is `impl-item-1604` back in scope?) · `#3018` (M2).
**Blocker:** none on #3174. Standing: (a) a derived mirror/manifest must be regenerated at land time —
`constitution.txt` ⇒ regenerate `rig.starter.json` (#976; `auditor-item-2154` was **reverted** for skipping it,
rework at `#3428`), and a demo manifest is regenerated against current `main`; (b) `pitui` (#2412) keeps
`land.mjs --suite` unusable — land WITHOUT `--suite` and run the full `node scripts/suite.mjs` on `main`
(baseline now **`pass=180 fail=1`**, `main` `13e60bc` + revert `cc96c0c`).
**Landed 2026-10-20 pass #6 (close these entries):** `#3371` (designer landing-screen spec @`24b7fc9`),
`#3349` (advocate review @`7387716`), `#3257` (FEATURES rows @`e8ce2a0`), `#3392` (impl-item-2578 @`2bb0427`).
**Exact next command:** `DURIG_DB=./selfdev.sqlite node cli.mjs status` · then
`ls -la node_modules/@earendil-works/ | grep -E 'pi-durable|pi-tui'` (`->` pinned; `d`/missing = run
`node scripts/sync-pi.mjs --link` first) · then `git status --short -- . | grep -v '^??'` (expect CLEAN).
**Do not:** land a branch whose commit is not unique (compare `git patch-id --stable` and the TREES, not
`git cherry`) — two "cleared" branches were one patch today; land `devtools-item-3238 @7284834` (its base
was reverted); read the metrics `pass-failed` warn as a live wedge without checking `passAgeMs`; `-D` a ref
that `git branch -d` refuses (that refusal IS the lossless check); re-open `#3216`; push (operator holds the
grant).

## CLOCK-OUT / SESSION LOG (2026-10-20 ~04:00Z, delegate) — LANDING PASS #6: 4 KEPT, 1 LANDED-THEN-REVERTED, `main` `351b03a`→`13e60bc` (revert `cc96c0c`)

Landed and kept: **`designer-item-3307`** @`24b7fc9` (the landing-screen spec #3313/#3359 build against —
#3371 closable), **`advocate-item-2985`** @`7387716` (closes proposal v2's dangling reference — #3349),
**`impl-item-2616`** @`e8ce2a0` (FEATURES rows — #3257), **`impl-item-2578`** @`2bb0427` (cli.mjs comment +
new `demo/broker-one-connection.test.mjs` — #3392). Refs 130→126.
**`auditor-item-2154` @`fac647c` landed then REVERTED (`cc96c0c`)** — it renames `durig`→`durian-pi` and
`DURIG_ALLOW_PUSH`→`DURIAN_PI_ALLOW_PUSH` in `constitution.txt` WITHOUT regenerating `rig.starter.json`'s
`constitutionInline` mirror (#976), reddening THREE demos (starter / commit-model / seat-commit-instructions).
Ref kept at `fac647c`; rework routed to `auditor` at #3428, whose preflight must add `demo/starter.test.mjs`
because merge-tree is blind to a derived-mirror invariant. **Suite after revert: `pass=180 fail=1`** (`pitui`,
#2412); pin checked first and intact. Full evidence: `docs/runbooks/land.md` pass #6 entry +
`.spike/delegate/land-2026-10-20g/report.md` (delivered to pm, request `70d59f5d`).

---

## CLOCK-OUT / SESSION LOG (2026-10-20 ~02:00Z, delegate) — OPERATOR TUI INTENT DELIVERED TO pm AND FULLY REGISTERED

Operator directed the durian-pi TUI capability slice forward: landing screen with per-seat status,
queue size, current work item, action type; select-a-seat steering. Delegate VERIFIED against the tree
first: ROADMAP 99 is already FIXED (`02f0004`, input-as-overlay — do not re-register), ROADMAP 101 is
still open (root cause live: `truncate` in `src/watchview.mjs:13-16` collapses `\s+`; used by
`transcriptTurnLines` at `src/tui/client.mjs:160/:165`; `wrapText` :114 flattens too), ROADMAP 124 not
implemented (`queueItems` feeds only the team-wide status-bar count).
Delivered via `intent.mjs pm` (`d8709f2c`, broker log `01:36:34Z INTENT delivered=1`; body at
`.spike/delegate/operator-tui-capability-2026-10-20/intent-tui-landing-and-steering.md`). pm registered:
**#3307** designer surface spec (claimed) · **#3308** readapi data path · **#3309** ROADMAP 101 fix ·
**#3313** landing-screen render (gated on 3307+3308) · **#3314/#3315** qa verifies (held, gated) ·
**#3310** advocate Phase-2 boundary · **#3311** scribe marks ROADMAP 99 delivered · **#3312** lead
priority/overlap adjudication (claimed). Next session: check #3312's ruling, then follow the chain.
Note: `send` is refused while the broker drives — use `node intent.mjs <seat> --body-file <file>`.

## NEXT SESSION
**Current item:** the operator TUI slice — follow **#3312** (lead's priority/overlap ruling) and the
build chain **#3307 → #3308/#3309 → #3313**, verifies **#3314/#3315**.
**Queue id:** `#3312` (ruling) · `#3307`/`#3308`/`#3309`/`#3313` (build) · `#3314`/`#3315` (verify).
**Blocker:** #3313 is gated on BOTH the designer spec (#3307) and the readapi path (#3308); #3307 is
claimed but unfinished, so impl cannot start the render until it lands.
**Exact next command:** `DURIG_DB=./selfdev.sqlite node cli.mjs status`
**Do not:** re-register ROADMAP 99 (fixed at `02f0004`); push (operator holds the grant).

---

**This file is the live pointer, not history.** `docs/STATUS.md` is history; `docs/ROADMAP.md` is the
backlog; `docs/SELFDEV.md` is the runbook. Update at the end of every session.

## CLOCK-OUT / SESSION LOG (2026-10-20, delegate) — **HUMAN QUEUE CLEARED, 2 PASSES (11 BRANCHES, 10 TREES), 2 INCIDENTS + 1 ROOT CAUSE, 50-COMMIT DOCS AUDIT, LOCAL MODEL → SWIFT 1.5**

*Read this with the `2026-10-20T01:10Z` block below (a parallel delegate session landed the concurrent suite and
reverted one branch). This block records what THIS session did and what it learned, so nobody re-derives it.*

**1. The human queue — answered, not just relayed.** 10 rows sat on `deferredTo:"human"`; they were really
**5 questions**, 1 already answered by evidence, 1 a resume, and 6 stale liveness escalations from a dead `pm`.
Seven rulings (R1–R7) were delivered; the operator **accepted them in full**, which turned them into operator
rulings, and `pm` applied them (`#2806` cancelled, `#2987`/`#2975`/`#2949` + the six stale rows closed,
`#2598` released, `#3089` released). **`#3123` was re-scoped to `#3165`.** Lesson: a `held` row is
unclaimable, so "registered" is not "will happen" — check the held bucket, not just the deferred one.

**2. Two landing + worktree passes (#3, #4): 11 branches landed, 10 terminal trees relocated, refs 95→88.**
`main` moved `f495091` → `66d0ce9` → `ee651e0`. Provenance and counts are in `land.md` / `branch-cleanup.md`
(dated entries) — read those, not this summary. Four traps were added there because they cost real landings:
- **A batch is ATOMIC and its `merged[]` is NOT a report** — it lists scratch merges whose `main` never moved.
- **`add/add` conflicts are order-independent** — two branches that both ADD a path can merge in NEITHER order;
  run the `diff --numstat` superset test and resolve to the superset (that is how `architect-item-3005` landed
  as `-rebased @328d838`).
- **`git cherry +` is not proof a branch is unique** — compare the TREES (`git diff main:<p> <b>:<p>`).
- **The suite can go red AND back green with no commit** — `npm install`/`npm ci` in the SHARED tree replaces the
  pinned `node_modules/@earendil-works/pi-durable` symlink with the registry build (no `./codemode`), failing the
  five `tui-durable` demos. One-line check before trusting ANY suite verdict, in either direction:
  `ls -la node_modules/@earendil-works/ | grep pi-durable` (`->` pinned, `d` clobbered) → fix with
  `node scripts/sync-pi.mjs --link`.

**3. The worktree class has a CODE root cause, not just a doc gap.** A seat "asked about a worktree that no
longer existed"; then `impl` could not rebase `designer-item-2103` because a **locked** worktree over a
**cancelled** item held the branch. Reading `src/worktree.mjs` found the real defect: **the worktree PATH is
item-keyed (`item-<id>`) while the BRANCH is seat-keyed (`<seat>-item-<id>`), and reuse runs
`git checkout -B` unconditionally** — so a second seat preparing an item STEALS the first seat's worktree, and
nothing ever asks who holds a needed branch. Registered **`#3174`** (fix + refusals + failing-first demo) and
**`#3175`** (`lead`: item-keyed path vs seat-keyed branch is D110 territory). Hand-fix for today: free a held
branch with `git -C <holder> switch --detach` — never delete the worktree, never rebuild the branch.

**4. Two incident reports (both indexed):** `2026-10-19-terminal-worktree-mistaken-for-lost-work.md` (sev3, now
with the code root cause above) and `2026-10-19-git-sha-redacted-as-secret.md` (**sev2** — a bare 40-char git
SHA is classified `high-entropy-token` and redacted out of tool output; **confirmed live this session**: a
`devtools` call doing `git rev-parse HEAD` came back as a redaction marker). Consequence to remember: it
**blinds the landing tip-vs-pin gate** and can send the operator to rotate a credential that never existed.
Workaround: use `--short` ids in playbooks and probes.

**5. 50-commit docs audit — two docs were materially WRONG, not just stale.** `docs/SELFDEV.md`'s seat table
claimed to carry "the live values" while listing `impl` on GLM (it is DeepSeek-V4.1-Flash), `qa` on GLM (it was
`local/qwen36`, now Swift), `devtools` on DeepSeek (it was qwen36), omitting `qa2` + `architect`, saying "Ten
seats" when there are 12, and asserting the author/verifier split "is still GLM vs DeepSeek" — **false**, and it
hid that **`devtools` and `qa` shared `local/qwen36`**, i.e. same-family verification. Fixed, with the derivation
command inline and the *rule* (a verifier must not share a family with the author) stated instead of a slogan.
`FEATURES.md` had the pi-pin order BACKWARDS (`#2976` runs `sync-pi --link` **before** `npm ci`); added the
missing Request TRACE (`#2545`), `blockedBy` (`#2951`) and operator-only `pause`/`unpause`/`configure` (`#1966`).

**6. Local model → Swift 1.5** (see the block below): `swift-1.5-iq2_xs`, ctx 65536, on the **Qwen engine**
(`engine\strata.exe`, not `strata-poly`), both models under `PolyStrata-data` on **C:** as the operator asked.

**7. New durable lessons are in `docs/SELFDEV.md` "Operational pitfalls (2026-10-20)"** — read that section, it
is cheaper than rediscovering them: the CLI's trailing `note:` line breaking `json.load`; `loadConfig()` returning
`{config, source, defaultsSource}` (the values are `.config`); Git Bash mangling `robocopy /MOVE`; **Python
`json.dump` defaulting to cp1252 and silently double-encoding `rig.selfdev.json`'s em-dashes** (I did this and had
to fix it forward); hidden installers having no window; a seat's model being read from the rig at wake (no
`up --refresh` needed); and **checking RAM before blaming the rig**.

**8. A broker wedge happened during this session and the obvious explanation was WRONG.** pid 4528 alive, fresh
heartbeat, **no pass for 51 minutes**, no genlock, empty log. The local model was at 95% RAM, so starvation
looked certain — but stopping the model (23% load) still produced no pass, so it was the WEDGE. It then cleared
by itself. The discriminator is now in `runbooks/broker-down-or-stalled.md`: stop the heavy model, wait a pass
window, re-read `passAgeMs`.

## NEXT SESSION
**Current item:** **`#3174`** — `prepare_workspace` must resolve a branch it cannot hold and REFUSE to steal
another seat's worktree (root cause in `src/worktree.mjs:566-568`/`:602`/`:278`; full account in the sev3
incident). **`#3175`** is the `lead` ruling on item-keyed path vs seat-keyed branch — do not let an implementer
decide it. Re-preflight the two `DECISIONS.md` branches (`#3134` `scribe-item-3089`, `#3126`
`scribe-item-3035`) — the mint has LANDED, so they may be landable now.
**Queue id:** `#3174` (the fix) · `#3175` (`lead`: naming) · `#3165` (the reporting half, still HELD) · `#3134` /
`#3126` (re-preflight) · `#2993`/`#3104`/`#3147`/`#3151`/`#3158` (release the verifies gated ON landings that
have happened) · `#3056`/`#3062` (M1 order needs a ruling) · `designer-item-2103` (cancel or re-point).
**Blocker:** two, both real. (a) **RAM ceiling** — Swift IQ2_XS holds ~22 GB of experts on this 32 GB box, so
load sits at 95-96%; forks fail (`cygheap read copy failed`, `Resource temporarily unavailable`) and tool calls
look broken. Free the model before any broker restart or heavy pass. (b) **`docs/DECISIONS.md` is now MINTED
but OUT OF ORDER** — `D114` sits at line 3060 and `D113` at 3087, so the ledger reads D112 → D114 → D113; flag
it to `scribe` (append-only convention: do not rewrite another seat's ledger yourself).
**Exact next command:** `DURIG_DB=./selfdev.sqlite node cli.mjs status` — then, before trusting any suite or
landing verdict, `ls -la node_modules/@earendil-works/ | grep pi-durable` (`->` = pinned; `d` = run
`node scripts/sync-pi.mjs --link` first), and `curl -s http://127.0.0.1:8080/v1/models` to confirm which local
model is actually serving (the rig label is only a label to PolyStrata).
**Do not:** restart the broker while the 22 GB local model is loaded (free it first); mint another `D` number
(the ledger is mid-repair and out of order); land a CONFLICT branch or `architect-item-2700 @d1fde2d` (the old
hardcoded-D114 copy — its content is on `main` as `impl-item-2744`); pop `stash@{0}` (devtools' `#2969` pin WIP);
re-report "suite blocked by 5 `tui-durable` failures" without checking the pin symlink; push (operator holds the
grant).

## CLOCK-OUT / NEXT SESSION START HERE (2026-10-20T01:10Z, delegate) — **LANDING+PRUNE PASS: 2 LANDED, 1 LANDED-THEN-REVERTED, `main` `9882632`→`4d96ae9`; THE SUITE IS NOW CONCURRENT (~64s, default 8)**

**Read this first.** The operator asked for a landing + worktree-prune pass, then for a faster suite.
Both are done; the pass found two branches that are NOT landable as-is (below) and one commit from a
seat arrived mid-pass.

**Landed (kept):**
- `scribe-item-3167` @`b0e9d75` — DECISIONS D113 (waiting ADR) + D114 (CARRY); merge `35f8ae6`.
- `impl-item-3062` @`eb3b337` — M1a structured gate field; merge `a55535e`. (M1b `#3056` stays HELD per
  the ruling in `#3208`; `impl-item-3017` is superseded by it.)

**LANDED THEN REVERTED — `devtools-item-1558` @`17cd7a2` (revert `0976cc4`).** Its own
`demo/test-areas.test.mjs` fails on `main`: `demo/test-areas.json` does not map **57** newer demos
(`blockedby-field`, `broker-*`, `queue-lifecycle-m1a`, …). The branch predates them. The branch ref is
**kept deliberately** at `17cd7a2`; the fix is: regenerate the manifest against current `demo/`, re-run
`demo/test-areas.test.mjs`, then re-land. Do not `-D` it (its content is reverted, not live).

**STOPPED BY ITS OWN TEST — `devtools-item-2412` @`7933858` (not landed).** `node scripts/land.mjs
… --suite` merged it cleanly with the other three, then `demo/command-spool.test.mjs` failed (`configure`
dequeued `{delivered:0, deadLettered:1}`). Cause: `main` now carries the operator-only control-plane gate
(`#1966`/`#2219` D113), and the branch predates it — its `configure` op has no operator provenance. The
landing list `#2645` itself warned "the gate is NOT in effect at this branch"; it is now in effect. Needs
the author to rebase/adapt, not a delegate decision.

**Not landed, with reasons:** `impl-item-3174` (verify `#3216` still claimed), `impl-item-3192` (verify
`#3222` queued), `devtools-item-2969` (verify `#3205` HELD on the landing — inverted gate; also needs the
post-landing `sync-pi --link`), the `#2841` scribe rebase set (touches `rig.starter.json`/`constitution.txt`
without the inline mirror sync), and every CONFLICT branch (~59 of 92 unlanded).

**Prune:** refs **97 → 93** (12 merged refs at start; pruned `qa-item-3104`, `qa-item-3198`,
`impl-item-3062`, `scribe-item-3167`; kept `devtools-item-1558`). Worktrees **203**, nothing forced.
`worktree scratch clean` REFUSED 2 dirty scratches (`%TEMP%/wt-2199`, `./wt-2073`); 6 live item trees are
locked (kept); 31 dirty item trees are already archived under `../pi-opendurig.worktrees/`; `reapable: 0`.
No held ref was released: every merged-but-held ref is held by a LIVE or LOCKED tree.

**Suite speedup (operator ask):** `scripts/suite.mjs` now runs a bounded pool — `--jobs N` /
`DURIG_SUITE_JOBS` (1..32, **default 8**) — instead of sequential `spawnSync`, and gives each demo its own
`TMP`/`TEMP`/`TMPDIR`. Measured here: sequential ~10 min → **8 jobs 64s**, 16 jobs 51s; all runs
`pass=179 fail=1` (the `pitui` #2412 assertion), identical to the sequential baseline. The classifier and
exit codes are unchanged. `demo/suite-env.test.mjs` now asserts `--jobs 0/33/abc` exit 2. Commit `4d96ae9`.
**`land.mjs --suite` still cannot be used while `pitui` is red** — land without it, then prove on `main`.

**A SEAT COMMITTED MID-PASS — `cafee74`** `chore(rig): local provider moves to Swift 1.5
(swift-1.5-iq2_xs)` — it committed the dirty `rig.selfdev.json` I was leaving alone. It also mojibakes the
em-dashes in every seat's instructions (`â€”`). The LIVE store was not refreshed, so `qa` still runs
`local/qwen36` until someone runs `up rig.selfdev.json --refresh`. If that model move was unintended, it
needs an operator ruling, not a delegate revert.

**PM HANDOFF (both DELIVERED — broker log `INTENT delivered=1`: `91d7fa4c` at 01:11:12Z, `6fb0e63b` at
01:19:29Z; pm already registered the work):** intent `91d7fa4c` (the 1558/2412/cafee74
defects) → pm minted **#3238** (rework 1558, claimed by devtools), **#3239** (rework 2412, queued),
**#3240** (verify the rebased configure tip), **#3241** (fix the cafee74 mojibake, claimed by impl),
**#3242** (ruling deferred to lead; **#3244/#3245** ruled: encoding fix only, provider line FROZEN;
store-vs-config drift is LABELED, not gated), **#3246** (DECISIONS entry for that ruling, held), and
**#3243/#3247** corrected devtools landing lists (1558 + 2182 withdrawn). Second intent `6fb0e63b` sent
the rest of the unlanded inventory: **85 unlanded branches (23 CLEAN / 62 CONFLICT)** grouped into
landable-now (1754/2188), needs-a-list (2616 etc.), verify-open (2969/3174), unclassified-clean (10),
conflict families needing author rebase + fresh verify, 11 DRIFT pins, 17 snapshot/duplicate refs, and
the two dirty verify scratches. Full per-branch table in `.spike/delegate/model-1017/preflight-final.tsv`.
The biggest lever pm now owns: the stale **#2312/#2313** rebase-pass items that hide ~20 verified-against-
an-older-main branches. **Final state at clock-out:** `main` `5527dd3` (this session's code `4d96ae9`, docs through `5527dd3`),
suite `pass=179 fail=1` (`pitui`). The pass ended at refs 93 / worktrees 203; by clock-out the seats had
opened their rework branches (`devtools-item-3238` regenerating the manifest, `impl-item-3241` the
encoding fix, `impl-item-3192`, `scribe-item-3035/3089`), so the live counts are **98 refs / 206
worktrees** — that growth is the handoff working, not a prune regression. Two seat commits landed
mid-session (`440d071` local-provider doc, `2b9a14b` session learnings); neither touched the landing set.

**DOCS UPDATED this pass:** new incident
`docs/incidents/2026-10-20-stale-derived-manifest-landing.md` (+ index row); `land.md` gained the
"merge-tree is not currency — run the branch's own new guard against current main" rule, the
`--suite`-is-first-failure caveat, an If-it-fails entry for a branch's own guard failing after landing,
and the pass evidence; `branch-cleanup.md` gained the pass #5 evidence (including "a reverted merge is a
KEEP reason"); `FEATURES.md` gained the concurrent-runner row. `scripts/suite.mjs` change is committed
at `4d96ae9`.

**Exact next command:** `node scripts/suite.mjs` (expect `pass=179 fail=1`, `pitui`) · then
`git status --short -- .` (clean) · then pick the next landing list from the held set, re-preflight each
branch with `git merge-tree --write-tree main <branch>` before landing.
**Do not:** land a CONFLICT branch; use `land.mjs --suite` while `pitui` is red; `-D` `devtools-item-1558`;
force a dirty worktree; push (operator holds the grant).

## CLOCK-OUT / NEXT SESSION START HERE (2026-10-20T00:25Z, delegate) — **THE FOUR DeepSeek SEATS ARE ON `deepseek-ai/DeepSeek-V4.1-Flash-1017` AND RUNNING; the catalog gap that caused the 2026-10-19 outage is closed and guarded**

**Read this first.** The operator asked to switch the dev team to `deepseek-ai/DeepSeek-V4.1-Flash-1017`
and to make the change actually take this time. Done, in that order: **catalog entry first**, then the rig.

**What was done (commit names both):**
1. **`src/providers/deepinfra-models.ts`** — added `deepseek-ai/DeepSeek-V4.1-Flash-1017` to
   `fallbackModels()` with the live-catalogue values fetched 2026-10-20 (1M ctx, 1M max output,
   $0.20/$0.60, reasoning, vision). `buildModels` (cli.mjs:253) reads ONLY this curated list plus the
   rig-default `MODEL_ID`; it does not fetch the live catalogue. That is the exact reason the 19 Oct move
   failed (`no_model` on four seats, zero assistant turns).
2. **`demo/deepinfra-catalog.test.mjs`** — now also asserts the `-1017` entry and its live values, and
   **fails if ANY seat model in `rig.selfdev.json` is absent from the catalog** (skips `local/<id>`,
   which is a separately registered provider). This is the regression guard for the outage class.
3. **`rig.selfdev.json`** — pm, impl, lead and architect moved to `-1017` (scribe stays on
   `DeepSeek-V4-Flash-0731`; it is a different model and was deliberately left on 19 Oct too). Applied
   with `broker-safe-change`: `--dry-run` (named exactly those 4 + the devtools cwd), broker stopped with
   `stopped:true` and the process confirmed gone, `up rig.selfdev.json --refresh` (4 model resets), then
   `scripts/serve-noroot.ps1`. Store backed up first to `.spike/store-backup-20261020-001106`.

**Evidence (all run this session):**
- `node demo/deepinfra-catalog.test.mjs` → exit 0 (`…-1017 present: 1048576 ctx; 12 rig seats resolve`).
- Relevant demos exit 0: `seatmodel`, `refresh`, `up-model-reset`, `local-provider`.
- Full suite: **pass=178 fail=1** (`pitui`, the known resolution-path failure — same as the last baseline).
- Live store: every one of the four seats' latest `pi.agent` base revision names
  `deepinfra / deepseek-ai/DeepSeek-V4.1-Flash-1017`; **pm produced assistant turns on it at 00:12 and
  finished a clean turn (`stopReason: stop`) at 00:15:55Z** — the model resolves and generates.
- Broker after restart: pid 4528, `START`, `WAKE pm`, passes advancing, no `no_model`/`wake-failed` lines.

**Docs:** `docs/SELFDEV.md` table + author line, and the `docs/FEATURES.md` "Model moves are operator
commits" row, now carry `-1017` and the **catalog-entry-first** prerequisite.

**Owed / follow-ups (not done here):**
- **Wire the live DeepInfra catalogue into `buildModels`** (`fetchDeepInfraModels` exists and is unused).
  Today every new seat model id needs a hand-added fallback entry + a suite run; the demo guard catches a
  missing one at test time, not automatically at startup. Register with `pm` if the operator wants it.
- impl/lead/architect have not been woken since the restart (their latest turns predate it); their base
  revisions are `-1017`, so the next wake uses it. pm's run is the proof the id resolves.
- Four seat contexts were reset by the model change, by design (#148/#154).

**Caution observed:** the broker logged `database is locked` PASS-FAILED lines between 00:06 and 00:10
while several `cli.mjs queue`/`status` reads were running; they cleared before the stop and none appeared
after the restart. Do not poll the store heavily while the broker is live.

**Exact next command:** `DURIAN_PI_DB=./selfdev.sqlite node cli.mjs status` · then
`DURIAN_PI_DB=./selfdev.sqlite node cli.mjs up rig.selfdev.json --refresh --dry-run` (expect no changes).
**Do not:** edit `rig.selfdev.json` to a new model id without first adding it to
`fallbackModels()` and running `demo/deepinfra-catalog.test.mjs`; push (operator holds the grant).

## LOCAL MODEL SWITCHED TO SWIFT 1.5 (2026-10-20, delegate, operator-directed)

**The local provider now serves Swift 1.5, not Qwen3.6-35B-A3B.** Both models live under
`C:\Users\Alex\dsh-Projects\PolyStrata-data` — the operator asked to keep local models together, so the new
install was moved off `D:` with `robocopy /MOVE` and nothing was re-downloaded.

| | value |
|---|---|
| served id | **`swift-1.5-iq2_xs`** (verified with `GET /v1/models`) |
| context | **65536** (KV streaming auto-off: it wants ~0.9 GB RAM beside the ~48 GB IQ2_XS asks for, and this PC has 32) |
| endpoint | `http://127.0.0.1:8080/v1` (unchanged) |
| engine | **`engine\strata.exe` (the Qwen engine)** — the OLD model ran on `engine-poly\strata-poly.exe`, so this is a DIFFERENT ENGINE on the same port, not just a different model |
| start | `run-swift-iq2_xs.bat` (config `strata-swift-iq2_xs.json`, regenerated with C: paths) |
| fallback | `run-qwen36-ud-q3_k_m.bat` — still installed, still pointing at valid C: paths |
| rig config | `durig.config.json`: `DURIG_LOCAL_MODEL=swift-1.5-iq2_xs` (was `qwen36`); `DURIG_LOCAL_CONTEXT=65536` |
| seats | `rig.selfdev.json`: `qa` and `devtools` `local/qwen36` → **`local/swift-1.5-iq2_xs`** |

**Verified, not assumed:** `localProviderSpec(loadConfig().config)` returns
`{"id":"local","baseUrl":"http://127.0.0.1:8080/v1","modelId":"swift-1.5-iq2_xs","contextWindow":65536}`;
a real completion returned `SWIFT-OK` at **102 tok/s** (prompt read 128 tok/s); `cli.mjs check rig.selfdev.json`
is `ok:true`. A seat's model is read from `rig.selfdev.json` at wake (`cli.mjs:481`), so the next `qa`/`devtools`
run picks Swift up **without `up --refresh`** — the model is not persisted per conversation.

**Notes for the next session:**
- The old server was `strata-poly` (engine pid 5944, server 15268); both were stopped and 8080 is now the Qwen
  engine. If a seat stalls on the local provider, `docs/runbooks/local-provider-down.md` applies — but check
  `/v1/models` FIRST, and remember the ENGINE changed too, so an old log line about `strata-poly` is expected.
- The served name is only a label to PolyStrata ("model name: anything"), so a stale seat label still reaches
  the server and would merely LIE about which model answered. Keep the rig label truthful.
- Logs: install `PolyStrata\swift-setup.out`, server `PolyStrata\swift-server.out`. Both were launched HIDDEN,
  which is why no console window shows the progress.
- `D:\PolyStrata-data` is now an EMPTY leftover directory and `%APPDATA%\PolyStrata\settings.json`
  `data_dir` was repointed to the C: path, so the empty dir is safe to delete.

## CLOCK-OUT / NEXT SESSION START HERE (2026-10-19T23:35Z, delegate) — **PASS #4: 4 LANDED (`main` → `ee651e0`), 10 TREES RELOCATED, AND THE SUITE-VERDICT TRAP DOCUMENTED**

**Read this first.** Two operator asks this session: (1) "did you submit a work item for the worktree
issue?" → answered below and the defect WAS registered; (2) run the landing + worktree runbook, then
improve it.

**1. THE WORKTREE DEFECT IS NOW A REAL CODE ITEM — `#3174`.** The previous handling only produced
`#3123` (reporting), which `pm` cancelled and re-scoped to `#3165` (`worktree audit` retirement reporting +
the locked-worktree rule) — still *held*, and still **not code**. Reading `src/worktree.mjs` after the
operator suggested the fix belongs there found the actual root cause: **`prepareSeatWorkspace` keys the
worktree PATH by ITEM (`item-<id>`) but the BRANCH by SEAT (`<seat>-item-<id>`)** (`:566-568`), and on reuse
it unconditionally runs `git checkout -B <branch>` (`:602` → `:278`). So a second seat preparing the same
item **silently steals the first seat's worktree**, and nothing ever asks *who holds the branch I need* —
which is exactly why `impl` could not rebase `designer-item-2103`. **`#3174`** now asks for the holder
resolution + the three refusals + a failing-first demo; **`#3175`** is `lead`'s naming question (item-keyed
path vs seat-keyed branch; D110 territory).

**2. PASS #4 LANDED 4 — `main` `abda45b` → `ee651e0`:** `impl-item-2420` @`8770e4b` (fresh non-author verify
`#3171` done), `devtools-item-2638` @`e991830`, `impl-item-2797` @`2828ad4` (the 3-doc designer landing +
README union), `devtools-item-2587` @`de9ac4d`. Ref **95 → 88**, worktrees **201 → 200**, **10 terminal trees
relocated** out-of-tree, project-root item dirs **20 → 12**, `main` unmoved by the prune, nothing forced.
**Suite on `main`: `pass=178 fail=1`** (`pitui`).

**3. ⚠ THE SUITE CAN GO RED AND BACK GREEN WITH NO COMMIT — the most reusable finding of the day.** It bit
twice in 20 minutes. `node_modules/@earendil-works/pi-durable` is a symlink to `vendor/pi-main/packages/durable`
(pinned build, exports `./codemode`); a plain **`npm install`/`npm ci` in the SHARED TREE** replaces it with
the registry build (`1.1.0`, no `./codemode`) and the five `tui-durable-*` demos fail. Diagnose in one line
before believing ANY verdict — in either direction:
```bash
ls -la node_modules/@earendil-works/ | grep -E 'pi-durable|pi-tui'   # '->' pinned, 'd' CLOBBERED
node scripts/sync-pi.mjs --link                                      # the fix; does not dirty the tree
```
Both `land.md` and `branch-cleanup.md` now carry it (`3d50976`).

**4. THE `#2969` PIN WIP IS PARKED, FOR ITS AUTHOR.** The tree arrived dirty (`package.json` +
`package-lock.json`: `^1.3.0` → exact `1.3.0`); the same install clobbered the pin in (3). Parked with a
patch — **`stash@{0}` "delegate: park devtools #2969 exact-pin WIP for 2026-10-19f landing"**, patch at
`.spike/delegate/land-2026-10-19f/devtools-pincaret-WIP.patch` (32 lines). **Do not pop it blind.** `devtools`
must commit it on branch and register a landing entry (`pm` asked it to name the branch/tip at `#3153`).
Tree is CLEAN as of clock-out.

**5. ASKS ROUTED TO `pm` (`operator-pass4-report-2026-10-19-1`, delivered `23:30:56Z`), in priority order:**
(1) **release the four verifies gated ON this pass's landings** (`#3147`, `#3151`, `#3158`, `#3104`, plus
`#2993`) — the inverted-gate pattern is now systemic and a held verify is unclaimable; (2) settle the `#2969`
WIP → branch → entry; (3) **mint the DECISIONS numbers** — `main` still has TWO unnumbered headings
(`## D###` @3060, `## D-<mint>` @3092), highest real number is **D112**, and `scribe-item-3089`/`3035` are
CLEAN but CONFLICT in that one file because they need the serialized pass; (4) rule the M1 order for
`#3056`/`#3062` (CLEAN + verified, but `#3056` removes `workable` and `#3112` says STACKED);
(5) cancel-or-repoint `designer-item-2103` (tip `81780e2`, now a **stranded duplicate** of the landed
`impl-item-2797`).

**Exact next command:** `DURIG_DB=./selfdev.sqlite node cli.mjs status` · then
`git status --short -- . | grep -v '^??'` (expect CLEAN) · then re-run the candidate scan from
`.spike/delegate/land-2026-10-19f/candidates.json` before any further pass.
**Do not:** land a CONFLICT branch; land `architect-item-2700 @d1fde2d` (old hardcoded-D114 copy); `-D`
`architect-item-3005` (content already on `main` as `328d838`); pop `stash@{0}`; trust a suite verdict without
checking the pinned-pi symlink; push (operator holds the grant).

## (superseded) CLOCK-OUT 2026-10-19T23:00Z (delegate) — **LAND+PRUNE PASS #3 (6 LANDED, `main` → `66d0ce9`), a LOCKED-WORKTREE DEADLOCK UNBLOCKED, and a 50-COMMIT DOCS AUDIT**

**Read this first.** Three things this session: the operator asked why a seat was asking about a worktree
that no longer existed (answered + fixed), then asked for a landing/worktree pass and a docs audit of the
last 50 commits.

**1. LANDED 6 — `main` `f495091` → `730d8b8` → `66d0ce9`.** `devtools-item-2976` @`e4e6244`,
`impl-item-2744` @`47dd2ae` (the RE-POINTED `D-<mint>` copy), `architect-item-2984` @`5c50f34`,
`architect-item-3005` (resolved `328d838`), `impl-item-2545` @`1e96d53`, `impl-item-1966` @`9aa2053`.
**Suite on `main`: `pass=178 fail=1`** (`pitui` only) — **the 5 `tui-durable-*` `./codemode` failures are
GONE** (baseline `pass=172 fail=5`); mechanism checked: `node_modules/@earendil-works/pi-durable` now
resolves to `vendor/pi-main/packages/durable` and exports `./codemode`, which is what `#2976` now enforces
in every worktree. **`land.mjs --suite` is usable again** — retire the standing "blocked on 5 failures" line.
**A batch is ATOMIC and `merged[]` is NOT a landing report:** my first batch listed `merged: [2976,2744,2984]`
while `main` never moved (it stopped on an intra-batch `add/add`). Re-preflight against the NEW `main` after
every landing.

**2. `#3052` WAS UNLANDABLE AS WRITTEN** — `2984`/`3005` both ADD the same review file, so they cannot merge
in EITHER order. `3005` is a strict superset (`numstat` 108 added / 0 deleted; main's blob == 2984's blob
`558e67e`), so it was resolved deterministically to 3005's blob in a throwaway worktree and landed as
`architect-item-3005-rebased @328d838`. **`architect-item-3005 @0827b39` is deliberately LEFT (unmerged
content superseded) — do not `-D` it; `pm` decides.**

**3. PRUNE:** refs **94 → 89**, worktrees **210 → 208**, `reapable: 0` (a correct answer), 1 reclaimed
(`impl-item-2744`), 1 correctly REFUSED (`item-2104` holds an untracked `*.broker.inbox.out/`). 163 of 208
trees are the already-relocated `../pi-opendurig.worktrees/*` set — a big count is NOT a leak.

**4. THE LOCKED-WORKTREE DEADLOCK (answered + unblocked).** `impl` could not rebase `designer-item-2103`
because worktree `item-2103` **locked** held the branch, on item `#2103` which is **cancelled**. That is a
deadlock-shaped pair no prune flags (branch held ⇒ cannot rebase; worktree locked ⇒ will not be reaped;
nothing in `attention` fires). Freed losslessly with **`git -C item-2103 switch --detach`** (frees the branch,
keeps every file, works where `worktree remove` refuses on untracked files). `impl` was told at 22:52Z; at
23:00Z the tip was still `e4fd338` and still CONFLICTS, so **the rebase is OWED**.
**No work item existed for the UNBLOCKING half** — `#3123` (held) only covers "audit should report retirement",
and a held row is unclaimable, so nothing was happening. The proposed `check` rule is **"a locked worktree
over a TERMINAL item whose branch is UNMERGED"**; `#3123` needs re-scoping or un-holding.

**5. 50-COMMIT DOCS AUDIT — fixed in `9408f24`.** `docs/SELFDEV.md`'s seat table was materially WRONG (impl
listed GLM, is DeepSeek-V4.1-Flash; qa listed GLM, is `local/qwen36`; devtools listed DeepSeek, is
`local/qwen36`; `qa2`+`architect` omitted; "Ten seats" vs 12) and asserted the author/verifier split "is
still GLM vs DeepSeek" — FALSE after `a5a4d00`/`e4d0222`. Table re-derived with the command inline; the RULE
is stated instead of a slogan, and **`devtools` + `qa` share `local/qwen36`**, so devtools-authored tooling
verified by `qa` is same-family → route to `auditor`/`qa2`. `docs/FEATURES.md`: the pi-pin row had the order
BACKWARDS (`#2976` runs `sync-pi --link` BEFORE `npm ci`); added **Request TRACE** (`#2545`),
**`blockedBy`** (`#2951`), **operator-only `pause`/`unpause`/`configure`** (`#1966`), 10→12 seats.

**STILL OWED (routed to `pm`, not the delegate's to do):**
- **`docs/DECISIONS.md` NUMBERING IS BROKEN ON `main`** — highest real number **D112**, and TWO unnumbered
  placeholder headings are live (`## D###` @3060 from `90d1381`; `## D-<mint>` @3092 from `47dd2ae`).
  **Release `#3089` and widen it to mint BOTH existing placeholders.** **`D113` is FREE** (`scribe-item-2219`
  is unlanded and CONFLICTS: `fd4c233` dangling, tip `a822bbf`), so start at D113.
- **`docs/STATUS.md` is stale** (last `2026-10-18`, i.e. none of the last 50 commits). Register a refresh
  behind `#3089`; the 15 bugfix-cluster merges belong there.
- Not landed, with reasons: `scribe-item-3035` (tip DRIFT `f450cdd`→`f1f788f`), `designer-item-2103` (drift +
  conflict → rebase OWED), `devtools-item-2587` (verify `#3104` held ON the landing — inverted gate, needs a
  ruling like `#2976` got), `impl-item-3017` (SUPERSEDED by F12), the M1 pair (lists HELD, slice in flight),
  and every CONFLICT branch (author non-force rebase + re-verify).
- Close the landed entries: `#2992`/`#3120`, `#3118`, `#3117`, `#3052`, `#3039`, `#2927`.

**⚠ LIVE HAZARD AT CLOCK-OUT: the tracked tree is DIRTY — `package.json` + `package-lock.json`**
(`@earendil-works/pi-coding-agent` `^1.3.0` → exact `1.3.0`, i.e. the Phase-1 pin-caret change / `#2969`).
That is a seat editing the SHARED tree (F12 — **all 12 seats are rooted there** per `audit.seatRoots`), and
it **blocks every landing pass**. Left untouched deliberately (it is someone's in-flight work). Next agent:
find the owner (likely `devtools`, `#2638`/`#2969`) and have it land from a worktree — do not stash it blind.

**Exact next command:** `node cli.mjs status` (`DURIG_DB=./selfdev.sqlite`) → then
`git status --short -- . | grep -v '^??'` to see whether the dep-file dirt cleared, and
`git rev-parse --short designer-item-2103` to see whether `impl` rebased (expected: a new short sha).
**Do not:** land while the tracked tree is dirty; `git stash`/`restore`/`checkout --` that dep-file WIP;
`-D` `architect-item-3005`; re-report "suite blocked by 5 tui-durable failures" (obsolete); push (operator
holds the grant).

## (superseded) CLOCK-OUT 2026-10-19T21:45Z (delegate) — **THE 10 HUMAN-PARKED ITEMS ANSWERED AND DELIVERED TO `pm` (7 RULINGS); NO SEAT WORK, NO PUSH**

**Read this first.** Operator-directed: enumerate every queue item waiting on a human decision, and answer
them back to `pm`. Done. **Nothing was landed or pruned this session** — the rulings unblock a pass the
next agent can run.

**Delivered:** `operator-answer-human-parked-2026-10-19-1` → `pm`, `delivered:true` `21:42:11Z`. Body:
`.spike/delegate/human-decisions-2026-10-19/intent-answer-human-parked-items.md`. Census + the evidence
behind every ruling: `.spike/delegate/human-decisions-2026-10-19/QUESTIONS-AND-RECOMMENDATIONS.md`.
**Then:** `operator-followup-escalation-loop-2026-10-19-1` (loop-breaker, `21:49:49Z`) and
**`operator-accepts-r1-r7-2026-10-19-1` (`21:52:23Z`) — the operator ACCEPTED R1–R7 in full**, so they are
now OPERATOR RULINGS, not delegate recommendations; `pm` may not re-defer any of those rows to `human`.
**`pm` is applying them live:** `#2806` cancelled `21:43:55Z`, `#2975`/`#2949` + all six stale escalations
closed `21:35–21:45Z`, `#2987` closed `21:56:03Z` (*"LEFT deferredTo human — resumed and closed"*, with the
reason recorded so the supervisor cannot re-age it). Remaining on `human` at `21:58Z`: `#2559`, `#2598`,
`#2673`, `#2744`, `#2763`, `#2797`, `#2992` — all inside `pm`'s current turn. Re-check before acting.

**The finding:** of **14 `deferred` rows, 10 carry `deferredTo:"human"`** — but they are only **5 real
questions** (three about the same landing window), **1 already answered by evidence**, **1 that is a resume
not a decision**, and **6 stale liveness escalations from a dead `pm`** (pm is alive again — `21:33:52Z`,
generating; M1 verified `#3059`/`#3060`). Do not re-escalate any of them to the human.

**The 7 rulings (all delivered):**
- **R1 — the landing window is OPEN and the DELEGATE drives, broker stays UP.** `land.md` (2026-10-19) made
  the broker stop OPTIONAL: `land.mjs` publishes a priority reservation and waits for slots, so an external
  caller lands with the broker up. **No operator-declared window is needed** — that was the single question
  behind `#2992`, `#2744`, `#2763`, `#2987`, `#2559`. Order: **`#2992` `devtools-item-2976` @`e4e6244`
  FIRST** (CLEAN, `merge-tree` exit 0; releases the held qa verify `#2993`, unblocks `#2559`) → `#2763`
  `impl-item-2420` @`e5b364f` (CONFLICT `cli.mjs`+`src/broker.mjs` → author non-force rebase + fresh
  non-author verify, then re-pin) → `#2744` (after R1b) → `#2797` last.
- **R1b — the DECISIONS.md writers serialize as ONE scribe pass**, minting free numbers at land time:
  `#3011` → `#3031` → `#3035` → `#3046`. Pre-check `D113` first: its reservation rests on a DANGLING commit
  `fd4c233` (branch `scribe-item-2219` is gone; `#2284` pins the sha), so `scribe` must decide
  landable-from-sha (→ D113 reserved) or not (→ D113 free) BEFORE the mint. Then `#2744` lands with its
  hardcoded `D114` rewritten to the number `#3011` actually minted.
- **R2 — `#2797` KEEP + CONSOLIDATE, `#2806` CANCEL.** `#2806` pins `@daa2f0c`, an ANCESTOR of the tip
  `e4fd338`, so it is a duplicate pin that would lose two docs. Re-point `#2797` to `e4fd338`; its subject
  now carries THREE docs. The `docs/runbooks/README.md` conflict is a both-sides-add INDEX conflict — union
  the rows (`resolve-merge-conflict.md`); nothing is a deletion.
- **R3 — `#2630` stays HELD until `#2797` lands** (option (a), advocate's position): the GATED review must
  judge text citable on `main`.
- **R4 — the `#2698` acceptance shape IS citable at `#2955`.** Do not ask the operator for prose and do not
  reconstruct from memory: the ruling "accepted as recommended" plus the `#2788`/`#2789`/`#2804`/ADR chain is
  the shape; `scribe` records it from `#2955` in the R1b pass, and `#2698` stands with a one-line re-verify.
- **R5 — `#2949` CLOSED by evidence**: the delegate restored `scripts/` from the index (9/9 files) and
  `node --check scripts/land.mjs` exits 0 (re-verified this session). Close its deferral; purge the stale
  `#2949` citation from any entry note that still calls it a live blocker.
- **R6 — `#2598` RELEASE and RE-QUEUE** (its environment blocker is gone: `4a1fe16` IS an ancestor of
  `main`, dep files in sync, npm does publish `pi-agent-core@1.3.0`), sequenced BEHIND `M1a` `#3062`.
- **R7 — the six stale escalations consumed and closed** (`#2942`, `#2943`, `#2947`, `#2948`, `#2673`,
  `#2797`): their premise (pm dead 3–4 runs) is void.

**TOOL TRAP (hit this session):** `node cli.mjs queue|status` appends a trailing
`note: N measure(s) out of band` line, so `json.load(sys.stdin)` fails with **`Extra data`**. Redirect to a
file and use `json.JSONDecoder().raw_decode`, or strip the last line — do not conclude the store is corrupt.

**Exact next command:** `DURIG_DB=./selfdev.sqlite node cli.mjs status` then re-preflight the R1 order:
`for b in devtools-item-2976 impl-item-2420; do git merge-tree --write-tree main $b >/dev/null 2>&1 && echo "$b CLEAN" || echo "$b CONFLICT"; done`
**Do not:** land anything on the strength of R1 without re-preflighting each branch (the ruling gives the
ORDER and the DRIVER, not a waver of the three gates); `git add -A`; force a dirty worktree; delete an
`ahead>0` ref; push (operator holds the grant); re-escalate the five questions above to the human.

## (superseded) CLOCK-OUT 2026-10-19T21:30Z (delegate) — **LAND+PRUNE PASS #2: 2 VERIFIED BRANCHES LANDED (`main` `a2d6b95`→`020e136`), 10 REFS PRUNED, 129 ORPHAN WORKTREES RELOCATED OUT-OF-TREE**

**Read this first.** Operator-directed after the redesign was accepted: run the landing runbook to merge
completed branches, prune them, and prune worktrees no longer in use. Git-only; the broker stayed UP.

**Landed (verified + tip-matched + clean against `main`):**
- **`impl-item-2951 @8ca9ba9`** (structured `blockedBy` gate field; verify `#2981`/`#2988` done) — the
  base the redesign's M1 builds on.
- **`devtools-item-2261 @f36ca3e`** (`git` skill: `git diff --no-color` row; re-verify `#2668`/`#2671`).
- Landed with `scripts/land.mjs` **without `--suite`** because the suite is RED on `main` *before* the
  landing (see below). `main` `a2d6b95` → **`020e136`**.

**Evidence:**
- **Suite on `main` (post-land): `pass=172 fail=5`** — all five are `demo/tui-durable-*.test.mjs`, all the
  SAME pre-existing failure: `ERR_PACKAGE_PATH_NOT_EXPORTED: Package subpath './codemode' is not defined
  by "exports" in @earendil-works/pi-durable` (the installed released pi-durable lacks the vendored
  pin's `./codemode`; the #2412/#2413 version-visibility family). **Proved pre-existing**: I ran
  `demo/tui-durable-boot.test.mjs` on `main` BEFORE the landing → exit 1, same error. The `--suite` gate
  correctly refused the landing on this failure and did NOT advance `main`; the fallback (prior passes'
  path) landed without `--suite` and this run proved the result on `main`.
- `node demo/pitui.test.mjs` now **passes** (exit 0) — the `pi-tui` symlink is gone (a real dir).

**Pruned / relocated:**
- **Refs 96 → 86.** 10 merged refs pruned: 4 free (`advocate-item-3006`, `devtools-item-2608`,
  `devtools-item-2966`, `impl-item-2951`), 6 via worktree release (`devtools-item-2261/2390/2514`,
  `advocate-item-2698`, `scribe-item-2944` relocated; `impl-item-1547` unlocked+removed, clean+cancelled).
- **129 orphan worktrees relocated** to `../pi-opendurig.worktrees/` (the operator-approved
  relocate-out-of-tree path; every tracked+untracked file preserved), then `git worktree prune`. Project
  root `item-*` dirs went **~155 → 24**. Archive now holds 170 trees.
- **Kept (intentional):** 17 locked worktrees, `item-2188` (holds nested worktrees), 8 live-item trees
  (held/claimed), and the scratch trees (`temp-*`, `wt-2073`, `.durig-verify-2336`). `main` UNMOVED by
  the prune; **nothing forced**; tracked tree CLEAN.

**STILL OWED / FYI:**
- **The suite is RED on `main` (5 `tui-durable-*` failures, pre-existing).** This blocks `land.mjs
  --suite` for EVERY future landing. Root cause: the installed `@earendil-works/pi-durable` ≠ the vendored
  pin (missing `./codemode`). Land/re-pin it (`sync-pi --link`) or fix the import — likely the same family
  as **#2412** / the `pi-build-version-visibility` incident.
- `pm` can close the two landed landing lists (`#2983`, `#2667`); `#2951`/`#2261` are now ancestors of
  `main`.
- **The redesign implementation `M1–M7` is still not registered** — `pm` has been routing the ruling
  escalations (`#3001`–`#3010`; F12 ruled via `#3003`/`#3004`). First slice = **M1**.
- Standing: `impl-item-2574`/`2578`/`2777` still conflict (need author non-force rebase); `#2976` verify
  `#2993` still held; push owed (operator holds the grant).

**Exact next command:** `DURIG_DB=./selfdev.sqlite node cli.mjs queue | python -c "import json,sys;d=json.load(sys.stdin);print([(i['id'],i['status'],i['to']) for i in d['items'] if i['id']>3010])"`
**Do not:** `git add -A`; force a dirty worktree; delete an `ahead>0` ref; pop a stash blind; push;
land with `--suite` until the 5 `tui-durable-*` failures are fixed (report the exact `pass=N fail=M`).

## (superseded) NEXT SESSION — see the top of this file
**The pointer below is stale: `main` is now `440d071`; the `DECISIONS.md` mint has landed (so `#3134`/`#3126`
need RE-PREFLIGHT rather than waiting on a mint), and the local model is Swift 1.5.**
**Current item:** the worktree defect is now a real build item — **`#3174`** (`prepare_workspace` must
resolve a branch it cannot hold + REFUSE to steal another seat's worktree), with **`#3175`** for `lead`'s
naming question. `main` is at **`ee651e0`**, suite `pass=178 fail=1`, tracked tree CLEAN, `stash@{0}` holds
devtools' `#2969` pin WIP.
**Queue id:** `#3174` (the code fix) · `#3165` (still HELD; reporting half only) · `#3134`/`#3126` (blocked on
the DECISIONS mint) · `#3146`/`#3150`/`#3157`/`#3103` (landed — close) · `#3147`/`#3151`/`#3158`/`#3104` (release
these verifies) · `#3056`/`#3062` (M1 order ruling) · `#2797`/designer-item-2103 (cancel or re-point).
**Blocker:** `docs/DECISIONS.md` has two unnumbered headings on `main` (highest real number **D112**), so the
two clean `DECISIONS.md` branches cannot land; and the inverted verify gate needs a pm policy (verify held ON
a landing is unclaimable unless released in the same breath). Standing: **82 unlanded refs**, mostly the
conflict set needing author rebases; push owed (operator holds the grant).
**Exact next command:** `DURIG_DB=./selfdev.sqlite node cli.mjs status` then
`git status --short -- . | grep -v '^??'` and `ls -la node_modules/@earendil-works/ | grep pi-durable`
(`->` = pinned; `d` = run `node scripts/sync-pi.mjs --link` before trusting any suite result).

## (superseded) NEXT SESSION — see the top of this file

## (superseded) CLOCK-OUT 2026-10-19T21:12Z (delegate) — **OPERATOR ACCEPTS v2 AS THE DESIGN OF RECORD; REDESIGN LEADS CAPABILITY WORK; IMPLEMENTATION DIRECTIVE DELIVERED TO `pm`**

**Read this first.** Operator ruling, 2026-10-19: **accept the v2 redesign**
(`docs/reviews/queue-lifecycle-redesign.md`) as the design of record, and **it jumps ahead of capability
work** (defect fixes and its prerequisites are not capability work and land first).

**Delivered:**
- `operator-start-queue-redesign-impl-2026-10-19-1` (`delivered:true` `21:03:15Z`) — register the
  **complete** implementation (M1 field model + single mapping/`workable`; M2 propagation in the closing
  commit + backstop; M3 check rules on authored state only; M4 queue-scope attention; M5 the ~11-file
  seam migration; M6 lazy legacy mapping + `backlog`; M7 runbook wiring), route **F12/F11 to `lead`**,
  and land the prerequisites `#2983` → `#2992` → `#2420`/`#2483`.
- The acceptance + priority ruling is delivered to `pm` as a follow-up intent (`operator-accept-queue-
  redesign-v2-2026-10-19-1`): record the decision (DECISIONS.md; derive the next free D-number — D113 is
  reserved by an unlanded scribe item) and start the first slice.

**STATE — verify before acting:**
- **`pm` has NOT yet registered implementation items** (as of `21:10Z` the max id is ~2995 and none
  reference the redesign build). First check: did `pm` register M1–M7 and route F12/F11 to `lead`?
  `DURIG_DB=./selfdev.sqlite node cli.mjs queue | python -c "import json,sys;d=json.load(sys.stdin);print([(i['id'],i['status']) for i in d['items'] if i['id']>2995])"`
- **Prerequisites are built but UNLANDED** (items read `done`; `main..branch` counts are 1–2):
  `#2983` (`impl-item-2951 @8ca9ba9`, the `blockedBy` field; its gate `#2981` is done → releasable);
  `#2992`/`#2993` (`devtools-item-2976 @e4e6244`, prepare_workspace recurrence fix); `impl-item-2420`
  (ahead 1), `impl-item-2483` (ahead 2). **41 held landing lists** — a landing window is the throughput
  constraint.
- **Two scope questions for `lead` (F12, F11):** `#2673`'s `workable` is the same seam (one predicate or
  two); the `waiting`-derivation ADR (D114) is unlanded.

**Exact next command:** `DURIG_DB=./selfdev.sqlite node cli.mjs queue | python -c "import json,sys;d=json.load(sys.stdin);print([(i['id'],i['status'],i['to']) for i in d['items'] if i['id']>2995])"`
**Do not:** implement before `pm` registers items; `git add -A`; force a dirty worktree; push; ship a
partial model (no stubs / "for now" scaffolding — a slice lands only when its model is complete).

## CLOCK-OUT / NEXT SESSION START HERE (2026-10-19T21:05Z, delegate) — **REDESIGN REVIEW LOOP CLOSED: ARCHITECT (4 BLOCKERS + 13 CRs) + ADVOCATE (8 CRs) ADJUDICATED; PROPOSAL REVISED TO v2; 2 ITEMS ESCALATED TO `lead`**

**Read this first.** Operator-directed: have `architect` and `advocate` review the queue-lifecycle
redesign, then the proposal owner (me) reviews their change requests.

**Done this session:**
- **Review request delivered** (`operator-queue-redesign-review-2026-10-19-1`, `delivered:true`
  `20:37:55Z`). `pm` registered **`#2984`** (architect) and **`#2985`** (advocate); `#2986` was a
  duplicate, cancelled.
- **Both reviews delivered (read them):**
  `docs/reviews/architecture-queue-lifecycle-redesign-review.md` (`@5c50f34`, architect-item-2984,
  550 lines, **4 blockers + 13 CRs**) · `docs/reviews/advocate-queue-lifecycle-redesign.md`
  (`@7387716`, advocate-item-2985, 161 lines, **8 CRs, 3 blocker-grade**).
- **Every finding adjudicated; proposal revised to v2** —
  `docs/reviews/queue-lifecycle-redesign.md` now carries a per-finding disposition table in **§13**.
  **22 accepted, 1 accepted-with-refinement (CR-2), 0 declined.** The substantive corrections: v1's
  invariant was not a partition (F1); v1 §9 re-introduced the prose-scanning unsticker v1 §10 rejected —
  fixed by `block.source: declared|legacy` (F2); compound parks need `block.constraints[]` (F3); a stuck
  gate needs `gate-stalled` + a `dependency.reviewBy` (F4); `blockedBy` needs `RM` ids (F5); propagation
  belongs in the **closing commit**, not `driver.mjs` (F7); `defer_work`'s QUESTION enqueue **is** the
  trigger (F8); queue-scope attention needs its own function (F9); a `backlog` reason + revised defaults
  kill the `parked-review-due` firehose (F10/CR-2); **the check rules must judge AUTHORED blocks only**,
  or they turn `check` red across ~153 unmigrated rows and stop every landing (CR-1);
  `send_work({held:true})` must NOT be deprecated before the roadmap ledger has a write surface (CR-3);
  and non-item-close gates (landings, operator windows) need constraints, not `dependency` (CR-6).
- **Withdrawn from v1:** the D114 citation (no such landed decision — architect F11) and the claim that
  the ~51 orphan candidates would auto-open (they would be *visible*; only declared dependencies auto-open
  — architect F2).

**Escalated to `lead` (scope, not the delegate's to decide):**
- **F12** — `#2673`'s lead-ratified `workable(item,seat)` is the *same seam* as this design's claimability
  (and its `requires` clause is not implementable — `requires` is not persisted). One predicate or two.
- **F11/OQ7** — land the architect's draft ADR (review §4) or drop the `waiting`-derivation citation.
- **OQ2 defaults / OQ5 sequencing** — revised defaults (operator 3 d, schedule 14 d, resource 3 d, manual
  7 d, backlog none); read-only rules + queue-scope attention first, axis change behind the reliability
  cluster.

**Next:** deliver the v2 + this response to the reviewers via `pm` (loop closure), then await the
operator/`lead` ruling before any build item is registered. The proposal is still a **document, not a
queue item**.

**Exact next command:** `DURIG_DB=./selfdev.sqlite node cli.mjs queue | python -c "import json,sys;d=json.load(sys.stdin);print({i['id']:i['status'] for i in d['items'] if i['id'] in (2984,2985,2673,2788,2797,2630)})"`
**Do not:** register build items before the ruling; `git add -A`; force a dirty worktree; push.

## CLOCK-OUT / NEXT SESSION START HERE (2026-10-19T20:45Z, delegate) — **DURABLE-TUI STATUS RECONSTRUCTED + UNBLOCK INTENT DELIVERED; THE `held`-ORPHAN CLASS DOCUMENTED (1 INCIDENT, 1 TOPIC DOC, 1 REDESIGN PROPOSAL, 1 RUNBOOK)**

**Read this first.** Operator-directed session: (1) explain why the durable-TUI migration is parked,
(2) release the stale-held rows, (3) document the incident and the topic, (4) propose a queue redesign
that makes a stuck item impossible. No seat work, no push.

**Delivered this session:**
- **Intent `operator-durable-tui-unblock-2026-10-19-1` → `pm`** (`delivered:true` `20:22:19Z`). Asks `pm`
  to `release_work(#2630)` (advocate review; its gate `#2629` is satisfied), route `#2797` (designer doc
  `a3dff23`) for a landing window, and flag the Phase-1 pin caret (`^1.3.0` vs the build-spec's exact
  `1.3.0`) to `devtools`. Body: `.spike/delegate/durable-tui-unblock-2026-10-19/intent-release-2630-and-land-designer-doc.md`.
- **`docs/incidents/2026-10-19-held-rows-orphaned-by-cleared-gates.md`** (new, indexed) — the class: a
  `held` row whose gate cleared is never released and nothing in `attention` fires. Live evidence: **153
  held rows** (113 `impl`, median ~16 h held, 49 >24 h, ~51 whose cited gates are all terminal).
- **`docs/WORK-ITEM-LIFECYCLE.md`** (new topic doc) — the queue's states/transitions, who may move an
  item, what wakes a seat, what is surfaced, the stuck taxonomy, and an audit script.
- **`docs/reviews/queue-lifecycle-redesign.md`** (new proposal) — the two-axis `stage`/`block` redesign
  with mandatory resolvers, gate-completion auto-release, watchdog attention kinds, and check rules.
- **`docs/runbooks/stale-held-backlog.md`** (new runbook) + indexes updated (`runbooks/README.md`,
  `incidents/README.md`).

**STATE — VERIFIED AFTER THE INTENT (pm acted at 20:23–20:33Z):**
- **`pm` processed `operator-durable-tui-unblock-2026-10-19-1`.** `#2797` is **queued** (designer doc
  `a3dff23` routed for landing); the pin caret is **`#2969`** (claimed by `devtools`); the durable-TUI
  build-chain sequencing is **`#2977`** (`#2788` first → `#2789`/`#2804`/`#2826` → `#2626`).
- **`#2630` is `held` again — correctly.** `pm` released it; `advocate` claimed it and re-held it
  `20:27:04Z` because the proposal commits are only on `designer-item-2103` (not yet on `main`), so the
  article it must review is not in the tree. This is a *legitimate dependency park* and a live instance of
  the incident's class — it moves only when a person remembers; under the redesign it would be a
  `blockedBy: [#2797]` auto-release. **Release `#2630` when `#2797` lands.**
- **The rest of the chain is unchanged and held:** `#2626`, `#2733`, `#2788`, `#2789`, `#2826`, `#2804`,
  `#2098`. `#2977` is the governor `pm` registered for them.
- **The redesign proposal is NOT registered as a queue item** — it needs an operator/lead ruling before
  `pm` decomposes it (see its §11 open questions, incl. the sequencing recommendation to ship the
  read-only check rules + attention kinds first).
- **Pre-existing uncommitted `docs/runbooks/land.md`** (delegate-authored wording fix) is left unstaged.

**Exact next command:** `DURIG_DB=./selfdev.sqlite node cli.mjs status`
**Do not:** `git add -A`; commit another seat's WIP; force a dirty worktree; delete an `ahead>0` ref;
`release_work` a row you are not the sender/recipient of; push (operator holds the grant).

## CLOCK-OUT / NEXT SESSION START HERE (2026-10-19T20:15Z, delegate) — **LONG SESSION: LAND+PRUNE DONE (17 LANDED, 13 REFS PRUNED), WORK-ITEM SCHEMA WRITTEN, 4 SEAT-PATH/STORE FAULTS RECOVERED, MODEL ROLLED BACK; `pm` IS ALIVE AGAIN BUT HAS NOT YET PROCESSED 3 OPERATOR MESSAGES**

**Read this first.** Three operator asks completed (land+prune, schema, queue replies) plus four live
faults recovered. **`main` = `f6ed4e6`** (my last docs commit; `#2801` package-lock fix landed earlier as
`4a1fe16`). Refs 85, worktrees 208, broker **pid 4744** (`state: up`, passes advancing).

**STATE OF THE TEAM — read before acting:**
- **`pm` was DEAD 18:44→20:05** and is now alive. Cause (verified): `last_run_failed: **no_model**` — the
  operator's requested `deepseek-ai/DeepSeek-V4.1-Flash-1017` is ABSENT from the installed
  `@earendil-works` catalogues (present only in the vendored pin `vendor/pi-main`), so the client could not
  resolve it. **I reverted pm/impl/lead/architect to `DeepSeek-V4.1-Flash`**; `pm` took a turn at
  20:05:42. **To use `-1017` you must first make the client know the id** (a `devtools` pin/`sync-pi`
  item, e.g. `node scripts/sync-pi.mjs --link`), then re-point the seats. Do NOT just set the model back.
- **THREE operator messages sit in `pm`'s conversation, delivered but NOT YET PROCESSED:**
  `INTENT delivered=1` at 19:33:57Z (upstream reference feed) and 19:49:59Z (operator rulings, 9 items),
  plus a nudge at 20:05:42Z. **First next-session check: did `pm` register items for them?** If not, re-send
  from `.spike/delegate/land-prune-2026-10-19d/{intent-upstream-reference-feed,intent-operator-rulings-2026-10-19,nudge-pm}.md`.
- **`devtools` seat root FIXED** (delegate action): its persisted `cwd` is now its own worktree
  `.../item-2801` on branch `devtools-item-2801` — previously ALL 11 seats were rooted in the **shared
  tree** (F12), which is how a seat write emptied `src/worktree.mjs`. `worktree audit` confirms. The other
  10 seats are STILL rooted in the shared tree (`#1151` `DURIG_EXPECT_WORKTREE` remains the durable fix).
- **`devtools` holds 13 claims (11 stale, 11–15.8h).** Releasing them is `pm`'s job now that it runs.

**Four faults recovered this session (all documented):**
1. `scripts/` empty on disk → restored from the index (`tracked-files-missing-on-disk.md`, new runbook).
2. **`src/worktree.mjs` at 0 bytes** vs 40,762 in HEAD → broke every CLI verb at import; restored from
   HEAD with CRLF. Runbook `write-corruption-recovery.md` gained the **0-byte shape** + the size-scan
   one-liner that found it. Cause: a seat writing in the shared tree (now mitigated for `devtools` only).
3. Broker `Session failed after a storage error` → `repair-pi-live.mjs ./selfdev.sqlite 4930` +
   `resume`; store backed up to `.spike/store-backup-20261019-150150`. **My `taskkill /F` mid-write caused
   it — do not force-kill a broker that has just accepted a stop; wait for the drain.**
4. Broker wedge (18:54→19:25, 30 min silent, heartbeat fresh, no genlock): recovered by stop→resume→restart.
   **Root cause UNVERIFIED** (process gone; no pass-completion log line exists). `#2420` (bounded stop) is
   still unlanded and is what would contain this.

**DELIVERED — `docs/WORK-ITEM-SCHEMA.md` (canonical, commit `f6ed4e6`):** the queue AND roadmap
numbering/naming schema, fully measured: queue (2,948 items, 421 prose prefixes, 46% of titles lead with a
signal about another item, 325 prose gates, 64/189 roadmap entries carry inline state, and
`verification-without-evidence` flags 304 of which only 81 start with `VERIFY`); roadmap (161 ids 0–160 with
**no gaps**, 13 lettered sub-items, no renumbering, max 160 appended at end, 28 sections of which only 13
carry provenance); and the **correlation gap** (392 queue titles cite `ROADMAP <n>`, 69 roadmap mentions
cite `#NNNN`, neither queryable). Normative: opaque ids, `kind` as a closed 10-value field, state never in
titles, `blockedBy` not prose gates, `<seat>-item-<id>` names, `RM-<n>[a-z]` citations.

**STILL OWED (not mine to do):**
- **3 verified branches still conflict** against `main`: `impl-item-2574`, `impl-item-2578`,
  `impl-item-2777` — need an AUTHOR non-force rebase + a FRESH non-author verify (the old `#2843`/`#2892`/
  `#2897` covered superseded tips). Land serially, `merge-tree` preflight each. Then `#2420` → `#2483`.
- `pm`: close the 18 satisfied landing lists; cancel `#2848` (moot); release devtools' stale claims;
  register the 5 schema check rules from §8/§11.3.
- **Push: 4+ commits unpushed.** `origin/main` = `e72db18`, which is MY commit but was **not pushed by me** —
  the operator must confirm who pushed and whether to push the rest.
- Operator-only: `#1135` pricing source (ruled: vendored table + `asOf` staleness rule), `#994` quiet window
  (**ruled: do NOT declare yet**), `#119203` secret rotation, and the PAT offer for the upstream feed.

**Exact next command:** `DURIG_DB=./selfdev.sqlite node cli.mjs queue | python -c "import json,sys;d=json.load(sys.stdin)['items'];print(max(i['id'] for i in d))"` — if the highest id is still 2949, `pm` has not yet registered the three operator messages; re-send them (paths above).
**Do not:** `git add -A`/commit another seat's WIP (`docs/NEXT.md` and `docs/runbooks/land.md` currently
hold `pm`'s uncommitted edits — leave them); `git reset --hard`/`checkout --`/`clean -fd`; force a dirty
worktree; delete an `ahead>0` ref; land on an old verify; `taskkill /F` a broker mid-drain; set the model to
`-1017` again before the client can resolve it; push without the operator's grant.

## (superseded) CLOCK-OUT 2026-10-19T18:05Z (delegate) — **LAND+PRUNE PASS COMPLETE: `scripts/` RESTORED, 17 BRANCHES LANDED (`main` `67228b9`→`3b79159`), 13 REFS PRUNED; 3 VERIFIED BRANCHES CONFLICT AGAINST THE MOVED `main` AND NEED AN AUTHOR REBASE**

**Read this first.** The operator-directed land+prune pass that the 17:33Z block stopped at its first
GATE was completed. `main` advanced `67228b9` → **`3b79159`**; suite **pass=175 fail=1**, the one failure
being `demo/pitui.test.mjs` — a resolution-path ASSERTION (the `node_modules/@earendil-works/pi-tui`
symlink, #2412), NOT environmental; reported as the exact pass/fail — identical to the pre-landing
baseline (pass=158/fail=1).

**Step 1 — `scripts/` restored (lossless).** `git ls-files scripts/ | xargs git checkout-index -f --`
(note: `git checkout-index -f -- scripts/` does **not** recurse a directory — pass the file list).
All 9 files verified byte-identical to their blobs after CRLF normalisation; two showed a stale index
stat (`M`) which `git add -- <the 2 paths>` cleared with an EMPTY staged diff (no content change).
`node --check scripts/land.mjs` and `scripts/suite.mjs` both pass. **#2889/#2890 are now DISCHARGED** —
the `scripts/` wipe is gone and the landing helper parses. **#2848 (BOM/orphan `land.mjs`) is also
moot**: the on-disk file is HEAD's version and `node --check` exits 0.

**Step 2 — prune (git-only, broker stayed UP).** Re-derived at this moment (the rig creates refs live):
- Deleted merged+free `impl-item-2588`.
- Removed the 2 `reapable` clean+unlocked+terminal worktrees: `auditor-item-2632` (+ `-d`);
  `auditor-item-2757` (worktree only — it was `ahead=4`, so the ref was KEPT as the runbook requires).
- **Relocated out-of-tree** (`git worktree move` → `switch --detach` → `branch -d`, every file preserved)
the 9 merged+dirty+unlocked terminal trees: `designer-item-2629`, `scribe-item-2683`, `qa-item-2701`,
`qa-item-2720`, `qa-item-2728`, `qa-item-2737`, `qa-item-2766`, `qa-item-2772`, `scribe-item-2910`.
- `git worktree prune`. **11 refs freed, 2 worktrees removed, 9 relocated, `main` UNMOVED, nothing forced.**
- KEPT (intentional): the 11 merged refs held by LOCKED worktrees (`advocate-item-2104/2698`,
`devtools-item-2390/2459/2514/2559/2595/2638`, `impl-item-1274/1547/2788`).

**Step 3 — landings (delegate action, never mid-merge; `scripts/land.mjs`, broker UP, `lock.reserved:true`).**
Landed **17 verified+clean+tip-matched branches** one at a time, re-preflighting `git merge-tree` against
the moving `main` before each: `impl-item-2679` (the landing-gate fix — qa #2829 `done`, the gate named by
landing-list #2849), `impl-item-1705`, `impl-item-2460`, `impl-item-2462`, `impl-item-2496`,
`impl-item-2497`, `impl-item-2547`, `impl-item-2572`, `impl-item-2576`, `impl-item-2581`,
`impl-item-2583`, `impl-item-2585`, `impl-item-2586`, `impl-item-2600`, `impl-item-2602`,
`impl-item-2643` (+ `impl-item-2679` first). That is the **whole bugfix cluster 2–12/13** plus the
landing gate, docs, metrics and durable-TUI Phase 1.
- Pruned every landed ref: 12 free `-d`, 4 by relocation (`impl-item-1705`, `impl-item-2600`,
`impl-item-2602`, `impl-item-2643` — all dirty with CARRY residue).
- **Bonus:** landing `impl-item-1705` (tip `349d5d3`) made **`auditor-item-2757` an ancestor of `main`**,
so that `ahead=4` ref was pruned too (`-d`, verified `main..2757` = 0).

**Counts.** Refs **111 → 83**; worktrees **206 → 204**; `main` `67228b9` → `3b79159`; tracked tree clean
(only the 4 pre-existing untracked scratch dirs); not mid-merge; `scripts/` intact and parsing.

**STILL OWED — 3 verified branches CONFLICT against the moved `main`** (they touch `src/broker.mjs` /
`cli.mjs` in the same regions the cluster just landed). All were preflight-skipped, **not forced**:
`impl-item-2574` (bugfix 6/13, qa #2843 `done`), `impl-item-2578` (9/13, qa #2892 `done`),
`impl-item-2777` (context-tokens backstop, qa #2897 `done`). They need an **author non-force rebase
onto `main @3b79159` + re-verify** — route to `pm` (the #2681/#2682 rebase-pass items are the shape).
Also unlanded-but-conflicting: `impl-item-2420` + `impl-item-2483` (the #2237 stack: land #2420 FIRST,
then #2483 — #2483's landing list also carries lead's Q1 rework gate #2783), and stale-tip
`devtools-item-2261` (`tipOK=False` — do NOT land its current tip).

**Operator inputs still owed:** `#994` quiet window, `#1135` pricing source, and the operator-owned
secret rotation (`high-entropy-token`, conv `#119203`). Push: **39 commits ahead of `origin/main`** —
the operator holds the push grant.

**Exact next command:** `DURIG_DB=./selfdev.sqlite node cli.mjs status` then
`for b in impl-item-2574 impl-item-2578 impl-item-2777; do git merge-tree --write-tree main $b >/dev/null 2>&1 && echo "$b CLEAN" || echo "$b CONFLICT"; done`
**Do not:** `git add -A`; `git reset --hard`/`git clean -fd`/`git checkout -- .`; pop a stash blind; force a
dirty worktree; delete an `ahead>0` ref; land an unverified branch or a branch whose tip no longer
matches its landing list; push (operator holds it).

## (superseded) CLOCK-OUT 2026-10-19T17:33Z (delegate) — **LAND+PRUNE PASS STOPPED AT THE FIRST GATE: `scripts/` IS EMPTY ON DISK (#2889/#2890); PRUNE CLASSIFIED BUT NOT EXECUTED**

**Read this first.** The operator asked for a branch-landing + worktree-pruning pass and then handed the
session to a fresh agent. **Nothing was landed, nothing was pruned, nothing was committed to git beyond
this pointer.** Do not re-derive: the diagnosis below is complete and its artifacts are on disk.

**State inherited (verified this session):**
- `main` = **`a70fc27`**, 2 commits ahead of `origin/main` (unpushed — the operator holds push).
- **Shared tree: 9 tracked DELETIONS in `scripts/`** — the directory is EMPTY on disk
  (`apply-commit-discipline`, `degen-scan`, `from-openrig`, `land`, `read-constitution`,
  `repair-pi-live`, `serve-noroot.ps1`, `suite`, `sync-pi`). Already escalated as the deferred **#2889**
  (`pm`→`lead`) / **#2890** (`lead`→`pm`), which call it operator-only and ask for `git restore scripts/`
  then a broker restart. **New evidence this session: the deletion is NOT any branch's change** —
  `git log --all --diff-filter=D -- scripts/` returns nothing, and BOTH the index (`git ls-files -s
  scripts/` = 9) and `HEAD` (`git ls-tree HEAD scripts/` = 9) are intact. So the loss is unexplained, and
  re-materialising the files from the index (`git checkout-index -f -- scripts/`) is **lossless** — there
  is no on-disk content to discard. Seats are blocked from this by the active-seat guard; the delegate is
  not. **This is the single unblocking action.**
- **Broker: pid `7984`, started `06:24:31Z`** (`selfdev.sqlite.broker.json`) — i.e. it PREDATES the
  `impl-item-2360` landing (`9694f84`, `@4813a50`), so `prepare_workspace` still forks `carry:true` and
  every new item worktree inherits the shared tree's dirt (the #2588/#2889 leak symptom). `.spike/serve.err`
  ends at 09:13Z with `complete_work … junction/symlink detected at undefined/node_modules` and repeated
  `supervisor: escalated … reason: degeneration` (impl). Restart owed (operator ask 2 in #2890).
- **`scripts/land.mjs` cannot parse** until the restore runs; `node scripts/suite.mjs` likewise. Landing
  is therefore IMPOSSIBLE right now — that is why this pass stopped rather than guessing.

**Pre-existing cycles to be aware of:** the unbounded-resume trap and the "never `git add -A`" rule still
hold; 8 stashes exist (`stash@{0}` devtools #2412 WIP, `stash@{1}` devtools #2390/#1754 WIP, `stash@{2}`/`{3}`
autostash, `{4}` D109, `{5}` #2321-era, `{6}` configure, `{7}` old) — **do not pop any of them blind.**

**PRUNE — fully classified, safe to execute as step 2** (audit snapshot + lists in
`.spike/delegate/land-prune-2026-10-19c/`: `merged.txt`, `held.txt`, `wtaudit.json`, `queue.json`).
Counts at diagnosis: **111 refs, 206 registered worktrees**, audit `counts` =
`{seat-root:1, non-item:56, dirty:126, locked:10, live:11, reapable:2}`.
1. **Merged + free (delete now, lossless):** `impl-item-2588` (`ahead=0`). `git branch -d impl-item-2588`.
2. **Reapable (clean+unlocked+terminal):** `auditor-item-2632` (`ahead=0`, merged → `git worktree remove`
   then `git branch -d`); `auditor-item-2757` (`ahead=4`, **NOT merged** → remove the clean worktree only,
   **keep the branch**; `-d` will and must refuse).
3. **Merged + unlocked + DIRTY (relocate, never force)** — all `ahead=0`, item terminal, `unc=1..9`:
   `designer-item-2629`, `scribe-item-2683`, `qa-item-2701`, `qa-item-2720`, `qa-item-2728`,
   `qa-item-2737`, `qa-item-2766`, `qa-item-2772`, `scribe-item-2910`. Use the recipe in
   `docs/runbooks/leaked-worktrees.md` (2026-10-19 block): `git worktree move <wt>
   ../pi-opendurig.worktrees/<name>` → `git -C <new> switch --detach` →
   `git merge-base --is-ancestor <b> main && git branch -d <b>`; then `git worktree prune`.
4. **KEEP — intentional (locked or live), do not touch:** the 16 merged refs held by locked/live trees
   (`impl-item-1274/1547`, `advocate-item-2104/2698`, `devtools-item-2390/2459/2514/2559/2595/2638`,
   `impl-item-2788`, plus seat roots) and every `ahead>0` ref (unlanded work — landing window only).
5. **Do not** relocate or remove anything under `item-2188/` (it holds nested worktrees:
   `temp-1558-rebase`, `temp-1754-rebase`, `temp-2073-rebase`, `temp-test-1558/1754`) — nested-first, and
   they are devtools' rebase scratch. The loose root dirs `temp-1558-original/`, `temp-1558-rebase2/`,
   `temp-1754-rebase/`, `.durig-verify-2336/`, `wt-2073/` are untracked and left untouched.

**Order for the next agent (do not reorder):**
1. `git checkout-index -f -- scripts/` → verify `node --check scripts/land.mjs`, `node --check
   scripts/suite.mjs`, `git status --short -- .` clean.
2. Run the prune as classified above (git-only; the broker may stay up). Record before/after ref+worktree
   counts and confirm `main` unmoved.
3. Only then attempt landings — and only **verified** branches. `impl-item-2679` (`@99eecd2`, the
   `shared-tree-on-main`-skips-a-LINKED-worktree fix, queue **#2829/#2830**, landing list **#2849**) is the
   highest-value candidate: its non-author verify **#2680** is `held`, gated on exactly this gate fix — so
   re-run that verify FIRST, do not land on the author's own evidence. Note `#2848` (devtools #2390) also
   complains that the shared-tree `scripts/land.mjs` was BOM/orphan broken; after the restore, the
   on-disk file is HEAD's version, so re-check `node --check` before trusting either report.
4. Land with `node scripts/land.mjs <branch> --db ./selfdev.sqlite` and **no `--suite`** until the linked
   worktree fix is on `main`; prove afterwards with `node scripts/suite.mjs` and **report the exact
   `pass=N fail=M`** — until #2412 lands, the expected one failure is `demo/pitui.test.mjs`, a
   resolution-path ASSERTION (the `pi-tui` symlink), NOT environmental; prove any other failure is new by
   comparing with the pre-change baseline. Then restart the broker (operator-granted) so `carry:false`
   takes effect.

**Exact next command:** `git checkout-index -f -- scripts/ && node --check scripts/land.mjs && node --check scripts/suite.mjs && git status --short -- .`
**Do not:** run `git restore .`/`git checkout -- .`/`git reset --hard`/`git clean -fd`; `git add -A`; pop a
stash blind; force a dirty worktree; delete an `ahead>0` ref; land an unverified branch; push (operator
holds it).

## CLOCK-OUT / NEXT SESSION START HERE (2026-10-19T08:50Z, delegate) — **LAND+PRUNE PASS RAN: 4 LANDED, 9 TERMINAL WORKTREES RELOCATED; 4 ITEMS ESCALATED TO THE OPERATOR**

**Read this first.** Operator-directed landing/merging + worktree-pruning pass, then a second operator
ask (relay the advocate's question + every item awaiting operator feedback). No push; no seat work.

**Shipped this pass (`main` `fbfe772` → `a4dc769`):**
- **LANDED 4 verified branches** with `scripts/land.mjs` (broker UP; `lock.waitedMs=41623`):
  `impl-item-2356` @`02f1a36`, `impl-item-2360` @`4813a50`, `scribe-item-2658` @`90d1381`,
  `scribe-item-1257` @`fe1434e`. Tips matched the pm landing-list tips exactly.
- **Proved on `main`:** `node scripts/suite.mjs` = **pass=158 fail=1** — the one failure is
  `demo/pitui.test.mjs` (the `node_modules/@earendil-works/pi-tui` symlink, #2412 — a resolution-path
  ASSERTION, NOT environmental; confirmed by direct run).
- **PRUNED 9 terminal merged worktrees** by **relocate-out-of-tree** to `../pi-opendurig.worktrees/`
  (lossless: `worktree unlock` → `move` → `switch --detach` → `branch -d`): `auditor-item-1924/2020/2141`,
  `devtools-item-2631`, `impl-item-2233/2356/2360`, `scribe-item-1257/2658`. Refs **80→77** (the live rig
  created refs during the pass); `main` unmoved by the prune; **nothing forced; no `ahead>0` ref deleted**.
- **KEPT:** the 16 remaining merged-held refs (all `live`/`claimed`/`held`/`seat-root`) and **60 unlanded
  refs** (no patch-equivalent duplicates — `git cherry` all `+`). `reapable: 0`.
- **Precondition handling:** devtools' live `M scripts/land.mjs` (#2390 WIP) was parked to a NAMED stash
  with a patch backup (`.spike/delegate/land-prune-2026-10-19b/shared-tree-landmjs.patch`) to satisfy the
  clean-tree gate, then **restored byte-for-byte** (stash popped) after the landing. Artifacts:
  `.spike/delegate/land-prune-2026-10-19b/` (`preflight.txt`, `land.out`, `suite-post-land.out`).
- **HAZARD noted:** 9 seats (`pm`/`impl`/`qa`/`lead`/`scribe`/`devtools`/`auditor`/`security`/`architect`)
  have cwd = the SHARED tree (the F12 seat-root fallback) — the standing `#1151` guard gap.

**OPERATOR FEEDBACK OWED — 4 items escalated to the human** (all are supervisor 15-min escalations of a
question the seat sent to `pm`, not genuine operator decisions; the delegate relayed them with
recommendations): `#2698` (advocate — ETARGET at `prepare_workspace`), `#1705` (impl — stale tip),
`#1966` (impl — window/#1780 sequencing), `#2543` (qa — ROADMAP 97 harness prerequisite). Plus the
standing owed inputs `#994` (quiet window), `#1135` (pricing source), and the secret rotation for the
`high-entropy-token` detection.

**Open/owed:** the landing gate `#2679` is still RED (land without `--suite`); 53 unlanded branches
CONFLICT (author rebase set `#2681`/`#2682`/`#2683`).

**Exact next command:** `DURIG_DB=./selfdev.sqlite node cli.mjs status`
**Do not:** `git add -A`; pop a stash blind; force a dirty worktree; delete an `ahead>0` ref; push
(operator holds it); land an unverified branch.

## (superseded) NEXT SESSION — see the top of this file
**The pointer below is STALE: `pm` HAS since registered `M1`–`M7`, `M1` was built and verified, and `lead`
split it into `M1a` (`#3062`, claimed) / `M1b` (`#3063`, held, axis-fenced). F12/F11 are RULED
(`#3009`/`#3011`/`#3031`). Read the top block instead; kept for the accepted-v2 ruling text only.**
**Current item:** the queue-lifecycle redesign **v2 is ACCEPTED by the operator as the design of record and
leads capability work**. The implementation directive has been delivered to `pm`; **the next step is
`pm` registering the M1–M7 build items** and `lead` ruling F12/F11, then landing the prerequisites
(`#2983` → `#2992` → `#2420`/`#2483`). The first slice should be **M1** (field model + single
mapping/`workable`).
**Queue id:** `#2951`/`#2983` (`blockedBy` field — land) · `#2976`/`#2992`/`#2993`
(prepare_workspace fix — land) · `#2673`/`#2677` (`workable` seam — lead) · `#2788`/`#2789`
(waiting view/answer — fold into M4) · `#2420`/`#2483` (reliability fence).
**Blocker:** `pm` has not registered the implementation items yet; F12/F11 await `lead`; the landing
window is the throughput constraint (41 held landing lists). Standing blockers unchanged:
`impl-item-2574`/`2578`/`2777` need an author non-force rebase + re-verify; push owed (operator holds the
grant).
**Exact next command:** `DURIG_DB=./selfdev.sqlite node cli.mjs queue | python -c "import json,sys;d=json.load(sys.stdin);print([(i['id'],i['status'],i['to']) for i in d['items'] if i['id']>2995])"`

## CLOCK-OUT / NEXT SESSION START HERE (2026-10-19T08:30Z, delegate) — **NEXT-WORK PRIORITIES DELIVERED TO `pm` (3 intents); LANDING GATE `#2679` FIRST, THEN BUG-FIX CLUSTER, THEN STANDING PRIORITIES**

**Read this first.** The operator reviewed the roadmap+queue with the delegate, accepted the
next-work recommendation, and directed that it be delivered as intents to `pm`. No seat work and no
push by the delegate.

**Delivered this session (all `delivered:true`, 08:29:41–42Z):**
- **`operator-next-landing-gate-2026-10-19-1`** — RESTORE THE LANDING GATE: sequence **`#2679`**
  (`land.mjs --suite` refuses every landing; the `shared-tree-on-main` rule from `50f981a` fires in the
  helper's detached scratch) AHEAD of other impl work; failing-first demo; non-author verify `#2680`.
- **`operator-next-bugfix-cluster-2026-10-19-1`** — reaffirms `#2498` (defects outrank capabilities) and
  folds the architect review's ranked broker defects (D112) into ONE ordered cluster: `#2420` → 159
  (`#2496`) → 158 (`#2483`) → 160 (`#2497`) → `#2576`/`#2574`/`#2581`/`#2572`/`#2578`/`#2583`/`#2585`/
  `#2586`/`#2588`. Capability items (153–157, `#2600`) must not jump it. Names the live symptom: `impl`
  submission `#116651` and `auditor` `#118945` are `admitted_not_started` — the `#2576` defect.
- **`operator-next-standing-priorities-2026-10-19-1`** — route `#2600` (durable-tui Phase 1, un-park and
  start now; gate defined by `#2711`/`#2710`), `#2673`+`#2712` (oldest-WORKABLE claim + wake; verify
  `#2675`), `#2598` (#1587 crash-proof CLI cluster) — all sequenced behind the defect cluster.

**Operator-owned, NOT routed (flagged in the delegate's report):** the `secret_detected` notice
(`pm` conv 3, entry `#119203`, high-entropy-token) — per `docs/runbooks/store-secret-detected.md` the
operator must ROTATE the credential (detection-only; no purge verb). Seats must not handle the value.
Still-owed inputs: `#994` quiet window, `#1135` pricing source.

**Do not:** `git add -A`; pop a stash blind; force a dirty worktree; delete an `ahead>0` ref; push
(operator holds it); land an unverified branch.

## CLOCK-OUT / NEXT SESSION START HERE (2026-10-19T08:25Z, delegate) — **SESSION COMPLETE; NEXT AGENT: REVIEW THE ROADMAP TO PICK THE NEXT WORK ITEM; `land.mjs --suite` GATE RED; 45-branch rebase set owed**

**Read this first.** Operator-directed session: (1) close out PM's stale human-queue; (2) land + prune
branches/worktrees; (3) update the runbook; (4) a new operator change request.

**Shipped this session (delegate, no push):**
- **HUMAN-QUEUE (task 1)** — PM was stuck in a degeneration reset loop (context 401k, 15 consecutive
  `pi.reset`); it re-anchored and applied the two already-answered human-queue rounds. Delivered a
  census + nudge `pm-close-stale-human-queue-2026-10-19-1` (delivered `07:30:19Z`); the operator
  confirmed PM is working through the close-outs.
- **LANDED 9 verified branches** with `scripts/land.mjs` **with the broker UP** (#1498
  wait-with-priority; `lock.reserved:true`): `architect-item-2520`, `impl-item-2328/2329/2330/2337`,
  `scribe-item-2597/2458/2461`, `devtools-item-2259`. `main` `4f9e7d6` → `7b6548e` (the last commit,
  `#2654`, is the operator's own direct commit — not a seat). Suite on `main`: **pass=156 fail=1**,
  the one failure `demo/pitui.test.mjs` (the `node_modules/@earendil-works/pi-tui` symlink, #2412 — a
  resolution-path ASSERTION, NOT environmental).
- **PRUNED refs 108 → 73**: 4 clean+locked+terminal worktrees removed (`impl-item-1390`,
  `scribe-item-1531`, `impl-item-1585`, `impl-item-1108`); **27 dirty merged worktrees relocated** to
  `../pi-opendurig.worktrees/` (`git worktree move` + `switch --detach` + `branch -d`; every file
  preserved, nothing forced). `main` unmoved by the prune.
- **BLOCKER ROUTED** — `land.mjs --suite` is RED on EVERY landing: the suite runs in the helper's
  DETACHED scratch, where the `50f981a` `shared-tree-on-main` check rule fires, so
  `demo/check.test.mjs` fails. Routed to `pm` (`landing-prune-report-2026-10-19-1`, delivered
  `08:03:44Z`). Workaround now in `land.md`.
- **NEW OPERATOR CHANGE REQUEST delivered** — `operator-oldest-workable-claim-2026-10-19-1`
  (delivered `08:03:44Z`): a seat should claim the oldest **WORKABLE** item, not the oldest item.
- **RUNBOOKS UPDATED** — `land.md` (QUICK PATH: broker-up landing, `merge-tree` preflight, the
  `--suite` defect + fallback), `branch-cleanup.md` + `leaked-worktrees.md` (the relocate-out-of-tree
  recipe + 2026-10-19 counts). Control-byte scanned.
- **OPERATOR DIRECTIVES (later in the session)** — `operator-directives-2026-10-19-2` (delivered
  `08:19:41Z`) asks `pm` to: (a) un-hold `#2629` and give **designer** work — the delegate already
  `reset designer` to a fresh context (`resetEntryId 118848`) after the operator funded the provider;
  (b) route to `lead` an ask to propose a fix for **devtools' small local model degrading on large
  context**; (c) register a NEW backlog item to make "waiting on the operator" visible AND answerable,
  explored first with `advocate` + `designer` + `architect`; (d) apply all 10 human-queue
  recommendations (including closing stale escalations `#2049/#2068/#2072/#2568`). `#994` still needs
  the operator's quiet-window declaration; `#1135` still needs the pricing-source decision.
- **devtools #2336** — its provisioning WIP (pin.json 9 pkgs + `sync-pi.mjs` sparse `scripts/`) was
  committed to `main` directly by a seat (`415a723`) plus a `nul` `.gitignore` (`bd36d8d`); review found
  **no stray files and no redo needed**; the redundant `devtools-item-2336` ref was pruned.

**Open / owed:**
- **The `--suite` landing gate is RED** (detached scratch vs `shared-tree-on-main`) — needs the owning
  seat to fix (the rule must ignore a linked/detached scratch) + a failing-first demo. Until then land
  WITHOUT `--suite`, then prove on `main` with `node scripts/suite.mjs`.
- **45 unlanded branches conflict** against `main`; need author rebase + re-verify (list in
  `.spike/delegate/cleanup-2026-10-19/merge-preflight.txt`). Clean-but-unlanded, not yet routed into a
  landing list: `devtools-item-1558`/`temp-1558-rebase`, `devtools-item-2412`, `devtools-item-2494`,
  `impl-item-2356`, `temp-2073-rebase` (conflict).
- **12 merged refs stay held** by locked/live/seat-root worktrees (`designer-item-2103`,
  `advocate-item-2104`, `impl-item-1274/1547`, `devtools-item-2459/2514/2559`,
  `auditor-item-1924/2020/2141`, `impl-item-2233`) — do not force.
- **Shared tree is CLEAN** (devtools' pin/sync WIP was committed as `415a723`/`bd36d8d`, #2336). `main`
  is `bd36d8d` + the delegate's docs commit; verify before assuming any WIP.
- **PM degeneration** (context saturation then step-repetition) recurs; the auto-reset recovers it, but
  the durable fix is unlanded (D107 `#2233`).

**Exact next command:** `DURIG_DB=./selfdev.sqlite node cli.mjs status`
**Do not:** `git add -A`; force a dirty worktree; delete an `ahead>0` ref; pop a stash blind; push
(operator holds it); land an unverified branch.

**END-OF-SESSION (2026-10-19T08:25Z):** PM applied every operator directive from
`operator-directives-2026-10-19-2` — `#2629` un-held and **claimed by designer** (fresh context,
provider funded); the operator-waiting item registered (`#2697`) and routed for exploration to
`advocate` (`#2698`, claimed) + `designer` (`#2699`) + `architect` (`#2700`, claimed); the
devtools-local-model ask routed to `lead` and answered (`#2695` done, proposal `#2708`/`#2709`);
`#2543` running (`#2701`), `#2325` verifying (`#2703`), `#1227` held (`#2705`), `#2098` "proven" defined
(`#2702`), and the stale escalations `#2068`/`#2072`/`#2455` routed for close. **No further delegate
action pending.** The operator's next instruction: a new agent reviews the roadmap to choose the next
work item.

## CLOCK-OUT / NEXT SESSION START HERE (2026-10-19T07:25Z, delegate) — **NEXT: IMPLEMENT THE STRANDED-SUBMISSION FIX (#2520 review continues); F12 seat-root fallback still live**

**Read this first.** The devtools #2412 root-cause guard and the policy surface landed this session; the
stranded-submission liveness fix is still open.

**Shipped this session (delegate, operator-directed, no push):**
- **LANDED** — `main` `7296569` → `6335eb9`: `scribe-item-2169` (DECISIONS.md D106) + `security-item-2316`
  (security position UNION), via `scripts/land.mjs --suite` in a broker-stopped window.
- **PRUNED** — merged refs `devtools-item-2412` + `auditor-item-2209`; 4 reapable worktrees; `git worktree
  prune`. Branches 92→90, worktrees 170→165 at that point.
- **INCIDENT (sev1, OPEN)** — `docs/incidents/2026-10-19-stranded-submission-seat-stall.md`: a `placed`
  submission whose conversation has a live-but-not-running task is never settled by
  `reconcileStrandedSubmissions` (`src/broker.mjs:563-576`), so the seat never wakes; only `resume`
  (refused while the broker runs) clears it. The report **carries the exact patch, demo plan, and
  verification steps** (the next implementation task).
- **RECOVERY** — `resume` (broker stopped) settled 6 strands; devtools conv 4930 `pi.live` repaired
  (`node scripts/repair-pi-live.mjs ./selfdev.sqlite 4930`, retired doc 4931; backup
  `.spike/store-backup-20261019-012422`).
- **SEAT-ROOT FIX LANDED (`50f981a` on main)** — `prepare_workspace` now REFUSES a leftover non-worktree
  cwd (`src/worktree.mjs`), the `check` rule **`shared-tree-on-main`** flags the shared tree off `main`
  (`src/checkup.mjs` + `readSharedTreeBranch` in `src/featuredocs.mjs` + `cli.mjs`), and `constitution.txt`
  P3 Safety carries a `git rev-parse --show-toplevel` self-check (`rig.starter.json` inline synced).
  Demos: `demo/prepare-workspace.test.mjs`, `demo/shared-tree-on-main.test.mjs`; starter/check rule-ledger
  controls updated. Recurrence recorded on `docs/incidents/2026-10-17-seat-root-fallback-commit.md`
  (now `mitigated`); recovery procedure added to `docs/runbooks/leaked-worktrees.md`.
- **INTENTS DELIVERED to `pm`** (all `delivered:true`): `architect-broker-code-review-2026-10-19-1`
  (#2520, architect actively reviewing); `pm-triage-human-questions-2026-10-19-1`;
  `operator-decisions-human-queue-2026-10-19-1`; `operator-answers-human-queue-2-2026-10-19-1`.

**Open / owed:**
- **Implement + verify the stranded-submission fix** from the incident (filter live owners in
  `reconcileStrandedSubmissions` to `running`/`completing`; failing-first demo; land; then set that
  incident to `resolved`). `impl` is still stranded (`#110509`) and re-strands after a broker kill.
- **F12 seat-root fallback is STILL LIVE** — seats (`impl`, `pm`, `scribe`, `auditor`, `devtools`, ...)
  run with the **shared tree** as cwd. While implementing `50f981a`, `impl` silently reverted the
  `src/worktree.mjs` edit once; commit work early so a stray `git checkout` cannot drop it. The `#1151`
  `DURIG_EXPECT_WORKTREE` mutation-point guard remains the outstanding control.
- **Suite: `pass=152 fail=1`** — the one failure is `demo/pitui.test.mjs`: `node_modules/@earendil-works/pi-tui`
  is a SYMLINK to `vendor/pi-main/packages/tui`, created by devtools' `sync-pi --link` at 06:38Z (#2412).
  It is a resolution-path ASSERTION, **not** environmental — the runner lists it under REAL FAILURES and
  exits 1, so report the exact `pass=N fail=M`, never "green except pitui". Restore with `npm install`
  (or remove the symlink) if a green suite is required before #2412 resolves it.
- **Stashes (do NOT pop blind)** — `stash@{0}` = devtools #2412 shared-tree WIP (already re-applied in the
  `item-2412` worktree, so a redundant backup); `stash@{1}` = devtools #2390/#1754 WIP; `stash@{2}` =
  configure WIP. Each needs its author; the patch backups live under `.spike/delegate/`.
- `#2520` architect review of broker/CLI/UI/supervisor in progress (ranked work items expected).

**Exact next command:** `DURIG_DB=./selfdev.sqlite node cli.mjs status`
**Do not:** `git add -A`; pop a stash blind; force a dirty worktree; delete an `ahead>0` ref; push
(operator holds it); run `resume` while a `cli.mjs serve` process is alive (confirm the process exited
FIRST — that ordering error caused the conv-4930 corruption at 06:24).

## CLOCK-OUT / NEXT SESSION START HERE (2026-10-19T06:40Z, delegate) — **NEXT: IMPLEMENT THE STRANDED-SUBMISSION FIX; VERIFY THE ARCHITECT REVIEW (#2520)**

Read this block first. The operator's "merge worktrees & branches" task is done for the safe, verified
subset; the durable broker/liveness fix is the open work.

**Shipped this session (delegate, operator-directed, no push):**
- **LANDED** — `main` `7296569` → **`6335eb9`** (suite green): `scribe-item-2169` (DECISIONS.md D106) and
  `security-item-2316` (security position UNION). Broker stopped for the window via `scripts/land.mjs --suite`.
- **PRUNED** — merged refs `devtools-item-2412`, `auditor-item-2209`; four reapable worktrees
  (`item-1754`, `item-2209`, `item-2459/item-1558`, verify-scratch `wt-test-2412`); `git worktree prune`.
  Branches **92→90**, worktrees **170→165**. Dirty/locked orphans left untouched (never `--force`).
- **PARKED (do NOT pop blind)** — the shared-tree devtools WIP (#2390 `scripts/land.mjs` + #1754
  `src/worktree.mjs` + `package-lock.json`) is in **`stash@{0}`**; patch at
  `.spike/delegate/landing-2026-10-19b/tracked-wip.patch`. Its author must reconcile it.
- **INCIDENT (sev1, OPEN)** — `docs/incidents/2026-10-19-stranded-submission-seat-stall.md`: `impl`
  stalled ~80 min on a `placed` submission whose conversation has a **live-but-not-running task**;
  `reconcileStrandedSubmissions` (`src/broker.mjs:563-576`) treats ANY live task as an owner, so it
  never settles and `selectWakes` suppresses every wake. Only `resume` clears it, and `resume` is
  refused while the broker runs. The report contains the **exact patch, demo plan, and verification steps**.
- **RECOVERY** — `resume` (broker stopped) settled 6 strands: `impl #105938`; `pm #107554/#107651/#109532`;
  `devtools #110012/#110440`. devtools conv 4930 `pi.live` corruption repaired
  (`node scripts/repair-pi-live.mjs ./selfdev.sqlite 4930`, retired doc 4931; backup
  `.spike/store-backup-20261019-012422`). Broker healthy (`pid 7984`, PASS advancing).
- **INTENT DELIVERED** — `architect-broker-code-review-2026-10-19-1` → `pm`; `pm` registered **#2520**
  (architect code review of broker/CLI/UI/supervisor → ranked work items). Architect woken `06:33:11Z`,
  actively working.
- **SEAT-ROOT RECOVERY** — the shared tree had been switched to `devtools-item-2412` because devtools'
  cwd (`…\item-2412`) was a plain dir, **not a git worktree**, so its git/file ops hit the shared repo.
  Fixed: WIP parked to `stash@{0}`; plain dir moved aside (`.spike/delegate/seat-root-recovery-2412/`);
  `git switch main`; `git worktree add item-2412 devtools-item-2412`; WIP re-applied in the worktree.
  Shared tree is clean on `main`; devtools now resolves to a real worktree. Recurrence recorded on
  `docs/incidents/2026-10-17-seat-root-fallback-commit.md`.

**Open / owed:**
- **`impl` is STILL stranded** (`#110509`) — needs the durable fix (below) or another
  stop→resume→restart; it is the largest-share author seat and its queue keeps ageing.
- **Implement + verify the durable resolution** from the incident (filter live owners in
  `reconcileStrandedSubmissions` to `running`/`completing` tasks; failing-first demo; land; then set the
  incident to `resolved` with `fix:`/`prevention:`).
- **#2520** — the architect's review; verify the review doc + that `pm` registers the ranked items.
- **Model failures:** `auditor` (400 Invalid request), `designer` (402 no balance) — provider-side.
- Untracked scratch to quarantine: `fix-broker.mjs`, `nul`, `src/borker.mjs.head`, `temp-test-1754/`,
  `wt-2073/`, `selfdev.sqlite.broker.inbox.out/`. **`pi-main.pin.json` is a seat's WIP — do not touch.**

**Exact next command:** `DURIG_DB=./selfdev.sqlite node cli.mjs status`
**Do not:** `git add -A`; pop a stash blind; force a dirty worktree; delete an `ahead>0` ref; push
(operator holds it); run `resume` while a `cli.mjs serve` process is alive (confirm the process is gone
FIRST — that ordering error caused the conv-4930 corruption at 06:24).

## CLOCK-OUT / NEXT SESSION START HERE (2026-10-19T05:45Z, delegate) — **NEXT TASK: MERGE WORKTREES & BRANCHES**

The operator is handing off to a fresh agent to **merge worktrees and branches**. Read this first.

**Shipped this session (delegate, no push):**
- **Architect seat CREATED** (`3112962`): `rig.selfdev.json` gained `architect`
  (`deepseek-ai/DeepSeek-V4.1-Flash`, `thinkingLevel` high), an `architecture` ownership class, and
  edges to/from pm/lead/impl/qa/auditor/security/devtools/scribe/advocate/designer/qa2. Applied with
  `up rig.selfdev.json --refresh`; broker restarted **pid `5116`**. Proposal
  `docs/reviews/architect-seat-proposal.md`; kickoff sent to `architect`, first review requested of `pm`.
- **Broker read path FIXED** (`a70c30d`): `dispatchRead(harness.storage)` referenced a field pi-durable
  does not expose, dead-lettering every CLI read (`ps`/`queue`/`watch`/`ui`). `openHarness` now returns
  its real `Storage`, threaded as `readStorage`. Incident `docs/incidents/2026-10-19-read-storage-handle.md`.
- **UI quick win** (`968d491`): the per-seat live reads are fetched in ONE parallel batch (frame ~1.5 s,
  was ~20 s+); injectable `readStore` + a concurrency assertion in `demo/ui-readstate.test.mjs`.
- **`src/broker.mjs` UTF-16 corruption RESTORED** from HEAD (non-destructive; backup
  `.spike/delegate/broker.mjs.utf16-backup-20261019`); recurrence recorded in
  `docs/incidents/2026-10-19-broker-mjs-one-line-collapse.md`.
- Durable TUI-attach fix queued to `pm` (`durable-tui-attach-2026-10-19-1`).

**UNCOMMITTED — all `devtools` WIP; do NOT blindly commit or clobber:**
- `scripts/land.mjs` (M) — **#2390** (claimed → `devtools`): bounded-concurrency suite
  (`DURIG_SUITE_CONCURRENCY`); mid-implementation.
- `src/worktree.mjs` + `package-lock.json` (M) — **#1754 / #2336** (`devtools`): provisioning consistency /
  `npm ci` → `npm install --prefer-offline` + `sync-pi --sync`. `package-lock` upgrades pi-* 1.1.0 → 1.3.0.
- **Suite:** `pass=149 fail=3` — `land-helper`, `prepare-workspace`, `worktree-reuse-deps`, all from the
  devtools WIP above; not read-path regressions.
- Untracked: `wt-2073/` (mid-merge worktree, `UU docs/DECISIONS.md`, `devtools-item-2073`),
  `temp-test-1754/` (`devtools-item-1754` test worktree), `fix-broker.mjs` + `src/borker.mjs.head` +
  `nul` (bypass/corruption scratch — quarantine, do not commit), `selfdev.sqlite.broker.inbox.out/`
  (broker runtime spool; gitignore candidate).

**Queue id:** `#2390` (suite concurrency, `devtools`, claimed); related `#1754`/`#2336` (provisioning) and `#2420` (bounded stop).
**Exact next command:** `DURIG_DB=./selfdev.sqlite node cli.mjs status` — then `git status --short` and `git worktree list`
**Blocker:** `devtools`' in-flight work is uncommitted in the shared tree (`scripts/land.mjs`, `src/worktree.mjs`, `package-lock.json`), so the suite reads `pass=149 fail=3` (`land-helper`, `prepare-workspace`, `worktree-reuse-deps`) until it is committed/landed; do not treat those as read-path regressions.
**Do not:** `git add -A`; `git checkout`/`reset`/`clean`; commit another seat's WIP; force a dirty
worktree; delete an `ahead>0` ref; pop a stash blind; push (the operator holds it).

## NEXT SESSION
**Current item:** Implement + verify the durable fix for the stranded-submission seat stall
(`docs/incidents/2026-10-19-stranded-submission-seat-stall.md`): filter the live-owner scan in
`reconcileStrandedSubmissions` (`src/broker.mjs:563-576`) to tasks whose state is `running`/`completing`,
add the failing-first demo, land it, then set the incident to `resolved`. In parallel, verify the
architect's broker/CLI/UI/supervisor review doc and the ranked items it produces.
**Queue id:** `#2520` (architect code review, `claimed`); the incident's fix is owed as a new `impl` item.
**Blocker:** `impl` is permanently stranded (`admitted_not_started`, submission `#110509`): no broker
self-heal fires and `resume` is refused while the broker runs. Separately `auditor` (400 Invalid request)
and `designer` (402 no balance) are provider-blocked.
**Exact next command:** `DURIG_DB=./selfdev.sqlite node cli.mjs status`

---

_HISTORICAL (superseded by this block and the 06:40Z clock-out above) — daemon-harness architecture
research; **BOTH ROUNDS CONSUMED** (operator-directed)._ The stale detail follows:
Round 1 (`docs/research/how-to-design-an-llm-harness-which-apps-use-a-daemon.md`) was rejected on its head-line
root-cause claims (already present in pinned pi-durable 1.3.0); round 2
(`docs/research/daemon-harness-architecture-followup.md`) is consumed in
`docs/reviews/daemon-harness-architecture-followup-review.md`. Its lifecycle/watchdog/spool advice is
**already captured** by ROADMAP 61–67 and the broker's existing `requestId` ledger; the genuinely new
local finding is that `node:sqlite` exposes `errcode`/`errstr` and that pi-durable's `BEGIN IMMEDIATE`
**structurally excludes** the deferred-`BEGIN` `SQLITE_BUSY_SNAPSHOT` case. Accepted items now
**ROADMAP 153–160** (registered, not scheduled) for `pm` to sequence. The second follow-up
(`docs/research/daemon-harness-architecture-followup-2.md`) is **consumed and the topic is CLOSED** in the
same review note: `immutable=1` is ruled **unsafe for a live-WAL reader** (decides `#2406`), `filelock`'s
Windows primitive is `LockFileEx` (auto-released on death, local-FS only), and append throughput is not a
deciding factor (157 stays contingency). No third round is owed. **Operator priority delivered to `pm`:**
intent `prioritize-daemon-harness-reliability-2026-10-19-1` (`delivered:true` `04:52:23Z`) asks `pm` to
register and sequence **ROADMAP 153–160 reliability-first**, tied to `#2420`; suggested order 159 → 158 →
160 → 153 → 154 → 156 → 155 → 157(contingency only), with an explicit warning not to spend impl time on
the rejected pragma claims. **SUPERSEDED by the operator's bug-fix-first ruling:** intent
`bugfix-first-2026-10-19-1` (`delivered:true` `04:55:09Z`) orders the bug-fix cluster
(`#2420`, 159, 158, 160) **ahead of all capability items** (153/154/156/155), with the standing rule
that defects/regressions/lock/lifecycle fixes outrank new features.
**Operator-directed — architect seat CREATED and rig restarted (2026-10-19T05:03Z).** The delegate
edited `rig.selfdev.json` (operator grant): new `architect` seat on `deepseek-ai/DeepSeek-V4.1-Flash`
(`thinkingLevel` high), a new `architecture: ["architect"]` ownership class, and edges to/from
pm/lead/impl/qa/auditor/security/devtools/scribe/advocate/designer/qa2. Applied via
`up rig.selfdev.json --refresh`; broker restarted **pid `17828`** (`serve-noroot.ps1`, `START 05:03:11Z`,
passes advancing, no new `pass-threw`). Kickoff sent to `architect` (`architect-kickoff-2026-10-19-1`,
delivered `05:04:11Z`) and the first architecture-review item requested of `pm`
(`architect-first-item-2026-10-19-1`). Proposal: `docs/reviews/architect-seat-proposal.md`.

**⚠️ BLOCKER — the broker-served READ path is BROKEN (P0).** All CLI reads (`ps`/`queue`/`status`/`watch`)
fail with `read: the broker has no storage handle (probeStorage)`. Cause: `src/broker.mjs:377`
calls `dispatchRead(harness.storage, …)`, but pi-durable's `Harness` keeps storage in a private
`#storage` field and exposes no `.storage` (probed on a real Harness: `typeof harness.storage ===
"undefined"`). The proof demo `demo/broker-read.test.mjs` is RED (`delivered:0 deadLettered:1`).
Introduced by `8d48cb1`, kept by `3e17346`. Masked while the broker was down/wedged (reads fell back to
`readLocal`); exposed now that the broker is healthy and serves reads. Fix: have `openHarness` return the
storage it passes to `Harness.open`, and use that handle for reads (one connection), reverting
`applyRequest` to its `probeStorage` argument. Routed/owed — see `#2420` cluster.
**Queue id:** ROADMAP `153–160` (registered); `#2420` (bounded-grace stop addendum, `queued` to `impl`) still open; related `#2406` (read seam vs `pi-durable` version).
**Exact next command:** `DURIG_DB=./selfdev.sqlite node cli.mjs status`
**Blocker:** the broker still honours a stop only at a pass boundary then awaits `harness.waitForIdle()` unbounded, so a wedged pass defeats Ctrl+C / `SIGTERM` / `serve --stop` (`#2420`). Round 2 corroborates the #2420 fix shape (drain deadline → cancel stream/tool → **unconditional** force fallback that does not depend on the wedge) and maps `taskkill /T /F` + Job Objects onto existing ROADMAP 61/63/64. The residual `PASS-FAILED … cause=Error: database is locked` is **narrowed** (retryable busy or `-shm` race; `BUSY_SNAPSHOT` excluded) and tracked as ROADMAP 159. **Read seam (`#2406`): the ruling is now settled** — no second connection; `immutable=1` is unsafe against a live writer (may return wrong results / `SQLITE_CORRUPT`), so reads stay broker-served (D111), and any reader must be short-lived.

_Last refreshed: 2026-10-19T05:0xZ (delegate — daemon-harness research consumed; ROADMAP 153–158 registered; rejection of the report's "missing pragma" root cause grounded in the pin; first follow-up prompt written; no seat work, no push.)_

_Last refreshed: 2026-10-19T05:5xZ (delegate — first follow-up (12 questions) consumed; ROADMAP refined to 153–160; local probe closed the `node:sqlite` errcode question and structurally excluded `BUSY_SNAPSHOT`; second-round prompt written; no seat work, no push.)_

_Last refreshed: 2026-10-19T06:1xZ (delegate — daemon-harness follow-up round 2 consumed; **topic CLOSED**; `immutable=1` ruled unsafe (`#2406`), Windows `filelock` = `LockFileEx`, throughput not a factor; ROADMAP 155/157 refined and cross-linked from `BROKER-ARCHITECTURE.md`; no seat work, no push.)_

_Last refreshed: 2026-10-18T19:32Z (delegate — host+rig recovery complete; recurrence 8 reproduced live, pinned, and FIXED (`6e27ac2`); broker+local LLM up; verify routed to `pm`)._

_Last refreshed: 2026-10-18T20:35Z (delegate — D107 recorded + routed with D105/#2123; local-model reliability + lastActivity defects filed; filed AND recovered a broker retry hot-loop incident)._

_Last refreshed: 2026-10-18T21:12Z (delegate — skills review + D108/D109/D110 recorded; seat-notes and worktree/git/skills intents spooled; **broker WEDGED again** on the `pm` conv-3 storage error)._

_Last refreshed: 2026-10-18T21:45Z (delegate — **broker-served reads LANDED (D111)**: CLI/UI reads go through the broker's pi-durable instance; full suite 144/144; broker healthy pid 15648, impl working)._

_Last refreshed: 2026-10-18T23:58Z (delegate — residual lock contention fixed: the `read` op is served from the harness's OWN storage, one connection; reads consume their result file; regression demo added. Broker recovered pid 7220, 0 `pass-threw`, suite 144/144)._

_Last refreshed: 2026-10-19T00:08Z (delegate CLOCK-OUT — broker recovered again pid 5832 after a fresh `impl conv 9` storage-error wedge; full suite 144/144; handing off to a merge window)._

_Last refreshed: 2026-10-19T00:16Z (delegate, operator-directed — branch/worktree cleanup pass. Pruned **18 merged refs**, reclaimed **18 worktrees** (12 scratch-only + 6 clean verify-scratch), **archived 7** dirty merged worktrees out-of-tree, pruned **25 stale registrations** pointing at missing dirs. Branches **90→72**, worktrees **183→141**, `main` **unmoved** at `0cd84f6`, nothing forced. **57 unlanded refs remain** (cannot be deleted; need the landing window) plus the uncommitted `configure` WIP; mid-merge `wt-2073` (UU `docs/DECISIONS.md`) and `selfdev.sqlite.broker.inbox.out/` left untouched.)_

_Last refreshed: 2026-10-19T00:35Z (delegate, operator-directed — **LANDING WINDOW RAN**: broker stopped, `configure` WIP parked to `stash@{0}` (+ patch), **16 clean branches landed** via `scripts/land.mjs --suite` (suite green), `main` **0cd84f6 → d04f9af**, broker restarted (pid `10760`), healthy ~1 min then **re-wedged on `pm` conv 3 (`Session failed after a storage error`) — the retry hot-loop recurs**; a second restart (pid `4940`) recurred in ~1 min, so the hot-looping process was stopped (no genlock). **41 remain**: 39 conflict (stack tips + duplicates, routed to `pm` for author rebase — see NEXT SESSION), 2 partial-rebrand. Nothing forced; no `ahead>0` ref deleted.)_

_Last refreshed: 2026-10-19T00:51Z (delegate, operator-directed — **WATCH investigation + recovery. The broker does NOT support a polling watcher:** `cli.mjs watch` polls every 750 ms (`WATCH_POLL_MS`), and the idle loop runs a FULL PASS per read intent, accelerating the `probeStorage` contention wedge. `repair-pi-live.mjs ./selfdev.sqlite 3` found **no unreadable pi.live** (contention, not corruption); broker restarted pid `15740` (`WAKE pm`, 0 `pass-threw`). Delivered to `pm`: the watch-support change and the kill-vs-crash observability gap. Conflicts routing already delivered.)_

_Last refreshed: 2026-10-19T01:30Z (delegate CLOCK-OUT — landing window + worktree cleanup + watch/hot-loop investigations; five intents delivered; git remote fixed. See the block below for the follow-up.)_

_Last refreshed: 2026-10-19T01:46Z (delegate, operator-directed — operator watched `impl` call `complete_work` on a dirty workspace; verified and filed incident `docs/incidents/2026-10-19-worktree-carry-teardown-collision.md` and routed the defect as intent `worktree-carry-collision-2026-10-19-1` to `pm` (delivered 01:46:12Z). No product code, no worktree touched. **Priority unchanged: #2237/#2321 broker hot-loop.**)_

_Last refreshed: 2026-10-19T02:06Z (delegate, operator-directed — broker `4432` had died abnormally at ~02:03:49Z after the persistent-throw hot loop (no `EXIT`, heartbeat frozen at 01:50:06Z). Recovery ran: `resume` cleared 4 stranded submissions (impl 98978, scribe 100653, devtools 101217, pm 101262), restart with the local env → **broker UP pid `6508`** (START 02:05:48Z), PASS advancing, **0 `pass-threw`**. **Watch:** the `cli.mjs log impl --follow --full` viewer (pid `10868`) is attached and drives a full pass per ~0.5s read poll (`INTENT delivered=1` each) — the #2321 aggravator; a re-wedge is likely while it stays open.)_

_Last refreshed: 2026-10-19T02:16Z (delegate, operator-directed — the broker re-wedged within ~30s of the 02:05 restart (`PASS 6 ms=5049` → `WAKE-RETRY … pass-threw`, `seats=-`, backoff 2s→60s) and again after 6508. Recovered twice more: `resume` cleared 4 then 3 stranded submissions, restart → **broker UP pid `12240`** (START 02:15:49Z), `PASS 1` woke `impl,qa,scribe,devtools,auditor`, **0 `pass-threw`**. **The restart is NOT durable: a bare restart re-wedges in ~30 s while #2237/#2321 are unfixed.** Safe monitoring (verified): one-shot `node cli.mjs log <seat> <n>` = 2 read intents/passes then exits (uses broker spool, `src/readclient.mjs:34`); `log --follow`/`watch`/`events --follow` poll every 750 ms and force a pass each — the accelerant; a direct store read while the broker lives is a second owner and poisons its session (`SessionFailed`, `src/readclient.mjs:1-11`).)_

_Last refreshed: 2026-10-19T02:19Z (delegate, operator-directed — `#2321` is `done` (impl `02:16:07Z`, `impl-item-2321 @615d64e`) but BRANCH-ONLY (`ahead=1`, `onlyReadIntents` absent from `main`), verify `#2374` (qa) still `queued`, `#2237` `queued` — so the running broker is unfixed. Operator priority routed to `pm`: intent `prioritize-2321-verify-2026-10-19-1` (delivered `02:19:10Z`) — run qa `#2374` ahead of other qa work, confirm no stray shared-tree edit, then land, so a restart stops re-wedging.)_

_Last refreshed: 2026-10-19T02:33Z (delegate, operator-directed — **LANDED #2321.** verify was `#2373` (`done`, qa 02:18:03Z); `#2374` cancelled as its duplicate. Landing window ran OUTSIDE the broker per `land.md`: stopped broker (verified no serve proc, no genlock, `broker.json` gone) → parked the shared tree's tracked WIP to `stash@{0}` (patch: `.spike/delegate/landing-2026-10-19/shared-tree-tracked.patch`) → `node scripts/land.mjs impl-item-2321 --db ./selfdev.sqlite --suite` (148/148) → **`main d058e0a` (`merge: land impl-item-2321 onto main`)**; `onlyReadIntents` now on `main`; broker restarted **pid `16864`** (`START 02:31:01Z`), **0 `pass-threw`** (was wedging within ~4 min). Shared tree is CLEAN of tracked mods. **DO NOT pop `stash@{0}` blindly** — it holds the `configure` WIP + 7 small doc/demo edits; reconcile with `devtools-item-2182` first. `#2372` (scribe-item-2331 landing) still outstanding.)_

_Last refreshed: 2026-10-19T02:35Z (delegate, operator-directed — **operator priority routed**: intent `suite-concurrency-priority-2026-10-19-1` → `pm` (delivered `02:35:36Z`). Make the demo suite / `land.mjs --suite` run with BOUNDED concurrency (`DURIG_SUITE_CONCURRENCY`, isolation for the 61 spawn / 17 `git worktree` / 11 fixed-path / land-helper-genlock tests, flake proof) and sequence it AHEAD of other work, because each landing pass pays the ~5 min suite today. Owner suggested `devtools`, verify `qa`/`auditor`. Evidence in the intent + `.spike/delegate/intent-suite-concurrency-priority.md`.)_

_Last refreshed: 2026-10-19T04:25Z (delegate CLOCK-OUT — read-op hotfix + broker bounded-retry landed; 5+11 temp verify worktrees swept; docs truth-up audit filed; broker UP pid `17976`.)_

## CLOCK-OUT / NEXT SESSION START HERE (2026-10-19T04:25Z, delegate) — **NEXT TASK: ARCHITECTURE RESEARCH & ANALYSIS (operator-directed)**

**Read this block first.** The operator will have the next agent do **architecture research + analysis**; the
broker-stability cluster is the obvious subject. Rig is healthy: `main` = `12b0440` (0 ahead of origin —
pushed), broker **UP pid `17976`** (`PASS` advancing, **0 `pass-threw`** since start), inbox empty.

**Shipped this session (delegate did not push):**
- **Read-op regression fixed** (`3e17346`): `c5daca5` (#2211) had dropped `read` from `SPOOL_OPS` + the
  handler; restored as a UNION with `configure`, and corrected `demo/command-spool.test.mjs` (a second
  stale red). The whole CLI read surface (`status`/`queue`/`watch`) had returned `unknown op: read`.
- **Shared-tree `src/broker.mjs` collapse recovered** (was ONE line, 0 exports): collapsed copy backed up
  to `.spike/delegate/broker.mjs.collapsed-backup-20261019`, HEAD restored + CRLF. Incident → resolved.
- **Landed** `impl-item-2237` (@`3021fe2`: bounded retry + `.stop` on the throwing path + `PASS-FAILED …
  cause=` logging — ROADMAP 78 remainder) and `impl-item-2298` (@`6683790`: land slot-cap resolver) with
  `land.mjs --suite` (**152/152**). `16aa6bf` had already landed `#2412` (`sync-pi --link` after `npm ci`).
- **Docs truth-up audit** `docs/reviews/docs-truth-audit-2026-10-19.md`; fixed two stale `FEATURES.md`
  rows (`lastActivity` #2229; context pressure #2231). Remaining 4 gaps routed to `pm`
  (`intent-docs-truth-up.md`, delivered).
- **Worktrees swept:** 5 registered `%TEMP%/verify*` (junction-first, target-preserving) + 11 bare
  `%TEMP%/verify*` skeletons. Registered worktrees 161→154.
- **Runbooks updated:** `write-corruption-recovery` (CRLF note), `broker-down-or-stalled` (stop-defeat/
  force-stop), `leaked-worktrees` (junction-blocked scratch), `land` (parking another seat's WIP).

**Open threads / blockers:**
- **Architecture subject — broker lifecycle stability.** The stop path is honoured only at a **pass
  boundary** (`src/broker.mjs:1085`/`:1281`) then an unbounded `waitForIdle` (`:1293`); the operator's
  **bounded-grace ruling** is `#2420` (`queued` to `impl`; `.spike/delegate/intent-2237-bounded-stop.md`,
  delivered). `PASS-FAILED … cause=Error: database is locked` appeared during the restart churn — bounded/backed-off
  and the cause IS logged, but the underlying **lock holder is UNVERIFIED**. `#2406` (read seam `harness.storage` vs `pi-durable` version) is `queued`.
- **Durable decisions to record (`scribe`):** the daemon-stop ruling — "graceful stop MUST be bounded and
  carry an unconditional force fallback; the supervisor/service manager always retains
  `TerminateProcess`/`SIGKILL`". Check numbering: `DECISIONS.md` on `main` ends at **D111**; scribe's
  unlanded branches hold **D112/D113**.
- **Stashes (do NOT pop blind):** `stash@{0}` = D109 non-interactive-git WIP (patch
  `.spike/delegate/D109-shared-tree-wip-20261019.patch`); `stash@{1}` = #2321-era parked shared WIP;
  `stash@{2}` = configure WIP. Each needs its author.
- **Kept orphan:** `%TEMP%/verify758c-134048` (full tree, **no `.git`**) left for `qa` to confirm/dispose.
- **73 dirty worktrees** (CARRY/teardown leak, author-owned) — never force. **44 unlanded refs**; only
  clean+verified may land (`security-item-2316` pair review `#2319` queued; docs verifies deferred/stale).

**Exact next command:** `DURIG_DB=./selfdev.sqlite node cli.mjs status`
**Do not:** `git add -A`; `git reset --hard`/`git clean`; pop a stash blind; force a dirty worktree; delete
an `ahead>0` ref; push unless the operator grants it.

## (prior) RESUME HERE (2026-10-19T03:24Z, delegate) — **`main` green again (`3e17346`); broker UP; verify routed**

**Done this session (no push):**
- Recovered the shared-tree `src/broker.mjs` (collapsed to ONE line, 0 exports, CLI fully broken): backed up the collapsed copy to `.spike/delegate/broker.mjs.collapsed-backup-20261019`; restored HEAD's content; converted to CRLF so `git status` is clean. No `git checkout`/discard; the `configure` WIP is safe in `stash@{0}`.
- Ran a landing window for `impl-item-2229`, `impl-item-2231`, `scribe-item-2260`, `scribe-item-2331`, `scribe-item-2332` via `scripts/land.mjs --suite`. **It REFUSED: `main` itself was RED** (`demo/broker-read-nopass.test.mjs` — `unknown op: read`; then `demo/command-spool.test.mjs` — stale vocabulary). `main` was not advanced (was `3d102a6`).
- Root cause: **`c5daca5` (#2211) dropped `"read"` from `SPOOL_OPS` and the handler**, while the tracked `src/brokerread.mjs` (D111) and the committed tests (#2321) required it. With the broker up, the ENTIRE CLI read surface (`status`/`queue`/`watch`) returned `unknown op: read`.
- **Operator-directed hotfix `3e17346` on `main`** (option (a), union): re-added the `dispatchRead` import, `"read"` in `SPOOL_OPS` (with `"configure"`), the `op === "read"` handler (served from `harness.storage`); corrected `demo/command-spool.test.mjs` to the union. **Suite 148/148** (`scripts/suite.mjs`, `.spike/delegate/suite-read-op-fix.out`).
- `repair-pi-live.mjs ./selfdev.sqlite 15`/`3`: **no unreadable `pi.live`** (not corruption). Store backup `.spike/store-backup-20261018-220116`.
- **Broker restarted → pid `12716`** (local env, no seat root); `cli.mjs status`/`watch --once` → `"ok":true`. (An earlier pid `4796` was killed while `pm` held genlocks — a runbook violation; `resume` cleared the 4 stranded runs.)
- Incidents: **new** `docs/incidents/2026-10-19-read-op-regression.md` (status `mitigated`, fix `3e17346`); `2026-10-19-broker-mjs-one-line-collapse.md` → **resolved**.

**Non-author verify routed:** intent `intent-verify-read-op-hotfix.md` → `pm` (delivered `03:22:57Z`). Do not treat the delegate's suite run as the verify.

**Backlog routed (delivered `03:04:44Z`):** the `read`-op regression (now DONE via `3e17346`) and broker `#2237` (bound the retry pacing) + ROADMAP 78 (`pass-failed`/`SessionFailed.cause`).

**Next:** (1) confirm the non-author verify; (2) re-run the landing window for the 5 clean+verified branches (`scripts/land.mjs --suite`) now that `main` is green; (3) `#2237` is still the durable broker stop-the-spin fix — the `qa conv 15` storage error remains, so a restart can still re-wedge.

**Do not:** `git add -A`; `git reset --hard`/`git clean`; pop `stash@{0}` blindly; force a dirty worktree; delete an `ahead>0` ref; push (operator holds it).

## CLOCK-OUT / NEXT SESSION START HERE (2026-10-19T02:52Z, delegate) — **NEXT TASK: GIT BRANCH MANAGEMENT (operator-directed)**

**Read this whole block first. The shared tree is NOT clean and one tracked file is CORRUPT.**

**Current item:** git branch management, requested by the operator. The delegate's prior branch/worktree work is in `docs/runbooks/branch-cleanup.md` + `docs/runbooks/leaked-worktrees.md` (the three rules: ownership, ignore-before-create, prune-after-remove).

**⛔ BLOCKER FIRST — `src/broker.mjs` is collapsed to ONE line in the shared tree** (0 newlines; older content). `HEAD` is intact (1429 lines, `onlyReadIntents` present), so nothing is lost. **Restore it before anything else** (operator-only per `docs/runbooks/write-corruption-recovery.md`):
```bash
git checkout -- src/broker.mjs        # OPERATOR ONLY
tr -cd '\n' < src/broker.mjs | wc -c # expect ~1429
node --check src/broker.mjs           # expect clean
```
Until restored, every `node cli.mjs` verb imports `src/broker.mjs` as an empty module. Incident: `docs/incidents/2026-10-19-broker-mjs-one-line-collapse.md`.

**Exact next command:** `git status --short -- .` → then `git worktree list` and `DURIG_DB=./selfdev.sqlite node cli.mjs worktree audit` (read-only).

**State you inherit (2026-10-19T02:52Z):**
- **`main` = `cf5bc40`** (delegate NEXT.md). Parents: `c5daca5` (a seat's `fix(broker): reconcile WIP against authoritative baseline (#2211)`), `6cfb3aa`, `d058e0a` (**the `#2321` landing** — on main). `origin/main` is far behind — **unpushed; the operator holds push.**
- **Broker: pid `16864`, WEDGED again** since `02:40:38Z` (`wake-failed … qa conv 15 … Session failed after a storage error`; `WAKE-RETRY … pass-threw`). **Not restarted at clock-out.** A `cli.mjs watch` viewer (pid `14472`) is attached. Recovery per `docs/runbooks/broker-down-or-stalled.md`. `#2321` (the read-poll fix) IS on main and does not stop this persistent-storage-error wedge — see the recurrence in `docs/incidents/2026-10-18-broker-retry-hotloop.md`.
- **Untracked scratch/leaks in the tree (do NOT commit):** `fix-broker.mjs` (a raw `fs.writeFileSync('src/broker.mjs', …)` — the guard-bypassing write), `peek-store.cjs`, `src/borker.mjs.head` (UTF-16, typo), `wt-2073/`, `selfdev.sqlite.broker.inbox.out/`.
- **`stash@{0}`** = `delegate: park shared-tree tracked WIP for 2026-10-19 #2321 landing` (patch: `.spike/delegate/landing-2026-10-19/shared-tree-tracked.patch`). **Do NOT `git stash pop` blindly** — it holds the `configure` WIP + 7 doc/demo edits; reconcile with `devtools-item-2182` first. `stash@{1}` is the earlier configure-WIP park.
- **Leaked item worktrees** (dirty orphans, never `--force`): `item-2224`, `item-2231`, `item-2305`, `item-2315`, `item-2340` — see `docs/incidents/2026-10-19-worktree-carry-teardown-collision.md`. Plus `wt-2073/`.

**Delivered to `pm` this session (all `delivered:true`):** `worktree-carry-collision-2026-10-19-1` (`01:46:12Z`), `prioritize-2321-verify-2026-10-19-1` (`02:19:10Z`, overtaken — qa had already verified as `#2373`), `suite-concurrency-priority-2026-10-19-1` (`02:35:36Z`).

**Docs updated this session:** incidents `worktree-carry-teardown-collision` + index row; **new** incident `broker-mjs-one-line-collapse` + index row; `2026-10-18-broker-retry-hotloop` recurrence 2026-10-19; `docs/FEATURES.md` broker-served-reads row (`#2321`); **new** `docs/reviews/tui-attach-vs-poll.md` (the TUI poll → pi-durable attach reference: measure + all pi-durable/example/spike references for the Phase-2 attach work).

**Do not:** `git add -A`; `git reset --hard`/`git clean`; force a dirty worktree; delete an `ahead>0` ref; **push** (operator holds it); restore `src/broker.mjs` without the operator; pop `stash@{0}` blindly; land a conflicted branch by hand.

## (prior clock-out — 2026-10-19T01:30Z, delegate)

**Routed this session (delegate):** intent `worktree-carry-collision-2026-10-19-1` → `pm` (delivered `01:46:12Z`) — the CARRY/teardown collision: `createWorktree` carries the shared tree's tracked-dirty files into every item fork (`src/worktree.mjs:134`, ASK F/#506), and `complete_work`'s clean-only teardown refuses a dirty tree, so **while the shared tree is dirty (the parked `configure` WIP) every completed item leaks its worktree**. Evidence: `#2231` (`impl-item-2231 @166d51f`) and `#2224` (`impl-item-2224 @a2eaf7b`) still on disk dirty; `.spike/serve.err` refusals; also `item-2305`/`item-2315`/`item-2340`. Folded into the already-routed `worktree-rot-prevention-2026-10-19-1` so it is not a duplicate. **Leaked trees left untouched** (dirty orphans, never `--force`).

**Current item (follow-up): the broker hot-loop / watch-support cluster.** Two defects, both already registered and routed to `impl`, **neither ȷet worked** (`queued`, not `claimed`):
- **#2237** (queued → impl) — a persistent pass-throw **HOT-LOOPS** the broker (~0.5 s) and defeats `serve --stop`; bound the retry pacing so a persistent throw cannot spin.
- **#2321** (queued → impl) — `node cli.mjs watch` must work: a non-mutating `op:"read"` intent must NOT force a wake/supervisor pass (failing-first). This is the **operator requirement** (their window into the team) AND the wedge's accelerant.
- **#2317** (queued → impl) — pm's corrected diagnosis: `pm` conv 3 is **NOT** corrupt; the wedge is **contention from per-poll wake passes**; fix = #2321.
- **#2269 / #2270** (held → impl) — metricize the `pass-failed` diagnostic (ROADMAP 78) + a perpetual-throw demo; **UNPARK**.
- **#2238** (deferred → auditor) — verify `serve --stop` terminates a persistently-throwing broker.
- **Pass-SURVIVAL is already LANDED** (`impl-item-1698 @d509e2f`, ROADMAP 78 DELIVERED) — only PACING is owed.

**Delivered to `pm` this session (all `delivered:true`):** `prioritize-hotloop-watch-2026-10-19-1` (operator priority: #2237 + #2321 ahead of impl's current work; unpark #2269/#2270), `broker-watch-support-2026-10-19-1`, `route-conflicts-2026-10-19-1`, `worktree-rot-prevention-2026-10-19-1`, `worktree-guidance-cleanup-2026-10-19-1`.

**Exact next command:** `DURIG_DB=./selfdev.sqlite node cli.mjs status` — then `node cli.mjs queue` to read #2237/#2321 status. **Check whether `pm` has woken/registered the priority:** at clock-out pm's input was placed but no `WAKE pm` had fired (cooldown-pending).

**Broker state:** UP pid `4432` (since `01:15:21Z`), stable at clock-out (0 `pass-threw` since `01:21:11`, `PASS 305`). It **will re-wedge within ~1–2 min under load** on the `pm` conv-3 `Session failed after a storage error`. Recovery (only when no genlock is held): `taskkill /F /PID <serve pid>` → `DURIG_DB=./selfdev.sqlite node cli.mjs resume` → `powershell -ExecutionPolicy Bypass -File scripts/serve-noroot.ps1`. `repair-pi-live.mjs ./selfdev.sqlite 3` finds nothing corrupt — do NOT expect it to clear the wedge.

**Landing window (operator task) — DONE:** `main` `0cd84f6 → d04f9af` (16 landed, suite green). The operator **pushed**; `origin` is now `https://github.com/chexxor/Durian-Pi.git` (the stale `Pi-OpenDurig.git` URL was fixed this session), `origin/main` = `d04f9af`, **0 ahead**.
**Backlog — routed, NOT delegate-doable:** 43 unlanded refs: 39 conflicts (author rebase + re-verify; intent `route-conflicts-…`), 2 partial-rebrand (`auditor-item-2154`/`scribe-item-2143` — land with the rebrand stack, not alone). Never land snapshots `item-148`/`selfdev-borrow`.

**Worktree cleanup (operator task) — DONE:** branches **90→64**, worktrees **183→143**, **0 stale registrations**. The remaining count is dominated by the **86 parked archive** at `../durian-pi.worktrees/` (detached, content preserved) plus leak residue; the delegate folded the vendored `superpowers` rules (**ownership / ignore-before-create / prune-after-remove**) into `docs/runbooks/leaked-worktrees.md`, and routed the code + guidance halves to `pm` (`worktree-rot-prevention-…`, `worktree-guidance-cleanup-…`). **The operator must rule on the archive** (keep / deregister / dispose) before it shrinks further.

**Uncommitted in the shared tree:** the `configure` WIP (`src/broker.mjs`, `demo/command-spool.test.mjs`) — **DO NOT touch**; also parked in `git stash@{0}` (patch: `../durian-pi.worktrees/.quarantine/_session-scratch/configure-wip.patch`). `wt-2073/` is a mid-merge worktree (real work) `selfdev.sqlite.broker.inbox.out/` is the broker spool.

**Do not:** `git add -A`; `git reset --hard` / `git clean`; force a dirty worktree; delete an `ahead>0` ref; **push** (operator holds it); edit the `configure` WIP by hand; set `DURIG_SEAT_ROOT` on the `serve` launcher.

## NEXT SESSION
**Current item:** **LANDING WINDOW — RAN; route the 39 conflicts.** The window opened and closed cleanly: broker stopped (it was hot-looping), `configure` WIP parked to `stash@{0}` (+ patch), 16 clean branches landed via `scripts/land.mjs --suite` (suite green), broker restarted. **41 branches remain unlanded** — see the split below. Standing priority behind it: **#2189** (TUI Phase 1, `impl`) / **#2187** (pin, `devtools`).
**Exact next command:** `DURIG_DB=./selfdev.sqlite node cli.mjs status`
**Blocker:** the 39 conflicts need an **author rebase + re-verify** (per `docs/runbooks/resolve-merge-conflict.md`, the delegate does NOT guess a semantic merge). The `configure` WIP is parked in `git stash@{0}` (patch: `../durian-pi.worktrees/.quarantine/_session-scratch/configure-wip.patch`); reconcile it with `devtools-item-2182` before restoring for real.
**Window result (2026-10-19T00:35Z):** `main` `0cd84f6 → d04f9af`; 16 landed (suite green): `auditor-item-1924/1940/2148/2150/2209`, `devtools-item-2095`, `impl-item-1274/1498/2123/2126`, `qa-item-2201/2279`, `scribe-item-2111/2124/2246`, `security-item-2220`. `main` is now **36 ahead of `origin/main`** (unpushed — operator holds push). **Broker: UP pid `15740`** (`WAKE pm`, 0 `pass-threw`). The wedge is NOT corruption — `repair-pi-live.mjs ./selfdev.sqlite 3` reported no unreadable `pi.live`. It is **contention**: `cli.mjs watch` polls every 750 ms and the idle loop runs a **full pass per read intent** (~80/min), accelerating the `probeStorage` contention residual (#1587 part 4) → `pass-threw` hot-loop. Watch support is delivered to `pm` (intent `broker-watch-support-2026-10-19-1`); until it lands, a running `watch` during active generations can re-trigger the hot-loop. DO NOT kill `watch` as the fix — the operator needs it; the fix is the broker change.
**Conflict set to route to `pm` (39):** stack TIPS only — guard `impl-item-1444-fix` (broker/confine/seattools), degen `impl-item-1705`, checkup `impl-item-1727`, compacteval `impl-item-1604`, provision `devtools-item-1754`, spool `devtools-item-2073`, configure `devtools-item-2182`, halt `impl-item-1769`, operator-gate `impl-item-1966`, suite-partition `devtools-item-1558`, security position `impl-item-1519`/`security-item-1475`; doc-only `auditor-item-2179`, `impl-item-1529/1587`, `qa-item-1087`, `scribe-item-1232/1233/1257/1301/1323/1469/1565/2078/2169/2199/2219`; plus the stack SUBSETS (`impl-item-1151/1225/1249/1261/1609/1704/1823`, `item-9002/9003`, `auditor-item-2186`) which become redundant once their tip lands. **Never land snapshots `item-148`/`selfdev-borrow`.** The 2 remaining clean refs (`auditor-item-2154`, `scribe-item-2143`) are a PARTIAL rebrand (`constitution.txt` only) that breaks the `rig.starter.json` mirror — land them with the rebrand stack, not alone.
**Do not:** `git add -A`; `git reset --hard` / `git clean`; edit the `configure` WIP by hand; land a conflicted branch by hand; delete an `ahead>0` ref; set `DURIG_SEAT_ROOT` on the `serve` launcher.

## (prior clock-out — superseded by the block above)
**Current item:** the **TUI migration is still the operator priority** (#2189 Phase 1 queued to `impl`, #2187 pin claimed by `devtools`, #2109/#2110 rebrand), but **the broker is WEDGED — no seat is progressing.** `selfdev.sqlite.broker.log` froze at `PASS 60` @`20:33:31Z`, then `WAKE-RETRY … pass-threw` every 60 s to now; `.spike/serve.err` names `wake-failed … pm conv 3 … Session failed after a storage error`. A kill+`resume`+restart was done at `20:47:55Z` (pid `5768`), but the same pass-throw returned, so the restart alone does NOT clear it — the next agent must repair the `pm` conversation (per `docs/runbooks/store-corruption-recovery.md`), not merely restart.
**Spooled, undrained (broker wedged):** `.spike/delegate/intent-seat-notes.md` (D108) and `.spike/delegate/intent-worktree-git-skills.md` (D109/D110) sit in `selfdev.sqlite.broker.inbox/`; the first healthy pass drains them (`INTENT delivered=2`).
**This session delivered (delegate lane, no product code):** `docs/reviews/agent-skills-review.md`; `vendor/eval/{anthropic-skills,agentskills-spec,awesome-agent-skills,superpowers}` clones; **D108** (seat notes), **D109** (non-interactive agent git), **D110** (worktree taxonomy/root).
**Exact next command:** `DURIG_DB=./selfdev.sqlite node cli.mjs status`
**Then:** follow `docs/runbooks/broker-down-or-stalled.md` (wedged shape) — `taskkill /F /PID <serve pid>` only with no live genlock, `resume`, restart with the local env; if the throw returns, `store-corruption-recovery.md` for `pm` conv 3. Confirm a fresh `PASS` and `INTENT delivered=2`.
**Do not:** `git add -A`; touch the uncommitted devtools `src/broker.mjs` `configure` WIP; land a conflicted branch by hand; set `DURIG_SEAT_ROOT` on the `serve` launcher.

## (prior clock-out — superseded by the block above)
**Current item:** **local-model reliability** — enforce **D107** (a local seat masks→summarizes its
tool-call history WITHIN a long item, capped, then re-anchors) alongside **D105**/**#2123** (a fresh
`pi.reset` BETWEEN items). All routed to `pm`: `37e9a77b…` (D107), `17fef81f…` (reliability findings),
`b9dd9a08…` (lastActivity defect), `f27a8772…` (retry hot-loop defect). Incidents filed this session:
`docs/incidents/2026-10-18-broker-retry-hotloop.md` (new) plus dormant-stall recurrence 8, host-resource
exhaustion, local-provider. **Broker UP** pid `3296`; inbox drained. **Next command:**
`DURIG_DB=./selfdev.sqlite node cli.mjs status`. **Watch:** the shared tree still carries devtools's
uncommitted `src/broker.mjs` `configure` WIP — it makes `land.mjs` REFUSE (tracked modification) and the
local suite read red while `main` is green; intent `6a38b05c…` asked `pm` to reconcile it (delegate did not
touch it).

> **CLOCK-OUT / NEXT SESSION START HERE (2026-10-18T20:05Z).** — Operator decisions executed; landing window done.
> - **LANDING WINDOW (operator-prioritized) — RAN.** Paused→stopped the broker, snapshot
>   `.spike/store-backup-20261018-144324`, ran `scripts/land.mjs --suite` outside the broker. **8 landed**
>   (now ancestors of `main` `4a50da6`): `devtools-item-2114`, `impl-item-1108`, `impl-item-1547`,
>   `impl-item-1585`, `scribe-item-1972`, `scribe-item-2021`, `scribe-item-2052`, `scribe-item-2070`.
>   **11 CONFLICTED** (need rebase + re-verify, route to authors; do NOT hand-merge into the shared tree):
>   `devtools-item-1558`, `devtools-item-1754`, `devtools-item-2073`, `impl-item-1151`,
>   `impl-item-1444-fix`, `impl-item-1529`, `impl-item-1609`, `impl-item-1727`, `impl-item-1823`,
>   `impl-item-1705`, `impl-item-1769` (conflict files: `docs/runbooks/README.md`, `docs/DECISIONS.md`,
>   `docs/FEATURES.md`, `docs/ROADMAP.md`, `src/broker.mjs`, `src/confine.mjs`, `src/seattools.mjs`,
>   `src/checkup.mjs`, `src/degeneration.mjs`, `demo/starter.test.mjs`, `demo/degeneration.test.mjs`,
>   `rig.selfdev.json`).
> - **`main` IS GREEN.** The full suite reports 142/143 ONLY because of an UNCOMMITTED work-tree change,
>   not `main`: `src/broker.mjs` has an uncommitted `configure` spool op (mtime `19:57:26Z`, HEAD blob
>   `3676acb` lacks it, HEAD's `demo/command-spool.test.mjs` expects the 6-op vocabulary). **Do NOT touch
>   it** — it is someone's in-flight work; it also makes `land.mjs` REFUSE (tracked modification), so the
>   11 rebases cannot land until it is committed in its own worktree or moved. Identify the author first.
> - **Operator decisions relayed to `pm`** (intent `1c6e76b3…`, delivered `19:56:24Z`): durable-tui
>   **START NOW** (#2095 → #2096 + #2103/#2104); rebrand **FINISH** (#2109–#2112, #2143, #2144); **#1135**
>   = pricing source is a per-provider EXTENSION, data UNAVAILABLE when no extension supplies it; **#2098**
>   = `ui.mjs` eventually retired; **#2100** = GitHub rename DONE by operator (local rename still needs a
>   window); **#2050** already decided (archive out-of-tree) — close the stale row.
> - **Broker UP — pid `10932`** (`START 19:55:48Z`), unpaused. **The recurrence-8 fix is working live:**
>   `PASS 124` + `WAKE-RETRY … pass-threw`, backing off `2s→4s→8s→16s→32s→60s` — the broker RETRIES a
>   persistent pass-throw instead of going dormant. Restart needs the local env still (harmless now that
>   `devtools-item-2114` landed, but keep it until D103's aliases land).
> - **LIVE DEGRADATION to watch (not yet recovered):** the pass-throw cause is a `qa` conv-15
>   `Session failed after a storage error` (`wake-failed`), plus **`pm` escalating `degeneration` 7× in a
>   row** (`streaming: pm, auditor`). The local LLM (PolyStrata, `127.0.0.1:8080`) is up. `ui.mjs` pid
>   `11256` still running.
> - **Exact next command:** `DURIAN_PI_DB=./selfdev.sqlite node cli.mjs status`
> - **Do not:** `git add -A`; touch the uncommitted `configure` WIP; land a conflicted branch by hand;
>   land the unverified set (`impl-item-1498`, `scribe-item-1232/1233/1257`).

> **CLOCK-OUT / NEXT SESSION START HERE (2026-10-18T19:32Z).** — Recovery complete: broker UP and the
> local LLM (PolyStrata) UP. The recurrent broker dormancy is now fixed (independently unverified).
> - **Host is healthy.** The reboot landed; `C:\pagefile.sys` is now a fixed **32,768 MB**. Commit
>   headroom **55,254 / 65,458 MB** free, physical **25,565 / 32,690 MB**. The `Zone Allocation failed`
>   and `git` fork errors are gone. Root cause now grounded (commit limit = RAM + the old 4,982 MB page
>   file) — `docs/incidents/2026-10-18-host-resource-exhaustion.md` is **resolved**.
> - **Broker UP — pid `16368`** (`START 19:29:58Z`, passes advancing, no `wake-failed`, no genlock),
>   restarted **without `DURIAN_PI_SEAT_ROOT` and WITH the local env** (`DURIAN_PI_LOCAL_API_KEY=local`, since
>   #2114 is not on `main`). Step 3 of `broker-down-or-stalled.md` now carries that.
> - **Dormancy recurrence 8 — PINNED AND FIXED (`6e27ac2`, delegate, operator-directed).** The retry
>   re-armed only on a per-seat `wake-failed`; a retry pass that throws in a STORE READ before any wake
>   (`documentState`/`inspect`/`reconcileStrandedSubmissions`/`readStoppedConvIds`, all unwrapped by
>   `onError`) leaves `failedThisPass` empty and parks the broker. Fixed: `runWakeLoop` now retries on
>   `failedThisPass.size > 0 || passThrew`. Demo scenario RED->GREEN; full suite **143/143**. **A
>   non-author verify is ROUTED to `pm`** (intent `efe3d969…`, delivered `19:31:50Z`) — do not treat the
>   delegate's run as the verify.
> - **Still owed on the same class:** log the pass attempt BEFORE the work (or `pass-failed` +
>   `SessionFailed.cause`, ROADMAP 78) so a truly hung pass is distinguishable, + the stale-`PASS`
>   watchdog (ROADMAP 61-64).
> - **Local LLM UP.** PolyStrata restarted (launcher pid `9220`, listener `15268`, `strata-poly.exe`
>   `5944`), serving `qwen3.6-35b-a3b-ud-q3_k_m` on `127.0.0.1:8080` (`n_ctx 65536`); `/v1/models` HTTP
>   200 and a live completion verified. **New procedure: `docs/runbooks/local-provider-down.md`.**
> - **`ui.mjs` viewer pid `11256` is STILL running** (the documented concurrent-opener aggravator);
>   terminate it first if a recurrence 9 hits.
> - **OPERATOR PRIORITY unchanged: durable-TUI (durian-pi) migration.** NEXT AGENT: deliver an intent to
>   `pm` to un-park and sequence **#2095 → #2096** (+ #2103/#2104). Also queued: **#2123** (D105 impl),
>   **#2124** (scribe, claimed), **#2125** (gated verify), **#2137** (landing list: `devtools-item-2114`
>   @9ba3c8a — landing it removes the `DURIAN_PI_LOCAL_API_KEY` restart requirement).
> - **`qa`:** `repeated_failure` (3× `Connection error.` while PolyStrata was down). Its only
>   non-terminal item `#2145` is `deferred`, so there is no queued `qa` work to re-drive; confirm `qa`
>   recovers on its next real wake now that the server is up.
> - `main` = `6e27ac2`, **13 ahead of `origin/main`** (unpushed; operator holds push). Docs updated this
>   session: 3 incident reports + `broker-down-or-stalled.md` + new `local-provider-down.md` + runbook and
>   incident indexes.
> - **Exact next command:** `DURIAN_PI_DB=./selfdev.sqlite node cli.mjs status`
> - **Do not:** restart the broker without the local env; leave PolyStrata down; treat a fresh heartbeat
>   as health (read the last `PASS`).

> **CLOCK-OUT / NEXT SESSION START HERE (2026-10-18T18:59Z).**
> - **Why nothing was running: the host commit charge is exhausted — NOT a durian-pi bug.** `systeminfo`:
>   Virtual Memory Available **294 MB** of 37,672 MB (In Use 37,378 MB) while physical RAM had ~6 GB
>   free. The page file was a manually-fixed **4,982 MB** on `C:` (`AutomaticManagedPagefile = FALSE`).
>   Every node allocation then fails at tiny heaps — which is also why `cli.mjs status` "OOMs" and `git`
>   forks fail `0xC000012D` (ENVIRONMENT, cf. #2121 /
>   `docs/incidents/2026-10-18-host-resource-exhaustion.md`; biggest committer `strata-poly.exe` ~13 GB,
>   plus firefox/streaming apps and a long-lived `node ui.mjs` viewer pid 5276). **Re-run any failure in
>   isolation before calling it a regression.**
> - **Operator action in flight:** reboot to set `C:\pagefile.sys` fixed **32,768 MB** (Initial =
>   Maximum) → commit limit ~**64 GB**. Nothing is verifiable until the reboot lands; then confirm
>   `systeminfo` shows real commit headroom.
> - **Broker is DOWN.** pid `14436` died abnormally (`START` with no `EXIT`; log froze `PASS 11`
>   @18:39:01Z); a recovery restart `pid 16612` then OOM-died ~52 s in (`.spike/serve.err`:
>   `FATAL ERROR: Zone Allocation failed - process out of memory`, `[16612]`), log froze `PASS 6`
>   @18:51:27Z. `broker.json` is stale; `genlock.0/1/2` are stale (holder pid 16612 gone); submissions
>   for pm/impl/scribe/auditor are stranded.
> - **Recovery owed after the reboot** (`docs/runbooks/broker-down-or-stalled.md`): `resume`, then
>   restart WITHOUT `DURIAN_PI_SEAT_ROOT` and WITH the local-seat env — `scripts/serve-noroot.ps1` sets only
>   `DURIAN_PI_DB`, and **#2114's placeholder key is NOT on `main`** (`src/providers/local.mjs` still returns
>   `""` when `DURIAN_PI_LOCAL_API_KEY` is unset; the fix is branch `devtools-item-2114 @9ba3c8a`, landing
>   list #2137). So a plain restart BREAKS the local seats (`devtools`/`qa`). Set
>   `DURIAN_PI_LOCAL_BASE_URL/MODEL/CONTEXT` (already in `durian-pi.config.json`) + `DURIAN_PI_LOCAL_API_KEY=local`
>   on the launcher. Verify a live `START`, `WAKE`, advancing `PASS`, and a fresh heartbeat across
>   several passes — **a fresh heartbeat is NOT health; read the last `PASS`.**
> - **Provider state (cleared):** DeepInfra works (impl ran 18:39Z, real cost). The `designer … 402`
>   attention is STALE (last run 07:24Z, before the operator's top-up). PolyStrata is up on
>   `127.0.0.1:8080` serving `qwen3.6-35b-a3b-ud-q3_k_m` (65536 ctx).
> - **OPERATOR PRIORITY — durable-TUI (durian-pi) migration.** Operator: "we must make progress towards
>   the design and implementation of the durian-pi TUI." Scope is RULED (D102 / #2105 / #2108): the Pi
>   TUI REPLACES `ui.mjs` as the multi-seat surface; `ui.mjs` becomes the fallback; non-default landing
>   so both work during the slow migration. The phases are registered and specced
>   (`docs/reviews/durable-tui-phase1-build-spec.md`) but ALL are `deferred` (parked on the 402, now
>   cleared): **#2095** (devtools: pin `@earendil-works/pi-coding-agent` EXACTLY `1.3.0`) → **#2096**
>   (impl: Phase 1 non-default entrypoint on its OWN store, fail-closed ownership guard) with **#2103**
>   (designer UX proposal) + **#2104** (advocate review) in parallel; then #2097 Phase 2, #2098 Phase 3.
>   Rebrand #2109–#2112. **NEXT AGENT: deliver an operator-priority intent to `pm` to un-park and
>   sequence #2095 → #2096 (+ #2103 / #2104).**
> - **Also in flight:** #2123 (D105 local per-item reset, `queued` to impl; was the 81-min queue-ageing
>   item) — impl was on **#1498** (P1 FF-lock prerequisite) before the broker died; #2124 (scribe docs,
>   claimed), #2125 (auditor verify, gated).
> - **Exact next command after reboot:** `DURIAN_PI_DB=./selfdev.sqlite node cli.mjs status`
> - **Do not:** restart the broker without the local key env; `git add -A`; `serve --stop` to force a
>   `resume` while a broker lives; treat pre-reboot failures as regressions.


> **CLOCK-OUT / NEXT SESSION START HERE (2026-10-18T18:42Z).**
> - **Broker dormant-stall — fixed, then a gap in the first fix found and fixed.** `0c0d4d3` scheduled the
>   wake retry INSIDE the pass `try` after `supervise()`, so a `wake-failed` followed by a later throw in
>   the SAME pass (the supervisor hitting the same storage error) still parked the broker — **recurrence
>   7** (pid 12944, `PASS 29` frozen `17:57:16Z` for ~36 min). **`991567d`** moves the retry scheduling
>   after the `finally`, so it runs on success AND on throw; `demo/broker-wake-retry.test.mjs` now has 3
>   scenarios (plain, retry-disabled, same-pass-throw). Live broker **pid 14436** (`START 18:38:20Z`),
>   `WAKE pm,impl,scribe`, no new `wake-failed`.
> - **Incident reports filed** (per the operator): new `docs/incidents/2026-10-18-host-resource-exhaustion.md`
>   (sev2) and `docs/incidents/2026-10-18-local-provider-empty-key.md` (sev2);
>   `2026-10-18-broker-dormant-stalled.md` updated with recurrences 4–7 and the fix; index + runbook
>   Evidence updated.
> - **Verification owed:** the broker fix (`0c0d4d3` + `991567d`) was written by the delegate under an
>   operator directive and is committed to `main`; an independent verify was routed to auditor earlier —
>   it must now cover `991567d` too. Until then, treat it as unverified (the delegate's demo is not the
>   verify).
> - **Owed (new detection gap):** `cmdServe`'s `onDiagnostic` logs only `wake-failed`/`escalated`, **not
>   `pass-failed`** — a swallowed pass throw is invisible in `.spike/serve.err`. Fold into ROADMAP 78
>   (log `SessionFailed.cause` on failure); watchdog still owed (ROADMAP 61–64); underlying
>   per-conversation storage error still UNVERIFIED (pi-durable).
> - **Host environment (parallel):** node processes die with `Zone Allocation failed` / `NewArray
>   Allocation failed` past ~25–100 MB (5.7 GB free of 34 GB), so read verbs and the dense demo loop are
>   flaky; **re-run a failure in isolation before calling it a regression** (lead `#2122`, `#2126`).
> - **Also in flight:** D105 enforcement `#2123` (impl) + docs `#2124` (scribe) + verify `#2125`; the
>   local-provider fix `#2114` (devtools) + verify; the `format` gate is NOT repo-clean (untouched files
>   fail), so it is not a usable gate today.
> - **Exact next command:** `DURIAN_PI_DB=./selfdev.sqlite node cli.mjs status`
> - **Do not:** stop the broker without a runbook/declared window; `git add -A`; treat the delegate's
>   demo as the seat verify.

> **NEXT SESSION START HERE — the broker dormant-stall is FIXED and live; independent verify routed
> (2026-10-18T17:44Z).** Operator: "Please fix the broker."
> - **Root cause** (runbook `broker-down-or-stalled.md` prevention item 3): a per-seat `wake-failed`
>   did not re-arm the scheduler, so the broker rested in `signal.wait` with a fresh heartbeat and a
>   frozen `PASS`, and the seat was never driven.
> - **Fix** `src/broker.mjs` `runWakeLoop` (commit **`0c0d4d3`**): after a pass that failed a wake,
>   schedule a retry pass with bounded exponential backoff (`wakeRetryMs` 2 s, doubling per consecutive
>   failing pass, capped at `wakeRetryMaxMs` 60 s; reset by a pass with no failure). New legible log
>   line `WAKE-RETRY in=<ms>ms seats=<names>`; `wakeRetryMs <= 0` disables it. New
>   `demo/broker-wake-retry.test.mjs` proves both shapes in one run (retry disabled = the dormant
>   shape).
> - **Live broker restarted with the fix:** pid **12944** (`START 17:41:30Z`), passes advancing, no new
>   `wake-failed`. (A **sixth** recurrence — auditor conv 4936 — hit at `17:38Z`, just before the
>   restart.)
> - **Verify routed:** pm registered an independent verify to auditor
>   (`VERIFY (non-author, INDEPENDENT) — broker dormant-stall fix @0c0d4d3`). The delegate wrote this
>   code under an operator directive, so the seat verify is required — do not accept the delegate's run.
> - **Still owed on the same incident (not this fix):** log the nested `SessionFailed.cause`
>   (ROADMAP 78), a watchdog keyed on stale `PASS`+heartbeat (ROADMAP 61–64), and the underlying
>   per-conversation storage error (pi-durable). This fix makes a transient error self-heal instead of
>   going dormant; it does not remove the error.

> **NEXT SESSION START HERE — D105 policy RULED and routed; broker recovered from TWO dormant stalls
> (2026-10-18T17:33Z).** Operator: "ensure durian-pi has a policy of starting a new context for any new work
> item picked up by a local model." Delivered as **policy + routing** (the delegate does not implement):
> - **Policy recorded as `D105`** (`docs/DECISIONS.md`): a seat whose resolved model provider is `local`
>   (D104) MUST draw a fresh `pi.reset` boundary per NEW work item before working it; durable transcript
>   kept; non-local seats unchanged; never mid-item, across a `claimed` item, or over a live lease.
>   Mechanism = the existing `resetSeatContext` (`src/reset.mjs`).
> - **Enforcement registered + routed by `pm`:** **#2123** (impl — enforcement + failing-first demo),
>   **#2124** (scribe — `WORKFLOWS.md` rule + `FEATURES.md` row as MANAGED), **#2125** (auditor — gated
>   non-author verify). **Nothing is implemented yet**; landing #2123 (+#2124, after #2125) makes the
>   policy mechanical. Until then the policy is recorded, not enforced.
> - **Broker dormant-stall recurrence 5** (pm conv 3, `PASS 40 ms=5049`) recovered per
>   `broker-down-or-stalled.md`; recurrence 5 also terminated the long-lived `node ui.mjs` viewer (the
>   documented concurrent-opener aggravator). Current broker **pid 6124** (`START 17:30:28Z`), passes
>   advancing, no genlock, no new `wake-failed`. Backups: `.spike/store-backup-20261018-121156` (rec 4),
>   `.spike/store-backup-20261018-123023` (rec 5); incident doc carries both recurrences.
> - **Watch:** a fresh heartbeat is NOT health — read the last `PASS`. If it stalls again, the suspect
>   class is concurrent store openers; the durable fixes are still owed (ROADMAP 78 cause logging, 61–64
>   watchdog, dormant-revisit gap).
> - **Environment risk (parallel; lead ruled #2122):** the `demo/*.test.mjs` loop is flaky under low
>   memory (abort codes / fork failures); the failures pass in isolation. `#2126` (impl) registers a
>   robustness backlog item. Do not treat a dense-loop failure as a code regression without an isolation
>   re-run.

> **NEXT SESSION START HERE — `devtools` on local Qwen is verified; the local-provider defect is FIXED
> (pending verify/land), and the broker was recovered from a dormant-stall (2026-10-18T17:16Z).**
> Operator: "continue ensuring the devtools seat runs the local model of qwen." State: `rig.selfdev.json`
> `devtools` = `local/qwen36`; PolyStrata `127.0.0.1:8080` serving `qwen3.6-35b-a3b-ud-q3_k_m`
> (`n_ctx 65536`); broker **pid 3604** started with `DURIAN_PI_LOCAL_API_KEY=local` (placeholder) in its env (see below).
>
> - **Defect routed + fixed.** Intent delivered to `pm` (`.spike/delegate/intent-local-provider-key.md`)
>   → registered **#2114** (devtools: non-secret placeholder key when `DURIAN_PI_LOCAL_API_KEY` is unset in
>   `src/providers/local.mjs`) and **#2115** (auditor, gated verify). devtools implemented #2114 **on
>   `provider: local, model: qwen36`** → branch `devtools-item-2114 @72efd09` (worktree `item-2114`);
>   **#2115 is `queued`** — the durable fix is NOT on `main` yet; land it after #2115 passes.
> - **Dormant-broker stall — recurrence 4** (same shape as 02:37Z). While routing, broker pid `7404`
>   was found stalled: heartbeat **frozen** (last `17:10:05Z`), `broker.log` frozen at `PASS 10`, the
>   spooled intent undrained, no `genlock`; `.spike/serve.err` named `wake-failed … Session failed after
>   a storage error` for **devtools (conv 4930)** and **auditor (conv 4936)**. Recovered per
>   `broker-down-or-stalled.md`: `taskkill /F /PID 7404` → `resume` (1 pm `run-cancelled`, sub `88623`) →
>   store backup **`.spike/store-backup-20261018-121156`** → restart with the local env → **pid 3604**,
>   `PASS 1 woke=devtools,auditor`; `idle_with_queued_work` cleared; no new `wake-failed`. Incident
>   recurrence appended to `docs/incidents/2026-10-18-broker-dormant-stalled.md`.
> - **Restart requires the local key env.** `scripts/serve-noroot.ps1` sets only `DURIAN_PI_DB`; the restart
>   set `DURIAN_PI_LOCAL_BASE_URL/MODEL/CONTEXT` + `DURIAN_PI_LOCAL_API_KEY=local` (the placeholder). Config file
>   `durian-pi.config.json` already carries the first three; only the key is env-only. Until the source fix
>   lands, a plain `scripts/serve-noroot.ps1` restart with no key **breaks local seats** again.
> - **Suspect not removed:** a long-lived `node ui.mjs` (pid 17340, started ~09:36Z) holds the shared
>   store — a concurrent-opener (lock-contention) suspect. Left running (operator's TUI); if the stall
>   recurs, terminate it and retry before deeper recovery.
> - **Do not:** stop/restart the broker outside a runbook; `git add -A`; leave the launcher without the
>   local env while #2114 is unlanded.

> **LOCAL PROVIDER — now genuinely verified, with a defect recorded (2026-10-18T16:57Z).** Operator
> funded DeepInfra (402 blocker cleared) and directed switching `devtools` to the local LLM. Done:
> `rig.selfdev.json` `devtools` model → `local/qwen36` (operator-directed); `up --refresh` reset only
> devtools; broker restarted (pid `7404`). **Verified end-to-end:** a spooled check message woke
> devtools, which replied `provider: local, model: qwen36, stopReason: stop` (text `local/qwen36`).
> **The model string was never the problem** — durian-pi's provider is `local` + `DURIAN_PI_LOCAL_MODEL`, so the
> seat string is `local/<DURIAN_PI_LOCAL_MODEL>` (`local/qwen36`); the pi CLI's `local-model/...` is pi's own
> separate provider. The server ignores the request's `model` field either way.
> **DEFECT (needs a seat fix + review):** `src/providers/local.mjs` resolves the auth key from
> `DURIAN_PI_LOCAL_API_KEY` and defaults it to `""`, so the provider fails with
> `No API key for provider: local` unless that undocumented var is set — its own comment says "resolve a
> constant". Confirmed: the first wake errored, a restart with `DURIAN_PI_LOCAL_API_KEY=local` made it reply.
> **Operational consequence:** the broker must be started with `DURIAN_PI_LOCAL_BASE_URL`,
> `DURIAN_PI_LOCAL_MODEL=qwen36`, `DURIAN_PI_LOCAL_CONTEXT=65536`, `DURIAN_PI_LOCAL_API_KEY=<non-empty>` —
> `scripts/serve-noroot.ps1` sets none of them, so a plain restart breaks local seats. Also: the old
> NEXT claim that `qa` "runs locally" was **never true in this store** (qa's last runs were
> `deepinfra/mistral…`, 402-terminated); only `devtools` has now run on local.

> **DURABLE-TUI MIGRATION — registered; pre-execution spec done (blocker since cleared: see the
> LOCAL PROVIDER block above).** The phases are registered: **#2094** (Phase 0 ruling, done), **#2095** (pin
> `@earendil-works/pi-coding-agent`, `devtools`), **#2096** (Phase 1 non-default own-store entrypoint,
> `impl`), **#2097** (Phase 2 attach, gated), **#2098** (Phase 3, held); UX consult **#2103**
> (`designer`) / **#2104** (`advocate`); rebrand **#2109–#2112**. This session advanced the delegate
> lane only (no product code): `docs/reviews/durable-tui-phase1-build-spec.md` resolves the two gates
> the merge plan left open and reconciles it with D103 — **#2095**: `pi-coding-agent` is release-only
> (`npm view` → `1.3.0`), NOT in `pi-main.pin.json` `packages[]`, so pin it exactly in `package.json`
> (not the monorepo pin); **#2096**: the ownership guard reuses `readBrokerState`/`brokerAlive`
> (`src/broker.mjs`, heartbeat-hardened) + the live-genlock scan (`scripts/land.mjs`, the `#1383`
> lesson), fails closed naming store+pid, and uses `DURIAN_PI_TUI_*` with `DURIAN_PI_TUI_*` aliases. It
> also scopes `cwd`/worktree resolution to Phase 2 (Phase 1 resolves no seat).
> **BLOCKER (unchanged, now with evidence): #2095/#2096/#2103 were all `deferred by supervisor` after
> the 402 (`log designer`: `stopReason:"error", 402 … positive balance`).** Only `qa` runs
> (`local/qwen36` via PolyStrata). **Operator decision needed to start the team:** (a) fund DeepInfra;
> or (b) authorize pointing `devtools`+`impl` at the local PolyStrata provider (D104 per-seat:
> `DURIAN_PI_LOCAL_BASE_URL` in the broker env, set the two seat models to `local/<id>`, `up --refresh`,
> restart the broker in a declared window). Local serves ONE 35B Q3 model / 64k ctx on 24 GB VRAM —
> adequate for Phase 1's mechanical work but serialized; one heavy seat at a time. **Broker state:**
> UP pid `10424`, last `PASS 1` at 09:45Z — this is IDLE, **not stalled**: the queue holds **0
> `queued`/`claimed`** items (85 deferred, 51 held), inbox empty, no genlock. Do not kill it.

> **LOCAL INFERENCE (2026-10-18) — `qa` runs locally; DeepInfra 402 still blocks the rest.** PolyStrata
> (`C:\Users\Alex\dsh-Projects\PolyStrata`) serves Qwen3.6-35B-A3B UD-Q3_K_M on
> `http://127.0.0.1:8080/v1` (OpenAI-compatible; tool calls work). durian-pi gained a **per-seat `local`
> provider** (D104): with `DURIAN_PI_LOCAL_BASE_URL` set, a seat model `local/<id>` uses it while others
> keep the default. The selfdev `qa` seat is now `local/qwen36`; other seats still need funded
> DeepInfra. Settings that make it reliable on 24 GB VRAM / 32 GB RAM: close games, engine
> `--vram-reserve-mib 512` (stops `cudaGraphInstantiate` OOM), and `min_free_vram_mib` — a SERVER config
> key, NOT an engine arg. Verified: isolated `send qa` replied through PolyStrata; full suite 142/142
> with the broker stopped.

> **BLOCKER (2026-10-18T07:32Z) — provider balance exhausted; the team is stopped.** Every seat
> (`pm`, `impl`, `qa`, `scribe`, `devtools`, `auditor`, `designer`) reports
> `last_run_failed: model_error: 402: You need positive balance to do inference`, and the supervisor
> escalated each after repeated failures. `#2103` (the operator-directed UX consultation) is `deferred`
> to human; `#2104` (advocate) is `deferred` waiting on pm. **Operator action required: top up
> DeepInfra** (provider = `deepinfra` in `durian-pi.config.json`) or switch to a funded provider/key —
> retrying or resetting seats cannot help. After funding: `resume`, re-queue `#2103`/`#2104`, let the
> broker re-wake. Broker is UP (pid 8196, PASS advancing); store healthy (no corruption); backup at
> `.spike/store-backup-20261018-022048`. **Security: the DeepInfra key lived in gitignored
> `durian-pi.config.json` and was echoed during diagnosis — rotate it.**

> **DELEGATE SESSION (2026-10-18) — durable-tui merge pack delivered; rename blocked on a window.**
> The operator directed: (1) proceed with the durable-tui merge procedure; (2) gap-analyze the spike vs
> the current app; (3) rename `pi-opendurig` → `durian-pi`. Delivered as delegate analysis only (no
> product code written — implementation is the team's):
> - `docs/reviews/durable-tui-merge-plan.md` — phased merge (Phase 1: non-default entrypoint on its OWN
>   store, fail-closed broker guard; the spike is a writer, so it must never open `selfdev.sqlite` while
>   the broker drives). **SCOPE RULED (operator): option (b)** — the Pi TUI replaces `ui.mjs` as
>   durian-pi's multi-seat surface, with a required team-status viewport. Its UX is a design
>   consultation routed to `designer` + `advocate` (intent `92682546-ad8e-4406-9efb-c7b1208e38c3`);
>   Phase 2 selects no layout before their proposal is accepted.
> - `docs/DECISIONS.md` **D101** (parallel-entrypoint strategy) and **D102** (scope (b) ruling + UX
>   consultation).
> - `docs/reviews/durable-tui-gap-analysis.md` — 33-row capability matrix + P1/P2/P3 + DECIDE build list
>   for the new TUI (seat switcher, attach/write seam, router tools, sanitise/secret-redaction, cwd,
>   tests, dependency pin, `pi.system`/`reset`, halt guard, …).
> - `docs/reviews/project-rename-durian-pi.md` — rename hazard + safe procedure. **NOT executed**: 140
>   worktrees / 139 admin dirs / live processes hold the tree; a string-only rename would make docs
>   false (they name the real `../durian-pi.worktrees/`). Needs a GitHub rename + a declared window.
> - **REBRAND (operator): `durig` → `durian-pi`** across all tracked text + identifiers (267 files,
>   24 `DURIAN_PI_*` env vars, `durian-pi.config.json`, `.durian-pi/`, the skill dirs), with deprecated aliases for
>   the env vars + config filename so the live rig keeps working. Intent
>   `9fa09419-2160-4b3b-b2eb-04bbd32c54e2` delivered to `pm`; the new multi-seat TUI is the
>   **durian-pi TUI**.
> Four intents delivered to `pm` (merge `66d95f69…`, rename `e6d5eea0…`, UX consult `92682546…`,
> rebrand `9fa09419…`). **RIG STATE: broker UP** (`serve` pid 4004, PASS advancing) after `unpause` +
> `resume` (2 stranded submissions cleared); inbox empty. **NEXT:** pm registers/routes the four items;
> the LOCAL repo rename still needs a window (GitHub repo already renamed to `Durian-Pi`).

> **RIG PAUSED (operator, 2026-10-18T05:38Z) — system reboot pending.** The broker was dormant (pid 3088,
> last `PASS 178` at 05:23:05Z, no genlock) and had not drained the spooled `pause`; it was terminated
> (no genlock) and `pause` applied directly (`appliedBy: cli`, `pausedBy: operator`). `status` reports
> `paused: true`. The broker is **DOWN**. After reboot, the team takes NO new work until `unpause`.
> Sequence post-reboot: `unpause`, then `resume` (dormancy stranded submissions), then restart the
> broker. **Incident note:** `serve --stop` reported `state was stale; cleared` and cleared
> `broker.json` while the broker process was **still alive** — an orphan-broker / second-writer hazard
> worth a follow-up item.

> **Side spike (operator-requested, 2026-10-18) — pi TUI on pi-durable via an adapter. NOT a queue
> item; no product code changed. RETURNING TO MERGE? Read `.spike/durable-tui/HANDOFF.md` first.**
> `.spike/durable-tui/` is a WORKING interactive app: `cd .spike/durable-tui && node tui.mjs` runs the
> real `InteractiveMode` on a pi-durable conversation, generating with the operator's configured
> provider (deepinfra plugin loads and works), running Pi's coding tools + code mode, supporting
> `/compact` (running indicator, then a durable compaction boundary), and persisting to
> `session.sqlite` so reopening resumes the transcript. 21/21 tests pass (`npm test`);
> `node smoke-real-tools.mjs` proves the real provider calls a tool. Key integration seams: pass the
> coding-agent `ModelRuntime` as `Harness.open`'s `models`; install `CodingTools`/`codemode` into the
> durable registry; and re-emit durable's model-bearing `pi.compaction` entry through the TUI's
> `entry_appended` path (not `compaction_end.result`). Other finding: durable `EntryRecord`s carry no
> timestamp, so the adapter synthesizes one. `HANDOFF.md` holds the decisions, references, and merge
> plan. This does **not** change the operational priority below.

## NEXT SESSION — fresh agent starts here (delegate, 2026-10-18T05:18Z)

**Current item:** make the CLI drive its MUTATING commands through the broker's **command spool** — the
ROADMAP 71 / #912 residue. Owner is **`devtools`**; the delegate delivers operator intent and verifies.
Two residue items, both `deferred pm->devtools`:

- **`#1929` (residue 1/3):** lift the queue/Router writers out of `cli.mjs` — make
  `claim`/`complete`/`defer`/`hold`/`release`/`revise`/`cancel`/`send` **spool ops** applied by the broker
  with its OWN harness (`SPOOL_OPS += …`; `applyRequest` applies them; `cli.mjs` **ROUTES** through the
  spool when a broker owns the store, direct path only when no broker). Verify **`#1932`** (auditor),
  gated on devtools's branch + tip.
- **`#1930` (residue 2/3):** route **`up`**'s write path through the spool when a broker is alive (direct
  path otherwise; no regression). Verify **`#1933`**.

Both acceptance sets require: no second writer (cli.mjs opens NO store while the broker drives); the
applied outcome observable in `<db>.broker.inbox.out/<requestId>.json`; a duplicate `requestId` applies
once; a **failing-first** demo (RED on current `main`, GREEN on the branch); `node --check` clean; full
`demo/*.test.mjs` loop green; docs (`docs/COMMANDS-AND-THE-BROKER.md` §7, FEATURES.md).

**Queue id:** `#1929` (then `#1930`).

**Exact next command:** `DURIAN_PI_DB=./selfdev.sqlite node cli.mjs status`

**Known blocker:** none blocking the delegate. `#1929`/`#1930` are `deferred` pending `devtools`'s
scope/sequencing answer. The cli.mjs writer slot: `#2031` said it stays CLOSED per `#1817` — but the
three contending writers it named (`impl-item-1841`, `devtools-item-1904`, `impl-item-1907`) have **ALL
landed** now, so re-check the slot before sequencing. `#2031` also holds `impl-item-1705` — leave it held
(my earlier survey shows it rebases clean but its verify `#2024` is still pending).

**Build rules that apply (do not violate):** implement `#1929`/`#1930` FULLY — no partial/stub paths
(“for now”/“simplified”/disabled); every exported function declares its **return type**; comments explain
**why** (constraint/invariant/workaround), not what.

**What the previous session did (for context):** applied the operator's model swap (qa →
`mistralai/Mistral-Small-3.2-24B-Instruct-2506`, added `qa2` → `google/gemma-4-31B-it`); landed
`impl-item-1841` (pause/unpause — `SPOOL_OPS` = message/stop/reset/compact/pause/unpause),
`impl-item-1891` and `impl-item-1907` (ROADMAP 76 verify-scratch reclaim + teardown); pruned 56 merged
branches; archived 41 dirty worktrees out-of-tree. `main` = `origin/main` = `740f889` (pushed). Refs ~50.

**State:** broker UP (restarted; passes advancing, 2 genlocks). `main` = `origin/main` = `740f889`.
CLEAN-after-rebase unlanded tips (verify still pending — do NOT land): `impl-item-1705` (#2024),
`impl-item-1558`, `impl-item-1274`, `auditor-item-1924`, `scribe-item-2021` (#2027). ~19 code-conflict
tips remain (route to authoring seats or continue the delegate scratch-merge method; junction
`node_modules`/`vendor` into an OUT-OF-REPO worktree or ~27 demos fail).

> **CAUTION — a SECOND delegate session was active concurrently** (created `.spike/durable-tui/`,
> 05:03Z). It may still be writing `docs/NEXT.md`/the store; reconcile before trusting them.

**Do not:** leave `cli.mjs log … --follow`/`watch` viewers attached (they cause the recurring
`database is locked` dormant stall — cleared twice this session); stop the broker without a declared
window (`pause` now exists — prefer it); land a snapshot (`item-148`, `selfdev-borrow`); force a dirty
worktree; `-D` an `ahead>0` ref.

## (prior) NEXT SESSION — delegate clock-out, 2026-10-18T05:12Z

**Current item:** the operator-directed combined window is DONE (model swap) and the landing pass is
IN PROGRESS. This session: applied the model swap (qa → `mistralai/Mistral-Small-3.2-24B-Instruct-2506`,
added `qa2` → `google/gemma-4-31B-it`; `up --refresh`, qa context reset `86605`), and landed 3 verified
branches via scratch merges with the full suite as the gate: **impl-item-1841** (pause/unpause;
`SPOOL_OPS` now includes pause/unpause/compact), **impl-item-1891** then **impl-item-1907**
(ROADMAP 76 verify-scratch reclaim + teardown). `main` `0afb559 → ce0b338`; suites 139/0, 140/0, 141/0.
Landed branches pruned. Refs now **47**.

**Queue id:** `#2000` (next landing-list: the guard stack tip `impl-item-1444-fix`); `#2017`
(ROADMAP 76 stack) landed this session.

**Exact next command:** `DURIAN_PI_DB=./selfdev.sqlite node cli.mjs status`

**Known blocker:** 30 unlanded remain, 19 CONFLICT. CLEAN-after-rebase (verify pending, do NOT land yet):
`impl-item-1705` (verify #2024), `impl-item-1558`, `impl-item-1274`, `auditor-item-1924`,
`scribe-item-2021` (verify #2027). The CONFLICT set needs per-tip code merges (`src/broker.mjs`,
`cli.mjs`, `src/degradation.mjs`, `src/checkup.mjs`) — route to authoring seats or continue the
delegate scratch-merge method (vendored deps: junction `node_modules`/`vendor` into an OUT-OF-REPO
worktree, else 27 demos fail).

**Do not:** land a snapshot (`item-148`, `selfdev-borrow`); force a dirty worktree; `-D` an `ahead>0`
ref; leave `cli.mjs log … --follow`/`watch` viewers attached.

**State:** broker UP (restarted this window; passes advancing). `main` `ce0b338`, **23 ahead of
`origin/main` (`95e7c0c`)** — unpushed (operator holds push). Tracked tree clean (except a concurrent
session's `NEXT.md` side-spike block — see CAUTION).

> **CAUTION — a SECOND delegate session was active concurrently** (created `.spike/durable-tui/` at
> 05:03Z, wrote the block above, and ran `cli.mjs log … --follow` viewers + a `serve --max-duration` test
> broker). Reconcile before trusting `NEXT.md` or the store.

## (prior) NEXT SESSION — delegate clock-out, 2026-10-18T04:35Z

**Current item:** finish the branch backlog. This session pruned **51 merged branches** (clean ones), landed **5
verified clean branches** (`devtools-item-1904` compact-spool + `scribe-item-1968/1969/1970/1971`
docs-truth) via `scripts/land.mjs --suite` (suite **138/0**), and — on the operator's ruling —
**archived 41 dirty merged-ref worktrees out-of-tree** to `../durian-pi.worktrees/` (content moved
byte-for-byte, then the merged ref freed with `git switch --detach` + `git branch -d`; nothing discarded).
`main` `95e7c0c → b3710f3 → e072392` (docs commit). **Refs 137→46**, worktrees 167→135. **38 unlanded
branches remain** (was 36; live seats created new ones during the session).

**Queue id:** `#2017` (ROADMAP 76 stack landing: `impl-item-1891` → `impl-item-1907`); the landing-list
rows completed this session (`#1912`, `#1982`, `#1999`, `#2009`, `#2014`) are now landed.

**Exact next command:** `DURIAN_PI_DB=./selfdev.sqlite node cli.mjs status`

**Known blocker:** the model-swap window (`#1957`) needs an operator-declared broker stop. The
rebase-and-land pass for the 33 conflicts needs `pm` to register + route it. (The dirty-worktree
operator decision is RESOLVED: archived out-of-tree.)

**Root cause + prevention DESIGN routed to `pm`** in one intent (`intent-branch-sprawl`, delivered
`04:20:56Z`, inbox drained): no code deletes item branches; `complete_work` retires the worktree but
never merges/deletes the branch; landing is manual + window-gated; dirty worktrees pin branches; the
process leaks `.tmp-*`/`broker.inbox.out` into every worktree; conflicts compound. Prevention items
P1–P6 (continuous landing, prune-on-land, finish ROADMAP 76, gitignore leak artifacts, ROADMAP 100
ratchet, rebase-before-land). **pm should register these and open the rebase-and-land pass.**

**Plan for the 36 unlanded:** land STACK TIPS only (containment map in the intent): `impl-item-1444-fix`
(guard stack), `impl-item-1727` (checkup), `impl-item-1705`+`1704` (degeneration), `devtools-item-1754`
(provisioning), `impl-item-1604` (compacteval), `impl-item-1519` (confine), `impl-item-1891→1907`
(ROADMAP 76), plus singletons. Snapshots `item-148`/`selfdev-borrow` must NEVER land. Each tip needs a
rebase + re-verify before landing.

**ARCHIVED (operator ruling, 2026-10-18):** the 41 merged refs pinned by worktrees dirty with real
content were **archived out-of-tree**, not discarded — `git worktree move` to
`../durian-pi.worktrees/` (files preserved byte-for-byte, spot-verified by md5), then `git switch
--detach` (working tree untouched) and `git branch -d` (merged-only). They remain registered worktrees
at the archive path (6.3 GB); recover any item by re-linking or inspecting there. The 41 dirs are gone
from the project root.

**Incident:** broker dormant-stall recurred a **third time today** (`docs/incidents/2026-10-18-broker-dormant-stalled.md`,
recurrence 3). NEW aggravator VERIFIED and fixed: **10 stale `cli.mjs log … --follow` viewers + 1
`cli.mjs watch`** (5–15 h old) held the store → `database is locked` on wake. Killed; broker restarted
pid `7220`, passes advancing, 4 genlocks. **Do not leave long-lived log/watch viewers attached to the
shared store while the broker drives.**

**State at this clock-out:** broker UP pid `7220` (restarted; passes advancing).
`main` `e072392`, **ahead of `origin/main` (`origin/main` = `95e7c0c`)** — unpushed (operator
holds push). Tracked tree clean; scratch + archived refs under `.spike/delegate/` and
`../durian-pi.worktrees/`. The **model-swap window
(`#1957`) still awaits the operator's declared broker stop** (gate green, `#1936` landed).

**Do not:** stop the broker without an operator window (a landing pass is one); leave log/watch viewers
attached; force a dirty worktree; `-D` an `ahead>0` ref; land a snapshot.

## (prior) NEXT SESSION — delegate clock-out, 2026-10-18T03:38Z

**Current item:** the ROADMAP 71 / broker-spool landing cluster. **#1904** (`compact` spool op) is **verified** (verify **#1987 PASS**) but CLONE-CONFLICTs on `cli.mjs`; a rebase is routed (**#1912**, **#2018**). Next: land the rebased #1904, then the ROADMAP 76 stack (**#2017**), then the docs-truth items (**#1972**, gated on #1904 landing; **#2014**).

**Exact next command:** `DURIAN_PI_DB=./selfdev.sqlite node cli.mjs status`

**Known blocker:** none blocking the delegate. Broker **UP pid 35084** (START 03:15:29Z, passes advancing). The combined **window** (qa → `mistralai/Mistral-Small-3.2-24B-Instruct-2506`, add **qa2** → `google/gemma-4-31B-it`) still needs the operator-declared broker stop; prerequisite **#1936** (Gemma-4 catalog) has **LANDED**. `main` = **4a085f3**, **58 commits ahead of `origin/main`** (NOT pushed; operator holds push). Watch the recurring 37(b) `admitted_not_started` and the main-red `#1610` gate.

**What this session did:** delivered the pi-durable compaction analysis; filed #1904 (compact spool op) → devtools; appended incident recurrences (broker-dormant-stalled @02:37Z `database is locked`; qa-context-degeneration third occurrence); routed qa's verifications to auditor (#1923–#1927); prepared qa2 (`.spike/delegate/rig.selfdev.qa2.json`); ran a **landing pass that landed 26 branches** (main → `4a085f3`, suite green) — **25 conflict-set branches remain** (incl. #1904, which needs a rebase).

**Do not:** re-propose reusing/copying vendor internals as a speed lever — the operator **DECLINED** it (dependency/provenance + upstream-drift risk); keep dependencies pinned. Do not create an `impl2` seat. Do not stop the broker without an operator-declared window (except a wedged broker with no genlock).

**Delegate actions this session (operator-directed):**
- Delivered the requested written analysis: pi-durable is BUILT for live compaction (post's
  "Compaction" section — a task that runs while the conversation keeps going), but durian-pi's `compact`
  verb is a broker-stopped external writer (`refuseWhileBrokerDrives` + live-lease guard,
  `cli.mjs:1140-1163`). It cannot run live because the CLI opens a SECOND harness whereas the spool
  applies ops with the broker's OWN harness (single writer + scheduler).
- Filed the fix as an OPERATOR PRIORITY item against ROADMAP 71 / #912's vocabulary:
  **#1904 → `devtools`** ("`compact` as a command-spool op applied by the broker"), verify
  **#1903 → qa** gated on devtools's branch. devtools is the ROADMAP 71 owner and was idle; this
  avoids pre-empting impl.
- `impl` untouched — stays on **#1881** (worktree audit). No `impl2` seat created (operator chose
  action (a) only).
- Intent bodies: `.spike/delegate/intent-compact-live-spool.md` (+ the `-devtools` update).

**Watch:** devtools is progressing on #1904 (branch `devtools-item-1904`, worktree `item-1904`,
entry ids advancing). A 37(b) `admitted_not_started` notice appeared for devtools but was stale —
per the 37(b) note, do NOT cycle the broker for it.

**Goals in flight (operator, 2026-10-18):** (1) get `pause`/`unpause` (#1388 / ROADMAP 131) implemented;
(2) get the **worktree-audit + leak fix (ROADMAP 76)** registered and implemented; (3) keep reclaiming
the branch/worktree sprawl safely.

**NEXT AGENT JOB:** none outstanding from the operator. Resume the standing goals above; watch
**#1904** (devtools) → **#1903** (qa).

**State at clock-out:** broker **UP pid `28168`** (START `01:48:36Z`; `PASS 28` advancing; `WAKE impl`
and `WAKE qa` fresh). `main` `fa645fb` (+ this session's ops-doc commit), **not pushed**; the remote-tracking
`origin/main` = `e8550b0` (a commit from THIS session — a push occurred, **UNVERIFIED**; the delegate did
not push). `origin/main..main` = 1 unpushed (`abc2a0e`). 107 non-main refs; ~140 worktrees. Oracle
**131/0**.

**Open / watch:**
- **Pause:** `#1841` (priority, queued to `impl`) + `#1843` (qa verify, deferred) + `#1878` (qa question:
  no branch yet). **impl was starved** — oldest-first claiming hit HELD-BACKLOG registrations first
  (`#1841` was 16th). The operator directive to `claim_work({ itemId: 1841 })` + `release_work(1388)` was
  **delivered** to `impl` (and to `pm`). Watch `#1388` leave `held` and a pause branch appear, then qa
  verify.
- **Worktree audit:** operator intent delivered to `pm` to register/route **ROADMAP 76** + the leak
  fixes (`complete_work` teardown unlock/remove; qa unlock+clean `verify-*` on verify completion). Watch
  for the new queue id.
- **Queue hygiene:** `pm` to create HELD-BACKLOG registrations `held`, NOT `queued` — they clog
  oldest-first claiming for every working seat.
- **Incident follow-ups:** `docs/incidents/2026-10-18-broker-dormant-stalled.md` (sev1, mitigated) —
  reopen `#1698` with this evidence; log `SessionFailed.cause` on `wake-failed`; a broker watchdog
  (ROADMAP 61–64/78). **A fresh `broker.json` heartbeat is NOT a health signal — read the last `PASS`.**
- **Reclaim:** 58 locked terminal-item worktrees reclaimed **0 — all dirty**; the remaining safe reclaim
  needs the leak fixed first (or the owner to commit/discard). Never `--force` a dirty worktree.

**Do not:** push (operator holds it); `--force`/`git clean` a dirty worktree; delete an `ahead>0` ref or a
snapshot; stop the broker without an operator window (unless it is wedged with no genlock → terminate).

## QA + IMPL RECOVERY — 2026-10-18 (delegate, operator-authorized window)

**QA's context degraded in place (the recurring `qa-context-degeneration` incident).** Evidence: `log qa`
entry `#79843` — QA's own words *"I'm in trouble. My context is degrading... This is the second time."*;
garbled output ("extras impossible without"), 2 malformed `complete_work` calls (`#79839`, `#79843`),
`status` `qa: malformed_tool_call (2)` + `generation_in_flight`. Context `230,090` tokens. The guard did
not reset it (Defect B false negative; `#1705` still deferred).

**Fix applied (broker-stopped window):** backup `.spike/delegate/store-backup-20261017-203234` →
`serve --stop` (pid `15720`) → `resume` (cleared impl submission `79391`) → `compact qa` (taskId `79861`,
`summaryEntryId 79862`) → restart. A **second** cycle was needed: `compact` left submission `#79865`
`admitted_not_started` (item 37(b)) → stop (pid `29432`) → `resume` (cleared `#79865`) → restart
(**pid `17564`**, `START 01:43:05Z`).

**Result:** QA context `230,090 → ~54k`; coherent, on-task turns (re-executed the `#1843` pause/unpause
verify; produced a full partner-check verdict). `malformed_tool_call` and the first `admitted_not_started`
both cleared. **A fresh `admitted_not_started` can reappear** (37(b) is the known substrate defect, not a
qa fault) — do not keep cycling the broker for it.

**IMPL RECOVERED (same window).** `impl` conv 9's `pi.live` (doc `12105`) was corrupt in the alive-broker
shape — `.spike/serve.err` logged `PathError: unresolvable path: ["tools",0]` **12×** while the broker
stayed alive, `status` stderr named `unreadable pi.live for conversation 9`, and `attention` showed
`impl last_run_failed: aborted`. Per `store-corruption-recovery.md`: stop (pid `17564`, confirmed gone) →
backup `.spike/store-backup-20261017-204831` → `node scripts/repair-pi-live.mjs ./selfdev.sqlite 9`
(retired doc `12105`, `seq 847092`) → restart (**pid `28168`**, `START 01:48:36Z`). Verified: `WAKE impl`
/ `PASS 16 woke=impl`, `status` stderr clean, `impl` preparing `item-1881`. Incident:
`docs/incidents/2026-10-18-seat-unwakeable-corrupt-doc.md`; the runbook gained this shape + the
`["tools",0]` variant + mandatory front-matter.

## BRANCH AUDIT — 2026-10-17 (delegate; operator: "review the repo and branches")

**Read-only audit run; no refs changed.** `main` HEAD `6c8e1d3`, tree clean (`git status --short -- .`
empty), no `.git/MERGE_HEAD`, no conflict markers, broker UP pid `34700` (`cli.mjs serve`, heartbeat
fresh, 3 genlocks held, `PASS` advancing). `origin/main` = `7000634` is an **ancestor** of `main`;
**`main` is ahead 2** (`9fe43c9`, `6c8e1d3`) — unpushed, operator holds push.

**Counts:** 117 local branches (excl `main`) = **63 merged (`ahead=0`) + 54 unlanded (`ahead>0`)**, of
which **52 are real unlanded work** and **2 are snapshots (`item-148`, `selfdev-borrow` — never
merge/delete)**. 156 worktrees, **116 `locked`**.

- **Prunable now (merged + free, `git branch -d`):** 7 — `devtools-item-1667`, `devtools-item-1745`,
  `impl-item-156`, `qa-item-1638`, `qa-item-1764`, `scribe-item-1648`, `security-item-1581`.
- **Merged but worktree-held (release per `leaked-worktrees.md`, then prune):** 56.
- **No patch-equivalent duplicates** (every unlanded branch's `git cherry` is all `+`), but duplicate
tips exist: `impl-item-1680` and `impl-item-1681` share `5a414de1`; 10 refs share `1b46411` (clock-out
doc branches), 6 share `6c384ac`, 5 share `7b72b83`, 5 share `6195c99`.
- **Landing backlog is the real liability:** last merge onto `main` was `7ba34c9` at 17:00Z (≈6.5 h
  ago); **no feature/fix has landed since**, while 52 branches with unique commits (many 13–19 h old)
  sit off `main`. 9 open `LANDING LIST` rows in the queue.
- **Direct cost of the backlog:** `impl-item-1703`/`-1704` (degeneration-guard fixes) are written and
  unlanded, so the resident broker still runs the OLD in-memory module and the `security` seat is
  visibly degenerating; `#1705` is still `queued`. Landing + a broker restart is owed.
- **Adjacent liveness signals (not branch management):** qa `admitted_not_started` submission `#75791`;
  context `pm` 363k / `impl` 367k; `secret_detected` on qa `#75535` and scribe `#69744` (detection
  only — do not echo values; prior same-class findings were git-SHA false positives).

**Actions taken (operator-authorized, 2026-10-17; deletion-safe):**
- **Pruned 8 merged free refs** with `git branch -d` (each proved an ancestor of `main`; `main`
  unchanged `f9f2480`, tree clean) — `devtools-item-1667`, `devtools-item-1745`, `impl-item-156`,
  `qa-item-1638`, `qa-item-1696`, `qa-item-1764`, `scribe-item-1648`, `security-item-1581`.
  117 → 114 refs (≈5 new refs were created live, so net −3).
- **Worktree release: NOT SAFE — nothing removed.** Of the merged-but-held worktrees, **0 are
  clean+unlocked**, 5 are clean+`locked` (keep per `leaked-worktrees.md`), and 52 are **dirty**
  (uncommitted work → keep). No worktree was touched.
- **Landing pass: BLOCKED / not started.** The rig is NOT quiescent — 2 live `genlock.*` held
  continuously by broker pid `34700` (pm) for 90 s — and `scripts/land.mjs` refuses while a generation
  is in flight. Stopping the live broker needs an operator-declared window (standing rule), so it was
  **escalated, not taken**.

**Read-only landing pre-flight (`git merge-tree`, per branch):** ~21 unlanded branches CONFLICT vs
`main` (mostly `docs/runbooks/README.md`, `docs/DECISIONS.md`, `docs/FEATURES.md`, `cli.mjs`); ~36 merge
CLEAN. Land only branches that are BOTH qa-VERIFIED and CLEAN — e.g. `impl-item-253`, `-965`, `-1108`,
`-1465`, `-1535`, `-1547`, `-1553`, `-1557`, `-1585`, `-1589`, `-1610`, `-1698`, `devtools-item-912`.
`impl-item-1703`/`-1704` are CLEAN but **NOT yet qa-verified** (#1808/#1811) — do not land before
verification.

**SESSION OUTCOME (2026-10-18, operator-authorized):** the broker was **force-stopped** (pid `34700`);
store snapshotted to `.spike/delegate/store-backup-20261017-235444`; `resume` cleared 2 stranded
submissions (qa `#76883`, impl `#77152`). Quiesced, one **landing pass** landed **12** verified
branches: `#1610` (fixed MAIN-RED `secretredact`), `#912` (ROADMAP 71 command spool — pause's AC4
prerequisite), `#253`, `#965`, `#1108`, `#1535`, `#1547`, `#1553`, `#1557`, `#1585`, `#1589`, `#1698`.
`main` `a89ac36` → `45845e0`; scratch suite **131/0**; shared-tree `secretredact` GREEN. **8 more
merged refs pruned**. `impl-item-1465` **resolved and landed** (`main` `1f8d25a`): the conflict was a
1-line **import union** in `src/seattools.mjs` (ours `#253` adds `AgentDoc`; theirs `#1465` adds
`import { join } from "node:path"`); resolved by merging `main` into the branch (`074667c`), suite
**131/0**, branch pruned. Broker restarted pid `36204` (00:16:55Z).

**Branch/worktree cleanup (2026-10-18, operator-authorized "Option A"):** 20 merged refs pruned via
the worktree-release/reclaim paths — 1 free-merged (`qa-item-1709`); 2 by releasing terminal
clean+**locked** worktrees (`impl-item-1444`, `security-item-1807`); **17 via the verify-tree reclaim**
(16 batch + 1 pilot) of qa `verify-*` trees whose only content was untracked scratch AND whose nested
trees were clean. Worktrees **157→122**, refs **109→93**, tree clean, `main` unmoved, **nothing forced**.
**18 candidates were KEPT** (nested trees held uncommitted probe scripts). Runbooks updated:
`leaked-worktrees.md` (+ front-matter + § "Reclaiming a merged item-branch pinned by a verify
worktree"), `branch-cleanup.md` (step 5). Oracle **131/0**.

**Worktree audit + reclaim (2026-10-18):** ~136 worktrees, only ~12 in use (3 live seat roots —
`impl`/`qa` item trees + shared; ~9 non-terminal items). A follow-up reclaim of the **58 locked
terminal-item** worktrees returned **0 — all dirty** (11 tracked-only, 8 both, 39 untracked-only); the
blocker is uncommitted content, not the lock and not the missing view. Operator intent
`intent-worktree-audit-priority` **delivered** to `pm` (`INTENT delivered=1`, 01:10:59Z) to implement
**ROADMAP 76** (worktree audit surface) + `complete_work` teardown + qa verify-scratch cleanup; runbook
evidence updated. Broker housekeeping this turn: killed a wedged broker (36204, stale state, no genlock),
`resume` cleared 1 stranded qa run, restarted **pid 24744**, and killed an orphan second `serve` driver
(35896, dead parent, no `broker.json`, no genlock).

**Incident (2026-10-18, sev1, mitigated):** broker `24744` later **stalled while alive** — fresh
heartbeat, log frozen at `PASS 1` for ~6.5 min — after a `wake-failed` storage error (impl conv 9, qa
conv 15). Recovered per `broker-down-or-stalled.md` (terminate no-genlock pid → `resume` [1 pm run] →
restart → **`START pid=15720`**, both spooled intents delivered). Filed
`docs/incidents/2026-10-18-broker-dormant-stalled.md` + index row + runbook Evidence. **A fresh
`broker.json` heartbeat is NOT a health signal — read the last `PASS` line.**

**Pause/unpause priority (operator):** prerequisite satisfied; intent `intent-pause-priority` spooled to
`pm` (`.spike/delegate/intent-pause-priority.md`, `INTENT delivered=1 dead=0`) to **unpark #1388** and
route `pause`/`unpause` (ROADMAP 131 AC1–5) to `impl` now. Confirm `#1388` leaves `held`. **Watch:** the
`pm` guard is in a reset loop (context >400k) — `#1703`/`#1704` remain unlanded/unverified.

**Never `-D` an `ahead>0` ref and never delete a snapshot.**

## HANDOVER — 2026-10-17 (delegate clock-out; incoming agent: **verify the git repo branches**)

**Your job (operator-declared):** verify branch management. Ground in `docs/runbooks/merge.md` (the
landing gate + "Trust, but verify" audit), `docs/runbooks/branch-cleanup.md`, and `docs/WORKFLOWS.md`
W6. **Read-only first.**

**Exact first command:** `DURIAN_PI_DB=./selfdev.sqlite node cli.mjs status`

**Read-only audit (never destructive):**
```bash
git branch --format='%(refname:short)' | grep -v '^main$'
for b in $(git branch --format='%(refname:short)' | grep -v '^main$'); do echo "$b ahead=$(git rev-list --count main..$b)"; done
git worktree list
```
- `ahead=0` = fully merged → safe to prune with `git branch -d` (refuses unmerged); seats cannot delete
their own author branch (seatguard), the delegate/operator may.
- `ahead>0` = unlanded work → **never delete** it, not with `-d` and never with `-D`.
- Release locked worktrees only per `docs/runbooks/leaked-worktrees.md`; never `--force` a dirty one.

**State at clock-out:**
- `main` HEAD `9fe43c9` (this clock-out commit, **unpushed**); tree clean; on `main`.
- **A push to `origin` happened during this session** — `origin/main` moved `1b46411` → `7000634`, and the
  live remote (`git ls-remote origin refs/heads/main`) reports `7000634`. **The delegate did not run
  `git push`; the cause is UNVERIFIED** (operator or another process). Re-check the refs before relying
  on any "unpushed" assumption. Only `9fe43c9` is now unpushed.
- **117 local branches** (excl `main`): **53 unlanded (`ahead>0`)**, **64 merged (`ahead=0`)**.
- **156 worktrees** (`git worktree list | wc -l`) — many `locked` `item-*` under the repo root plus
  `/tmp` verify scratch; audit before releasing.
- Broker UP pid `34700` (unchanged this session).

**This session changed (committed):** the AGT competitor review + OWASP addendum + `docs/COMPETITORS.md`;
ROADMAP **133–151**; **D96** (amended) + **D97**; the competitor-review runbook. The history up to
`7000634` is on `origin/main`; `9fe43c9` is not.

**Do not:** push without the operator's grant; run a second driver while the broker is UP; delete a
branch with `ahead>0`.

## HANDOVER — 2026-10-17 (delegate clock-out; incoming agent: **initial competitor research**)

**The incoming agent's job:** initial competitor research. Start from `docs/runbooks/competitor-review.md`
(upstream-read: shallow-clone read-only into `vendor/eval/<name>`, pin the HEAD, cite a path per claim,
write `docs/reviews/<name>-review.md`, update `docs/COMPETITORS.md`, register adopts as ROADMAP items).
Check `docs/COMPETITORS.md` and `vendor/eval/` first so a project is not re-reviewed. **The operator must
name the target project** — no target is recorded here.

**Exact next command:** `DURIAN_PI_DB=./selfdev.sqlite node cli.mjs status`

**State at clock-out:**
- **Broker UP**, pid `34700` (heartbeat fresh; PASS advancing). Genlock held by `pm` at times.
- `main` HEAD `8178c79`; tree clean; on `main`; **not pushed** (operator holds push).
- **Observed:** `node demo/secretredact.test.mjs` exits **1** on this tree, so the `#1610` MAIN-RED gate
  still reproduces — but queue rows `#1741`/`#1747` claim main went green via `impl-item-837`. **Reconcile
  the discrepancy** (likely the lockfile-vs-pin item `#1754`/`#1755`); trust neither claim without re-running.
- **Delivered this session (broker-delivered, all `dead=0`):**
  `opr-20261017-active-degeneration-guard` (23:06:07Z) → registered **`#1766`**/`#1767`/`#1768`/`#1769`;
  `opr-20261017-active-degeneration-guard-addendum` (23:08:12Z) → agent-fleet prior art + the verified
  absence of `vendor/eval/agent-fleet`.
- **`#1766` RULED (lead, during this checkout):** the TRIGGER is a **SIBLING** of `#62` (cause-based vs
  context-pressure) — do not fold in; but the **ORDERING/HALT/RESOLVE core** (detect → halt → wait idle →
  resolve) is ONE mechanism built ONCE and shared by BOTH — `#1769` [C] is that shared core. Halt
  cooperatively (`abortTask`/`Conversation.abort`); never reset a live lease. Autonomy tightened: halt
  ONLY (no destructive op), recoverable, cause-specific resolution, observable; **zero false positives
  before enabling**; requires a DESIGN-POLICY doc (not just a runbook) + a `DECISIONS.md` entry for the
  new stop authority. **`pm` must now un-gate `#1767`/`#1768`/`#1769`** (`#1766` was the gate).
- **Verified finding (why #1767–#1769 exist):** the guard is post-hoc (assesses committed pages at pass
  end); its actuator is `conversation.reset()` (admitted at the next boundary while busy), and
  `reset`/`compact` refuse a live lease by design. The halt seam already exists in pi-durable
  (`Harness.abortTask`/`Conversation.abort`, `context.abortSignal`). **In-process the genlock holder is the
  broker's own pid** — verified `selfdev.sqlite.broker.json` pid `34700` == `selfdev.sqlite.genlock.0`
  pid `34700` — so `cmdStop`'s `process.kill` is an external-driver tool; the broker needs the cooperative
  abort, not a self-kill.
- **Watch:** `qa` re-saturation (guard fixes `#1703`/`#1704`/`#1705` still not landed).
- **Do not:** push; stop the broker without an operator-declared window; run a second driver while the
  broker is UP.

## NEXT SESSION

**Current item:** the operator has assigned branch verification to the incoming agent (see the top
handover). The competitor review (`microsoft/agent-governance-toolkit`) is DONE: review + OWASP addendum,
`docs/COMPETITORS.md`, ROADMAP **133–151**, D96/D97, runbook deepened. **No next research target is
named.** The team's active work is unchanged: the active-degeneration-guard **`#1766`** (lead shape
ruling) gating **`#1767`**/**`#1768`**/**`#1769`** (impl).

**Exact next command:** `DURIAN_PI_DB=./selfdev.sqlite node cli.mjs status`

**Known blocker (unchanged):** `main` secretredact gate observed red (`demo/secretredact.test.mjs`
exit 1) while queue rows `#1741`/`#1747` claim green — reconcile before any landing.


## HANDOVER — 2026-10-17 (stage-two recovery; clock-out — NEWEST; read `## NEXT SESSION` below)

**Current item / queue ids:** the degeneration-guard fixes **`#1703`** (false positive) /
**`#1704`** (reset idempotence) / **`#1705`** (false negative + model-aware context bound) — all
`queued` to `impl`; the gate is **`#1610` MAIN IS RED** (`#1611`).
**Exact next command:** `DURIAN_PI_DB=./selfdev.sqlite node cli.mjs status`
**Blocker:** `main` is RED — no landing passes the `merge.md` gate.
**Watch:** `qa` re-saturating (its guard is not fixed yet); recovery = `compact qa` in an
operator-sanctioned window (`docs/runbooks/seat-reset.md` § Context saturation).
**Do not:** push (operator holds it); stop the broker without an operator-declared window.

**State at clock-out (2026-10-17T22:28Z):** broker UP pid `34700` (restarted from a dormant pid 32840);
`main` HEAD `1b87c89` (this session's docs), tree clean, not pushed; qa recovered (context 367,559 →
~48k, coherent); `docs/incidents/` now **7 reports** (+`qa-context-degeneration`, sev2 mitigated);
DECISIONS **D95**.

**Routed this session (idea, not scheduled):** operator asked to explore a *simple core + extensions*
redesign down the road. Shape delivered to `pm`: freeze the ASK E core (store seam, single-writer wake
family, trust boundary, CLI contract, config, loader); widen the existing extension seam to register
lazy CLI verbs so durian-pi's own features (worktree, TUI, checkup, ambient measures, format, …) become
opt-in extensions; opt-in via profile → named enable list (path for third-party) → per-seat scoping.
Added goals: easier per-component testing and a substitutable extension-side interface (the core stays
non-pluggable per ASK E constraints i–iv). Intent `opr-20261017-extension-boundary-idea` delivered to
`pm` (`INTENT delivered=1 dead=0`, 22:46:47Z) to register as ROADMAP item **#132**, parked; body
`.spike/delegate/intent-extension-boundary.md`.

## HANDOVER — 2026-10-17 (delegate clock-out; new agent takes the seat)

**Your job next (operator): verify the team is following git procedures and branch management.**
- Ground in `docs/runbooks/merge.md` (the landing/merge gate + "Trust, but verify" audit) and
  `docs/WORKFLOWS.md` W6. The docs-drift audit block is also in `merge.md`.
- **Read-only first:** `git branch --format='%(refname:short)' | grep -v '^main$'` then per branch
  `git rev-list --count main..<b>` (ahead=0 = merged). Never delete a branch with `ahead>0`; `git branch -d`
  is safe (refuses unmerged). Both the **delegate** and the operator can prune; seats cannot (seatguard).
- **OWED / check first:** the 29 branches just landed still need pruning; `pm` was asked to mark the
  29 queue rows landed. Confirm both.
- **Exact first command:** `DURIAN_PI_DB=./selfdev.sqlite node cli.mjs status`

**State at handover:**
- `main` HEAD = `ee7e6e4` (+ the D94 decision commit). **Tree clean.** All 29 landing-pass entries are
  ancestors of `main`; suite verified **123/0** in the scratch before the fast-forward. Entry 11
  (`impl-item-1151`, D1 open) was EXCLUDED.
- **Broker:** healthy, **pid 19720** (started `17:33:00Z`), passes advancing, inbox empty.
- **Crash note:** the prior broker (pid 34756) died `~17:29Z` on `SessionFailed` (`wake-failed` qa/lead).
  Mechanism (every store open takes `BEGIN IMMEDIATE` + DDL via migrations) is VERIFIED in code; the
  specific cause is UNVERIFIED (nested `.cause` is not logged — a required diagnostic fix). Store backed
  up at `.spike/store-backup-20261017-123250`.

**Routed to `pm` this session (all `INTENT delivered`, inbox empty):** `opr-20261017-docs-drift-features`,
`-roundtrip-docs` (pre-existing), `-rulings-batch`, `-rulings-batch2`, `-rulings-batch3`,
`-rulings-batch4`, `-broker-routing`. Decisions logged: **D90, D91** (delegate) + **D94** (D92/D93 are
scribe's, landed).

**Open work the new agent inherits (registered/routed, do not re-derive):**
- **Crash-proofing cluster (HIGH):** true read-only opens for all read verbs; broker survives a
  per-conversation storage error (ROADMAP 78); a broker watchdog/auto-restart; serialise migrations;
  log `SessionFailed.cause` on `wake-failed`.
- **Command spool (ROADMAP 71 / #912, HELD):** the "all writes through the broker" item — prioritise.
- **`send` retirement** + `up` broker-guard gap (flagged); **#156** (start,) + task-toolcall follow-up;
  **test-suite partitioning by functional area (HIGH)**.
- **Product:** test grouping, zero-trust API-key-management app (ROADMAP 60 milestone).

## NEXT SESSION

**Current item:** nothing blocks the delegate — the rig is **up** (broker pid `34700`) and the queue is
advancing. Work the **ordered list below**; item 1 (`#1610` MAIN IS RED) gates all landing. **Recommended
change:** (a) promote item 6 (the crash-proofing cluster) above the product items 4/5, and (b) add the
degeneration-guard fixes (`#1703`/`#1704`/`#1705`) as an immediate priority — they are the only thing
that stops the `qa-context-degeneration` incident and impl's false-positive reset loop recurring. Both
recurring root causes now outrank UI/incident-rule polish.

**Exact next command:** `DURIAN_PI_DB=./selfdev.sqlite node cli.mjs status`

**Priority order (grounded in the queue + `status` attention):**
1. **`#1610` / `#1611` — MAIN IS RED (blocker).** `node demo/secretredact.test.mjs` → exit 1 on `main`
   (3 checks; a secret IS committed). Until green, **no landing passes the `merge.md` gate**.
2. **Land the wrong-root guard (`#1151`) SOON (operator priority).** Land `impl-item-1444-fix` first
   (covers `#1151 → #1225 → #1249 → #1261 → #1444(D1 fix) → #1487`) once `main` is green — routed to
   `pm`; it is the control for the new `seat-root-fallback-commit` incident.
3. **`secret_detected` on `security`** — routed to `pm`; per `store-secret-detected.md` rotate the
   credential and treat the store as compromised.
4. **`#1607` / `#1608`** — `durian-pi ui` `view is not defined` fix + regression test.
5. **`#1609`** — incident-report `check` rules + `ownership` class + demo.
6. **Crash-proofing cluster (PROMOTE — delegate recommendation):** ROADMAP 78 (survive a per-conversation
   storage error), true read-only opens, broker watchdog/auto-restart, serialise migrations, log
   `SessionFailed.cause` — the root of the `broker-crash` incident, which recurred again this session
   (third abnormal death, plus a failed restart). Move this ahead of items 4/5.
7. **`#1605` — the 33-branch landing pass**, parked (`#1612`); re-open in a **quiesced window** after 1.
8. **Prune the 42 merged-but-worktree-held branches** — release per `leaked-worktrees.md`, then `-d`.
9. **`#1388` / ROADMAP 131 (`pause`/`unpause`)** — kills the land-first / broker-window dance.

**State at clock-out:**
- **Broker:** **DOWN at clock-in, then recovered.** The handover's "pid `36488`, passes advancing" was
  stale: the last broker.log line was `PASS 93` at `19:32:35Z`, `START pid=36488` (`19:12:44Z`) had **no
  `EXIT`**, and there was no `serve` process / `broker.json` / `genlock` — it died ~16 min before the
  handover commit. Per `broker-down-or-stalled.md`: `resume` cleared 3 stranded submissions (impl #67700,
  security #67887, security #68025); a first restart (pid `14692`) **died ~6s later** on `Session failed
  after a storage error` (crash loop); a second restart (**pid `37388`, `START 19:53:33Z`**) held and is
  advancing (`WAKE impl`, `PASS 1-3`, 4 genlocks). NOT the `pi.live` corruption case (`log`/`status` read
  clean, no `unreadable`). Visible aggravator: **8 stale `log --follow`/`watch` viewers** (Oct 16-17) hold
  the store open. Recurrence recorded in `docs/incidents/2026-10-17-broker-crash.md`.
- **qa recovered (delegate, operator-sanctioned window):** `compact qa` in one window (`serve --stop` →
  backup `.spike/store-backup-20261017-165036` → force-kill the hung F11 drain → `resume` → `compact qa`
  → restart); a 2nd short cycle cleared an `admitted_not_started` submission. qa context **367,559 →
  ~48k tokens**, coherent turns, **0** escalations since. Guard fixes `#1703`/`#1704`/`#1705` remain
  queued to impl. New incident: `docs/incidents/2026-10-17-qa-context-degeneration.md`.
- `main` HEAD = `9ccfff7`; **tree clean**; the shared tree is on `main`.
- `security`: actively working `#1581` (log turns at `19:19:38`); still `claimed`.
- Local refs **128 → 76** (52 pruned); **33 unlanded refs kept**; **42 merged held by worktrees**.
- **New doc class:** `docs/incidents/` (`_template.md` + index + **6 reports**); enforcement = `#1609`.
- Runbooks: `docs/runbooks/branch-cleanup.md` (`last_verified: 2026-10-17`).

**Known blocker:** `main` is red (`secretredact`) — gates all landing. `#1605` parked. `#1151`/D1
(excluded last pass) lands via the `impl-item-1444-fix` chain.

**Handover notes (this session):**
- 6 incidents filed: landing-safety, broker-crash, live-worktree-reap, empty-landing-window,
  ui-view-undefined, seat-root-fallback-commit.
- Delegate docs commits this session: `1663151`, `5ce0187`, `8b637d9`, `2c49158`, `bec594e`, `9ccfff7`;
  **not pushed** (the operator holds push).
- Recorded lesson: confirm `git branch --show-current` is `main` before committing in the shared tree.

## DELEGATE NOTE — 2026-10-17 (priority delivered, landing window declared, pause command registered)

**Priority #1317 (commit-time secret gate) is DELIVERED and VERIFIED.**
- `impl-item-1317 @6400e8e` (2 commits: `53f6049` cherry-picks #700's scanner; `6400e8e` wires the gate
  into `src/seatguard.mjs` + `demo/commit-secrets.test.mjs`). Delegate spot-checked the branch: both
  commits + all four files present, `6400e8e` not an ancestor of main (correctly unlanded).
- qa verified it (#1376: every named check exit 0 + falsification probes).
- security ratified the posture (#1368 -> `docs/reviews/security-commit-gate-position.md @cf84825`):
  prefix-only gate ratified; the blunt 40-hex entropy rule correctly stays OUT; fail-open-on-git-error
  ratified with one correction.
- Related: #1298 (ratified security position folded into `docs/CODEMODE.md` gate 1, `@6a53136`) verified
  #1357. Codemode gate follow-ups opened: #1379/#1380/#1381.

**The exclusive landing window is DECLARED (operator, 2026-10-17).**
- `pm` intent `opr-20261017-landing-window` spooled (`.spike/delegate/intent-landing-window-declared.md`):
  run landing pass **#1358** per `docs/runbooks/land.md`; quiescing the broker is authorized as part of
  the window (#1360(b) answered).
- **HAZARD flagged:** **#1383** — `land.mjs`'s genlock probe resolves the WRONG store, so it can pass
  while a live broker owns the store. Verify quiescence by hand (`ls -1 selfdev.sqlite.genlock*` empty +
  no `cli.mjs serve` process) before trusting the probe, or land #1383 first.
- **A `genlock.0` was held when the window was declared** (pm generating); the pass must begin once every
  run settles — never `serve --stop` while a genlock is held.

**A `pause` command was routed to the backlog (operator request).**
- Intent `opr-20261017-pause-command` delivered to `pm` (08:16:46Z; `.spike/delegate/intent-pause-command.md`):
  a `pause`/`unpause` command that stops seats taking NEW work while in-flight work settles, so broker
  upgrades run against a quiescent rig. **REGISTERED on `impl-item-1387` as ROADMAP 131** — #1387
  (docs-only, done) + #1388 (implementation, BACKLOG — HOLD, do not start). NOTE: queue rows #1387/#1388
  still say "ROADMAP 130"; the ROADMAP file (131) is authoritative.
- **Why it matters now:** today the only quiesce options are `serve --stop` (kills in-flight runs) and the
  prose "exclusive window" — this is the missing drain-to-quiescence primitive, adjacent to ROADMAP
  69/71/74 and the daemon 61-64.

**The landing window closed QUIET BUT EMPTY.** pm issued **#1390 LANDING PASS GO NOW** (window OPEN
2026-10-17T08:17Z) over **20 branches** (the #1358 list grown with the 4 verified #1169 branches + 2
measured conflict pairs + #1394's impl-item-1109). impl claimed #1390 (08:22:36), quiesced the broker —
`serve --stop` hit the F11 drain (`stopped:true` while pid 37376 held `genlock.0` = `scribe`), waited for
that run to settle, and the broker then logged `EXIT pid=37376 reason=stop passes=606` at **08:32:10** —
but then **deferred #1390 back to pm at 08:28:39 with NO result**.

**OUTCOME: nothing landed.** main is UNCHANGED (`ffa1ea6`); none of the 20 branches is an ancestor of
main. The store is now FREE (no `genlock.*`, no `serve`/`run`/`send` process, nothing written since
08:32:10) — so a broker upgrade is safe to take — but the landings did not happen. **FLAG (structural):**
a seat hosted BY the broker cannot stop that broker and then keep landing; #1390's GO needs a landing path
that runs OUTSIDE the broker (or the broker restarted and the pass re-driven once the upgrade is done).

**Re-drive delivered + broker upgraded (operator-directed, 2026-10-17).**
- The re-drive note `opr-20261017-redrive-1390` was drained on broker restart (`INTENT delivered=1
dead=0` 08:46:20Z) and impl re-engaged #1390 (opened #1395).
- **Broker upgrade DONE:** the pi runtime pin moved `4954d760` -> upstream tip `8efd314f` via
  `node scripts/sync-pi.mjs --update --link` (5 packages built in `vendor/pi-main`). **Validated BEFORE
  keeping:** demo suite **115/0**, `demo` PASS, TUI **15/15**. Committed `234e06e` (`pi-main.pin.json`
  only; `--no-save` kept the lockfile clean — no new durian-pi code was pending, origin 0 behind / 6 ahead).
- Broker restarted on the new runtime: `START pid=37596` 08:46:18Z, PASS advancing, heartbeat fresh.
- **Revert path if a regression appears:** `node scripts/sync-pi.mjs --unlink` (back to released
  packages) + restore the pin sha with the edit tool (never `git restore`/`checkout --`).

**Worktree base-ref gap (impl blocked) — operator directive, REGISTERED.** impl was blocked on #1444 (the D1
fix, which blocks landing entry 11) because **no entry point could make a worktree at an UNLANDED base**:
`prepare_workspace` (`src/seattools.mjs:37`) and the `worktree` verb (`cli.mjs:870`) never pass `ref`,
though the core (`prepareSeatWorkspace`/`createWorktree`) already accepts it. impl also hit refusals
writing item notes into the shared, gitignored `.durian-pi/` (outside its worktree). Intents delivered:
`opr-20261017-impl-worktree-gap`, then `opr-20261017-worktree-capability-first` — operator directive:
**fix the base-ref capability FIRST** (with a failing-first demo); **register** the rest. pm REGISTERED:
**#1456** (capability fix), **#1458** (scratch-path docs), plus **#1453** (worktree-lifecycle test bug) and
**#1465** (long item bodies unreadable after `prepare_workspace` — body lives in `<repo>/.durian-pi/`).

## NEXT SESSION

**Current item (clock-out):** **#1456** — REGISTERED (rig gap, SMALL): expose `base`/`ref` on
`prepare_workspace` (the core already accepts it). This is the operator's "fix the capability FIRST": it
unblocks **#1444** (the D1 `confine.mjs` fix, whose parent base `85c5d95` is UNLANDED) and therefore
landing entry 11. A parallel workaround (**#1461**, lead-ruled "plumbing method", parent 85c5d95) is
`claimed`.

**Landing:** **#1448** (FINAL PROCEDURE, supersedes #1434/#1442) is `deferred` and READY for the
operator/delegate to drive **variant (1)** (stop broker, hand-verify, land outside the broker) with
**entry 11 EXCLUDED**; the operator parked it. `land.mjs` now holds an exclusive FF lock (#1441, verified
#1451), so fallback variant (3) is also enabled.

**Broker:** healthy — pid 37596 (pi pin `8efd314f`), PASS advancing.

**Known blocker:** #1444 cannot proceed until a worktree can be based on the unlanded tip `85c5d95` — via
#1456 (capability) or #1461 (plumbing workaround).

**Exact next command:** `DURIAN_PI_DB=./selfdev.sqlite node cli.mjs status`

## DELEGATE NOTE — 2026-10-17 (runbook discoverability, round-trip research, docs hygiene)

## DELEGATE NOTE — 2026-10-17 (runbook discoverability, round-trip research, docs hygiene)

**This session (committed):**
1. **Followed `research-request.md` before replying** (Diagnose step + the required prompt shape) and
   wrote `docs/reviews/reducing-llm-agent-tool-calls-followup-research-prompt.md`; then, after the report
   landed, **consumed** `docs/reviews/reducing-llm-agent-tool-calls-followup.md` — spot-verified the new
   load-bearing citations (`2512.08296` scaling-agent-systems + Nature `s42256-026-01268-y` both real and
   accurately characterised; the `CODEMODE.md` claims match the tree), registered **ROADMAP 126–130**,
   and cross-linked from `docs/CODEMODE.md` + `docs/METRICS.md`. **Topic closed** — no further external
   research requested. Commits `1702b72`, `c91692b`, `26ab58b`.
2. **Runbook discoverability** added to `AGENTS.md`, the durian-pi skill, and `constitution.txt` **P3
   Runbooks** (read the matching runbook before improvising, not just author). Commit `fa4b22f`; D90.
   The starter's inline constitution was synced afterward (`rig.starter.json`, commit `b52133f`) — the
   P3 Runbooks rewrite had broken the 3 constitution-drift demos, now `demo/*.test.mjs` 115/0. The
   procedure now records this: `docs/runbooks/broker-safe-change.md` gained a front-matter block, a Do
   step to sync the starter inline, and a Verify gate (`demo/starter.test.mjs`) — commit `8b46800`.
3. **Seat constitution reload DONE (forced, operator-authorised):** with two genlocks held, backed up the
   store (`.spike/delegate/store-backup-20261017-054314`), force-killed the broker, ran `up --refresh`
   (9 seats, `constitution.changed=true`, no model resets), `resume` (recovered qa #50734 / impl #51153),
   and restarted the broker (**pid 36768**, `START 05:43:43Z`). `read-constitution.mjs` confirms the new
   P3. Commits `41cf527`.
4. **Docs hygiene** (operator question): the team **is** documenting (scribe active; code landings carry
   doc updates), **but** four project docs carry double-encoded punctuation — `DECISIONS.md` (244 lines),
   `FEATURES.md` (80), `STATUS.md` (32), `SELF-ADMIN.md` (13); `ROADMAP.md`/`WORKFLOWS.md` are clean.
   Spooled a `pm` intent (`opr-20261017-roundtrip-docs`) to fix the encoding + confirm the #1179
   registration lag; broker log `INTENT delivered=1 dead=0` at `05:56:48Z`.
5. **ROADMAP 130 DELIVERED** (delegate): relabelled the "longer plans hurt accuracy" claim in
   `docs/reviews/reducing-llm-agent-tool-calls.md` and gave `[^6]` its `advertised-elsewhere` evidence
   class (commit `48d9932`). Spooled a `pm` sequencing addendum (`opr-20261017-roundtrip-sequencing`,
   delivered `06:05:35Z`): **126 waits on #1192** (item 27's measure); **128/129 fold into codemode
   (item 32)'s `security.sec` gate**; **127 waits on ROADMAP 115 + a quiet tree**.
6. **Codemode security round** (operator-directed): wrote `docs/reviews/security-codemode-review.md` —
   the threat model + falsifiable controls **E1–E14**, a **read-only T0 first cut**, and the
   audit-sink/bounds prerequisites — folded into `docs/CODEMODE.md` gate 1 (commit `d586495`). It is the
   **input to the external `security.sec` position** (the delegate cannot ratify its own review); spooled
   `pm` intent `opr-20261017-codemode-security` (delivered `06:51:01Z`) to record it against ROADMAP 32
   and sequence the T0/T1/T2 tiers. **The operator must route the round to `security.sec`.**
7. **`security` seat created and running** (operator-directed): durian-pi had no seat owning security (the
   `security.sec` consult was external). Added `security` to `rig.selfdev.json` (commit `f701837`; now
   **10 seats**; GLM-5.3-Flash, deliberately NOT a verifier per `checkup`'s own comment, full working
   tools via capability `review`), wired edges both ways + an ownership class, applied broker-safe
   (`up` reported `created: ["security"]`; `ps` 10 seats; `check` clean of `store-missing-seat`; broker
   restarted **pid 37376**, `START 07:03:35Z`). Restored the gitignored vendored catalogue
   `vendor/eval/agency-agents` and borrowed its security personas (MIT). Spooled `pm` intent
   `opr-20261017-security-seat` (delivered `07:17:02Z`): give `security` the codemode position, document
   the seat, decide its standing surface.
8. **Next priority decided + a redundant branch caught:** the `security` seat's first outputs are already
   in the queue (`docs/runbooks/leaked-secret.md` #1300; HIGH finding #1315 → **#1317**; the ratified
   codemode position #1321). Recommended **#1317** (commit-time secret gate) as the next priority; caught
   that **`impl-item-1256` is a redundant duplicate** of `b52133f` (`git cherry` shows the patch already
   on main), so it must NOT be landed (#1256/#1304/#1287 dropped). Spooled `opr-20261017-next-priority`
   (`07:41:55Z`); recorded **D91** (the standing security seat).
9. **Docs-drift finding + intent delivered** (operator question, 2026-10-17 16:32Z): decisions and
   runbooks are well kept, but the FEATURE INVENTORY lags — `format`/`--dry-run`/instance-key/TUI
   backfill/ROADMAP 69 + the `check` rules (81a, #714/#715) landed on `main` with no `FEATURES.md`
   row and no ROADMAP `DELIVERED` mark. Spooled `pm` intent `opr-20261017-docs-drift-features`
   (delivered `16:32:31Z`, `INTENT delivered=1 dead=0`, inbox drained) to register/route the docs and
   to weigh tightening the merge gate's Feature row (a runbook alone currently satisfies it).
   Existing encoding-debt intent `opr-20261017-roundtrip-docs` still covers the mojibake; do not
   duplicate it. **Mitigation rec (operator-owned):** make doc-acceptance machine-checked (D62 /
   ROADMAP 46), not prose — plus a delegate clock-out docs-drift audit.
10. **Docs-drift mitigation — (2)+(4) DONE, (3) pending** (operator approved 2026-10-17):
   - **(2) merge gate tightened** — `docs/runbooks/merge.md` Feature block now requires a `FEATURES.md`
     row OR an explicit "no feature surface" note; a runbook/README mention no longer suffices
     (commit `634a5c3`).
   - **(4) docs-drift audit added** — `merge.md` "Trust, but verify" now carries a read-only block
     (`git log --grep '^feat'` vs `FEATURES`/`ROADMAP` touches); ran it on the last 30 h, it reproduces
     the drift (only `cc19f5b`/compact touched `FEATURES.md`). **LIMITS:** `feat` commits only;
     same-commit touch only; does not cover `DECISIONS.md`, runbooks, `STATUS.md`, or a doc added in a
     LATER commit.
   - **(3) machine check — NOT YET SPOOLED** (next delegate action): route to `pm` to register the
     FEATURES-row half of ROADMAP 46 as a `check` rule.
   - **Branch-management/merge rules into the canonical docs — OPEN** (operator directive): the merge
     procedure lives in `merge.md` / W6 / `BRANCH-AUDIT-2026-10-14.md`; nothing yet consolidates the
     BRANCH LIFECYCLE rules (naming, deletion safety, seatguard refusal, exclusive window). Route the
     canonical-docs part (`WORKFLOWS.md` W6 / `FEATURES.md`, team-owned) to `pm`.
11. **LANDING PASS #1448 DRIVEN + LANDED** (delegate, operator-authorized, 2026-10-17 ~17:00Z).
   - Broker was already down/quiescent (no `broker.json`, no `genlock.*`, no `serve` proc).
   - **29 entries** landed in a scratch worktree via `scripts/land.mjs` + manual conflict resolution;
     `main` fast-forwarded **`89879d7` -> `ba5115b`**. Scratch demo suite **123 pass / 0 fail**.
   - Conflicts resolved: README/FEATURES/CODEMODE unions; the stacked `#1317 -> #1379 -> #1380` chain
     (took the branch superset); `#828`/`#837` README+import unions; `demo/land-helper.test.mjs`
     combined the #1383 + #1441 sections (branch renamed `feat-g-lock`).
   - **Entry 11 (`impl-item-1151`) EXCLUDED** as instructed (D1 open).
   - Broker restarted **pid 34756** `17:13:46Z`; inbox drained (`INTENT delivered=1` `17:13:47Z`).
   - **Broker CRASH + recovery (~17:29Z):** pid 34756 died on `Session failed after a storage error`
     (`wake-failed` qa conv 15 / lead conv 21) — the known **lock-contention** class (read commands
     running open-time migrations against the broker's write lock; stale `log --follow` viewers
     aggravate it), NOT corruption (`status` opens fine, no `unreadable pi.live`). Store backed up to
     `.spike/store-backup-20261017-123250`; broker restarted **pid 19720** `17:33:00Z`; batch-2/3
     intents delivered; no new storage errors. **If it recurs:** the durable fix is skipping migrations
     for read-only opens (registered), and the per-conversation survival is ROADMAP 78.
   - Post-landing attention includes `scribe:secret_detected` and `null:step-repetition` — new notices
     from the landed secret-detection (#828/#837) and degeneration guards; expected, not a failure.
   - **Owed:** `pm` to mark the 29 queue rows landed/DELIVERED; prune the now-merged branches
     (seatguard blocks author-seat deletion; delegate/operator may `git branch -d`, all now `ahead=0`).
   - Rulings batch `opr-20261017-rulings-batch` delivered (zero-trust key-mgmt item; ROADMAP 97 spend
     authorized; #718 defer; #920 both-together; agent-fleet resequence; #965/#966/#851 unstick; #876 close).
   - **Still open:** branch-management/merge rules into the canonical docs; the (3) machine-check intent.

## NEXT SESSION

**Current item (clock-out):** the next priority is **#1317 — a commit-time secret gate** (the `security`
seat's HIGH finding #1315: land #700's scanner as a pre-flight + a demo assertion). Delivered `pm` intent
`opr-20261017-next-priority` (`07:41:55Z`): **#1317 first**; **do NOT land `impl-item-1256`** (redundant
— `git cherry` proves the patch is already on main via `b52133f`); release **`#1227`/ROADMAP 126** (#1192
verified by #1288); check liveness (`impl idle_with_queued_work` ×11, `qa admitted_not_started #57517`).

The **`security` seat is created and running** (10 seats, broker pid 37376) and already produced
`docs/runbooks/leaked-secret.md` (#1300), the #1315 HIGH finding, and the ratified codemode position
(#1321). ROADMAP **130 DELIVERED**; **D91** records the seat decision. The team's in-flight queue has
moved on — trust `status`/`queue`, not the older text below.

**Known blocker:** none blocking the delegate. The operator holds **push** (`origin/main == main`). Four
branches stay unlanded by design and are tracked (`#1169`). **Never delete a branch with
`git rev-list --count main..<b>` > 0.**

**Exact next command:** `DURIAN_PI_DB=./selfdev.sqlite node cli.mjs status`

**What this session changed (all committed):**
1. **PM adapter deferred** (operator direction, **D88**): only the **task interface + storage format**
   (ROADMAP 115) is elevated; 116–123 are parked. Design: `docs/PM-ADAPTERS.md`.
2. **Tutor-app references removed** from config, code, tests, the dead `rigs/tutor-pi.rig.json`, and 21
   docs; affected demos green. Local `durian-pi.config.json` `DURIAN_PI_DB` now points at `./selfdev.sqlite`.
3. **Seat worktrees relocated** (ROADMAP 125, **D89**): 28 terminal + 2 verify scratch moved to
   `../durian-pi.worktrees/`; 5 live/held worktrees remain in `item-*`.
4. **Research SOP hardened:** `research-request.md` now requires a follow-up prompt and registering
   proposed ROADMAP items.
5. **ROADMAP 102–125** registered (git-merging tooling, PM adapters, TUI 124, worktrees 125).

**Next-session checklist:**
1. `DURIAN_PI_DB=./selfdev.sqlite node cli.mjs status` (read-only).
2. Let the claimed items settle; do not poll. When the 4 skipped branches are ready, `#1169` routes them.
3. `pm` sequences ROADMAP 102–125.
4. Procedures: `docs/runbooks/merge.md`, `resolve-merge-conflict.md`, `leaked-worktrees.md`.

## NEXT SESSION — SUPERSEDED (prior pass, historical)

**Current item (clock-out):** wait for the team's **landing pass**, then verify + clean up. `pm` was
routed to land the 15 verified-but-unlanded branches (`opr-20261017-landing-pass`, with the pre-flight
`opr-20261017-landing-preflight`: 11 clean / 4 conflict). After it runs, re-audit and delete only the
**merged** branches; then pick up the top-three: **`#1087`** (ROADMAP 97, qa, measure-first) → TUI
**`#1109`** (99 bug) and **`#1108`** (98 feature) → **`#1151`** (seat-root guard).

**Known blocker:** none blocking the delegate; the team's landing pass is the dependency. The operator
holds **push**; the **#994** quiet window is undeclared. **Do NOT delete a branch with
`git rev-list --count main..<b>` > 0** — that loses unlanded work.

**Exact next command:** `DURIAN_PI_DB=./selfdev.sqlite node cli.mjs status`

**Backlog added this session (operator, 2026-10-17):** ROADMAP **item 101** — BUG (TUI): the
conversation view collapses newlines when a seat's loaded transcript is streamed to the viewport
(`src/tui/client.mjs` `transcriptTurnLines` renders operator/agent turns through `truncate`, whose
`\s+` collapse destroys `\n`). Reproduced: a three-line turn renders as one truncated row. Adjacent to
TUI 89/98/99; register via `pm`.

**Landing-safety actioned this session (operator, 2026-10-17):** the `#1157` landing pass left
`.git/MERGE_HEAD` + conflict markers in `src/checkup.mjs` on the shared tree; `cli.mjs` statically
imports it, so every `node cli.mjs` verb died until impl resolved it. Delegate: corrected
`docs/runbooks/merge.md` (landing pass needs an exclusive window; never leave the tree mid-merge),
wrote `docs/incidents/2026-10-17-landing-safety.md`, and delivered intents `opr-20261017-landing-safety-pm`
+ `-lead` (both `INTENT delivered=1 dead=0` at 04:11:39Z). Committed `7051839`; ROADMAP item 101 in
`9b0eb08`.

**Git-merging research reviewed (operator, 2026-10-17):** consumed `docs/reviews/llm-prompting-for-git-merging.md`
per the `research-request.md` SOP (spot-verified 3 load-bearing citations — Diff-XYZ 2510.12487,
SWE-agent 2405.15793, Merge-Bench 2605.25890 — all real and accurately characterised). Added
`docs/runbooks/resolve-merge-conflict.md` (deterministic-first, per-hunk, abstention, `git merge-tree
--write-tree` pre-flight) + README index; wrote the follow-up prompt
`docs/reviews/llm-prompting-for-git-merging-followup-research-prompt.md`. Committed `2d2f43f`.

**Follow-up landed + actioned (2026-10-17):** `docs/reviews/llm-prompting-for-git-merging-followup.md`
reviewed; corrections applied — `resolve-merge-conflict.md` no longer tells resolvers to use guard-denied
`git checkout` (use `git show :1/:2:/:3:` + write), `merge.md` gained the `merge-tree` pre-flight, and the
research SOP now **mandates** registering proposed items. ROADMAP items **102–114** registered. Created
`docs/runbooks/competitor-review.md`; reviewed Aider (`docs/reviews/aider-review.md`; `vendor/eval/aider`
HEAD `5dc9490`) → `docs/COMPETITORS.md` entry. **Owed:** route the follow-up as done; `pm` sequences
102–117.

**PM-tools research consumed + follow-up digested (2026-10-17):** both reports reviewed; ROADMAP
**115–123** registered. `docs/PM-ADAPTERS.md` folded the follow-up's corrections: (1) `src/confine.mjs`
does **not** block seat egress (verified — path/env/command confinement only; the egress mechanism is
unverified, item 118); (2) keep dependencies **advisory**, do not port Agent Board's enforced DAG;
(3) target **GitHub first** (local stdio MCP), remote Linear/Atlassian operator-gated. The integration
questions are externally closed; the **value case** (does an external tracker improve efficiency /
correctness / effectiveness?) is **not** answered by the research — it is a decision + measurement
(item 123). Other internal open item: the egress mechanism (118).

**Operator direction (2026-10-17):** defer the external PM adapter — no one interfaces an external PM
system soon and its value is unproven. **Elevate only ROADMAP 115** (task interface + storage format, one
contract for internal and future-external use); **park 116–123**. See `docs/PM-ADAPTERS.md` "Product
direction" + "Task interface contract (proposal)".

**Purpose clarified (operator, 2026-10-17):** the external PM exists for a **human to add and organize work
items** — it is a human front door + status mirror, not the execution authority. `RigQueue` stays the
execution system of record; the schema (115) carries the human-owned fields (`priority`/`labels`/
`collection`/`assignee`) and separates intake (PM → queue) from status export (queue → PM).

**Next-session checklist (the landing cleanup):**
1. Audit: `for b in $(git branch --format='%(refname:short)' | grep -v '^main$'); do echo "$b ahead=$(git rev-list --count main..$b)"; done`
2. Delete **only** `ahead=0` branches: `git branch -d <b>` (safe — refuses anything unmerged).
3. Any still `ahead>0` means the landing pass is incomplete: report to `pm`; never `-D`.
4. See `docs/runbooks/merge.md` for the per-type checklist and the audit.

**This pass (all done):**
1. **Branch cleanup:** deleted the 18 fully-merged local branches (`git branch -d`, all succeeded); 18
   local branches remain (17 with unique work + `main`).
2. **Merge/landing process added:** `docs/runbooks/merge.md` (universal gate + per-type checklists
   bugfix/feature/research/docs-only; the landing procedure + read-only audit), a **W6** workflow in
   `docs/WORKFLOWS.md`, and an index row in `docs/runbooks/README.md`. Operator preference honored:
   **instructions + a later read-only audit, no new broker automation.**
3. **ROADMAP item 100** — measure landing health (unlanded-verified count + time-to-land): a read-only
   metric (no auto-merge/broker hook) so the delegate can verify later; explicitly tied to the operator's
   "trust, but verify later" preference.
4. **Landing pass routed to `pm`** (intent `opr-20261017-landing-pass`): land the 15 verified-but-unlanded
   branches once, and register item 100.
5. **Top-three directive delivered** (intent `opr-20261017-top-three`): `#1087`/ROADMAP 97 (qa,
   measure-first) → TUI `#1109`(99)/`#1108`(98) → `#1151` (seat-root guard).
6. The prior pass (D85 language-drift guard + qa reset) is done and verified.

`#1036`/`#916` and the second reload are DONE (the broker restarted at 02:12 UTC, after #916 landed at
01:58 UTC).

**NEXT SESSION — prior pass detail (twelfth, done):** D85 language-drift guard (`06e08f8`:
`src/attention.mjs` + `src/degeneration.mjs` + `src/supervisor.mjs`, RED→GREEN, suite 102/0); qa reset
via an operator-authorized broker-safe stop (pid 35640 force-killed in the F11 drain, `reset qa`
English-only handoff, broker restarted **pid 13712**, qa back in English); TUI items 98/99 registered.

## CLOCK-OUT — tenth pass (2026-10-16, delegate) — historical

**HEAD at clock-in:** `f3c3179`. Delegate commits this session: the cooldown-revisit fix (`7a0ae0f` —
`src/broker.mjs`, `src/driver.mjs`, `src/scheduler.mjs`, `demo/broker-cooldown-revisit.test.mjs`) and
the spooled-intent wake fix (`src/broker.mjs`, `demo/broker-intent-wake.test.mjs`).

**WHAT THIS PASS DID (all verified):**
1. **Fixed the still-owed general broker revisit gap (delegate-owned).** `selectWakes` produced real
   candidates, `seatFilter` silently dropped cooldown-suppressed ones, and nothing re-ran a pass when
   the cooldown later elapsed — so a seat whose run settled INSIDE the 30 s cooldown sat with queued
   work until an unrelated commit. Fix: `driveOnce` reports dropped candidates via `onSuppressed`;
   `WakeScheduler.msUntilSeatReady(name)` gives the wait; `runWakeLoop` schedules a revisit pass for
   the earliest suppressed seat's deadline and un-parks to mark itself dirty (recomputed each pass so
   a stale deadline cannot spin the loop). Proof: `demo/broker-cooldown-revisit.test.mjs` — RED against
   pre-fix code (1 wake in 3000 ms), GREEN after (re-wake ~1545 ms in, after a 1500 ms cooldown).
2. **Fixed the spooled-intent wake gap (delegate-owned; closes item 66's incomplete half).** A resident
   broker drains `<db>.broker.inbox` only at the START of a pass, but ran a pass only on a
   wake-relevant commit — so an operator intent written by `intent.mjs` sat until an unrelated commit.
   `runWakeLoop` now treats a non-empty inbox like a wake-relevant change (no spin risk: every file is
   submitted+unlinked or dead-lettered within the pass). Proof: `demo/broker-intent-wake.test.mjs` — RED
   against pre-fix code (no delivery in 3000 ms), GREEN after.
3. **Operator-authorized broker reload DONE (#1032).** `serve --stop` reported `stopped: true`; each time
   the process stayed alive in the F11 drain (the first, pid 4644, was force-killed with NO genlock at
   the stop; the second, pid 6804, later exited on its own `reason=stop`). Restarted via
   `scripts/serve-noroot.ps1`; constitution intact. The #822 npm-ci fix is now LIVE. **Final broker: pid
   35640, started `2026-10-17T01:13:17Z`.** **Caveat:** `#916` (`dd79fa3`) is not yet landed, so `#1036`
   must land it and a SECOND reload will be needed to activate that half.
4. **Operator CRLF/EOL ruling delivered to `pm`** (inbox intent `opr-20261016-eol-policy-944`; broker
   logged `INTENT delivered=1 dead=0`). Ruling (**D83**): EOL-insensitive assertions APPROVED (lead #948
   option 1) and a narrow `.gitattributes` APPROVED (file-scoped `eol=lf`); repo-wide `* text=auto eol=lf`
   NOT approved. #328's hold is lifted for this scope; #975/#976 remain separate.
5. **Full demo suite: 97 pass / 3 fail** (two new demos this pass). The 3 failures are the PRE-EXISTING
   constitution-drift class (`demo/commit-model.test.mjs`, `demo/seat-commit-instructions.test.mjs`,
   `demo/starter.test.mjs` — starter inline vs `constitution.txt`), registered as **#976**; none touches
   this pass's changes.

**THE POINTER WAS STALE.** The ninth-pass pointer named **#885** (`cmdInit`) as priority; it has LANDED
(`5cb8123`), and the team has since landed #915/#1013 (`7c2fb52`, `f3c3179`), verified
#874/#875/#910/#911/#916/#890, and registered the TUI-89 / formatter-90 / multi-instance-91 /
runbook-81/82/86 work. **Trust the queue + `status`, not the ninth-pass text below.**

**PRIORITY — CURRENT CRITICAL PATH (all `impl`):**
1. **LANDING TRAIN `#1040`** — land the verified DONE-on-branch artifacts in order: `#890` → (`#874`
   `7013294`, then `#875` `50bc585`) → (`#910` `c2fa6ee`, then `#911` `07ae6a6`); **`git merge --no-ff`**,
   explicit paths, never push, then mark the rows DELIVERED.
2. **`#1036`** — land `#916` (`dd79fa3`); pairs with the #915 landing so one rig reload activates both.
3. Then the serialized `cli.mjs` chain **`#934` → `#873` → `#966`** (one writer at a time; `#920` stays
   on the ENV seam). Then the held daemon items **`#723` → `#724` → `#725`** (`impl` must release them).
**Exact next command (read-only):** `DURIAN_PI_DB=./selfdev.sqlite node cli.mjs status`.

**⚠ OPERATOR DECISIONS — RECEIVED this session (recorded: D83):**
- **`#1032` — rig reload: DONE** (final pid 35640). The `#916` half still needs landing (#1036) and a
  second reload.
- **`#944`/`#328` — CRLF/EOL: RULED** — EOL-insensitive assertions + a narrow `.gitattributes`
  (`eol=lf`, file-scoped). Repo-wide rewrite NOT approved. Delivered to `pm`.
- Still operator-owned: the **#994** whole-tree Prettier normalize quiet window (trigger-gated). The
  operator holds push (origin/main == main).
- **Priority order ACCEPTED (2026-10-17):** `#1040` (landing train) first, then `#1036` (land #916 →
  2nd reload), `#977`+`#1055` (EOL), `#975`+`#976`, `#964`→`#965`→`#966`, `#873`, `#998`/`#1002`/`#993`,
  then the held daemon `#723`→`#725`. Delivered to `pm` (inbox intent `opr-20261017-priority-order`;
  broker logged `INTENT delivered=1 dead=0`). **Still open for the operator:** `#1059` (KEEP vs reset
  `#940`'s shared-main commit `e3a8e53`).
- **Compaction research follow-up DRAFTED (2026-10-17):**
  `docs/reviews/context-compaction-followup-research-prompt.md` — the questions the operator's
  `docs/reviews/chat-session-compaction-best-practices.md` left open (trigger/effective-window,
  thinking-token replay, mid-item safety, verifier isolation, masking primitive, evaluation). Awaiting the
  operator routing it to the research agent; **do NOT update ROADMAP 27–30 until the report lands**
  (`docs/reviews/context-compaction-followup.md`).

**BROKER:** pid `35640` (`scripts/serve-noroot.ps1`), started `2026-10-17T01:13:17Z`; loaded the
delegate's broker fixes. Inbox empty (the EOL ruling was delivered). At start it woke `impl` + `qa`.
`status.attention` = deferred-awaiting-answer (old parked rows) + `queue-ageing`. **Do NOT `serve --stop`
while a `genlock.*` is held**; `"stopped": true` is NOT proof the process exited — pid 4644 hung in the
F11 drain and was force-killed, and pid 6804 exited on its own after a multi-minute drain.

**TREE:** clean at clock-in; this pass's edits committed with explicit paths. `item-*` worktrees are
leaked/locked detachments (known defect `#998`), not tree dirt.

## CLOCK-OUT — ninth pass (2026-10-16, delegate) — historical

**HEAD at clock-out:** `d5c1dfb`. Delegate commits this session: `f579bb2` (thinkingLevel on the 5
DeepSeek seats), `072bfe6` (ROADMAP 89 TUI), `b2ff656` (pointer), `89c50d4` (ROADMAP 90 formatter),
`d5c1dfb` (ROADMAP 91 multi-instance).

**WHAT THE DELEGATE DID (all verified):**
1. **impl degradation fixed** — `rig.selfdev.json` had no `thinkingLevel`, so DeepSeek seats ran with
   `thinking:{type:"disabled"}` + no `reasoning_effort` (pi-ai `openai-completions.js:668-679`) and
   every recent `impl` turn showed `usage.reasoning:0` (ROADMAP 43a). Added `thinkingLevel:"high"` to
   pm/impl/lead/scribe/devtools (`f579bb2`), applied broker-safe (stop → `up --refresh --no-serve` →
   `reset impl` entry `38233` → restart). Verified 5 seats read `thinkingLevel="high"` in AgentState.
2. **Four operator intents routed to `pm`** (inbox; all delivered, `dead=0`): broker-safe writes,
   request-TRACE, TUI seat-transcript (ROADMAP 89), app-level formatter (ROADMAP 90), multi-instance
   (ROADMAP 91). **The team registered all of them the same session** — see the queue.
3. **Roadmap:** added items **89** (TUI seat-detail transcript), **90** (app-level `format` verb),
   **91** (multiple instances / instance identity for the daemon).

**PRIORITY — CURRENT ITEM:** **#885 (LAND #624 `cmdInit`: `M cli.mjs` + `?? demo/init.test.mjs`)** is
STILL `queued` to `impl` — NOT landed. The delegate delivered a claim-by-id priority steer to `impl`
(`opr-20261016-impl-priority-885`, `.spike/delegate/intent-impl-priority-885.md`): claim #885, run
`node --check cli.mjs` + `demo/init.test.mjs`, commit explicit paths only, complete, report to qa.
**lead #913 rules #885 lands FIRST** — it gates #910 (69), #911 (70), #912 (71), #873 (`compact`), and
#934/#940/#927 (all edit `cli.mjs`). **Exact next command (read-only):**
`DURIAN_PI_DB=./selfdev.sqlite node cli.mjs status`.

**ORDER after #885:** #874 (wall-clock, first) → #873 (`compact`) → #875 (degen-text registry); then
#910/#911 → #912. Registered from this session's intents: #920/#922/#923 (trace), #927/#928 (TUI 89;
designer CLAIMED #928), #933/#934 (formatter 90; devtools CLAIMED #933), #939/#940 (multi-instance 91).

**⚠ OPERATOR POLICY QUESTION PENDING (surface to the operator):** **#944 / #948** — a SCOPE+POLICY
ruling on the **CRLF / line-ending stance** (ROADMAP #328, #766); lead split the scope and ruled POLICY
is the OPERATOR's (#328 on hold). Same width as formatter item 90. The delegate has NOT ruled it.

**TREE STATE — NOT the delegate's (do NOT commit or discard):** `M cli.mjs`, `?? demo/init.test.mjs`
(#624/#885); `M package.json`, `M package-lock.json`, `?? .prettierrc.json`, `?? docs/FORMATTER.md`
(devtools/impl #933/#934 — Prettier tool choice in flight). Delegate's own edits are all COMMITTED.

**BROKER:** pid `4644` (`scripts/serve-noroot.ps1`), started `21:58:43Z`; `genlock.0` held at clock-out
(one run in flight). Inbox empty, no dead-letter. **Do NOT poll runs — the operator notifies.**

**Do NOT `serve --stop` while a `genlock.*` is held** (`docs/runbooks/broker-safe-change.md`);
`"stopped": true` is not proof the process exited.

## OPERATOR INTENT ROUTED — broker-safe writes (2026-10-16, delegate)

**Operator instructed: prioritize and get ROADMAP 69/70/71 moving.** Delivered to `pm` via the inbox
(`intent.mjs`, requestId `opr-20261016-broker-safe-writes-69-71`); broker log shows
`INTENT delivered=1 dead=0` at `21:48:29Z`; inbox empty, no dead-letter. Body:
`.spike/delegate/intent-prioritize-broker-safe-writes.md`.

- **69** refuse/route writes while the broker drives (impl, `cli.mjs`); **70** read-boundary hardening
  (impl); **71** command spool / mailbox — the "all commands through the broker" piece (devtools +
  delegate consulting). Order: 68→69→70→71, then daemon 61–64. 68 already delivered.
- **Prerequisite:** the `cli.mjs` gate (#624 `cmdInit`, uncommitted) — that is PRIORITY 1 below.
- **Status: REGISTERED.** `pm` created **#910** (69, impl) and **#911** (70, impl); **#912** (71, devtools) is `held`. `lead` ruled **#913** and sequenced: **#885 (land #624 `cmdInit`) lands FIRST** — three families contend for the dirty `cli.mjs` (#885, 69/70/71, and the `compact` verb #873) and must not be open at once. `pm`'s reply is **#914**.
- **Do NOT poll `pm`;** hand back and wait for the operator.

## THIS SESSION — live changes + two new routed items (2026-10-16 late, delegate)

**impl degradation fixed operationally (thinking was disabled).** `rig.selfdev.json` had no
`thinkingLevel` on any seat, so pi-ai's DeepSeek branch sent `thinking:{type:"disabled"}` and no
`reasoning_effort` (`openai-completions.js:668-679`); every recent `impl` turn showed `usage.reasoning:
0` and the seat narrated its own loop (ROADMAP 43a named this exactly). Applied: added
`"thinkingLevel": "high"` to the five DeepSeek seats (pm, impl, lead, scribe, devtools) — **committed `f579bb2`** — then broker-safe stop → `up rig.selfdev.json --refresh --no-serve`
(all 9 `refreshed`) → `reset impl` (entry `38233`) → broker restarted (**pid 4644**). Verified the five
seats read `thinkingLevel="high"` from AgentState (`.spike/delegate/check-thinking.mjs`).

**Four operator intents routed to `pm` (inbox; all delivered, `dead=0`):**
- **request-TRACE surface** (`opr-20261016-request-trace`): a verb/env to dump the ACTUAL serialized
  request payload per model call, via pi-ai's unused `ProviderRequestOptions.onPayload`/`onResponse`/
  `fetch` seam (`types.d.ts:52-83`) — realizes ROADMAP 43(c) and lets a user see the real DeepInfra
  DeepSeek args, not the programmed config. Body: `.spike/delegate/intent-request-trace.md`.
- **ROADMAP 89 — TUI seat-detail transcript** (`opr-20261016-tui-seat-transcript`): load a seat's full
  chat log on opening its details, not only the live tail (the 24-entry `SCAN_LIMIT` page). Added to
  `docs/ROADMAP.md` (Mid-term, next to item 17). Body: `.spike/delegate/intent-tui-seat-transcript.md`.

- **ROADMAP 90 — app-level formatter** (`opr-20261016-formatter-backlog`): an explicit
  `format [--check] [-- <paths>]` verb; body `.spike/delegate/intent-formatter-backlog.md`.
- **ROADMAP 91 — multiple instances** (`opr-20261016-multi-instance`): instance identity for the OS
  trigger / markers / lock; body `.spike/delegate/intent-multi-instance-backlog.md`.

**Delegate edits this session are ALL COMMITTED** (`f579bb2`, `072bfe6`, `b2ff656`, `89c50d4`,
`d5c1dfb`). The remaining dirty tree is OTHER seats' in-flight work — do NOT commit or discard.

## CLOCK-OUT — eighth pass (2026-10-16, delegate) — historical

**`main` HEAD:** `978574d`. Commits this session: `8ae8fff` (impl: seatguard #673/#780), `191c481` (a
swallowed-catch fix the warden flagged), `97a3c6d` (D78 prose guard) then `449e870` (**REVERTED** — it
false-reset lead/advocate/scribe/auditor/impl), `689416a` + `978574d` (pointer/runbooks).

**PRIORITY 1 — operator ruling (routed to `pm`, intent delivered `21:39:38Z`, D79):** land ALL
uncommitted shared-tree work on `main`:
- `cli.mjs` + `demo/init.test.mjs` = **#624 `cmdInit`** (the gate; complete but in no commit);
- `docs/SEAT-LIFECYCLE.md` = **#819 (scribe)**, after its #823 verify;
- `docs/ROADMAP.md` edit = fold into its registering item.
Explicit-path commits only; no push. **This unblocks items 69/70/71/74/78.**

**PRIORITY 2 — routed to `pm` (intent delivered `21:37:29Z`):** the three ordered build items —
(1) `compact` verb; (2) a HIGH per-turn wall-clock bound as a separate guard cause (implement first);
(3) a revived degenerate-text guard as an **extensible named-pattern registry**, with positive AND
negative fixtures pulled from the seats' own conversations, **zero false positives on all real pages
before enabling**, then verified against `impl`'s entry-`36368` loop. Bodies:
`.spike/delegate/intent-compact-wallclock-degentext.md` and `intent-land-uncommitted-priority.md`.

**Still open:** the `impl` prose loop (`36368`) is UNCAUGHT until item (3) lands; the dormant-broker
revisit gap is unfixed; item 69's hard write guard still depends on the `cli.mjs` landing.

**Broker:** `pid 29372` (`scripts/serve-noroot.ps1`), reverted guard loaded; `pm` + `scribe` generating.
A broker restart is the only reliable way to drain the inbox if it is dormant — spool the intent, then
restart. **Never `serve --stop` while a `genlock.*` is held** (the F11 drain hangs; `"stopped": true` is
not proof the process exited — see `broker-safe-change.md`).

**Exact next command (read-only):** `DURIAN_PI_DB=./selfdev.sqlite node cli.mjs status`.

## SEVENTH PASS — 2026-10-16 (delegate)

- **ROUTED to `pm`** (intent spooled + delivered, `INTENT delivered=1`; body
  `.spike/delegate/intent-compact-wallclock-degentext.md`). Three ordered items, each with a
  runbook + FEATURES row + a D-entry:
  1. **`compact` verb** — expose pi-durable's `Conversation.compact` as `node cli.mjs compact <seat>
     [instructions]`, mirroring `resetSeatContext` (unknown-seat fail + live-generation-lease refusal),
     and make the verb truthful about how its background task completes (no enqueue-and-exit stub).
  2. **HIGH per-turn wall-clock bound** as a SEPARATE guard cause (propose ~5 min, operator-tunable),
     so a legitimately long text/tool turn never trips it. Implemented FIRST.
  3. **Revive the degenerate-text guard EXTENSIBLY** (a named-pattern registry) with positive AND
     negative fixtures PULLED FROM THE SEATS' OWN CONVERSATIONS, validated against ALL seats' real
     pages with a false-positive count of 0 BEFORE enabling; then verify it catches `impl`'s entry-36368
     loop specifically. (D78's lesson: a context-resetting heuristic must be validated against real
     pages, not just synthetic fixtures.)
- **Completed this session (committed):** `8ae8fff` impl landed the seatguard work (#673/#780);
  `191c481` fixed a swallowed catch flagged by the warden; `97a3c6d` added the D78 prose guard and
  `449e870` REVERTED it (it false-reset `lead`, `advocate`, `scribe`, `auditor`, and `impl`); `689416a`
  and this pass keep the pointer true.
- **Docs updated this pass:** `docs/runbooks/seat-reset.md` (a GUARD reset can be a false positive;
  read the run before trusting it); `broker-safe-change.md` (`"stopped": true` is NOT proof the process
  exited — the F11 drain hangs; never kill while a genlock is held); `broker-down-or-stalled.md` (the
  alive-but-DORMANT revisit gap: fresh heartbeat + stale `PASS` + no genlock).
- **Still owed / open:** the `impl` prose loop (entry `36368`) is UNCAUGHT until Task 3 lands; the
  dormant-broker revisit gap is unfixed; the `cli.mjs` gate (#624) still blocks items 69/70/71/74/78.
- **Broker:** restarted `pid 29372` (`scripts/serve-noroot.ps1`); the reverted guard is loaded (no
  degeneration escalations). Do NOT call `serve --stop` while a `genlock.*` is held.
- **Exact next command (read-only):** `DURIAN_PI_DB=./selfdev.sqlite node cli.mjs status`.

## SIXTH PASS — 2026-10-16 (delegate)

- **impl committed the seatguard work the operator asked for: `8ae8fff`** (`src/seatguard.mjs` +
  `demo/seatguard.test.mjs`, #673/#780) on explicit paths; the shared tree is now clean of them. The
  inbox intent that asked for it was delivered while the broker ran (`INTENT delivered=1`), no second
  writer.
- **THE `cli.mjs` GATE STILL STANDS.** `cli.mjs` + untracked `demo/init.test.mjs` are still uncommitted
  (#624's artifact); items 69/70/71/74/78 stay blocked until it lands.
- **REVERTED `97a3c6d` (D78): the prose-degeneration detector false-positived and was removed.** It
  did catch the real `impl` loop (entry `36368`: "Let me emit. Emit. OK. Go. Now." ~30× per turn while
  still emitting tool calls, so every structural signal read clean), but on the broker's FIRST pass it
  also reset `lead`, `advocate`, `scribe`, and `auditor` — coherent transcripts with low *fragment*
  diversity. Sentence heuristics over markdown cannot separate a word-salad loop from a normal long
  document (the length cap discards the varied sentences and keeps the repeated ones). The guard is back
  to its pre-D78 structural signals; **the `impl` prose loop remains UNCAUGHT**. A signal that does not
  parse prose (a per-turn wall-clock latency bound — degenerate turns ran 56 s then 122 s) is the
  candidate. See D78's **Status: REVERTED**.
- **Broker restarted 21:20 (pid 35812)** to drain the impl question and load D78; it then false-reset the
  four seats above. It **MUST be restarted again** after the D78 revert lands, or it keeps resetting them.
  Stop first (`serve --stop`; proceed only on `stopped:true` and confirm no `cli.mjs serve` remains),
  then `scripts/serve-noroot.ps1`.
- **`impl` went dormant with 23 queued items — the GENERAL revisit gap.** After a NORMAL settle the
  per-seat cooldown suppresses the re-wake, and no further pass fires without a store commit, so a seat
  with queued work sits until an unrelated commit or a restart. Verified: pid 16628's last `PASS 82` at
  `21:09:19`, heartbeat fresh, no genlocks. Still owed.
- **No compaction verb exists.** pi-durable ships `CompactionTask`, but durian-pi calls it nowhere and
  `help` has no `compact`; ROADMAP #62 (owner: impl) is the ordered context-pressure + one-compaction
  item. `reset` is the only context-reducing verb — a full reset, not a summary.
- **Open sqlite lock (transient, by design):** any opener can hit "database is locked" because EVERY
  open runs schema-migration DDL (`BEGIN IMMEDIATE`) and the resident broker holds the single write
  lock; the adapter's busy_timeout is 5000 ms, so a retry succeeds. Aggravated by stale
  `log --follow` viewers holding connections. It clears when the broker is stopped (and viewers reaped);
  the durable fix (skip migrations for read-only opens) is a code item for the team.
- **Exact next command (read-only):** `DURIAN_PI_DB=./selfdev.sqlite node cli.mjs status`.

> **Operator working agreement (2026-10-15): do not poll or wait on background seat runs.** Dispatch
> the `send`/`run` detached, note the pid and its `.spike/delegate/*.out` file, then hand back. The
> operator notifies you when a run completes. Do not loop `sleep`/`tasklist` to watch it.

## CLOCK-OUT — 2026-10-16 (delegate, fifth pass) — START HERE

**What this session did (all LOCAL, unpushed):**
- Applied the pending **P3 Runbooks** constitution (`up rig.selfdev.json --refresh --no-serve`); doc 28
  now carries `prepare_workspace` + `P3 Language` + `P3 Runbooks` (verified).
- Fixed the **recurring `impl` stall**: a tool call written as TEXT using DeepSeek's **DSML**
  special-token delimiter (U+FF5C `DSML` U+FF5C). **A terminal STRIPS the delimiter, so a screen read
  shows a clean `<parameter>` block and HIDES the fault — read the stored bytes.** `src/attention.mjs`
  `isPseudoToolCallTurn`/`countPseudoToolCalls`; `assessRun` (`src/degeneration.mjs`) trips on the first
  occurrence; `src/supervisor.mjs` reset handoff names it; `src/scheduler.mjs` + `src/broker.mjs` clear
  the reset seat's cooldown so the next pass re-drives it. Commits `f086382` → `c38815f` → `7d62929`;
  decision **D77**. Verified against the real stored entry `35382` and live (reset written, seat re-woken
  and generating).
- Registered via `pm`: **#819 → scribe** (seat lifecycle + environment doc; CLAIMED, in progress;
  `docs/SEAT-LIFECYCLE.md` is untracked in the tree), runbook items **#814/#815 → impl, #816 → qa (held),
  #817 → lead (deferred)**, and the **queue-view + directed-graph** item **#841 → designer (surface,
  CLAIMED) / #842 → impl (data) / #843 → lead (sequencing)**. Design recorded in the registration:
  build the VIEW first, keep dependencies ADVISORY, and adopt pi-durable's `TaskGraphState.waiting`
  (`on`/`policy`) if enforcement is ever wanted — do NOT build a parallel DAG scheduler in `RigQueue`.
- Full suite after the fix: `demo/*.test.mjs` = **94 pass / 3 fail**; `npm run test:tui` = **14/14**;
  `npm run demo` = **PASS**. The 3 failures are **pre-existing constitution drift, not this session**:
  `rig.starter.json`'s `constitutionInline` is missing `P3 Language` (`a0ab993`) and `P3 Runbooks`
  (`fe0c74c`), so `demo/commit-model.test.mjs`, `demo/seat-commit-instructions.test.mjs`, and
  `demo/starter.test.mjs` fail their `starter === constitution.txt` assertion. **Unblocked, high-value
  next item: sync the starter's inline copy with `constitution.txt` → suite 97/97** (route to the
  constitution's owner, or take as a clean-path fix).

**Broker:** running **pid 16628** (`scripts/serve-noroot.ps1`), started after a clean
`EXIT pid=9444 reason=stop`; it loads the DSML fix. pm was generating at clock-out (see
`selfdev.sqlite.genlock.*`). Log: `selfdev.sqlite.broker.log`.

**Open decision / blocker needing an OPERATOR RULING:**
1. **The `cli.mjs` gate.** The working-tree `cli.mjs` is **#624's complete-but-UNCOMMITTED** `cmdInit`
   artifact: `demo/init.test.mjs` exits 0, `node --check cli.mjs` is clean, queue row **#624 is `done`**,
   yet `cmdInit` is in **no commit** (`git log --all -S cmdInit` empty; no `item-*` worktree HEAD has it).
   **Items 69/78 are blocked until it lands.** Question for the operator: **may the delegate commit
   `cli.mjs` + `demo/init.test.mjs` (explicit paths only) to clear the gate?** Items 69/78 are also still
   NOT registered as queue rows.

**Still owed (delegate):** the GENERAL broker revisit gap — a seat suppressed by the per-seat cooldown
   after a NORMAL settle (not a reset) still waits for an unrelated commit; the reset path is fixed
   (`7d62929`). Fix by scheduling a pass when a candidate is cooldown-suppressed.

**Exact next command (read-only):** `DURIAN_PI_DB=./selfdev.sqlite node cli.mjs status`.
**Restart a down broker:** `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/serve-noroot.ps1`
(never set `DURIAN_PI_SEAT_ROOT`).

**Do NOT commit the tree's other-seat work:** `cli.mjs`, `demo/init.test.mjs`, `src/seatguard.mjs`,
`demo/seatguard.test.mjs`, `docs/ROADMAP.md`, `docs/SEAT-LIFECYCLE.md`. Stage explicit paths only.

## LATEST — 2026-10-16 fourth pass (delegate): impl recovered; P3 Runbooks applied

**Broker:** stopped pid 14536 cleanly (`EXIT pid=14536 reason=stop` at `20:03:12Z`, after a long `lead`
drain) and restarted as **pid 32276** at `20:06:55Z` (`scripts/serve-noroot.ps1`; logs
`.spike/serve.{out,err}` and `selfdev.sqlite.broker.log`).

**Constitution:** `up rig.selfdev.json --refresh --no-serve` applied **P3 Runbooks**; doc 28 now carries
`prepare_workspace`, `P3 Language`, and `P3 Runbooks` (verified with `scripts/read-constitution.mjs`).

**impl recovered (the operator's ask).** impl claimed **#700** (no-secrets config guard) at 19:56:43,
wrote coherent `SECRET_VALUE_PATTERNS` / `looksLikeSecret` / `assertNoSecretsInFile` code into
`src/config.mjs`, then its run ended on a **malformed pseudo-tool-call** (`<parameter name="edit">`
arrived as text; `stopReason:"stop"`) at ~20:01, leaving the item incomplete. **Cause, corrected from
this session's first draft (which claimed it "skipped" `prepare_workspace`):** in the pre-malformed run
there is no `prepare_workspace` call after `claim_work #700` (entry `34390`) — but the shared-tree write
is a **tool-path resolution defect**, because on the later attempt `prepare_workspace(700)` itself FAILED
(`npm ci --prefer-offline failed`, entry `34577`) while the worktree still existed (entry `34585`,
`item-700` at `f802d5f`), and the edit had landed in BOTH main and `item-700` (entries `34591`–`34595`).
Recovery: backed up the
tree (`.spike/delegate/impl-recovery-20261016-200534/`: `tracked.patch`, `init.test.mjs`), then spooled a
steer via `intent.mjs` (`.spike/delegate/intent-impl-resume-700.txt`) = call `prepare_workspace(700)`
FIRST, re-apply the guard inside `item-700`, revert the shared-tree block with the edit tool (never
`git restore`), write the failing-first demo, verify, commit #700; then #806. impl re-woke (lease
`seat:impl` from `20:07:37Z`) and is generating. **Do not poll; hand back.**

**Two defects found this session (feed item 69 / item 66):**
1. **`serve --stop` returned `stopped:true` while pid 14536 was still alive** in its final F11 drain.
   `runWakeLoop` clears the heartbeat interval *before* `await harness.waitForIdle`, so `brokerAlive`
   reads stale, `cmdStopBroker` clears `broker.json`, and the stop reports success. **Never trust
   `stopped:true` alone — confirm no `cli.mjs serve` process remains** (the runbook already requires this).
2. **A spooled inbox intent drains only when a pass runs**, and passes fire only on wake-relevant store
   commits; the operator's runbook intent (`requestId c9557fe6…`) sat from 19:49 to 19:56 until an
   unrelated commit. Item 66's "drain each pass" is incomplete — a spooled operator intent should force
   a pass rather than wait for one.

**Gate unchanged:** `cli.mjs` is still dirty (cmdInit C9/C10 + untracked `demo/init.test.mjs`) and
`src/seatguard.mjs` + `demo/seatguard.test.mjs` are dirty in main; **items 69/78 remain blocked on
`cli.mjs`**. The main-tree seatguard copy is **NOT** the committed #802 work: `git diff 0102f3c --
src/seatguard.mjs` is `+11/−89` (and impl's own entry `34305` calls it "an earlier/alternate copy"
lacking the async `absoluteSeatPath`/`seatGraphRoot` work), so it is a **divergent draft** — establish its
provenance before treating it as in-flight. (This session's first draft wrongly called it a stale
duplicate of `0102f3c`; that was inferred, not checked.)

**The `cli.mjs` gate is #624's complete-but-UNCOMMITTED artifact (checked 2026-10-16).** The working-tree
`cmdInit` is the #624 "INIT META-DEFAULTS" implementation; `node --check cli.mjs` is clean and
`demo/init.test.mjs` exits 0 (`INIT TEST PASS`), and queue row **#624 is `done`** — but `cmdInit` appears
in **no commit**: `git log --all -S "async function cmdInit"` and `-S cmdInit` both return nothing, and no
`item-*` worktree's `HEAD:cli.mjs` contains it. So the gate is a **landing/ownership decision** (commit
`cli.mjs` + `demo/init.test.mjs`, explicit paths only), not unfinished code. `NEXT.md` reserved it to the
owner or an operator ruling; do not `git add` another item's artifact without one.

**Runbook work is now registered and in flight (pm delivered the operator intent):** **#819 → scribe**
(seat-lifecycle + environment narrative — CLAIMED and being written; the operator's request this session,
after a prior check showed no such doc exists); **#814 → impl** (runbook check rules 81/82/86, reuses item
46's machinery); **#815 → impl** (`--dry-run` 84); **#816 → qa** (executable Diagnose blocks 85, held until
81/82 land); **#817 → lead** (delegate-owned 87/88, deferred). Clean-path NEXT items 81/85/86 are therefore
no longer "available now" — they are queued.

**Recurring `impl` stall — malformed tool call emitted AS TEXT (root cause, 2026-10-16 evening).** impl
stalled the same way twice: the turn ends with `stopReason:"stop"`, `hasToolCall:false`, and the tool
call written into the CONTENT as `<parameter name="powershell">…` (entries `34844`, `34898`; earlier
`34495`). The harness reads that as a normal completed turn — no rejected call, no error — so
`countMalformedToolCalls` (`src/attention.mjs`, which matches only the harness marker
`[error] Validation failed for tool "`) and the D64 degeneration guard never fire, and the
`malformed-tool-call` metric stays 0 (its own documented blind spot). impl's model is
`deepseek-ai/DeepSeek-V4.1-Flash` (deepinfra, `api: openai-completions`). **Fix LANDED (`f086382` +
`c38815f`, D77):**
durian-pi now detects a tool call emitted as text (`isPseudoToolCallTurn`/`countPseudoToolCalls` in
`src/attention.mjs`; `assessRun` trips on the FIRST one) and the supervisor resets the seat with a handoff
naming the fault — NO translation layer (a synthesized half-parsed call would execute without the model's
validation). **Grounding trap:** the terminal strips the DSML special-token delimiter, so a screen read of
the entry shows a clean `<parameter>` block and HIDES the fault; the detector reads the stored bytes
(the U+FF5C `DSML` delimiter, or the plain nested `<parameter>` pair). The operator keeps the model.
**Still open:** (c) auto re-drive — **DONE for the reset path (`7d62929`)**: a reset clears that
seat's cooldown and marks the scheduler dirty, so the next pass re-wakes it (verified live: impl
reset at `20:35:20Z`, and after the restart its re-drive fix produced a `generation_in_flight` impl at
`20:40:48Z`). (d) the GENERAL revisit — a seat suppressed by the per-seat cooldown after a NORMAL
settle still waits for an unrelated commit (runs usually outlast the 30 s cooldown, so it is rare);
surfaced by the broker sitting idle `20:14:13Z → 20:19:54Z` while impl had queued work. Recovery used
both times: spool a corrective steer via `intent.mjs` (latest
`.spike/delegate/intent-impl-finish-700-v2.txt`); impl re-woke to finish #700 (commit `28c7ba5`).

**Full-suite result after the D77 fix (2026-10-16):** `demo/*.test.mjs` = **94 pass / 3 fail**;
`npm run test:tui` = **14/14**; `npm run demo` = **PASS**. The 3 failures are **pre-existing
constitution drift, NOT this session's diff**: `constitution.txt` carries `P3 Language` (`a0ab993`) and
`P3 Runbooks` (`fe0c74c`) but `rig.starter.json`'s `constitutionInline` carries neither, so
`demo/commit-model.test.mjs`, `demo/seat-commit-instructions.test.mjs`, and `demo/starter.test.mjs` fail
their starter-inline `=== constitution.txt` assertion (deterministic on re-run; none of those files is in
the session diff). Fix: sync `rig.starter.json`'s inline copy with `constitution.txt` (a constitution-drift
item-75/80 case) — route to the constitution's owner.

## NEXT SESSION — START HERE

**STATE.** Five clean-path items **DONE**: 54, 65, 66, 68, 73 (commits `58cbac2`, `6fae68d`+`559f967`,
`47507f1`, `037213f`, `243f175`). The runbook set is started (`docs/runbooks/`) and the research folded
(items 74–88 registered). **THE GATE IS `cli.mjs`:** it is dirty with **two seats' in-flight work** —
`cmdInit` (`cli.mjs` + untracked `demo/init.test.mjs`) and a `seatguard` change (`src/seatguard.mjs` +
`demo/seatguard.test.mjs`). Until those land, items **69/70/71/74/78** cannot be edited or committed
cleanly.

**CURRENT ITEM → NEXT ACTION.** Highest priority: **item 69 — hard write guard on every write verb** (make
"never proceed on a false `stopped` signal" code, not prose; the research report's #1 fix and the cause of
**two** store corruptions on 2026-10-16). Then **item 78** (broker crash forensics / survive a
conversation storage error). Both are **blocked on `cli.mjs`**. Anchors: item 65 = **#745**, item 66 =
**#728**; items 69–78 are **pending `pm` registration**.
**Clean-path work available NOW (no `cli.mjs`):** **item 85** (run each runbook's read-only `Diagnose`
block in CI — the set is currently unverified), **item 81** (`runbook-stale`/`runbook-unverified` `check`
rules), **item 86** (runbook verification in the `check` provenance line) — `src/checkup.mjs` + `demo/` only.
**Exact next command:** `DURIAN_PI_DB=./selfdev.sqlite node cli.mjs status`.

**Maintenance done (`806ce7f`):** broker stopped → `up rig.selfdev.json --refresh` → restarted
(`pid 14536`, `START 2026-10-16T19:33:43Z`). `impl` is now `deepseek-ai/DeepSeek-V4.1-Flash`, and the
constitution (`durig.constitution` doc 28) now carries **`prepare_workspace`** and **`P3 Language`**.
The root cause was constitution **drift**: `rig.selfdev.json` set `constitutionInline`, which
`cmdUp` prefers over `constitution.txt`, so the file edit never applied; the rig now sources
`constitution.txt` (single source). **New ROADMAP items 74–80** capture the recurrences.
**Second-writer mistake (again):** `serve --stop` returned `stopped:false` and I ran `up --refresh`
anyway, corrupting impl's `pi.live` (doc 12105); recovered from `store-backup-20261016-143336` +
`.spike/delegate/repair-live.mjs`. It reinforces items **69** (hard write guard, incl. `serve --stop`
exit confirmation) and **78** (crash forensics).

**Runbooks — research reviewed and folded (`<pending>`):** `docs/reviews/runbooks-sop-best-practices.md`
(the operator's research agent) found our conventions already match published practice; the gap is
**machinery**, not prose. Actions taken: ROADMAP items **81–88** (stale/unverified `check` rules,
mandatory front-matter, the hard write guard = item 69, `--dry-run`, executable `Diagnose`, provenance,
capability-gated agent runtime, the daemon runbook); `docs/runbooks/README.md` now carries the
front-matter, maintenance policy, agent-execution guardrails and anti-patterns; added
`_template.md`, `daemon-not-running.md`, `research-request.md`; and **P3 Runbooks** was added to
`constitution.txt` (applies on `up --refresh`). A request to author/maintain runbooks for its recent
work was spooled to `pm` via the broker inbox. The set is **unverified** where a `Verify` step has not run.
- **Item 68 DONE (`037213f`):** `reconcileStrandedSubmissions` settles a `placed` submission with no live
task before the pending set is built, so the blocked seat re-wakes. Verified live: `STRANDED settled=2`
→ `WAKE qa`, `WAKE lead`. `demo/broker-strand.test.mjs` (RED: symbol absent at HEAD).
- **Item 54 DONE (`58cbac2`):** `drivePass` takes `waitForWakes`; `runWakeLoop` passes `false` and drains
once on loop exit (F11). Fixes the loop park that made `serve --stop` hang. `demo/broker-wake-return.test.mjs`
(RED: HEAD takes 4014ms; GREEN ~0.2s).
- **Item 66 DONE (`47507f1`):** every inbox intent carries a `requestId` (so a crash between submit and
unlink re-drains idempotently), and the broker reconciles dead `genlock.*` leases at start (ESRCH only;
EPERM holders kept) and logs `RECONCILE leases=N`. `demo/broker-reconcile.test.mjs`. The orphaned-worktree
sweep is split to **item 73** — `removeClaimedWorktree` force-rm's a dirty tree, so a sweep needs a
clean-only guard first.
- **Item 73 DONE (`243f175`):** `removeClaimedWorktree` refuses a dirty worktree without `force` (D60;
fixes a latent `rm -rf` data-loss path), and the broker sweeps orphaned `item-*` worktrees at start
(clean removed; dirty reported and kept). `demo/broker-worktree-sweep.test.mjs` (RED before).
- **Item 65 DONE (`6fae68d`, `559f967`):** lease renewal + a 660 s staleness (above the 600 s stream
timeout), an EPERM-safe `holderAlive`, and heartbeat-based broker identity so a reused pid is not the
broker. The operator view and the acquire path now share `slotIsStale`. `demo/genlock-hardening.test.mjs`
(RED before).
- **Next:** clean-path items are exhausted; items **69–71** need `cli.mjs` (dirty/blocked). The command
spool (71) is the durable-plan unlock.
**Language:** the `P3 Language` constitution rule (`a0ab993`) covers all seats once the constitution is
re-applied (`up --refresh`); immediate English directives were spooled to `impl` and `qa` via the inbox.
**⛔ Gate — `cli.mjs`:** dirty with two seats' in-flight work (`cmdInit`: `cli.mjs` + `demo/init.test.mjs`;
`seatguard`: `src/seatguard.mjs` + `demo/seatguard.test.mjs`). **Do not commit those** (not this seat's
work). Resolve/land them (their owners, or an operator ruling) before items 69/70/71/74/78.
**Broker:** running `pid 14536` (`START 2026-10-16T19:33:43Z`); `.broker.json` carries `runToken` +
`heartbeatAt` (item 65 identity). Start a down broker with
`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/serve-noroot.ps1` (never set
`DURIAN_PI_SEAT_ROOT`). **Nothing restarts a dead broker — the supervision gap is items 61–64.** A broker that
died on a storage error stalled `impl` (2026-10-16); `resume` + restart recovered it.
**Pending apply — one broker stop + `up --refresh`:** the **`P3 Runbooks`** rule in `constitution.txt`
(`fe0c74c`) is not yet live for seats (the `P3 Language` rule and the impl→DeepSeek model were applied at
`806ce7f`). ⚠️ On `serve --stop`, proceed **only** on `"stopped": true` — never `false`; that is how the
store was corrupted twice. See `docs/runbooks/broker-safe-change.md`.
**Owed:** wire `reconcileStrandedSubmissions` into `cli.mjs cmdResume` (blocked on `cli.mjs`).
**Exact next command:** `DURIAN_PI_DB=./selfdev.sqlite node cli.mjs status`; restart a down broker with
`scripts/serve-noroot.ps1`. Design of record: `docs/BROKER-SUPERVISION.md` (D71/D72),
`docs/COMMANDS-AND-THE-BROKER.md` (command paths + mailbox).

**INCIDENT (2026-10-16, delegate) — a second writer crashed the broker and corrupted two run-control
docs.** 🚨 Do **not** run `resume`/`doctor` (or any write verb) while the broker is running: they are
write-side and **ignore `--help`** (they execute!). `node cli.mjs resume --help` against the live broker
was a second writer; it crashed the broker (`Task 30658 is already terminal` in `serve.err`) and left
the `pi.live` documents for qa (doc 16) and lead (doc 22) corrupt (`unresolvable path:
["generation","message","content",0]` — a mid-stream `generation` reset orphaned later appends). That
wedged **every** write-side open: the F12 guard reads each seat's persisted cwd and one bad read kills
the pi-durable session (`SessionFailed`), so `serve`/`run`/`send` all died.
**Recovery (all under `.spike/`, gitignored — no repo code changed):** backed up the store
(`.spike/delegate/store-backup-20261016-121820/`); killed 11 stale 1–2-day-old `log --follow`/`watch`
viewers; reset docs 16/22 to the clean empty-base state (`.spike/delegate/repair-live.mjs`, 69+52
deltas dropped); verified all 10 `pi.live` materialize and all 9 seat agents read in one session; ran
`resume`; restarted the broker. **If it recurs, restore the backup or re-run `repair-live.mjs`.**

**RESIDUAL DEFECT (open; needs a code fix, not store surgery):** qa (conv 15 #30661) and lead (conv 21
#30674) have a submission **stuck `placed` while its run task is already `terminal`** — a finished run
that never settled its submission. `resume` reports `run-cancelled` but does not settle it, so
`selectWakes` skips those conversations forever (`admitted_not_started` persists). Fix candidate: on
start / in `resume`, settle any `placed`/`queued` submission whose task is terminal (folds into ROADMAP
37(b) / item 66). qa owning the chaos suite (#727) is therefore not yet running.

**Seat-root trap (do not repeat):** start the selfdev broker **without `DURIAN_PI_SEAT_ROOT`** — a seat's
own prepared cwd wins (`src/seattools.mjs` `makeSeatEnv`), so a single global root conflicts with the
per-item worktree model and trips the F12 guard. Use `scripts/serve-noroot.ps1`.

**Do not poll** the running broker — the operator notifies the delegate when runs complete.

**Active queue:** current — claimed #658 (impl) and #727 (qa); queued #660/#662/#663/#665/#673/#674/
#676/#696/#700/#702/#705/#710/#713–#715/#718/#719/#723–#725/#728. All ancient rows (#60–#172) remain
`deferred` (parked on questions, not claimable). After the restart, pm/impl/advocate/scribe were woken
and progressing (advocate generating; impl working `demo/tui-client.test.mjs`).

**Exact next command (read-only):** `DURIAN_PI_DB=./selfdev.sqlite node cli.mjs status`; broker log is
`selfdev.sqlite.broker.log`. Restart a down broker with `.spike/delegate/dispatch-serve-noroot.ps1`
(never set `DURIAN_PI_SEAT_ROOT`) once no writer is in flight.

**Delegate clock-out this session (2026-10-16, second pass):** operational + incident recovery, no repo
code changed (the `.spike/` repair scripts are gitignored). Committed only `docs/NEXT.md`. Added
`docs/COMMANDS-AND-THE-BROKER.md` (new-maintainer command-path map: every read/write path, why one
owner, and where the daemon/mailbox fit; recommends logging the broker's start source). Tree still
holds other items' files (`cli.mjs`, `docs/DECISIONS.md`, `docs/FEATURES.md`, `docs/STATUS.md`,
`docs/WORKFLOWS.md`, `demo/init.test.mjs`) — untouched. No push.

**Queue work running alongside:** **#662** (TUI C4 close-out — 48-col golden + lifecycle cleanup,
queued to `impl`) and **#710** (the `src/tui/driver.mjs` comment fix, queued to `impl`). ROADMAP item
54's own queue id is pending `pm` registration of the 51–58 batch.

**Landed this session (2026-10-16, delegate):** H3 DECSET 2026 synchronized output (`40f454b`); H4
grapheme-cell width, `src/textwidth.mjs` (`09e6d8d`); the TUI testing framework — shared fixtures + a
cell `ScreenBuffer` + 8 golden frames incl. the 48-col floor, `demo/tui-suite.mjs` (`aea7e74`;
`npm run test:tui` now **14/14**); B1+H5 — the type-to-seat input line (`i`, Enter → `writeIntent`,
Esc/Ctrl+C) with bracketed paste (`9af85d0`); and docs — `docs/BROKER-ARCHITECTURE.md`,
`docs/PI-DURABLE-INTEGRATION.md`, the two research reports, and the roadmap backlog items **45–59**.
The test harness immediately found a real bug (the conversation header overflowed 48 columns) — fixed
and frozen in a golden.

**Broker (diagnosed):** the resident broker (pid 34440) was parked ~15 minutes on a degenerate `qa` run
(`PASS 185` → `PASS 186`); `PASS 186` then delivered the `advocate`+`scribe` intents
(`INTENT delivered=2 dead=0`). Two `pm` intents are **spooled, not yet delivered** (registration for
the ownership items 45–50 and the doc-site item 59). The diagnosis and the fix are item 54.

**Open rulings:** the security position (55); the D11/Level-2 ruling for the TUI attach (52); and TUI
plan §D-G1–G4 (prose-measure cap, alt-screen receipts, D69/D61 supersession). `pm` registers/sequences
backlog 52–59 — the delegate does not route queue items.

**Blockers / owed:** (a) the `docs/DECISIONS.md` alignment entry is **owed** but editing it is blocked
because `DECISIONS.md` is dirty with **another item's** edit (the D61 citation correction) and staging
the file would carry that work — leave it to that item's owner. (b) The working tree holds other items'
files (`cli.mjs`, `docs/DECISIONS.md`, `docs/FEATURES.md`, `docs/STATUS.md`, `demo/init.test.mjs`) —
**do not discard**.

**Exact next command:** `DURIAN_PI_DB=./selfdev.sqlite node cli.mjs status`; run the hermetic TUI
regression with `npm run test:tui`. If the broker is stopped, restart it with
`DURIAN_PI_DB=./selfdev.sqlite node cli.mjs serve` once no writer is in flight.

**State at this refresh (2026-10-16, delegate session, paused):** store is single-writer; the broker is
the owner; `vendor/eval/` (reference clones) and `vendor/pi-main/` are gitignored.

**.

**Test flakiness under a live broker — finding + mitigations (2026-10-16):** running
`demo/*.test.mjs` while the broker drives gave **71/78**; re-running the 8 failures individually gave
**7 pass** (flaky) + `config.test.mjs` (a legit #621 failing-first RED). Grounded causes and fixes:
- **Inherited repo config**: demos spawn `cli.mjs` with `{...process.env}` and so pick up the local
  `durian-pi.config.json` (`DURIAN_PI_MAX_CONCURRENT_SEATS: 4`, a real provider/model, and — the worst part —
  `DURIAN_PI_DB` pointed at a DIFFERENT project's store,
  store, so a demo that forgets to override `DURIAN_PI_DB` reads the wrong database — this is the live
  `no seats in …` error seen in impl's log). Fix: a hermetic test env (temp `DURIAN_PI_DB`,
  `DURIAN_PI_MAX_CONCURRENT_SEATS=1`, `DURIAN_PI_PROVIDER=faux`, and do not read the repo config).
- **Live working tree**: tests `copyFileSync("rig.starter.json", …)` and read other tracked files a seat
  is mid-editing. Fix: read fixtures from HEAD (`git show HEAD:<path>`) or run the suite from a frozen
  worktree.
- **Fixed-timeout waits**: several demos `setTimeout(…, 5–10s)`; under CPU load the wait fires early.
  Fix: poll-until-condition with a generous deadline.
- **Resource contention**: concurrent `serve`/sqlite/temp-dir churn. Fix: run the suite **with the broker
  stopped** (or in a per-task worktree) via a single `npm test` runner that isolates the env and retries
  a timeout-flake once.

Known blockers: none for the delegate work. The shared tree is dirty with #623's in-flight `cli.mjs`
and a seat's `docs/STATUS.md` edit — **DO NOT discard**; stage explicit paths only. The resident
broker is **stopped** (it exited `reason=stop` after the delegate session); restart it with
`DURIAN_PI_DB=./selfdev.sqlite node cli.mjs serve` once no `send`/`run` writer is in flight (the advocate
consult is one). **Docs landed:** D63/D64 (`0ecf9cf`), D65 (`b81e171`), D66 (this session).

_Historical (superseded): the #480-era notes below were written for the 2026-10-15 handoff._

**Future work (candidate items — not yet queued):**
- **TUI app implementation plan** — the operator-approved plan of record is
  `docs/TUI-IMPLEMENTATION-PLAN.md`. Its §C hardening items H1–H5 (sanitise untrusted text at every
  render boundary; synchronous restore on abnormal exit; DECSET 2026; grapheme/EAW-correct width;
  bracketed paste with the input line) carry the D70 posture and await `pm` registration. §D holds the
  open rulings (prose-measure cap, alt-screen receipts/search/copy/plain, D69/D61 supersession).
  Recorded facts: `ui.mjs` declares `pi-tui` but imports it nowhere, and the conversation scroll
  window is capped to the 24-entry page (`SCAN_LIMIT`).
- **TUI hardening (D70, operator-approved — folded into the plan above):** sanitise untrusted text at
  the render boundary; synchronous restore on `uncaughtException`/`unhandledRejection`/`exit`;
  DECSET 2026 around `paintScreen`; grapheme/EAW-correct width. Bracketed paste (DECSET 2004) is
  required by the type-to-seat input line, not optional polish.
- **Agent ownership (from `docs/reviews/Agent_Ownership_Review.md`)** — action items 45–50 in
  `docs/ROADMAP.md` §“Agent ownership and accountability”. Verdict: no RACI/DACI/RAPID/MOCHA; keep
  artifact-keyed ownership but make it `check`-enforced (item 46, `src/checkup.mjs`); record the
  no-RACI decision (item 45, advocate); verification must **re-execute evidence** (item 48); finish the
  review's governance/cost passes (item 49). Surface decision (item 47) is already routed to
  advocate/scribe. Awaiting `pm` sequencing.
- **pi-durable alignment (research landed; items 51–58)** — `docs/reviews/pi-durable-alignment.md` is
  complete and its verdict is folded into `docs/ROADMAP.md` §“pi-durable alignment”. durian-pi reimplements
  exactly two things the harness already provides: **client state** (the TUI poller → item 52, adopt,
  gated by the socket security position in item 55) and **busy-input** (`whenBusy:"steer"` → item 56).
  The rank-1 change is **wake-and-return in `drivePass`** (item 54). The review's explicit keep-list is
  recorded. **How-we-build doc for maintainers and upstream: `docs/PI-DURABLE-INTEGRATION.md`.**
  Awaiting `pm` sequencing.
- **Public doc site (item 59)** — `scribe` builds a GitHub Pages static site with a landing page,
  end-user pages, and maintainer pages, projecting from `docs/` (no duplication); the framework is an
  open decision. Depends on item 22 (the public repo). Awaiting `pm` sequencing.
- **Zero trust to zero agent (research requested 2026-10-16; ROADMAP item 60)** — narrow,
  per-seat / per-item least-privilege permissions for durian-pi's seats. Owner: operator's research agent;
  report at `docs/reviews/zero-trust-zero-agent.md`; depends on item 55 (a `security.sec` position)
  before any new trust boundary. An operator intent to `pm` to register/sequence item 60 is **spooled
  in `selfdev.sqlite.broker.inbox/`** (pending the next broker pass), alongside the two earlier pm
  intents.
- **Broker supervision / host daemon (design recorded 2026-10-16; refined after round 3; ROADMAP items
  61–67; D71)** — `docs/BROKER-SUPERVISION.md` is the design of record: a per-user agent (Windows Task /
  macOS LaunchAgent / `systemd --user`) by default, or a system daemon opt-in (Windows Service /
  LaunchDaemon / systemd system unit), hosting a **portable** thin **`src/host.mjs`** (never opens the
  store) that supervises the sole-writer broker — exit-code taxonomy, a durable `<db>.broker.down` marker
  distinct from the existing `.broker.stop`, liveness/progress heartbeats (sleep is a resume-gap, not a
  clock), and a per-platform kill-tree primitive (Job Object vs POSIX process group). Only the trigger
  file, the kill primitive, and the stop signal are OS-specific — the host is identical on Windows,
  macOS, and Linux distros.
  Sequenced **after item 54** — and **item 54 is NOT done** (the scoped D65 wait still awaits the woken
  runs; wake-and-return is pending). Item **65** is a live single-writer hazard (genlock age-steals a
  live long generation, swallows `EPERM`, trusts reused pids) and should land regardless. Per-user agent vs system daemon is an
  operator ruling. Registered, not scheduled — awaiting `pm` sequencing.
- **Broker intent-inbox** — deliver intent to a seat WITHOUT stopping the broker (a file the broker
drains each pass, sibling to `.broker.stop`). Today `cmdSend` has no broker guard, so routing needs a
`serve --stop`, which interrupts in-flight work.
- **Reset at WORK-ITEM boundaries only** (deferred mitigation 3): clear a seat's context when it
finishes a work item — explicitly NOT finer item boundaries yet.
- **Mid-run cut** (optional): the degeneration guard resets BETWEEN runs; a provider-level turn cap
would cut a single runaway run mid-flight. (Bounded runs are mitigated; this is the residual gap.)
- **Worktree leak + recursion (NEW, observed 2026-10-16):** the broker's per-task worktrees
  (`item-1/`, `item-2/` in the repo root) are **not gitignored** and **not cleaned up**, so they
  pollute `git status`; and because the #506 fix “forks the visible state”, each new worktree
  **copies the existing untracked worktrees** (`item-2` nests a full `item-1/`) — recursive growth.
  Needs a lifecycle fix (ignore the worktree root + clean up on completion).
- **`docs/DECISIONS.md` entries** — LANDED (`0ecf9cf`): D63 (broker audit) + D64 (degeneration guard),
  plus the seat's stranded D54–D62. Remaining: fix D62's text corruption (`headless \tenderTui/Frame`).

## LANDED — broker liveness: re-wake per seat, not after the slowest run (delegate-owned; D65)

**Status: DONE.** `src/broker.mjs` `drivePass` waits only on the conversations a pass woke, races
that against the loop's commit signal, and `runWakeLoop` drains globally once on exit (F11);
`createWakeSignal` gained `race(promise)`; `PASS <n> ms=<dur> woke=<a,b>` is logged. Proof:
`demo/broker-liveness.test.mjs` (RED: 1 fast wake in 2 s → GREEN: 2nd wake ~27 ms in while the other
seat still generates). Commit `b81e171`. The narrative plan below is kept as the record of WHY.

**Why delegate-owned:** the fix is to the process that DRIVES the queue (the broker). A routed item
would sit behind the very broker it is meant to fix, so it must be done in the delegate seat directly
(code + tests + commit), then handed to the operator. The operator explicitly preferred this over the
durian-pi team for that reason.

### Symptom (observed 2026-10-16, pid 17424)
`<db>.broker.log`: `PASS 5` at `02:26:13`, its wakes fired, then **no `PASS 6` for 40+ min** (still
none at `03:10`). Measured pass intervals for this broker: 20.5, 20.3, 4.5, 27 min. Meanwhile `status`
showed **pm idle with 9 queued DONE-notices** and **qa idle with 2 queued artifacts**
(`idle_with_queued_work`), and a generation was live (genlock `scribe` since `03:10:05`). So seats with
queued work sat idle while a run was in flight.

### Root cause — what is VERIFIED vs INFERRED
**Verified (code + vendored contract):**
- `src/broker.mjs:146` (`drivePass`) calls `await harness.waitForIdle(context)` — the HARNESS method.
- Its contract (`node_modules/@earendil-works/pi-durable/dist/harness/types.d.ts:668-669`):
  > `Harness.waitForIdle` — “Resolve when the ordinary ownership scope of **every** ownerless
  > conversation has no live non-background task.”

  (A per-conversation wait exists too: `Conversation.waitForIdle`, line 87.)
- Therefore every pass blocks until **all** ownerless conversations are idle. And `src/scheduler.mjs`
  treats a submission settling as wake-relevant (“a submission settling … is exactly when a stalled
  claim becomes wakeable again”) — so the loop cannot act on that per-submission intent while parked in
  the global wait.
- **Code path (the decisive one):** `src/broker.mjs:258-274` does `await drivePass(...)` and THEN
  `passes++; logBrokerLine(dbPath, \`PASS ${passes}\`)`. So `PASS` is written **only after `drivePass`
  returns**, and `drivePass` returns **only after line 146's `harness.waitForIdle` resolves**, which is
  only when **every** ownerless conversation is idle. Consequence (a code-path FACT, not an inference):
  **no pass boundary — and therefore no next wake of ANY seat — until every in-flight run settles**; a
  seat that finished early is not re-woken until the slowest run finishes.

**UNVERIFIED (relative contribution):** how much of the 20–44-min pass time is this wait versus the
pass TAIL (`worktreeClaimed` cleanup, `supervise`). There is **no per-pass duration instrumentation**
(`grep -n 'Date.now() - |durationMs' src/broker.mjs` → none), so the split cannot be isolated without
adding it (the Observability step below) or a controlled experiment — and a controlled experiment is
blocked by the single-writer rule plus the running broker. **The mechanism is code-verified; only the
proportion is not.**

### The tool that exists to fix it
`Scheduler.waitForIdle(conversationId | undefined, context)` and `Conversation.waitForIdle(context)`
wait for **one** conversation (`harness/scheduler.d.ts:86`, `harness/types.d.ts:669`). The loop can
wait per-WOKEN-seat and re-wake others as they settle.

### The fix (chosen direction)
1. In `drivePass`, replace the single global `await harness.waitForIdle(context)` with a wait that
   settles when every conversation **this pass woke** is idle (track the woken conversation ids; wait
   on those only — do NOT wait on conversations this pass did not wake). A settle that the commit
   subscription raises should be able to end the wait early so the next pass starts promptly.
2. Preserve the F11 invariant that actually matters: **never close the harness with a live run**
   (keep it open while ANY run is in flight), rather than “wait for global idle”.
3. Leave the scheduler floor (`minIntervalMs = 500`) and per-seat cooldown
   (`SERVE_SEAT_COOLDOWN_MS = 30_000`) as-is; optionally lower the cooldown once passes are short.
4. Keep the per-pass `supervise`, but it must not gate the wake path.

### Observability (part of the fix)
- Log each pass with its DURATION and the seats it woke: `PASS <n> ms=<dur> woke=<a,b,c>`.
- Add a liveness notice/measure: “seat has queued work and **no live generation lease** for > N s” —
distinct from the existing `idle_with_queued_work`, which cannot tell “waiting for the pass” from
“wedged”. Surface in `status` and as a `check` rule.

### Tests (failing-first)
- **New `demo/broker-liveness.test.mjs`:** two seats; make one run long (faux provider with a delay /
  multi-turn script), give the other queued work; assert the second seat's wake appears in the broker
  log within a bound (≈5 s) **while the first is still running**. RED against the current
  global-`waitForIdle` broker; GREEN after the fix.
- Keep `broker.test.mjs`, `broker-max-duration`, `broker-cooperative-stop`, `broker-wakepath`,
  `broker-log`, `autostart` green; `node --check` clean; whole `demo/*.test.mjs` suite green.

### Acceptance
- A long run on one seat does NOT delay waking another seat with queued work (proven by the demo).
- Pass duration ≈ the pass's own work, not the longest run.
- Never closes the harness with a live run (no stranded submissions).
- `stop` / `serve --stop` / `--max-duration` semantics unchanged.

### Constraints / gotchas
- **Restart the broker to test the fix** — editing source does not affect the running process.
- Single-writer: only one `serve`/`run`/`send` at a time on `./selfdev.sqlite`.
- The tree may hold in-flight seat work (#623 etc.) — **stage explicit paths only**, never `git add -A`.
- Native Windows only; never push/publish.
- Related, lower priority: the **broker intent-inbox** (below) would let a delegate deliver intent
  without a `serve --stop`; and the worktree-leak defect (below) shares the same pass lifecycle.

**Earlier this session: `pi-rebase` recovery (C) re-verified COMPLETE — no action taken.**
Evidence: `git diff --diff-filter=A main origin/pi-rebase -- . ':(exclude).spike'` is empty (no
tracked file on the snapshot is absent from `main`); `demo/pitui.test.mjs` is present on `main`;
the local branch is already deleted; `docs/BRANCH-AUDIT-2026-10-14.md` records the recovery as
executed. Do NOT re-apply the snapshot (D48: adapt onto `main`, never restore a whole snapshot).

**Then (next queued item): #480 (U1) — build the `durian-pi ui` driver (queue id #480; TOP PRIORITY; UNBLOCKED).**
The rest of the interactive-client series is **#481–#487 (U2–U7)**. U1 is the missing piece between
`src/tui/client.mjs` (a headless renderer) and the operator: a separate entrypoint that owns raw mode
+ key handling + the poll loop and paints `renderTui` frames (`cli.mjs` stays non-interactive, D21;
read-only, D11/D40).

Exact next command (drive the selfdev team; the seat root is the live tree):

`DURIAN_PI_SEAT_ROOT=C:/Users/Alex/dsh-Projects/durian-pi DURIAN_PI_DB=./selfdev.sqlite node cli.mjs send impl --body-file <body>`

and have impl `claim_work({ itemId: 480 })` FIRST — a plain `run` makes impl take its oldest queued row
(impl has ~36). Bounded alternative: `DURIAN_PI_SEAT_ROOT=C:/Users/Alex/dsh-Projects/durian-pi DURIAN_PI_DB=./selfdev.sqlite node cli.mjs run --max-duration 300`.

Known blocker: the store is **single-writer** — never run two `send`/`run`/`serve` at once. No
genlock/broker is held at handoff.

**Session state (2026-10-15 delegate handoff — do not re-derive):**
- **#473 (worktree lifecycle wiring) DONE and qa-VERIFIED.** qa's #477 verdict = PASS (68/68,
  `node --check` clean). qa's caveats: the demo does NOT exercise the live `drivePass` claim path
  (reviewed only), and 5 pre-existing silent-return catches remain (`src/broker.mjs:317,375`;
  `src/worktree.mjs:104,216,394`).
- **Model swap (D51):** the five former Qwen seats (`impl`, `qa`, `advocate`, `auditor`, `designer`)
  now run `zai-org/GLM-5.3-Flash`; `rig.selfdev.json` edited + `up --refresh` applied. No context reset
  was written — the operator may `reset <seat>` the five.
- **TUI re-prioritized** by pm into **#480–#487 (U1–U7)**: U1 driver, U2 team-wide multi-pane of
  actively-generating seats (live generation state, NOT queue depth), U3 in-place tool-call block,
  U4 pi-style tool bg/fg, U5 thinking parity, U6 re-open the bogus C4 verification, U7 poll-first vs
  Level 2 to lead/operator. pm also cleared the #188/#193 deferrals (#487).
- **Lower priority, NOT registered** (operator deferred): `watch`/`seatActivity` shows green "working"
  for ANY `claimed` row, so impl's **6 stale claims (#287, #289, #290, #291, #294, #335)** read as active.
  Two-part fix: resolve those rows (impl completes/cancels; pm cancels its five; #287 is lead's), and
  make green require a live lease/in-flight submission.

Then, in order:
1. **#473** — wire worktrees into claim/completion: on claim, create the item's worktree+branch and
   point the working seat's cwd/`DURIAN_PI_SEAT_ROOT` at it; on completion, commit ONLY the item's files
   on its branch, release the lock, `git worktree remove`. **#474 is GATED on #473** — do NOT put
   "commit before finishing" into any seat's instructions until the wiring is proven, or seats will
   commit from the shared tree and stage each other's work. #475 documents the model.
2. **GROOM THE QUEUE** — it is churning: **135 non-terminal** (impl 65, pm 44, qa 15). Most are
   `DONE`-report rows pm must process and artifacts qa must verify. `peek_queue(all=true)` is now
   uncapped (#433), so pm can enumerate; use `cancel_work` (D47) for stale/duplicate rows.
3. **qa verification backlog** — #391/#393/#395/#449 (commit policy), #456/#458/#460/#462/#464/#466
   (broker + help + coordinator), #451 (TUI C3). qa's own DONE reports back to impl (#410–#448) also
   need settling.
4. **TUI** — C3 (#404) built, C4 (#405) reported "done but blocked" by qa; the corrected C4
   verification is owed. Designer UX follow-ups #437 (C6, done via #428), #439 (C7 defaults),
   #440 (C8 error messages), #442 (C9 rig auto-discovery), #444 (C10 meta-defaults). Advocate #407.
5. **#400** broker wake-path verification; **#402** #148 half-2 seam (cmdUp --refresh); **#415**
   verify the concurrency statement against code.
6. **Docs gate items #390/#398/#401/#468–#471** — much of this was written by the delegate this
   session (FEATURES/STATUS/SELFDEV), but the items are still open; have scribe verify and close them
   rather than redo the work. `scribe` is `last_run_failed` (wedged on #468) — `reset scribe` first.

## What landed this session (all LOCAL — unpushed; operator holds push)

`main` is at the handoff commit; the six code/doc commits through **`ddd9c49`** are now on
**`origin/main`** (pushed externally — NOT by the delegate), and only the handoff commit is local.
Tree clean, suite **68/68**.

| Commit | Content |
|---|---|
| `80ac4d5` | **#330 Phase 2** — per-task worktree lifecycle + Windows Job-Object reaping |
| `5b21763` | **#384–#386/D50** — developer commit authority; commits scoped to the item |
| `5ecddd1` | **#428–#433** — broker bounds/cooperative-stop/log/concurrent attribution; `--help`; uncapped `peek_queue` |
| `e28a653` | **TUI C3** client (`src/tui/client.mjs`) + read-layer proofs |
| `82a89f2` | **docs** truth-up (FEATURES/STATUS/DECISIONS/SELFDEV/WORKFLOWS/SELF-ADMIN/NEXT) |
| `ddd9c49` | **fix(test)** — broker demos no longer swallow cleanup errors |

Note: `git grep -n "claimWorktree" -- cli.mjs src/` returns only `src/worktree.mjs` — the wiring is
the whole point of #473.

## Pitfalls that slowed this session down (read before driving)

- **`run`/`serve --max-duration` is now a real bound (#429), but it was not** — a `--max-duration 300`
  broker ran >15 min. If you see that again, it is the defect, not your invocation.
- **`stop <seat>` aborts the run but leaves the `send` parent process alive.** `resume` finds nothing.
  After a `stop`, check for a lingering `node cli.mjs send ...` and `taskkill /F /PID` it. (Recorded
  lesson.)
- **A forced kill leaves a STALE genlock slot** (`.genlock.N`, dead pid) and the next driver may warn
  `held by pid <dead>` / `pid undefined` and stall. Check `selfdev.sqlite.genlock.*`; remove the ones
  whose pid is dead (they are lock files with no work).
- **A stop can also leave `cli.mjs serve --help`-style stray processes.** `Get-CimInstance Win32_Process`
  filtered on `cli.mjs (send|run|serve)` is the fast check.
- **Seats thrash on hard native-interop work** (the P2-6 Job Object cost ~2 h across two abort/reset
  cycles). Give a bounded instruction; if the seat ignores it, `stop` + `reset <seat> <handoff>` and
  re-scope — do not let it run.
- **The broker/driver order is oldest-first per seat.** New priority items sit behind a 60-item
  backlog, so `claim_work({itemId})` via a direct `send <seat> --body-file` is the way to prioritize;
  grooming is the structural fix.
- **Two writers, precisely.** One *store/harness* writer per DB (two `run`/`send` drivers race on the
  entry id, F24; `run`/`up` are not retried). Concurrency is `serve` + `DURIAN_PI_MAX_CONCURRENT_SEATS`.
  Per-task worktrees will make concurrent *editing* safe once #473 lands.
- **Full suite > 120 s** so a single tool call times out; loop `demo/*.test.mjs` per file with a long
  timeout, or background it. Baseline is now **68/68** (the old `starter.test.mjs` CRLF failure is FIXED).
- **`edit` needs exact indentation and line endings.** The demo tests use 2-space indent; `src/rig.mjs`
  and others are CRLF. When a match misses, run `sed -n 'A,Bp' file | cat -A` before retrying.
- **Empty `catch {}` violates "errors are not swallowed"** and the warden flags it. Reporting it
  surfaced two real bugs in the broker demos (a scoped `broker` ReferenceError and `require` in ESM).
- **Seats clean up badly:** scratch appeared as `docs/WORKFLOWS.md.tmp`, `test.log`, and
  `undefined.broker.log`. The last one is a real bug: `src/broker.mjs` `brokerLogPath(dbPath)`
  returns `` `${dbPath}.broker.log` ``, so a falsy `dbPath` writes `undefined.broker.log` (it
  regenerates on a suite run). Guard against a falsy `dbPath` (no-op or throw). `git status` before
  every commit.
- **qa sometimes marks an item done while reporting it blocked** (#336/C4). Check the result text.

## Workspace state for the next agent

- **No writer is running on `./selfdev.sqlite`** except the detached `send advocate` consult
  (`.spike/delegate/advocate-consult.*`) — do **not** start a second `serve`/`run`/`send` until it
  exits, then restart the broker with `DURIAN_PI_DB=./selfdev.sqlite node cli.mjs serve`. Two drivers on
  one store double-wake (D45/D46).
- **The tree is DIRTY with #621's in-flight work** (`cli.mjs`, `src/config.mjs`, `demo/config.test.mjs`,
  `durian-pi.config.default.json`) — **DO NOT discard**; it belongs to the claimed item. `item-1/`,`item-2/`
  are leaked worktrees (see the NEXT SESSION note).
- **Backups under `.spike/delegate/`**: `recovery-WIP.patch`, `storewrite-WIP.mjs`,
  `p2-6-scratch/` (the Job-Object attempts), `scratch-backup/` (the removed scratch), and the
  intent bodies used this session. `.spike/` is gitignored.
- **Env**: run with `DURIAN_PI_DB=./selfdev.sqlite` and `DURIAN_PI_SEAT_ROOT=C:/Users/Alex/dsh-Projects/durian-pi`.
  `durian-pi.config.json` sets `DURIAN_PI_MAX_CONCURRENT_SEATS=4` (local, gitignored) for concurrency testing.
- **Native Windows only** — never `wsl`, `docker`, `docker-compose`.

## Traps (standing — do not repeat)

- **NEVER run `git stash`/`reset`/`checkout`/`restore`/`clean` from a seat** — not with a trailing
  `;`/`&&`/`|`. The guard catches the anchored forms (#329) but the denylist is only a backstop.
- **Only a write-side process wakes seats** (`send`/`run`/`serve`); viewers never do (D11).
- **Coordinators (pm/lead) cannot read/write files** (#156) — route file tasks to a file-capable seat;
  `peek_queue(all=true)` now mitigates the enumeration half.
- **A seat can wander or degenerate** (F29) — `reset <seat> <handoff>` then re-drive.

## Where main is

`main` = **`6cfe481`** (this handoff commit); **`origin/main` = `c3a2671`** — `main` is **ahead by 30
commits**, all local (the operator holds push). Do not assume anything is pushed.
Untracked/ignored: `.spike/`, `pi-warden.md`, `vendor/`, and `item-1/`+`item-2/` (leaked worktrees —
currently NOT ignored, which is the defect).

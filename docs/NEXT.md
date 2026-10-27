# durian-pi — NEXT (current pointer)

> **Older sessions moved VERBATIM to [docs/NEXT-ARCHIVE.md](NEXT-ARCHIVE.md)** — original order, no edits.
> This file is the live pointer plus the current session: everything from the `2026-10-21T23:12Z` session back
> lives in the archive. The cut is proven by concatenation (see `docs/DECISIONS.md` D126).

## NEXT SESSION (2026-10-26T21:30Z — THE WINDOWS STORE IS NOW IN THIS WORKSPACE; THE BLOCKER IS THE PI-DURABLE SCHEMA, NOT THE PROVIDER)

**Current item:** give the restored store a reader. This workspace had **no rig at all** until this session; the
4818-row store was copied off the Windows NVMe and is byte-verified here, but this build cannot open it: installed
`@earendil-works/pi-durable` supports schema **v1**, the store is at **v2**. Bump the pi family (sanctioned way:
`node scripts/sync-pi.mjs --update`, per `pi-main.pin.json`'s own note), re-prove the suite, then the 2026-10-25
block below resumes verbatim — provider ruling, the 19 `deferred` answers, then the landing pass.

**Measured this session (all read-only except the store copy; nothing below is remembered):**

- **This checkout was a bare rig, not the rig the history block describes.** Before the copy: `selfdev.sqlite`
  118,784 B with **0 rows** in `tasks`/`entries`/`conversations`/`documents`; `cli.mjs ps` → `seats: []`; 10 refs,
  1 worktree; no `.spike/`, no `.broker.json`. `main` = `b4c86ea` — the same commit the history block's repo is on.
- **The Windows rig's tree is on the NTFS volume**, mounted read-only (`udisksctl mount -b /dev/nvme0n1p3
  --options=ro,uid=1000,gid=1000`) at `/run/media/chexxor/0094126294125A8C/Users/Alex/dsh-Projects/pi-opendurig`.
  It is at `b4c86ea7`, **42 refs** including the unlanded `item-4745…4790`, `item-3033`, `advocate-item-2630` and
  the `devtools-item-4054/4064/4083` stack, and **9 worktrees (4 `locked`, 3 `prunable`)** — so the landing debt in
  the history block is real and lives *there*, not in this clone.
- **The store copied clean.** `rsync` from the read-only mount: **437,829,632 B**, sha256
  `eca555d8fdc2ecd0e490b927596d49af6d621dcebcd00589dfee4e1180d5235c` **identical on both sides**, source had **no
  `-wal`/`-shm`/`-journal`** so the single file is complete, and `PRAGMA integrity_check` = **ok**.
  `durable_schema.version = 2`, `durable_metadata.next_id = 273959` — which matches the history block's "newest
  store entry 273958". Layout: `.spike/restore/selfdev.sqlite` (verified copy) → installed as `./selfdev.sqlite`;
  the empty local store is kept at `.spike/restore/selfdev.sqlite.linux-empty-20261026`.
- **Blocker, measured:** `DURIG_DB=./selfdev.sqlite node cli.mjs ps` → `cannot open ./selfdev.sqlite: Durable
  SQLite schema version 2 is newer than supported version 1`. `node_modules/@earendil-works/pi-durable` is 1.3.0
  and its `dist/storage/sqlite/migrations.js` returns only `[{version: 1}]`. The **published 1.4.0** (registry
  latest per `npm view`) carries `{version: 2, statements: sleepingStatus}`; the Windows tree's `pi-durable`, also
  labelled 1.3.0, **already carries version 2** — so that install is not the published 1.3.0. This is a reader
  problem, not a store defect. Do **not** "fix" it by editing `durable_schema.version` down.
- **Two substrate defects found while measuring (seat-sized; the delegate does not claim them):**
  (1) `cli.mjs check rig.selfdev.json` answers `ok:true, findings:[]` while reporting `"store":"unreadable"` — it
  launders a hard open failure into a clean verdict (this delegate read that as a pass on first contact). (2)
  `scripts/clockin.mjs:265` dies with a raw `execFileSync` stack when `cli.mjs status` returns `ok:false` — the
  one-call clock-in is dead exactly when the store is sick; it should print the error and keep going.
- **Doc drift that silently audits the wrong store:** `AGENTS.md` step 4 and `SELFDEV.md` §Running it say
  `DURIAN_PI_DB=…`, but `src/config.mjs:112,323` reads **`DURIG_DB`**; a verbatim run of the documented command
  created and audited an empty `./rig.sqlite` (deleted). `DURIG_SEAT_ROOT` is at `src/config.mjs:124`.
- **Open question for the operator (not decided here):** `AGENTS.md` mandates *native Windows only* and every
  runbook command is PowerShell-framed, but this workspace now runs on **Linux** (Fedora, btrfs, Node v24.22.1).

**Queue id:** unchanged and **currently unmeasurable** — #4354 · #4813 · #4814 · #4816 · #4817/#4818 (the
human-gated answers) and #4083/#4064/#4054 · #4747/#4750/#4815 (landing/supersession). The 2026-10-25 counts below
(4818 rows, 19 `deferred`, 0 `queued`) are store facts inside the copied store and cannot be re-read until the
schema blocker clears.

**Exact next commands:**

1. `node demo/next-pointer.test.mjs` — the pointer test; run it before anything else. This file is at the
   **200-line cap**: cut the 2026-10-25 block (line 77 down) into `docs/NEXT-ARCHIVE.md` before adding a session.
2. `grep -n "version:" node_modules/@earendil-works/pi-durable/dist/storage/sqlite/migrations.js` — if it still
   prints only `version: 1`, the store is unreadable and nothing else in this list works.
3. Ask the operator to grant the pin move, then `node scripts/sync-pi.mjs --update` (or, minimally,
   `npm install @earendil-works/pi-durable@1.4.0`), and re-run `DURIG_DB=./selfdev.sqlite node cli.mjs ps` —
   expect 12 seats instead of the schema error.
4. Re-run the suite on this tree and write the marker (`npm run test`, ≥ 480 s; `.scratch/test/all.out`); the
   digest reads it back as `last suite:`.
5. `DURIG_DB=./selfdev.sqlite node scripts/clockin.mjs > .spike/clockin.txt` (never to the terminal) and compare
   `## QUEUE` against the history block's 3748 done / 274 held / 19 deferred — if it disagrees, this copy is not
   the store the 2026-10-25 session measured. Then resume that list: provider ruling (A fund / B local), the 19
   deferred answers via `node intent.mjs pm --body-file <file>`, then `scripts/land.mjs` for the unlanded refs —
   which live in the **Windows** tree, not this clone.

**Blocker:** **pi-durable schema v2 vs v1** — this build cannot open the copied store, so there is no queue state,
no seats, no broker, and `scripts/clockin.mjs` crashes. Secondary: the 402/no-balance provider ruling and the 19
`deferred` rows carry forward from the block below, and the unlanded branches exist only on the Windows tree.
Not a blocker: the tree is clean apart from this session's docs commit and a pre-existing uncommitted dependency
relaxation (`pi-coding-agent` `1.3.0`→`^1.3.0`, `pnpm-lock.yaml`/`pnpm-workspace.yaml` untracked — not landed).

## NEXT SESSION (2026-10-25T01:52Z — THE TEAM IS STOPPED ON A PROVIDER BILL, NOT ON A RIG DEFECT)

**Current item:** unblock the model provider, then answer the 19 `deferred` rows that the supervisor parked on
the human. This is an **operator decision**, not delegate work: the rig has no queued or claimed work and no
seat can run, so no seat can be woken to do anything until the provider question is settled.

**Measured at clock-in (all read-only; nothing in this section is remembered):**

- **Every seat's last model call returned 402 no-balance.** Newest store entry 273958 (conv 86607 = `qa2`,
  `google/gemma-4-31B-it`): `"stopReason":"error"`, `"errorMessage":"402: {\"message\":\"You need positive
balance to do inference…\"}"`, `timestamp 1792811531525` = **2026-10-24T03:12:11.5Z**, all token counts 0.
  `cli.mjs status` `attention` (21 rows) reports `repeated_failure` ("5 consecutive failed runs; the
  supervisor escalates it to the human") **plus** `last_run_failed: model_error: 402 …` for `pm`, `impl`,
  `qa`, `lead`, `devtools`, `auditor`, `security`, `qa2`. `.spike/serve.err` ends with 12
  `"supervisor":"escalated","reason":"repeated_failure"` lines (impl items 4789…4812).
- **The broker is DOWN, not dormant.** `selfdev.sqlite.broker.json` names pid **14784** (since
  2026-10-22T17:39:46Z), last `lastPassAt 1792811531946` = **2026-10-24T03:12:11.946Z** (broker.log tail:
  `PASS 34072`); pid 14784 is now `svchost.exe`, and `tasklist` shows no `cli.mjs serve` node process. No
  `*.genlock.*` leases exist. So this is the plain "process gone" shape, not the
  `broker-down-or-stalled.md` alive-but-dormant shape — and **restarting it now buys 12 more 402 runs**, so I
  did not restart it.
- **Queue (4818 rows):** 3748 `done`, 777 `cancelled`, 274 `held`, **19 `deferred`, 0 `queued`, 0 `claimed`**.
  All 19 deferred rows carry `deferredTo:"human"`; the ones `status` names as waiting: **#4354** (impl),
  **#4813** (pm), **#4814** (qa2), **#4816** (lead), **#4817**/**#4818** (devtools). #4816 and #4813 are the
  same finding from two seats: `brokerHealth` is read only as a `status` JSON field (`cli.mjs:2590-2602`) and
  `pass-failed` is a separate mechanism (`broker.mjs:1855`, log line at `:1861`), so #4746's `idle` verdict is
  **correct and inert** — a degraded broker raises no notice anyone acts on. That needs a ruling, not a build.
- **Local Strata is live and serving** (verified, not assumed): `curl 127.0.0.1:8080/v1/models` →
  `id "qwen3.8-flash-next-iq3_xxs"`, `status.loaded`, `n_ctx 131072`. But the rig does not point at it:
  `cli.mjs config` gives `DURIG_PROVIDER=deepinfra`, `DURIG_MODEL=zai-org/GLM-5.3-Flash`,
  `DURIG_MAX_CONCURRENT_SEATS=4`, and **no `DURIG_LOCAL_BASE_URL`** (the key exists, `src/config.mjs:118`).
- **Tree:** `main` @`1aeb0c43`; the tracked tree is clean apart from this session's docs commit. 32 refs,
  9 worktrees (4 locked item trees). **Full suite proven on this tree: 235/235 passed in 479.9 s**
  (`.scratch/test/all.out`), including the new `demo/clockin-digest.test.mjs`.
- **Suite on the clean shared tree (which equals `main`):** `npm run test` reached 210 of 234 demos inside my
  420 s cap — **209 PASS**, the only FAIL line was `demo/up-model-reset.test.mjs` with **exit 143 (SIGTERM from
  my cap, not a defect)**: run alone it exits 0 with all 13 assertions ok (`.spike/delegate/up-model-reset.out`).
  That left 234/234 **unproven at that point**; it was proven later the same session, after the work below landed:
  **235/235 in 479.9 s** on `main` @`1aeb0c43` (`.scratch/test/all.out`). Logs at `.spike/delegate/suite-main.out`
  and `.scratch/test/all.out`.

**THE POINTER BELOW WAS MEASURABLY STALE — three corrections, do not re-derive them:**

1. Below, the runbook-wiring stack **#4054 → #4064 → #4083 is called "the only item work left"**. Those three
   queue rows are **`done`**, but their branches are **unmerged**: `devtools-item-4054` @`4abd8ba2` ahead=1,
   `4064` @`018dca78` ahead=3, `4083` @`51298666` ahead=4, all behind=612. The landing was never run.
2. **Runbook staleness grew from 4 to 13.** `node .spike/stale-runbooks.mjs` (2026-10-25): `dated runbooks: 28
| stale: 13 | probe failures: 0` — `compact-a-seat`, `land`, `leaked-worktrees`, `stale-held-backlog`,
   `branch-cleanup`, `broker-safe-change`, `degeneration-guard`, `leaked-secret`, `prepare-workspace-refused`,
   `resume-while-broker-runs`, `store-corruption-recovery`, `tracked-files-missing-on-disk`,
   `write-corruption-recovery`. Landing the guard now reports **13** errors, not 7.
3. **Landing debt is bigger than the pointer admits.** 12 branches carry commits whose queue rows are `done`
   yet are not on `main`: `item-4745`, `4746`, `4749`, `4752`, `4755`, `4778`, `4786`, `4790`, `item-3033`,
   `advocate-item-2630`, and the runbook stack `devtools-item-4054/4064/4083`. `item-4747` and `item-4750` are no
   longer in that list as work: their NEXT split was **re-cut and landed this session** (`8fcac11c`, proven by
   concatenation), so both refs are SUPERSEDED and must not be landed on top of it — their 157-line pointer was
   the 2026-10-21 one. #4750's byte-faithful verify still has to be re-run against `main` by a non-author (#4814).

**Two unblock paths, both the operator's call (the delegate will not pick one):**

- **A — fund DeepInfra** (a purchase). Fastest, keeps the author/verifier cross-family split
  (DeepSeek authors vs GLM/gemma verifiers, `SELFDEV.md`) exactly as it is.
- **B — point seats at the already-running local Strata** (`DURIG_LOCAL_BASE_URL` + `rig.selfdev.json` models
  → `local/qwen3.8-flash-next-iq3_xxs`, then `up rig.selfdev.json --refresh --dry-run` first). Caveats the
  operator should weigh before granting it: `src/providers/local.mjs` builds **exactly ONE local provider per
  process**, so all 12 seats share one endpoint and one model family — which **collapses the cross-family
  verifier invariant**; this box has **32 GB RAM**, so Strata runs low-RAM (resident experts); and
  `SELFDEV.md`'s own quant table rates **IQ3_XXS below IQ3_S**, the size it calls quality-matching. Path B also
  changes every seat's context, so a `modelReset` boundary lands per seat.

**Queue id:** #4354 · #4813 · #4814 · #4816 · #4817/#4818 (the human-gated answers) · #4083/#4064/#4054
(verified, unlanded) · #4747/#4750/#4815 (NEXT split: landed as the `8fcac11c` re-cut; the rows still need a
non-author re-verify)

**Exact next commands:**

1. `node scripts/clockin.mjs` (or `npm run clockin`) — ONE call (measured 6-7 s, ~12 KB) that prints the live
   pointer, `last_run_failed`, broker UP/DOWN + `lastPassAt` age, queue counts, the deferred ids, the
   unmerged-branch debt with each row's status, the stale-runbook list, the provider config plus a probe of the
   local endpoint, a SELFDEV.md section map, and the last suite marker. `scripts/clockin.mjs` +
   `demo/clockin-digest.test.mjs` + `docs/DELEGATE-CLOCKIN.md` (D126). **`docs/NEXT.md` is now 118 lines and needs
   no chunked read; do NOT read `docs/SELFDEV.md` whole (57,589 B ≈ 14k tok) — read the section the map names.**
   Never print `cli.mjs status` (22.7 MB) or `cli.mjs queue` (21.2 MB) to the terminal: redirect to `.spike/` and
   aggregate with python.
2. `node demo/next-pointer.test.mjs` and `node demo/clockin-digest.test.mjs` — if the first fails the pointer has
   drifted (it now also fails if `docs/NEXT.md` grows past 200 lines); fix that before anything else.
3. Read `attention`'s `last_run_failed` from the digest: while it still says `402 … positive balance`, do not
   restart the broker and do not expect any seat to move.
4. `curl -s http://127.0.0.1:8080/v1/models` — proves the local option is actually up before the operator rules.
5. After the operator grants A or B: back up the store (`cp selfdev.sqlite
.spike/store-backup-$(date +%Y%m%d-%H%M%S).sqlite`), then for B run `node cli.mjs up rig.selfdev.json
--dry-run` to name the resets before writing them, and `node cli.mjs serve` to bring the broker back. Do not
   write a live PID into any `<db>.broker.json` to fake one: `cli.mjs status` then behaves as if a broker were
   attached and hung for 120 s while this session was measuring it.
6. Relay the operator's answers to the 19 `deferred` rows via `node intent.mjs pm --body-file <file>` (the broker
   delivers; never inline), then confirm the rows moved out of `deferred` from the digest's `## QUEUE` counts
   rather than from a 21 MB `cli.mjs queue` dump.
7. Then the landing pass, from the shared root only: `scripts/land.mjs` for `item-4745`, `4746`, `4749`, `4752`,
   `4755`, `4778`, `4786`, `4790`, `item-3033`, `advocate-item-2630`, and the `4054→4064→4083` stack (merge `main`
   into `4083` first, keep main's `RULES` + the advisory class), each asserted with
   `git merge-base --is-ancestor <sha> main`. Do NOT land `item-4747`/`item-4750` — see the supersession above.

**Blocker:** **provider 402 — DeepInfra has no balance**, so no seat can run (this blocks the pointer below
too: its "provider-backed verification on a temp store" needs a working provider, and 13 — not 4 — runbooks are
now stale). Secondary: 19 `deferred` rows await the operator's rulings, and verified branches sit unlanded (the
digest's `## GIT` section lists 17 unmerged refs with each row's status). Not a blocker: the tree is clean and
`main` is green — **235/235 demos, 479.9 s**, proven after `1aeb0c43`.

**Delegate also owes, if asked:** the still-unproven Enter question from the pointer below — whether the Pi TUI
renders inside the operator window. Only the operator's terminal can answer it; the new
`the session exited with code N` line is what distinguishes "child died" from "child ran but drew nothing".

**Startup cost, measured 2026-10-25 (this is why the commands above are ordered as they are):** the clock-in
ritual used to cost ≈113k tokens before any work started — `docs/NEXT.md` 394,106 B / 4,724 lines (~99k tok, over
the 50 KB / 2,000-line read cap, so it arrived in 8 chunked reads) plus `docs/SELFDEV.md` 57,589 B (~14k tok, of
which ≈400 lines are the local-model capacity/benchmark treatise). Both halves of that are now fixed on the docs
side and the tool side: **this file is 118 lines / 10,359 B** (the 4,610 older lines are verbatim in
`docs/NEXT-ARCHIVE.md`, 384,427 B, landed as `8fcac11c` after `scripts/land.mjs` REFUSED the branch for a
`collapsed` text-integrity fault — the refusal is correct for accidents and blind to a provable move, so the
author committed it with the concatenation proof, D126) and `scripts/clockin.mjs` prints the whole clock-in in one
call. `demo/next-pointer.test.mjs` now caps this file at 200 lines, because the digest prints it verbatim: every
pointer line is paid for by every later session. The remaining whole-file cost a session can still walk into is
`docs/SELFDEV.md` (§6 of `docs/DELEGATE-CLOCKIN.md`).

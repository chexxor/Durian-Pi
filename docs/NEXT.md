# durian-pi — NEXT (current pointer)
> **Older sessions moved VERBATIM to [docs/NEXT-ARCHIVE.md](NEXT-ARCHIVE.md)** — original order, no edits.
> This file is the live pointer plus the current session: everything from the `2026-10-21T23:12Z` session back
> lives in the archive. The cut is proven by concatenation (see `docs/DECISIONS.md` D126).


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
- **Tree:** `main` @`4362bd54`, tracked tree clean (0 dirty). 32 refs, 9 worktrees (4 locked item trees).
- **Suite on the clean shared tree (which equals `main`):** `npm run test` reached 210 of 234 demos inside my
  420 s cap — **209 PASS**, the only FAIL line was `demo/up-model-reset.test.mjs` with **exit 143 (SIGTERM from
  my cap, not a defect)**: run alone it exits 0 with all 13 assertions ok (`.spike/delegate/up-model-reset.out`).
  Full 234/234 is therefore **NOT proven this session**; log at `.spike/delegate/suite-main.out`.

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
   yet are not on `main`: `item-4745`, `4746`, `4747`, `4749`, `4750`, `4752`, `4755`, `4778`, `4786`, `4790`,
   `item-3033`, `advocate-item-2630`. Content probe (`git diff --name-only main...<branch>`): `main` has **no
   `docs/NEXT-ARCHIVE.md`**, so #4747/#4750's NEXT split is NOT landed — and this session's new pointer section
   lengthens `docs/NEXT.md` further, so #4750's byte-faithful line-count verify **must be re-measured against
   current `main`** (that is exactly what #4814 and #4817 are asking for).

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
(verified, unlanded) · #4747/#4750 (NEXT split, verified, unlanded, needs re-measure)

**Exact next commands:**
1. `node .spike/delegate/clockin.mjs` — ONE call (measured 6.1 s, 14,327 B) that prints the live pointer,
   `last_run_failed`, broker UP/DOWN + `lastPassAt` age, queue counts, the deferred ids, the unmerged-branch
   debt with each row's status, the stale-runbook list, the provider config plus a probe of the local endpoint,
   a SELFDEV.md section map, and the last suite marker. It is documented in `docs/DELEGATE-CLOCKIN.md` (D126).
   **Do not read `docs/NEXT.md` whole (396,843 B ≈ 99k tok; the useful pointer is 92 lines ≈ 2k tok) and do not
   read `docs/SELFDEV.md` whole (57,589 B ≈ 14k tok) — read only the section the map names.** Never print
   `cli.mjs status` (22.7 MB) or `cli.mjs queue` (21.2 MB) to the terminal: redirect to `.spike/` and aggregate
   with python.
2. `node demo/next-pointer.test.mjs` — if it fails, the pointer has drifted; fix the pointer before anything else.
3. Read `attention`'s `last_run_failed` from the digest: while it still says `402 … positive balance`, do not
   restart the broker and do not expect any seat to move.
2. `curl -s http://127.0.0.1:8080/v1/models` — proves the local option is actually up before the operator rules.
3. After the operator grants A or B: back up the store (`cp selfdev.sqlite
   .spike/store-backup-$(date +%Y%m%d-%H%M%S).sqlite`), then for B run `node cli.mjs up rig.selfdev.json
   --dry-run` to name the resets before writing them, and `node cli.mjs serve` to bring the broker back.
4. Relay the operator's answers to the 19 `deferred` rows via `node intent.mjs pm --body-file <file>` (the
   broker delivers; never inline), then `node cli.mjs queue` to confirm the rows moved out of `deferred`.
5. Then the landing pass, from the shared root only: `scripts/land.mjs` for `item-4745`, `4746`, `4747`, `4749`,
   `4750`, `4752`, `4755`, `4778`, `4786`, `4790`, and the `4054→4064→4083` stack (merge `main` into `4083`
   first, keep main's `RULES` + the advisory class), each asserted with `git merge-base --is-ancestor <sha> main`.

**Blocker:** **provider 402 — DeepInfra has no balance**, so no seat can run (this blocks the pointer below
too: its "provider-backed verification on a temp store" needs a working provider, and 13 — not 4 — runbooks are
now stale). Secondary: 19 `deferred` rows await the operator's rulings, and 15 verified branches sit unlanded
612 commits behind `main`. Not a blocker: the tree is clean and `main` looks green (209/210 demos reached this
session; full 234 unproven).

**Delegate also owes, if asked:** the still-unproven Enter question from the pointer below — whether the Pi TUI
renders inside the operator window. Only the operator's terminal can answer it; the new
`the session exited with code N` line is what distinguishes "child died" from "child ran but drew nothing".

**Startup cost, measured 2026-10-25 (this is why the commands above are ordered as they are):** reading the two
required docs the way the runbook literally says costs ≈113k tokens before any work starts — `docs/NEXT.md`
396,843 B (~99k tok, 4,704 lines, and it exceeds the 50 KB/2,000-line read cap so it arrives in 8 chunks) plus
`docs/SELFDEV.md` 57,589 B (~14k tok, of which ≈400 lines are the local-model capacity/benchmark treatise). The
digest above collapses that to ~3k tokens. **The structural fix is already built and verified but unlanded:**
`item-4747` @`9f624ff4` splits this file into a 156-line `docs/NEXT.md` (12,979 B) plus `docs/NEXT-ARCHIVE.md`
(364,956 B) — `#4747`/`#4750`/`#4815` are `done`/`deferred` and the branch does **not** merge clean today
(`git merge-tree` reports a `docs/NEXT.md` conflict against current `main`), so it needs a re-cut against the
moved pointer. That is a `scribe` re-cut, not delegate work — and it should CAP the pointer (~120 lines), because
this digest prints it verbatim, so every pointer line is paid for by every later session.

## NEXT SESSION (2026-11-02T08:15Z — D190, Linux: `item-4985` and `item-4931` are LANDED; the broker start is the next grant, and it is held on six verifier-pointed rows)

**Current item:** `#4970` HALF A — the operator's broker `--start` decision. It is now the top of the stack because the
row that blocked it (`#4977`'s false shell BLOCK) landed, and because `#4993` (gated on `#4985` being on `main`) is now
**unblocked**. Second item: the six rows `lead` is minting right now from
`.spike/delegate-20261102/lead-landing-gate-defects.md` (sent 08:04Z, `--request-id delegate-20261102-landinggate`, pid
in `.spike/delegate-20261102/send-lead.pid`, reply at `.spike/delegate-20261102/send-lead.out`).
**Next command:** `node cli.mjs log lead 20` — read that turn and confirm the six rows exist — then the operator's start:
`DURIG_MAX_CONCURRENT_SEATS=2 node tools/broker-serve.mjs --start --db ./selfdev.sqlite --rig ./rig.selfdev.json --yes-pm-wakes --max-duration 3600`.
**Blocker:** six claimable rows point at a provider with **no process behind it** — `qa` 3, `qa2` 2, `auditor` 1, and
`tools/broker-serve.mjs --status` prints `BLOCK provider-DURIG_VERIFIER_-unreachable: http://127.0.0.1:1234/v1 … ECONNREFUSED`.
Starting before those are parked burns six wakes and deposits rows for each.

Older sessions live verbatim in `docs/NEXT-ARCHIVE.md` (this pointer's 2026-11-02T02:10Z predecessor was cut there at the
tail, byte-identical, proof in this file's own cut note).

## 1. What moved this session (all verified, none pushed)

- **`main` moved twice**: `e2f85719` → `4c0d4810` (merge of `item-4985`, `parents = e2f85719 d8c92bb2`) → **`c80bd7f0`**
  (merge of `item-4931`, `parents = 4c0d4810 8fa8f3a2`). Both merges have TWO parents, so they landed something
  (`docs/runbooks/land.md`: a parent count is structure, a subject is a description).
- **Proof, both halves** (land.md's rule — ancestry AND content): `git merge-base --is-ancestor d8c92bb2 main` exit 0 and
  `… 8fa8f3a2 main` exit 0; content check `git show main:src/config.mjs | grep -c DURIG_COMPACTION` = **24** (the five keys
  at `:140-144`) where the same grep was **empty before the merge**.
- **Full gate after both landings:** `node scripts/test.mjs --all --jobs 8` → **total 245, passed 243**, failed =
  `[demo/broker-serve-shell-availability.test.mjs, demo/deepinfra-catalog.test.mjs]` — byte-identical to the pre-landing
  baseline this session took at `e2f85719` (53.4 s then, 50.1 s after). **No regression.**
- **`origin/main` is at `e2f85719`; `main` is 6 ahead.** Still no push grant — the operator pushed once (the 94-ahead
  figure the old pointer quoted is closed) and these two merges have not been offered.
- **`item-4898` was deliberately NOT landed** — it is superseded, not unlanded: `item-4931`'s subject is "re-cut of the
  compaction build (#4887/#4898) onto current main, unchanged in substance" and both touch the same three files
  (`cli.mjs`, `demo/config.test.mjs`, `src/config.mjs`). Same for `wip/seat-prompt-files +1` (its re-cut `#4966` is in main).
  Closing both is `pm`'s verb; the delegate recommends against landing either.

## 2. Three landing-gate traps, measured so the next session does not re-derive them

1. **Land `item-4985`-class fixes BEFORE anything gated on them.** The first `--changed-suite` attempt STOPPED with
   `demo/clockin-digest.test.mjs` failing in the **detached** landing scratch:
   `Error: Command failed: git rev-list --count main..(no branch)` (`demo/clockin-digest.test.mjs:215`) — the #4985 defect.
   Landing `item-4985` first cleared it; its own gate run was 10/10 green in a detached scratch.
2. **`demo/local-model-pointer.test.mjs` is non-hermetic** (`:40` needs the gitignored `durig.config.json`). Proven A/B in a
   throwaway detached worktree at `4c0d4810` (`cli.mjs worktree /home/chexxor/Git/durian-dev/scratch-4931`, removed after —
   worktree count back to 14): no config → the exact red the lander reported; same worktree with `DURIG_LOCAL_BASE_URL`
   `/_MODEL` + `DURIG_VERIFIER_BASE_URL` `/_MODEL` exported → `LOCAL MODEL POINTER PASS (… pinned seats=12)`. So **export the
   four provider vars in the shell that runs the lander**, or `--changed-suite` will refuse clean landings.
3. **The gate has no known-red baseline, so nothing can pass it on this rig** — `main` itself is red at HEAD (2 of 245).
   `item-4931` was landed ungated with the note `land.mjs` prints, then regression-checked by a full suite on `main`
   compared to a hand-taken baseline. Minted this session (row 3 of the lead brief) as the missing feature.
4. **`cli.mjs queue --help` prints the whole queue** — 22,000,119 B for 4,994 rows, 1.1 s. That is `#4986` (still open). Use
   `node scripts/clockin.mjs` (5.5 s) or one `queue --json` redirect plus `.spike/delegate-20261102/rows.mjs <file>
   [nonterminal|grep <re>]` — that probe is in gitignored `.spike/`, so promote it to `tools/` or it is lost (233).

## 3. The verifier ruling (D190) — do not load a verifier model

Measured, Linux, 08:00Z: `nvidia-smi --query-compute-apps` → strata pid 345372 holds **14,770 MiB on the A4000 AND 20,712
MiB on the 3090** (`/v1/models` says `gpus:[0,1]`, `--max-context 204800`, 48 GiB RSS, 41.2 GiB shmem). Free VRAM is
1,472 + 1,574 MiB. **LM Studio has no process at all.** So loading ministral = evicting the author engine, for the model at
0/16 clean controls (D137). The operator's ruling, recorded in D190: keep the verifier provider dark, and run verify legs
the way `#4956`/`#4962` already did — **independent by seat/transcript/execution, and say so in the report** — never claim
model independence without first running `tools/model-probes/gate.mjs <baseUrl> <id> <label>`.

## 4. Measured state at clock-out (08:10Z, `main = c80bd7f0`) — re-read the cheap ones, they move

- Queue (clockin, 5.5 s): **4,994 rows — 3,784 done / 795 cancelled / 329 held / 66 queued / 12 deferred / 8 claimed = 415
  non-terminal**; 12 seats, 16 attention notices. `channel-preflight`: **66 claimable**, and per-seat
  `impl 19, devtools 17, lead 11, scribe 4, security 4, qa 3, architect 3, qa2 2, pm 2, auditor 1`.
- `tools/queue-drain-audit.mjs` (1.5 s): **70 of 89 non-terminal LANDING rows are already fully on `main`** (zero-build
  closable), 70 orphan candidates, 12 rows whose gate prose cites no resolvable id. `#4799` is still `claimed` although its
  work landed at `67aa0096`. `pm` owns every release/cancel.
- Broker NOT resident; 1 unsettled submission (`devtools` `placed`, 5.8 h) that
  `reconcileStrandedSubmissions` settles on pass 1 — "the wedge does NOT survive a restart". 2 intents have sat in the spool
  since 2026-10-29.
- Local engine **UP and completing** (`broker-serve`: `local: answers … local: completes`). `cli.mjs config` reports
  **`DURIG_MAX_CONCURRENT_SEATS = "1"`** while the operator has raised strata to **concurrency 2** — start the broker with
  `DURIG_MAX_CONCURRENT_SEATS=2` so seats queue in durig, not inside the model.
- Still-false instrument reads, re-measured on post-landing `main` (all minted in the lead brief): `cli.mjs config` prints
  14 keys and **not one `DURIG_LOCAL_*`/`DURIG_VERIFIER_*`**; `scripts/clockin.mjs` prints `local=NOT SET` and
  `local endpoint: DOWN (fetch failed)` about a hardcoded `:8080`; `src/attention.mjs:435` still says "re-arm it with the
  resume/doctor verb" and no re-arm path exists; `tools/channel-preflight.mjs:234` still defaults `programs = ["pwsh",
  "powershell"]` and prints "NO SHELL CAN START HERE" while `broker-serve` prints `NOTE … bash CAN start on linux`
  (**that one is already `#4992`, queued to impl — do not re-mint**).
- Strata topology: **re-measure every session, 0.2 s** —
  `nvidia-smi --query-gpu=index,name,memory.used,memory.total --format=csv` then
  `nvidia-smi --query-compute-apps=pid,gpu_name,used_memory --format=csv`. It has flipped twice in three days and it decides
  whether any second model can load at all.

## 5. Still open, re-read before acting

`#4970` HALF B (the config-drift lever: `DURIG_LOCAL_CONTEXT` 160000 in this checkout vs 200000 in the seat root —
operator-owned, still present) · **12 `deferred` rows parked on the operator** (`#4354`, `#4814`, `#4817`, plus 9 LANDING
entries) · the host clock: `LocalRTC=yes` on a dual-boot box while every broker gate is `Date.now()` arithmetic
(ROADMAP 234; `timedatectl set-local-rtc 0` is host-wide, so the operator's call) · `#4987`, `#4986`, `#4992`, `#4978`,
`#4979` (open instrument defects) · `#4966`, `#4977`, `#4985`, `#4931` are **done and landed — do not re-do them**.

## Standing constraints

- **Do not claim, complete, defer, or route queue rows yourself.** Routing and decomposition belong to `lead`/`pm`.
- **No push without the operator's grant** — `main` is **6** ahead of `origin/main` (`e2f85719`).
- **Native host only** (Linux here; D131). **`DURIG_DB` for the CLI**, never `DURIAN_PI_DB` (D103).
- **`test -f "$PWD/durig.config.json"` before any write verb** (absent in every worktree; precedence env → `./durig.config.json`
  in the waker's cwd, `src/config.mjs:7`), and **never run `doctor`/`resume` while a seat is running** (D187).
- **`inputs/fetched/` must stay clean or the lander refuses**: `scripts/land.mjs` counts **untracked** paths as dirty. One
  uncited, unmanifested fetch (`strata-batching.md`, sha256 `d1f7d558…`) was moved to `.spike/inputs/` this session to let
  the landings run — re-file it properly (manifest row + URL) or delete it, do not leave it in `inputs/fetched/`.

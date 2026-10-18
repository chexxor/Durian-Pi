# durig — NEXT (current pointer)

**This file is the live pointer, not history.** `docs/STATUS.md` is history; `docs/ROADMAP.md` is the
backlog; `docs/SELFDEV.md` is the runbook. Update at the end of every session.

_Last refreshed: 2026-10-18T19:17Z (delegate — full host+rig recovery after the commit-exhaustion reboot; broker AND the local LLM are back up; recurrence 8 recorded; durable-TUI priority unchanged)._

> **CLOCK-OUT / NEXT SESSION START HERE (2026-10-18T19:17Z).** — Recovery complete: broker UP (pid
> `11816`) and the local LLM (PolyStrata) UP. Nothing is blocked.
> - **Host is healthy.** The reboot landed; `C:\pagefile.sys` is now a fixed **32,768 MB**. Commit
>   headroom **55,254 / 65,458 MB** free, physical **25,565 / 32,690 MB**. The `Zone Allocation failed`
>   and `git` fork errors are gone. Root cause now grounded (commit limit = RAM + the old 4,982 MB page
>   file) — `docs/incidents/2026-10-18-host-resource-exhaustion.md` is now **resolved**.
> - **Broker UP — pid `11816`** (`START 19:10:52Z`, `PASS 32+`, `WAKE pm,impl,qa,scribe,auditor`,
>   **zero `wake-failed`**, no genlock). Recovery: `resume` cleared 4 then 3 stranded submissions;
>   restarted **without `DURIG_SEAT_ROOT` and WITH the local env** (`DURIG_LOCAL_API_KEY=local`, since
>   #2114 is not on `main`). Step 3 of `broker-down-or-stalled.md` now carries that.
> - **Local LLM UP.** PolyStrata restarted (launcher pid `9220`, listener `15268`, `strata-poly.exe`
>   `5944`), serving `qwen3.6-35b-a3b-ud-q3_k_m` on `127.0.0.1:8080` (`n_ctx 65536`); `/v1/models` HTTP
>   200 and a live completion verified. **New procedure: `docs/runbooks/local-provider-down.md`.**
> - **Recurrence 8** (`docs/incidents/2026-10-18-broker-dormant-stalled.md`): on the first restart
>   (pid `10728`) a `qa` conv-15 storage error logged `WAKE-RETRY in=2000ms seats=qa` but **no `PASS`**
>   followed for ~3.5 min (fresh heartbeat, no genlock, idle CPU); the retry either never ran or hung
>   before its `PASS` (invisible — `cmdServe` does not log `pass-failed`). **Owed: log a retry-pass
>   attempt BEFORE the work (ROADMAP 78) + the stale-`PASS` watchdog (ROADMAP 61-64).**
> - **`ui.mjs` viewer pid `11256` is STILL running** (the documented concurrent-opener aggravator); it
>   did not block this recovery, but terminate it first if a recurrence 9 hits.
> - **OPERATOR PRIORITY unchanged: durable-TUI (durian-pi) migration.** NEXT AGENT: deliver an intent to
>   `pm` to un-park and sequence **#2095 → #2096** (+ #2103/#2104). Also queued: **#2123** (D105 impl),
>   **#2124** (scribe, claimed), **#2125** (gated verify), **#2137** (landing list: `devtools-item-2114`
>   @9ba3c8a — landing it removes the `DURIG_LOCAL_API_KEY` restart requirement).
> - **`qa`:** `repeated_failure` (3× `Connection error.` while PolyStrata was down). Its only
>   non-terminal item `#2145` is `deferred`, so there is no queued `qa` work to re-drive; confirm `qa`
>   recovers on its next real wake now that the server is up.
> - `main` = `ffdec3f`, 11 ahead of `origin/main` (unpushed; operator holds push). Docs updated this
>   session: 3 incident reports + `broker-down-or-stalled.md` + new `local-provider-down.md` + runbook and
>   incident indexes.
> - **Exact next command:** `DURIG_DB=./selfdev.sqlite node cli.mjs status`
> - **Do not:** restart the broker without the local env; leave PolyStrata down; treat a fresh heartbeat
>   as health (read the last `PASS`).

> **CLOCK-OUT / NEXT SESSION START HERE (2026-10-18T18:59Z).**
> - **Why nothing was running: the host commit charge is exhausted — NOT a durig bug.** `systeminfo`:
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
>   restart WITHOUT `DURIG_SEAT_ROOT` and WITH the local-seat env — `scripts/serve-noroot.ps1` sets only
>   `DURIG_DB`, and **#2114's placeholder key is NOT on `main`** (`src/providers/local.mjs` still returns
>   `""` when `DURIG_LOCAL_API_KEY` is unset; the fix is branch `devtools-item-2114 @9ba3c8a`, landing
>   list #2137). So a plain restart BREAKS the local seats (`devtools`/`qa`). Set
>   `DURIG_LOCAL_BASE_URL/MODEL/CONTEXT` (already in `durig.config.json`) + `DURIG_LOCAL_API_KEY=local`
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
> - **Exact next command after reboot:** `DURIG_DB=./selfdev.sqlite node cli.mjs status`
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
> - **Exact next command:** `DURIG_DB=./selfdev.sqlite node cli.mjs status`
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
> (2026-10-18T17:33Z).** Operator: "ensure durig has a policy of starting a new context for any new work
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
> (`n_ctx 65536`); broker **pid 3604** started with `DURIG_LOCAL_API_KEY=local` (placeholder) in its env (see below).
>
> - **Defect routed + fixed.** Intent delivered to `pm` (`.spike/delegate/intent-local-provider-key.md`)
>   → registered **#2114** (devtools: non-secret placeholder key when `DURIG_LOCAL_API_KEY` is unset in
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
> - **Restart requires the local key env.** `scripts/serve-noroot.ps1` sets only `DURIG_DB`; the restart
>   set `DURIG_LOCAL_BASE_URL/MODEL/CONTEXT` + `DURIG_LOCAL_API_KEY=local` (the placeholder). Config file
>   `durig.config.json` already carries the first three; only the key is env-only. Until the source fix
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
> **The model string was never the problem** — durig's provider is `local` + `DURIG_LOCAL_MODEL`, so the
> seat string is `local/<DURIG_LOCAL_MODEL>` (`local/qwen36`); the pi CLI's `local-model/...` is pi's own
> separate provider. The server ignores the request's `model` field either way.
> **DEFECT (needs a seat fix + review):** `src/providers/local.mjs` resolves the auth key from
> `DURIG_LOCAL_API_KEY` and defaults it to `""`, so the provider fails with
> `No API key for provider: local` unless that undocumented var is set — its own comment says "resolve a
> constant". Confirmed: the first wake errored, a restart with `DURIG_LOCAL_API_KEY=local` made it reply.
> **Operational consequence:** the broker must be started with `DURIG_LOCAL_BASE_URL`,
> `DURIG_LOCAL_MODEL=qwen36`, `DURIG_LOCAL_CONTEXT=65536`, `DURIG_LOCAL_API_KEY=<non-empty>` —
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
> lesson), fails closed naming store+pid, and uses `DURIAN_PI_TUI_*` with `DURIG_TUI_*` aliases. It
> also scopes `cwd`/worktree resolution to Phase 2 (Phase 1 resolves no seat).
> **BLOCKER (unchanged, now with evidence): #2095/#2096/#2103 were all `deferred by supervisor` after
> the 402 (`log designer`: `stopReason:"error", 402 … positive balance`).** Only `qa` runs
> (`local/qwen36` via PolyStrata). **Operator decision needed to start the team:** (a) fund DeepInfra;
> or (b) authorize pointing `devtools`+`impl` at the local PolyStrata provider (D104 per-seat:
> `DURIG_LOCAL_BASE_URL` in the broker env, set the two seat models to `local/<id>`, `up --refresh`,
> restart the broker in a declared window). Local serves ONE 35B Q3 model / 64k ctx on 24 GB VRAM —
> adequate for Phase 1's mechanical work but serialized; one heavy seat at a time. **Broker state:**
> UP pid `10424`, last `PASS 1` at 09:45Z — this is IDLE, **not stalled**: the queue holds **0
> `queued`/`claimed`** items (85 deferred, 51 held), inbox empty, no genlock. Do not kill it.

> **LOCAL INFERENCE (2026-10-18) — `qa` runs locally; DeepInfra 402 still blocks the rest.** PolyStrata
> (`C:\Users\Alex\dsh-Projects\PolyStrata`) serves Qwen3.6-35B-A3B UD-Q3_K_M on
> `http://127.0.0.1:8080/v1` (OpenAI-compatible; tool calls work). durig gained a **per-seat `local`
> provider** (D104): with `DURIG_LOCAL_BASE_URL` set, a seat model `local/<id>` uses it while others
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
> DeepInfra** (provider = `deepinfra` in `durig.config.json`) or switch to a funded provider/key —
> retrying or resetting seats cannot help. After funding: `resume`, re-queue `#2103`/`#2104`, let the
> broker re-wake. Broker is UP (pid 8196, PASS advancing); store healthy (no corruption); backup at
> `.spike/store-backup-20261018-022048`. **Security: the DeepInfra key lived in gitignored
> `durig.config.json` and was echoed during diagnosis — rotate it.**

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
>   false (they name the real `../pi-opendurig.worktrees/`). Needs a GitHub rename + a declared window.
> - **REBRAND (operator): `durig` → `durian-pi`** across all tracked text + identifiers (267 files,
>   24 `DURIG_*` env vars, `durig.config.json`, `.durig/`, the skill dirs), with deprecated aliases for
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

**Exact next command:** `DURIG_DB=./selfdev.sqlite node cli.mjs status`

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

**Exact next command:** `DURIG_DB=./selfdev.sqlite node cli.mjs status`

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
**archived 41 dirty merged-ref worktrees out-of-tree** to `../pi-opendurig.worktrees/` (content moved
byte-for-byte, then the merged ref freed with `git switch --detach` + `git branch -d`; nothing discarded).
`main` `95e7c0c → b3710f3 → e072392` (docs commit). **Refs 137→46**, worktrees 167→135. **38 unlanded
branches remain** (was 36; live seats created new ones during the session).

**Queue id:** `#2017` (ROADMAP 76 stack landing: `impl-item-1891` → `impl-item-1907`); the landing-list
rows completed this session (`#1912`, `#1982`, `#1999`, `#2009`, `#2014`) are now landed.

**Exact next command:** `DURIG_DB=./selfdev.sqlite node cli.mjs status`

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
`../pi-opendurig.worktrees/` (files preserved byte-for-byte, spot-verified by md5), then `git switch
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
`../pi-opendurig.worktrees/`. The **model-swap window
(`#1957`) still awaits the operator's declared broker stop** (gate green, `#1936` landed).

**Do not:** stop the broker without an operator window (a landing pass is one); leave log/watch viewers
attached; force a dirty worktree; `-D` an `ahead>0` ref; land a snapshot.

## (prior) NEXT SESSION — delegate clock-out, 2026-10-18T03:38Z

**Current item:** the ROADMAP 71 / broker-spool landing cluster. **#1904** (`compact` spool op) is **verified** (verify **#1987 PASS**) but CLONE-CONFLICTs on `cli.mjs`; a rebase is routed (**#1912**, **#2018**). Next: land the rebased #1904, then the ROADMAP 76 stack (**#2017**), then the docs-truth items (**#1972**, gated on #1904 landing; **#2014**).

**Exact next command:** `DURIG_DB=./selfdev.sqlite node cli.mjs status`

**Known blocker:** none blocking the delegate. Broker **UP pid 35084** (START 03:15:29Z, passes advancing). The combined **window** (qa → `mistralai/Mistral-Small-3.2-24B-Instruct-2506`, add **qa2** → `google/gemma-4-31B-it`) still needs the operator-declared broker stop; prerequisite **#1936** (Gemma-4 catalog) has **LANDED**. `main` = **4a085f3**, **58 commits ahead of `origin/main`** (NOT pushed; operator holds push). Watch the recurring 37(b) `admitted_not_started` and the main-red `#1610` gate.

**What this session did:** delivered the pi-durable compaction analysis; filed #1904 (compact spool op) → devtools; appended incident recurrences (broker-dormant-stalled @02:37Z `database is locked`; qa-context-degeneration third occurrence); routed qa's verifications to auditor (#1923–#1927); prepared qa2 (`.spike/delegate/rig.selfdev.qa2.json`); ran a **landing pass that landed 26 branches** (main → `4a085f3`, suite green) — **25 conflict-set branches remain** (incl. #1904, which needs a rebase).

**Do not:** re-propose reusing/copying vendor internals as a speed lever — the operator **DECLINED** it (dependency/provenance + upstream-drift risk); keep dependencies pinned. Do not create an `impl2` seat. Do not stop the broker without an operator-declared window (except a wedged broker with no genlock).

**Delegate actions this session (operator-directed):**
- Delivered the requested written analysis: pi-durable is BUILT for live compaction (post's
  "Compaction" section — a task that runs while the conversation keeps going), but durig's `compact`
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

**Exact first command:** `DURIG_DB=./selfdev.sqlite node cli.mjs status`

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

**Exact next command:** `DURIG_DB=./selfdev.sqlite node cli.mjs status`

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

**Exact next command:** `DURIG_DB=./selfdev.sqlite node cli.mjs status`

**Known blocker (unchanged):** `main` secretredact gate observed red (`demo/secretredact.test.mjs`
exit 1) while queue rows `#1741`/`#1747` claim green — reconcile before any landing.


## HANDOVER — 2026-10-17 (stage-two recovery; clock-out — NEWEST; read `## NEXT SESSION` below)

**Current item / queue ids:** the degeneration-guard fixes **`#1703`** (false positive) /
**`#1704`** (reset idempotence) / **`#1705`** (false negative + model-aware context bound) — all
`queued` to `impl`; the gate is **`#1610` MAIN IS RED** (`#1611`).
**Exact next command:** `DURIG_DB=./selfdev.sqlite node cli.mjs status`
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
lazy CLI verbs so durig's own features (worktree, TUI, checkup, ambient measures, format, …) become
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
- **Exact first command:** `DURIG_DB=./selfdev.sqlite node cli.mjs status`

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

**Exact next command:** `DURIG_DB=./selfdev.sqlite node cli.mjs status`

**Priority order (grounded in the queue + `status` attention):**
1. **`#1610` / `#1611` — MAIN IS RED (blocker).** `node demo/secretredact.test.mjs` → exit 1 on `main`
   (3 checks; a secret IS committed). Until green, **no landing passes the `merge.md` gate**.
2. **Land the wrong-root guard (`#1151`) SOON (operator priority).** Land `impl-item-1444-fix` first
   (covers `#1151 → #1225 → #1249 → #1261 → #1444(D1 fix) → #1487`) once `main` is green — routed to
   `pm`; it is the control for the new `seat-root-fallback-commit` incident.
3. **`secret_detected` on `security`** — routed to `pm`; per `store-secret-detected.md` rotate the
   credential and treat the store as compromised.
4. **`#1607` / `#1608`** — `durig ui` `view is not defined` fix + regression test.
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
  only; `--no-save` kept the lockfile clean — no new durig code was pending, origin 0 behind / 6 ahead).
- Broker restarted on the new runtime: `START pid=37596` 08:46:18Z, PASS advancing, heartbeat fresh.
- **Revert path if a regression appears:** `node scripts/sync-pi.mjs --unlink` (back to released
  packages) + restore the pin sha with the edit tool (never `git restore`/`checkout --`).

**Worktree base-ref gap (impl blocked) — operator directive, REGISTERED.** impl was blocked on #1444 (the D1
fix, which blocks landing entry 11) because **no entry point could make a worktree at an UNLANDED base**:
`prepare_workspace` (`src/seattools.mjs:37`) and the `worktree` verb (`cli.mjs:870`) never pass `ref`,
though the core (`prepareSeatWorkspace`/`createWorktree`) already accepts it. impl also hit refusals
writing item notes into the shared, gitignored `.durig/` (outside its worktree). Intents delivered:
`opr-20261017-impl-worktree-gap`, then `opr-20261017-worktree-capability-first` — operator directive:
**fix the base-ref capability FIRST** (with a failing-first demo); **register** the rest. pm REGISTERED:
**#1456** (capability fix), **#1458** (scratch-path docs), plus **#1453** (worktree-lifecycle test bug) and
**#1465** (long item bodies unreadable after `prepare_workspace` — body lives in `<repo>/.durig/`).

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

**Exact next command:** `DURIG_DB=./selfdev.sqlite node cli.mjs status`

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
2. **Runbook discoverability** added to `AGENTS.md`, the durig skill, and `constitution.txt` **P3
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
7. **`security` seat created and running** (operator-directed): durig had no seat owning security (the
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

**Exact next command:** `DURIG_DB=./selfdev.sqlite node cli.mjs status`

**What this session changed (all committed):**
1. **PM adapter deferred** (operator direction, **D88**): only the **task interface + storage format**
   (ROADMAP 115) is elevated; 116–123 are parked. Design: `docs/PM-ADAPTERS.md`.
2. **Tutor-app references removed** from config, code, tests, the dead `rigs/tutor-pi.rig.json`, and 21
   docs; affected demos green. Local `durig.config.json` `DURIG_DB` now points at `./selfdev.sqlite`.
3. **Seat worktrees relocated** (ROADMAP 125, **D89**): 28 terminal + 2 verify scratch moved to
   `../pi-opendurig.worktrees/`; 5 live/held worktrees remain in `item-*`.
4. **Research SOP hardened:** `research-request.md` now requires a follow-up prompt and registering
   proposed ROADMAP items.
5. **ROADMAP 102–125** registered (git-merging tooling, PM adapters, TUI 124, worktrees 125).

**Next-session checklist:**
1. `DURIG_DB=./selfdev.sqlite node cli.mjs status` (read-only).
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

**Exact next command:** `DURIG_DB=./selfdev.sqlite node cli.mjs status`

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
**Exact next command (read-only):** `DURIG_DB=./selfdev.sqlite node cli.mjs status`.

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
`DURIG_DB=./selfdev.sqlite node cli.mjs status`.

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

**Exact next command (read-only):** `DURIG_DB=./selfdev.sqlite node cli.mjs status`.

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
- **Exact next command (read-only):** `DURIG_DB=./selfdev.sqlite node cli.mjs status`.

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
- **No compaction verb exists.** pi-durable ships `CompactionTask`, but durig calls it nowhere and
  `help` has no `compact`; ROADMAP #62 (owner: impl) is the ordered context-pressure + one-compaction
  item. `reset` is the only context-reducing verb — a full reset, not a summary.
- **Open sqlite lock (transient, by design):** any opener can hit "database is locked" because EVERY
  open runs schema-migration DDL (`BEGIN IMMEDIATE`) and the resident broker holds the single write
  lock; the adapter's busy_timeout is 5000 ms, so a retry succeeds. Aggravated by stale
  `log --follow` viewers holding connections. It clears when the broker is stopped (and viewers reaped);
  the durable fix (skip migrations for read-only opens) is a code item for the team.
- **Exact next command (read-only):** `DURIG_DB=./selfdev.sqlite node cli.mjs status`.

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

**Exact next command (read-only):** `DURIG_DB=./selfdev.sqlite node cli.mjs status`.
**Restart a down broker:** `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/serve-noroot.ps1`
(never set `DURIG_SEAT_ROOT`).

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
durig now detects a tool call emitted as text (`isPseudoToolCallTurn`/`countPseudoToolCalls` in
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
**Exact next command:** `DURIG_DB=./selfdev.sqlite node cli.mjs status`.

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
`DURIG_SEAT_ROOT`). **Nothing restarts a dead broker — the supervision gap is items 61–64.** A broker that
died on a storage error stalled `impl` (2026-10-16); `resume` + restart recovered it.
**Pending apply — one broker stop + `up --refresh`:** the **`P3 Runbooks`** rule in `constitution.txt`
(`fe0c74c`) is not yet live for seats (the `P3 Language` rule and the impl→DeepSeek model were applied at
`806ce7f`). ⚠️ On `serve --stop`, proceed **only** on `"stopped": true` — never `false`; that is how the
store was corrupted twice. See `docs/runbooks/broker-safe-change.md`.
**Owed:** wire `reconcileStrandedSubmissions` into `cli.mjs cmdResume` (blocked on `cli.mjs`).
**Exact next command:** `DURIG_DB=./selfdev.sqlite node cli.mjs status`; restart a down broker with
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

**Seat-root trap (do not repeat):** start the selfdev broker **without `DURIG_SEAT_ROOT`** — a seat's
own prepared cwd wins (`src/seattools.mjs` `makeSeatEnv`), so a single global root conflicts with the
per-item worktree model and trips the F12 guard. Use `scripts/serve-noroot.ps1`.

**Do not poll** the running broker — the operator notifies the delegate when runs complete.

**Active queue:** current — claimed #658 (impl) and #727 (qa); queued #660/#662/#663/#665/#673/#674/
#676/#696/#700/#702/#705/#710/#713–#715/#718/#719/#723–#725/#728. All ancient rows (#60–#172) remain
`deferred` (parked on questions, not claimable). After the restart, pm/impl/advocate/scribe were woken
and progressing (advocate generating; impl working `demo/tui-client.test.mjs`).

**Exact next command (read-only):** `DURIG_DB=./selfdev.sqlite node cli.mjs status`; broker log is
`selfdev.sqlite.broker.log`. Restart a down broker with `.spike/delegate/dispatch-serve-noroot.ps1`
(never set `DURIG_SEAT_ROOT`) once no writer is in flight.

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

**Exact next command:** `DURIG_DB=./selfdev.sqlite node cli.mjs status`; run the hermetic TUI
regression with `npm run test:tui`. If the broker is stopped, restart it with
`DURIG_DB=./selfdev.sqlite node cli.mjs serve` once no writer is in flight.

**State at this refresh (2026-10-16, delegate session, paused):** store is single-writer; the broker is
the owner; `vendor/eval/` (reference clones) and `vendor/pi-main/` are gitignored.

**.

**Test flakiness under a live broker — finding + mitigations (2026-10-16):** running
`demo/*.test.mjs` while the broker drives gave **71/78**; re-running the 8 failures individually gave
**7 pass** (flaky) + `config.test.mjs` (a legit #621 failing-first RED). Grounded causes and fixes:
- **Inherited repo config**: demos spawn `cli.mjs` with `{...process.env}` and so pick up the local
  `durig.config.json` (`DURIG_MAX_CONCURRENT_SEATS: 4`, a real provider/model, and — the worst part —
  `DURIG_DB` pointed at a DIFFERENT project's store,
  store, so a demo that forgets to override `DURIG_DB` reads the wrong database — this is the live
  `no seats in …` error seen in impl's log). Fix: a hermetic test env (temp `DURIG_DB`,
  `DURIG_MAX_CONCURRENT_SEATS=1`, `DURIG_PROVIDER=faux`, and do not read the repo config).
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
`DURIG_DB=./selfdev.sqlite node cli.mjs serve` once no `send`/`run` writer is in flight (the advocate
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
  complete and its verdict is folded into `docs/ROADMAP.md` §“pi-durable alignment”. durig reimplements
  exactly two things the harness already provides: **client state** (the TUI poller → item 52, adopt,
  gated by the socket security position in item 55) and **busy-input** (`whenBusy:"steer"` → item 56).
  The rank-1 change is **wake-and-return in `drivePass`** (item 54). The review's explicit keep-list is
  recorded. **How-we-build doc for maintainers and upstream: `docs/PI-DURABLE-INTEGRATION.md`.**
  Awaiting `pm` sequencing.
- **Public doc site (item 59)** — `scribe` builds a GitHub Pages static site with a landing page,
  end-user pages, and maintainer pages, projecting from `docs/` (no duplication); the framework is an
  open decision. Depends on item 22 (the public repo). Awaiting `pm` sequencing.
- **Zero trust to zero agent (research requested 2026-10-16; ROADMAP item 60)** — narrow,
  per-seat / per-item least-privilege permissions for durig's seats. Owner: operator's research agent;
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
durig team for that reason.

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

**Then (next queued item): #480 (U1) — build the `durig ui` driver (queue id #480; TOP PRIORITY; UNBLOCKED).**
The rest of the interactive-client series is **#481–#487 (U2–U7)**. U1 is the missing piece between
`src/tui/client.mjs` (a headless renderer) and the operator: a separate entrypoint that owns raw mode
+ key handling + the poll loop and paints `renderTui` frames (`cli.mjs` stays non-interactive, D21;
read-only, D11/D40).

Exact next command (drive the selfdev team; the seat root is the live tree):

`DURIG_SEAT_ROOT=C:/Users/Alex/dsh-Projects/pi-opendurig DURIG_DB=./selfdev.sqlite node cli.mjs send impl --body-file <body>`

and have impl `claim_work({ itemId: 480 })` FIRST — a plain `run` makes impl take its oldest queued row
(impl has ~36). Bounded alternative: `DURIG_SEAT_ROOT=C:/Users/Alex/dsh-Projects/pi-opendurig DURIG_DB=./selfdev.sqlite node cli.mjs run --max-duration 300`.

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
   point the working seat's cwd/`DURIG_SEAT_ROOT` at it; on completion, commit ONLY the item's files
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
  entry id, F24; `run`/`up` are not retried). Concurrency is `serve` + `DURIG_MAX_CONCURRENT_SEATS`.
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
  exits, then restart the broker with `DURIG_DB=./selfdev.sqlite node cli.mjs serve`. Two drivers on
  one store double-wake (D45/D46).
- **The tree is DIRTY with #621's in-flight work** (`cli.mjs`, `src/config.mjs`, `demo/config.test.mjs`,
  `durig.config.default.json`) — **DO NOT discard**; it belongs to the claimed item. `item-1/`,`item-2/`
  are leaked worktrees (see the NEXT SESSION note).
- **Backups under `.spike/delegate/`**: `recovery-WIP.patch`, `storewrite-WIP.mjs`,
  `p2-6-scratch/` (the Job-Object attempts), `scratch-backup/` (the removed scratch), and the
  intent bodies used this session. `.spike/` is gitignored.
- **Env**: run with `DURIG_DB=./selfdev.sqlite` and `DURIG_SEAT_ROOT=C:/Users/Alex/dsh-Projects/pi-opendurig`.
  `durig.config.json` sets `DURIG_MAX_CONCURRENT_SEATS=4` (local, gitignored) for concurrency testing.
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

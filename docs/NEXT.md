# NEXT.md — current state and next actions

**Last update:** 2026-11-08T20:1xZ (delegate session **N12** — the operator's goal this window is **"ensure task
completion within a single context window"**. N12 measured *why* a seat's task does not finish inside its window,
restarted the fleet, and delivered the operator's intent to `pm`. Nothing was landed by this session; the landing
pass is now blocked by **stale bases**, not by unverified work. `main` = `origin/main` = **`d37bef35`** (measured
`git rev-parse --short main`; the N11 pointer's `496cb462` was already superseded — `item-5736` landed as
`4efce137`, and `d37bef35` is a docs commit on top of it).

**N12 in brief** — three facts, all measured on this box, all reproducible with one command each:
1. **ROADMAP 331 is still unfixed on `main`.** The per-model compaction override is emitted as a *sibling* of the
   key the harness reads, so it is dropped. Probe: `node .spike/delegate/compaction-policy-probe.mjs` (calls
   pi-durable's own `compactionPolicy`, never re-derives it) →
   `DURIG_COMPACTION_MODEL_OVERRIDES = {"local/qwen3.8-flash-next-q2_0":{"reserveTokens":20480}}`,
   `compactionSettings()` returns `{"modelOverrides":{...}}` with **no `compaction` key**, so `agent.js:47`
   stores pi-durable's defaults and every seat resolves **reserve 16384 / keepRecent 20000 / background 32768**.
2. **The cost is already in the store.** `node .spike/delegate/context-window-health.mjs` → 2,323
   `pi.compaction` records: **1,897 completed, 426 failed, 240 of them the exact string "Summarization hit the
   token limit; the summary is incomplete"**, clustered on conversation **4936** (`auditor`,
   `verifier/openai/gpt-oss-120b`, `DURIG_VERIFIER_CONTEXT = 24576`): with the defaults that survive,
   compact-above = 24,576 − 16,384 = **8,192 tokens** while `keepRecentTokens = 20,000` — the keep budget is
   244 % of the headroom. That is the mechanism behind the seat-level "Compaction failed" notices.
3. **The fleet is running.** Broker started 19:43Z (refused once on `wake-not-acknowledged` because a *read* intent
   was spooled — pitfall 130), restarted 20:05Z: `INTENT delivered=8 dead=0 dup=0`, spool empty. In the 30 min
   window: **64 generations, 0 failed**. All-time generation outcomes (store, one query): 54,353 completed /
   16,589 failed / 333 aborted.
4. **#5398 is LANDED** (this pass, after #5488): the clock-in digest's deferred list is **aggregated** instead of one
   inline row per item — **40,161 B → 15,013 B** measured on a snapshot of the live store (5,636 queue rows, 365
   deferred, 9 seats), ~11 s to re-run, **over budget is exit 1**, and the 365 ids are greppable at
   `.durig/clockin-deferred.txt` (`demo/clockin-digest.test.mjs` §8, `docs/runbooks/session-start-cost.md` §26–§28).

Host for everything below, measured in the same command as the measurements: **Linux**, Fedora Linux 45 (Forty Five),
kernel `7.2.15-300.fc45.x86_64`, node v24.22.1, git 2.56.0 — probe: `uname -s && uname -r && (. /etc/os-release &&
echo "$PRETTY_NAME") && node -v && git --version` (**never sign work with a hostname** — D205, ROADMAP 281).

## NEXT SESSION

**Milestone this window worked** — **ensuring LLM task completion (D226)**, first tranche **ROADMAP 331**. N12 moved
it in one way: the mechanism is now measured end to end (config → `compactionSettings()` → harness defaults → 240
failed summaries on the verifier seat), and the operator's intent for the fix is **spooled to `pm`**
(requestId `delegate-20261108-context-window`). What it did NOT move: no branch landed, and #331's fix is still
not in `src/config.mjs`.

**Current item:** the re-cut pass, now **routed by `pm`** (rows created 20:0x–20:1xZ from the delegate's intent):
**#5784** the ROADMAP 331 nesting fix, **#5787** `devtools` re-cut of the stale `item-5648` base, **#5791** the
`local2` landing act (`impl`), **#5794** `qa` told to verify the **re-cut tip** and to name the sha it ran against,
**#5796** the roster act re-issued after pm cancelled #5776 whose `blockedBy` named an id pm cancelled in the same
pass (pitfall 128's shape, self-caught). `item-5398` and `item-5648` cannot land until their re-cuts exist.

**Exact next command** (broker resident, ~70 s for the state read):

```bash
cd /home/chexxor/Git/Durian-Pi
DURIG_DB=./selfdev.sqlite node cli.mjs status          # attention + non-terminal work, broker-down safe
node scripts/test.mjs --all --jobs 6                   # 261/262 on main; only verifier-arm-probe red
node scripts/land.mjs item-5398 item-5648 --changed-suite   # ONLY after the re-cuts exist (#5787 and its siblings)
node .spike/delegate/context-window-health.mjs             # did the compaction failure count stop growing?
```

**The landing pass, re-measured against current `main` (not against the main the branches were cut from):**

| row | branch | tip | merge-tree vs `main` | note |
|---|---|---|---|---|
| **#5736** | `item-5736` | `ef5613ea` | **LANDED** — `git rev-list --count main..item-5736` = 0 | the `DURIG_MAX_CONCURRENT_SEATS` gate for `local/*` is on `main` via `4efce137` |
| **#5398** | `item-5398` | `6d5c126d` | **CONFLICT** (docs/NEXT.md), base stale (`merge-base --is-ancestor main item-5398` exit 1) — re-cut needed; no row routes it yet (`merge-base --is-ancestor main item-5398` exit 1) | the defect it fixes is live: `node scripts/clockin.mjs` prints "digest is 41,439 B, over its 20,000 B budget" and **exits 0** |
| **#5648** | `item-5648` | `8fb668ec` | **CONFLICT** (demo/test-areas.json), base stale | `grep -n "LOCAL2" src/config.mjs` on `main` → **no hits**; the registration is not there |
| **#5488** | `item-5488` | `ade0691a` | do **not** land | forks at `7a1b80e2`, renders D234's docs as deletions; #5736 is its current-base re-cut |

Per `docs/runbooks/land.md` Do 0b, a stale base is **a re-cut job for the author seat, not a merge job for the
delegate**. The delegate preflights, reports, and hands it back.

**Suite on current `main`:** `node scripts/test.mjs --all --jobs 6` → **261/262**, the single red is
`demo/verifier-arm-probe.test.mjs` (ROADMAP 294, cause pinned: the demo scrubs only `API_KEY|SECRET|TOKEN$` from
the environment while `tools/verifier-arm-probe.mjs` reads `durig.config.json` at the repo root, which on this host
legitimately carries `DURIG_VERIFIER_PRICE_USD_IN/_OUT`; the tool supports `--config=PATH`, the demo does not pass
it). `node scripts/clockin.mjs` exits **0** while over budget — that is #5398's job, and until it lands every
`--suite` landing is refused by a gate that cannot fire.

**Is the team operating? Yes.** 12 seats live; broker pid recorded in `selfdev.sqlite.broker.json`; 64 generations
completed in the last 30 minutes with none failed. Queue census (from `cli.mjs status`):
`done 4039, cancelled 858, held 435, deferred 384, claimed 15, queued 42`. The parked-wake defect N11 found
(`WAKE_CONTENT_PARKED` at `src/driver.mjs:55` tells a seat to "Check `status`", and no seat has a `status` tool) is
claimed by `architect` as **#5740**; its worktree `item-5740` is present and its cleanup is refused by the
junction guard — see pitfall 132.

**Capacity.** `DURIG_MAX_CONCURRENT_SEATS = 4` (D238) and, as of `4efce137`, the gate now covers `local/*`. Both
boxes serve `qwen3.8-flash-next-q2_0` (local `n_ctx 204800`, LAN `131072` text-only), so `local2` buys throughput,
not family independence. `8` concurrent remains the operator's call.

**Standing, deliberately unresolved:** the operator's *"We can re-evaluate later, whether we can afford to host a
verifier model on localhost again. Don't let us forget that we want to do that."* Still **no queue row** for it;
minting it is a seat act. Bounding number: RTX 3090 22,387/24,576 MiB (91 %) with eleven generations in flight.

**Broker posture at clock-out (measured 20:2xZ):** resident pid **3316329**, started 20:04:41Z with
`--max-duration 600`. Its last logged `PASS` is 20:11:27Z yet generations are still being created (newest
`pi.generation` id 406503 at 20:28:40Z, 3 slots held) — the ROADMAP 303 linger is *not* idle here, so
**do not kill it**; `serve --stop` correctly refused ("did not exit within the stop grace") while generations
were in flight. Before any landing, run `node tools/broker-serve.mjs --status` and prove the genlock is empty
of live generations — `scripts/land.mjs` refuses on a held slot (pitfall 134).

**Blocker:** #5651 (`pm`, held) is gated on #5488 and **#5605, which is `cancelled`** — a cancelled row cannot gate
anything (pitfall 128), so the gate must be re-pointed to **#5736** before the roster act can run.

**New traps this window** — `docs/SELFDEV.md` **130–133**: a spooled *read* intent makes `broker-serve --start`
refuse with `wake-not-acknowledged`; `--env-file` is not a flag that exists (pitfall 87's mechanism is gone, its
substance stands); a broker past `--max-duration` keeps its heartbeat and stops passing while holding genlock
slots; and the two N11 delegate probes were never promoted, so they no longer exist on disk.

**Probes left for promotion** (gitignored `.spike/`, all read-only, no model spend, broker-down safe):
`.spike/delegate/compaction-policy-probe.mjs` (resolves the policy through pi-durable's own resolver),
`.spike/delegate/context-window-health.mjs` (generation outcomes + compaction failure census),
`.spike/delegate/fleet-health.mjs`, `.spike/delegate/queue-census.mjs`. Promotion is a row from `lead` (#5617 is
the precedent id).

Full history of this pointer, verbatim: [docs/NEXT-ARCHIVE.md](NEXT-ARCHIVE.md).

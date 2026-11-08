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
   window: **145 generations completed, 0 failed** (per-seat in 15 min: devtools 46, impl 30, qa 16, scribe 6; only
   **1** wake said "nothing claimable for you" — pitfall 136). All-time generation outcomes (store, one query):
   54,353 completed / 16,589 failed / 333 aborted.
5. **Clock-in now hangs while the fleet runs.** `timeout 60 node scripts/clockin.mjs` → exit 124, 0 bytes; `cli.mjs
   status` and `cli.mjs queue --json --no-body` also time out; `cli.mjs config` answers in under a second. Cause
   measured in the tool: `scripts/clockin.mjs:399 runCli()` has **no `timeout`** while `gitSafe` at `:413` bounds
   every git call. Routed to `pm` (requestId `delegate-20261108-clockin-hang`). Until it is fixed, **clock in before
   starting the broker** — pitfall 135.
6. **`item-5737` landed mid-session** (`fb463162`) and the digest cap is now **run-verified, not just read**: with the
   broker stopped, `node scripts/clockin.mjs` printed **15,552 B and exited 0** (earlier the same day it printed
   41,439 B and exited 0 — the budget is 20,000 B). Check whether that makes `item-5398` a duplicate before landing
   it (pitfall 137).
7. **The verifier's window cannot hold the default policy — pure arithmetic.** `DURIG_VERIFIER_CONTEXT = 24576`,
   pi-durable defaults reserve 16,384 / keepRecent 20,000: headroom 8,192, keep budget **244 %** of it. That is why
   the store holds 240 records of "Summarization hit the token limit; the summary is incomplete". The local family is
   fine: `curl -H "Authorization: Bearer $DURIG_LOCAL_API_KEY" http://127.0.0.1:8080/v1/models` reports
   `qwen3.8-flash-next-q2_0`, `n_ctx: 204800`, matching `DURIG_LOCAL_CONTEXT`. Intent routed to `pm`
   (requestId `delegate-20261108-verifier-window`, log `INTENT delivered=1` at 21:12:11Z) — pitfall 142.
8. **Two seats fail for two different reasons.** Splitting the 426 failed `pi.compaction` records by conversation: all
   **209** `spend_cap_exceeded` refusals are the **auditor** (conversation 4936 — 216 of its 542 compaction attempts
   fail, 40 %), while the **214** truncations sit on the local-family seats (devtools 134, impl 42, lead 16, pm 10,
   auditor 6). Mechanism, from `pi-durable/dist/harness/compaction.js:95`: the summariser's output ceiling is
   `min(floor(0.8 * reserveTokens), model.maxTokens)` — 13,107 local, **6,000 verifier** because
   `DURIG_VERIFIER_MAX_TOKENS = 6000` clamps it. Nesting the override raises local to 16,384 and cannot move the
   verifier. Intent sent: `delegate-20261108-compaction-run-cap` — pitfalls 146, 148, 149.
9. **Two blockers that precede window size.** (a) Shape: `node tools/seat-turn-shape.mjs --db <copy>` — **impl, devtools,
   security, designer, advocate, qa2** are `AT RISK — a strict alternating template refuses another user turn before
   any window is reached`; pm, qa, lead, scribe, auditor `ADMISSIBLE` (intent `delegate-20261108-shape-before-size`).
   (b) Load: distinct `item-\d+` refs in each seat's last 200 entries — impl 108, qa 114, scribe 107, lead 89, auditor
   81, devtools 13, pm 12; impl's recent turns hop `item-3128` → `item-5675` → `item-5713`, one run four worktrees.
   The summariser is being asked to compress ~100 unrelated tasks, which is why it hits 13,107 tokens. 331's
   acceptance must include "one item's context per wake" — pitfalls 155, 157. Occupancy: auditor 23,091/24,576 (94 %); local seats 28–61 % of 204,800. And the store is held by one process: `ls -l /proc/<broker pid>/fd | grep -c selfdev.sqlite` = **5** handles (two sqlite connections), no other process — so `PASS-FAILED … database is locked` is self-contention, and `--max-duration 1800` did not stop pid 3521203 after **02:05:25** because duration, like `.stop`, is honoured only at a pass boundary (`src/broker.mjs:1651`). Intent `delegate-20261108-store-lock`.
4. **#5398 is LANDED** (this pass, after #5488): the clock-in digest's deferred list is **aggregated** instead of one
   inline row per item — **40,161 B → 15,013 B** measured on a snapshot of the live store (5,636 queue rows, 365
   deferred, 9 seats), ~11 s to re-run, **over budget is exit 1**, and the 365 ids are greppable at
   `.durig/clockin-deferred.txt` (`demo/clockin-digest.test.mjs` §8, `docs/runbooks/session-start-cost.md` §26–§28).

Host for everything below, measured in the same command as the measurements: **Linux**, Fedora Linux 45 (Forty Five),
kernel `7.2.15-300.fc45.x86_64`, node v24.22.1, git 2.56.0 — probe: `uname -s && uname -r && (. /etc/os-release &&
echo "$PRETTY_NAME") && node -v && git --version` (**never sign work with a hostname** — D205, ROADMAP 281).

**Window-pressure baseline (measured 21:3xZ, `selfdev.sqlite.spend.jsonl`):** 374 calls today, **$0.18432**,
3,661,636 prompt tokens / 287,337 completion tokens; median prompt 9,787, max 22,963; **67** calls above the default
`reserveTokens = 16,384`, **0** above the verifier's 24,576-token window. The overflow is the compaction step, not the
provider. Field names are `usd` / `prompt_tokens`, not `costUSD` (pitfall 145).

## NEXT SESSION

**Milestone this window worked** — **ensuring LLM task completion (D226)**, first tranche **ROADMAP 331**. N12 moved
it in one way: the mechanism is now measured end to end (config → `compactionSettings()` → harness defaults → 240
failed summaries on the verifier seat), and the operator's intent for the fix is **spooled to `pm`**
(requestId `delegate-20261108-context-window`), and `pm` turned it into rows #5784/#5787/#5791/#5794/#5796 within
 ten minutes. What it did NOT move: **this delegate session landed nothing** (its commits are docs-only: `2338f004`,
`47b18e74`, `a9c651b5`, `2362d20a`, `cba0ef3f`), and `grep -n "out.compaction" src/config.mjs` still shows the
override emitted as a sibling — `:455 if (Object.keys(policy).length > 0) out.compaction = policy;` with the
`modelOverrides` block below it — **ROADMAP 331 is not fixed**. `main` = **`cba0ef3f`** (`fb463162` landed
`item-5737` mid-session). Suite on that main: **259/262 passed in 74.3 s**, reds named: `next-pointer.test.mjs`
(fixed in `2362d20a`, the pointer must contain `node cli.mjs`), `seat-turn-shape.test.mjs` (a live-store sha pin that
races a driving broker — pitfall 138), `verifier-arm-probe.test.mjs` (open, unexplained by this session).

**Current item:** the milestone pass, **routed by `pm`** (read with `node cli.mjs queue --status queued --json
--no-body` at 21:1xZ — 56 queued, 13 claimed). The rows that matter to "task completion inside one window":
**#5785** `pm -> impl` — "ROADMAP 331 (milestone, load-bearing): nest the compaction overrides + per-family schedule,
gated on pi-durable's compaction"; **#5787**
`devtools` — re-cut `item-5648` onto current main; **#5786** `devtools` — disposition: is `item-5398` superseded by
#5737; **#5789** `devtools` — promote the two `.spike/delegate/` fleet instruments into `tools/`; **#5813 and #5814**
`devtools` — "CLOCK-IN HANG (milestone): bound `runCli()` like `gitSafe` and report unavailable reads in the digest,
failing-first" (**the same subject appears twice — verify they are not duplicates before either is claimed**); **#5802 / #5810** `lead` — landing entries for #5398 and item-5488;
**#5794** `qa` — verify the re-cut tip and name the sha. `item-5398` and `item-5648` cannot land until their re-cuts
exist.

**Exact next command** — the broker (`pid 3521203`, started 20:56Z, `--max-duration 1800`) stopped **passing** at
21:26:06Z while seat runs continue (generations still landing at 21:35Z on devtools/impl/qa). A `degraded` verdict from
`broker-serve --status` is **not** proof of a stall — read the newest `pi.generation` rows first (pitfall 144), and
never hard-stop while genlock slots are being created.

```bash
cd /home/chexxor/Git/Durian-Pi
node scripts/clockin.mjs                               # BEFORE starting a broker; it hangs while one drives
ls -1 selfdev.sqlite.genlock*                          # EMPTY => safe to stop; non-empty => a generation is in flight
node tools/broker-serve.mjs --stop                     # cooperative; expect "stopped": false on a lingered broker
# still alive and genlock empty =>  kill 3316329  then  DURIG_DB=./selfdev.sqlite node cli.mjs resume
set -a; . "$HOME/.config/durig/env"; set +a
node tools/broker-serve.mjs --start --max-duration 1800 --yes-pm-wakes   # a fresh broker drains the spool
grep -c "delegate-20261108-clockin-hang" selfdev.sqlite.broker.log       # did pm receive the intent?
git rev-parse --short main                             # expect 39081534 or newer (docs only from the delegate)
node scripts/land.mjs item-5648 --changed-suite        # ONLY after #5787's re-cut exists
node docs/evidence/2026-11-08-context-window/milestone-check.mjs       # THE gate: exit 0 only when the override
                                                     #   resolves, every window holds its policy, and no truncated/refused
                                                     #   compactions remain. Currently exit 1 with six named reasons.
node docs/evidence/2026-11-08-context-window/compaction-policy-probe.mjs  # must print reserve=20480 once #5785 lands
node docs/evidence/2026-11-08-context-window/read-path-probe.mjs --n=2 --timeout=8  # is the read path answering at all?
node docs/evidence/2026-11-08-context-window/milestone-check.mjs       # also prints the run-cap headroom: how many
                                                     #   compactions the resident broker can still afford (pitfall 156)
```

**Read-path caveat (22:12Z).** A CLI read does not open the store while a broker is resident — `src/readclient.mjs:106-111`
routes it to the broker. With the pass loop stalled (last pass 21:26:06.898Z, 11 `PASS-FAILED … database is locked
errcode=5` dated 2026-11-08 out of 23 in the cumulative log (pitfall 153)) every read verb blocks with 0 bytes: measured two reads at an 8 s cap,
then eight concurrent reads at 25 s, all exit 124, all empty — while a direct read-only sqlite query answered fine
(128,248 tasks). **"Empty queue" and "cannot read the queue" are the same output** — pitfall 152. Seats keep running
regardless (impl conv 9: 58 generations in 10 min, last 22:12:19Z), and `genlock` is empty while generations are
being created 11 s earlier, so it is not a safe-stop signal (pitfall 150). Spool: **21** pending intents, **56** dead
letters.

**The fix is already proven, so #5785 is a one-line change, not a design question.**
`pi-durable/dist/harness/compaction.js:196` does `const { modelOverrides, ...policy } = settings.compaction;` — the
map must live **inside** `compaction`. `src/config.mjs:488` currently emits `out.modelOverrides = layered`; nesting it
(`out.compaction.modelOverrides = layered`) makes the harness resolve `reserve=20480` — shown side by side in
`docs/evidence/2026-11-08-context-window/README.md` §5. The key must be spelled exactly
`local/qwen3.8-flash-next-q2_0`, because the harness matches `${provider}/${modelId}`.

**The schedule that makes the gate green, already checked against the shipped resolver** (`docs/evidence/2026-11-08-context-window/README.md` §9): local `reserve 20480 / keepRecent 20000` (fits 204,800, ceiling 16,384); verifier `reserve 6144 / keepRecent 8192` (fits 24,576, ceiling 4,915 ≤ 6,000). The override key is `openai/gpt-oss-120b`, not `verifier/openai/gpt-oss-120b`.

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

**New traps this window** — `docs/SELFDEV.md` **130–160**: a spooled *read* intent makes `broker-serve --start`
refuse with `wake-not-acknowledged`; `--env-file` is not a flag that exists (pitfall 87's mechanism is gone, its
substance stands); compaction failures are a record kind and the kind column is JSON-quoted; a broker past
`--max-duration` keeps its heartbeat and stops passing while holding genlock slots; **the clock-in digest hangs
while the fleet runs because `runCli()` has no timeout** (pitfall 135); wake counts from a stopped fleet are not
today's throughput (136); a landing can make an open row redundant (137); a live-store sha pin in a test races a
driving broker (138); the linger clears by exit and the digest budget now holds (140); **`SqliteStorage is closed`
is the dead-letter reason — confirm delivery from the log, not from `intent.mjs`'s `ok:true`** (141); and the default
compaction policy cannot fit the verifier's 24,576-token window (142).

**Probes left for promotion** (gitignored `.spike/`, all read-only, no model spend, broker-down safe):
`.spike/delegate/compaction-policy-probe.mjs` (resolves the policy through pi-durable's own resolver),
`.spike/delegate/context-window-health.mjs` (generation outcomes + compaction failure census),
`.spike/delegate/fleet-health.mjs`, `.spike/delegate/queue-census.mjs`. Promotion is a row from `lead` (#5617 is
the precedent id).

Full history of this pointer, verbatim: [docs/NEXT-ARCHIVE.md](NEXT-ARCHIVE.md).

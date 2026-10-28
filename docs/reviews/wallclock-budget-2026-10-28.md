# Where this rig's wall-clock actually goes — measured 2026-10-28 (delegate)

**Box and clock, because every number here is machine- and OS-specific:** Linux (`Alex-Desktop-Win10`, Fedora
`7.2.11-200.fc44.x86_64`), `node v24.22.1`, store `./selfdev.sqlite` (274,068 records; 137,427 entries; 105,610
tasks; 30,944 submissions), `date -u` at run = **2026-10-28T18:47:50Z**. Rig: `rig.selfdev.json` (12 seats, all on
`local/iq3_s`; `DURIG_VERIFIER_*` configured but unused by any seat).

**Instrument:** `node tools/latency-budget.mjs --db ./selfdev.sqlite` — **3.0 s, exit 0**, read-only (store opened
`readOnly:true`; `cli.mjs status` is a viewer, so it never wakes a seat). Raw output kept at
`.spike/latency-budget-2026-10-28.out`. Every count below is that instrument's output, with the pattern it printed.

## 0. The thing that made the last sessions' guesses useless: there are TWO currencies

Sessions argued about speed in units of **model tok/s**. The store persists two unrelated quantities, and they
disagree about where the time went:

| currency | what is persisted | measured | what it is NOT |
|---|---|---|---|
| **item latency** | `queueItems[].transitions[].at` (read through `cli.mjs status`, never through SQL — the queue is delta-encoded, `docs/runbooks/store-probe-identity.md`) | **6,339.1 h** summed over 3,748 done items; median **14.3 min**, p95 **7.2 h**, max **131.9 h** | not elapsed time — many items wait at once |
| **machine time** | `tasks.record.startedAt/endedAt` | **402.4 h** of generation busy time inside a **404.8 h** store span (`2026-10-11T20:22:56Z → 2026-10-28T17:10:14Z`) | not the model's fault: **51.1 h** is model calls, **18.0 h** tool calls, **15.9 h** compaction |

**Model speed is 12.7% of machine time.** Any plan that starts by buying a faster model is optimizing the small term.

## 1. Item currency: the workflow's wall-clock is WAIT, and it is mostly already fixed — by the resident broker

Decomposition the instrument printed (patterns: `queued|released|deferred → claimed` = WAIT, `claimed → done` =
WORK, `claimed → held` = HELD):

| stage | hours | share of item latency |
|---|---:|---:|
| **WAIT** — claimable, unclaimed | **4,377.3 h** | **69.1%** |
| **WORK** — `claimed → done` | 868.6 h | 13.7% |
| **HELD** — `claimed → held` | 472.0 h | 7.4% |

But WAIT is not one disease. Per-day claim-wait p50 (the throughput/latency curve, done-count then p50/p95):

```
2026-10-13   58 done   112.9m / 18.0h     2026-10-17  741 done   2.6m / 2.5h
2026-10-14   47 done   101.8m / 25.5h     2026-10-18  314 done   4.3m / 2.0h
2026-10-15  132 done   114.3m / 16.9h     2026-10-19  677 done   3.9m / 4.5h
2026-10-16  443 done    16.1m /  6.5h     2026-10-20  653 done   5.0m / 1.9h
                                       2026-10-21  494 done   5.4m / 1.4h
                                       2026-10-22   57 done   5.4m / 15.2h
```

The 2026-10-13→15 days (pre-`serve`, `run`-invoked eras) wait ~2 h per item and land 47–132 items; the resident-broker
days wait **2.6–5.4 min** and land **314–741** items. That is a **10–40× claim-latency difference and ~10× the daily
throughput**, measured on this store. **Keep the broker resident** (ROADMAP **209**, the cross-platform launcher;
**61–67**, the supervisor) is the single largest wall-clock lever this rig has ever demonstrated, and it is already
in the roadmap — the new fact is the size of the prize.

**The stall, stated flatly:** the last `done` transition in the store is **2026-10-22T17:29:11Z — 145.3 h before this
measurement**. Days 10-23 through 10-28 produced **zero completed items** while still burning 0.95 h and 20.4 h of
generation busy time on 10-23 and 10-24 (see §2: busy without landing).

## 2. Machine currency: 54% of elapsed time nothing was in flight, and 39% of the busy time is a black box

Wall-clock time by number of generations in flight (max observed 11; `durig.config.json` sets
`DURIG_MAX_CONCURRENT_SEATS=undefined`, `durig.config.default.json` ships `"1"` — precedence lives in
`src/config.mjs loadConfig`, and the observed profile is **not** single-flight, so do not "fix" the cap on the
strength of the default file):

| in flight | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7–11 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| wall-clock | **219.6 h** | 80.7 h | 45.4 h | 30.9 h | 12.7 h | 8.2 h | 5.6 h | 1.7 h |

**219.6 h of the 404.8 h span (54.3%) had no generation in flight at all.** That is the delivery channel not running
— the same fact the queue shows as zero landings, arriving from a different table. It is also why the persisted-seat-root
decision (ROADMAP **221**, D152) is a *wall-clock* decision, not a hygiene one: every hour it stays unresolved is an
hour from the 219.6 h column.

Generation durations (busy time, `endedAt - startedAt`):

| bucket | runs | share of runs | busy | share of busy |
|---|---:|---:|---:|---:|
| 0–5 s | 31,220 | 52.16% | 14.5 h | 3.6% |
| 5–30 s | 21,777 | 36.38% | 78.7 h | 19.5% |
| 30 s–5 min | 6,512 | 10.88% | 130.2 h | 32.4% |
| 5–10 min | 205 | 0.34% | 22.3 h | 5.5% |
| **≥10 min** | **137** | **0.23%** | **156.8 h** | **39.0%** |

The long tail is not long *work*. For each of those 137 generations the instrument counts the events the same
conversation committed inside its own window — the discriminator between **WORK** and **merely IN FLIGHT**:

```
gen #268436 seat=qa2      1212.1m events=3 outcome=failed  402: "You need positive balance…"
gen #30250  seat=advocate  631.5m events=3 outcome=completed
gen #30254  seat=scribe    629.6m events=2 outcome=completed
gen #12666  seat=qa        585.9m events=1 outcome=completed
```

A 10-hour "generation" that produced **one to three conversation events** spent its time waiting — on capacity, on a
provider retry, on a tool queue, or on the harness being dead. **Nothing in the product decomposes a running
generation's wall-clock**, so the 39% cannot be diagnosed from a surface; that is ROADMAP **225**.

Per-call latencies, for contrast: model calls (n=30,303) **p50 142 ms, p95 9.4 s, p99 2.1 min, max 2.0 h**; real tool
calls (n=13,988) p50 59 ms, p95 4.7 s, p99 2.9 min, max 28.8 min; compaction (n=1,459) p50 22.1 s, p95 1.3 min,
**max 1.5 h** (total 15.9 h — the price of context pressure, and the reason **208** matters).

## 3. Waste that no surface names: 24.4% of generations ended in a provider error

| outcome | runs | busy time |
|---|---:|---:|
| **402 "You need positive balance to do inference"** | **14,377** | 22.5 h |
| aborted | 195 | 35.8 h |
| 429 "Model busy, retry later" | 15 | 0.3 h |
| 400 "request exceeds the co…" (context) | 7 | 0.1 h |
| `Model deepinfra/… is not available` | 7 | 0.0 h |
| `Compaction failed: Summarization hit the token limit` | 7 | 0.2 h |
| **total** | **14,630 of 59,851 (24.4%)** | **59.2 h = 14.7% of busy time** |

Each of those 14,377 runs is a **wake**: a seat was admitted, its context was moved, and inference never happened.
`attention.last_run_failed` is per-seat and per-most-recent-run; nothing counts the burst, and nothing **stops waking
seats** while the provider is unfunded. ROADMAP **226**. (Corroborating store text: 18,309 entries contain
`402 "You need positive balance"` — D152 §4 — which is what made `tools/broker-serve.mjs --status` start probing one
real completion per provider.)

## 4. Context and prefill: 94.0% cache hits are what make 51 h of model calls possible — and how thin that is

Over 60,503 assistant turns: **fresh input 576,678,609 tokens, cacheRead 9,071,180,595 tokens → 94.0% cache hit**;
output 28,007,305 tokens. **23,053 prompts exceeded 150,000 tokens; the largest was 1,009,360 tokens** against a
`status`-declared window of 200,000 (`status.context.window.denominator = "declared"`, `candidates.measured = null`).
If the cache ever stops covering, cold prefill of the fresh-token volume at this box's measured **438–1,946 tok/s**
(`tools/model-probes/README.md`) is **82–366 h** — i.e. the rig is one cache-eviction policy away from being unable to
start. This is the honest reason to land **208** (the context-fraction guard) rather than debate model quality.

## 5. Tool time, with the zeros (the pattern that made 217 findable)

| tool | toolResults | errors | error rate | busy wall-clock |
|---|---:|---:|---:|---:|
| `powershell` | 20,286 | 2,176 | **10.73%** | **40.0 h** |
| `read` | 5,153 | 352 | 6.83% | ~0 |
| `claim_work` | 4,940 | 0 | 0% | ~0 |
| `complete_work` | 3,788 | 4 | 0.11% | 0.5 h |
| `send_work` | 2,588 | 13 | 0.50% | ~0 |
| `edit` | 1,872 | 214 | **11.43%** | ~0 (p95 12 ms) |
| **`bash`** | **0** | — | — | **this tool never appears in the store** |

Two readings. (a) The **shell is the most-used tool and the most expensive one** — 20,286 calls, 40.0 h, 10.73% of them
errors — so ROADMAP **218**'s "put one deterministic gate inside the turn" is cheap relative to what seats already
spend in the shell, and **217** (no shell at all on Linux) is not a nicety: the 40.0 h of capability goes to zero on
this box. (b) `edit` costs ~12 ms — the edit *machinery* is not a wall-clock problem, its 11.43% error rate is a
correctness problem (**215/216**), so do not trade hours for it.

## 6. The ranked removal list (ranked by measured hours, not by intuition)

1. **Keep the channel resident — 219.6 h of 404.8 h idle; landings 314–741/day at 2.6–5.4 min claim-wait vs 47–132/day
   at ~2 h.** Items: **209** (Linux/Windows launcher), **61–67** (supervisor), and *today* the operator's decision on
   **221** (persisted seat root) plus **217** (seat shell), because a broker that cannot run a command is a broker that
   cannot land anything. Nothing else in this list matters while this one is open.
2. **Decompose a running generation's wall-clock, then cut the 156.8 h long tail (39.0% of busy time, 137 runs that
   produced 1–3 events).** New: **225**.
3. **Stop burning wakes on a dead provider: 14,377 generations on one 402, 59.2 h of error-ended busy time (14.7%).**
   New: **226**.
4. **Drain the parked backlog instead of re-auditing it every session: 277 `held` rows idle a median of 213.5 h
   (max 289.7 h), 19 `deferred` a median of 145.1 h — and `queue-drain-audit` measures 71 of the 277 as already fully
   on main (zero-build closable, 26% of held).** The logic exists only as a delegate instrument plus human diligence.
   New: **227**.
5. **Make the queue readable: `cli.mjs status` prints 22,748,093 bytes (~2 s) on every read** because it serializes
   all 4,821 rows with full bodies, and `watch`/`tui`/every scripted delegate pays it each pass. New: **228**.
6. **Hold the line on context, not on model quality: 23,053 prompts >150 k, max 1,009,360 vs a declared 200,000;
   15.9 h of compaction; 82–366 h of exposure if the 94.0% cache hit falls.** Item **208**.

**What would falsify this ranking:** if the next resident-broker period (the first real Linux run) shows claim-wait p50
back above ~30 min or landings near zero with generations in flight, then item 1 is mis-ranked and the ceiling is
capacity (item 2) rather than channel uptime. If a broker start logs `STRANDED`/`RECONCILE` and the 137-generation
long tail disappears from the next measurement, 225's premise (that the time is un-attributable waiting) is partly
wrong and the tail is downtime, not an attribute problem. Re-run the instrument after the channel has been up for a
day and compare — that comparison is the test of this document.

## 7. The delegate's own wall-clock (operator's clock-out item 5)

Measured costs of what a session spends its own turns on, this box, this run:

| action | cost | note |
|---|---:|---|
| `node scripts/test.mjs --all` | 41–55 s at 8 jobs (276.8 s serial) | already parallel; the `--jobs` default is pinned by a demo |
| `node tools/latency-budget.mjs` | **3.0 s** | new; replaces ~1 h of ad-hoc store probing |
| `node cli.mjs status` | ~2 s, **22.7 MB** | the read behind everything; **228** asks for a projection |
| `node tools/broker-serve.mjs --status` | 2.8–3.4 s | includes one real completion per provider |
| `node tools/queue-drain-audit.mjs` | 0.9–1.0 s | do not re-run the 4-minute manual audit |
| `node scripts/clockin.mjs` | 2.6 s, 14,542 B | under its 20,000 B cap again; still names no proof commands (**213**) |
| `node tools/text-integrity-scan.mjs --kinds` | 3.5 s | 42 committed files carry latent byte faults (211) |
| `node --check <file>` | **0.02 s** | see the pitfall below |

**Pitfall worth keeping, because it cost ~6 minutes of wall-clock and would have cost the next session the same:** a
`tools/` instrument failed to parse with `SyntaxError: Missing } in template expression`, and the same template line
parsed fine in a standalone file — so the error was in the *context*, not the line. Diagnosis by eyeball lost time;
`node --check tools/<file>.mjs` finds it in 0.02 s and points at the line. **Habit to adopt: `node --check` any tool
file immediately after writing it, before running it** (a demo for the product-side half of "a tool that will not parse
should not be attempted" is not worth an item — this is a workflow habit, recorded here and in `tools/README.md`).

Second habit, already paying for itself: **check the index before writing a probe.** `tools/README.md` exists because
two prior sessions re-derived reads that had shipped. The instrument in §0 is the answer to the question "where does
the time go", and it now costs 3.0 s instead of the ~1 h of SQL spelunking it replaces (including the `store-probe-identity`
traps: stored enum strings carry embedded quotes, so a SQL `kind='pi.generation'` predicate matches nothing — the
instrument reads every task row and strips the quotes in JS with `unq()`).

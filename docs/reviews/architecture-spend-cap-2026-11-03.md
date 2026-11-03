# Spend cap and cost ledger — the seam, the values, and what a tripped cap does to a seat (#5015)

**Status of this document:** a design decision plus a buildable spec. It builds the *guard's guard* (an
acceptance probe, `tools/model-probes/spend-cap-acceptance.mjs`) and changes **no** product path. The build
is devtools'/impl's, routed as queue rows at the end.
**Tree every number below was measured in:** the item worktree `item-5015` at `a65ba431` (my seat root
`/home/chexxor/Git/durian-dev/seatroot`, a linked worktree of `/home/chexxor/Git/Durian-Pi`). This tree has
`node_modules`, so the suite verdict is comparable with the delegate's: `node scripts/test.mjs --all` →
**248/248 in 50.7 s, exit 0** before anything I added.
**Axis discipline:** every number below is labelled **tokens**, **USD**, **USD-per-call**, **turns**, or
**MiB**. A token count is not a cost; a cost is not a budget.

---

## 1. Topology: who can spend, and through which seam

```
                       seat turn                    probe run
  cli.mjs send/up/run/serve ──┐                tools/model-probes/*.mjs ──┐
                              │                                          │
  pi-durable compaction ──────┤  (a summarization request IS a model     │
  (summary of the prefix)     │   call at the seat's own model)          │
                              ▼                                          ▼
                 cli.mjs:344-391  buildModels()            tools/model-probes/metered.mjs
                 ─ deepinfra provider (default)            ─ meteredChat(): auth, ceiling,
                 ─ local + verifier providers                        ledger  (ACCOUNTED)
                 ─ wrapProviderWithSlots → wrapProviderWithTrace
                              ▼                                          ▼
                     provider HTTP (/chat/completions)          four probes that still
                              ▼                                 post their own fetch
                    api.deepinfra.com  |  127.0.0.1:47831       (UNACCOUNTED, pinned)
```

Facts I read, with `path:line`:

1. **There is exactly one provider seam, and the rig already exploits it.** `src/providers/trace.mjs:16-18`
   states and `cli.mjs:362-371` (deepinfra) plus `cli.mjs:385-391` (the two local providers) show: every run
   path — `send`, `up`, `run`, `serve`, the optimizer — passes through `wrapProviderWithTrace`, applied at
   `buildModels`, "so one line covers all of them and cannot drift". The trace hook is pi-ai's
   `ProviderRequestOptions.onPayload(payload, model)`, called **after `buildParams`, before the HTTP call**
   (`src/providers/trace.mjs:11-13`). That is precisely the position a spend guard needs: it sees the request
   payload (message bytes, `max_tokens`) and the resolved model row (`cost`, `contextWindow`, `maxTokens`)
   before anything is spent.
2. **Three cost rows say `$0` about money-bearing calls.**
   - `src/providers/local.mjs:159` — every locally-built provider row, including `verifier/`, is
     `cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }`, unconditionally, whatever `baseUrl` is.
   - `cli.mjs:330-339` — when `DURIG_MODEL` is not in the curated fallback list, `buildModels` synthesizes a
     DeepInfra row with `cost: {0,0,0,0}`, `contextWindow: 128_000`, `maxTokens: 8_192` — an invented row on
     the **metered** provider.
   - `src/providers/deepinfra-models.ts:96-118` maps the real catalog prices, and
     `fetchDeepInfraModels` (`:129-138`) is **not wired into `buildModels`** (`cli.mjs:327` calls
     `fallbackModels()`), so the only live-price path is unused. Curated fallback = 16 rows
     (`src/providers/deepinfra-models.ts:148-189`); the live catalog today has **91** chat-tagged models
     (measured, §6).
3. **`isLocalProviderId` is a *free* predicate, not a *local* predicate.** `src/providers/local.mjs:45-47`
   returns true for `verifier`; the module header (`:12-14`) calls that id "free context, cheap reset, no paid
   API". Its consumer `src/broker.mjs:114` uses it to decide the D105 between-items context reset
   ("NON-LOCAL seats are UNCHANGED (D105: paid seats keep their durable context)"), and
   `src/readapi.mjs:231,371` uses `declaredLocalWindow` to publish the seat's capacity. So the id drives
   *behavioural* assumptions (reset policy, advertised window), not just a label.
4. **The credential the rig reads is not the credential the operator set.** `src/providers/local.mjs:88`
   builds `apiKeyEnv = "${prefix}API_KEY"` → `DURIG_VERIFIER_API_KEY`, and `:145-147` falls back to the
   literal `"local-placeholder"` when it is unset — i.e. a non-loopback verifier endpoint pointed at DeepInfra
   sends `Authorization: Bearer local-placeholder` and eats a 401 that reads as a model failure.
   `src/providers/deepinfra-models.ts:24-26` is where `DEEPINFRA_API_KEY` is the working name (default
   provider, `src/config.mjs:480` `DURIG_PROVIDER ?? "deepinfra"`).
5. **The accounted probe path already exists and is a good one.** `tools/model-probes/metered.mjs`
   (`meteredChat`, `authFor`, `priceFor`, `projectCostUsd`, `assertCeiling`, `ledgerRow`,
   `spendTotalUsd`, `formatRunTotal`) refuses unkeyed-to-metered-host before sending, refuses a projected
   crossing before sending, and appends one JSONL row per call with 14 pinned fields and a named
   `priceSource` (`snapshot:<file>` / `env` / `none`), with `usd: null` for unknown — never `$0.00`.
   `demo/probe-metered-ledger.test.mjs` pins the field list (§5) and the refusal-as-"the stub saw 0 requests"
   (§3, §4, §8).
6. **Four call sites are still un-accounted** (measured line numbers, same set the demo pins as
   known-unaccounted at `demo/probe-metered-ledger.test.mjs:422-447`):
   `tools/model-probes/calibrate-verifier.mjs:42`, `cold-prefill.mjs:53`, `stream-probe.mjs:13`,
   `throughput.mjs:24` and `:30`. All five post `fetch(\`${baseUrl}/chat/completions\`)` with
   `{"content-type":"application/json"}` and no `authorization`.

---

## 2. The classification decision (#5015's real question)

**Ruling: locality is a property of the endpoint, not of the provider id.** A provider whose `baseUrl` is not
loopback is **metered** whatever its id says, and "metered" carries three obligations that `verifier/` today
does not meet: a **price row with a named source**, a **ledger row per generation**, and a **cap that is
declared before the call**.

Concretely:

- **D-5015.1** Keep `LOCAL_PROVIDER_IDS`/`isLocalProviderId` meaning *locally served* only for loopback
  endpoints. Reuse the predicate `metered.mjs` already ships (`isLoopback`, `tools/model-probes/metered.mjs:64-80`)
  and lift it to the provider layer rather than inventing a second one. A `verifier/` provider pointed at
  `https://api.deepinfra.com/v1/openai` must classify as metered: the reset policy at `src/broker.mjs:114`
  must then treat it as a paid seat (keep durable context), and `cli.mjs config`/`readapi` must report it as
  metered, not free.
- **D-5015.2** A non-loopback provider row may not carry `cost: {0,0,0,0}`. Either the row's cost comes from a
  **named, dated source** (a snapshot file, `snapshot:<path>` + `priceAsOf`, exactly the `priceFor` discipline
  at `metered.mjs:85-115`) or the row is **refused at registration** with a message that names the model, the
  endpoint and the missing variable. An unpriced metered row must not be constructible, because `assertCeiling`
  has only two honest outcomes for it: refuse, or admit it cannot price the call.
- **D-5015.3** The synthesized row at `cli.mjs:330-339` is the worst instance of this class and should be
  **deleted**, not extended: it invents `cost: 0`, a `contextWindow` (128,000) and a `maxTokens` (8,192) for a
  model nobody priced. If an arbitrary `DURIG_MODEL` id must keep working, it works by being **priced** — from
  the snapshot, or by a live catalog read the operator opted into — and otherwise resolution must fail with
  `no_model` plus the price-source remedy. `no_model` before a request is a cheap, honest failure; `$0` on a
  metered row is an expensive lie that also makes the ceiling unenforceable.
- **D-5015.4** `DURIG_VERIFIER_API_KEY` is the key the provider reads; `DEEPINFRA_API_KEY` is the key
  `cli.mjs config` advertises as `set`. The config report must say **which variable the resolved provider
  actually reads**, and a metered provider with no resolvable key must refuse at startup (the `meteredChat`
  shape: name the cause, name the variable), not send `Bearer local-placeholder`.

Rejected alternative (recorded because someone will propose it): *rename the provider id* (e.g. `mverifier`)
so `isLocalProviderId` stops matching. That treats the symptom — a seat pointed at a metered endpoint under any
id still has a `$0` cost row and no ledger — and it silently changes the D105 reset policy for real local
seats. Classify by endpoint, not by name.

---

## 3. Where the cap goes (options, trade-off, decision)

**Option A — admission control (refuse the *wake*, not the call).** The scheduler/broker computes the
projected cost of the next turn before admitting it and does not start the turn.
*For:* nothing is spent and, critically, **no `pi.user` entry is appended** — the rig's own worst trap
("a failed `send` already appended a user turn; a second one compounds it",
`docs/runbooks/verifier-serving-headroom.md` §5, and D196's `1 more pi.user entry`).
*Against:* the projection at admission must be computed from a store read (the replay window) rather than from
the built payload, so it is an estimate, and the estimate is only as good as the token count it reads.

**Option B — provider-seam guard (refuse the *call*).** One wrapper next to `wrapProviderWithTrace`
(`cli.mjs:362-371`, `:385-391`) with the same `onPayload` hook the trace already uses.
*For:* exact payload, exact model row, one place, covers `send`/`up`/`run`/`serve`/optimizer **and pi-durable's
compaction summarization**, which is a model call at the seat's model and therefore spends money too.
*Against:* a trip lands **mid-turn**. The damage is bounded and diagnosable but not zero — see §5.

**Option C — per-call-site guards (what exists today, probe side only).**
*For:* no product change; already proven by `demo/probe-metered-ledger.test.mjs`.
*Against:* four un-accounted sites (§1.6) and every seat path uncovered. This is where the rig is now, and it
is not a policy, it is an instrument.

**Decision: B as the enforcement seam, A as the preferred *actuator*, C closed out by migration.** B is
mandatory because it is the only position that cannot drift and the only one that sees the compaction call.
A is added because B alone converts a money stop into a failed seat turn, which is the failure the rig has
already been dying of (D196). The pairing is the design: *A keeps the store clean, B makes the money stop
exact, and B's trip must settle legibly rather than as `model_error`.*

One policy, two enforcement points, one ledger. The ledger must not fork: the seat guard writes the same 14-field
row (`metered.mjs` `ledgerRow`) to the same file (`DURIG_SPEND_LEDGER`, default `.spike/gate/spend.jsonl`), and
the cheap read stays `spendTotalUsd(path) → {totalUsd, rows, unknownCostRows}`. Do not build a second ledger,
and do not assume a row-scoped queue read exists (#5016 is not built).

**Where the cap VALUE is read from, and the worktree trap.** `durig.config.json` is gitignored
(`.gitignore:8`), so it **does not exist in any item worktree** — measured: `probe-preflight.mjs` run from
`item-5015` printed no declared verifier ctx/max-tokens at all, because its inputs come from that file
(the same class as D198b's "a thin item worktree cannot see the rig"). A cap that lives only in the gitignored
file is therefore **absent exactly where seats do their work**, and its absence reads as "no guard armed"
(`metered.mjs` `formatRunTotal` says `no DURIG_PROBE_CEILING_USD declared`). So the cumulative and per-run
caps belong in the **tracked** defaults file (`durig.config.default.json`, currently 3 keys: `DURIG_DB`,
`DURIG_MAX_CONCURRENT_SEATS`, `DURIG_OPTIMIZE`) with the environment able to raise them per run. Rationale:
a guard's default must exist in every tree; only the *raise* should be local.

---

## 4. The values (the two things devtools left me)

The operator granted **$4.00** to DeepInfra and ruled the rig is not to be halted (D193). `lead`
pre-authorizes **$0.10 per probe session** (#5015 body). Those two numbers fix the caps; I am not free to
invent a third, so every value below is derived from them.

**Cap keys (all three, per-run and cumulative, in one place):**

| Key | Default (tracked) | Meaning / axis | Who may raise it |
| --- | --- | --- | --- |
| `DURIG_SPEND_CAP_CALL_USD` | `0.05` | per-call **projected** USD ceiling; a call whose projection crosses it is refused before send | raise per session, must be named |
| `DURIG_SPEND_CAP_RUN_USD` | `0.10` | per-process **cumulative** USD (this is `lead`'s pre-auth, promoted to a key) | operator for a named run |
| `DURIG_SPEND_CAP_STORE_USD` | `4.00` | cumulative USD over the ledger for this store — the operator's pool | **operator only**; a seat may not raise it |

`DURIG_PROBE_CEILING_USD` (shipped by #5024) stays as the **run** cap's probe-side spelling; the build should
map it onto `DURIG_SPEND_CAP_RUN_USD` rather than add a third name. Two vocabularies for one budget is how
`DURIG_VERIFIER_API_KEY`/`DEEPINFRA_API_KEY` came to advertise a credential that is never read.

**Why $0.05 per call, from the provider's own rows (measured live 2026-11-03, catalog snapshot
`.spike/5015/catalog-2026-11-03.json`, HTTP 200, no key, no inference):**

Worst-case exposure of **one** call, computed from the row's own declared maxima at
`(context_length × $in + max_tokens × $out)/1e6`, in **USD per call**:

| row (live) | ctx (tokens) | max_tokens | $in / $out per Mtok | worst-case one call |
| --- | --- | --- | --- | --- |
| `zai-org/GLM-5.3-Flash` (the **shipped default** seat model: `cli.mjs:153`, `src/config.mjs:481`) | 1,048,576 | 1,048,576 | 0.15 / 0.50 | **$0.6816** |
| `deepseek-ai/DeepSeek-V4-Flash-0731` | 1,048,576 | 1,048,576 | 0.06 / 0.18 | **$0.2516** |
| `openai/gpt-oss-120b` | 131,072 | 131,072 | 0.037 / 0.17 | $0.0271 |
| `openai/gpt-oss-20b` | 131,072 | 131,072 | 0.030 / 0.14 | $0.0223 |
| `mistralai/Mistral-Small-3.2-24B-Instruct-2506` | 128,000 | 128,000 | 0.075 / 0.20 | $0.0352 |

So on a 1M-context row a single pathological call can eat **17 % of the pool** ($0.6816 of $4.00); on a
128–131k row the worst case is self-limiting at ~0.6 % of it. That is the ordering rule: **pick a row whose own
max exposure is small, and let the ceiling be the second line of defence, not the first.** A per-call ceiling
of $0.05 sits *below* the exposure of both 1M-context rows (so it binds) and *above* the worst case of the
131k rows (so it never fires on a full-context call at those rows): it is a guard against the 1M-class rows
and against a runaway prompt, not a rationing device.

**The pool's unit is turns, and the prompt is the lever** (axis: USD per turn, at this rig's measured shape
55,538 in / 3,000 out — `docs/runbooks/verifier-model-server.md`, "the numbers that decide the window").
Recomputed from today's live catalog, and reproducing D193's table:

| row | USD per turn | turns bought by $4.00 |
| --- | --- | --- |
| `openai/gpt-oss-20b` | $0.002086 | 1,917 |
| `openai/gpt-oss-120b` | $0.002565 | 1,560 |
| `deepseek-ai/DeepSeek-V4-Flash-0731` | $0.003872 | 1,033 |
| same, ~80 % prefix-cached at $0.015/M | $0.001873 | 2,135 |
| `mistralai/Mistral-Small-3.2-24B-…` | $0.004765 | 839 |
| `zai-org/GLM-5.3-Flash` (**shipped default**) | $0.009831 | **407** |

Two consequences that belong in the durable record:

- **A compaction is a metered event, and the shipped default makes it expensive.** The summary request's
  prompt is the conversation up to `window − reserveTokens`; with a 200,000-token declaration and pi's default
  `reserveTokens 16384` that is up to 183,616 tokens, and the summary's output budget is
  `min(0.8·16384, maxTokens) = min(13,107, maxTokens)` (D196, `compaction.js:95`). In **USD per compaction**:
  `$0.0341` on `GLM-5.3-Flash` versus `$0.0073` on `gpt-oss-20b`. At the default row, **one compaction costs
  ~3.5 verify turns.** Nobody has printed that number before; it is the reason the cap must count
  compaction calls (which Option B does by construction).
- **Cached-prefix runway is only real if the prompt is prefix-stable.** The cache-read price exists on
  `GLM-5.3-Flash` ($0.03/M), `DeepSeek-V4-Flash-0731` ($0.015/M), `Qwen3.6-35B-A3B` ($0.10/M = its input price,
  so caching buys nothing there) and is **absent** on `gpt-oss-20b`, `gpt-oss-120b` and `Mistral-Small-3.2-24B`
  (measured: no `cache_read_tokens` key → `mapCatalogModel` falls back to the input price,
  `deepinfra-models.ts:103`). So the "2,135 turns if 80 % cached" line is **conditional on the verify prompt
  being built with a stable prefix**, and for the `gpt-oss` rows cache pricing is not available at all —
  quoting cached runway at those rows is fiction. Whether the verify prompt is prefix-stable is a build
  question the spec asks for (§7, probe P6), not an assumption.

**The OTHER price source is worse: the curated fallback table is tracked, hand-maintained, and dated by
comments.** `buildModels` reads `fallbackModels()` (`cli.mjs:327`, defined at
`src/providers/deepinfra-models.ts:147`) — 16 rows — and `fetchDeepInfraModels()` is **not wired in** (the file's
own comments say so at `:152-154`, `:158-161`, `:181-184`). Diffed against the same dated snapshot (axis: USD per
Mtok, tokens, USD per maximal call):

| curated row | declared `$in/$out` | live `$in/$out` | declared ctx | live ctx | verdict |
| --- | --- | --- | --- | --- | --- |
| `deepseek-ai/DeepSeek-V4.1-Flash` | 0.14 / 0.28 | **0.20 / 0.60** | 1,048,576 | same | **under-declared 1.4× in, 2.1× out** |
| `deepseek-ai/DeepSeek-V4-Flash-0731` | 0.09 / 0.18 | 0.06 / 0.18 | 1,048,576 | same | over-declared in (harmless direction) |
| `mistralai/Mistral-Small-3.2-24B-Instruct-2506` | 0.075 / 0.20 | same | **131,072** | **128,000** | window over-declared by 3,072 tokens |
| `google/gemini-3.1-pro` | 2.00 / 12.00 | same | 1,000,000 | same | **worst-case one call = $14.00 = 3.50× the entire $4 pool** |
| `DeepSeek-V3-0324`, `Qwen3-235B-A22B-Thinking-2507`, `Llama-3.3-70B-Instruct`, `Llama-4-Maverick-17B-128E-Instruct-FP8` | — | **not in the live catalog** | — | — | a seat naming them cannot be served (and `Llama-4-Maverick`'s declared geometry is itself **$1.05** per maximal call) |

That is the argument for the **per-call projected cap** stated in the sharpest available form: one row in the
tracked table can cost **$14.00 for a single call**, i.e. **3.5× the operator's whole grant**, and no cap set at
the run or store level prevents the *first* call from doing it — only a per-call projection refuses it before
the wire. It is also the argument for the drift control (probe **P6b**): the table's dates are comments
("values fetched from the live catalogue (2026-10-11)"), and a comment is not a control.

And the mapper has the same `$0` defect as `local.mjs:159`, in a third place:
`mapCatalogModel` sets `inputPrice = round4(pricing.input_tokens ?? 0)` and `outputPrice = … ?? 0`
(`deepinfra-models.ts:101-102`) — a live row with no published price becomes a **metered row that claims $0** —
and it invents `contextWindow … ?? 128_000` / `maxTokens … ?? 4096` (`:116-117`) when the catalog omits them.
The cache-price fallback at `:103` (`cache_read_tokens ?? inputPrice`) is at least honest: no published cache
price means no discount.

 
**Is a refused call ledgered?** **No — keep devtools' choice, and do not change that demo.** The ledger is a
money record; `spendTotalUsd` sums it, and `unknownCostRows` already carries an important, different meaning
(an unpriced *actual* call). A refusal must still be attributable, and the rig already has a row-scoped,
queryable event channel for that: the store's submission `detail` (the mechanism D196 used to diagnose the
compaction failure) plus an attention kind, and on the probe side the thrown `CeilingError` message and the
run's printed total. Money → ledger; stop → store/attention/stderr. Never fold the two into one file.

---

## 5. Failure modes, each with a recovery path

| # | Failure mode | What it looks like | Recovery path (must be built) |
| --- | --- | --- | --- |
| F1 | **Hard: cap crossed mid-generation** (Option B trip after the seat's own call was built) | seat turn ends with no answer; today the shape is `unanswered / model_error` (D196) | settle `unanswered` with cause class **`spend_cap_exceeded`** and a `detail` naming cap, spent total, projected line; the item **stays `claimed`** and is **parked** with block reason `resource`, resolver `operator`, `reviewBy`; supervisor must **not** retry it (see F2) |
| F2 | **Loop: the retry policy spends again** | three retries of the same call → three times the exposure, then `repeated_failure` escalation (D194) | `CeilingError` is classified **non-retryable at the provider layer** (never a "model error"); the supervisor counts it once and escalates to the operator immediately, not after 3 strikes |
| F3 | **Silent: `$0` cost row on a metered provider** | `cli.mjs config` and any cost read show a free provider that is billing | D-5015.2 registration refusal; a `check` rule `metered-without-cap` (fix-now) — metered endpoint + no cap declared + no dated price source |
| F4 | **Silent: guard absent because the file is absent** | a seat in an item worktree has no cap because the cap lives in gitignored `durig.config.json` | caps default in the **tracked** `durig.config.default.json`; every report line states the source of the cap value, and `formatRunTotal` already prints "no ceiling declared" as a fact |
| F5 | **Partial: the cap trips on the *compaction* call** | the seat dies at the summarization request, zero counted tokens — the D196 failure with a money cause instead of a budget cause | the admission check (Option A) includes the projected compaction cost in the next-turn projection; and a cap trip on a compaction must report `spend_cap_exceeded` on the compaction's own three-state output (`cli.mjs:1357-1384`), not the generic no-compaction message |
| F6 | **Contradiction: two totals disagree** | probe ledger and seat ledger differ; a reader sums one and reports the whole run | one ledger file and one row format (§3); the printed per-run total is read back **from the ledger** (`gate.mjs:600-603` already does this), never from an in-memory accumulator |
| F7 | **Cascade: an un-accounted probe spends without a record** | a decision gets cited with no bill (D193 made paid decisions with no ledger) | the four sites (§1.6) move onto `meteredChat`; `demo/probe-metered-ledger.test.mjs:422-447` narrows its pinned set **in the same commit** as each migration, so a silent half-migration shows as red |
| F8 | **Cascade: price drift** | a cap computed against a stale price passes a call that is actually over the cap (#5014) | every row names `priceSource` + `priceAsOf`; `assertCeiling` already refuses unpriced-under-cap; add a staleness line to `cli.mjs config` when `priceAsOf` is older than the price-snapshot's own declared max age |
| F9 | **Context: the projection under-prices** | `projectCostUsd` estimates prompt tokens at **chars/3** (`metered.mjs:136-145`), which is above `corpus.mjs`'s calibrated 2.7 chars/token — fine as a guard, wrong as a measurement | keep the crude estimate **declared as a guard input**, and after the call prefer the provider's `usage`; D193 also records that DeepInfra returns `usage.estimated_cost` per response — carry it in the row (a new field is a schema change, so it lands with a deliberate pin update) |
| F10 | **Hard: the provider is unreachable** | `fetch failed`, or DNS empty; D193(9) measured outbound dying for ~25 min while local seats stayed healthy | not money, but it is the same seam: distinguish "no key", "no route", "refused by vendor" in one message class, and record that a metered provider makes **network egress a seat dependency** (no runbook exists for general outbound loss — D193(9) names the gap) |

---

## 6. Falsifiable probes (this is the part that makes it architecture, not opinion)

`tools/model-probes/spend-cap-acceptance.mjs` runs every probe below against a **loopback stub in-process**
(never a provider, never the operator's key) and prints the measured verdict plus its axis. It is deliberately
**not** a `demo/` member: several probes are red today by design, and the suite is the rig's oracle — a design
item must not turn it red. Running it now, in this tree:

```bash
node tools/model-probes/spend-cap-acceptance.mjs --snapshot .spike/5015/catalog-2026-11-03.json
# exit 1 — 2/11 acceptance claims hold, 9 RED (the expected failing-first state)
# P1 mechanism half is GREEN: "threw CeilingError and the stub saw 0 new requests"
# P5b, P6 GREEN (the numbers and the cache-pricing honesty rule)
# P6b RED by exactly one row: google/gemini-3.1-pro declared $2/$12 at 1,000,000 ctx = $14.00 per maximal
#        call = 3.50x the operator's whole $4 grant, plus 2 rows priced >25% away from the dated snapshot
#        and 4 rows the live catalog does not carry at all
```

The snapshot is `curl -s https://api.deepinfra.com/v1/openai/models` (HTTP 200, **no key, no inference** — the
catalog endpoint is public per `src/providers/deepinfra-models.ts:16`), fetched **2026-11-03** and stamped
`fetchedAt`; it lives under gitignored `.spike/`, so the script prints a SKIP line with the fetch command when
the file is absent rather than presenting prices as current. The build is done when the script exits 0.

| probe | claim it settles | today |
| --- | --- | --- |
| P1 | the seat provider seam refuses a projected crossing **before** the request (stub request count unchanged) | **RED** at the seat seam — **GREEN** for the mechanism (`meteredChat` threw `CeilingError`, stub saw 0 new requests) |
| P2 | a metered (non-loopback) provider with `cost: 0` **cannot be registered** | **RED** — `local.mjs:159` and `cli.mjs:336` |
| P3 | the caps exist in a **tracked** file, so an item worktree has them | **RED** — `durig.config.default.json` carries no spend keys |
| P4 | ledger rows written by the seat path and the probe path have the **same 14 keys** | **RED** (no seat path) — pin becomes green and stays green through the migration |
| P5 | the per-store cumulative cap refuses the call that would cross **$4.00**, and the message names cap / spent / projected | **RED** — only a run cap exists |
| P6 | the printed per-call row carries `priceSource` + `priceAsOf`, and a **cache-read price is claimed only where the vendor publishes one** | **GREEN** for `priceSource`; the cache claim is a report rule to build (measured: `gpt-oss-20b/-120b`/`Mistral-Small` have no `cache_read_tokens`) |
| P6b | no **curated** row's declared geometry can spend more than the store cap in one call, and curated prices match a dated source within 25 % | **RED** — `google/gemini-3.1-pro` = **$14.00** per maximal call (3.50× the cap); `DeepSeek-V4.1-Flash` priced 1.4–2.1× under the snapshot; 4 curated rows absent from the live catalog |
| P7 | a cap trip is **not** classified as a retryable model error | **RED** — no classification exists |
| P8 | the four un-accounted probe sites are on the accounted path | **RED** — pinned as known-unaccounted at `demo/probe-metered-ledger.test.mjs:422-447` |
| P9 | a metered provider with no resolvable key **refuses at startup** instead of sending `"local-placeholder"` | **RED** — `src/providers/local.mjs:145-147` |

Plus two numbers pinned as data, green now (they are what the cap values are derived from, so they must be
re-runnable rather than remembered): the per-row worst-case single-call exposure table, and the per-turn
runway table, both recomputed from a dated snapshot. `spend-cap-acceptance.mjs` prints them with the snapshot
path and its fetch date; if the snapshot is older than `DURIG_PROBE_PRICE_MAX_AGE_DAYS`, it says so instead of
presenting the prices as current.

Constraint honoured: no test in this work imports `gate.mjs` (it has no import guard — importing it runs the
gate and spends GPU/API, which is how #5027's defect survived 24 runs; pinned at
`demo/probe-metered-ledger.test.mjs:398-403`). `spend-cap-acceptance.mjs` imports `metered.mjs` (spends nothing
on import), `src/providers/local.mjs` (pure), and `src/providers/deepinfra-models.ts` **read-only, to diff the
curated table** — it never calls `fetchDeepInfraModels()`, so it makes no network request of its own.

---

## 7. What the build must touch (route, do not narrate)

**One constraint the builder must respect first:** `src/providers/deepinfra-models.ts` opens with
`// VENDORED - do not edit here. Source: pi-deepinfra v0.1.3 (MIT)` (`:1-5`, provenance in
`src/providers/PROVENANCE.md`). So the P6b fix must NOT be a quiet edit of a vendored price table: either it is
a vendored-copy change with a `PROVENANCE.md` note and an upstream PR, or (preferred, reversible) a **durian-pi
validation layer** that refuses to register a row whose price is missing or whose declared maximal exposure
exceeds the store cap. Prefer the second: it keeps the vendored file untouched and puts the guard on durig's own
seam.

1. `src/providers/local.mjs` — loopback/metered classification; no `cost: 0` on a metered row; key-variable
   truth in the report (D-5015.1/2/4). Probe: P2.
2. `cli.mjs` `buildModels` — delete the synthesized `$0` row (`:330-339`); attach a `wrapProviderWithSpend`
   next to `wrapProviderWithTrace` at `:362-371` and `:385-391` using the same `onPayload` hook (P1, P4, P7).
3. `src/config.mjs` + `durig.config.default.json` — the three cap keys, tracked defaults, `check` rule
   `metered-without-cap` (P3, F3, F4).
4. `src/supervisor.mjs` / `src/attention.mjs` — `spend_cap_exceeded` as a cause class: non-retryable, parks the
   item, escalates once (F1, F2).
5. `tools/model-probes/{calibrate-verifier,cold-prefill,stream-probe,throughput}.mjs` — move onto
   `meteredChat`, and narrow the pinned un-accounted set in the same commit (F7, P8).
6. Admission projection (Option A): the next-turn projection lives beside `tools/seat-turn-shape.mjs`'s
   read (it already reads the replay window through `compacteval.mjs`'s `replayView`) — the cheapest place to
   refuse a wake without touching the store (A-vs-B pairing, F1/F5).

## 8. Explicitly NOT decided here

- **Capacity** (which model to serve, which ceiling to declare) → operator ruling request in
  `docs/reviews/architecture-capacity-rulings-2026-11-03.md`.
- **Scope/priority** of items 1-6 → `lead`; the rows are routed to `pm`.
- **Model choice** for the metered verifier: this document prices rows and names the exposure of each; it does
  not promote one. D193's rule stands: "a price/runway table never promotes a verifier."
- **Verification of this design** → `qa`/`auditor`, from the acceptance probe's exit code, not from this text.

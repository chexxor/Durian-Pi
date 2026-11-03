# Capacity rulings requested of the operator: the authoritative context ceiling and the compaction reserve (#4970 HALF B, #5025)

**Status: a REQUEST, with the arithmetic already done so the answer can be one line.** Context capacity and the
spend cap are the operator's levers; I have **not** edited either gitignored `durig.config.json`, and I will not
pick the authoritative ceiling myself. Every number below is either measured this session (2026-11-03), computed
by the arithmetic I show, or cited to a tracked line. Axes: **tokens**, **MiB**, **USD**.

Related: `docs/reviews/architecture-spend-cap-2026-11-03.md` (money),
`docs/reviews/architecture-verifier-pointer-2026-11-03.md` (the verifier pointer).

---

## 1. The drift, source by source (this is why "authoritative" is the question)

| source | what it says about the seat window | how I know |
| --- | --- | --- |
| `durig.config.json` **in my seat root** (`/home/chexxor/Git/durian-dev/seatroot/durig.config.json`) | `DURIG_LOCAL_CONTEXT: "200000"`; **no** `DURIG_LOCAL_MAX_TOKENS`; **no** `DURIG_COMPACTION_*` keys (so pi-durable's built-in defaults stand) | read this session (10 lines) |
| `durig.config.json` in the **live checkout** (`/home/chexxor/Git/Durian-Pi/`) | **I could not read it** — confinement refused (`path … is outside the seat's worktree`). Its content is recorded by the delegate: lowered **200000 → 160000** as an operator stopgap (`docs/DECISIONS.md:7665-7667`), and the operator later granted `DURIG_LOCAL_CONTEXT=200000 DURIG_LOCAL_MAX_TOKENS=16384` **as a per-verb environment prefix, not as an edit** (`:8235`, `:8274`) | labelled as a second-hand reading, not my measurement |
| the running engine | `strata --serve … --max-context **204800** --kv int8 --resident-experts --kv-resident 32768 --vram-reserve-mib 1536 --batch 2` on **both** cards (`"gpus":[0,1]`) | `ps -eo pid,args` + `curl :47831/v1/models` this session |
| the provider's measured behavior | answers **191,805** prompt tokens (HTTP 200, 79.9 s); **HTTP 400 at 207,219** | `docs/ROADMAP.md` ≈line 3312, quoted at `docs/DECISIONS.md` D149/D150; surfaced by `tools/model-probes/probe-preflight.mjs` |
| `src/config.mjs:494-498` | every `DURIG_COMPACTION_*` key resolves to **`null`** → "pi-durable's built-in default stands (16384 / 20000 / 32768)" | read this session |
| `.gitignore:8` | `durig.config.json` is gitignored → **absent in every item worktree**, and `durig.config.default.json` carries none of these keys | read this session |

**Three different numbers are in play and only one is declared.** 160,000 (one checkout's declaration),
200,000 (the other's), **204,800** (the engine's configured capacity), and a refusal point bracketed between
191,805 and 207,219. Those are consistent with each other — 191,805 < 204,800 < 207,219 — so there is no
measurement contradiction to chase; the problem is that the **declared** value is a copy-dependent string.

**And the recorded refutation, which must be in the operator's face when they rule:** lowering the declared
window did **not** fix the failures. `DURIG_LOCAL_CONTEXT` was lowered 200000 → 160000 and "`scribe` still
failed at 0.944 of the new window. The stopgap moves *when* compaction fires; it does not make it succeed"
(`docs/DECISIONS.md:7665-7671`). So **the ceiling and the compaction knobs are two levers, and the ceiling alone
is not the fix.** Anyone who rules on the ceiling and stops there has moved a schedule, not removed a failure.

**The same trap as the spend cap, in a different axis.** A control that lives in a gitignored file, or in a
per-verb environment prefix, is a control that dies when someone forgets it. The prefix grant is recorded with
exactly that warning: "because the operator's grant was environment variables only, the fix is a per-verb
prefix, not a property of the rig: omit … and the summarization-cap failure returns **by construction**"
(`docs/DECISIONS.md` D198b).

---

## 2. The arithmetic (four formulas, each anchored to a line)

1. **Compaction trigger (blocking band)** = `W − reserveTokens`, in `thresholdCompaction`
   (`harness/generation.js`, quoted at `docs/DECISIONS.md:8146`).
   *Validation:* with `W=160,000`, `R=16,384` the band is **143,616** — and the measured `context.consumed` that
   night was `lead` 145,429 / `devtools` 143,426 / `impl` 143,278 (`:8146-8147`). My model reproduces the rig's
   measured band, so the rows below can be trusted.
2. **Summarization output budget** = `min(⌊0.8 × reserveTokens⌋, model.maxTokens)`
   (`compaction.ts:148` / `compaction.js:95`, quoted at `docs/DECISIONS.md:7657` and `:8147`).
   This is the number that killed four seats in one night: `min(13,107, 8,192)` with `DURIG_LOCAL_MAX_TOKENS`
   unset (`src/providers/local.mjs:76` defaults it to **8192**) → the summarizer returns `stopReason=length` →
   `summaryFailure` (`compaction.js:302-303`) → the whole send settles `unanswered / model_error` with **zero
   tokens generated** (`:8147-8149`).
3. **A request is servable only if `prompt + maxTokens ≤ served capacity`.** The rig has declared
   `DURIG_VERIFIER_CONTEXT 65536` against an 8,192-token server with `MAX_TOKENS 8192` — "a request that cannot
   be served" (`docs/runbooks/verifier-serving-headroom.md`), the class ROADMAP **259** says `check` should catch.
4. **Background tier** = `(W − R) − backgroundTokens`. It can go **negative**, which silently disables the tier:
   recorded at `docs/DECISIONS.md:6739` as `8,192 − 32,768 = −24,576` for a small-window class.

### Computed rows (axis: tokens; served capacity 204,800)

| class | `W` (declared) | `maxTokens` | `R` (reserve) | trigger `W−R` | summary budget `min(0.8R, maxTokens)` | trigger + maxTokens | margin vs 204,800 | background tier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| local, today's stopgap | 160,000 | 16,384 | 16,384 (pi default) | 143,616 | 13,107 | 160,000 | 44,800 | 110,848 |
| local, operator prefix grant | 200,000 | 16,384 | 16,384 (pi default) | 183,616 | 13,107 | **200,000** | 4,800 | 150,848 |
| **local, requested** | **200,000** | **16,384** | **20,480** | **179,520** | **16,384** (at the cap) | **195,904** | **8,896** | **146,752** |
| local, margin-first alternative | 200,000 | 16,384 | 24,576 | 175,424 | 16,384 | 191,808 | 12,992 | 142,656 |
| metered verifier | 131,072 | 8,192 | 10,240 | 120,832 | 8,192 | 129,024 | n/a | 88,064 |
| **metered verifier, requested** | **131,072** | **8,192** | **16,384** | **114,688** | **8,192** | 122,880 | n/a | **81,920** |

Read the two rows I am asking for:

- `R = 20,480` is the **smallest** reserve that maximizes the summarization budget, because `0.8 × 20,480 =
  16,384 = maxTokens`; every token of reserve above that buys only margin, not a bigger summary. It also leaves
  **8,896 tokens** between "a full generation at the trigger point" and the engine's real capacity, where
  `R = 16,384` leaves **4,800**.
- The cost of a larger reserve is **more compactions**, not safety. Measured shape of one successful compaction:
  `context.consumed` **156,614 → 88,069** (`docs/DECISIONS.md:8300`), i.e. one compaction buys roughly
  `trigger − 88,069` tokens of further work: **95,547** tokens per cycle at `R = 16,384` vs **91,451** at
  `R = 20,480` (a 4 % difference at `W = 200,000`, because the trigger moves more than the post-compaction floor
  does). On the local engine that cost is wall-clock (prefill measured at ~2,400 tok/s: 191,805 tokens in
  79.9 s → a compaction request is a ~50–75 s prefill). On a **metered** row it is money: a compaction whose
  prompt is `W − R = 114,688` tokens costs **$0.00459** at `gpt-oss-20b`, **$0.00836** at `DeepSeek-V4-Flash`,
  **$0.02130** at the shipped default `GLM-5.3-Flash` — which means **187 compactions would consume the operator's
  entire $4 pool** at default pricing. Prices from the dated snapshot
  `.spike/5015/catalog-2026-11-03.json` (2026-11-03).

---

## 3. The rulings I am asking for (each answerable in one line)

**Q1 — What is the ONE authoritative seat context ceiling, and where does it live?**
My recommendation: **declare `DURIG_LOCAL_CONTEXT = 200000` (tokens) in one tracked place**, which sits **4,800
tokens under the engine's configured 204,800**, and have the rig **verify the declaration against the served
engine** instead of trusting a copy — the mechanism already exists and prints the truth today:
`tools/model-probes/probe-preflight.mjs:92,100,158` reads `--max-context` off the live process and prints "what
the rig THINKS the window is, against what the server was actually started with"; today it does that for the
**verifier** class only. Extending it to the local class and surfacing a mismatch in `node cli.mjs check` is the
durable shape of this ruling.
What I will **not** do: choose 160,000 vs 200,000 vs 204,800 myself, or edit either gitignored file. Lowering the
declaration is also a *capability* decision (a 160,000 ceiling makes 145k-token seats un-sendable), which is
exactly why it is the operator's.

**Q2 — What is the authoritative `maxTokens` for a local seat, and is it a rig property or a per-verb prefix?**
My recommendation: **`DURIG_LOCAL_MAX_TOKENS = 16384` as a rig property, not a prefix.** It is already granted as
a prefix (`docs/DECISIONS.md:8235,8274`) and already measured as the thing that made compaction succeed
(`:8200`: summary budget `min(⌊0.8·16384⌋, 16384) = 13,107`; `:8298` "The operator's grant of
`DURIG_LOCAL_MAX_TOKENS=16384` is now a measured fact, not a hypothesis"). Left unset, the code default is
**8192**, and 8192 is what produced four seat deaths and `scribe`'s mid-write truncation with nothing committed
(`:7657-7664`). A prefix that must be remembered on every verb is a control that fails by omission.

**Q3 — What is the compaction reserve for each provider class?**
My recommendation, from §2: **local class `reserveTokens = 20,480`** (keep pi's `keepRecentTokens = 20,000` and
`backgroundTokens = 32,768`; check the background tier stays positive — 146,752 at these numbers);
**metered verifier class `reserveTokens = 16,384`** with `maxTokens = 8,192`. The constraint set the ruling must
satisfy, so a future value cannot silently break it: `R ≥ maxTokens` (a full generation must fit in the reserved
headroom), `0.8R ≥` the corpus's real summary need, and `(W − R) + maxTokens ≤` the **served** capacity.
Trade-off stated plainly: bigger `R` = more compactions (each ~50–75 s locally, $0.005–$0.021 metered at
`W = 131,072`), smaller `R` = thinner margin against the provider's real refusal point. I would take `20,480`
because it is the knee of the summary-budget curve and keeps 8,896 tokens of margin.
If the operator prefers pi's own per-model override style (`docs/DECISIONS.md` records a `strata/iq3_s` override
with `reserveTokens 50,000`), that is a **legitimate alternative** — at `W = 200,000` it triggers at 150,000,
which is ~1.5× more compactions per unit of work for a larger hard margin; I did not verify that override's
source this session (`vendor/` is not built in this worktree), so it is cited as recorded, not measured.

**Q4 — Do the compaction knobs become tracked defaults, or stay absent?**
Today `durig.config.default.json` carries **three keys only** (`DURIG_DB`, `DURIG_MAX_CONCURRENT_SEATS`,
`DURIG_OPTIMIZE`) and `DURIG_COMPACTION_*` are **`null`** in `src/config.mjs:494-498`. Any ruling in Q1–Q3 that
exists **only** in a gitignored file is unarmed in every item worktree — the same defect shape as the spend cap
(`docs/reviews/architecture-spend-cap-2026-11-03.md` §2, probe P3 RED). My recommendation: put the ruled values
in `durig.config.default.json` with a comment naming the formulas in §2. Whether the verifier class also gets
`DURIG_COMPACTION_MODEL_OVERRIDES` is the operator's call; I flag only that a per-model override is the one place
where `reserveTokens` can exceed the local class's ceiling without an obvious cause.

---

## 4. Failure modes if a ruling is deferred, each with its recovery path

| failure | axis | what happens | recovery path |
| --- | --- | --- | --- |
| Two copies disagree (160,000 vs 200,000) | tokens | two seats on the same rig have different sendability; `check` on one tree passes, the broker's is red; nobody can tell which tree a verdict was measured in | the mismatch check of §3-Q1 (declared vs `--max-context` off the live process) + one tracked default; recovery today is the per-verb prefix, which itself decays |
| `maxTokens` left at the 8192 default while `R` stays 16,384 | tokens | summary budget capped at 8,192 → `summaryFailure` → the send settles `unanswered / model_error` with zero tokens, and one `pi.user` entry is appended per attempt | Q2; recovery of an already-dirty head is a `reset` under operator grant, **not** `resume` (D198b/D196: the counted projection ends on a bare `pi.user`) |
| Ceiling raised to 204,800 without raising `R` | tokens | `prompt + maxTokens` exceeds the served capacity → provider 400 at the wire, after the send was admitted | formula 3 in §2 as a `check` rule (ROADMAP 259's class); pre-flight `tools/seat-turn-shape.mjs` (1.1 s, read-only) before any send |
| Compaction enabled but the reserve unruled | tokens | compaction fires at 183,616 with a 13,107-token summary budget on a model whose generation is capped at 8,192 — i.e. the exact configuration that failed | Q3 with the constraint set stated; the knobs are already present (`#4971`), so this is a value ruling, not a build |
| Metered verifier with no reserve ruling | **USD** | each compaction is a paid summarization call at `W − R` tokens; at default pricing 187 of them spend the operator's whole $4 pool | the cap before the re-point (`architecture-spend-cap-2026-11-03.md` D-5015.1–D-5015.2), and the per-compaction number in §2 quoted in the gate plan |

---

## 5. Falsifiable probes for whatever is ruled (every control must be able to fail)

```bash
# declared vs served, for BOTH classes (the durable fix requested in Q1)
node tools/model-probes/probe-preflight.mjs     # read-only; prints each server's --max-context (parsed at :92) against
                                                # "what the rig THINKS the window is" (:100), for the verifier class today
node tools/seat-turn-shape.mjs                  # read-only preflight of the counted projection and the context ceiling
node tools/broker-serve.mjs --status            # "preflight report only. READ-ONLY." (tools/broker-serve.mjs:59)

# are the ruled values in a TRACKED file? (empty output today => unarmed in every item worktree)
node -e 'const c=JSON.parse(require("fs").readFileSync("durig.config.default.json","utf8"));
  console.log(Object.keys(c).filter(k=>/COMPACTION|LOCAL_|VERIFIER_/.test(k)))'

# the money axis of a compaction, from the same code the probes use (no metered call: projection only)
node -e 'import("./tools/model-probes/metered.mjs").then(m=>
  console.log(m.projectCostUsd({price:{in:0.03,out:0.14},body:{messages:[{role:"user",content:"z".repeat(114688*3)}],max_tokens:8192}})))'
```

**Requested `reviewBy`: 2026-11-07.** `#4970` HALF B and `#5025` are both gated on Q1–Q3; the two items
`#4973` (compaction build) and the verifier re-point are the work that cannot proceed without them, and every
day they stay unruled the rig runs a compaction schedule nobody chose.

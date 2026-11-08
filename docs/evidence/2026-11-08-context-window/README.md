# Evidence: why a seat's task does not finish inside one context window (2026-11-08, delegate session N12)

Milestone: **ensuring LLM task completion (D226)**, first tranche **ROADMAP 331**.
Host, measured in the same commands as the numbers: **Linux**, Fedora Linux 45 (Forty Five), kernel
`7.2.15-300.fc45.x86_64`, node v24.22.1, git 2.56.0. Store: `./selfdev.sqlite`, `main` = `2362d20a` at the time of
the run.

These two instruments are kept here because `.spike/` is gitignored and is wiped between sessions — an unpromoted
probe is lost (the rule is `docs/SELFDEV.md` pitfall 133; promotion into `tools/` still needs a row from `lead`).
Both are **read-only, no model spend, broker-down safe**.

## 1. `compaction-policy-probe.mjs` — the override never reaches the harness

```bash
cp docs/evidence/2026-11-08-context-window/compaction-policy-probe.mjs .spike/delegate/
node .spike/delegate/compaction-policy-probe.mjs
```

Output (verbatim):

```
config source: durig.config.json  defaults: /home/chexxor/Git/Durian-Pi/durig.config.default.json
DURIG_COMPACTION_MODEL_OVERRIDES = [object Object]
compactionSettings() returns: {"modelOverrides":{"local/qwen3.8-flash-next-q2_0":{"reserveTokens":20480}}}
settings.compaction (the ONLY key the harness reads): UNDEFINED -> pi-durable defaults apply; the modelOverrides map is dropped

local/qwen3.8-flash-next-q2_0  seats: pm,impl,qa,qa2,lead,advocate,scribe,devtools,designer,security,architect  declaredWindow=null
  resolved: enabled=true reserve=16384 keepRecent=20000 background=32768
verifier/openai  seats: auditor  declaredWindow=null
  resolved: enabled=true reserve=16384 keepRecent=20000 background=32768
```

It does not re-derive the policy: it feeds the object `cli.mjs:516` hands `Harness.open` to pi-durable's own
`compactionPolicy` (`node_modules/@earendil-works/pi-durable/dist/harness/compaction.js:195`), and the defaults come
from `dist/harness/agent.js:10-15`.

**Two things this instrument cannot prove, stated so nobody over-reads it:**
- `declaredWindow=null` because `DURIG_CONTEXT_WINDOW` is unset; the real per-family windows come from
  `DURIG_LOCAL_CONTEXT = 204800` and `DURIG_VERIFIER_CONTEXT = 24576` in `durig.config.json`. The 8,192-token
  headroom for the verifier seat is derived from those config values, not from what the harness reports.
- The override key it prints as `verifier/openai` is a naive split of `verifier/openai/gpt-oss-120b`; pi-durable
  keys `modelOverrides` by `${model.provider}/${model.modelId}`. The drop is proven regardless, because
  `settings.compaction` is undefined, so the map is never consulted at all — but whoever fixes the nesting must
  check the key spelling against the harness's own resolver, not against this probe.

## 2. `context-window-health.mjs` — how often the window actually fails

```bash
cp docs/evidence/2026-11-08-context-window/context-window-health.mjs .spike/delegate/
DURIG_DB=./selfdev.sqlite node .spike/delegate/context-window-health.mjs --since-min=720
```

Measured (all-time, one read):

| kind | rows |
|---|---|
| `pi.generation` | 71,280 — outcomes: 54,353 completed / 16,589 failed / 333 aborted / 5 null |
| `pi.tool` | 53,301 |
| `pi.compaction` | 2,323 — 1,897 completed / **426 failed**, of which **240** are "Summarization hit the token limit; the summary is incomplete" |

The 240 failures cluster on conversation **4936** = `auditor` (verifier family, window 24,576): with the defaults
that survive, compact-above = 24,576 − 16,384 = **8,192 tokens** while `keepRecentTokens = 20,000`.

A second read at 20:4xZ, while the broker drove: **321 generations in 60 min — 320 completed, 0 failed, 0 aborted,
1 in flight** (per conversation: devtools 100, impl 91, qa 40, scribe 33, architect 20, pm 18, security 7, auditor 6,
lead 5). Earlier in the same window: 145 completed / 0 failed in 30 min, and only **1** wake whose text said "nothing
claimable for you". So the parked-wake count is not today's ceiling; the 435 `held` / 384 `deferred` rows are the
backlog.

**Correction to this instrument's first version:** it counted outcomes as `ok` when `outcome === "success"`. The
store spells it `"completed"`, so every generation was misreported as a failure. The fixed copy is the one kept
here; a probe that reports 321 failures where there were 320 completions is worse than no probe, because the number
looks plausible.

## What would falsify the milestone claim

Run the probe again on the `main` that carries #5784: it must print `reserve=20480` for `local/…`. Until it does,
ROADMAP 331 is open regardless of what any queue row says its status is.

## 3. The spend ledger as the window-pressure baseline

`selfdev.sqlite.spend.jsonl` (1,916 lines lifetime). Fields: `at`, `model`, `host`, `prompt_tokens`, `completion_tokens`, `reasoning_tokens`, `usd`, `totalBefore`, `totalAfter`. Measured 21:3xZ for 2026-11-08:

```
374 calls, $0.18432, prompt 3,661,636, completion 287,337   (lifetime running total $0.885818)
min 0  median 9,787  max 22,963
calls with prompt > 16,384 (the default reserve): 67
calls with prompt > 24,576 (the verifier window): 0
```

What that proves: no provider call is overflowing the window, so the overflow is the **compaction step itself** — the summariser is being handed more than the 8,192 tokens of headroom left after the 16,384-token reserve on a 24,576-token window. What it does not prove: how many of those 374 calls were compaction calls; the ledger does not label the caller.

## 4. Which failure is live and which is episodic (time-boxed)

`node docs/evidence/2026-11-08-context-window/milestone-check.mjs` now prints both, per category:

| category | lifetime | first | last | last 24 h |
|---|---|---|---|---|
| truncated summaries (`hit the token limit`) | 214 | 2026-10-18T20:55:08Z | 2026-11-08T08:41:03Z | **6** |
| refused by the run cap (`spend_cap_exceeded`) | 209 | 2026-11-07T08:50:25Z | 2026-11-07T10:34:40Z | **0** |

Read it this way: the **cap starvation is a 104-minute burst from one broker process** and is not happening today;
the **window/policy mismatch is chronic and still firing** (6 in the last day). A gate that reports only lifetime
counts would let both hide. Acceptance for ROADMAP 331 is therefore: zero truncations in a rolling 24 h **and** the
override resolving to `reserve=20480`.

**Where the live truncations are, exactly:** all 6 in the last 24 h are conversation **4936**, which the broker log
names as the **auditor** seat (`grep -oE "SKIP <seat> reason=pending conv=[0-9]+" selfdev.sqlite.broker.log | sort -u`
→ `SKIP auditor reason=pending conv=4936`), i.e. the verifier family
(`DURIG_VERIFIER_MODEL = openai/gpt-oss-120b`, `DURIG_VERIFIER_CONTEXT = 24576`), clustered 08:29:17Z–08:41:03Z.
That is the choke point: the seat whose job is to verify the team's work cannot compact its own context, so
verification — the step that lets a task be marked complete — is the one that stalls.

## 5. The exact shape of the fix, proven against the shipped harness

`node_modules/@earendil-works/pi-durable/dist/harness/compaction.js:195-202` (vendored source:
`vendor/pi-main/packages/durable/dist/harness/compaction.js:196`):

```js
export function compactionPolicy(settings, model) {
    const { modelOverrides, ...policy } = settings.compaction;      // <-- inside `compaction`, not beside it
    const override = modelOverrides?.[`${model.provider}/${model.modelId}`];
    return { enabled: override?.enabled ?? policy.enabled, reserveTokens: override?.reserveTokens ?? policy.reserveTokens, ... };
}
```

Run this and the difference is unambiguous — no source change, no model spend:

```bash
node -e 'const m=require("./node_modules/@earendil-works/pi-durable/dist/harness/compaction.js");
const a=require("./node_modules/@earendil-works/pi-durable/dist/harness/agent.js");
const D=a.DEFAULT_COMPACTION_POLICY; const model={provider:"local",modelId:"qwen3.8-flash-next-q2_0"};
const nested  ={compaction:{...D,modelOverrides:{"local/qwen3.8-flash-next-q2_0":{reserveTokens:20480}}}};
const sibling ={compaction:{...D},modelOverrides:{"local/qwen3.8-flash-next-q2_0":{reserveTokens:20480}}};
console.log("NESTED ", m.compactionPolicy(nested,model));
console.log("SIBLING", m.compactionPolicy(sibling,model));'
```

Output:

```
NESTED  { enabled: true, reserveTokens: 20480, keepRecentTokens: 20000, backgroundTokens: 32768 }
SIBLING { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000, backgroundTokens: 32768 }
```

So #5785's change is: in `src/config.mjs:488`, put the layered map **inside** `out.compaction`
(`out.compaction.modelOverrides = layered`) instead of `out.modelOverrides = layered`. One line, and the harness
already implements the layering — there is nothing else to build for the override half.

**What this does not settle:** the key. The harness matches on `${model.provider}/${model.modelId}`, so the config
key must be exactly `local/qwen3.8-flash-next-q2_0`. `DURIG_COMPACTION_MODEL_OVERRIDES` currently has that spelling;
if a family is renamed, the override silently does nothing — the same "set and ignored" class pitfall 146 warns
about, and worth a load-time assertion rather than a silent miss.

---
runbook: spend-cap-tripped
symptom: "an item parks with reason `spend_cap_exceeded`; a seat says `spend_cap_exceeded (spend_cap_call_usd: 0.05)` instead of sending; a model-probe refuses before sending with `spend cap ... would be exceeded`"
writes: false
precondition: "read-only"
last_verified: 2026-11-04
verified_by: implement
evidence: "#5047 (commits 6f3e14ba f88137b3 68bc73cb fb43b61e 894dac60 2142eafa 8740d3a3 4f6674b7 e5308cc1); `node tools/model-probes/spend-cap-acceptance.mjs --snapshot .spike/5015/catalog-2026-11-04.json` exits 0, 11/11"
check_rule: "demo/spend-cap-guard.test.mjs; demo/probe-metered-ledger.test.mjs"
---

# A spend cap tripped: what the stop means and what an operator does about it

## When to use
Something stopped rather than failed. The observable forms:

- an item is parked with `reason: spend_cap_exceeded`, and its `attention_reason` row says which cap;
- a seat's last assistant message is `spend_cap_exceeded (spend_cap_call_usd: 0.05; spent 0.0412; projected 0.0610): refusing a request that would cost more than the cap …`;
- a probe prints `REFUSED before sending: spend cap spend_cap_store_usd (4) would be exceeded` and made **no** request;
- `durian-pi` notices include kind `spend_cap_exceeded`.

## Impact
Nothing is broken and nothing is retrying. A cap stop is **non-retryable** by design — it is named with
`spend_cap_exceeded` and phrased as `out of budget`, which is one of the strings pi-ai's own
`NON_RETRYABLE_PROVIDER_LIMIT_ERROR_PATTERN` classifies as terminal — so a runaway seat cannot grind the same
refusal into many requests. The supervisor parks the item on the **first** failure rather than waiting for the
repeated-failure streak (#3796's streak is for crashes; re-approaching a money stop would spend against the same
cap). What you lose is the work the item represented, until someone decides whether the number or the scope was
wrong.

## Preconditions
Read-only. No broker stop, no store write. Raising a cap is an **operator** act (D193: an agent may change how
much it does, never the price ceiling it is bounded by) — a seat will not and should not edit these keys.

## Diagnose (read-only)
```bash
# 1. What the store has spent and how many rows are unconfirmed - the SAME cheap read the caps enforce against.
node -e 'import("./tools/model-probes/metered.mjs").then(m=>{const t=m.spendTotalUsd(m.ledgerPath(process.env));console.log(JSON.stringify({ledger:m.ledgerPath(process.env),rows:t.rows,totalUsd:t.totalUsd,unknownCostRows:t.unknownCostRows,caps:m.capsFor(process.env)},null,2))})'
# 2. The rows behind that number, newest last.
tail -20 .spike/gate/spend.jsonl
# 3. Which cap fired, from the attention surface.
DURIG_DB=./rig.sqlite node -e 'const D=require("better-sqlite3");const db=new D(process.env.DURIG_DB,{readonly:true});for(const r of db.prepare("select conv_id,kind,reason,detail from attention where kind=? order by raised_at desc limit 5").all("spend_cap_exceeded"))console.log(r)'
```
A paid probe run ends with its own bill (`tools/model-probes/gate.mjs` prints `formatRunTotal(...)` from the ledger,
not from memory, so an interrupted run still reports what it spent). Read the refusal's `projected N` as a **bound**,
not an estimate: an unpriced metered model projects to `Infinity`, which is why a cap fires on a row whose price is
missing rather than sending an unpriced request. `unknownCostRows` is not missing money — it is money we cannot
CONFIRM, and it makes a cumulative cap a lower bound. A non-zero count is itself something to fix.

## Do
1. Decide which of the two questions you are answering: *is the price wrong*, or *is the job too big*? A cap that
   trips on a normal-sized call in an empty store is a price/catalog problem; one that trips after a long session is
   a scope problem.
2. Find the row that spent it. The ledger row carries `model`, `baseUrl`, `usage`, `priceSource`, `priceAsOf` and
   `usd`. A `priceSource` of `none` or `unverified` on a **non-loopback** row is the defect, not the cap.
3. If the job was too big: shrink the work (fewer/shorter turns, a smaller store, a cheaper model) and release the
   item. The cap keys stay as they are.
4. If the price is wrong: fix the dated source, not the cap. The curated DeepInfra rows re-price from
   `src/providers/deepinfra-prices.json` (its `fetchedAt` stamp is what makes the drift check possible), and the
   live vendor page behind them is `DURIG_DEEPINFRA_CATALOG_URL` (`https://deepinfra.com/api/models`); a refresh is
   a NEW dated snapshot, kept as its own file so a price change is a diff rather than a silent edit. A `local/`
   provider aimed at a non-loopback host declares itself with `DURIG_<ID>_PRICE_USD_IN` / `_OUT` /
   `_CACHE_READ` (or `DURIG_PRICE_JSON`), and `$0` is accepted only as a declaration. Either way the guard stays
   where it is: `src/providers/deepinfra-models.ts` re-prices the vendored table and refuses a row it cannot price
   or a row whose own declared geometry could overspend the store cap in one call.
5. Only then consider the number itself. The three axes are separate and all three are armed from the **tracked**
   `durig.config.default.json` (a cap in the gitignored `durig.config.json` is unarmed in an item worktree, which is
   where every seat runs):
   - `DURIG_SPEND_CAP_CALL_USD` — one call's projected cost;
   - `DURIG_SPEND_CAP_RUN_USD` — one run/conversation; probes read `DURIG_PROBE_CEILING_USD` as the same axis;
   - `DURIG_SPEND_CAP_STORE_USD` — the store-wide pool, summed from the ledger total.
   Raising one is a config commit, so it is reviewable, and it does not retroactively let the refused call through:
   release the parked item to try again.

## Verify
```bash
node tools/model-probes/spend-cap-acceptance.mjs --snapshot .spike/5015/catalog-2026-11-04.json; echo exit=$?
```
Expected: exit `0` and `11/11 acceptance claims hold; 0 RED`. If you changed a price source, also run
`node demo/deepinfra-catalog.test.mjs` (it refuses a curated row that could overspend the store cap in ONE call).

## If it fails
If the acceptance probe goes red after your change, the seam is no longer at the provider: P1 and P4 pin that the
seat path wraps `provider.stream` inside `apiProviderFor` (the one seam compaction, fork and retry all go through),
that seat and probe write the **same 14-field row to the same file**, and that a refused call leaves **no** ledger
row. If the probe passes but your seat still overspent, look for a provider that was never registered as metered —
locality is the endpoint's property (`endpointClass`), not the provider's name.

## Escalate to
`architect` if a cap keeps firing on work that is legitimately that large (the cap value is a policy decision and
its owner), and `operator` for the config commit itself.

## Evidence
#5047. The mechanism measured rather than assumed: `demo/spend-cap-guard.test.mjs` drives the real pi-ai provider
through the guard against a loopback stub and counts its requests (2 sent, 0 for the refused call) and the ledger
rows (exactly one). The vendor-side numbers come from `node demo/deepinfra-catalog.test.mjs` (exit 0): 15 rows
register, 4 of the curated list are absent from the dated snapshot, 2 disagreed with it and are re-priced by it, and
1 is refused — `google/gemini-3.1-pro` declares 1,000,000 ctx at $2/$12, so ONE maximal call costs $14.00, 3.5× the
$4 store cap. No run-level or store-level cap can stop that first call; only a registration-time check can.

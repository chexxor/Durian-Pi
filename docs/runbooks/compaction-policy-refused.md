---
runbook: compaction-policy-refused
symptom: "every verb dies before doing anything with `incoherent compaction policy: the config cannot be loaded`; or a seat keeps settling `unanswered` / `stopReason=length` on a small-window family even after `compact`"
writes: false
precondition: "read-only"
last_verified: 2026-11-10
verified_by: impl
evidence: "#6063 (the gate), demo/compaction-coherence.test.mjs exit 0, `node cli.mjs config` exit 1 with the arithmetic on stderr"
check_rule: null
---

# The config is refused because the compaction policy cannot fit

## When to use
Any verb exits 1 before touching the store and the error begins `incoherent compaction policy: the
config cannot be loaded`. Also: a verifier-class seat repeatedly dies at `stopReason=length` with an
empty reply while `compact` reports a NO-OP — the policy is the cause, not the seat.

## Impact
The gate fires inside `loadConfig` (src/config.mjs), which every entry point calls
(`cli.mjs`, `tools/broker-serve.mjs`, `tools/keycheck.mjs`), so NOTHING runs — no broker, no status,
no queue. It is a refusal, not a warning: the rig does not limp on a policy that cannot fit.

## Preconditions
None; the diagnosis is read-only. Fixing means editing the config file, which is a write the operator
owns.

## Diagnose (read-only)
```bash
node cli.mjs config
```
Exit 1 with a message of this shape (numbers from the rig in question):

```
incoherent compaction policy: the config cannot be loaded. ONE harness-wide policy is what pi-durable
runs (reserveTokens 16,384 / keepRecentTokens 20,000 / backgroundTokens 32,768, pi-durable's built-in
defaults, because no DURIG_COMPACTION_* key is set), and it is not coherent for every declared family:
  - verifier/openai/gpt-oss-120b (window 24,576, output budget 6,000, declared by DURIG_VERIFIER_CONTEXT / DURIG_VERIFIER_MAX_TOKENS): the smallest context a compaction can leave is 26,000 tokens - keepRecentTokens 20,000 + summary budget min(floor(0.8*16,384)=13,107, 6,000)=6,000 - against a window of 24,576 (105.8%)
```

Four checks, and the message says which tripped:
1. `reserveTokens >= maxTokens` for every family — `reserveTokens` is the headroom the policy keeps free for the ANSWER, and in the pin only the SUMMARY call is bounded by it (`compaction.js:95`). A reserve smaller than the family's declared output budget is a reservation the model is free to break: input at `window - reserve` plus an answer of `maxTokens > reserve` exceeds the window, and the turn dies `stopReason=length` while the policy still reports itself coherent.
2. `reserveTokens < window` — otherwise `blocking = window - reserve <= 0` and threshold compaction fires every turn.
3. `keepRecentTokens + min(floor(0.8*reserveTokens), maxTokens) <= window` — the post-cut floor. `selectCut` keeps at least `keepRecentTokens` verbatim and the summary call is capped at that min, so this is the SMALLEST context a compaction can leave.
4. `window - reserveTokens - backgroundTokens > 0` — otherwise a background compaction is scheduled on every turn.

**Why per-family keys cannot fix it:** on the pinned pi-durable (1.3.0) `resolveSettings` merges
`DEFAULT_COMPACTION_POLICY` with `settings.compaction` only, and `modelOverrides` has no reader
(`grep -rn modelOverrides node_modules/@earendil-works/pi-durable/dist --include='*.js'` -> 0 hits).
`DURIG_COMPACTION_MODEL_OVERRIDES` is inert by name (ROADMAP 331). The gate checks ONE policy against
every family, because only one policy runs.

## Do
1. Read the offending family and its window out of the message.
2. `[judgement]` Pick a harness-wide policy that fits the TIGHTEST family AND covers every family's output
   budget. The refusal prints a suggested triple it already re-checked against every declared family —
   for the live rig (verifier 24,576/6,000, local 204,800/8,192) the gate's own derivation yields
   `8192 / 9288 / 8192`, which passes all four checks. A reserve of `4096` does NOT pass: it is smaller
   than the verifier's declared 6,000-token output budget, which is why the fold of #6064 into #6063
   retired that triple.
3. Write the three keys into the config file the verb is loading (`durig.config.json` in the rig root,
   or whatever `DURIG_CONFIG` points at):
```bash
# the operator edits this file; these are policy numbers, not credentials
"DURIG_COMPACTION_RESERVE_TOKENS": "8192",
"DURIG_COMPACTION_KEEP_RECENT_TOKENS": "9288",
"DURIG_COMPACTION_BACKGROUND_TOKENS": "8192"
```
4. `[judgement]` Decide the behavioural cost consciously: ONE policy means the local family
   (window 204,800) is cut to the same floor a verifier needs, and the reserve must be at least as big
   as the LARGEST declared output budget in the rig — for a rig whose local model declares 16,384 output
   tokens, the reserve cannot be smaller than 16,384 even though the verifier would be content with less.
   That is the trade the gate forces into the open instead of hiding behind an override that never applied.

## Verify
```bash
node cli.mjs config
```
Exit 0, and the JSON now carries the policy that will actually run plus the per-family verdict:
`DURIG_COMPACTION_EFFECTIVE_POLICY` and `DURIG_COMPACTION_GATE` with `"ok": true`, each family's
`blocking`, `background` and `floor`.

Run the gate's own demo:
```bash
node demo/compaction-coherence.test.mjs   # exit 0
```

## If it fails
- If the message still lists a family you did not declare, the family IS declared: a local provider is
  registered by its `DURIG_*_BASE_URL` key, and its window comes from `DURIG_*_CONTEXT`. A declared
  `DURIG_CONTEXT_WINDOW` (bare number or per-model JSON map) is gated as well.
- If the suggestion in the message does not satisfy the gate, it is not printed at all — the gate
  re-checks it before offering it; set the keys by hand and re-run `config`.

## Escalate to
`devtools` if a family's declared window is wrong (the gate is only as good as the declaration);
`qa` if a seat still hits `stopReason=length` with a coherent policy, because then the window or the
token estimate — not the policy — is the fault.

## Evidence
#6063 and #6064, branch `item-6064` (forked from `item-6063`, whose gate this folds into — there is ONE
gate, not two). Gate: `src/config.mjs` `effectiveCompactionPolicy`, `compactionFamilies`,
`compactionGate`, `suggestedCoherentPolicy`, `assertCoherentCompactionPolicy` (called in `loadConfig`).
Demo `demo/compaction-coherence.test.mjs` (registered in `demo/test-areas.json` under `rig`) asserts the
refusal message, the accepted `16384/8192/4096` policy for both demo families, each of the four checks
tripped separately (the headroom, blocking, floor and background cases each trip ALONE — the demo asserts
`fails.length === 1` for the isolated cases), the shipped `durig.config.default.json` read verbatim as a
refusal once a family is declared, and the CLI's exit 1 / exit 0 pair end to end. Verified 2026-11-10.

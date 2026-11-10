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

Three checks, and the message says which tripped:
1. `reserveTokens < window` — otherwise `blocking = window - reserve <= 0` and threshold compaction fires every turn.
2. `keepRecentTokens + min(floor(0.8*reserveTokens), maxTokens) <= window` — the post-cut floor. `selectCut` keeps at least `keepRecentTokens` verbatim and the summary call is capped at that min, so this is the SMALLEST context a compaction can leave.
3. `window - reserveTokens - backgroundTokens > 0` — otherwise a background compaction is scheduled on every turn.

**Why per-family keys cannot fix it:** on the pinned pi-durable (1.3.0) `resolveSettings` merges
`DEFAULT_COMPACTION_POLICY` with `settings.compaction` only, and `modelOverrides` has no reader
(`grep -rn modelOverrides node_modules/@earendil-works/pi-durable/dist --include='*.js'` -> 0 hits).
`DURIG_COMPACTION_MODEL_OVERRIDES` is inert by name (ROADMAP 331). The gate checks ONE policy against
every family, because only one policy runs.

## Do
1. Read the offending family and its window out of the message.
2. `[judgement]` Pick a harness-wide policy that fits the TIGHTEST family. The refusal prints a
   suggested triple it already re-checked against every declared family; for a 24,576-window verifier
   that is `3072 / 6144 / 3072`, and the worked example the gate accepts is `4096 / 8192 / 8192`.
3. Write the three keys into the config file the verb is loading (`durig.config.json` in the rig root,
   or whatever `DURIG_CONFIG` points at):
```bash
# the operator edits this file; these are policy numbers, not credentials
"DURIG_COMPACTION_RESERVE_TOKENS": "4096",
"DURIG_COMPACTION_KEEP_RECENT_TOKENS": "8192",
"DURIG_COMPACTION_BACKGROUND_TOKENS": "8192"
```
4. `[judgement]` Decide the behavioural cost consciously: ONE policy means the local family
   (window 204,800) is cut to the same ~11k floor a verifier needs. That is the trade the gate forces
   into the open instead of hiding behind an override that never applied.

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
#6063, branch `item-6063`. Gate: `src/config.mjs` `effectiveCompactionPolicy`, `compactionFamilies`,
`compactionGate`, `assertCoherentCompactionPolicy` (called in `loadConfig`). Demo
`demo/compaction-coherence.test.mjs` (registered in `demo/test-areas.json` under `rig`) asserts the
refusal message, the accepted `4096/8192/8192` policy for both families, each of the three checks
tripped separately, and the CLI's exit 1 / exit 0 pair end to end. Verified 2026-11-10.

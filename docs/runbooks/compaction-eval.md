---
runbook: compaction-eval
symptom: "you need to know what a compaction actually DESTROYS (or preserves) before trusting a threshold - or you need a model's real effective window rather than the advertised one"
writes: false
precondition: "read-only; live modes cost provider tokens (operator key)"
last_verified: 2026-10-17
verified_by: qa
evidence: "item #1087 (engine + demo + script); demo/compacteval.test.mjs GREEN; scripts compact-eval window/item DRY runs exit 0"
check_rule: null
---

# The compaction evaluation harness (ROADMAP 97)

## When to use
A compaction threshold decision (item 27 / RANK 4 / #62) must stand on a MEASUREMENT, not the
advertised `contextWindow`. Two questions this harness answers:
1. **What does a compaction actually lose?** The compacted-vs-full DELTA on a real past item
   (recall / artifact / continuation probes, blind-judge corroborated; artifact-tracking is the
   metric the follow-up research found most sensitive).
2. **Where is a model's effective window (MECW-style lower bound)?** A planted-needle sweep at
   several lengths against the live endpoint; the first failing probe length is the boundary.

## Impact
Without this, thresholds inherit the platform's `contextWindow - reserveTokens` (~1.03M against a
1M-configured model) - about 3-4x past the vendor's own operating point (GLM-5.3-Flash evaluated at
300K; DeepSeek-V4 practitioner band 150-250K) - so automatic compaction effectively never fires and
quality collapse is the first signal. Blast radius of the tool itself: none on the rig (the store is
ALWAYS read from a TEMP copy; the live sweep writes nothing to the repo).

## Preconditions
Offline engine tests need nothing (`demo/compacteval.test.mjs`, MemoryStorage + faux). Live modes
spend the operator's DeepInfra key: DURIG_PROVIDER must be deepinfra and DEEPINFRA_API_KEY set;
every firing chain prints the cost estimate and needs `--yes`.

## Operation
The ENGINE (src/compacteval.mjs) is offline-proven by the demo; do not re-prove it live.
```bash
node demo/compacteval.test.mjs
```
Expect: 19 ok lines and `COMPACTEVAL PASS (...)`, exit 0.

### Measure a model's effective window (live, costed)
```bash
DURIG_PROVIDER=deepinfra DURIG_MODEL=zai-org/GLM-5.3-Fluid node scripts/compact-eval.mjs window --lengths 64k,128k,200k,300k --dry
node scripts/compact-eval.mjs window --lengths 64k,128k,200k,300k --yes --out window-glm.json
```
Read the dry estimate FIRST (~tokens x 3 probes per length). The fired run prints per-length probe
hits with the provider-reported usage, then:
- `BOUNDARY (first failing length)` - the first length where ANY probe missed;
- `EFFECTIVE-WINDOW LOWER BOUND` - the last ALL-pass length (a conservative LOWER bound of MECW;
  label it as such - it is not a precision number).
Feed THAT number into item 27's threshold basis (~60-70% of it), NOT the advertised window.

### Measure what compaction loses on a real past item (live, costed)
```bash
node scripts/compact-eval.mjs item --seat impl --dry
node scripts/compact-eval.mjs item --seat impl --yes --judge Qwen/Qwen3.6-35B-A3B --out delta-impl.json
```
The store (DURIG_DB or --store) is read ONLY through a TEMP copy; the original is never opened for
write. The run: REAL manual compaction on the COPY, then the probe set at both levels - recall
(backticked needles harvested from the dropped zone), artifact (repo-relative paths harvested), and
continuation - with a blind pairwise judge (default a DIFFERENT model family than the seat's).
Watch `DELTA` and the per-probe table; artifact-tracking misses are the headline.

## Verify
```bash
node demo/compacteval.test.mjs                       # exit 0
node scripts/compact-eval.mjs window --lengths 8k --dry    # exit 0, prints estimates
node scripts/compact-eval.mjs item --seat impl --dry       # exit 0
```
2026-10-17 (qa): all three run GREEN/offline; the store-copy recon reads the LIVE selfdev store
(400 records, ~297K est tokens for seat impl, expectations harvested). The LIVE window sweep and the
LIVE item delta are operator-costed and NOT verified - run them with --yes when authorized
(see D84's guidance: probe at 3-5 lengths; artifact-tracking below the uncompacted baseline is the
alert).

## If it fails
- `unknown seat` / `no store`: - the DURIG_DB this seat's config names is the operator's OTHER rig
  (tutor-pi.sqlite); pass --store selfdev.sqlite explicitly.
- `no pi.compaction entry was placed`: the transcript is under pi-durable's keepRecentTokens
  (20000) - nothing to compact; seed a denser slice or accept "nothing to measure".
- Judge JSON parse failures fail LOUD (no silent pass) - retry once; twice is a pattern to report.

## Escalate to
`pm` for provider-spend authorization; `impl` for anything requiring the pinned internals
(ContextView derivation beyond record-level semantics).

## Evidence
Commit on branch `qa-item-1087` (item #1087): src/compacteval.mjs (engine),
demo/compacteval.test.mjs (19 checks, real pi-durable interop via MemoryStorage+faux),
scripts/compact-eval.mjs (window + item, --dry/--yes cost gates). Grounding: pi-durable dist
(placeSummary, transaction.js head-"self" resolution, selectCut/estimateContext) + the follow-up
research A2/A3, F18, F19; D84's eval clause.

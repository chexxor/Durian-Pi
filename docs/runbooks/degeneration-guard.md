---
runbook: degeneration-guard
symptom: "a seat was auto-reset (a pi.reset naming degenerate-text=...) and you must tell a real loop from a false positive, or add a new degenerate shape"
writes: false
precondition: "read-only"        # diagnosis is read-only; adding a pattern is a code change (broker-safe-change.md)
last_verified: 2026-10-16
verified_by: impl
evidence: "item #875 (registry + real fixtures); demo/degeneration-text.test.mjs; scripts/degen-scan.mjs"
check_rule: null
---

# The degeneration guard: a prose loop, and how to trust it

## When to use
The broker's supervisor resets a seat on its own and the new `pi.reset` entry names a prose cause
(`degenerate-text=<pattern>=N`) — or you are about to add or tune a degenerate-text pattern.

## Impact
The guard resets a seat's CONTEXT to break a loop that would otherwise burn the rig. A reset is cheap
*if the loop is real* and expensive *if it is not*: D78's prose heuristic false-reset five healthy seats
(`lead`, `advocate`, `scribe`, `auditor`, `impl`) the moment it went live, because it counted repeated
**words/fragments** (a healthy long document has plenty) instead of a repeated **shape**.

## Preconditions
Diagnosis is read-only. Adding or changing a pattern is a code change to `src/attention.mjs` — apply it
under `broker-safe-change.md` (stop the broker, land, restart).

## Diagnose (read-only)
Read the run the guard fired on and look at the tail of the flagged turn:
```bash
DURIG_DB=./selfdev.sqlite node cli.mjs log <seat> 8
```
A **real** loop ends in a wall of near-identical micro-sentences and stops acting —
`Emit. OK. Go. Now.` / `Completing:` / `Deferring:` repeated dozens of times. A **healthy** turn may
repeat an ordinary word (`test`, `ok`, `md`) but its sentences stay varied and it keeps acting.

Run the shipped detector over a COPY of the store (never the live one) to see every turn it matches:
```bash
node scripts/degen-scan.mjs .spike/store/selfdev.sqlite
```
Inspect each match. **A match that reads as a healthy document is a false positive** — tighten the
pattern before the guard runs again.

## Do
1. If the flagged turn is a **real** loop: nothing to repair. The reset already re-anchored the seat;
   let it resume its claimed item.
2. If it is a **false positive**: fix the pattern (below) BEFORE the seat runs again, or the guard will
   reset it again on the next pass.

### Add a new degenerate shape (one concern)
A pattern is a PURE predicate over ONE assistant turn's text, registered in `TEXT_PATTERNS`
(`src/attention.mjs`). To add one:
1. Add an entry `{ name, detect(text, opts) }`. Keep it conservative — a false positive costs a reset.
2. Prove it against REAL turns: drop the flagged turn into `demo/fixtures/degenerate-text/positive/`
   (a real loop) or `negative/` (a real healthy turn), with its provenance in that folder's `README.md`.
3. `node demo/degeneration-text.test.mjs` (must exit 0) and `node scripts/degen-scan.mjs <store-copy>`
   (every match must be a real loop). The reason string is `degenerate-text=<name>=<count>>=<bound>`.

## Verify
```bash
node demo/degeneration-text.test.mjs        # exit 0: positives flagged, negatives untouched
node scripts/degen-scan.mjs <store-copy>    # 0 false positives: every match is a real loop
```
Last verified 2026-10-16: the demo exits 0 (3 positives flagged, 6 real-turn negatives untouched) and the
scan over the live selfdev store reports 26 matched turns out of 5636 — every one an emit/completing/
deferring/read/issue wall or an XML tool-call-as-text blob, i.e. 0 false positives.

## If it fails
- The guard keeps firing on a healthy seat → the pattern is too loose; tighten its thresholds and
  re-run the scan before enabling.
- A real loop is NOT caught → the shape differs from every registered pattern; add one (above), do not
  loosen an existing pattern.

## Escalate to
`lead` for a threshold/risk call you cannot settle from the evidence; `impl` owns the detector.

## Evidence
Item #875 (named-pattern registry, real fixtures, zero-FP scan); D78 REVERTED in `docs/DECISIONS.md`;
the reverted attempt `97a3c6d`, the revert `449e870`.

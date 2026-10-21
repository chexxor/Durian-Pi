---
runbook: degeneration-guard
symptom: "a seat was auto-reset (a pi.reset naming degenerate-text=...) and you must tell a real loop from a false positive, or add a new degenerate shape"
writes: false
precondition: "read-only"        # diagnosis is read-only; adding a pattern is a code change (broker-safe-change.md)
last_verified: 2026-10-21
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
DURIAN_PI_DB=./selfdev.sqlite node cli.mjs log <seat> 8
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

## Two more failure modes: the run window and tool durations (2026-10-17)

A real incident (`docs/incidents/2026-10-17-qa-context-degeneration.md`) exposed two `assessRun`
defects that are NOT patterns to tighten:

- **FALSE NEGATIVE — a saturated seat is never reset.** `assessRun` judges only entries newer than the
  last `pi.user`. The broker submits a `pi.user` wake after essentially every turn, so the window is
  1–2 turns and `repeats`/`toolTurns`/`degenerate-text`/`turnDurationMs` never accumulate, while
  `contextTokens` never reaches the fixed `maxContextTokens: 400_000`. `qa` reached **367,559** tokens,
  produced incoherent output, and got **0** escalations. The context bound must come from the model's
  EFFECTIVE window (the `DURIAN_PI_CONTEXT_WINDOW` seam / `src/context.mjs` denominator), not a constant:
  GLM-5.3-Flash *advertises* ~1,048,576 tokens yet degraded at 367k ("advertised != usable").
  **RESOLVED in the pure half (#1823, lead #1816):** context pressure is a SEAT-LEVEL signal read
  from the newest assistant entry of the WHOLE page (it SURVIVES a wake), while every other cause
  stays per-run. The trip is a raw-token FLOOR **AND** a FRACTION of the resolved window, with a
  CEILING (`minContextTokens` / `contextFraction` / `contextCeilingTokens`): the trip is
  `min(fraction*window, ceiling)` and only fires above the floor. The window is INJECTED
  (`contextWindowTokens`, resolved measured > declared > advertised); when it is absent the cause
  is SKIPPED with a `why` (`contextSkip`), never guessed. The fraction is TUNABLE and must be
  CALIBRATED against the qa conv-15 fixtures (with provenance) BEFORE the wiring enables it — the
  shipped default 0.35 is anchored on the 367,559 / 1,048,576 datapoint, not a calibrated value.
- **FALSE POSITIVE — a tool duration read as a model stall.** `turnDurationMs` takes the max of
  `messageOf(entry)?.durationMs` over the whole run, INCLUDING `pi.tool-result` entries. A legitimate
  ~5-min tool sweep (`#72059`, `durationMs=301935`) trips the 5-min wall-clock bound; the guard then
  re-fired every pass (285+ `impl` resets, 20+ consecutive `pi.reset` ids 72099–72118) because the
  broker's long-lived read handle did not observe the `pi.reset` it just wrote, so the
  `items[0].kind === "pi.reset"` idempotence check never fired. Every per-turn cause must read
  ASSISTANT turns only, and the reset must be idempotent against the handle that applies it.

**Diagnose a "burning tokens" seat:** check the newest assistant turn's `usage.totalTokens` and the
run length in `log <seat> 8`. If the seat is saturated but the guard is silent, it is the false
negative above — fix `src/degeneration.mjs`, do not loosen or add a prose pattern.

## Verify
```bash
node demo/degeneration-text.test.mjs        # exit 0: positives flagged, negatives untouched
node scripts/degen-scan.mjs <store-copy>    # 0 false positives: every match is a real loop
```
Last verified 2026-10-16: the demo exits 0 (3 positives flagged, 6 real-turn negatives untouched) and the
scan over the live selfdev store reports 26 matched turns out of 5636 — every one an emit/completing/
deferring/read/issue wall or an XML tool-call-as-text blob, i.e. 0 false positives.

2026-10-17 (`2026-10-17-qa-context-degeneration`): the pattern registry was NOT the cause — `qa`
degraded from CONTEXT SATURATION (367,559 tokens) and the run-window/`maxContextTokens` bound never
fired; `impl` was over-reset from a tool-result duration. Fixes routed as `#1703`/`#1704`/`#1705`.

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
2026-10-18 (recurrence, `docs/incidents/2026-10-17-qa-context-degeneration.md`): a THIRD occurrence —
qa's repeat/garbled shape while holding 8–9 queued items; it did not claim `#1903` even after a priority
nudge (`#1916`), blocking a landing (routed to `auditor` as `#1940`). COUPLED with the broker
dormant-stall (`2026-10-18-broker-dormant-stalled.md`), so do not attribute every missed claim to the
model alone. Guard fixes (#1703/#1704/#1705) still not landed.

---
runbook: context-over-window
symptom: "a seat shows a `context_over_window` notice; `check` reports `context-over-window`; the `ctx` line prints a fraction over 1.0 and you are not sure whether the seat is actually out of context"
writes: false
precondition: "read-only"
last_verified: 2026-11-04
verified_by: impl
evidence: "#5049 (commit 4c1c3e4c); `node demo/context-over-window.test.mjs` exits 0; `node cli.mjs check rig.json --json` reports the rule (skipped with its reason on a store this tree cannot open); live-store population read read-only 2026-11-04"
check_rule: "context-over-window"
---

# A seat's turn moved more tokens than its window: what the fraction does and does not mean

## When to use
`status`/`watch` prints a per-seat notice `context_over_window`, or `check` reports `context-over-window`, or the
`ctx` line shows a fraction above 1.0. The question this answers is: **is this seat actually out of context, or is
the number describing a turn that already happened?**

## Impact
A seat whose turns keep moving more than its window pays real prompt time on every call and risks truncation, so it
is worth acting on. Acting on the WRONG reading is worse: `consumed` is one turn's **moved** tokens, not the live
head, so a seat that was compacted after a long turn keeps printing that old turn until its next one. That artifact
is on the live store right now (one conversation at **244,751 tokens**: **1.22x** the 200,000 window that seat declared
**on 2026-11-04**, the day it was read, and **9.9x** the 24,576 window it declares now — the same numerator, two
readings, because only one of them carried its denominator's date), behind a compaction boundary, and a guard that
shouted about an undated ratio would be switched off within a week — the #3539 failure
shape, where a rule that starts red gets disabled and the real signal goes with it.

## Preconditions
Read-only. Nothing here stops a seat: the notice **accepts, it never decides** (#3271/#3575). The actuator that
would halt a seat is a separate, unbuilt row (#1781). Compacting or resetting a seat is a write — those procedures
live in `compact-a-seat.md` and `seat-reset.md`.

## Diagnose (read-only)
```bash
# 1. The notice itself, with everything the fraction needs: value, denominator STATE, axis, head state, compact gate.
node cli.mjs status
# 2. The same fact as a rig audit: pass, fail, or SKIPPED-with-a-reason (an unread store is never a silent pass).
node cli.mjs check rig.json --json | grep -A 4 '"id": "context-over-window"'
# 3. The window and the compaction budget actually in effect, and where each came from.
node cli.mjs config
```

Read the notice in this order:

1. **The denominator itself, read now** — `node cli.mjs status --json` → `context.window` per seat (or
   `node cli.mjs config`). Do not carry a window across days: `durig.config.default.json:5` ships
   `DURIG_LOCAL_CONTEXT: "200000"` as a **default**, while the live per-seat value is whatever the operator's untracked
   `durig.config.json` declares — on 2026-11-07 the verifier-family seats declare **24,576**, not 200,000. The
   `244,751` artifact above is therefore 1.22x on the 2026-11-04 tree and 9.9x on the 2026-11-07 one, and a ratio quoted
   without its date and its seat is not a measurement. **Not re-measured in the 2026-11-07 pass:** `node cli.mjs status`
   against the live store returned `{"ok": false, "error": "read health: timed out awaiting the broker's result"}`
   (broker busy), so the 24,576 figure is recorded as the delegate's measurement, not this pass's.
2. **The denominator's STATE** — `measured | declared | advertised` (`src/context.mjs`). `declared` is the
   operator's config and is what this rig has today; `advertised` is a vendor catalog figure and the weakest claim;
   `measured` (the effective window, item 97) is reserved and absent. A fraction over an `advertised` window is a
   much weaker statement than one over a `declared` window. **A number with no window has no fraction at all** — the
   measure refuses to make a percentage out of nothing.
3. **The axis** — the text says `tokens the provider MOVED in one turn … NOT the live head`. `cacheRead` is inside
   that sum, so the fraction can exceed 1 while the actual prompt is small: on this rig an 8,757-token cached prefix
   costs ~0.1 s of prompt time, and the live artifact had 243,200 of its 244,751 as cache reads (~20x difference).
4. **The head state** — `measure is current (no pi.compaction/pi.reset entry after entry N)`. If `status` shows a
   fraction over 1.0 and NO notice fired, the measure is **behind a boundary**: a compaction or reset is newer than
   the turn the number came from. That is the D199/D200 artifact. The number stays on screen (hiding a measurement is
   worse than labelling it) but it is not this seat's current pressure.

## Do
1. **Confirm the head is current** (step 4 above). A stale measure needs no action: the seat's next turn replaces it.
2. If it is current, look at `willCut=` in the notice. The compaction verb's gate is the **accumulation budget**
   (`keepRecentTokens`), **not the window** (#4898) — an over-window fraction does not mean `compact` has anything to
   cut. `willCut=false` means the verb would decline; `willCut=unknown` means no `DURIG_COMPACTION_*` value is set, so
   the gate is pi-durable's default and durig deliberately does not print a number it does not read.
3. To act, follow `compact-a-seat.md`: `DURIG_DB=… node cli.mjs compact <seat> "fold the early turns"`. Read its exit
   code, do not read its silence: **0 cut, 1 FAILED (the summarizer died), 2 NO-OP (nothing was worth cutting)**. A
   seat over its window can still be a no-op, and a repair that silently does nothing is how a seat ends up reset
   instead of fixed.
4. If the fraction is over 1 with a `current` head turn after turn, the seat is genuinely running at its ceiling:
   compact it, or follow `seat-reset.md` when the durable context is worth less than the fresh start.
5. Do **not** answer a fraction by editing capacity keys (`DURIG_LOCAL_CONTEXT`, `DURIG_LOCAL_MAX_TOKENS`,
   `DURIG_COMPACTION_MODEL_OVERRIDES`). Those are operator rulings with reasons attached (D201), and a seat that
   raises its own window makes the number go away without making the pressure go away.

## Verify
```bash
node demo/context-over-window.test.mjs
```
Expected, exit 0, one line:

```
CONTEXT-OVER-WINDOW PASS (head state current/behind-boundary; fires on fraction 1.22 with denominator declared; silent on the 9.9 artifact and with no window; rule context-over-window/fix-now starts green over a 12-seat live population, 7 avoided false alarms)
```

That line is the acceptance, and the last clause is the part to trust: the rule was scored against the live store's
own population (12 conversations carrying entries, read read-only on 2026-11-04) — exactly **one** exceeded its
declared window and it was the stale one, so the rule finds **nothing** on the rig as it stands. The same
population scored against the verifier's 24,576 window — which is what a guard that does not carry the denominator's
state does — fires **7 times out of 12**. That is the false alarm this design exists to avoid.

## If it fails
- **The notice never fires, on a seat you know is large**: there is probably no window in any denominator state, so
  there is no fraction to score. `node cli.mjs config` shows what is set; declaring `DURIG_<PROVIDER>_CONTEXT` is an
  operator change. The guard is deliberately silent with no window rather than inventing a denominator.
  **#6066 changed where the `declared` number comes from:** `declaredContextWindow` now reads the family's own
  `DURIG_<PROVIDER>_CONTEXT` key first and falls back to the global `DURIG_CONTEXT_WINDOW`. Before it, declaring
  `DURIG_VERIFIER_CONTEXT: "24576"` was inert for the denominator — the resolver read only `DURIG_CONTEXT_WINDOW`,
  so a rig whose families all declared per-provider windows reported `declared: null` and every fraction printed as
  "no window". Two things still return null, by design: a provider key set WITHOUT its `BASE_URL` (the family is not
  registered, so there is no window to declare), and a registered family whose `CONTEXT` key is unset — its
  65,536 is a built-in DEFAULT, not an operator declaration.
- **`check` reports the rule as `skipped`**: the context read failed (unreadable store, or a store newer than this
  tree's pi-durable can open). The reason is printed with the skip — a skip is not a pass, and the audit of every
  other rule is unaffected.
- **You changed a threshold and the population exploded**: do not ship it. `demo/context-over-window.test.mjs`
  encodes the firing population, and `demo/starter.test.mjs`'s `CONTROL_FOR` ledger refuses any check rule that has
  no negative control — the rule must be shown failing somewhere before "0 findings" means anything.

## Escalate to
The **operator/delegate** for any capacity ruling (window size, compaction budget). Item **#1781** owns the question
of an actuator that stops a seat on context pressure; until it exists, this row signals and nothing more.

## Evidence
Item #5049 (ROADMAP 208), commit `4c1c3e4c`. The two blind spots the guard carries are recorded in
`src/context.mjs`'s header; the cause name is in `src/causes.mjs` so the notice and the rule cannot drift apart
(#5047's lesson). Population numbers are from a read-only query of the live store on 2026-11-04 (aggregate counts
only — the store holds other seats' transcripts and none of that content belongs in a runbook).
**2026-11-07 truth-up (#5362):** the `1.22x` quoted in Impact is a 2026-11-04 reading against the seat's **then**-declared
200,000 window, while this runbook's own Verify section scores the same artifact at **9.9x** — the two ratios sat side by
side with no reconciliation, which is how a stale denominator reads as a live fact. `last_verified` stays **2026-11-04**:
this pass corrected prose and did **not** re-run the Verify step against a readable store. Verified
2026-11-04 by the implement seat: `node demo/context-over-window.test.mjs` exit 0, and the full suite in the item
worktree 250/250.

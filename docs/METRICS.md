# Metrics — design note: measurement and UX

Status: **design note only; nothing is built.** The policy that motivates this is
D24 (what gets measured, evidence classes, the review loop). This file holds the
design that follows from it — how measures reach a human, where they live, and the
traps that would make them useless. Roadmap: near-term 2. Details deliberately left
open are in the last section, which is now a decision brief: each question carries
its options, a recommendation, and the evidence behind it.

## The problem metrics have that `check` does not

`check` is a pre-flight linter: you run it because you were already about to change
something. Metrics are **ambient** — their whole value is noticing something
*without* having asked. A metric reachable only through `node cli.mjs metrics` is
dead code in practice, because nobody runs a command they do not remember exists.

So the design problem is discovery and placement, not rendering.

## The move: metrics join the attention channel

durig already has the right concept. `computeAttention` emits machine-readable
notices (`idle_with_queued_work`, `last_run_failed`) that surface in `status`, in
`watch`'s footer, and as a yellow `!`. Extending that from *"a seat is blocked"* to
*"the rig is drifting"* means metrics inherit discovery, placement and rendering
instead of inventing a second visual language.

This also answers "where should it be visible": **the metric surface claims no new
screen real estate — it joins a channel the operator already reads.**

```
queue 1 queued · 0 claimed · 0 done | attention: worker idle_with_queued_work
queue 1 queued · 0 claimed · 0 done | attention: rig step-repetition 3.1/10 turns (baseline 0.4)
```

Same slot. **Signal is proportional to the anomaly**: nothing is drawn while
everything is in band, so a measure occupies space because it *moved*, not because
it exists. Nine measures permanently on screen is a wall of text that stops being
read by the second day.

## Tiers: depth on demand, awareness by default

| tier | surface | shows | interaction |
|---|---|---|---|
| Ambient | `watch` footer, `send` stderr | one line, **only when out of band** | none — you were already there |
| One-shot | `status` | band summary + the command name | none |
| Deliberate | `metrics` | full table: value, baseline, direction, evidence class, blind spot | one command, one flag for trend |
| Machine | `metrics --json` | the contract seats drive | none |

Two principles behind that table:

- **Repeated surfaces must not repeat onboarding; one-shot surfaces can.** `watch`
  redraws every commit, so naming `metrics` in its footer every render is nagging.
  `status` is run occasionally, so that is where discovery belongs — the same trick
  the empty-rig guardrail already uses ("Check with: node cli.mjs config").
- **Push beats polling** — durig's own lesson. The strongest awareness mechanism is
  a notice printed when a `send` settles and a measure crosses its band, in the
  command the operator was already running.

## Scope is a first-class dimension

`computeAttention` returns `{seat, kind, detail}` — seat-only by construction.
Metrics need `{scope, kind, detail}`, and every measure declares its scope, because
scope determines *where it renders* and *who can act*.

| scope | examples | renders as | actor |
|---|---|---|---|
| seat | step-repetition, stalled claim, completions with no retrieval call | the seat's `!` glyph + detail line | the seat, or the operator steering it |
| edge / pair | author and reviewer sharing a model | both seats named in one finding | operator (config) |
| rig | verifier coverage, cost per item, stampede rate | footer summary | operator (config) |
| queue | ageing queued items, claimed-but-stale, reopen rate | the existing queue summary line | operator / owning seat |

The **edge/pair** scope is the non-obvious one: correlated failure is neither a
seat property nor a rig property — it is relational. Attributing it to `qa` alone is
wrong (the fault is the match), and a rig-wide flag loses the specific pair you would
fix.

Contract consequence: adding `scope` changes `status`/`watch` JSON, and D19 says the
machine contract never changes silently. Keep `seat` on seat-scoped notices so
existing consumers keep working, or bump deliberately.

## The notice lifecycle

Attention notices today are recomputed per render with no state, which is right for
"worker is idle". A *drifting* metric can stay out of band for days, and a permanent
yellow `!` becomes wallpaper — so the one time it matters it is invisible. Needed:

- **hysteresis** — enter the band at one threshold, exit at a lower one, so it cannot
  flap around the boundary;
- **since-when** — `step-repetition ↑ (since 12:03)`, derivable from entry timestamps
  with no stored state;
- **precedence, one notice per subject** — mirror the existing `continue` in
  `computeAttention`: blocked (actionable now) outranks drift (advisory), so a seat
  row never stacks three lines.

Acknowledging a notice needs a write path, so it is deferred until hysteresis plus
"since" is shown to be insufficient.

## Three honesty traps

1. **Absence of activity is not improvement.** A paused rig has no new turns, so
   every rate holds still, and a stalled rig can read as a stable one. Windows must
   be computed from entry timestamps, and "no new data since 14:02" must be *said*
   rather than rendered as a good number. This is the sharpest trap for the goal
   "make sure it is not getting worse".
2. **Silence must be legible.** "no baseline yet", "all in band" and "metrics not
   enabled" are indistinguishable when nothing prints. They are textually distinct
   in the one-shot `status` — dim, but present. Same discipline as the empty-rig
   guardrail.
3. **Small N per seat.** A new seat has zero completions, so a naive per-seat rate
   reads "100% unverified" for a seat that has simply never worked. Seat-scoped
   notices need a minimum observation count *for that seat*; below it, report at
   pod/rig scope or stay silent. Cold start is silent per seat.

## A category error to avoid

**Config-derived measures have no trend.** Model diversity is a property of the spec,
not a rate over time, so an arrow beside it is meaningless. `direction` exists only
for measures that roll over a window; the renderer must suppress trend for the
config-derived class rather than drawing a flat arrow.

## Admission criteria for the ambient tier

A measure earns a place on the panel only if it is **actionable, rare when abnormal,
and not already visible**. Cost is the test case: important, but not actionable
turn-by-turn, and a per-item number on a seat row is noise — so it lives in
`metrics` only. Without this filter, "surface it where the user is already looking"
slowly rebuilds the wall of text.

## Do not let a measure become the goal

"Make sure it is not getting worse" invites treating a measure as a KPI the seats are
steered to optimise, and a diagnostic stops being a diagnostic once it is a target.
Concretely: no composite score, no gating a change on a single number, and every
value carries its blind spot. D24's review loop is the intended use — predict a
direction, check it, revert if it does not move.

## Rendering rules

- Every number travels with **baseline, unit and window** — `3.1 per 10 turns,
  baseline 0.4`, never a bare `3.1`.
- The **state word** (`ok` / `warn`) comes from the band, so nobody needs the
  threshold.
- The **blind spot prints beside the value**; a clean reading must never read as a
  pass.
- The **arrow carries the declared direction**: `step-repetition ↑ worse`, not `↑`.
- Severity stays legible **without colour**.
- **Zero interaction**: no keys, no wizard (D21). The interactive client later renders
  the same view model.

## Cost and freshness

Compute over a **bounded recent window** by default — the same reasoning as
`rigstory`'s `SCAN_LIMIT = 24` — so it is cheap enough to render inside `watch`;
`--window 7d|all` is for deliberate analysis. Recompute when the **newest entry id
advances**, never against a proxy signal: the removed seat-highlight cache pinned a
stale reading forever because it keyed on submission id while assistant turns kept
appending entries.

**Measured, not assumed** (2026-10-11, live `tutor-pi.sqlite`, 14 seats): one full
per-seat page scan of 24 entries each takes **0.9–1.4 ms**. `watch` polls every
750 ms, so this is ~0.15% of the render interval — and it is not a new scan:
`watch` already runs exactly this page fetch per render (`readSeatHighlights`), so
deriving a measure from that page adds arithmetic, not I/O. The paragraph above
asserted "cheap enough"; it now has a number.

The same run exposed the fact that matters most for scope (question 3): **13 of the
14 seats in the live store have zero entries**, and the only populated one is `pm`
(17). Every seat-scoped rate on the real rig is therefore unmeasurable today —
"Small N per seat" is the current state, not a hypothetical.

## Trends without opening a write path

The store is append-only and durable, so history already exists and a trend is a
query, not a record: compare the last window against the previous comparable one,
computed from data already present. That is why D24 keeps snapshot persistence
deferred.

The precise exception: **behaviour measures can be windowed from the store,
config-derived measures cannot** — you cannot reconstruct last week's models. That
one case needs history written down, and it is the same small tracked change-log the
review loop already needs, so a change and its prediction are reviewed in one diff.
One file, not a metrics store.

## Recommended first cut

Ambient notices in `status` + `watch` footer + settle-time push; one `metrics`
command with `--window`; the small tracked change log. Suggested first measures —
step-repetition (direct), unverified-completions (code-gated baseline), and
shared-reviewer-model (config-derived) — chosen so all three evidence classes are
exercised by the first cut.

## Open questions — decision brief (settle when work starts)

Each question now carries its options, a recommendation and the evidence behind it,
so a ruling is one line each. Question 2 is already answered by measurement; the
rest are the operator's call.

### 1. Which measures ship first

| measure | evidence class | why it is a candidate for the first cut |
|---|---|---|
| step-repetition | direct (counted from entries) | the MAST failure with the largest published rate (15.7%) and nothing detects it today |
| unverified-completions | code-gated baseline | the FC3 gap; the baseline is knowable because "did it retrieve?" is a fact about the turn |
| shared-reviewer-model | config-derived | item 3 turns on it, so it must exist *before* that change to be able to judge it |

**Options:** (a) those three; (b) one measure plus the machinery; (c) a different
set.

**Recommendation: (a).** It exercises all three evidence classes in one cut, and
two of the three are consumed by roadmap items that come after this one. Option (b)
leaves item 3 unjudgeable; (c) risks building machinery nothing downstream reads.

### 2. May `watch` spend a bounded scan per render? — settled by measurement

**Measured:** a full per-seat scan (24 entries × 14 seats) costs **0.9–1.4 ms** on
the live store, against a 750 ms poll. It is also not a *new* cost — `watch`
already performs exactly this page fetch per render.

**Recommendation:** derive measures from the page already fetched and add no second
scan. The stated fallback ("ride the attention computation") is *more* expensive,
not less: attention does no entry scan at all today, so it would introduce one.

### 3. All four scopes in the first cut, or seat + rig only?

**Evidence that changes the shape of this answer:** 13 of 14 seats in the live
store have zero entries. Seat-scoped measures are silent on the real rig *today*.

**Options:** (a) all four scopes; (b) seat + rig; (c) **rig + queue first**, with
the seat path written but self-gating.

**Recommendation: (c).** It passes the ambient admission test on a rig that is
currently idle instead of drawing nothing, and it keeps the minimum-observation
rule ("Small N per seat") load-bearing rather than decorative — seat scope switches
itself on once a seat has enough turns. It also defers the **edge/pair** scope,
which is genuinely `check`'s finding to raise: `shared-reviewer-model` is already a
`check` rule, and a config fact is not a trend.

### 4. Contract shape — additive `scope`, or a version bump?

**Options:** (a) add `scope`, keep `seat`; (b) bump the contract version.

**Recommendation: (a).** Existing consumers key on `seat` — `watchview.mjs:32`
filters `a.seat === seat.name` and the footer maps `a.seat` — and D19 governs
*breaking* changes: a field old readers ignore is not breaking. A bump is warranted
only if `seat` had to disappear, which rig- and queue-scoped notices do not force
(the field can hold the owning seat where there is one).

**The one place this can bite:** the per-seat glyph path must exclude rig-scoped
notices **explicitly**, not by the field being absent or null — otherwise a footer
notice either vanishes or renders against a seat row at random.

### 5. Hysteresis values, and whether "since" suffices without acknowledgement

**Options:** (a) per-measure absolute thresholds; (b) one relative rule (enter at
k× baseline, exit at 1×); (c) ship without hysteresis and add it when flapping is
observed.

**Recommendation: (b) for the rule, (c) for the sequence.** Ship with hysteresis
implemented but its thresholds left at defaults (enter 2×, exit 1×) and named per
measure, so tuning is one line rather than a redesign. Acknowledging needs a write
path, which D24 defers — so it stays deferred, and "since" plus hysteresis is
declared sufficient until evidence says otherwise. If it turns out insufficient,
that is a `security.sec` consult first, not a quiet new file write.

**Owed regardless of these answers:** the small tracked change-log. Config-derived
measures cannot be windowed from the store, so they need history written down, and
that is a **new write path** — which the security norms and D24 both gate behind a
`security.sec` position *before* it ships. Flagged in D24 and D27; the rig daemon
was down both times, so it is owed rather than settled.

### Not a question, but adjacent

Running the measurement opened a separate concern worth its own item: the live
store contains a seat the rig spec does not declare (`worker`, left over from an
earlier `up` of `rig.v2.json`), and `up` only ever adds or refreshes, so it will
remain. `check` already reads both sides and is the natural place for a
`stray-seat` rule — spec and store disagreeing is exactly the class it exists for.

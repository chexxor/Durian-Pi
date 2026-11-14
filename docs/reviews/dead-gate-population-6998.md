# The 63 is not a population — and the 41 terminal rows are not inert litter (#6998)

qa's correction is right, and it reproduced exactly here. Reading it as an intent rather than a script:
the split does not just shrink the number, it changes what the remedy has to be aimed at — and it exposes a
second defect qa did not look for.

**Tree:** branch `item-6998` (this worktree resolves `@earendil-works/pi-durable 1.3.0` from the lockfile —
`sync-pi --link` failed here, so it is NOT the seat root's 1.5.1). node v24.22.1, Linux, git 2.56.0.
Store: `/home/chexxor/Git/Durian-Pi/selfdev.sqlite`.

## Measured — twice, on purpose

The same command, 39 hours apart. This is the whole point: **the number is a snapshot, not a population.**

```
node tools/probes/dead-gate-status-split-6998.mjs --db=/home/chexxor/Git/Durian-Pi/selfdev.sqlite   exit 1
```

| | qa / 2026-11-12T05:38Z | re-run 2026-11-13T20:09Z |
|---|---|---|
| rows in the store | 6,995 (qa) / 7,077 (this worktree) | **7,687** |
| rows carrying a gate that names a CANCELLED row | **63** | **58** |
| …split by their own status | cancelled 34 · done 7 · held 13 · deferred 9 | cancelled 49 · done 8 · deferred 1 |
| **live stranded** (status not terminal) | **22** — all held or deferred, none `queued` | **1** (one deferred row) |
| terminal rows carrying a dead gate | 41 | 57 |
| rows whose gate names a non-existent id | 0 | 0 |
| rows that COMPLETED after their prerequisite was cancelled | — | **6** |
| `gated` / `ungated` transition events in the whole store | **0** | **0** |

A remedy written against "63 stranded rows" is aimed at a set that has already half-drained, and a check-rule
threshold set at 22 will read green or red depending on the day the store was dumped. **The rule has to be a
per-row predicate — "a row's gate names a cancelled id" — never a count.** The count is only ever a report.

What did NOT move between the two runs: the 6 rows that closed through a gate that could never close
(`3350, 3617, 4849, 4931` claimed after the cancel; 2 claimed while the gate was live and drifted after
admission), and the absence of any gate event in the transition log.

Transition event census (all of them): queued 6,378 · claimed 5,179 · done 4,702 · deferred 1,084 · resumed 265 · cancelled 928 · revised 506 · held 904 · released 216. No gate event of any kind. A gate is written and never recorded.

## The finding under the correction: 35 of the 41 are litter; 6 are evidence

Of the terminal rows carrying a dead gate, **6 completed AFTER their prerequisite was cancelled**:

- **2** were claimed while the gate was live and the parent was cancelled afterwards — the gate drifted after admission, and nothing re-checks a gate once a row is admitted.
- **4** were claimed **after** the parent was already cancelled — ids `3350, 3617, 4849, 4931`.

Those four are not a coincidence; they are what the code predicts. Claim-by-id checks only `to === me && status === "queued"` (`src/rig.mjs:853-856`) and never runs `workable`. The oldest-claim path does run the predicate (`src/rig.mjs:340-345`); the named-item path does not. So a row can be admitted through a dead gate on the by-id path, executed, and closed with a gate that could never close.

**Concrete fix, in order:**
1. `workable` should call `deadGateId` instead of re-walking the gate. `deadGateId` (`src/rig.mjs:312`) is called by exactly one site — the release refusal at `src/rig.mjs:1346` — while `workable` (`src/rig.mjs:332`) re-implements the walk inline, despite the comment at `src/rig.mjs:306` saying it was extracted "because two write paths now need it". The comment describes a sharing the code does not have.
2. The by-id claim path runs the predicate. Verified on this tree: the ONLY call site of `workable(` in `src/rig.mjs` is `:352`, the oldest-workable scan. The by-id branch (`src/rig.mjs:854-857`) admits on `it.to === me && it.status === "queued"` alone and returns `null` on a miss — no gate check, no reason code. A refusal must be a named reason (`gate-cancelled:#<id>`) so a stalled claim is legible instead of a silent `null`.
3. There is no admission path that checks the gate today that the by-id path does not: `grep -n pool src/rig.mjs` returns one hit (`:57`, a comment) — the pool claim seam described in the tool schema is not on this tree, so every claim that names an id bypasses `workable`.
3. Gate writes emit a `gated` / `ungated` transition, so drift is legible instead of inferred from a diff.

**Graduated severity, from the measurement rather than from instinct:**
- a gate naming a **cancelled** id: hard refusal at claim — measured cost today is **zero** rows (the impact tool reports 53 queued rows refused, all `gate-open`, none `gate-cancelled`).
- a gate that is merely **open**: refuse on the by-id path too, but only when the gate is an authored `blockedBy`; legacy-inferred gates are not enforceable until they are classified. Refusing 53 claims on the first run is the "a rule that starts red gets disabled" trap (#3539), so it ships as a report first.
- a **terminal** row carrying a dead gate: not stranded work; a store-integrity finding, reported separately so the check-rule threshold is never set against 63.
- a gate that is **inherited by inference** rather than authored: never enforceable. `src/checkup.mjs` has **zero** rules that read `blockedBy` (`grep -n blockedBy src/checkup.mjs` → no hits), and `src/heldgate.mjs:196` already classifies a `release-candidate` as "every gate it names is done or cancelled" — that classifier treats a cancelled gate as satisfied while the claim predicate treats it as blocking. Two readers of the same field, two answers, no arbitration. Fix: one predicate (`deadGateId`), one event stream (`gated`/`ungated`), and `heldgate`/`checkup` read the predicate rather than re-deriving it.

## The second defect: an inferred resolver is a fabricated authority

`legacyBlock` (`src/queue-lifecycle.mjs:250-260`, identical on main and item-6782) gives a held row with no
authored block a resolver by inference: `resolver: claimed ? item.to : "pm"`. Measured in this store:
**426 held rows — 160 carry an authored block, 266 do not**; 525 deferred rows carry an authored block in only
9 cases. So 266 rows are parked with a resolver nobody agreed to.

Failure mode: **loop**. A row parked with an inferred resolver looks intentional, wakes the seat, is never
clearable, and nothing can tell it apart from a row parked on purpose. That is the parked-forever class
registered in #5927 and the wake/claim disagreement in #6186/#6817. *Recovery:* mark the inference as an
inference (`source: "legacy"`, which it already carries, plus an explicit `inferred: true`), count it in
`heldgate`'s `unattributed` class (`src/heldgate.mjs:175`), and require either an explicit resolver or a
`reviewBy` before a parked row can be counted as intentional.

## Options considered, and the trade-off accepted

- **(a) Enforce the gate on every claim path now.** Cleanest. Accepted cost: 53 queued rows stop being
  claimable by id on the first run, and some of those gates are legacy-inferred rather than authored.
- **(b) Enforce only where the predicate is unambiguous — a cancelled or missing gate — and report open
  gates, graduating to refusal once the legacy rows are classified.** Chosen: zero cost today, reversible,
  and it does not start a rule red.
- **(c) Leave the by-id path alone and clean up the population afterwards.** Rejected: 6 rows already
  completed through a gate that could never close; the inflow is open.

## Re-verify

```bash
node tools/probes/dead-gate-status-split-6998.mjs --db=/home/chexxor/Git/Durian-Pi/selfdev.sqlite   # exit 1 while any row completed after its gate died (ran 2026-11-13T20:09Z: exit 1, 6 rows)
grep -n "deadGateId" src/rig.mjs            # two hits: :312 definition, :1346 the release refusal
grep -n "workable(" src/rig.mjs             # two hits: :320 definition, :352 the ONLY call site
sed -n '854,857p' src/rig.mjs               # by-id claim: to===me && status==="queued", no predicate
grep -n blockedBy src/checkup.mjs           # no hits - the gate is not measured
grep -n "resolver: claimed" src/queue-lifecycle.mjs   # the inference
```
Counts move with the store; the split and the mechanism do not.

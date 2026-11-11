---
review: the checkpoint gate is real, but its two remaining legs are unasserted and its margins are inside the noise
item: #6466
seat: architect
asked_by: pm
date: 2026-11-11
tree measured: worktree item-6466, pi-durable **1.3.0** from the lockfile (the seat root resolves 1.5.1; `sync-pi --link` failed here), node v24.22.1
probe: tools/probes/checkpoint-bound-size-leg.mjs (exit 1)
status: design position; devtools builds (#6465)
---

# The correction is right, and I reproduced it

`docs/evidence/2026-11-10-checkpoint-policy/probe.mjs` at `6c80d809` now asserts rather than prints. Three exit codes, run in this tree:

| invocation | result |
|---|---|
| default (5000 items, 3000 verbs, bound 200) | `RESULT: PASS`, **exit 0** |
| `PROBE_VERBS=100` | **exit 1**, two named violations ("chain should exceed the bound 200, measured 88"; "no base was written, so the bound is not doing anything") |
| `CHECKPOINT_BOUND=5 PROBE_VERBS=1000` | **exit 1**, "bound 5 write cost 1431.7 ms exceeds 2x the never baseline 152.5 ms" |

One thing the acceptance text should not do: it names measured values ("358.1 ms exceeds ... 126.8 ms"). Those do not reproduce here (1431.7 vs 152.5). The **exit code and the named relation** are the contract; the numbers are a property of one machine at one moment. An acceptance that quotes literals reads as a regression on any other host, and a criterion nobody can reproduce is not a criterion.

# The leg that is still only printed

The gate asserts five things. It never asserts the one pm's correction asked for: that a bound high enough to never fire is as wrong as one that fires on every verb. The `bound 1000` policy is measured and printed but never gated — at 1000 verbs it writes **0 bases**, at 3000 verbs **2**. A bound that cannot be distinguished from `never` looks verified because it appears in the table.

Concrete fix: gate `byPolicy["bound 1000"].basesWritten > 0` or assert its read median is worse than the chosen bound's, and let `CHECKPOINT_BOUND` be raised to prove the gate bites in that direction too.

# The size leg, measured

New standing probe: `tools/probes/checkpoint-bound-size-leg.mjs` (1000 verbs per policy, pi-durable 1.3.0, node 24.22.1).

| doc class | store | read median: never / everyVerb / b50 / b200 (ms) | write total: never / everyVerb / b50 / b200 (ms) |
|---|---|---|---|
| small (20 items x 50 B) | 221 KB | 3.48 / **0.07** / 0.08 / 0.51 | 181.6 / 182.5 / 107.0 / 92.8 |
| medium (500 x 240 B) | 414 KB | 3.24 / 0.66 / 0.73 / 1.05 | 104.3 / 1009.1 / 118.5 / 103.2 |
| large (5000 x 1200 B) | 7.0 MB | 15.39 / 14.07 / 13.18 / 13.61 | 119.8 / **28250.7** / 874.3 / 272.6 |

Three things follow, and none of them is "one bound for all docs":

1. **For a small value, checkpointing on every verb is not the worst policy.** Read 0.07 ms vs 3.48 ms, write 182.5 vs 181.6 ms — inside noise. The verb-class prohibition is true where a base write is expensive; stated as a universal rule it invites someone to apply it to a note doc and take a 48x slower read path. The ruling's boundary must carry the size condition.
2. **For a large value, bound 200 costs 2.28x the never write baseline** (272.6 vs 119.8 ms) — over the 2x slack the gate asserts. Three runs of the identical configuration gave **1.98x, 2.28x, 2.50x**. A threshold that the measurement straddles is not a gate; it is a coin that gets flipped in front of people, and a coin that flips gets ignored.
3. **The optimum is not monotonic in size.** For the large class, b50 reads 13.18 ms at 874 ms of write cost while b200 reads 13.61 ms at 272.6 ms. The real variable is the ratio of base-write cost to delta-replay cost — value size and verb cadence together — not value size alone.

# Failure modes, recovery, check

| failure | class | recovery | check |
|---|---|---|---|
| acceptance quotes machine-specific literals | false red | state relations (`exit 1 with a named violation`), never measured values | the three invocations above |
| the gate's margins are smaller than run-to-run noise | flapping | repeat each policy N times and compare medians; require a margin (gate at 2x only when observed is comfortably under), i.e. hysteresis | the probe reports the ratio per class; it exits 1 today |
| a bound nobody can distinguish from `never` | silent | assert the over-high policy writes at least one base, or is measurably worse on read | printed `bound 1000` row, currently ungated |
| one global constant applied to every doc | contradiction | per-doc declared bound + declared slack, each validated by a size-class run | the size probe, exit 1 until declared |
| the prohibition generalised to small docs | cascade | scope the rule to doc classes with a declared bound | probe NOTE line for the small class |

# Options and the trade-off

- **(a) keep one global bound (200) and one global slack (2x).** Rejected: measured false for two of three classes.
- **(b) per-doc declared bound and per-doc slack, each validated by a size-class probe run.** Chosen. Cost: probe runtime, and every doc must declare a number. Reversible: an undeclared doc falls back to the 200/2 pair, so nothing breaks today.
- **(c) derive the bound at runtime from observed cadence.** Rejected for now: the predicate runs inside the write path — the hottest seam — and the resulting number would not be auditable from the log. Auditable beats clever here.

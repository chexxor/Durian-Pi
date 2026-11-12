---
runbook: compaction-acceptance-measure
symptom: "'truncated summaries dropped to zero' — but I need the number, not the claim"; "is the acceptance instrument still able to fail?"; "the 100-compaction run took half an hour and reported FAIL and I do not know why"
writes: false
precondition: "read-only against the store you point it at; the LIVE tranche needs the broker stopped"
last_verified: 2026-11-10
verified_by: devtools
evidence: "#6131 (tools/compaction-acceptance.mjs, branch item-6131); measured in that tree, pi-durable 1.5.1 built-pin, node v24.22.1, Linux kernel 7.2.15-300.fc45.x86_64: seed 0.99 s exit 0; armed 1.02 s exit 0 (100 tasks, 100 summaries placed, 0 truncated, 0 summariser requests); negative control 0.4 s exit 0 (9 truncated == 9 summariser requests); inverse control exit 1 (0 truncated, 9 summaries placed); live store with the broker resident: exit 1, 70 of 100 tasks settled, 1809.7 s"
check_rule: null
---

# Measure the compaction-acceptance claim, and prove the instrument can still go red

## When to use
ROADMAP 331's acceptance is "truncated summaries drop to zero over 100 compactions". Nobody can satisfy that with
natural seat compactions — 100 of them cannot happen in one session — so the number is **driven**: `tools/compaction-acceptance.mjs`
copies a store with SQLite's own backup API, runs compactions on the copy, and counts what the harness wrote. Use
this runbook when you need that number, or when you suspect the instrument has quietly become a rubber stamp.

## Impact
A truncated summary is not a degraded summary — the harness **does not place it at all** (measured: the
`stopReason=length` tranche recorded 9 truncations and placed 0 summaries, while the identical `stopReason=stop`
tranche placed 9). So a seat whose summariser keeps hitting the output ceiling loses the compaction entirely and
its window keeps growing. That is the mechanism behind `Auto-compaction failed: … hit the token cap`, and it is why
the count has to be re-measured rather than trusted.

## Which plane the number is scored on (ruled, #6383 — lead)

**The fixture gates; the live measurement never does.** A gate that cannot run reproducibly is not a gate: the
fixture the demo builds is deterministic, needs no broker, and its numbers are comparable tree to tree. The live
tranche with the broker resident settled 70 of 100 tasks, hit the 20 s bound on ~50 growth turns, took **1809.7 s**
and **exited 1** — a signal that exits non-zero on the real store cannot be what a milestone is scored against.
The **27.9 s** datum previously quoted for N18 is not reproducible while the broker is resident, so it is not a
measurement of anything current: it stays in the archive with its provenance, and any live number gets recorded
separately with the broker state, the tree and the resolved version labelled beside it.

Re-measured 2026-11-12 in branch `item-6384` (tree `9655e761`, `@earendil-works/pi-durable` **1.3.0 from the
lockfile** — vendor/pi-main not built, so this is NOT the same plane as the 1.5.1 built-pin run above):
`node demo/compaction-acceptance-gate.test.mjs` exit **0** in 3052 ms — positive 100 compactions, 100 summaries
placed, 0 truncated, 0 summariser requests; negative control 9 truncated == 9 requests, 0 placed; inverse control
0 truncated, 9 placed, instrument exit 1.

## What the instrument is counting, and the error family it belongs to

The quantity is **summaries placed**, not "compactions attempted". A truncated summary is not a degraded summary:
the harness does not place it at all. `stopReason=length` yields 9 truncations and 0 placed; the identical
`stopReason=stop` tranche yields 9 placed. So "0 truncated" next to "0 placed" is a compaction that silently did
not happen — the same event behind the `Auto-compaction failed: … hit the token cap` notice. A check that reports
"compaction ran" on those two numbers is measuring the wrong thing.

That is the same instrument error in three places, and it is worth naming together because the fix is the same —
report the quantity that exists, not the quantity that would have been convenient:

- **#6344** — the doc guard passing a ledger that contained duplicate D-numbers.
- **#6366** — the suite runner manufacturing its own timeouts and reporting them as test failures.
- **here** — a tranche that placed nothing being read as "no truncations, so the milestone is met".

The gate/instrument split (#6382) is the bookkeeping half of the same idea: `tools/compaction-acceptance.mjs`'s
exit code is a measurement of one tranche, and it is data. The thing that decides is the demo's own exit code, as
read by the suite.

## Diagnose (read-only, no key, no model, no broker)

Run the four commands **in order**. The second through fourth read the snapshot the first one wrote: a brand-new
seat conversation has no cut to summarise, so running 100 compactions against an empty store reports "0 truncated"
while placing nothing — a zero that measures nothing.

```bash
cd /home/chexxor/Git/Durian-Pi
node tools/compaction-acceptance.mjs --db ./selfdev.sqlite --copyDir .spike/acceptance-seed --target 120 --mode armed
node tools/compaction-acceptance.mjs --db .spike/acceptance-seed/acceptance-snapshot.sqlite --copyDir .spike/acceptance --target 100 --mode armed
node tools/compaction-acceptance.mjs --db .spike/acceptance-seed/acceptance-snapshot.sqlite --copyDir .spike/acceptance-ctl --target 12 --mode control --stopReason length
node tools/compaction-acceptance.mjs --db .spike/acceptance-seed/acceptance-snapshot.sqlite --copyDir .spike/acceptance-inv --target 12 --mode control --stopReason stop
```

Every run prints `PROVENANCE tree=<sha> branch=… pi-durable=… dependencySet=…` and names the snapshot file it
counted. **A number without that line is not a measurement**: an item worktree without `sync-pi --link` resolves
pi-durable 1.3.0 from the lockfile while the live store was written by 1.5.1, and the two do not agree.

## Verify (all four exit codes were run, 2026-11-10, branch item-6131)

| tranche | expected | measured |
|---|---|---|
| seed (armed, 120) | exit 0, markers > 0 | 0.99 s, exit 0, 68 markers |
| **positive** (armed, 100) | exit 0, 100 tasks, **0 truncated**, **0 summariser requests** | 1.02 s, exit 0, 100 tasks, 100 markers, 0 truncated, 0 requests |
| **negative control** (control, `stopReason=length`) | exit 0, truncated **> 0** and equal to the summariser-request count | 0.4 s, exit 0, 9 truncated == 9 requests, 0 summaries placed |
| **inverse control** (control, `stopReason=stop`) | exit **1**, 0 truncated | exit 1, 0 truncated, 9 summaries placed |

The suite runs the same three halves against a fixture store it builds itself:
`node demo/compaction-acceptance-gate.test.mjs` (2.4 s, exit 0). That is the gate; `tools/compaction-acceptance.mjs`
is the instrument the gate wraps, and its exit code is not the pre-landing gate.

## If it fails
- **The inverse control exits 0** — the instrument is a rubber stamp. The truncation counter is no longer tied to
  the harness branch at `pi-durable/dist/harness/compaction.js:303`. Stop using the number and report it; that is
  the finding lead asked for.
- **Markers placed = 0 in the positive tranche** — the store you seeded has no conversation deep enough to cut
  (`keepRecentTokens = 20000`; a growth turn is ~1,150 tokens, so ~18 turns are needed per seat before a cut
  exists). Re-run the seed with a larger `--target`, or point `--db` at a store with real seat history.
- **The live tranche stalls** ("growth turn did not settle within 20000 ms", ~30 min wall clock, exit 1): the
  snapshot was taken while a broker was mid-turn, so the copy carries in-flight tasks (docs/SELFDEV.md pitfall 223).
  Stop the broker (`kill -INT <pid>`, see `docs/runbooks/broker-down-or-stalled.md`) and re-run, or use the fixture
  path. Do not read a stalled live run as "compaction is broken".

## Escalate to
pm, if the negative control stops firing or if the live tranche is the only way to get the milestone number and the
broker cannot be stopped inside the measurement window.

## Evidence
#6131 (promotion) and #6128 (the suite wrapper), branch `item-6131`, measured 2026-11-10 in that tree.

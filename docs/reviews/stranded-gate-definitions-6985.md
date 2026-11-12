# Reconciled: the "23 stranded gates" is one population, and the number is not stable (#6985)

Two instruments printed 23. They are the same rows — but only because of how each one defines "stranded",
and the count itself drifts with the snapshot. Measured, in one tree, at one instant.

**Tree:** branch `item-6985`, `@earendil-works/pi-durable 1.3.0` from the lockfile
(the `sync-pi --link` step failed in this worktree, so the seat root's 1.5.1 is NOT the dependency set here),
node v24.22.1, Linux, git 2.56.0. Store: `/home/chexxor/Git/Durian-Pi/selfdev.sqlite`.

## The measurement

```
node tools/probes/stranded-gate-census-6664.mjs                  exit 1
node tools/workable-impact-measure.mjs --db=...                   exit 0
node tools/probes/stranded-definition-reconcile-6985.mjs --db=... exit 0
```
Snapshot `2026-11-12T04:29:14Z`, 7,063 rows: done 4,693 · cancelled 928 · held 426 · deferred 525 · queued 485 · claimed 6.

| definition | what it counts | rows |
|---|---|---|
| **A — census** (#6806) | an *active* row whose gate names a **cancelled or non-existent** id | **22** |
| **C — impact tool's parked bucket** (#6825) | held/deferred row with ≥1 cancelled gate (13 held + 9 deferred) | **22** |
| **B — "a gate that is not closed"** | any row whose gate is not `done` (includes rows waiting on live work) | **216** |

**A and C are the same 22 ids** — the probe prints both lists and the symmetric difference is 0:
`3377, 3452, 3456, 3663, 4820, 4852, 4853, 5608, 5816, 5817, 5925, 5940, 5942, 5946, 5947, 5953, 5954, 5973, 5988, 5990, 5994, 6005`.
Of those 22: 0 name a non-existent row, all 22 name a cancelled row; 13 held, 9 deferred; 9 carry a resolver, 13 do not; age since first transition min 2 days, median 3, max 23.

The "23" in both bodies came from an earlier snapshot (the census commit records `23 ... exit 1 at snapshot 2026-11-11T13:32:14Z`). It was never a definitional discrepancy — it was the same population at a different time.

## Why the match is fragile, and what to fix

1. **B is the trap.** 216 rows have a gate that is not closed; 194 of them are waiting on a **live** row —
   legitimate waiting, not damage. Any severity or alert keyed to "gates not closed" is 194 rows of noise
   sitting on top of 22 real ones. *Recovery:* the census must state its definition in its own output
   ("gate names a cancelled or missing id"), and a rule may only count A.
2. **The number moves, so it cannot be a threshold.** 23 → 22 across a day. *Recovery:* a rule reports the
   population and the snapshot time, and severity is keyed to the *class* (mint-time: hard error;
   read-time: soft), not to a literal count. That is the #6992/#6998 rule made concrete.
3. **All 22 are parked.** None is `queued` or `claimed`, so nothing is starving a running seat today; the
   only lever on a parked stranded row is cancel (`release_work` refuses to un-park a stranded row). *So:*
   mint-time validation costs nothing now (0 rows would be affected — there is no dangling population) and
   is a hard error; read-time reporting of the existing 22 is observation, not a gate. The 13 with no
   resolver are the ones nobody can clear except by cancelling them.
4. **Instruments are not worktree-portable.** The census probe imports `../../../src/readclient.mjs`
   (`tools/probes/stranded-gate-census-6664.mjs:17`). Run from an item worktree, that path resolves to the
   **shared** checkout's `src/`, not the tree the instrument is standing in — so a probe can be green
   against a different code base than the branch it came from. My reconcile probe uses `../../src/…` and
   reads its own tree. *Recovery:* probes resolve their imports relative to their own file, and the
   landing gate/audit should check the depth, because this is the same class as the portability finding in
   #5191.

## The falsifiable claim

`node tools/probes/stranded-definition-reconcile-6985.mjs --db=<store>` exits **0** iff the census
population and the parked-with-cancelled-gate population are the same ids. If a `queued` or `claimed` row
ever acquires a cancelled gate, the two sets diverge and the probe exits 1 naming the ids — that is the
red-first case the `stranded-gate` rule in #6499 should be built on.

## Re-verify

```bash
node tools/probes/stranded-definition-reconcile-6985.mjs --db=/home/chexxor/Git/Durian-Pi/selfdev.sqlite
node tools/probes/stranded-gate-census-6664.mjs        # DURIG_DB=... ; exit 1 while any stranded row exists
node tools/workable-impact-measure.mjs --db=/home/chexxor/Git/Durian-Pi/selfdev.sqlite   # exit 0, buckets
```
Every number here is from the snapshot printed by the run above; re-run and the count may differ — that is
the point of the finding, not an error in it.

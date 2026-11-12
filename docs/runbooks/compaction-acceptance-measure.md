---
runbook: compaction-acceptance-measure
symptom: "'truncated summaries dropped to zero' — but I need the number, not the claim"; "is the acceptance instrument still able to fail?"; "the 100-compaction run took half an hour and reported FAIL and I do not know why"
writes: false
precondition: "read-only against the store you point it at; the LIVE tranche needs the broker stopped"
last_verified: 2026-11-10
verified_by: devtools
evidence: "#6131 (tools/compaction-acceptance.mjs, branch item-6131); measured in that tree, pi-durable 1.5.1 built-pin, node v24.22.1, Linux kernel 7.2.15-300.fc45.x86_64: seed 0.99 s exit 0; armed 1.02 s exit 0 (100 tasks, 100 summaries placed, 0 truncated, 0 summariser requests); negative control 0.4 s exit 0 (9 truncated == 9 summariser requests); inverse control exit 1 (0 truncated, 9 summaries placed); live store with the broker resident: exit 1, 70 of 100 tasks settled, 1809.7 s. Natural-leg one-liner in 'Which population a number belongs to' re-run 2026-11-12 by scribe (item #6537) against selfdev.sqlite: exit 0, n=113 truncated=0; the four driven tranche exit codes above were NOT re-run on that date"
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

## Which population a number belongs to (label it before you quote it)

Per the convention in `docs/ROADMAP.md` row 331 (#6077): every figure carries **INTENDED** (a target someone
proposes) or **RESOLVED** (what was actually recorded, on a named tree and dependency set). A number with neither
tag is not evidence, and a driven number and a natural number are never the same number.

| figure | population | label | where it came from |
|---|---|---|---|
| "100/0" | **driven** — 100 compaction tasks forced on a snapshot copy | **RESOLVED** (driven) | the positive tranche in the Verify table below: 100 tasks, 0 truncated, 0 summariser requests, exit 0 |
| markers placed in that tranche | **driven** | **RESOLVED** (driven), per run | this runbook's own table records **100 markers** for the 2026-11-10 `item-6131` run; devtools' later tranche (#6162) recorded **96 markers** (67 continuity-note, 96 deterministic digest — one summary can carry both) because **four tasks had nothing to cut**. Both are driven runs; the marker count tracks how deep the seeded conversation is, so read it only together with that run's `PROVENANCE` line. **Tasks counted is not summaries placed** — do not read "100/0" as "100 summaries, 0 truncated" |
| 9 compactions, 0 truncated, 9 note-backed | **natural** — compactions real seats actually ran | **RESOLVED** (natural), as of 2026-11-09 | `docs/DECISIONS.md`, the entry headed "**The measurement is driven, and says so**" (grep for it), open window |
| 53 compactions, 0 truncated | **natural**, window since `2026-11-10T00:13:44.045Z` in `selfdev.sqlite` | **RESOLVED** (natural), as of devtools' #6162 run — reported there, **not re-run by this scribe pass** | pm's summary of #6162 |
| 113 compactions, 0 truncated, 136 entries carrying a CONTINUITY-NOTE summary | **natural**, the same window, re-measured | **RESOLVED** (natural), as of 2026-11-12T06:25Z, this worktree, store `selfdev.sqlite` | the one-liner below, exit 0 |

Re-measure the natural leg in one command (read-only, no broker, no model):

```bash
node -e 'const {DatabaseSync}=require("node:sqlite");const db=new DatabaseSync("./selfdev.sqlite");const s=Date.parse("2026-11-10T00:13:44.045Z");console.log(db.prepare("select count(*) n, sum(record like ?) truncated from tasks where kind=? and json_extract(record,\x27$.startedAt\x27) >= ?").get("%hit the token limit%", "\"pi.compaction\"", s))'
# → [Object: null prototype] { n: 113, truncated: 0 }   exit 0
```

The predicate is the same one `docs/evidence/2026-11-08-context-window/milestone-check.mjs:351` uses, so the two
instruments count the same thing. The window is open: the count moves, so always quote it with its as-of timestamp
and its store. The **driven** figure never moves into the fleet column, and the fleet figure never satisfies the
driven target.

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

## Verify (all four exit codes were run, 2026-11-10, branch item-6131; the natural-leg one-liner above was run 2026-11-12 by scribe, item #6537)

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

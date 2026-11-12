# Gate disposition sheet — the 23 rows gated on cancelled ids (#6656, sheet built by #6754)

**What this is, and what it is not.** Lead ruled in #6656 that each row gated on a dead id is decided by
its **sender** in one line: "still wanted" or "not wanted". That decision cannot be made until someone
states, per row, what the gate composition actually is. This sheet is that statement. **No disposition is
decided here** — the last column is blank and belongs to the sender.

**Measured.** `DURIG_DB=/home/chexxor/Git/Durian-Pi/selfdev.sqlite node cli.mjs queue --json --no-body`
→ **exit 0**, 6,847 rows, on **2026-11-11T18:01Z** (UTC), store `selfdev.sqlite`, broker pid 2876055
resident. Status census at that moment: 4,602 done, 923 cancelled, 430 held, 524 deferred, 7 claimed,
361 queued. The first attempt was refused by the resident broker (exit 1, `read queue-census: timed out
awaiting the broker's result (broker pid 2876055 is resident and 4 seat(s) hold live generation leases, so
a direct read is not safe)`); it succeeded on retry. Read-only throughout — nothing in the store was
written by this sweep.

**Definitions used.** A gate id is **dead** if the row it names exists and is `cancelled`; **resolved** if
it is `done`; **live** if it is `queued`, `claimed`, `held` or `deferred`. A row is on this sheet only if it
is non-terminal and names at least one dead id.

**Count unchanged:** 23 rows, **17** distinct dead ids — 3343, 3274, 3455, 3660, 4819, 4847, 2712, 5605,
5815, 5924, 5937, 5945, 5968, 5986, 5989, 5993, 6003. All 17 are cancelled rows; **none** is a dangling
id that does not exist. Split: **14 held, 9 deferred**. Class A (dead id is the only gate, ignoring
resolved gates): **21 rows**. Class B (dead id plus a live gate): **2 rows** — #5953, #5954.

| row | sender | recipient | status | gate composition | class | park state as measured | sender's disposition (blank) |
|---:|---|---|---|---|---|---|---|
| 3377 | pm | impl | held | #3343 dead | A | no park record |  |
| 3452 | pm | impl | held | #3274 dead | A | no park record |  |
| 3456 | pm | impl | held | #3455 dead | A | no park record |  |
| 3663 | pm | impl | held | #3660 dead | A | no park record |  |
| 4820 | lead | impl | held | #4819 dead | A | dependency/#4819, reviewBy 2026-11-04 |  |
| 4852 | pm | impl | held | #4847 dead | A | dependency/#4847, reviewBy 2026-11-06 |  |
| 4853 | pm | impl | held | #4847 dead | A | dependency/#4847, reviewBy 2026-11-06 |  |
| 5438 | architect | pm | held | #2712 dead | A | dependency/#2712 (impl, wake-selection half of the `workable` predicate; carrier for this probe), reviewBy 2026-11-14 |  |
| 5608 | lead | pm | held | #5488 done + #5605 dead | A | dependency/#5488, reviewBy 2026-11-15 |  |
| 5816 | pm | impl | held | #5815 dead | A | dependency/qa #5815, reviewBy 2026-11-15 |  |
| 5817 | pm | impl | held | #5815 dead | A | dependency/qa #5815, reviewBy 2026-11-15 |  |
| 5925 | pm | lead | deferred | #5924 dead | A | deferred to human, no block record |  |
| 5940 | pm | qa | deferred | #5937 dead | A | deferred to human, no block record |  |
| 5942 | pm | scribe | deferred | #5937 dead | A | deferred to human, no block record |  |
| 5946 | lead | devtools | deferred | #3343 dead | A | deferred to human, no block record |  |
| 5947 | pm | impl | deferred | #5945 dead | A | deferred to human, no block record |  |
| 5953 | pm | devtools | held | #5947 live(deferred) + #5945 dead | B | schedule/operator, reviewBy 2026-11-16 |  |
| 5954 | pm | devtools | held | #5947 live(deferred) + #5945 dead | B | schedule/operator, reviewBy 2026-11-16 |  |
| 5973 | pm | impl | deferred | #5968 dead | A | deferred to human, no block record |  |
| 5988 | pm | devtools | held | #5986 dead | A | dependency/pm, reviewBy 2026-11-15 |  |
| 5990 | pm | devtools | deferred | #5989 dead | A | deferred to human, no block record |  |
| 5994 | pm | impl | deferred | #5993 dead | A | deferred to human, no block record |  |
| 6005 | pm | impl | deferred | #6003 dead + #6004 done | A | deferred to human, no block record |  |

## What the sheet says that the ruling's examples do not

1. **Two of lead's three class-B examples are no longer class B.** #6656 lists "#5608 → #5488 open +
   #5605 cancelled" and "#6005 → #6003 + #6004". Measured on 2026-11-11: **#5488 is `done`** and **#6004
   is `done`**. Both rows therefore have a resolved gate plus one void gate — they behave as class A. Only
   **#5953 and #5954** still carry a live gate (#5947, `deferred`). If a tool or a rule branches on
   "dead + live", it must recompute per row; the composition is not stable between the ruling and the
   store.
2. **The one class-B chain is still shut even after the dead id is dropped.** #5953/#5954 are gated on
   #5947, and #5947 is itself gated on #5945 (cancelled). Clearing #5945 from #5953/#5954 without also
   clearing it from #5947 leaves the chain unresolvable: the live gate can never reach `done`. So the
   disposition for those two rows has to be made **together with #5947**, not row by row.
3. **Four held rows are parked with no park record at all** — #3377, #3452, #3456, #3663 have status
   `held` and no `block` object, so no reason, no resolver, no reviewBy. That is precisely the shape
   #6663 says must not exist. The other ten held rows do carry a declared block.
4. **Three parks are already past their reviewBy date** as of 2026-11-11: #4820 (2026-11-04), #4852 and
   #4853 (2026-11-06). Nobody looked, and the sheet shows the date was decorative.
5. **The nine deferred rows are the exposed ones.** All nine (#5925, #5940, #5942, #5946, #5947, #5973,
   #5990, #5994, #6005) are `deferredTo: human` with **no** block record, and per #6656 `resume_work`
   moves deferred → claimed with no gate check (`rig.mjs:1224-1246`, wake at `driver.mjs:115`). The senders
   owe a one-line disposition on these before any seat is woken onto them.

## Who has to answer

Senders measured: **pm — 19 rows** (3377, 3452, 3456, 3663, 4852, 4853, 5816, 5817, 5925, 5940, 5942,
5947, 5953, 5954, 5973, 5988, 5990, 5994, 6005); **lead — 3 rows** (4820, 5608, 5946); **architect — 1
row** (5438). Each sender is asked, in one line per row, for "still wanted" or "not wanted". The rows fall
into the classes above; the interim per #6663 is *hold with a reviewBy date and a named resolver*, never
cancel-and-release, until the clear-a-void-gate path (#6552/#6530) exists.

**Last update:** 2026-11-13T23:5xZ (delegate). `HEAD` = the commit carrying this pointer (`git rev-parse --short HEAD`);
every milestone object is in the sha table below. Ahead of `origin/main`, **nothing pushed** — the push grant is the
operator's.

**Milestone this window worked** — **N19 "The Pool" (D275), made USABLE and PROVEN ALIVE.** One line per shipped object,
in order:

| sha | shipped |
|---|---|
| `655c44e2` | `revise_work` takes `requires` (normalised, one `revised` transition, two refusals) |
| `1782b495` | pool doctrine in the shared `constitution.txt`; `peek_queue`/`WAKE_CONTENT`/`queueItemLine` aligned |
| `4ed6b8d0` | `tools/pool-migrate.mjs` — read-only proposal instrument |
| `36f57a36` | its roster-shape fix (an AMEND of `01ff4c91`, which is not on `main`) |
| `517dc58d` | window seam: `up --refresh` records `usableWindow` for all 12 seats (gate armed) |
| `99250682` | spec §13, FEATURES, D275 addenda (f)–(k), pitfalls, pointer rewrite |
| `78bc0364` | live `check rig.selfdev.json` finding on #7660 + pitfall 324 |
| `1c0c5920` | gate proven on the roster; `pool-gated:<n> #<id>(<reason>)` |
| `2bfb9e43` | frozen-broker note |
| `f6177f21` | authority narrowed to the contract, gate number 115023, §13.3b reconciliation |
| `02105352` | demo prints the refusal + reads the LIVE roster; broker windows; live decline line |
| `c4b0ea7e` | `tools/pool-gate-live-probe.mjs` + test (refusal from a byte-copy of the live store) |
| `d37bd216` | the gate-proof demo's header: 117891 → 115023 |
| `5363e377` | pointer sha table names every object, no "this commit" |
| `7008d11d` | pointer re-cut to fit the clockin digest budget (115 lines) |
| `ac6b7a8a` | lifecycle field table gives `requires` its own row; live census |
| `4f9e87d9` | the LIVE scheduler refuses #7700 by name for every seat |
| `8abc961e` | flake recorded (restart-limit under --jobs 4) |
| `35ff79f2` | broker windows 4-5, blocker (1) TRIGGERED, rate window closed at 22:13Z |
| `446c4084` | the gate FIRED live: #7700 refused by architect and pm; spec/D275 corrected |
| `06de1bba` | deleted the sentences that still DENIED the live firing (spec §13.4, D275 (m)) |
| `18c7a3b8` | pool census re-read (5 pooled / 3 open; #7722 minted organically) |
| `3fb50030` | pause/unpause evidence + refresh timing; pointer arithmetic (104 = 85+19) and shas |
| `HEAD` | the commit carrying this pointer (`git rev-parse --short HEAD`) — the table cannot name itself |

Read `docs/POOL-QUEUE-SPEC.md` **§13, §13.3b, §13.4** (code's own strings; the number reconciliation; the live evidence)
and `docs/reviews/2026-11-13-capability-ownership-ruling.md` (FIVE decisions).

**Broker windows this session — commanded bound, reason, and the exit it replaced.** A window is a LEASE:
| pid | `--max-duration` | START → EXIT | actual | reason / replaced |
|---|---|---|---|---|
| 98022 | 3600 s | 17:32:55.451Z → 19:11:54.118Z | 5,939 s | no broker resident (replaced a 05:57:09Z deadline exit) |
| 311912 | 3600 s (keepalive) | 19:11:56.490Z → 20:42:10.249Z | 5,414 s | STRANDED (no pass 2350 s, 1 intent) |
| 540123 | 1800 s | 20:42:21.399Z → 21:32:41.503Z | 3,020 s | 311912 alive-but-dead; `serve --stop` refused → `kill -TERM` → `resume` |
| 774849 | 1800 s | 21:34:01.725Z → 22:13:24.335Z | 2,363 s | 540123 froze past its deadline; same fallback |
| 899525 | keepalive's own bound (NOT recorded by it) | 22:13:26.113Z → 00:10:24.944Z | 6,418 s | 774849 stranded; exited `reason=max-duration passes=335` |

Every window was **commanded** ≤ 3600 s, and **windows 1–2 overran their command and lingered in read-drain** (the
documented alive-but-dead shape) — that overshoot is a base defect, not a licence; the keepalive path records no
commanded bound, which is a recording gap in that tool. Liveness is the last ` PASS ` line (pitfall 304), so read
`grep ' PASS ' selfdev.sqlite.broker.log | tail -1` and `cat selfdev.sqlite.broker.json` BEFORE acting.

**Host for every number below**, measured with the measurement: **Linux**, Fedora Linux 45 (Forty Five), kernel
`7.2.15-300.fc45.x86_64`, node **v24.22.1**, `git version 2.56.0` — probe:
`uname -s && uname -r && (. /etc/os-release && echo "$PRETTY_NAME") && node -v && git --version`.

## NEXT SESSION

**Current item:** **the N19 pool is CLOSED — usable, alive, and the gate has fired on a LIVE seat.** `pm` minted
**#7700** (`pool:true, tier:"project"`, `21:20:16.789Z`); the live scheduler refuses it by name for every seat
(`SKIP auditor reason=pool-gated:2 #7660(requires:docs),#7700(too-big:project(120000 tokens > 70% of the 12288-token
usable window))`, 113 lines by 21:47Z); and **two real seats claimed it by id and were REFUSED** — `size-refused` on
the row `by=architect` `22:04:21.104Z` and `by=pm` `22:44:08.942Z`, reason
`too-big:project(120000 tokens > 70% of the 164320-token usable window)`. Their live transcript carries the whole
string, verbatim: `CLAIM_REFUSED: #7700 is in the POOL but you cannot claim it (too-big:project(120000 tokens > 70% of
the 164320-token usable window)). It was sent by pm. … Split it: send_work the pieces …, then close #7700 with
complete_work(itemId: 7700, closedAs: "split", children: [...]) - a row nobody can finish is a sizing problem, not a
queue problem.` Census: **`sizeRefused: 1`**. Corroborated by `demo/pool-gate-live-roster.test.mjs` (live roster) and
`tools/pool-gate-live-probe.mjs` (byte-copy of the live store: impl and auditor each refused with `Split it: …`).

**State the pool is in** (`node .spike/pool-rows.mjs ./selfdev.sqlite`, 0.8 s, read-only — re-read it, the team keeps
minting): at `23:33Z` `pool {rows:5, pooled:5, open:3, claimed:2, sizeRefused:1, seatsWithoutWindow:[]}`. Open:
**#7660** (`small`, `requires:"docs"`, no seat advertises it), **#7700** (`project`, refused twice, still open) and
**#7722** (`small`, minted by `architect` at 23:2xZ — organic use, not asked for by this goal). Claimed and `done`: **#7667**
(`pool-claimed by=advocate`) and **#7669** (`pool-claimed by=security`, 18:36:48.521Z) — both name
`docs/DECISIONS.md`, which `ownership` gives to `advocate` ALONE, so security's claim is the milestone's cross-owner
probe on a live row. `requires` carries no live annotation: **9 of 885 queued rows** have one and **0** rows have a
`revised` transition with `requiresFrom/To` — every one was minted with it by `send_work` (the baseline's 7 was a
smaller census). Seats: 11 × 164320, auditor 12288; `tierTokens {3400,6100,6200,120000}`; gate limits 115023 / 8601,
so **only `project` can be refused**. `tierTokens` is ONE roster-level table read by `seatSizeBudget(seatsDoc,
seatEntry)`; `usableWindow` is per seat.

**Backlog rate** (`node tools/backlog-burn.mjs --hours 4`): baseline (1,281 min) done **+8.5/h**, queued **+15.3/h**;
effect window 19:11:35Z → 22:13:03Z (181 min, contains #7667/#7669 closing) done **+5.3/h**, queued **+4.6/h**. Both
GROWING — **no causal claim**: closes and intake both fell while the fleet landed and `main` moved.

**Run these first** (measured on this box; re-measure rather than trust):

```bash
cd /home/chexxor/Git/Durian-Pi
grep ' PASS ' selfdev.sqlite.broker.log | tail -1; cat selfdev.sqlite.broker.json   # liveness is the last PASS line
node .spike/pool-rows.mjs ./selfdev.sqlite                                  # 0.8 s — every pool row + transitions
node tools/pool-migrate.mjs --dry-run --db ./selfdev.sqlite --limit 5       # 1.7-10 s — read-only denominator, balance line
node tools/pool-gate-live-probe.mjs --db ./selfdev.sqlite                   # 7-19 s — the gate refusing the LIVE roster's seats
node cli.mjs check rig.selfdev.json                                         # ~20 s — MUST name the rig: bare `check` audits ./rig.json
node scripts/test.mjs --all --jobs 4                                        # 145 s — 337/337 at 446c4084
```

**Blocker:** (1) **TRIGGERED, per the objective's blocker rule** — the dry-run shows the capability-clean tranche would
make rows claimable by seats the `ownership` map does not cover: **104 of 164 proposed pool rows name a non-owner
claimant** (src-tools-harness 85 + workflow-docs 19 = 104 at `23:5xZ`; the tool re-read at `00:2xZ` says 105 of 165 —
**re-run it, the team keeps minting**; list `.spike/pool-ownership-gaps.txt`).
Consequence: **no migration applied** — the tool stays a proposal; decisions 1–2 are the operator's. (2) Nothing
build-side waits: #7660 needs its author (`lead`) or `pm` to clear `requires:"docs"` (`check` reports
`pool-dead-gate`); the FIVE rulings below are owed.

**Known red, and one that WAS red:** `node demo/offline.mjs` exits **1** —
`ASSERT FAIL: the fresh context should be short, got 7 messages` (pm's #6924) — recorded, not touched.
`demo/priority-directive-scope.test.mjs` went red at `23:59Z` because its fixture hardcoded
`expiresAt: "2026-11-13T23:59:00Z"`; the path correctly refused a past expiry and the demo crashed on the null result.
**Fixed** (time-relative fixture): the suite is reproducible again, and the lesson is pitfall 327.

**Operator decisions owed** (options/pros/cons in `docs/reviews/2026-11-13-capability-ownership-ruling.md`): (5) who may
annotate `requires` — author-or-`pm` as shipped, all coordinators, or a named `lead` exception; (1) is `ownership`
advisory (recommended, plus a `check` for disjoint owner/claimant pairs) or enforced at claim; (2) `devtools` vs `code`
(split the `src-tools-harness` artifact class); (3) should `send_work` refuse an unadvertised `requires` (#7660 is the
case; recommended: no, warn + red `check` + author repair); (4) should a pool claim notify its author (recommended:
annotate the author's `peek_queue`, no notice row).

**Exact next command for the MIGRATION goal** (a later, separately gated goal; the tool has NO write path by design):

```bash
node tools/pool-migrate.mjs --dry-run --db ./selfdev.sqlite --json .spike/pool-migrate-live.json --limit 5   # re-measure first
node tools/pool-migrate.mjs --dry-run --db ./selfdev.sqlite --seat devtools --limit 10                       # the clean tranche, by id
```
Its first WRITE is not a tool run: once decisions 1–2 are ruled, `pm` annotates chosen rows with
`revise_work({itemId, requires})` (author or `pm`), one `revised` transition each.

**Traps this window** — `docs/SELFDEV.md` **318–325** (the `seats` LIST vs DOCUMENT roster trap; `usableWindow: null`
from `up`; "armed" ≠ "fired"; an unclaimable pool row; a count is not a trace; `check` auditing `./rig.json`).

Full history of this pointer, verbatim: [docs/NEXT-ARCHIVE.md](NEXT-ARCHIVE.md)

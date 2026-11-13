**Last update:** 2026-11-13T20:4xZ (delegate). `HEAD` = the commit carrying this pointer
(`git rev-parse --short HEAD`); the milestone objects on `main` are listed below, all after the team's landing merge
`657d8c60`. Ahead of `origin/main`, **nothing pushed** — the push grant stays with the operator.

**Milestone this window worked** — **N19 "The Pool" (D275), made USABLE and PROVEN ALIVE.** Every shipped sha, one
line each, in commit order:

| sha | what it shipped |
|---|---|
| `655c44e2` | `revise_work` takes `requires` (normalised, transitioned, two refusals) |
| `1782b495` | the pool doctrine in the shared `constitution.txt` + `peek_queue`/`WAKE_CONTENT`/`queueItemLine` aligned |
| `4ed6b8d0` | `tools/pool-migrate.mjs` — the read-only proposal instrument |
| `36f57a36` | the roster-shape fix in that tool (an AMEND of `01ff4c91`, which is not on `main`) |
| `517dc58d` | the window seam: `up --refresh` records `usableWindow` for all 12 seats (the gate armed) |
| `99250682` | docs: spec §13, FEATURES row, D275 addenda (f)–(k), pitfalls, this pointer's first rewrite |
| `78bc0364` | the live `check rig.selfdev.json` finding on #7660 + pitfall 324 (the bare `check` audits `./rig.json`) |
| `1c0c5920` | the gate proven on the roster + `pool-gated:<n> #<id>(<reason>)` (skip-line attribution) |
| `2bfb9e43` | the frozen-broker note in this pointer |
| `f6177f21` | authority narrowed to the contract, gate number 115023, spec §13.3b reconciliation, this pointer's sha/broker record |
| `02105352` | the demo prints the refusal and reads the LIVE roster; three broker windows recorded; the live decline line |
| `c4b0ea7e` | `tools/pool-gate-live-probe.mjs` + its test — the refusal from a byte-copy of the LIVE store; the pointer's sha table, live broker pid, and demo-number fixes |
| `d37bd216` | the gate-proof demo's own header carried the stale 117891; it now says 115023 |
| `HEAD` | the commit that carries this pointer (`git rev-parse --short HEAD`; it is the one object this list cannot name) |

Read
`docs/POOL-QUEUE-SPEC.md` **§13, §13.3b, §13.4** for the shipped wording quoted from the code and the number
reconciliation, and `docs/reviews/2026-11-13-capability-ownership-ruling.md` for the FIVE decisions the operator now
owes.

**Broker windows this session, each with what it replaced** (the objective requires the record):
1. pid **98022**, started `2026-11-13T17:32:55Z`, reason: **no broker resident** — it replaced a window whose last
   exit was `2026-11-13T05:57:09Z reason=deadline` (pid 3453151). `--no-probe --yes-pm-wakes --max-duration 3600`;
   the 20 s preflight probe false-blocks on `local2` and is stated, not silently skipped. Its own exit:
   `2026-11-13T19:11:54.118Z EXIT pid=98022 reason=deadline`.
2. pid **311912**, started `2026-11-13T19:11:56.488Z` by `tools/broker-keepalive.mjs`, reason: **broker STRANDED**
   (no pass for 2350 s with 1 intent waiting) after replacing 98022's deadline exit above. `--max-duration 3600` →
   deadline ~`20:11:56Z`; it FROZE past it (`lastPass 20:10:17Z`, heartbeat still advancing) and `--start` now
   refuses `broker-degraded` with four `genlock` slots held, so the runbook precondition says do NOT terminate it.
   It predates the skip-line fix, so its log showed the OLD `pool-gated:1` shape.
3. pid **540123**, started `2026-11-13T20:42:21.398Z` (broker.json `since` 20:42:21.398Z, log START
   `20:42:21.399Z`), reason: **alive-but-dead after the deadline** — read-drain only, `lastPass 20:10:17Z` and no pass
   for 30 min, four `genlock` slots held by its own pid for `devtools`. `cli.mjs serve --stop` REFUSED (`did not exit
   within the stop grace`), so the runbook's fallback was used: `kill -TERM 311912` → `EXIT pid=311912
   reason=deadline passes=-` at `20:42:10.249Z`, then `node cli.mjs resume` (cleared the stranded submissions), then
   `--start --no-probe --yes-pm-wakes --max-duration 1800`. It ran THIS code: passes 1→10 by `20:48:01Z` and the live
   skip line began naming the row: `SKIP auditor reason=pool-gated:1 #7660(requires:docs)` on six seats.
4. pid **774849**, logged START `21:34:01.725Z` (broker.json `since` 21:34:01.724Z), reason: **540123 froze past its
   1800 s deadline** (last PASS 89 at `21:12:20.948Z`; four `genlock` slots held by 540123 for `architect`), replaced
   via the same runbook fallback (`serve --stop` refused → `kill -TERM 540123` → `cli.mjs resume` → start with
   `--no-probe --yes-pm-wakes --max-duration 1800`). Its own exit: **`22:13:24.335Z EXIT pid=774849 reason=deadline`**
   — it froze past ITS deadline too (last PASS 297 at `22:02:26.568Z`, read-drain only after that). On it, the live
   scheduler refused #7700 by name for every seat (`SKIP auditor reason=pool-gated:2
   #7660(requires:docs),#7700(too-big:project(120000 tokens > 70% of the 12288-token usable window))`, 21:36:31Z).
5. pid **899525**, logged START `22:13:26.113Z` (broker.json `since` 22:13:26.112Z), reason: **774849 stranded past
   its deadline** — `tools/broker-keepalive.mjs --once` re-armed it, replacing the `22:13:24.335Z` exit above. This is
   the window a next session inherits; its deadline is 1800 s after `22:13:26Z`.

**Host for every number below**, measured with the measurement: **Linux**, Fedora Linux 45 (Forty Five), kernel
`7.2.15-300.fc45.x86_64`, node **v24.22.1**, `git version 2.56.0` — probe:
`uname -s && uname -r && (. /etc/os-release && echo "$PRETTY_NAME") && node -v && git --version`.

## NEXT SESSION

**Liveness:** the last ` PASS ` line, not the pid or the heartbeat (pitfall 304).

**Current item:** **the N19 pool is CLOSED out — usable, alive, gate proven, and every number reconciled.** The
`too-big:project(...)` refusal is measured against this rig's REAL roster (`demo/pool-gate-live-roster.test.mjs`, 0.4 s,
exit 0): `impl` (164320 usable) is refused `too-big:project(120000 tokens > 70% of the 164320-token usable window)` and
the `auditor` (12288) the same class quoting ITS window, each with the split instruction naming the row, each leaving
the row queued and open with one `size-refused` transition, with `tooBigFor: [all 12]` / `unclaimableByAnyone: true`
from the census and no claim at all; a `small` row is then claimed by `devtools`. It is ALSO proven from a byte-copy of
the LIVE store (`node tools/pool-gate-live-probe.mjs --db ./selfdev.sqlite`, 7-19 s, row #7700 at 21:2xZ: impl 164320 and
auditor 12288 each refused with the split instruction, source sha unchanged). **And the live fleet finally minted the
row**: **#7700** (`from=pm, pool:true, tier:"project"`, queued 21:20:16.789Z) is OPEN in the pool — pm did it after six
asks. The LIVE scheduler refuses it for every seat by name (`SKIP auditor reason=pool-gated:2
#7660(requires:docs),#7700(too-big:project(120000 tokens > 70% of the 12288-token usable window))`, 21:36:31Z), so the
gate's string is now in the live log; the `Split it:` sentence needs one seat to claim it BY ID — pm has the ask
(`4a02376a`, 21:34Z) and a delegate may not claim a row. **The annotation authority is the contract's, exactly**: author or
`pm` (`ANNOTATE_REQUIRES_SEAT`), with `lead` REFUSED — the first build used `seatIsCoordinator` and an audit called
that an unrequested widening, so the question is now decision 5 for the operator. **Every starting number is
reconciled** in §13.3b (267 = devtools 165 + scribe 78 + qa 24; 262 clean rows = 165 migratable + 53 notices + 42
blocked + 2 untiered; 313 notices = 311 + 2; 44 untiered − 28 notices = 16; impl 393 → 403, 0 clean because `code` is
impl-only). **The skip line names what it counts**: `pool-gated:<n> #<id>(<reason>)[ +N more]`.

**State the pool is in** (`node .spike/pool-rows.mjs ./selfdev.sqlite`, 0.8 s, read-only):
`pool {rows:4, pooled:4, open:2, claimed:2, ownerOfRecord:2, sizeRefused:0, tooBig:[], seatsWithoutWindow:[]}` — open:
**#7660** (`small`, `requires:"docs"`, nobody advertises it) and **#7700** (`project`, minted by pm 21:20:16.789Z, over
70 % of every window, unclaimed). #7667 `pool-claimed by=advocate` 18:35:43Z and **#7669 `pool-claimed by=security`
18:36:48Z**, both `done` by 21:14Z; both name
`docs/DECISIONS.md` (`ownership` → `advocate` alone), so security's claim is the milestone's falsification probe
passing on a live row. Seats: 11 × `usableWindow` 164320, auditor 12288; tier table
`{"trivial":3400,"small":6100,"feature":6200,"project":120000}`. Gate limits: 115023 and 8601, so **only `project`
(120000) can be refused** (D275 addendum (i)).

**Backlog rate, before → after — now over the window that CONTAINS the pool effect** (`node tools/backlog-burn.mjs
--hours 4`, keepalive ledger, no store open; the ledger had no snapshot after 19:49Z, so one was taken at 22:13:03Z to
close the window):

| window | span | done | queued | verdict |
|---|---|---|---|---|
| pre-session baseline | 2026-11-12T08:35Z → 11-13T05:55Z (1281 min) | +182 (**8.5/h**) | 519 → 846 (**+15.3/h**) | GROWING |
| pool effect window | 19:11:35Z → 22:13:03Z (181 min, includes #7667/#7669 closing at 21:14Z/21:28Z) | +16 (**5.3/h**) | 856 → 870 (**+4.6/h**) | GROWING |

Both numbers are real and the effect window now contains the two pool closures. What they do NOT show is a rate
improvement: closes fell (8.5/h → 5.3/h) and intake fell (15.3/h → 4.6/h), so the backlog still grew. **No causal claim
is made** — the fleet spent this window landing (`done` moved, `main` moved 657d8c60 → 8abc961e) and three pool rows
were minted against 16 closes; the honest reading is that the pool was exercised, not that it moved the burn rate.

**Run these first, in this order** (every number below was measured on this box; re-measure rather than trust it):

```bash
cd /home/chexxor/Git/Durian-Pi
node .spike/pool-rows.mjs ./selfdev.sqlite            # 0.8 s — every pool row with its transitions (the census alone hides the claim)
node tools/pool-migrate.mjs --dry-run --db ./selfdev.sqlite --limit 5   # 1.7 s — the migratable denominator, read-only
node cli.mjs check rig.selfdev.json                   # ~20 s — MUST name the rig file: the bare verb audits ./rig.json (2 seats, pm/worker) and prints a roster nobody runs
node tools/backlog-burn.mjs --hours 4                 # 0.03 s, exit 0 — the backlog RATE (quotes the ledger window it used)
DURIG_DB=./selfdev.sqlite node cli.mjs queue --json --limit 2 --no-body | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>console.log(JSON.parse(s).pool))'  # 0.8 s
node tools/stranded-inbox.mjs selfdev.sqlite          # 1 s — is the broker PARKED? hbAgeS vs progressAgeS
node demo/revise-requires.test.mjs                    # 0.3 s — the annotation verb, its two refusals, the transition shape
node demo/pool-doctrine.test.mjs                      # 0.3 s — every seat is TOLD the pool exists
node demo/declared-window-seam.test.mjs               # 0.13 s — the window seam the gate depends on
node demo/pool-gate-live-roster.test.mjs              # 0.4 s — the 70 % gate refusing THIS rig's roster (impl + auditor) with the split instruction
node demo/pool-gated-reason.test.mjs                  # 0.05 s — the SKIP line names the pool row and the reason
node tools/pool-gate-live-probe.mjs --db ./selfdev.sqlite   # 7.3 s — the gate refusing a project row for the LIVE seats' own windows, from a byte-copy (source sha-verified unchanged)
node tools/pool-migrate-test.mjs                      # 1 s — every verdict class non-vacuous, store bytes identical, the LIST/DOCUMENT roster trap
node scripts/test.mjs --all --jobs 4                  # ~131 s — the whole suite; main must be green before the next landing
```

**Broker status is a LINE, not a pid — read it before acting.** Liveness is the last ` PASS ` line (pitfall 304), so
this pointer does not certify "a broker is resident": it records the windows. As measured `2026-11-13T22:13Z`: window
5 is pid `899525` (START `22:13:26.113Z`), and window 4 (`774849`) exited `22:13:24.335Z reason=deadline` after
freezing past its deadline (last PASS 297 at `22:02:26.568Z`). Every window tonight has hit its `--max-duration` and
then lingered in read-drain, so **the first command of a session is `grep ' PASS ' selfdev.sqlite.broker.log | tail -1`
plus `cat selfdev.sqlite.broker.json`**, and a `--max-duration` window is a lease, not a daemon. Restart
recipe (the 20 s preflight probe false-blocks on `local2`, stated not hidden):
`set -a; . "$HOME/.config/durig/env"; set +a; DURIG_DB=./selfdev.sqlite node tools/broker-serve.mjs --start --no-probe --yes-pm-wakes --max-duration 3600`.

**Exact next command for the MIGRATION goal** (applying the proposal to real rows — a later, separately gated goal;
`tools/pool-migrate.mjs` has NO write path by design and `--apply` is refused by name):

```bash
cd /home/chexxor/Git/Durian-Pi
node tools/pool-migrate.mjs --dry-run --db ./selfdev.sqlite --json .spike/pool-migrate-live.json --limit 5   # 1.7 s — re-measure the denominator first
node tools/pool-migrate.mjs --dry-run --db ./selfdev.sqlite --seat devtools --limit 10                       # the 162-row clean tranche, by id
```
The first WRITE of that goal is not a tool run: once decisions 1–2 are ruled, it is `pm` annotating chosen rows with
`revise_work({itemId, requires})` (author or `pm` — the contract), one `revised` transition per row, and then the pooled
row is claimed by whoever advertises the set. Do not add an `--apply` to the tool before that ruling.

**Blocker:** (1) **TRIGGERED, per the objective's blocker rule** — the dry-run shows the capability-clean tranche
would make rows claimable by seats the `ownership` map does not cover: `node tools/pool-migrate.mjs --dry-run` reports
**104 of 163 proposed pool rows naming a claimant the map does not list** for the artifact they name
(src-tools-harness 88, workflow-docs 19; 34 name no path; list in `.spike/pool-ownership-gaps.txt`). Consequence: **no
migration is applied** — the tool stays a proposal and decisions 1–2 are the operator's. (2) Nothing build-side is
waiting: `#7660` is OPEN with `requires:"docs"` and no seat advertises it (its author `lead` or `pm` clears it;
`check rig.selfdev.json` reports `pool-dead-gate` until then), `#7700` needs one seat's `claim_work({itemId: 7700})`
for the live `Split it:` text, and the FIVE rulings below are owed.

**Known red, do not fix here (objective OUT):** `node demo/offline.mjs` exits **1** with
`ASSERT FAIL: the fresh context should be short, got 7 messages` — pm's #6924. Recorded, not touched.

**`tierTokens` shape (auditor note, documented not changed):** `status --json` carries the tier table ONCE at the
roster level and `usableWindow` per seat; the claim path reads that one table via `seatSizeBudget(seatsDoc,
seatEntry)`, so "the table every seat uses" is doc-level by design — copying it onto 12 seats would be a second
spelling of the same rule.

**Operator decisions owed** (full options/pros/cons in `docs/reviews/2026-11-13-capability-ownership-ruling.md`):
(0) the annotation authority (decision 5): author-or-`pm` as shipped, every coordinator, or a named `lead` exception. (1) what `ownership` is FOR — advisory (recommended, plus a `check` that names disjoint owner/claimant pairs) or
enforced at claim; (2) `devtools` vs `code` — split the `src-tools-harness` artifact class and/or grant `code`
(recommended: split the class first); (3) should `send_work` refuse a `requires` set no seat advertises (recommended:
no — warn, keep `check` red, let the author repair; **#7660 is the live example**); (4) a pool claim still does not
notify the row's `from` (recommended: annotate the author's own `peek_queue` instead of adding a notice row). The
roster (`capabilities`/`edges`/`ownership`) was READ-ONLY to this goal: `git diff rig.selfdev.json` is empty outside
the size fields `up --refresh` wrote.

**Suite flake seen once, recorded:** at 21:4xZ `--all --jobs 4` reported `336/337`, failing
`demo/restart-limit-behaviour.test.mjs`; it passed standalone twice (exit 0) and the NEXT full run was **337/337 in
153.6 s**. Treat that test's failure under `--jobs 4` as the box (it spawns fixtures and asserts a charge count), not
the code — re-run it standalone before chasing it (pitfall class: a red at high concurrency that is green alone).

**Cost:** **$0.00** — every model call this window went to the loopback provider (priced 0/0); the spend ledger is
unchanged. Wall clock shape: the pool build was ~3 h of the window; the two broker windows cost ~40 min of waiting for
seats; the suite is ~131 s at `--jobs 4`. **Speed-up worth adopting:** `node .spike/pool-rows.mjs` (0.8 s) answers
"what is the pool doing" in one read — promote it into `tools/pool-census.mjs` rather than retyping it (it is gitignored
in `.spike/` today, so it is lost next session).

**Traps this window** — `docs/SELFDEV.md` next `## Operational pitfalls` block: (a) a broker-served read and the
no-broker fallback can return **different shapes for the same view** (`seats` = list vs document) and the consuming
tool silently empties its roster **while still printing balanced arithmetic** — measured 268 vs 0 migratable on the same
store; (b) `up --refresh` records `usableWindow: null` when the window is declared on the provider spec rather than
`DURIG_CONTEXT_WINDOW` — the gate then reads "armed" in the config and "disarmed" in the data; (c) the 70 % gate can be
armed and *unexercisable* when only one tier exceeds it, so "the gate is armed" is not "the gate has fired".

Full history of this pointer, verbatim: [docs/NEXT-ARCHIVE.md](NEXT-ARCHIVE.md)

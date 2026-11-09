---
runbook: in-turn-read-hangs
symptom: "my turn hung asking about the queue; `cli.mjs queue` / `status` / `scripts/clockin.mjs` never returns; a window blows its --max-duration bound and the broker log just stops mid-pass"
writes: false
precondition: "read-only"
last_verified: 2026-11-08
verified_by: scribe
evidence: "#5656 (this commit); mechanism from docs/DECISIONS.md D235 'A STRUCTURAL HAZARD' + docs/SELFDEV.md pitfall 116 + ROADMAP 329; diagnose block timed on this box 2026-11-08T07:5xZ (Linux, Fedora 45, node v24.22.1): 0.068 s real time, and a spooled read answered in 2.22 s with exit 0 in the same breath"
check_rule: null
---

# A read issued inside a seat's own turn can hang forever

## When to use
A seat asks "what is in my queue?" and the turn dies on a timeout; or a broker window overruns
its bound while the log stops mid-pass. The read is a **spooled request to the broker**, not a
local file read: `src/readclient.mjs` `readViaBroker()` writes a `read` op into
`<db>.broker.inbox/` and then awaits the result with `timeoutMs = 120_000`. Only the broker can
answer, and the broker answers when it drains the inbox - which it does between passes, not
while it is waiting for the very turn that issued the read.

## Impact
One hung read burns a whole turn (and a metered call). Repeated across a fleet it is the
mechanism behind windows being spent on nothing: the four windows in D235 ran **155.3 min of
broker wall clock against 75 min of nominal bound (2.07x)**, with seats sitting in
`node cli.mjs queue --id N` and `node scripts/clockin.mjs --db ...` as children of the broker
pid while their `pi.tool` task rows stayed `running`. Blast radius is every read verb
(`queue`, `status`, `watch`, `log --follow`, `clockin`).

## Diagnose (read-only, ~0.07 s - no store is opened)
```bash
DB=./selfdev.sqlite
cat "$DB.broker.json"                                   # pid, heartbeatAt, lastPassAt
ps --ppid "$(node -e 'console.log(JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")).pid)' "$DB.broker.json")" -o pid,args
ls -1 "$DB.broker.inbox" 2>/dev/null | wc -l           # reads sitting undrained
ls -1 "$DB.broker.inbox.error" 2>/dev/null | wc -l     # dead-lettered reads
ls -1 "$DB.broker.inbox.out" 2>/dev/null | wc -l       # answers written
```
These read the spool FILES only - they work while the store is locked and while the broker is
mid-pass, which is exactly when a `cli.mjs` read verb cannot.

**Discriminate the three shapes** (ROADMAP 329 names them; the cure differs):

| What the block shows | Shape | What to do |
|---|---|---|
| `broker.json` missing | no broker | `broker-down-or-stalled.md` |
| `lastPassAt` frozen, inbox non-empty, children are `cli.mjs`/`clockin.mjs` | **this** defect: drain stalled inside a pass | stop issuing in-turn reads; end the window per `Do` 3 |
| `lastPassAt` advancing, `.error` files naming `apply failed: SqliteStorage is closed` | 329 shape (a) - the drain runs and refuses | fast-fail is already working; escalate per `Escalate` |
| `lastPassAt` advancing, `woke=-` on every PASS line | not this - it is pitfall 121 (a `claimed` row does not wake) | see `docs/SELFDEV.md` pitfall 121 |

Measured on this box at 2026-11-08T07:5xZ: `broker.json` = `{"pid":2718690,"heartbeatAt":1794124264327,"lastPassAt":1794124226038}`,
inbox `0`, `.error`/`.out` not present, and the whole block ran in **0.068 s** real time. In the
same breath `timeout 5 node cli.mjs queue` returned a full payload, exit 0, in **2.216 s** - so a
read answering quickly is proof the drain is running and the hang is not this defect.

## Do
1. **Stop issuing broker-routed reads from inside a turn** (operator interim discipline, D236 (6)):
   seats do not run `cli.mjs queue`, `cli.mjs status` or `scripts/clockin.mjs` from within a turn.
   Take one multi-id `show` if a read is genuinely required, and otherwise use the numbers already
   recorded in the item or in `docs/NEXT.md`.
2. **Do not open the store directly as a workaround.** pi-durable takes one owner per process and
   `SqliteStorage.document()` wraps a read in `BEGIN IMMEDIATE` (`src/readclient.mjs` header,
   `src/brokerread.mjs` header): a second opener contends with the broker's write lock and can
   poison its session (`SessionFailed`). That is why the read verbs are clients at all.
3. **If the window must be ended:** `kill <pid from broker.json>` (never `pkill -f`, pitfall 49) ->
   `node cli.mjs resume` (settles `placed`/`queued` submissions) -> confirm `broker.json` is gone.

## Verify
The diagnose block above prints within a second and the two numbers it prints decide the row of
the table you act on. Re-run it after `kill` + `resume`: `cat "$DB.broker.json"` must now say the
file does not exist (exit 1), and `node cli.mjs status` must answer (with no broker alive it reads
the store directly as sole owner).

## If it fails
If the read still hangs with no broker alive, that is a different fault - go to
`docs/runbooks/broker-down-or-stalled.md`. If the broker is alive and the inbox keeps a read
forever with no `.error` file, that is ROADMAP 329 shape (c) (stranded on shutdown) - report it,
do not hand-delete the inbox entry.

## Escalate to
- `pm` to route the code fix: ROADMAP **329** (fast-fail with a named cause, publish the `dark`
  state, fail-or-requeue pending inbox entries on exit) and the row scribe filed as **#5640**.
- `lead` if a seat is blocked by this repeatedly - it is a scope decision about which reads a seat
  may issue, not a shell problem.

## Evidence
- `docs/DECISIONS.md` D235 ("A broker-routed read issued from inside a seat's own turn cannot be
  answered, because the broker is inside the very pass waiting for that turn"), `docs/SELFDEV.md`
  pitfall 116, `docs/NEXT.md` §(C), ROADMAP **329** (three shapes, measured 2026-11-06).
- Run in this tree 2026-11-08: the diagnose block, `0.068 s`; `timeout 5 node cli.mjs queue` exit 0
  in `2.216 s`; guard `node demo/runbook-frontmatter.test.mjs` and `node demo/runbook-rules.test.mjs`
  exit 0.

---
runbook: queue-order-unexpected
symptom: "I set a priority and nothing moved; why is my queue in this order; the row still says priority=now but it did not jump; a row prints priority=...~lapsed@..."
writes: false                 # every step here is a read; the lease itself is a seat tool call, not a CLI verb
precondition: "read-only"     # safe with the broker up: status/queue reads are broker-served (D111)
last_verified: 2026-11-12
verified_by: scribe
evidence: "#7117 (this runbook). Mechanism: D266 (docs/DECISIONS.md, 'D266 — 2026-11-12T06:5xZ: claim order is a declared POLICY...'). Commands run 2026-11-12 in the item-7117 worktree (pi-durable 1.3.0 from the lockfile, NOT the linked 1.5.1 plane): node demo/workstrategy.test.mjs exit 0; node demo/workstrategy-claim.test.mjs exit 0; node demo/workstrategy-up.test.mjs exit 0; DURIG_DB=/home/chexxor/Git/Durian-Pi/selfdev.sqlite node cli.mjs status exit 0 with the workStrategy block quoted below; grep -c 'priority=' .durig/queue-all.md = 24, zero of them '~lapsed@' or '!invalid' at that instant"
check_rule: demo/workstrategy.test.mjs
---

# Queue order is not what you expected — the priority lease, read honestly

## When to use

- "Why did this row get claimed before that one?"
- "I called `set_priority` and the claim order did not change."
- "The row still carries `priority=now` — is it urgent or not?"
- You are about to argue that the selector is broken, and you have not yet read the two facts that decide it.

## Impact

A priority that does not act is not a failure of the queue; it is a **lease on a seat that does not read
leases**. Left un-diagnosed it costs a seat's whole turn budget: the seat re-leases, re-claims, and
reports a defect that does not exist. The rig's own record of this is D266 (`docs/DECISIONS.md`) and pm's
N35 note (`docs/NEXT.md`) — the team flipped to `priority_first` precisely because leases on
`oldest_first` seats were inert (#7129).

## The three facts that decide every case

Read these before running anything. Each is pinned by a demo, named at the bottom.

| # | Fact | Where it lives | Proved by |
|---|---|---|---|
| 1 | Claim order is a **declared policy**, resolved **seat > team > default**. Default is `oldest_first`, which is byte-for-byte the old behaviour. Declared in the rig file's top-level `workStrategy` (team) and each seat's `workStrategy` (override); `DURIG_WORK_STRATEGY` is the environment arm. An unknown name **refuses by name** rather than silently falling back. | `src/workstrategy.mjs` (`WORK_STRATEGIES`, `resolveStrategy`, `assertWorkStrategy`); `cli.mjs:712-730` | `node demo/workstrategy.test.mjs`, `node demo/workstrategy-up.test.mjs` |
| 2 | A priority is a **lease**, not a flag: `now | next | later`, with a mandatory `reason` and a mandatory `expiresAt` (future, at most 30 days). Rows with no priority, an expired lease, or an unreadable value all tie at the neutral `next`, so turning on `priority_first` does not reshuffle a backlog nobody prioritised. | `src/workstrategy.mjs` (`PRIORITY_RANK`, `MAX_PRIORITY_LEASE_MS`, `effectivePriority`, `validatePriorityRequest`) | `node demo/workstrategy.test.mjs` |
| 3 | A lease **only reorders the RECIPIENT's queue** if that recipient's resolved strategy is `priority_first`. `set_priority` resolves the recipient's strategy at the moment it writes and says so in its reply. | `src/rig.mjs:1506-1521` | `node demo/workstrategy-claim.test.mjs` |

`set_priority` also **refuses a row that is neither `queued` nor `held`** (`src/rig.mjs:1492`): you cannot
reorder a row that is already in flight. A lease on a `held` row is recorded and applies when the row is
released.

## Diagnose (read-only)

Name the store with the variable the entry point actually reads — `cli.mjs` reads `DURIG_DB`
(`docs/runbooks/README.md` Conventions; #5911).

1. **What order does each seat claim in, and where did that come from?**

```bash
DURIG_DB=./selfdev.sqlite node cli.mjs status --json
```

Read the `workStrategy` key of that object. Its shape is
`{default, team: {strategy, source}, seats: {<name>: {strategy, source}}}`; `source: "seat"` means the
seat overrides the team, a seat with no override resolves to the team value, and a rig that declares
nothing is `oldest_first` for everyone. To see just that key: Run on this rig 2026-11-12 it returned `default: oldest_first`, `team:
{priority_first, source: team}`, and per-seat entries for all twelve seats - `impl` and `devtools` with
`source: seat`, the rest `source: team` (exit 0; the full block is in Evidence).
The resident dashboard prints the same thing as a line — `order: impl priority_first (seat) · ... — a
leased priority is honoured here` — **only for seats whose strategy differs from the default**, so a rig
that declares nothing renders exactly as before (`src/watchview.mjs:122-131`).

2. **What is this row's EFFECTIVE priority, right now?** A seat's own queue line carries it - not the
stored label. Item 7117's line reads `... blockedBy=7113 priority=now until=2026-11-15T07:30:00.000Z`.
The three renderings and what each means (`src/rig.mjs:396-411`, the same `effectivePriority` that orders
claims - one producer, so the view and the selector cannot disagree):

| The line says | The row ranks as | Read it as |
|---|---|---|
| `priority=now until=<instant>` | `now` | an active lease |
| `priority=now~lapsed@<instant>` | `next` | the lease is **over**; the stored field is history, not policy |
| `priority=<value>!invalid` | `next` | the stored value is not in the vocabulary (a hand-edited store); flagged, not coerced |
| no `priority` at all | `next` | never leased |

3. **Count the leases you have.** The harness writes each seat's queue view to
`.durig/queue-<scope>.md` on a wake, so the same lines are greppable - but that file is gitignored,
broker-written, and may not exist in a fresh tree, so treat it as a convenience, not a source of truth.
On this rig at 2026-11-12 `grep -c "priority=" .durig/queue-all.md` returned **24**, and no line carried
`~lapsed@` or `!invalid` at that instant.

## Do

1. **Check the recipient's strategy before you lease.** If it is `oldest_first`, the lease is recorded
   and inert. `set_priority`'s reply already says this in words; do not read it as a bug.
2. **Lease it properly** (a seat tool call, not a CLI verb):

```
set_priority(itemId, priority="now", reason="<why the order changes>", expiresAt="2026-11-19T00:00:00Z")
```

   Every one of those four is required. `reason` is capped at 500 characters; `expiresAt` must be a
   parseable instant strictly in the future and no more than 30 days out. Anything else **refuses** and
   names the offending value (`validatePriorityRequest`, `src/workstrategy.mjs:210-246`).
3. **Read the reply, not the row.** The reply states the effect: `... which IGNORES priority: the lease is
   recorded but does NOT change claim order until that seat (or the team) is set to `priority_first`.`
4. **If the order must change, declare the strategy — do not stack more leases.** The strategy is an
   operator declaration in the rig file (`rig.selfdev.json` top-level `workStrategy`, or a per-seat
   `workStrategy`), applied idempotently on every `up`; `--refresh` re-applies a changed seat value and an
   explicit `null` clears an override (`cli.mjs:817-855`). A typo refuses at `up` rather than defaulting.
5. **A lapsed lease is not a cleanup task.** Nothing deletes it; `effectivePriority` decides at read time
   and the row goes back to neutral. Re-lease it if you still mean it.

## Verify

All four ran on 2026-11-12 in the `item-7117` worktree; exit 0 is a pass:

```bash
node demo/workstrategy.test.mjs        # exit 0 — "default unchanged, priority_first total and lease-bounded, unknown names refused, source reported"
node demo/workstrategy-claim.test.mjs  # exit 0 — "priority_first reorders the real claim, seat override wins, lapsed lease and refusals all hold"
node demo/workstrategy-up.test.mjs     # exit 0 — "declared strategy persists, reads back via ps/status, and a typo refuses before bootstrap"
DURIG_DB=./selfdev.sqlite node cli.mjs status   # exit 0 — the workStrategy block, per seat, with its source
```

To see only the strategy readout rather than the whole status payload (also exit 0, same day):

```bash
DURIG_DB=./selfdev.sqlite node cli.mjs status --json | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>console.log(JSON.stringify(JSON.parse(s).workStrategy)))'
```

The three demos need no store and no model: they exercise the policy over a fixture queue in
milliseconds, so they are the answer when the broker is wedged and every broker-routed read times out.

## If it fails — the failure modes, in the order you will meet them

| Symptom | What is actually true | What to do |
|---|---|---|
| Lease recorded, order unchanged | The recipient resolves to `oldest_first`. Under `oldest_first` a priority changes **nothing** — recording it is not applying it. | Declare the strategy (step 4). Do not add another lease. |
| `set_priority` refused: "item #N is claimed/deferred/held..." — wait, `held` is allowed | Only `queued` and `held` rows can be ordered; `claimed` means a seat is already acting on it. | Order it before it is claimed, or let the claim finish. |
| The row says `priority=next` and you meant urgent | `next` is the **neutral** value, not a demotion; `later` is the demotion. Unprioritised rows also rank `next`. | Set `now` with a reason and an expiry. |
| `~lapsed@<instant>` in the line but the row still looks urgent elsewhere | It is not urgent. Any view that shows it as urgent is reading the stored field, not `effectivePriority`. | Name the surface that disagrees — that is a real defect, and it is a different bug from an inert lease. |
| `!invalid` on the line | The stored value is outside `now|next|later` (a hand-edited store). It ranks neutral and is flagged rather than coerced. | Report it; do not "fix" it by setting a value through the UI without checking the row. |
| `expiresAt: "9999-12-31"` accepted | It is refused — >30 days out is exactly the unbounded-park pathology `hold` already has. | Lease for the window you actually mean. |

**The gap to say out loud, not paper over:** there is still **no instrument that counts** leased,
lapsed-but-stored, and invalid priorities across the queue. A single row can be read (the queue line
says so); a fleet of them cannot. That is GAP 2 (#7114, impl, open at the time of writing) — the
counter does not exist yet, so "how many stale leases are sitting in the store?" is a question this rig
cannot answer, and no check rule flags it. GAP 1 (#7113) puts the human-visible readout on
`node cli.mjs queue` without changing the JSON byte contract; as of this check `cli.mjs queue` does
**not** print priority, and the readout lives in the `peek_queue` line. Do not document the queue
readout as landed until a verify row names it on the merged tree (#7116).

## Escalate to

- **pm** — ordering policy and who is allowed to lease what (the authority is recorded on the row:
  `prioritySet.authority` is `sender`, `recipient`, or `coordinator`, `src/rig.mjs:1505`).
- **operator** — declaring the team or seat strategy in the rig file; only the operator runs `up`.
- **impl/devtools** — the lease monitor (#7114) and the `queue` readout (#7113).

## Evidence

D266, `docs/DECISIONS.md` (the ruling); `docs/NEXT.md` N35 (the tranche and its state). Code:
`src/workstrategy.mjs`, `src/rig.mjs:1492-1521`, `src/watchview.mjs:122-131`, `cli.mjs:712-730, 3077-3083`.
Demos: `demo/workstrategy.test.mjs`, `demo/workstrategy-claim.test.mjs`,
`demo/workstrategy-up.test.mjs` — all exit 0 on 2026-11-12 in `item-7117`. Live read: `cli.mjs status`
against `/home/chexxor/Git/Durian-Pi/selfdev.sqlite`, exit 0, the `workStrategy` block quoted above.
Written by `scribe` under #7117; the mechanism is devtools'/impl's, and the sequencing is pm's.

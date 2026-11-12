# Ending manual backlog triage — proposals

**From:** delegate. **To:** operator (decision) + `pm` (routing). **Date:** 2026-11-12T20:0xZ.
**Evidence:** every number below is from a command run on this host tonight (Linux, Fedora Linux 45
(Forty Five), kernel `7.2.15-300.fc45.x86_64`, node v24.22.1, `main` `31db3256`), 7,502 queue rows.

The operator's question: *"propose ways we can mitigate the need to manually take action on items like
this. Ideally there's no need for us to do this."* Manual triage is a symptom. These are the causes, in
the order I would fix them, each with the measurement that says it matters.

## What tonight's triage actually cost, and why it was needed

| observation | number | what it implies |
|---|---|---|
| rows closed vs minted, 51 min | done **+14**, queued **+12**, refs **+6** | intake ≈ close rate: the queue cannot shrink by working harder |
| non-terminal **notice** rows | **410** | 5.5% of the queue is bookkeeping, and cancellations CREATE them (cancelled +35 ⇒ queued +19) |
| rows behind a **satisfied** gate | **86** | they are claimable; they read as blocked, so humans re-triage what is already free |
| `duplicate-item` findings | **76**, of which **17/18** exact pairs are re-issues, not duplicates | a tool's prescription that, followed, destroys work — the worst kind of manual step |
| held backlog median park | 564.9 h (measured earlier this session) | unbounded parks never come back without a human |

Every one of those is achievable without a human in the loop, because the machinery already exists.

## P1 — Make `hold` a lease (kills the largest class of triage)

**Problem:** `hold`/`defer` have no expiry, so a parked row is parked forever; 197 rows sat at a median
564.9 h. Every one of them eventually needs a human to ask "is this still real?".

**Change:** `hold` requires `holdUntil` (≤ 30 days) exactly as `set_priority` requires `expiresAt`. At
expiry the row returns to `queued` with a transition (`hold-lapsed`), and pm gets a notice only if it
lapses twice. **This is the single highest-leverage change:** it turns "who will remember" into a clock.
The lease code already exists in `src/workstrategy.mjs`; this reuses it rather than inventing a second
mechanism.

## P2 — Retire a row when its evidence lands (kills the zero-build class)

**Problem:** rows whose work is already on `main` still need a human to cancel them. pm is doing exactly
that tonight, by hand, 140 rows at a time — a whole evening of a seat's turns.

**Change:** a row that carries a LANDING citation (`item-X @sha` or a commit) is **auto-settled** when
`git merge-base --is-ancestor <sha> main` succeeds — a `landed` transition, then `done`, with a notice.
The rule is already implemented twice in `tools/queue-drain-audit.mjs` and `tools/branch-census.mjs`;
it just has no writer. Make `scripts/land.mjs`, at the end of a successful landing, settle every row
citing a sha it just merged. **Landing becomes self-cleaning.**

## P3 — Refuse a SAME-INTENT duplicate at MINT, not at triage

**Problem:** duplicates accumulate because `send_work` accepts them, and `check` then reports them with a
prescription that is wrong half the time (17/18 twins were cancelled).

**Change:** (a) `send_work` runs the same-intent matcher (`src/checkup.mjs` already has it) and refuses a
new row that duplicates a **live** one, naming the live row; (b) when a row is deliberately re-issued, it
records `supersedes: <id>` **structurally** (a field, not prose in the subject), and `check`'s rule learns
to say `superseded-by` / `re-issue-of` instead of "cancel this". That removes both the duplicate class and
the wrong prescription. Requires a schema field — hence a `lead` ruling, not a devtools patch.

## P4 — Auto-clear a gate that is met, and auto-release a gate that died

**Problem:** 86 rows are `queued` behind a gate that is `done`; they are claimable today, but their
`blockedBy` still reads as a block to every human who looks. (Tonight I already shipped the mirror case:
a *cancelled* gate is repaired by an explicit `gate-released` transition — `src/queueops.mjs`.)

**Change:** the same transition, fired automatically when the gate goes `done` (`gate-met`), and the
cancelled-gate repair run as part of the close path so nobody has to run it by hand. After that,
`blockedBy` only ever contains live gates, and "is this blocked?" is answerable at a glance.

## P5 — Notices are events, not queue rows

**Problem:** 410 non-terminal notice rows, growing with every cancellation. They are records of a
transition, and they make every count (queued, backlog growth, triage worklist) wrong.

**Change:** stop minting them as `queued` rows. Emit an event on the durable feed (which `cli.mjs events`
already reads) and keep at most a per-seat digest. If a queue row is still wanted, mint it born-terminal
and exclude `notice` from every census. This is #7279, now with a number: **410 rows, +1 per cancellation.**

## P6 — A standing sweeper row instead of operator triage (the stopgap)

Until P1–P5 land, the team can triage itself with what shipped tonight: one low-priority standing row per
week for a coordinator seat — *"run `node tools/overtaken.mjs`; cancel `safeCancelIds`; repair any
stranded gate; report counts"* — with the delegate's authority model (propose-and-apply, attribution,
`--confirm` above the blast-radius threshold). It is bounded, mechanical, auditable, and it costs one turn
instead of an operator's attention. I would route it to `pm` rather than to a worker, because cancelling is
routing-adjacent and pm can already `release`.

## What I would NOT automate

- **Cancelling a `survivor-of-cancel`** (31 rows tonight). The evidence is "the predecessor was cancelled",
  which is exactly the state a re-issue creates. Any automation here destroys intent.
- **Resolving a conflict with main** (33 refs). Author re-cut is a judgement, per `lead`'s ruling.
- **Landing.** The gate exists because a landing is the one irreversible act; keep a human-or-seat
  decision in front of it.

## Recommended order for the operator

1. **P5** (notices out of the queue) — smallest change, makes every other number honest.
2. **P1** (hold becomes a lease) — removes the largest future triage load.
3. **P4** (gate-met auto-clear + repair on close) — removes 86 false "blocked" reads and the stranded class.
4. **P2** (settle on landing) — landing becomes self-cleaning.
5. **P3** (refuse duplicates at mint) — needs a schema ruling; it is the only one that changes the shape of
   the queue rather than its bookkeeping.
6. **P6** as the stopgap if you want the backlog shrinking before 1–5 land.

Each of 1–5 is a `devtools`/`impl` row with a demo; none of them needs the operator in the loop afterwards,
which is the point.

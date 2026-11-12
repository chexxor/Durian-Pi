# Probe-withdrawal off-ramp: measured, not assumed (#6988)

Question: when a probe is withdrawn, what actually happens to the row that gated on it, and can the
seat still act? Measured on the shipped Router tools (`send_work`, `cancel_work`, `claim_work`,
`hold_work`, `release_work`, `defer_work`, `revise_work`, `complete_work`) against a real durable
store in a temp directory, seats registered through `registerSeat`, faux provider.

Run (from the repo root, tree `item-6988` @ the commit that adds this file, dependency plane
lockfile-released pi-durable 1.3.0 — `scripts/sync-pi.mjs --sync` had been run):

```bash
node docs/evidence/2026-11-12-probe-withdrawal-offramp/offramp-probe.mjs   # exit 0
node docs/evidence/2026-11-12-probe-withdrawal-offramp/offramp-claim.mjs   # exit 0
node docs/evidence/2026-11-12-probe-withdrawal-offramp/offramp-release.mjs # exit 0
```

Each script prints the tool result strings verbatim; the captured runs are in
`run-wake.out`, `run-claim.out`, `run-release.out`, `run-release-repro.out`.

## What the withdrawal does

- `cancel_work` on the probe: `item #1 cancelled: probe withdrawn (notified qa as notice #3)`.
  The probe row is `cancelled` with `cancelReason` recorded, and the other party gets a
  `CANCELLED #<id>: <subject>` notice item, which is itself queued work and does wake them.
- The row that gated on it is **not touched**: status stays `queued`, `park` stays `null`, and
  `workable()` returns `{workable:false, reason:"gate-cancelled:#1"}`.

## The wake

`selectWakes` (src/driver.mjs:147-166) skips the seat holding that row with reason
`queued-gated:gate-cancelled:#1`. With the notice removed from the item set the seat gets no wake
at all. So the driver never reaches the row; the row is not deleted, it is unreachable by the
automatic path.

## The exits that do exist

- **claim by id works.** `claim_work` with `itemId` (src/rig.mjs:854-858) checks only
  `it.to === me && it.status === "queued"` — it does NOT call `workable()`. Measured: the seat
  named the dead-gated row and got `ITEM #2 | ... | status=claimed`, then `complete_work` closed it
  (`done`). A seat that knows the id can close the row today.
- **The oldest-first claim refuses, and points the wrong way.** `NO_QUEUED_WORK — but NOT an empty
  queue: #2 is addressed to you and is now `queued`. It is not claimable in its current state;
  check `status` for who holds it.` Nobody holds it; the blocker is the dead gate, and the message
  does not say so.

## The trap

Once the row is parked, nothing can un-park it:

1. `hold_work` (no claim needed) parks it: `park: {class:"gated-work", basis:"every gate it names
   (#1) is terminal", gateIds:[1]}`.
2. `release_work` refuses: `item #2 not released: its gate names #1, which is cancelled - releasing
   it would make a row claimable whose prerequisite was dropped`.
3. `defer_work` refuses (not claimed). `revise_work` refuses (not queued).
4. No verb writes `blockedBy` except `send_work` at creation (src/rig.mjs:437); grepping
   `item.blockedBy =` in src/rig.mjs finds no other assignment.

Held + all-gates-terminal is therefore a dead end with no off-ramp. On the live store
(`selfdev.sqlite`, read 2026-11-12T04:33Z, 7,063 rows): 22 non-terminal rows name a cancelled gate;
20 of them have every gate terminal; **11 of those are held** — 3377, 3452, 3456, 3663, 4820, 4852,
4853, 5608, 5816, 5817, 5988 — exactly the class this trap closes.

## Detection

`cli.mjs check rig.selfdev.json --json` on the fixture store exits 1 with 2 findings, none
gate-related: the `unsatisfiable-gate` rule is in unlanded #3747 (branch tip `55c7ee78`; `grep -c
unsatisfiable src/checkup.mjs` on main is 0). On main, nothing reports this class.

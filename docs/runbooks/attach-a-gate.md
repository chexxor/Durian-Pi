---
runbook: attach-a-gate
symptom: "I know a row must wait on another row, but I am not the sender or the recipient of it, and every way of writing that constraint is refused or silently dropped"
writes: false                    # the procedure routes rows; it never opens a Harness or a store
precondition: "none"
last_verified: 2026-11-11
verified_by: architect
evidence: "item #6782; `node tools/probes/gate-authority-census-6782.mjs <dump>` exit 1 (63 dead-gate rows, 95 parked-gate rows, 0 gated/ungated events) at HEAD 35001c3a; `node tools/probes/gate-write-surface.mjs` exit 0; `node tools/probes/gate-reference-validation.mjs` exit 0"
check_rule: null                 # nothing re-tests gate reachability after the fact — see Evidence
---

# A gate you know about, on a row you do not own

## When to use

You are coordinating — you sequenced the work, you know it must wait — and the row exists, minted by
someone else. You try to write the gate. Outcomes, all of them dead ends:

- `revise_work(itemId, { body: "GATED ON #1234" })` → accepted, and the gate is **not** a gate; it is
  prose the claim predicate never reads (`workable()` reads `item.blockedBy`, `src/rig.mjs:310`).
- `revise_work(itemId, { body: "...", blockedBy: [1234] })` → refused by schema validation
  (`must not have additional properties`), and **the body edit in the same call is dropped too**.
  Measured: after the refused call the stored body is unchanged.
- `hold_work(itemId)` on a row you minted → `item #N is addressed to devtools, not you`
  (`src/rig.mjs:1212` — parking is recipient-only).
- `release_work` / `cancel_work` on a row you are neither party to → refused.

## Impact

The constraint does not exist. Nothing is corrupted — the validator refuses before
`queue.items.push` — but the queue now reads as ungated work, and the row runs when it should not.
This is the failure class behind "a milestone is claimed done and nobody can say what is left": the
gate lived in a sentence, and 42 held rows in `demo/queue-held-gates.test.mjs` have **no** recorded
gate at all.

## Preconditions

The broker is up (routing rows is a submission). No store is opened by this procedure.

## Diagnose (read-only)

Confirm the row's parties and its gate, before deciding what to mint:

```bash
DURIG_DB=./selfdev.sqlite node cli.mjs show <row-id>
```

Expected: the row's `from`, `to`, `status`, and — if it carries one — `blockedBy`. If `blockedBy` is
absent, the gate you know about is not recorded, whatever the body says.

## Do

Pick by whether you are a party.

1. **You are the sender or the recipient.** `revise_work` fixes intent only. To attach a gate,
   re-mint: `cancel_work` the row (terminal, notifies the other party with the reason) and re-send it
   whole with `blockedBy: [<ids>]`. Do not strip the constraint into prose to make it pass.
2. **You are neither.** Mint the gate as **your own row** — that is the legal lever, and it is what a
   coordinator actually has. Either mint the gated work yourself with the gate on it, or mint a carrier
   row addressed to the minting seat that states the gate you need and why. Then the party can apply it
   at mint time.
3. **Do not park a row you only minted.** `hold_work` is recipient-only today; if a row you minted is
   premature, the only legal move is `cancel_work`. This asymmetry is a registered defect (see
   `architecture-revise-authority-6225.md` §4 R5) — until it is fixed, do not mint rows you intend to
   park later; mint them with `held: true`.

Gate hygiene, whichever route you take:

- every id in `blockedBy` must **exist and be non-terminal**. A dangling id is inert
  (`workable` returns `{workable: true}`, `src/rig.mjs:312`); a `cancelled` id blocks forever
  (`gate-cancelled:#id`).
- never gate two rows on each other. `normalizeBlockedBy` (`src/rig.mjs:355-380`) checks shape only —
  no existence check, no cycle check. A cycle starves both rows with no exit.

## If the gate is already there and must come off

Measured on the live store (read seam: `DURIG_DB=selfdev.sqlite node cli.mjs queue --no-body > dump.json`, then `node tools/probes/gate-authority-census-6782.mjs dump.json` → exit 1): of 378 gated rows, **156** are gated on a target that can never resolve — 63 on a `cancelled` row, 95 on a row that is `held` or `deferred`. Today no verb can clear any of them: `blockedBy` is written at mint and never un-written (`tools/probes/gate-write-surface.mjs`, exit 0, 0 removal sites), and no row carries a `gated`/`ungated` event (0 of 6,877). The rule the fleet is moving to (`docs/reviews/architecture-gate-authority-6782.md`, amending D261): a **party** may clear a gate id when the target is terminal-cancelled, or when the target is parked with **no authored block** and its `reviewBy` is absent or past. Removing a live, authored gate is still a scope ruling for `lead`, and every removal writes `{event: "ungated", by, id, reason, at}`.

Until that verb exists, the honest move is: mint a row addressed to the party who can clear it, saying which id and why. Do not cancel the dependent to make the gate disappear — that is the terminal recovery this ruling exists to replace.

## Verify

The boundary this runbook describes is pinned by a probe:

```bash
node tools/probes/revise-authority-boundary.mjs
```

Expected: exit 0, and the six lines read as — coordinator revise REFUSED; both parties revise OK;
sender `revise_work` with `blockedBy` REFUSED **and the body unchanged**; a `done` row answered by
authority, not by terminality (the defect); sender `hold_work` REFUSED while `cancel_work` succeeds;
`blockedBy:[9999]` → `{"workable":true}`.

Then confirm the gate landed on the row you re-minted:

```bash
DURIG_DB=./selfdev.sqlite node cli.mjs show <new-row-id>
```

Expected: `blockedBy=<ids>` present, not a sentence in the body.

The stuck-gate census, if you need the fleet-wide picture:

```bash
DURIG_DB=./selfdev.sqlite node cli.mjs queue --no-body > /tmp/queue-dump.json
node tools/probes/gate-authority-census-6782.mjs /tmp/queue-dump.json
```

Expected today: exit 1 with the two gaps (no gate-edit verb; `legacyBlock` invents resolver "pm"). It goes GREEN only when a `gate_work` verb exists, the rig writes an `ungated` event, and the pm-inference line is gone from `src/queue-lifecycle.mjs:256`.

## If it fails

- The row refused with `not yours to revise` **and its status is `done`** → that is not a permissions
  problem, it is the authority-before-terminality defect: the row is closed. Read `status` before
  escalating. See `docs/WORK-ITEM-LIFECYCLE.md` §2.
- The row refuses with a `block` shape message (`may only carry queue constraints`, `must look like
  RM-<n>`) → that is `block-shape-refused.md`, not this one.
- The gate landed but the row never wakes → `stale-held-backlog.md`.

## Escalate to

- `lead` — when a gate must be **removed** (loosening a contract another seat authored is a scope
  ruling, not a verb), or when coordinator standing needs to become a recorded field on the row.
- `pm` — when the gate is real but the row's parties are wrong (the row should have been minted by the
  coordinator).

## Evidence

- Probe output 2026-11-10, `node tools/probes/revise-authority-boundary.mjs` → exit 0, quoted in
  `docs/reviews/architecture-revise-authority-6225.md` §3.
- `node demo/queue-held-gates.test.mjs` → exit 0 ("42 held rows with nothing written, listed by id").
- Code: `src/rig.mjs:310` (the gate read), `:441`/`:737` (the only gate write), `:1212` (`hold_work`
  recipient-only), `:1254` (terminal-before-authority, #5778), `:1291` (`revise_work` party check).
- **Why there is no `check_rule`:** nothing tests gate *reachability* after the fact. A row with a
  prose gate is indistinguishable from a row with no gate, and the store has no field to probe.

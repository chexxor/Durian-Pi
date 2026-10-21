---
incident: held-rows-orphaned-by-cleared-gates
date: 2026-10-19
severity: sev2
status: open
symptom: "work is parked and invisible: a held backlog row whose blocker finished is never released, so a whole effort sits dormant until a human asks about it"
runbook: stale-held-backlog
fix: null
prevention: "check-rule gate-cleared-unreleased + a typed block with a resolver (docs/reviews/queue-lifecycle-redesign.md)"
last_reviewed: 2026-10-19
---

# Held backlog rows are orphaned when their gates clear

*Incident 2026-10-19; detected by the operator asking "what is the status of the TUI migration?"; analysis by the delegate.*

## Summary

A whole migration — the durable-TUI — reached a **complete Phase 1 and then stopped progressing with
nothing broken and no attention raised**. The follow-on work (the render rules, the attach phase, the
advocate review) is registered as `held` rows, a status that is by design *unclaimable and non-waking*.
Each row names a gate ("gated on #2788", "release when #2103 lands"). When those gates **cleared** —
Phase 1 landed, the designer delivered, lead ruled the floor — nothing re-evaluated the held rows, emitted
a notice, or woke an owner. The parked work was correct, registered, and invisible. The one-line root
cause: **`held` is a manual park with no re-evaluation trigger and no obligation to name a resolver, so a
cleared gate is a silent event.**

## Timeline

- `2026-10-18` — the durable-TUI merge plan is ruled (scope (b), D102) and the phases are registered
  (`#2094`–`#2098`). The operator-directed multi-seat UX consultation is routed to `designer` and
  `advocate`.
- `2026-10-19T03:52Z` — the designer delivers the consultation (`designer-item-2103 @a3dff23`, item
  `#2748`, closing `#2629`). Its landing entry `#2797` is created **held**.
- `2026-10-19` — the durable-TUI Phase 1 build (`#2600`, re-registered from `#2096`) lands on `main`
  (`impl-item-2600 @3d07691`, merged as `34ba340`) and is verified (`#2901` → `#2904`, PASS).
- `2026-10-19` — lead rules the narrow-width floor precedence (`#2795` → `#2799`), clearing the last
  stated gate on `#2797`.
- `2026-10-19T09:44Z` — `designer`'s last activity. `advocate`'s review row `#2630` is still held; its
  gate ("#2103 lands") has been satisfied since `#2748`.
- `2026-10-19T20:14Z` — the operator asks the delegate for the migration status. The delegate has to
  reconstruct it from the queue, git refs, and branch contents; the answer is "Phase 1 done, and the rest
  is parked with cleared gates".
- `2026-10-19T20:22Z` — the delegate spools an operator-authorized intent
  (`operator-durable-tui-unblock-2026-10-19-1`, `delivered:true`) asking `pm` to release `#2630` and route
  `#2797` for landing.

## Impact

- **The migration sat dormant for ~17 h** after its Phase 1 verified, with no work and no alarm.
- **The failure is invisible, not loud.** `status`/`attention` derived kinds (`deferred_awaiting_answer`,
  `idle_with_queued_work`, `admitted_not_started`, …) do not cover a *held row whose gate has cleared*;
  there is no kind that reads "this park is stale".
- **It is the dominant backlog shape, not a one-off.** The live store holds **153 `held` rows**, of which
  **113 are addressed to `impl`**; the median time already spent in `held` is **~16 h**, and **49 rows are
  >24 h old** (max ~75 h). About **51** of the 153 name a gate in prose whose cited items are all already
  terminal — i.e. the same shape as the durable-TUI rows.
- **The delegate's own handoff was a symptom.** The previous session's `NEXT.md` clock-out did not
  mention the TUI chain at all; the work was not lost from the store, it was lost from the *operator's
  view* of the store.

## Root cause

The queue has two parked states and neither can express "waiting on a thing that will complete by
itself":

1. **`held`** — created unclaimable and non-waking explicitly so a "registered, do not start" backlog row
   cannot starve a working seat (`src/rig.mjs:338-349`). The only transition out is **`release_work`**,
   which a human or `pm` must issue. Nothing in the broker watches whether the row's **reason** to be held
   still holds.
2. **`deferred`** — a question parked on an answer (a seat or the human, `DEFERRED_TO_HUMAN`). This one is
   answered by traffic and *does* wake the target; it is the healthier of the two.

The gates themselves are **prose**, not fields: WORK-ITEM-SCHEMA §1/R5 measures **325 items encoding a
gate in prose, only 69 naming a resolvable `#NNN`**. So even if a watchdog existed, "is this gate still
pending?" is not a question the store can answer without parsing free text.

Two further mechanisms are missing:

- **No gate-completion propagation.** Cancelling or completing gate item `#2096` (Phase 1's original row
  was *cancelled*, superseded by `#2600`) does not touch the rows that name it. A dependent can even
  outlive its gate being cancelled and read as "blocked" by an item that no longer exists as work.
- **No ownership of a park.** A held row names the seat that will *do* the work, not the party
  responsible for *releasing* it, nor a review date. "Release when scheduled" has no scheduler.

## Detection

Human detection only. `node cli.mjs status` contract is "attention + non-terminal work", but its attention
kinds are derived from live seats and submissions; a held row with a cleared gate produces no kind. The
`verification-without-evidence` class (WORK-ITEM-SCHEMA §1) is adjacent but distinct. **There is no
`gate-cleared-unreleased` kind and no `parked-review-due` kind today** (grep: `src/attention.mjs` derives
six kinds, none about parks).

## Resolution

Partial, and not durable:

- The delegate diagnosed the chain from the queue + git (this report's Evidence).
- Operator-authorized intent `operator-durable-tui-unblock-2026-10-19-1` (`delivered:true` 20:22:19Z)
  asks `pm` to `release_work` `#2630` and route `#2797`. It also flags the Phase-1 pin caret
  (`^1.3.0` vs the build-spec's exact `1.3.0`).
- The remaining held rows are **not** individually unstuck by this incident; they are unstuck when the
  redesign lands (§Prevention).

**Append 2026-10-19T20:33Z (post-resolution verification).** `pm` processed the intent within ~2 min and
went further: `#2797` was released and is now `queued` (the designer doc is routed for landing); the pin
caret was registered as `#2969` (claimed by `devtools`); and the durable-TUI build chain was registered as
`#2977` (`#2788` first, then `#2789`/`#2804`/`#2826`, then `#2626`, with advocate's F6 acceptance anchors
folded in). `#2630` was released and **advocate claimed it — then correctly re-held it at `20:27:04Z`**,
reason recorded as prose in `heldReason`: the designer's proposal commits (`a3dff23`, `daa2f0c`) are
contained only on `designer-item-2103`, so the article the review must judge is **not yet on `main`**
(landing `#2797` pending).

That re-hold is a **live instance of the defect this report names**, and a precise one: the park is
*legitimate* — it is a `dependency` on a landing — but it is expressed only as free text
("release when pm's crossref or the landing lands"), so nothing can query it, nothing fires when `#2797`
lands, and the only way it moves is a person remembering. Under the redesign it is a
`block: {reason: dependency, payload: {blockedBy: [#2797]}}` that **auto-opens when `#2797` closes**. This
is the strongest argument for §4.1 of the proposal: the fix is not "release more" — it is to make the
gate structural.

## Prevention

The durable change is a queue-lifecycle redesign, proposed in
[`docs/reviews/queue-lifecycle-redesign.md`](../reviews/queue-lifecycle-redesign.md). Its core, in
order of leverage:

1. **A typed `block` with a mandatory `resolver`** replaces the bare `held`/`deferred` statuses: every
   non-active item must name *who or what* clears it (`blockedBy` item ids, a party, the operator, or a
   date), so a park can never exist without a reason the system can read.
2. **Blocks have triggers.** `dependency` blocks are re-evaluated on every broker pass and **auto-release**
   the item when all `blockedBy` gates are `closed`; a gate that becomes `cancelled` raises a
   `gate-cancelled` finding instead of silently unblocking.
3. **Attention kinds** `gate-cleared-unreleased`, `parked-review-due`, and `orphan-no-progress` make a
   stale park visible in `status`/`watch` without a human asking.
4. **`held` in the queue is reserved for real, recently-blocked work**; roadmap-shaped "registered, do not
   start" intent moves to the roadmap ledger (WORK-ITEM-SCHEMA §11), so the queue stops accumulating parks
   nobody owns.

Until that lands, the operating procedure is
[`docs/runbooks/stale-held-backlog.md`](../runbooks/stale-held-backlog.md), and the topic model for a
future delegate is [`docs/WORK-ITEM-LIFECYCLE.md`](../WORK-ITEM-LIFECYCLE.md).

**Append 2026-10-19T21:00Z (review loop closed).** The redesign was independently reviewed by `architect`
(`#2984`) and `advocate` (`#2985`) at the operator's direction. Both supported the two-axis model and
found real defects in v1: the architect raised **4 blockers + 13 change requests** (the v1 invariant was
not a partition; v1 §9 re-introduced the prose-scanning unsticker v1 §10 rejected; the auto-release could
fire on operator-window work; a stuck *gate* had no trigger or reminder), and the advocate raised **8
change requests** (the check rules would have gone red across ~153 unmigrated rows and blocked landings;
a `parked-review-due` firehose; `send_work({held:true})` cannot be deprecated before the roadmap ledger
has a write surface). The proposal owner accepted **every** finding and revised the design as **v2**, with
a per-finding disposition table in
[`reviews/queue-lifecycle-redesign.md`](../reviews/queue-lifecycle-redesign.md) §13. Two items are
escalated to `lead` (the `#2673` `workable` seam; the missing D114 ADR).

## Evidence

- Status histogram (`done` 2350, `cancelled` 429, `held` 153, `claimed` 18, `deferred` 9, `queued` 2) and
  the held-by-seat split (`impl` 113, `devtools` 13, `qa` 7, `scribe` 7, `security` 5, `lead` 4,
  `auditor` 2, `advocate` 1, `pm` 1): the analysis script over
  `DURIG_DB=./selfdev.sqlite node cli.mjs queue` (see `docs/WORK-ITEM-LIFECYCLE.md` §"How to re-verify").
- `held` is unclaimable and non-waking: `src/rig.mjs:338-349`; the only exit is `release_work`
  (`src/rig.mjs:783`).
- The durable-TUI chain statuses: `#2096` cancelled, `#2600` done, `#2629` done, `#2630` held, `#2626`
  held, `#2788` held, `#2789` held, `#2797` held, `#2826` held, `#2804` held, `#2733` held.
- Phase 1 landed and verified: `git log main` contains `34ba340 merge: land impl-item-2600 onto main`;
  `#2901` → `#2904` report `tui-durable-ownership` 9/9 and `tui-suite` 24/24, exit 0.
- The designer doc is delivered but **not on `main`**: `git cat-file -e main:docs/reviews/designer-multi-seat-tui-flow.md`
  → absent; `a3dff23` present only on `designer-item-2103`.
- Prose gates, measured: WORK-ITEM-SCHEMA §1 ("325 items; only 69 name a resolvable `#NNN`").
- The intent delivery: `selfdev.sqlite.broker.inbox.out/operator-durable-tui-unblock-2026-10-19-1.json`
  (`delivered:true`) and the broker log line `INTENT delivered=1 dead=0 dup=0` at `20:22:19Z`.
- `pm`'s response (verified from the live queue transitions): `#2797` held→released→revised→queued at
  `20:23:55Z`–`20:24:04Z`; `#2630` released `20:23:55Z`, claimed by advocate `20:23:58Z`, **re-held by
  advocate `20:27:04Z`** with the `heldReason` quoted above; `#2969` (pin caret) queued `20:23:55Z` and
  claimed by `devtools` `20:29:27Z`; `#2977` (build-chain sequencing) held `20:32:54Z`.

## Links

- Runbook: [`stale-held-backlog`](../runbooks/stale-held-backlog.md)
- Topic doc: [`WORK-ITEM-LIFECYCLE`](../WORK-ITEM-LIFECYCLE.md)
- Proposal: [`queue-lifecycle-redesign`](../reviews/queue-lifecycle-redesign.md)
- Schema: [`WORK-ITEM-SCHEMA`](../WORK-ITEM-SCHEMA.md) §1, §4/R5, §11
- Decision: D102 (scope b)
- Queue items: `#2626`, `#2630`, `#2733`, `#2788`, `#2789`, `#2797`, `#2804`, `#2826`

# Review: the status rule `hold_work` needs before it is widened (#6763)

**Question.** pm's BUILD ADD on #6477 says the hold widening needs a status rule (sender parks queued only) and must follow the ordering fix. Here is the rule, pinned to what the verb actually answers.

**Run.** `node tools/probes/hold-status-rule-6763.mjs` → exit 1, eight findings, on HEAD `35001c3a` (branch `item-6731`, pi-durable 1.3.0 from the lockfile). Every actor × every status went through the real `hold_work` tool in a faux-provider session.

## Measured, today (`src/rig.mjs:1251-1290`)

| actor | status | what the rig says | row afterwards |
|---|---|---|---|
| recipient | queued | held | `held` |
| sender | queued | "item #1 is addressed to impl, not you" | `queued` |
| stranger | queued | "item #1 is addressed to impl, not you" | `queued` |
| recipient | claimed | held | `held` |
| recipient | held | "item #3 is held; hold_work parks a row you hold (claimed) or a queued row addressed to you" | `held` |
| recipient | done | "item #5 is done; hold_work parks a row you hold (claimed) or a queued row addressed to you" | `done` |
| sender | done / cancelled | "item #5 is addressed to impl, not you" | `done` / `cancelled` |

Nothing mutated a terminal row — the guard holds. But three defects are visible in the text itself.

**1. Authority is answered before terminality.** `src/rig.mjs:1267` tests `item.to !== me` before the status test at `:1276`. A sender asking about a **done** row is told "it is addressed to impl, not you". That is the same misattribution #5778 fixed in `release_work` (`src/rig.mjs:1318` checks `isTerminalItem` first, with the measured live-store case: `release_work` on #5488 and #5398, both `done`, answered "only the sender or recipient may release it", which read as "parked, waiting for a release"). A coordinator reading the hold refusal reports a finished row as parked.

**2. "parks a row you hold (claimed)" is an invitation.** For a held, deferred, done or cancelled row the refusal ends with instructions that only make sense for a live row. For a held row it never says "already held"; for a terminal row it says "hold a row you hold", which an agent can read as "claim it, then hold it" — a path that does not exist for closed rows.

**3. The sender has no lever, so parking a backlog is mint-time only.** `send_work(..., held: true)` already mints parked rows, which is why the widening is small. But once a row is out, the sender cannot park it; its only remaining lever is `cancel_work` — the terminal one. D261 clause 2 already flagged this asymmetry ("parking must not be harder than cancelling").

## The rule, stated as an admission order

```
hold_work(itemId, reason)
  1. exists        -> "unknown item #N"
  2. terminal      -> "item #N is already <status> (terminal); there is nothing to park"
  3. already held  -> "item #N is already held (by <seat>, <reason>); release with release_work(#N)"
  4. authority     -> recipient: its own row, queued OR claimed.
                      sender:   QUEUED rows only — never a row the recipient has claimed.
                      a seat that is neither party: refused.
  5. otherwise     -> refuse, naming the holder: "item #N is claimed by impl; only impl or pm may park it"
```

Terminality before authority, authority before applicability — the order #6671 found five verbs getting backwards.

## Why "sender: queued only" is the right bound

A claimed row is another seat's work in progress. Parking it changes what that seat can claim while it is mid-task, and the seat's own view (`claim_work`'s oldest-item claim) then disagrees with the store. So the sender's power stops at the moment of the claim. That bound is falsifiable by the probe: it must refuse `sender x claimed`.

**Options considered.** (a) Let any party park any non-terminal row — rejected: it turns parking into a way to remove work from a seat's queue without cancelling it. (b) Let a coordinating seat (pm) park rows it routed — rejected: release is delegable because it is reversible *to the default state*; parking a live row changes what another seat can claim, so it stays with the parties. (c) Chosen bound: parties only, sender limited to queued. Trade-off accepted: a pm that wants to park a row lead minted must ask the sender or mint its own parked row; that is a routing cost, not a correctness cost.

## Failure modes at this seam, each with a recovery

| mode | today | recovery |
|---|---|---|
| terminal row reported as parked | authority answered first | step 2 before step 4, wording "already `<status>` (terminal)" |
| work in progress silently parked | no sender rule exists yet | sender limited to `queued`; refusal names the claiming seat |
| re-parking reads as an instruction | "parks a row you hold (claimed)" | explicit "already held" branch pointing at `release_work` |
| parked row with a dead gate | release refused, nothing else works (measured in #6707) | `gate_work` dead-gate removal, D280 |
| parked backlog never revisited | no wake, no report | `reviewBy` on the park record and `check` reporting parked rows by age (D277) |
| authority drift | `seatIsCoordinator` derives standing from missing capabilities (#6671) | standing comes from the row (`from`, `to`, `block.resolver`), not from an absent capability list |

## What must land together

The widening and the ordering fix are one change. Shipping the widened authority without the terminal-first order gives a sender a new verb that misreports closed rows — the exact class #5778 measured. Sequence: ordering fix (#6508's admission rule) → status rule → sender widening.

**Falsifiable check.** `tools/probes/hold-status-rule-6763.mjs` is RED now and goes GREEN only when: terminal rows answer "terminal", a sender can park its own queued row, a sender cannot park a claimed row, an already-held row answers "already held", and every refusal names the actor and the next verb.

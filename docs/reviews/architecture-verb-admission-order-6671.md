# Review: the admission order the gate-verb rows assume (architect, #6671 / #6508-#6512)

**Question.** pm's notice on #6671 says the amendments to #6512, #6509, #6510/#6511 are applied and the
build rows are ready to start. Before impl writes `admitRow`, two things have to be true: the contract the
rows describe must be the contract the code can actually satisfy, and the probe that checks it must exist.
I checked both, and ran the probe pm said they did not run.

**Measured.** Two probes, both in this item's worktree at HEAD `35001c3a`. Note the dependency set: this
worktree resolves `@earendil-works/pi-durable` **1.3.0** from the lockfile (the `sync-pi --link` step
failed, so `vendor/pi-main` is not linked); the seat root resolves 1.5.1. The verdicts below are about
`src/rig.mjs` logic, not about the durable version.

- `git show item-6517:tools/probes/gate-verb-decomposition-gaps.mjs | node` → **exit 1, RED, 8 gaps**, as
  pm's row claims. Self-gate accepted by `normalizeBlockedBy`; **0** code sites remove a gate once written;
  a parked row with a cancelled gate has exactly two exits; a 3-cycle makes all three rows permanently
  unworkable and the reason a seat reads names only the parent, not the ring.
- `node tools/probes/verb-admit-order-6671.mjs` (mine, written for this review) → **exit 1, 9 assertions
  fail**. Seven verbs × three seeded rows (terminal-and-stranger, live-and-stranger, mine-but-wrong-state),
  each driven through the real tool with faux turns, classified from the refusal text the seat actually
  receives:

| verb | terminal + stranger | live + stranger | mine, wrong state |
|---|---|---|---|
| defer_work | `addressed to other-seat, not you` (**authority**) | authority | `is not claimed by you (status=queued)` |
| resume_work | authority | authority | `is not deferred (status=queued)` |
| hold_work | authority | authority | `is deferred; hold_work parks a row you hold…` |
| revise_work | `not yours to revise` (**authority**) | authority | `is not queued (status=claimed)` |
| cancel_work | `not yours to cancel` (**authority**) | authority | accepted |
| release_work | `already done (terminal); there is nothing to release` (**terminality**) | authority | `is not held (status=queued)` |
| claim_work | `NO_QUEUED_WORK` | `NO_QUEUED_WORK` | `NO_QUEUED_WORK` |

Five verbs answer authority before terminality. `release_work` is the only one that follows the rule already
written in DECISIONS.md (the #6185 ruling, point 4: "Terminality is checked before authority in every control
verb"). `claim_work` by id answers nothing at all: three different situations return the identical string.

## The exact defect in the amended rows

**#6510's own phrasing contradicts the verb it holds up as the model.** The row says "check state BEFORE
authority (terminal, then status, then authority)". `release_work` — the row's cited model, and the only
verb that gets it right — is ordered:

```
src/rig.mjs:1311  existence:  unknown item #N
src/rig.mjs:1318  terminality: already done (terminal)          #5778
src/rig.mjs:1337  authority:   only the sender, recipient, or a coordinating seat
src/rig.mjs:1339  applicability: is not held (status=queued)
```

That is **terminal → authority → applicability**, not terminal → status → authority. Written the way the row
reads, `admitRow` would answer "not held" to a stranger, which is the same class of misreporting #5778
exists to prevent: the reader learns a fact about the row's state when the operative fact is that they have
no standing on it.

**The contract has four steps, and the rows name three.** Pin it as:

1. **existence** — `unknown item #N`;
2. **terminality** — no actor, party or not, can act on a closed row;
3. **authority** — not a party (with `release`'s scoped coordinator carve-out);
4. **applicability** — the verb's own expected state, named with the state the verb needs.

Steps 2 and 4 are both "state", and collapsing them is what let the row read as three steps. They are
different questions: 2 asks *can this row be acted on at all*; 4 asks *is this the right verb for it*.

**The claim leg is not an admission call.** `claim_work` by id tests the row inside `find` and returns null
on every failure, which renders as `NO_QUEUED_WORK` — the same string as an empty queue. So wiring the six
verbs to `admitRow` (the row list already includes claim-by-id) does not fix claim unless `admitRow` also
carries the `workable()` predicate. That is #6669's ruling: a refusal must name the reason the predicate
already produces (`gate-open:#1(queued)`, `requires:design`, `gate-cancelled:#6`).

## Failure modes, each with the recovery path

1. **Six verbs re-implement the helper.** Reordering per verb is exactly how five of them drifted. *Fix:*
   one `admitRow`, and a check that counts call sites — the probe asserts order by behaviour, not by grep.
2. **The helper is "scannable by the gate that checks it" (#6510) but the gate matches a name.** If
   `admitRow` is renamed, the rule reports green while the helper still exists under another name. *Fix:*
   assert call-site count and per-verb behaviour, not the identifier.
3. **Refusal strings are contracts.** #3663 pinned `NAMES_ITS_VERB` across 11 commands; reordering changes
   which string a seat sees, so goldens move. *Fix:* the order change and the golden update land in one
   commit, and the probe asserts the *class* of the refusal (terminality vs authority vs applicability), not
   the wording.
4. **Status literals migrate under the helper.** Queue-lifecycle v2 (#3112, `effectiveStage`/`effectiveBlock`,
   ~30 status-literal sites per #3021). If `admitRow` tests `item.status === "done"` directly, the migration
   leaves it asserting literals. *Fix:* the helper reads through the mapping pair, and #6513's check rule
   counts literals.
5. **Coordinator standing is inferred from an ABSENT capability.** `seatIsCoordinator`
   (`src/seattools.mjs:292-294`) returns true when no working capability is declared. Measured with the same
   seat, the same row, one commit apart: advertising `implement` → `item #200 is addressed to other-seat …
   only the sender, the recipient, or a coordinating seat may release it`; declaring nothing → `item #200
   released back to queued by impl (coordinator release: re-parking it)`. A seat whose capabilities failed to
   register silently gains release authority over rows it has no stake in. *Recovery in place:* a
   non-party release requires a reason, and the release records the actor and reason as a transition. *Add:*
   a check rule that reports a seat whose role implies work but whose capabilities are empty — that is a
   configuration fault the rig currently reads as a coordinator.
6. **A gate with no removal path.** Measured 0 removal sites; #6508 is the exit. Adding a removal verb is
   loosening a contract someone else authored. *Fix:* specify authority precisely — parties only, or a
   coordinating seat **with a reason** (the `release_work` shape, #6112) — and notify the author, the way
   cancellation notifies (#3470). Silent removal is the failure mode; the recorded transition plus the notice
   is the recovery.

## Options and the trade-off I accept

**(a) Wire the six verbs to `admitRow` and leave `claim_work` alone.** Matches the rows as written; rejected,
because it leaves the leg the fleet actually uses (claim) answering three distinct failures with one string.

**(b) `admitRow(item, me, verb)` covering all seven legs, with claim additionally consulting `workable()`.**
Chosen. Two functions with named jobs — admission (who may touch this row, and in what state) and
workability (is this row ready) — and every verb calls both where both apply. Trade-off accepted: claim's
refusal text gets longer (id + reason + remedy), which costs context on every wake, in exchange for a seat
being able to act on a refusal instead of escalating it.

**(c) Leave the order per verb and document it.** Rejected on measurement: five of seven verbs already
disagree with the written rule, so documentation is not a control.

## Falsifiable probes

- `node tools/probes/verb-admit-order-6671.mjs` — exit 1 now; must exit 0 when `admitRow` lands, with each
  verb classified in the four-step order.
- `git show item-6517:tools/probes/gate-verb-decomposition-gaps.mjs | node` — exit 1 now; each of the eight
  gaps flips to CLOSED as its row lands. That branch (`item-6517`) is **not landed**, so anyone reading the
  rows should run it from the ref, not from a path on disk.

## One operating hazard this review found by accident

The amended subjects are in the store but **not in pm's own mirror**. `queue-pm.md:797-800` still reads
`gate_work: accept queued OR held rows…`, `check state BEFORE authority (terminal, then status, then
authority)`, `Verb-ordering class: …`, `run the shared validator on the COMBINED gate set…` while
`queue-all.md:1120-1123` carries the amended subjects. A seat told to "read #6512 before starting" and
reading its own mirror reads the pre-amendment text. That is the staleness defect my row #6514 registered
for #1978, caught live on the exact rows that tell seats what to read.

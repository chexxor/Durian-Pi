# Review #6664 — `blockedBy-resolves`: the count that sets the severity, and the two gaps the rulings leave open

**Seat:** architect. **Item:** #6664 (lead's two scope rulings on the gate tranche, following my #6517 review).
**Tree:** `item-6664` (fork of `item-6643`).
**Instrument:** `node tools/probes/stranded-gate-census-6664.mjs` → **exit 1**, snapshot **2026-11-11T13:32:14Z**. It reads through `src/readclient.mjs` `readData(db, "queue", ...)`, the same broker-served seam `tools/held-gate-audit.mjs` uses — no second store opener, no model, no broker write. Cross-checked with `node tools/held-gate-audit.mjs --limit 3` (exit 0) on the same store.

lead's instruction was "count the stranded gates on a store snapshot first, report the number with the timestamp and exit code, and set severity from that". Here is that count.

## The measurement

| quantity | value |
|---|---|
| rows in the queue document | 6,800 |
| statuses | done 4,569 · cancelled 922 · held 428 · deferred 524 · claimed 8 · queued 349 |
| active (non-terminal) rows | 1,309 |
| active rows carrying a structured `blockedBy` | 211 |
| **stranded**: active row whose gate names a CANCELLED row | **23** (1.8% of active) |
| active rows whose gate names a **non-existent** id | **0** |
| stranded by status | held 14, deferred 9 |
| stranded age (days since first transition) | min 2, median 2, max 22 |
| stranded rows with an authored block naming resolver + reviewBy | 10 |
| stranded rows with no recorded block at all | 13 |

Independent corroboration, same store: `tools/held-gate-audit.mjs` reports 428 held rows classified 25 release-candidate, 8 cancel-candidate, 181 standing-rule, 102 gate-open, 112 unattributed, and 235 rows where structure and prose disagree.

## What I verified in lead's rulings, and where the citations drifted

| claim | verdict | evidence |
|---|---|---|
| "docs/WORK-ITEM-SCHEMA.md:188 names `blockedBy-resolves` at error severity" | true | `docs/WORK-ITEM-SCHEMA.md:188`, under §8 headed **"Enforcement (for `pm` to route — not implemented by this document)"** |
| "`src/checkup.mjs` implements nothing" for it | true, and wider than stated | `node --input-type=module -e "import('./src/checkup.mjs').then(m=>console.log(m.RULES.length, m.RULES.map(r=>r.id).join(',')))"` → 23 rules: `constitution-missing … doc-count-drift`. **None** of §8's five (`item-title-schema`, `item-kind`, `blockedBy-resolves`, `branch-name`, the `notice` rule) is implemented. So "declared, not enforced" is a property of the whole section, not of one row |
| "the release refusal at `src/rig.mjs:1345`" | true but drifted | the guard is at `src/rig.mjs:1346` (`const dead = deadGateId(item, queue.items); if (dead) return ...`). `deadGateId` itself is `src/rig.mjs:312` |
| the semantics of a dead gate | narrower than the rule's wording | `deadGateId` returns only ids whose target is **cancelled**; its own comment says "a missing id is ambiguous, so it is passed over". `workable()` (`src/rig.mjs:316-333`) does the same: `done` → continue, missing → continue, `cancelled` → `gate-cancelled:#<id>`, else `gate-open`. The schema's "names a non-existent id" half has **no enforcement anywhere** and, on this store, **no population** (0 rows) |

## Ruling 1, made concrete: severity is split, not chosen

One rule, two halves, two different populations — a single severity cannot serve both.

1. **Write-time (mint): error.** Refuse a `send_work` whose `blockedBy` names an id that does not exist in the queue document, or names a row already terminal. Population today: 0 non-existent ids. Cost of enforcing it now: zero refusals. Benefit: the class stops accumulating. This is exactly the strict-at-write half of D269 and D268.
2. **Read-time (report): attention/soft, with the count.** 23 existing rows. Not large, but 13 of them cannot be cleared by any verb that exists yet (see gap 2 below), so a rule that reports them every pass is a permanent red line, and permanent red lines get muted — #3539's lesson, applied in the opposite direction from lead's framing. Report with the number and the route to repair; do not rewrite anyone's gate.

Doc text that should replace `docs/WORK-ITEM-SCHEMA.md:188`:

> 3. `blockedBy-resolves` — **declared, not enforced.** Mint-time: a `blockedBy` id must exist in the queue document and must not be terminal (refused at `send_work`). Read-time: an existing gate whose referenced row is `cancelled` is a strand to be cleared, reported with a count, never rewritten by the checker. Census: `node tools/probes/stranded-gate-census-6664.mjs` (exit 1 when the count is non-zero; 23 at 2026-11-11T13:32:14Z). A severity is not real until a run can fail on it.

## The gaps the rulings leave open, each with a recovery

**Gap 1 — stranded gates accumulate silently at cancel time.** `cancelItem` (`src/rig.mjs:204-235`) notifies the two parties of the cancelled row and nobody else. Every cancellation of a gated parent strands its dependents with no signal; 23 rows is the accumulated result. **Recovery:** at cancel, enumerate rows whose `blockedBy` contains that id, record `strandedDependents: [ids]` on the `cancelled` transition, and notify those rows' parties. Falsifier: a demo that mints `A` gated on `B`, cancels `B`, and asserts a notice reaches `A`'s parties and the transition carries the ids. Without this, the census grows monotonically and severity-by-measurement is measured on a moving target.

**Gap 2 — the report has no repair verb yet.** `release_work` refuses to un-park a row whose gate names a cancelled row (`src/rig.mjs:1346`), and there is no set/replace-gate verb (#3570, being built as #6530). So of the 14 stranded **held** rows, the only legal transition today is `cancel` — terminal, intent destroyed. **Recovery:** land the reporting rule *after* (or in the same tranche as) the clearing verb; if it must land first, the report line must name the terminal exit explicitly so a reader is not told "this is stranded" and left with no lever. Sequencing is the whole difference between observability and noise.

**Gap 3 — the schema and the code disagree about a missing id.** §8 says error; `workable()` and `deadGateId` pass it over. Two answers to the same question is how rules drift. **Recovery:** the §8 rewrite above states the asymmetry (strict at mint, conservative at read), which is already ruled in D268/D269; the doc just has to say it.

**Gap 4 — the mint check must not refuse roadmap ids.** A naive "the id must exist in the queue" check also rejects `RM-<n>` style references, which §6 requires to be qualified. **Recovery:** validate only bare integer ids against the queue document; require external references to be qualified, and refuse a bare non-integer in `blockedBy` rather than silently passing it.

**Gap 5 — cadence.** A per-pass report on 23 rows is 23 notices per pass. **Recovery:** one fire per item-epoch (#3050), and the check rule prints the count, not one row per row.

## Options considered, and the trade-off accepted

- **(a) one error rule at read over all gates.** Rejected: it fires on 23 rows at first run, and 13 of them have no repair path, so it stays red until someone cancels the intent. Rules that start red get disabled (#3539).
- **(b) strict at mint, soft at read — chosen.** Stops the inflow at zero cost today, keeps the existing population visible without pretending it is fixable by the checker. Reversible: the read-side severity can be raised when the count falls, and the census above is the instrument that decides it.
- **(c) delete the rule.** Rejected, as lead ruled: mint-time refusal is the only point where the class can be prevented, and 23 stranded rows are evidence the contract is being violated in practice, not in theory.

Trade-off named out loud: (b) accepts a permanent soft report until #6530 lands, in exchange for stopping new strands now. That is the cheaper, reversible half of the fix.

## Ruling 2, checked against the code

The mandate ("a parked row whose gate is unsatisfiable must carry `reviewBy` and a named resolver") is **already enforced for authored blocks**: `normalizeBlock` (`src/queue-lifecycle.mjs:132-156`) requires a non-empty `resolver` and fills `reviewBy` from the reason default unless the reason's default is null (`backlog`, `question`). What the mandate actually adds is coverage of the 13 stranded rows that carry **no recorded block at all** — rows parked before the field existed. So the real work is a backfill-at-re-touch requirement (schema §9 phase 3: "when an old item is re-touched, add its kind and convert its prose gate"), not a new field. The schema text should say that plainly, and the scribe pass (#6663) should be scoped to those 13 ids, not to all 428 held rows.

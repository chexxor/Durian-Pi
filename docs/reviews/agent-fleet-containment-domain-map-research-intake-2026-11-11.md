# Research intake R2 — registration note for the agent-fleet containment domain map

**Row:** queue #5148 (lead → architect), "RESEARCH INTAKE R2 (parked; the second gate in front of the 171-174 mint)".
**Seat:** architect. **Date:** 2026-11-11. **Tree:** worktree `item-5148`, fork of main.
**What this row is:** receive and register a commission. It is **not** a design, and nothing here designs anything.

## What was received

`docs/reviews/agent-fleet-containment-domain-map-research-prompt.md`, 131 lines, status line **"READY TO ROUTE"**, delegate-written 2026-11-05 on the operator's ruling that the domain must be understood before a solution is designed. It is addressed to the operator's off-host research agent, which has **no write access to this repo**, so it asks for content to copy, never for commits.

**Nine questions** became ten at intake, and the deliverable has **eleven** sections.

## Verified, with the command that shows it

| claim | check | result |
|---|---|---|
| the commission exists and is complete in shape | read the file | Context / Questions 1-9 / Deliverable (10 sections) / Evidence discipline / Constraints all present |
| "we already pinned and first-pass-triaged ~27 projects" is true | `grep -c '^\| `' docs/VENDOR-PINS.md` | **27** rows |
| every project the prompt excludes is one we actually pinned | grep each of the 13 names in `docs/VENDOR-PINS.md` | all 13 present, including `agent-governance-toolkit` (MIT), `sandbox-sdk` (Apache-2.0), `awesome-agent-sandboxes` (**NO LICENSE FILE**) |
| the deliverable has not landed | `ls docs/reviews/agent-fleet-containment-domain-map-research.md` | absent — nothing to consume yet |
| the commission is already cross-linked | `grep -rn "agent-fleet-containment" docs/` | `docs/DECISIONS.md:9128`, `docs/NEXT-ARCHIVE.md:11756`, and `docs/reviews/branch-lifecycle-research-prompt.md:47` |
| **the commission is missing the half the runbook requires** | `node -e` token scan of the prompt | `iteration=0 test plane=0 hermetic=0 mock=0 regression=0 "loop cost"=0 quarantine=0` |

## The defect found at intake, and the fix

`docs/runbooks/research-request.md`, Do step 1, states without exception: *"A pass over competing **products** must also carry the iteration-architecture questions (D213, `docs/runbooks/slow-loop.md`): piece boundaries and their loop cost, hermetic vs live test planes, how the model is mocked or substituted in tests, how prompt changes are regression-tested, what bounds a long agent turn, and how slow tests are quarantined."*

This commission surveys competing products and carries **none** of those questions — measured above, seven zero counts. So it was not routable as written. The addendum is in the prompt file itself (question 10 and deliverable section 10), added at intake rather than after the report arrives, because a question asked late costs a second round — the same reason round 3 of the harness-tools survey existed.

Why it matters for this rig specifically: the map answers *who contains agents and how*. It does not answer *how fast they can change the containment*, which is the half D213 says decides our own architecture. A competitor whose policy engine ships but whose test plane requires a live model every run is not comparable to us on the axis we care about.

## The gate this row sits in front of — measured, and it does not work as intended

`#5152` (the 171-174 decomposition, lead → architect) carries `blockedBy = [4829, 5147, 5148]`. Read through the product's own predicate (`node cli.mjs queue --no-body` piped into `workable()` from `src/rig.mjs`):

- `4829` — **done**, clears.
- `5147` — **deferred** (research intake R1, security seat): never clears on its own.
- `5148` — **held** (this row): never clears on its own.

Neither parked row carries an authored park block (`park: none`), so there is no recorded resolver or review date. That is the stranded-gate class measured in `tools/probes/gate-authority-census-6782.mjs` (exit 1: 156 of 378 gated rows gated on a target that can never resolve), and it is the exact case my #6880 note routed to pm: a gate naming a parked row is a registration pointer, not release authority (`docs/DECISIONS.md:3977`, point 7). **Recovery path:** close the two intakes as *rows* — this row by registration (done here), R1 by the residue extraction it names — or re-mint the mint row's gate to name something that can reach `done`. Until one of those happens, the decomposition cannot be claimed regardless of the research.

I did not un-park or complete #5147; that row is the security seat's and its condition is a named ruling, not a gate I can close.

## What is NOT produced here

No architecture, no control design, no axis chosen. Per the row's own constraint, the output is a registered commission with a fixed routability defect and an accurate record of the gate it sits in front of.
